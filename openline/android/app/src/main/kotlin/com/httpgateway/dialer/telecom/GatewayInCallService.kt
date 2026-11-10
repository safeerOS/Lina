package com.httpgateway.dialer.telecom

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService
import android.telephony.TelephonyManager
import android.util.Log
import com.httpgateway.dialer.InCallActivity
import com.httpgateway.dialer.audio.CallAudioBridge
import com.httpgateway.dialer.config.LinaSettingsStore
import com.httpgateway.dialer.transport.GatewayRuntime
import com.httpgateway.dialer.shell.ShellClient
import com.httpgateway.protocol.EmergencyLock
import com.httpgateway.protocol.EmergencyNote
import com.httpgateway.protocol.CallAudioAction
import com.httpgateway.protocol.CallAudioPolicy
import com.httpgateway.protocol.CallLifecycle
import com.httpgateway.protocol.RingTimeoutGate
import com.httpgateway.protocol.TakeoverDirection
import com.httpgateway.protocol.TakeoverFacts
import com.httpgateway.protocol.TakeoverPhase
import com.httpgateway.protocol.TakeoverPolicy
import com.httpgateway.protocol.TakeoverVerdict
import com.httpgateway.protocol.TelecomPhase
import org.lsposed.hiddenapibypass.HiddenApiBypass

/**
 * Klic najprej zvoni na telefonu. Lina ga prevzame samo, ce je dohoden, se neodgovorjen,
 * potece nastavljeni cas in je stevilka na seznamu. Sicer ni dogodka na streznik
 * in zvok ostane na slusalki (brez enterBackgroundAudioProcessing).
 */
class GatewayInCallService : InCallService() {
    private companion object {
        const val TAG = "GatewayInCallService"
    }

    private val callbacks = mutableMapOf<Call, Call.Callback>()
    private val ringStartedAt = mutableMapOf<String, Long>()
    private val handler = Handler(Looper.getMainLooper())
    private val timers = mutableMapOf<String, Runnable>()

    init {
        // Po uspesnem answer je klic ze lahko ACTIVE. Zvok se sprozi sele, ko je owned.
        LinaCallGate.setOwnedListener { callId ->
            val call = CallRegistry.get(callId) ?: return@setOwnedListener
            syncCallAudio(callId, call)
        }
        // Po koncu tujega klica zajem zadrzanega Lininega klica oceni ista politika na glavni niti.
        CallAudioBridge.setLineRecheck { callId ->
            handler.post { CallRegistry.get(callId)?.let { syncCallAudio(callId, it) } }
        }
    }

