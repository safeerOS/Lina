package si.safeer.lina.telecom

import android.content.Context
import android.telecom.Call
import si.safeer.lina.config.LinaSettingsStore
import si.safeer.lina.protocol.LineGate

/**
 * Ena preverba linije za prevzem po casu zvonjenja (GatewayInCallService) in za oddaljeni ANSWER (CallCommandController):
 * Lina prevzame samo klic na liniji, ki jo je uporabnik izbral (ali edini aktivni). Napaka pri branju = ne.
 */
object LinaLine {
    fun allowed(context: Context, call: Call): Boolean = try {
        val store = LinaSettingsStore(context)
        val key = store.lineIdKey() ?: return false
        val source = LineSource(context, key)
        LineGate.allows(source.getLines(), store.load().selectedLineId, source.idOf(call.details.accountHandle))
    } catch (_: RuntimeException) {
        false
    }
}
