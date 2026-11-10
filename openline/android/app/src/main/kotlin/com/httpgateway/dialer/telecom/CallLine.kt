package com.httpgateway.dialer.telecom

import android.telecom.Call
import com.httpgateway.protocol.AudioCallState
import com.httpgateway.protocol.CallLineFacts
import com.httpgateway.protocol.LineCall

/**
 * Dejstva o liniji iz Telecoma. En vir za storitev klicev in za zajem: start preveri
 * isti pogoj kot CallAudioPolicy tik pred klicem lupine in po njem (N11-2).
 */
object CallLine {
    /** Posnetek registra. Vse odlocitve nad njim so v CallLineFacts (protocol, s preizkusi). */
    fun snapshot(): List<LineCall> = CallRegistry.snapshot().map { entry ->
        LineCall(entry.callId, LinaCallGate.isOwned(entry.callId), CallRegistry.androidState(entry.call))
    }

    fun audioState(call: Call): AudioCallState = CallLineFacts.audioState(CallRegistry.androidState(call))

    fun userHasOtherLiveCall(exceptCallId: String): Boolean =
        CallLineFacts.otherLiveNotLina(snapshot(), exceptCallId)

    /** Klic, ki Lininemu klicu zasede linijo. Dohodni klic, ki samo zvoni, je ne zasede. */
    fun blocksCapture(exceptCallId: String): Boolean = CallLineFacts.blocksCapture(snapshot(), exceptCallId)

    fun permitsCapture(callId: String): Boolean = CallLineFacts.permitsCapture(snapshot(), callId)
}