    override fun onDestroy() {
        CallAudioBridge.setLineRecheck(null)
        LinaCallGate.setOwnedListener(null)
        super.onDestroy()
    }

    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        val entry = CallRegistry.register(call)
        val callback = object : Call.Callback() {
            override fun onStateChanged(call: Call, state: Int) {
                onCallUpdated(entry.callId, call)
            }

            override fun onDetailsChanged(call: Call, details: Call.Details) {
                if (CallLifecycle.publishWhileAnnounced(LinaCallGate.isAnnounced(entry.callId))) {
                    GatewayRuntime.emitCallState(entry.callId, call)
                }
                CallRegistry.notifyChanged()
            }
        }
        callbacks[call] = callback
        call.registerCallback(callback)
        onCallUpdated(entry.callId, call)
        showInCallUi()
    }

    override fun onCallRemoved(call: Call) {
        val callId = CallRegistry.callIdFor(call)
        callbacks.remove(call)?.let(call::unregisterCallback)
        if (callId != null) {
            cancelTimer(callId)
            ringStartedAt.remove(callId)
            // Vedno, tudi ce je markManual owned ze pobrisal.
            if (CallLifecycle.stopCaptureOnRemoved(LinaCallGate.isOwned(callId), LinaCallGate.isManual(callId))) {
                CallAudioBridge.onCallEnded(callId)
            }
            val linaOwned = LinaCallGate.isOwned(callId)
            val linaAnnounced = LinaCallGate.isAnnounced(callId)
            if (CallLifecycle.emitRemoval(linaOwned, linaAnnounced)) {
                GatewayRuntime.emitCallRemoved(callId, call)
            }
            LinaCallGate.clear(callId)
        }
        CallRegistry.remove(call)
        super.onCallRemoved(call)
    }

    private fun onCallUpdated(callId: String, call: Call) {
        val phase = phaseOf(call)
        if (EmergencyNote.record(
                outgoing = directionOf(call) == TakeoverDirection.OUTGOING,
                listedEmergency = TakeoverPolicy.isEmergency(numberOf(call)),
                carrierEmergency = carrierEmergency(numberOf(call)),
            )
        ) {
            noteEmergency(System.currentTimeMillis())
        }
        if (phase == TakeoverPhase.ACTIVE && !LinaCallGate.isOwned(callId)) {
            if (!LinaCallGate.confirmOwnedOnActive(callId)) {
                handler.post {
                    if (!LinaCallGate.isOwned(callId) && !LinaCallGate.isManual(callId)) {
                        if (LinaCallGate.markManual(callId)) {
                            CallAudioBridge.onCallEnded(callId)
                            GatewayRuntime.notifyCallEnded(callId)
                        }
                    }
                }
            }
            cancelTimer(callId)
        }
        if (phase == TakeoverPhase.ENDED) cancelTimer(callId)
        if (phase == TakeoverPhase.RINGING && !LinaCallGate.isManual(callId) && !LinaCallGate.isOwned(callId)) {
            armRingTimer(callId, call)
        }
        if (CallLifecycle.publishWhileAnnounced(LinaCallGate.isAnnounced(callId))) {
            GatewayRuntime.emitCallState(callId, call)
        }
        syncCallAudio(callId, call)
        CallRegistry.notifyChanged()
    }

    /** Ob poteku casa ponovno preveri seznam, smer in ali je klic se neodgovorjen. */
    private fun onRingTimeout(callId: String) {
        timers.remove(callId)
        val call = CallRegistry.get(callId) ?: return
        when (val verdict = evaluate(callId, call)) {
            TakeoverVerdict.TAKE -> Thread {
                val fresh = runCatching { ShellClient(this).ping() != null }.getOrDefault(false)
                handler.post {
                    val still = CallRegistry.get(callId) ?: return@post
                    if (!RingTimeoutGate.admit(verdict, fresh, GatewayRuntime.isConnected(), evaluate(callId, still))) {
                        return@post
                    }
                    LinaCallGate.announce(callId)
                    GatewayRuntime.emitCallAdded(callId, still)
                }
            }.start()
            TakeoverVerdict.WAIT -> armRingTimer(callId, call, reschedule = true)
            TakeoverVerdict.REFUSE -> Unit
        }
    }

    private fun armRingTimer(callId: String, call: Call, reschedule: Boolean = false) {
        if (LinaCallGate.isAnnounced(callId) || LinaCallGate.isOwned(callId) || LinaCallGate.isManual(callId)) return
        if (!reschedule && timers.containsKey(callId)) return
        if (evaluate(callId, call) == TakeoverVerdict.REFUSE) return
        ringStartedAt.putIfAbsent(callId, SystemClock.elapsedRealtime())
        val elapsed = SystemClock.elapsedRealtime() - (ringStartedAt[callId] ?: SystemClock.elapsedRealtime())
        val timeoutMs = LinaSettingsStore(this).load().ringTimeoutSec * 1_000L
        val delay = (timeoutMs - elapsed).coerceAtLeast(250L)
        cancelTimer(callId)
        val runnable = Runnable { onRingTimeout(callId) }
        timers[callId] = runnable
        handler.postDelayed(runnable, delay)
    }

    private fun evaluate(callId: String, call: Call): TakeoverVerdict {
        val settings = LinaSettingsStore(this).load()
        val started = ringStartedAt[callId]
        val elapsed = if (started == null) 0L else SystemClock.elapsedRealtime() - started
        val number = call.details.handle?.schemeSpecificPart.orEmpty()
        return TakeoverPolicy.evaluate(
            TakeoverFacts(
                direction = directionOf(call),
                phase = phaseOf(call),
                manuallyAnswered = LinaCallGate.isManual(callId),
                ringingForMs = elapsed,
                ringTimeoutMs = settings.ringTimeoutSec * 1_000L,
                number = number,
                allowlist = settings.allowlist,
                allowlistEnabled = settings.allowlistEnabled,
                carrierEmergency = carrierEmergency(number),
                userCallActive = CallLine.userHasOtherLiveCall(callId),
                emergencyCallback = emergencyCallback(call),
                emergencyCooldown = TakeoverPolicy.inEmergencyCooldown(emergencyAt(), System.currentTimeMillis()),
                externalPickup = RouteGuard.externalPickup,
            ),
        )
    }

    /**
     * Zvocno obdelavo v ozadju zazene samo prevzet klic. Ob HOLDING in ob tujem
     * aktivnem klicu se zajem ustavi, da zvok klica B ne gre na streznik.
     */
    private fun syncCallAudio(callId: String, call: Call) {
        val otherLive = CallLine.userHasOtherLiveCall(callId)
        when (CallAudioPolicy.action(LinaCallGate.isOwned(callId), CallLine.audioState(call), otherLive)) {
            CallAudioAction.START -> startOwnedAudio(callId, call)
            CallAudioAction.STOP -> {
                // Linin klic ostane Linin (cakanje, uporabnikov klic): zajem se zadrzi, ne konca.
                if (LinaCallGate.isOwned(callId)) CallAudioBridge.onCallSuspended(callId)
                else CallAudioBridge.onUnsafeDownlink()
            }
            CallAudioAction.LEAVE -> Unit
        }
    }

    private fun startOwnedAudio(callId: String, call: Call) {
        if (!LinaCallGate.isOwned(callId)) return
        when (CallRegistry.androidState(call)) {
            Call.STATE_ACTIVE -> {
                val routed = runCatching { enterBackgroundAudioProcessing(call) }
                    .onFailure { Log.w(TAG, "background audio processing refused for $callId", it) }
                    .isSuccess
                if (!routed) CallAudioBridge.onCallActive(callId)
            }
            Call.STATE_AUDIO_PROCESSING -> CallAudioBridge.onCallActive(callId)
        }
    }

    /** `Call.enterBackgroundAudioProcessing()` je @SystemApi; Telecom zahteva privzeti klicnik. */
    private fun enterBackgroundAudioProcessing(call: Call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) HiddenApiBypass.addHiddenApiExemptions("Landroid/telecom/Call;")
        Call::class.java.getMethod("enterBackgroundAudioProcessing").invoke(call)
    }

    private fun noteEmergency(nowEpochMs: Long) {
        getSharedPreferences(EmergencyLock.PREFS, MODE_PRIVATE)
            .edit()
            .putLong(EmergencyLock.KEY_EPOCH_MS, nowEpochMs)
            .apply()
    }

    /** Preberi shranjeno epohu. Polje storitve se ob ponovnem zagonu izgubi. */
    private fun emergencyAt(): Long? =
        EmergencyLock.read(
            getSharedPreferences(EmergencyLock.PREFS, MODE_PRIVATE).getLong(EmergencyLock.KEY_EPOCH_MS, 0L),
        )

    private fun cancelTimer(callId: String) {
        timers.remove(callId)?.let(handler::removeCallbacks)
    }

    private fun showInCallUi() {
        startActivity(
            Intent(this, InCallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
    }

    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        super.onCallAudioStateChanged(audioState)
        val mask = audioState.supportedRouteMask
        val wiredOrBt = (mask and (CallAudioState.ROUTE_BLUETOOTH or CallAudioState.ROUTE_WIRED_HEADSET)) != 0
        val car = (resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_CAR
        RouteGuard.externalPickup = wiredOrBt || car
    }

    private fun numberOf(call: Call): String = call.details.handle?.schemeSpecificPart.orEmpty()

    private fun emergencyCallback(call: Call): Boolean = runCatching {
        val field = Call.Details::class.java.getField("PROPERTY_EMERGENCY_CALLBACK_MODE")
        call.details.hasProperty(field.getInt(null))
    }.getOrDefault(false)

    private fun phaseOf(call: Call): TakeoverPhase = TelecomPhase.phase(CallRegistry.androidState(call))

    private fun directionOf(call: Call): TakeoverDirection = when (call.details.callDirection) {
        Call.Details.DIRECTION_INCOMING -> TakeoverDirection.INCOMING
        Call.Details.DIRECTION_OUTGOING -> TakeoverDirection.OUTGOING
        else -> TakeoverDirection.UNKNOWN
    }

    private fun carrierEmergency(number: String): Boolean {
        if (number.isBlank()) return false
        val telephony = getSystemService(TelephonyManager::class.java) ?: return false
        return runCatching { telephony.isEmergencyNumber(number) }.getOrDefault(false)
    }
}
