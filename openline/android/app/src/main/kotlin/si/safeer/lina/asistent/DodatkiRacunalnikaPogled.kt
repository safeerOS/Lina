package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.podpis.DodatekRacunalnika
import si.safeer.lina.podpis.DodatkiLine
import si.safeer.lina.podpis.IzidDodatkov
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NapakaDodatkov
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.NiziLine
import si.safeer.lina.samostojna.PrenosPoPoti

/**
 * »Dodatki na racunalniku« v zavihku Racunalnik (lastnik 23. 11. 2026): stanje in stikala za Paperclip, n8n, AFFiNE in slovenski
 * model na seznanjenem racunalniku, prek iste povezave kot naloge (IzbirnaPovezava) in s podpisom naprave. Vsa logika (nizi, telesa,
 * razclenitev, napake) je v modulu podpis (DodatkiLine, preizkusi); tu samo pogledi in niti. Omrezje in KeyStore nikoli na glavni niti.
 */
class DodatkiRacunalnikaPogled(private val a: Activity, starsi: LinearLayout) {
    private val glavna = Handler(Looper.getMainLooper())
    private val prenos = PrenosPoPoti()
    private val koren = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
    private val stanje = TextView(a, null, 0, R.style.Gw_Muted).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    private val vrstice = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val stikala = mutableMapOf<String, Switch>()
    private val opisi = mutableMapOf<String, TextView>()
    @Volatile private var dela = false

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    init {
        koren.addView(TextView(a, null, 0, R.style.Gw_Heading).apply {
            setText(R.string.addons_title); isAccessibilityHeading = true; setPadding(0, dp(16), 0, 0)
        })
        koren.addView(TextView(a, null, 0, R.style.Gw_Muted).apply { setText(R.string.addons_desc) })
        koren.addView(stanje)
        for (id in NiziLine.DODATKI) {
            val st = Switch(a).apply {
                text = ime(id); minHeight = dp(48); isEnabled = false
                setOnClickListener { obKliku(id, isChecked) }
            }
            val op = TextView(a, null, 0, R.style.Gw_Muted)
            stikala[id] = st; opisi[id] = op
            vrstice.addView(st); vrstice.addView(op)
        }
        koren.addView(vrstice)
        koren.addView(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.addons_refresh); setOnClickListener { osvezi() } })
        starsi.addView(koren)
    }

    private fun ime(id: String): String = a.getString(when (id) {
        "paperclip" -> R.string.addon_paperclip
        "n8n" -> R.string.addon_n8n
        "affine" -> R.string.addon_affine
        else -> R.string.addon_slovenski
    })

    private fun opisStanja(d: DodatekRacunalnika): String {
        val s = a.getString(when (d.stanje) {
            "deluje" -> R.string.addon_state_running
            "se_zaganja" -> R.string.addon_state_starting
            "napaka" -> R.string.addon_state_error
            "ni_na_voljo" -> R.string.addon_state_unavailable
            else -> R.string.addon_state_off
        })
        return if (d.razlog.isNotEmpty()) "$s (${d.razlog})" else s
    }

    private fun sporocilo(n: NapakaDodatkov): Int = when (n) {
        NapakaDodatkov.NEDOSEGLJIV -> R.string.addons_err_unreachable
        NapakaDodatkov.ZAVRNJENO -> R.string.addons_err_denied
        NapakaDodatkov.PREVEC -> R.string.addons_err_busy
        NapakaDodatkov.STARA_LINA -> R.string.addons_err_old
        NapakaDodatkov.NAPAKA -> R.string.addons_err_generic
    }

    private fun povezava(): IzbirnaPovezava? = AsistentShramba.beri(a)?.let { IzbirnaPovezava(HttpPovezavaZLino(it), null, null, prenos) }

    /** Izvede klic na Lino v ozadju; [delo] dobi povezavo in id naprave. Ena zahteva naenkrat. */
    private fun vOzadju(delo: (IzbirnaPovezava, String) -> IzidDodatkov, obNeuspehu: () -> Unit = {}) {
        if (dela) return
        dela = true
        for (s in stikala.values) s.isEnabled = false
        stanje.setText(R.string.addons_loading)
        Thread({
            val pov = povezava()
            val izid = try {
                val id = runCatching { NapravaKljuc.id() }.getOrNull()
                if (pov == null || id == null) IzidDodatkov.Napaka(NapakaDodatkov.NEDOSEGLJIV) else delo(pov, id)
            } catch (_: Exception) {
                IzidDodatkov.Napaka(NapakaDodatkov.NAPAKA)
            } finally {
                pov?.zapri()
            }
            glavna.post {
                dela = false
                when (izid) {
                    is IzidDodatkov.Ok -> prikazi(izid.dodatki)
                    is IzidDodatkov.Napaka -> {
                        obNeuspehu()
                        stanje.setText(sporocilo(izid.vrsta))
                        // stikala ostanejo onemogocena, dokler stanje ni znano (brez ugibanja); Osvezi poskusi znova
                    }
                }
            }
        }, "lina-dodatki").start()
    }

    private fun prikazi(dodatki: List<DodatekRacunalnika>) {
        stanje.text = ""
        for (d in dodatki) {
            stikala[d.id]?.apply { isChecked = d.vklopljen; isEnabled = d.stanje != "ni_na_voljo" }
            opisi[d.id]?.text = opisStanja(d)
        }
    }

    /** Pokaze razdelek samo, ce je telefon seznanjen z racunalnikom, in prebere stanje. */
    fun osvezi() {
        val seznanjen = AsistentShramba.beri(a) != null
        koren.visibility = if (seznanjen) View.VISIBLE else View.GONE
        if (!seznanjen) return
        vOzadju({ pov, id ->
            DodatkiLine.stanje(pov, id, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { c, e -> NapravaKljuc.podpisiStanjeDodatkov(c, e) }
        })
    }

    private fun obKliku(id: String, vklop: Boolean) {
        val st = stikala[id] ?: return
        // Slovenski model: prvi vklop prenese ~1,6 GB; najprej pojasnilo, vklop sele po izrecni potrditvi (kot v namiznih Dodatkih).
        if (id == "slovenski" && vklop) {
            AlertDialog.Builder(a, R.style.Gw_Dialog)
                .setTitle(R.string.addon_slovenski)
                .setMessage(R.string.addon_slovenski_explain)
                .setPositiveButton(R.string.addons_turn_on) { _, _ -> preklopi(id, true) }
                .setNegativeButton(android.R.string.cancel) { _, _ -> st.isChecked = false }
                .setOnCancelListener { st.isChecked = false }
                .show()
            return
        }
        preklopi(id, vklop)
    }

    private fun preklopi(id: String, vklop: Boolean) {
        vOzadju({ pov, naprava ->
            DodatkiLine.preklopi(pov, naprava, id, vklop, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { d, v, c, e ->
                NapravaKljuc.podpisiDodatek(d, v, c, e)
            }
        }, obNeuspehu = { stikala[id]?.isChecked = !vklop })
    }
}
