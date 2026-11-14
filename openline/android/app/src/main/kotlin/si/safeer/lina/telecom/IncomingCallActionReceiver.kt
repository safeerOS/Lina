package si.safeer.lina.telecom

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import si.safeer.lina.protocol.CommandAction
import si.safeer.lina.protocol.GatewayCommand
import java.util.UUID

/** Dejanje »Zavrni« iz obvestila dohodnega klica (N14-4). Gre skozi isto pot kot gumb v vmesniku klica. */
class IncomingCallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return
        CallCommandController(context).performLocal(
            GatewayCommand(commandId = "local_ui_${UUID.randomUUID()}", callId = callId, action = CommandAction.REJECT),
        ) {}
        IncomingCallNotice.cancel(context, callId)
    }

    companion object {
        const val EXTRA_CALL_ID = "call_id"
    }
}
