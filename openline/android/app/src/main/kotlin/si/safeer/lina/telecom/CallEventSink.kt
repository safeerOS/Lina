package si.safeer.lina.telecom

import android.telecom.Call

interface CallEventSink {
    fun emitCallAdded(callId: String, call: Call)
    fun emitCallRemoved(callId: String, call: Call)
    fun emitCallState(callId: String, call: Call)
}
