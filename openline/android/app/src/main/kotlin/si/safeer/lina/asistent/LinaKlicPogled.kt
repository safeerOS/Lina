package si.safeer.lina.asistent

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.SkupinaKlicatelja
import si.safeer.lina.samostojna.ZapisKlica
import si.safeer.lina.samostojna.besediloDatotekeKlica
import si.safeer.lina.samostojna.povzetekDomov
import si.safeer.lina.samostojna.povzetekKlicateljaBrezModela
import si.safeer.lina.samostojna.pozivPovzetkaKlicatelja
import si.safeer.lina.samostojna.skupineKlicateljev

/**
 * Klici, ki jih je sprejela Lina (lastnik 20. in 22. 11. 2026): kartica »Lina je odgovorila na N klicev«, mapa z datoteko za vsak
 * klic (»Odpri mapo« jo odpre v aplikaciji Datoteke) in seznam po klicateljih: isti klicatelj (ista stevilka v kateremkoli zapisu
 * ali skrita stevilka z istim imenom) je ena vrstica s stevilom klicev; »Povzetek vseh sporocil« ga pripravi Lina v Pogovoru,
 * brez kljuca pa pokaze lokalni povzetek. Bere samo lokalni dnevnik klicev, zato deluje brez racunalnika.
 */
class LinaKlicPogled(
    private val a: Context,
    /** Poslje povzetek v Pogovor (prikaz, poziv); vrne false, ce Lina nima mozganov (takrat lokalni povzetek). */
    private val povzetek: (String, String) -> Boolean = { _, _ -> false },
) {
    val pogled: LinearLayout = LinearLayout(a, null, 0, R.style.Gw_Panel).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }

    private val dp = a.resources.displayMetrics.density
    private var skupine: List<SkupinaKlicatelja> = emptyList()

    /** Klicati z glavne niti ob prikazu zavihka. */
    fun osvezi() {
        val zapisi = runCatching { DnevnikKlicevSkupni.dobi(a).seznamPoDatumu(nujniNaVrhu = false) }.getOrDefault(emptyList())
        skupine = skupineKlicateljev(zapisi)
        pogled.removeAllViews()
        if (skupine.isEmpty()) { pogled.visibility = View.GONE; return }
        pogled.visibility = View.VISIBLE
        val klici = skupine.flatMap { it.klici }
        val teden = System.currentTimeMillis() - 7L * 24 * 3600 * 1000
        val naslov = povzetekDomov(klici, teden).naslov.ifEmpty { a.getString(R.string.lina_calls_title) }
        pogled.addView(TextView(a).apply {
            setTextAppearance(R.style.Gw_Body); text = naslov; typeface = android.graphics.Typeface.DEFAULT_BOLD
            isAccessibilityHeading = true
        })
        // Mapa z datotekami klicev: pot in gumb, ki jo odpre (lastnik 22. 11. 2026).
        val vrsticaMape = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        vrsticaMape.addView(TextView(a).apply {
            setTextAppearance(R.style.Gw_Muted); text = a.getString(R.string.lina_calls_folder_fmt, KlicIzvoz(a).opis())
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        vrsticaMape.addView(Button(a, null, 0, R.style.Gw_Button).apply {
            setText(R.string.lina_calls_open_folder)
            setOnClickListener { odpriMapo() }
        })
        pogled.addView(vrsticaMape)
        val oblika = ZapiskiIzvoz(a)
        for (s in skupine.take(30)) {
            val zadnji = s.klici.first()
            val ime = s.ime.ifBlank { a.getString(R.string.lina_calls_unknown) }
            val sporocilo = zadnji.sporocilo.ifBlank { zadnji.brezSporocilaRazlog }
            val stevec = if (s.klici.size > 1) a.getString(R.string.lina_calls_count_fmt, s.klici.size) + " · " else ""
            pogled.addView(TextView(a).apply {
                setTextAppearance(R.style.Gw_Body)
                text = "$ime · ${s.stevilka}" +
                    (if (zadnji.podjetje.isNotBlank()) " · ${zadnji.podjetje}" else "") +
                    "\n$stevec${oblika.oblikaCasa(zadnji.casZacetka)}" +
                    (if (sporocilo.isNotBlank()) "\n$sporocilo" else "")
                setPadding(0, (12 * dp).toInt(), 0, (12 * dp).toInt())
                minimumHeight = (48 * dp).toInt()
                maxLines = 4
                ellipsize = android.text.TextUtils.TruncateAt.END
                isClickable = true
                isFocusable = true
                setOnClickListener { pokaziKlicatelja(s) }
            })
        }
    }

    /** Odpre skupino klicatelja (iz obvestila po klicu). */
    fun odpriKlicatelja(idKlica: String) {
        if (skupine.isEmpty()) osvezi()
        skupine.firstOrNull { s -> s.klici.any { it.id == idKlica } }?.let(::pokaziKlicatelja)
    }

    private fun pokaziKlicatelja(s: SkupinaKlicatelja) {
        val oblika = ZapiskiIzvoz(a)
        val besedilo = if (s.klici.size == 1) besediloDatotekeKlica(s.klici.first()) else buildString {
            for (z in s.klici.take(20)) {
                appendLine(oblika.oblikaCasa(z.casZacetka) + (if (z.nujno) " · " + a.getString(R.string.lina_calls_urgent) else ""))
                appendLine(z.sporocilo.ifBlank { z.povzetek }.ifBlank { z.brezSporocilaRazlog }.trim())
                appendLine()
            }
        }.trim()
        val naslov = s.ime.ifBlank { a.getString(R.string.lina_calls_unknown) } + " · " + s.stevilka
        val d = AlertDialog.Builder(a)
            .setTitle(naslov)
            .setMessage(besedilo)
            .setNegativeButton(R.string.close, null)
        if (s.klici.size > 1) d.setPositiveButton(R.string.lina_calls_summary) { _, _ -> povzemi(s) }
        d.show()
    }

    private fun povzemi(s: SkupinaKlicatelja) {
        val prikaz = a.getString(R.string.lina_calls_summary_prompt_fmt, s.ime.ifBlank { s.stevilka.ifBlank { a.getString(R.string.lina_calls_unknown) } })
        if (povzetek(prikaz, pozivPovzetkaKlicatelja(s))) return
        AlertDialog.Builder(a)
            .setTitle(R.string.lina_calls_summary)
            .setMessage(povzetekKlicateljaBrezModela(s))
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    /**
     * Mapa klicev v aplikaciji Datoteke: izbrana mapa (drevo SAF) ali privzeta Dokumenti/Lina/Klici. ACTION_VIEW z vrsto mape
     * odpre sistemsko aplikacijo Datoteke (preverjeno na WP28 S 22. 11. 2026); ce je ni, pove pot.
     */
    private fun odpriMapo() {
        val izbrana = ZapiskiIzvoz(a).mapa()
        val uri: Uri = izbrana?.let { DocumentsContract.buildDocumentUriUsingTree(it, DocumentsContract.getTreeDocumentId(it)) }
            ?: DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:" + KlicIzvoz.PRIVZETA_MAPA.trimEnd('/'))
        val namen = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            a.startActivity(namen)
        } catch (e: ActivityNotFoundException) {
            neOdpre()
        } catch (e: SecurityException) {
            neOdpre()
        }
    }

    private fun neOdpre() {
        AlertDialog.Builder(a)
            .setMessage(a.getString(R.string.lina_calls_open_fail_fmt, KlicIzvoz(a).opis()))
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }
}
