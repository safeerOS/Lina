package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageInstaller
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.podpis.GradnjeLine
import si.safeer.lina.podpis.Gradnja
import si.safeer.lina.podpis.IzidGradenj
import si.safeer.lina.podpis.IzidPrenosa
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NamestitevApk
import si.safeer.lina.podpis.NapakaGradenj
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.OdgovorLine
import si.safeer.lina.podpis.StanjeGradenj
import si.safeer.lina.podpis.ZavrnitevApk
import java.io.File

/**
 * »Gradnje na GitHubu« v zavihku Racunalnik (lastnik 24. 11. 2026): stanje, predlog in potrditev (tok in veja vidna pred podpisom),
 * ura konca po ljubljanskem casu, POLNA pot mape na racunalniku in sha256, opozorila GitHuba kot golo besedilo; »Namesti na ta
 * telefon«. Logika v modulu podpis (GradnjeLine, NamestitevApk; preizkusi), tu pogledi in niti. Samo domace omrezje (LAN povezava).
 * NEPREVERJENO na napravi (app se lokalno ne prevaja).
 */
class GradnjePogled(private val a: Activity, starsi: LinearLayout, private val pokaziOpozorilo: () -> Unit) {
    private val glavna = Handler(Looper.getMainLooper())
    private val koren = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
    private val stanje = TextView(a, null, 0, R.style.Gw_Muted).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    private val seznam = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val predlagaj = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.builds_propose); isEnabled = false }
    private val mapaApk = File(a.cacheDir, "gradnje")
    @Volatile private var dela = false
    private var zadnje: StanjeGradenj? = null

    private companion object {
        @Volatile var pospravljeno = false
    }

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    init {
        // Kopija od prejsnje namestitve (posodobitev same sebe ustavi proces, preden pospravi); enkrat na proces, ne ob zasuku
        // zaslona, ko bi lahko nit se pisala vanjo.
        if (!pospravljeno) { pospravljeno = true; NamestitevApk.pobrisi(mapaApk) }
        koren.addView(TextView(a, null, 0, R.style.Gw_Heading).apply {
            setText(R.string.builds_title); isAccessibilityHeading = true; setPadding(0, dp(16), 0, 0)
        })
        koren.addView(TextView(a, null, 0, R.style.Gw_Muted).apply { setText(R.string.builds_desc) })
        koren.addView(stanje)
        predlagaj.setOnClickListener { izberiTok() }
        koren.addView(predlagaj)
        koren.addView(seznam)
        koren.addView(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.builds_refresh); setOnClickListener { osvezi() } })
        starsi.addView(koren)
        // Sibka referenca: statični povratni klic ne sme drzati unicene aktivnosti.
        val pogled = java.lang.ref.WeakReference(stanje)
        NamestitevPaketa.obIzidu = { status, sporocilo ->
            glavna.post {
                val t = pogled.get() ?: return@post
                if (status == PackageInstaller.STATUS_SUCCESS) t.setText(R.string.install_done)
                else t.text = t.context.getString(R.string.install_failed, sporocilo ?: status.toString())
            }
        }
    }

    private fun imeToka(tok: String): String = a.getString(if (tok == "gradnja.yml") R.string.builds_flow_apk else R.string.builds_flow_deb)

    private fun besediloStanja(s: String): String = a.getString(when (s) {
        "caka" -> R.string.builds_state_caka
        "odklonjeno" -> R.string.builds_state_odklonjeno
        "poteklo" -> R.string.builds_state_poteklo
        "zaganja" -> R.string.builds_state_zaganja
        "tece" -> R.string.builds_state_tece
        "prenasa" -> R.string.builds_state_prenasa
        "koncano" -> R.string.builds_state_koncano
        "neuspesno" -> R.string.builds_state_neuspesno
        else -> R.string.builds_state_napaka
    })

    private fun sporocilo(n: IzidGradenj.Napaka): String = when (n.vrsta) {
        NapakaGradenj.NEDOSEGLJIV -> a.getString(R.string.builds_err_unreachable)
        NapakaGradenj.ZAVRNJENO -> a.getString(R.string.builds_err_denied)
        NapakaGradenj.PREVEC -> a.getString(R.string.builds_err_busy)
        NapakaGradenj.STARA_LINA -> a.getString(R.string.builds_err_old)
        NapakaGradenj.NI_POTRDITVE -> a.getString(R.string.builds_need_warning)
        NapakaGradenj.NAPAKA -> a.getString(R.string.builds_err_generic)
        NapakaGradenj.RACUNALNIK -> when (n.razlog) {
            "izklopljeno" -> a.getString(R.string.builds_off)
            "geslo" -> a.getString(R.string.builds_no_password)
            "ni-gh" -> a.getString(R.string.builds_no_gh)
            else -> a.getString(R.string.builds_err_computer, n.razlog.orEmpty())
        }
    }

    private fun povezava(): HttpPovezavaZLino? = AsistentShramba.beri(a)?.let { HttpPovezavaZLino(it) }

    /** Klic na Lino v ozadju (samo LAN povezava; gradnje od zunaj niso dovoljene). Ena zahteva naenkrat. */
    private fun vOzadju(delo: (HttpPovezavaZLino, String) -> IzidGradenj, obUspehu: (IzidGradenj) -> Unit) {
        if (dela) return
        dela = true
        predlagaj.isEnabled = false
        stanje.setText(R.string.builds_loading)
        Thread({
            val pov = povezava()
            val izid = try {
                val id = runCatching { NapravaKljuc.id() }.getOrNull()
                if (pov == null || id == null) IzidGradenj.Napaka(NapakaGradenj.NEDOSEGLJIV) else delo(pov, id)
            } catch (_: Exception) {
                IzidGradenj.Napaka(NapakaGradenj.NAPAKA)
            } finally {
                pov?.zapri()
            }
            glavna.post {
                dela = false
                predlagaj.isEnabled = zadnje?.let { it.vklopljeno && it.gh && it.geslo } == true
                if (izid is IzidGradenj.Napaka) {
                    stanje.text = sporocilo(izid)
                    if (izid.vrsta == NapakaGradenj.NI_POTRDITVE) pokaziOpozorilo()
                } else obUspehu(izid)
            }
        }, "lina-gradnje").start()
    }

    /** Pokaze razdelek samo, ce je telefon seznanjen z racunalnikom, in prebere stanje; [potem] ostane vidno po osvezitvi. */
    fun osvezi(potem: Int? = null) {
        val seznanjen = AsistentShramba.beri(a) != null
        koren.visibility = if (seznanjen) View.VISIBLE else View.GONE
        if (!seznanjen) return
        vOzadju({ pov, id ->
            GradnjeLine.stanje(pov, id, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { c, e -> NapravaKljuc.podpisiStanjeGradenj(c, e) }
        }) { izid ->
            if (izid is IzidGradenj.Stanje) prikazi(izid.stanje)
            if (potem != null && stanje.text.isNullOrEmpty()) stanje.setText(potem)
        }
    }

    private fun prikazi(s: StanjeGradenj) {
        zadnje = s
        stanje.text = when {
            !s.vklopljeno -> a.getString(R.string.builds_off)
            !s.gh -> a.getString(R.string.builds_no_gh)
            !s.geslo -> a.getString(R.string.builds_no_password)
            s.gradnje.isEmpty() -> a.getString(R.string.builds_empty)
            else -> ""
        }
        predlagaj.isEnabled = s.vklopljeno && s.gh && s.geslo
        seznam.removeAllViews()
        // Namestitev samo za NAJNOVEJSO koncano gradnjo APK (racunalnik vrne vedno samo njo).
        val zaNamestitev = s.gradnje.firstOrNull { it.tok == "gradnja.yml" && it.stanje == "koncano" }?.takeIf { it.lahkoNamesti && it.podpis == "ujema" }
        for (g in s.gradnje.take(8)) seznam.addView(vrstica(g, g == zaNamestitev))
    }

    private fun tiho(t: String, izbirno: Boolean = false) = TextView(a, null, 0, R.style.Gw_Muted).apply {
        text = t // NEZAUPANO besedilo z racunalnika: samo setText, brez povezav in HTML
        setTextIsSelectable(izbirno)
    }

    private fun vrstica(g: Gradnja, namesti: Boolean): View = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(12), 0, 0)
        addView(TextView(a, null, 0, R.style.Gw_Heading).apply { text = a.getString(R.string.builds_item, imeToka(g.tok), g.veja) })
        addView(tiho(a.getString(R.string.builds_state, besediloStanja(g.stanje))))
        if (g.stanje in GradnjeLine.AKTIVNA) GradnjeLine.uraLjubljana(g.ocenaKonca)?.let { addView(tiho(a.getString(R.string.builds_eta, it))) }
        GradnjeLine.uraLjubljana(g.konec)?.let { addView(tiho(a.getString(R.string.builds_finished_at, it))) }
        g.razlog?.let { addView(tiho(a.getString(R.string.builds_reason, it))) }
        g.mapa?.let {
            addView(tiho(a.getString(R.string.builds_saved_to)))
            addView(tiho(it, izbirno = true))
            for (d in g.datoteke) addView(tiho(a.getString(R.string.builds_sha, d.pot, d.sha256), izbirno = true))
        }
        if (g.tok == "gradnja.yml" && g.stanje == "koncano") when (g.podpis) {
            "ujema" -> addView(tiho(a.getString(R.string.builds_sig_ok)))
            "ne-ujema" -> addView(tiho(a.getString(R.string.builds_sig_bad)))
            "ni-preverjen" -> addView(tiho(a.getString(R.string.builds_sig_unchecked)))
        }
        if (g.anotacije.isNotEmpty()) {
            addView(tiho(a.getString(R.string.builds_warnings, g.anotacije.size)))
            for (an in g.anotacije) addView(tiho("${an.raven}: ${an.sporocilo}" + if (an.pot.isNotEmpty()) " (${an.pot})" else ""))
        }
        if (g.stanje == "caka") addView(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.builds_confirm); setOnClickListener { potrdi(g) } })
        if (namesti) addView(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.builds_install); setOnClickListener { namesti() } })
    }

    private fun izberiTok() {
        val s = zadnje ?: return
        val tokovi = s.tokovi.map { it.tok }.filter { it in GradnjeLine.TOKOVI }
        if (tokovi.isEmpty() || s.veje.isEmpty()) return
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.builds_pick_flow)
            .setItems(tokovi.map(::imeToka).toTypedArray()) { _, i -> izberiVejo(tokovi[i], s.veje) }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun izberiVejo(tok: String, veje: List<String>) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.builds_pick_branch)
            .setItems(veje.toTypedArray()) { _, i -> potrdiPredlog(tok, veje[i], veje) }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun potrdiPredlog(tok: String, veja: String, veje: List<String>) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.builds_propose)
            .setMessage(a.getString(R.string.builds_propose_msg, imeToka(tok), veja))
            .setPositiveButton(R.string.builds_propose) { _, _ ->
                vOzadju({ pov, id ->
                    GradnjeLine.predlagaj(pov, id, tok, veja, veje, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { t, v, c, e ->
                        NapravaKljuc.podpisiPredlogGradnje(t, v, c, e)
                    }
                }) { glavna.post { osvezi(R.string.builds_proposed) } }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    /** Lastnik pred podpisom vidi tok in vejo; zgostitev izracuna telefon (GradnjeLine.potrdi). */
    private fun potrdi(g: Gradnja) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.builds_confirm)
            .setMessage(a.getString(R.string.builds_confirm_msg, imeToka(g.tok), g.veja))
            .setPositiveButton(R.string.builds_start) { _, _ ->
                vOzadju({ pov, id ->
                    GradnjeLine.potrdi(pov, id, g, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { i, z, c, e ->
                        NapravaKljuc.podpisiPotrditevGradnje(i, z, c, e)
                    }
                }) { glavna.post { osvezi(R.string.builds_started) } }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun zavrnitev(z: ZavrnitevApk): Int = when (z) {
        ZavrnitevApk.GLAVE -> R.string.install_err_glave
        ZavrnitevApk.PREVELIK -> R.string.install_err_prevelik
        ZavrnitevApk.VELIKOST -> R.string.install_err_velikost
        ZavrnitevApk.VSOTA -> R.string.install_err_vsota
        ZavrnitevApk.PAKET -> R.string.install_err_paket
        ZavrnitevApk.PODPIS -> R.string.install_err_podpis
        ZavrnitevApk.PREKINJENO -> R.string.install_err_prekinjeno
    }

    /** Prenos v cacheDir, preverbe (NamestitevApk + PackageManager), nato PackageInstaller; sistemsko okno potrdi lastnik. */
    private fun namesti() {
        if (dela) return
        if (!NamestitevPaketa.imaDovoljenje(a)) {
            AlertDialog.Builder(a, R.style.Gw_Dialog)
                .setTitle(R.string.builds_install)
                .setMessage(R.string.install_perm_needed)
                .setPositiveButton(R.string.install_perm_open) { _, _ -> runCatching { NamestitevPaketa.odpriNastavitev(a) } }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            return
        }
        dela = true
        stanje.setText(R.string.install_downloading)
        Thread({
            val pov = povezava()
            val besedilo: String = try {
                val id = runCatching { NapravaKljuc.id() }.getOrNull()
                val cas = System.currentTimeMillis()
                val e = NalogaLine.nakljucno(32)
                val podpis = if (id == null) null else NapravaKljuc.podpisiApkGradnje(cas, e)
                when {
                    pov == null || id == null -> a.getString(R.string.builds_err_unreachable)
                    podpis == null -> a.getString(R.string.builds_need_warning)
                    else -> {
                        mapaApk.mkdirs()
                        val (izid, napaka) = pov.prenesiApk(id, cas, e, podpis, mapaApk)
                        when {
                            napaka is OdgovorLine.Napaka && napaka.status == 404 -> a.getString(R.string.install_none)
                            napaka is OdgovorLine.Napaka && napaka.status == 409 && napaka.koda == "vsota" -> a.getString(R.string.install_changed)
                            napaka != null -> sporocilo(GradnjeLine.napaka(napaka))
                            izid is IzidPrenosa.Zavrnjeno -> a.getString(zavrnitev(izid.razlog))
                            izid is IzidPrenosa.Ok -> {
                                glavna.post { stanje.setText(R.string.install_checking) }
                                val z = NamestitevPaketa.preveriArhiv(a, izid.datoteka)
                                if (z != null) a.getString(zavrnitev(z))
                                else { NamestitevPaketa.namesti(a, izid.datoteka); a.getString(R.string.install_confirm_system) }
                            }
                            else -> a.getString(R.string.builds_err_generic)
                        }
                    }
                }
            } catch (_: Exception) {
                a.getString(R.string.builds_err_generic)
            } finally {
                pov?.zapri()
                NamestitevApk.pobrisi(mapaApk) // vsaka pot: kopija ne ostane (bajti so ze v seji ali zavrnjeni)
            }
            glavna.post { dela = false; stanje.text = besedilo }
        }, "lina-namestitev").start()
    }
}
