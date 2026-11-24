package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import si.safeer.lina.pokaziVarno
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

    /**
     * Ob odprtju aplikacije: samo, ce trenutna razlicica se ni potrjena. Kdaj (enkrat na odprtje, eno okno za drugim) odloca
     * vrsta oken v DialerActivity (VrstaOkenZagona, 24. 11. 2026: opozorilo in Wi-Fi sta bila odprta hkrati).
     */
    fun trebaObOdprtju(): Boolean = shramba.pokazi()

    fun zapri() {
        odprto?.dismiss()
    }

    /** Vedno (Nastavitve > O Lini). [obZaprtju] se poklice, ko se okno zapre (Razumem, Pozneje, nazaj). */
    fun pokazi(obZaprtju: (() -> Unit)? = null) {
        odprto?.takeIf { it.isShowing }?.let { d ->
            obZaprtju?.let { f -> d.setOnDismissListener { f() } }
            return
        }
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
        obZaprtju?.let { f -> b.setOnDismissListener { f() } }
        odprto = b.pokaziVarno()
    }
}
