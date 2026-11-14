package si.safeer.lina.telecom

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.Call
import android.telecom.TelecomManager
import android.telecom.VideoProfile
import si.safeer.lina.audio.CallAudioBridge
import si.safeer.lina.transport.GatewayRuntime
import si.safeer.lina.protocol.CallCommandPolicy
import si.safeer.lina.protocol.CommandAction
import si.safeer.lina.protocol.GatewayCommand
import si.safeer.lina.protocol.TakeoverPhase
import si.safeer.lina.protocol.TelecomPhase

class CallCommandController(context: Context) {
    data class Result(val ok: Boolean, val error: String? = null)

    private val appContext = context.applicationContext
    private val telecomManager = appContext.getSystemService(TelecomManager::class.java)
    private val mainHandler = Handler(Looper.getMainLooper())

    fun handle(command: GatewayCommand, callback: (Result) -> Unit) {
        mainHandler.post {
            callback(run(command, remote = true))
        }
    }

    /**
     * Dejanje z zaslona klica. Ni oddaljeni ukaz, zato ni vezano na to, da je klic prevzela Lina.
     * DIAL tudi tu ne gre skozi: lokalno klicanje je placeLocalCall.
     */
    fun performLocal(command: GatewayCommand, callback: (Result) -> Unit) {
        mainHandler.post {
            callback(run(command, remote = false))
        }
    }

    private fun run(command: GatewayCommand, remote: Boolean): Result = try {
        // Lokalni odgovor, zavrnitev in prekinitev oznacijo klic, se preden se dotaknemo Telecoma.
        if (!remote && CallCommandPolicy.claimsBeforeTelecom(command.action)) {
            val wasLina = LinaCallGate.markManual(command.callId)
            if (wasLina) {
                CallAudioBridge.onCallEnded(command.callId)
                GatewayRuntime.notifyCallEnded(command.callId)
            }
        }
        if (remote) execute(command) else perform(command)
    } catch (_: SecurityException) {
        Result(false, "telecom_permission_denied")
    } catch (_: Exception) {
        Result(false, "telecom_action_failed")
    }

    /**
     * Oddaljeni ukaz. DIAL je izklopljen. Ostali ukazi veljajo samo za klic, ki ga je prevzela Lina.
     * Rocni klic in klic, ki bi zadrzal uporabnikovega, se zavrneta.
     * ANSWER samo, ce klic se zvoni in ni rocno sprejet. Owned sele po uspesnem answer.
     */
    private fun execute(command: GatewayCommand): Result {
        if (LinaCallGate.isManual(command.callId)) return Result(false, "call_controlled_locally")
        val headset = CallCommandPolicy.blockedByExternalPickup(command.action, RouteGuard.externalPickup)
        if (!headset.allowed) return Result(false, headset.reason)
        val call = CallRegistry.get(command.callId)
        val displacement = CallCommandPolicy.displacesUserCall(
            command.action,
            targetIsUserCall = CallCommandPolicy.isUserControlled(
                ownedByLina = LinaCallGate.isOwned(command.callId),
                manuallyAnswered = LinaCallGate.isManual(command.callId),
                outgoing = call?.details?.callDirection == android.telecom.Call.Details.DIRECTION_OUTGOING,
                phase = if (call == null) TakeoverPhase.OTHER else phaseOf(call),
                announced = LinaCallGate.isAnnounced(command.callId),
            ),
            userOwnsOtherActiveCall = userOwnsOtherActive(command.callId),
        )
        if (!displacement.allowed) return Result(false, displacement.reason)

        val decision = CallCommandPolicy.decide(command.action, command.callId, LinaCallGate.controllableIds())
        if (!decision.allowed) return Result(false, decision.reason)
        if (command.action != CommandAction.ANSWER) return perform(command)

        val ringing = call ?: return Result(false, "call_not_found")
        // Pregled 17 (A5): pred ANSWER se enkrat izbrana linija (ukaz strezniku ne sme mimo LineGate).
        val answer = CallCommandPolicy.allowRemoteAnswer(
            phaseOf(ringing),
            LinaCallGate.isManual(command.callId),
            lineAllowed = LinaLine.allowed(appContext, ringing),
        )
        if (!answer.allowed) return Result(false, answer.reason)
        if (!LinaCallGate.beginAnswer(command.callId)) return Result(false, "call_controlled_locally")

        val result = try {
            if (LinaCallGate.isManual(command.callId)) Result(false, "call_controlled_locally") else perform(command)
        } catch (error: Exception) {
            LinaCallGate.finishAnswer(command.callId, success = false)
            throw error
        }
        LinaCallGate.finishAnswer(command.callId, success = result.ok)
        return result
    }

