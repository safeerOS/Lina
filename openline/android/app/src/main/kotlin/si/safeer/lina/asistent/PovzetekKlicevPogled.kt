package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.ZapisKlica
import si.safeer.lina.samostojna.besediloDatotekeKlica
import si.safeer.lina.samostojna.jeKlicZapis
import si.safeer.lina.samostojna.zaKlicNazaj
import si.safeer.lina.samostojna.pozivPovzetkaVsehKlicev
import si.safeer.lina.samostojna.povzetekVsehBrezModela
import si.safeer.lina.samostojna.skupineKlicateljev

/**
 * Sprejeti klici (lastnik 22. 11. 2026: »tako so zapiski, bi lahko bil tudi sprejeti klici«, »ko gor kliknem se mi prikaze dobesedni
 * zapis klica«). Seznam kot Zapiski: datum, besedilo, gumb Izbrisi (po potrditvi); dotik na klic odpre DOBESEDNI zapis klica
 * (klicateljeve besede). Zgoraj gumb »Povzemi vse z Lino«; [povzemi] vrne false, ce Lina nima mozganov ali se caka na odgovor,
 * takrat se pokaze lokalni povzetek.
 */
class PovzetekKlicevPogled(
    private val a: Activity,
    private val povzemi: (prikaz: String, poziv: String, dodatek: String) -> Boolean,
) {
    private val naslov: TextView = a.findViewById(R.id.summaryTitle)
    private val prazno: TextView = a.findViewById(R.id.summaryEmpty)
    private val seznam: LinearLayout = a.findViewById(R.id.summaryList)
    private val gumb: Button = a.findViewById(R.id.summaryAll)

    fun osvezi() {
        var napakaBranja = false
        val zapisi = try { DnevnikKlicevSkupni.dobi(a).seznamPoDatumu(nujniNaVrhu = false) } catch (e: Exception) { napakaBranja = true; emptyList() }
        val klici = si.safeer.lina.ContactSearch(a).dopolniImena(zapisi.filter(::jeKlicZapis).sortedByDescending { it.casZacetka })
        naslov.text = a.getString(R.string.summary_title) + if (klici.isEmpty()) "" else " (" + klici.size + ")"
        prazno.setText(if (napakaBranja) R.string.summary_read_error else R.string.summary_empty)
        prazno.visibility = if (klici.isEmpty()) View.VISIBLE else View.GONE
        gumb.visibility = if (klici.isEmpty()) View.GONE else View.VISIBLE
        gumb.setOnClickListener {
            val skupine = skupineKlicateljev(klici)
            if (!povzemi(a.getString(R.string.summary_all_prompt), pozivPovzetkaVsehKlicev(skupine), zaKlicNazaj(skupine))) {
                AlertDialog.Builder(a)
                    .setTitle(R.string.summary_title)
                    .setMessage(povzetekVsehBrezModela(skupine))
                    .setPositiveButton(android.R.string.ok, null)
                    .show()
            }
        }
        val oblika = java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.MEDIUM, java.time.format.FormatStyle.SHORT)
        seznam.removeAllViews()
        for (z in klici) {
            val kdo = si.safeer.lina.samostojna.imeZaPrikaz(z).let { ime -> if (ime.isBlank()) z.stevilka else "$ime (${z.stevilka.ifBlank { "?" }})" }
            val vrstica = LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL
                isClickable = true
                isFocusable = true
                minimumHeight = (48 * a.resources.displayMetrics.density).toInt()
                setOnClickListener { pokaziDobesedno(z, kdo) }
            }
            val vsebina = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
            vsebina.addView(TextView(a).apply {
                text = oblika.format(java.time.Instant.ofEpochMilli(z.casZacetka).atZone(java.time.ZoneId.systemDefault())) + " · " + kdo
                setTextAppearance(R.style.Gw_Muted)
            })
            vsebina.addView(TextView(a).apply {
                text = z.sporocilo.ifBlank {
                    // Brez sporocila: razlog (»Spodaj je dobesedno ...«) mora imeti pod seboj res dobesedni zapis klicatelja (lastnik 23. 11. 2026, posnetek Sprejetih).
                    val osnova = z.povzetek.ifBlank { z.brezSporocilaRazlog }
                    val dobesedno = z.sporociloDobesedno.replace(Regex("\\s+"), " ").trim()
                    if (z.brezSporocilaRazlog.isNotBlank() && dobesedno.isNotBlank()) osnova + "\n»" + dobesedno + "«" else osnova
                }
                maxLines = 6
                ellipsize = android.text.TextUtils.TruncateAt.END
                setTextAppearance(R.style.Gw_Body)
            })
            vrstica.addView(vsebina, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            vrstica.addView(Button(a, null, 0, R.style.Gw_Button).apply {
                text = a.getString(R.string.local_note_delete)
                setOnClickListener { potrdiBrisanje(z, kdo) }
            })
            seznam.addView(vrstica)
        }
    }

    /** Dobesedni zapis klica (kar je povedal klicatelj, cas, trajanje); besedilo je izbirno za kopiranje. */
    private fun pokaziDobesedno(z: ZapisKlica, kdo: String) {
        val d = AlertDialog.Builder(a)
            .setTitle(kdo)
            .setMessage(besediloDatotekeKlica(z))
            .setNegativeButton(R.string.close, null)
            .show()
        d.findViewById<TextView>(android.R.id.message)?.setTextIsSelectable(true)
    }

    /** Brisanje samo po izrecni potrditvi uporabnika (DnevnikKlicev.izbrisi zahteva potrditev). */
    private fun potrdiBrisanje(z: ZapisKlica, kdo: String) {
        AlertDialog.Builder(a)
            .setTitle(kdo)
            .setMessage(R.string.summary_delete_q)
            .setPositiveButton(R.string.local_note_delete) { _, _ ->
                try { DnevnikKlicevSkupni.dobi(a).izbrisi(z.id, potrditevUporabnika = true) } catch (e: Exception) {
                    android.widget.Toast.makeText(a, R.string.summary_delete_failed, android.widget.Toast.LENGTH_LONG).show()
                }
                osvezi()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }
}
