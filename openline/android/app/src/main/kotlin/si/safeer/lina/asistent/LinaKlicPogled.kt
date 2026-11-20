package si.safeer.lina.asistent

import android.app.AlertDialog
import android.content.Context
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.ZapisKlica
import si.safeer.lina.samostojna.besediloDatotekeKlica
import si.safeer.lina.samostojna.povzetekDomov

/**
 * Klici, ki jih je sprejela Lina (lastnik 20. 11. 2026): kartica »Lina je odgovorila na N klicev« in seznam z imenom, stevilko,
 * casom in sporocilom klicatelja. Bere samo lokalni dnevnik klicev, zato deluje brez racunalnika. Sistemski zapisi (napake povezave)
 * se ne prikazujejo kot klici.
 */
class LinaKlicPogled(private val a: Context) {
    val pogled: LinearLayout = LinearLayout(a, null, 0, R.style.Gw_Panel).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }

    private fun jeKlic(z: ZapisKlica) = !z.id.startsWith("sys-") && z.stevilka != "Sistem"

    /** Klicati z glavne niti ob prikazu zavihka. */
    fun osvezi() {
        val zapisi = runCatching { DnevnikKlicevSkupni.dobi(a).seznamPoDatumu(nujniNaVrhu = false) }
            .getOrDefault(emptyList()).filter(::jeKlic)
        pogled.removeAllViews()
        if (zapisi.isEmpty()) { pogled.visibility = View.GONE; return }
        pogled.visibility = View.VISIBLE
        val teden = System.currentTimeMillis() - 7L * 24 * 3600 * 1000
        val naslov = povzetekDomov(zapisi, teden).naslov.ifEmpty { a.getString(R.string.lina_calls_title) }
        pogled.addView(TextView(a).apply {
            setTextAppearance(R.style.Gw_Body); text = naslov; typeface = android.graphics.Typeface.DEFAULT_BOLD
            isAccessibilityHeading = true
        })
        val izvoz = KlicIzvoz(a)
        pogled.addView(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); text = a.getString(R.string.lina_calls_folder_fmt, izvoz.opis()) })
        val oblika = ZapiskiIzvoz(a)
        for (z in zapisi.take(20)) {
            val ime = z.klicatelj.ifBlank { a.getString(R.string.lina_calls_unknown) }
            val sporocilo = z.sporocilo.ifBlank { z.brezSporocilaRazlog }
            pogled.addView(TextView(a).apply {
                setTextAppearance(R.style.Gw_Body)
                text = "${oblika.oblikaCasa(z.casZacetka)}\n$ime · ${z.stevilka}" +
                    (if (z.podjetje.isNotBlank()) " · ${z.podjetje}" else "") +
                    (if (sporocilo.isNotBlank()) "\n$sporocilo" else "")
                setPadding(0, 16, 0, 16)
                minimumHeight = (48 * a.resources.displayMetrics.density).toInt()
                isClickable = true
                setOnClickListener { pokaziPodrobnosti(z) }
            })
        }
    }

    private fun pokaziPodrobnosti(z: ZapisKlica) {
        AlertDialog.Builder(a)
            .setMessage(besediloDatotekeKlica(z))
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }
}
