package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import si.safeer.lina.pokaziVarno
import android.content.ActivityNotFoundException
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.soglasja.VrstaDejanja

/**
 * Nastavitve > Dokumenti: stikalo (privzeto vklopljeno), izbira mape, ponovno indeksiranje in brisanje indeksa.
 * Vsako dejanje sprozi uporabnik z dotikom; brisanje vedno vprasa znova (BRISANJE_PODATKOV je v skupnem modulu soglasij
 * visoko tveganje, zato trajnega soglasja »velja za vse podobne« zanj ni).
 */
class DokumentiPogled(private val a: Activity, private val plosca: LinearLayout) {
    private val glavna = Handler(Looper.getMainLooper())
    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()
    private fun <T : View> dodaj(v: T, zgoraj: Int = 8): T = v.also {
        plosca.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) })
    }

    private val stikalo = dodaj(Switch(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.docs_switch); minHeight = dp(48) }, 12)
    init { dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.docs_info) }) }
    private val mapa = dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Body) })
    private val stanje = dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE })
    private val izberi = dodaj(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.docs_pick) })
    private val znova = dodaj(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.docs_reindex) })
    private val izbrisi = dodaj(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.docs_delete) })
    private var napredek: Int? = null

    init {
        stikalo.isChecked = DokumentiLokalno.vklopljeno(a)
        stikalo.setOnCheckedChangeListener { _, v -> DokumentiLokalno.nastaviVklopljeno(a, v); osvezi() }
        izberi.setOnClickListener {
            try { a.startActivityForResult(DokumentiLokalno.izbiraMape(), DokumentiLokalno.ZAHTEVA_MAPA) }
            catch (_: ActivityNotFoundException) { sporoci(R.string.notes_storage_no_picker) }
        }
        znova.setOnClickListener { indeksiraj() }
        izbrisi.setOnClickListener { potrdiBrisanje() }
        osvezi()
    }

    /** Rezultat izbirnika mape (DialerActivity.onActivityResult): izbira mape je uporabnikova potrditev za branje te mape. */
    fun obdelajMapo(uri: Uri) {
        if (DokumentiLokalno.indeksiram) return
        if (!DokumentiLokalno.nastaviMapo(a, uri)) { osvezi(); sporoci(R.string.docs_folder_fail); return }
        indeksiraj()
    }

    private fun indeksiraj() {
        if (DokumentiLokalno.indeksiram || DokumentiLokalno.mapa(a) == null) return
        napredek = 0
        osvezi()
        val ac = a.applicationContext
        DokumentiLokalno.nit.execute {
            runCatching { DokumentiLokalno.indeksiraj(ac) { n -> glavna.post { napredek = n; if (!a.isFinishing) osvezi() } } }
            glavna.post { napredek = null; if (!a.isFinishing) osvezi() }
        }
    }

    private fun potrdiBrisanje() {
        // visoko tveganje: vedno potrditev, nikoli trajno soglasje (skupni modul soglasij)
        check(VrstaDejanja.BRISANJE_PODATKOV.visokoTveganje)
        AlertDialog.Builder(a)
            .setTitle(R.string.docs_delete_title)
            .setMessage(R.string.docs_delete_msg)
            .setPositiveButton(R.string.docs_delete_ok) { _, _ ->
                val ac = a.applicationContext
                DokumentiLokalno.nit.execute {
                    runCatching { DokumentiLokalno.izbrisi(ac) }
                    glavna.post { if (!a.isFinishing) { osvezi(); sporoci(R.string.docs_deleted) } }
                }
            }
            .setNegativeButton(R.string.local_event_cancel, null)
            .pokaziVarno()
    }

    /** Kratko sporocilo pod mapo (vidno tudi, ce je bilo polje skrito). */
    private fun sporoci(niz: Int) {
        stanje.text = a.getString(niz)
        stanje.visibility = View.VISIBLE
    }

    fun osvezi() {
        val vklop = DokumentiLokalno.vklopljeno(a)
        val m = DokumentiLokalno.opisMape(a)
        mapa.text = if (m == null) a.getString(R.string.docs_folder_none) else a.getString(R.string.docs_folder_fmt, m)
        val st = DokumentiLokalno.stanje(a)
        val n = napredek
        stanje.text = when {
            n != null -> a.getString(R.string.docs_status_running, n)
            st == null -> ""
            else -> a.getString(R.string.docs_status_fmt, st.datotek, java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(st.casMs))) +
                if (st.napak > 0) "\n" + a.getString(R.string.docs_status_errors_fmt, st.napak) else ""
        }
        stanje.visibility = if (stanje.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        // tudi po ponovnem ustvarjanju zaslona: indeksiranje na niti bere z dovoljenjem trenutne mape
        val prosto = n == null && !DokumentiLokalno.indeksiram
        izberi.isEnabled = vklop && prosto
        znova.visibility = if (m != null) View.VISIBLE else View.GONE
        znova.isEnabled = vklop && prosto
        izbrisi.visibility = if (m != null || st != null) View.VISIBLE else View.GONE
        izbrisi.isEnabled = prosto
    }
}
