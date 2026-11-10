package com.httpgateway.dialer.telecom

import android.telecom.Call
import com.httpgateway.protocol.AudioCallState
import com.httpgateway.protocol.CallCommandPolicy
import com.httpgateway.protocol.CapturePermit
import com.httpgateway.protocol.TelecomPhase

/**
 * Dejstva o liniji iz Telecoma. En vir za storitev klicev in za zajem: start preveri
 * isti pogoj kot CallAudioPolicy tik pred klicem lupine in po njem (N11-2).
 */
object CallLine {
    fun audioState(call: Call): AudioCallState = when (CallRegistry.androidState(call)) {
        Call.STATE_ACTIVE -> AudioCallState.ACTIVE
        Call.STATE_HOLDING -> AudioCallState.HOLDING
        Call.STATE_AUDIO_PROCESSING -> AudioCallState.AUDIO_PROCESSING
        Call.STATE_DISCONNECTING, Call.STATE_DISCONNECTED -> AudioCallState.ENDING
        else -> AudioCallState.OTHER
    }

    /** Drug klic, ki ni Linin in ni koncan, tudi ce se se klica. */
    fun userHasOtherLiveCall(exceptCallId: String): Boolean =
        CallRegistry.snapshot().any { entry ->
            entry.callId != exceptCallId &&
                CallCommandPolicy.countsAsOtherUserCall(
                    LinaCallGate.isOwned(entry.callId),
                    TelecomPhase.phase(CallRegistry.androidState(entry.call)),
                )
        }

    fun permitsCapture(callId: String): Boolean = CapturePermit.allowed(
        ownedByLina = LinaCallGate.isOwned(callId),
        state = CallRegistry.get(callId)?.let(::audioState),
        otherLiveNotLina = userHasOtherLiveCall(callId),
    )
}