    /** Skupna izvedba na Telecom. Ne odloca, ali je ukaz dovoljen. */
    private fun perform(command: GatewayCommand): Result = when (command.action) {
        CommandAction.DIAL -> Result(false, "dial_disabled")
        CommandAction.ANSWER -> withCall(command.callId) {
            it.answer(VideoProfile.STATE_AUDIO_ONLY)
            Result(true)
        }
        CommandAction.REJECT -> withCall(command.callId) {
            CallRegistry.markRejected(command.callId)
            try {
                it.reject(false, null)
                Result(true)
            } catch (error: Exception) {
                CallRegistry.clearRejected(command.callId)
                throw error
            }
        }
        CommandAction.HANGUP -> withCall(command.callId) {
            it.disconnect()
            Result(true)
        }
        CommandAction.HOLD -> withCall(command.callId) {
            it.hold()
            Result(true)
        }
        CommandAction.UNHOLD -> withCall(command.callId) {
            it.unhold()
            Result(true)
        }
        CommandAction.DTMF -> withCall(command.callId) {
            playDtmfSequence(it, command.callId, requireNotNull(command.digits))
            Result(true)
        }
    }

    /** Klic s tipkovnice telefona. Ni oddaljeni ukaz in sme poklicati tudi stevilko v sili. */
    fun placeLocalCall(callId: String, number: String, callback: (Result) -> Unit) {
        mainHandler.post {
            val result = try {
                place(callId, number)
            } catch (_: SecurityException) {
                Result(false, "telecom_permission_denied")
            } catch (_: Exception) {
                Result(false, "telecom_action_failed")
            }
            callback(result)
        }
    }

    private fun place(callId: String, number: String): Result {
        if (appContext.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            return Result(false, "call_phone_permission_missing")
        }
        CallRegistry.reserveOutgoing(callId, number)
        return try {
            telecomManager.placeCall(Uri.fromParts("tel", number, null), Bundle())
            Result(true)
        } catch (e: Exception) {
            CallRegistry.cancelOutgoingReservation(callId)
            throw e
        }
    }

    private inline fun withCall(callId: String, action: (Call) -> Result): Result {
        val call = CallRegistry.get(callId) ?: return Result(false, "call_not_found")
        return action(call)
    }

    /** Drugi klic, ki ga Lina nima in je aktiven: odgovor bi ga dal na cakanje. */
    private fun userOwnsOtherActive(exceptCallId: String): Boolean =
        CallRegistry.snapshot().any { entry ->
            entry.callId != exceptCallId &&
                CallCommandPolicy.countsAsOtherUserCall(LinaCallGate.isOwned(entry.callId), phaseOf(entry.call))
        }

    private fun phaseOf(call: Call): TakeoverPhase = TelecomPhase.phase(CallRegistry.androidState(call))

    private fun playDtmfSequence(call: Call, callId: String, digits: String) {
        val epoch = LinaCallGate.dtmfToken()
        fun playAt(index: Int) {
            if (!LinaCallGate.dtmfStill(epoch) || LinaCallGate.isManual(callId)) return
            if (index >= digits.length) return
            call.playDtmfTone(digits[index])
            mainHandler.postDelayed({
                call.stopDtmfTone()
                mainHandler.postDelayed({ playAt(index + 1) }, DTMF_GAP_MS)
            }, DTMF_TONE_MS)
        }
        playAt(0)
    }

    private companion object {
        const val DTMF_TONE_MS = 120L
        const val DTMF_GAP_MS = 70L
    }
}
