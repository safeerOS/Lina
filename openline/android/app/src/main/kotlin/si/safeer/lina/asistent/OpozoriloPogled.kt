package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import si.safeer.lina.R
import si.safeer.lina.config.OpozoriloShramba
import si.safeer.lina.samostojna.OpozoriloLine

/**
 * Opozorilo ob prvem zagonu (lastnik 24. 11. 2026) in Nastavitve > O Lini. Okno se pokaze ob vsakem odprtju, dokler trenutna
 * razlicica besedila ni potrjena. Varovalo ni tu: klice zapre GatewayInCallService/CallCommandController, naloge in gradnje
 * Podpisnik (OpozoriloLine); to je samo pogled.
 */
class OpozoriloPogled(private val a: Activity) {
    private val shramba = OpozoriloShramba(a)
    private var odprto: AlertDialog? = null

    private var zePokazano = false

    /** Ob odprtju aplikacije (enkrat na odprtje, ne ob vsakem vracanju iz nastavitev): samo, ce trenutna razlicica se ni potrjena. */
    fun obOdprtju() {
        if (zePokazano || !shramba.pokazi()) return
        zePokazano = true
        pokazi()
    }

    /** Vedno (Nastavitve > O Lini). */
    fun pokazi() {
        if (odprto?.isShowing == true) return
        val potrjena = shramba.potrjena()
        val sporocilo = buildString {
            append(a.getString(R.string.first_run_body))
            append("\n\n")
            append(if (potrjena == OpozoriloLine.RAZLICICA) a.getString(R.string.first_run_confirmed, potrjena) else a.getString(R.string.first_run_until))
        }
        val b = AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.first_run_title)
            .setMessage(sporocilo)
        if (potrjena == OpozoriloLine.RAZLICICA) {
            b.setPositiveButton(android.R.string.ok, null)
        } else {
            b.setPositiveButton(R.string.first_run_ok) { _, _ -> shramba.potrdi() }
                .setNegativeButton(R.string.first_run_later, null)
        }
        odprto = b.show()
    }
}
