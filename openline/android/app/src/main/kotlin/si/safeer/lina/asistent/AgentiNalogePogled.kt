package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import si.safeer.lina.pokaziVarno
import android.app.TimePickerDialog
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.podpis.AgentiLine
import si.safeer.lina.podpis.GradnjeLine
import si.safeer.lina.podpis.IzidAgentov
import si.safeer.lina.podpis.NalogaAgenta
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NapakaGradenj
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.StanjeAgentov
import java.time.Instant

/**
 * Kartica »Agenti in naloge« v zavihku Racunalnik (lastnik 24. 11. 2026 »Bo gumb na telefonu?« - DA): vrsta nalog (agent, mapa, stanje,
 * ura konca po ljubljanskem casu, opomnik) in »Dodeli nalogo« (agent in mapa s seznama z racunalnika, besedilo, kdaj). Pred podpisom
 * okno pokaze id in ime iz tabele telefona ter besedilo, ki se podpise. Ce ciscenje besedilo spremeni, lastnik potrdi se enkrat.
 * Podpis s kljucem naprave je lastnikova potrditev za ta zagon (brez »Razumem« se ne podpise: Podpisnik). Kartica je
 * vstavljena TIK NAD obstojeci Dovoli/Zavrni za Claude Code (isto mesto): vprasanja Claude Code so spodaj. Logika v modulu podpis
 * (AgentiLine; preizkusi), tu pogledi in niti. Samo domace omrezje (LAN). NEPREVERJENO na napravi (app se lokalno ne prevaja z Gradlom).
 */
class AgentiNalogePogled(private val a: Activity, starsi: LinearLayout, mesto: Int, private val pokaziOpozorilo: () -> Unit) {
    private val glavna = Handler(Looper.getMainLooper())
    private val koren = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
    private val stanje = TextView(a, null, 0, R.style.Gw_Muted).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    private val seznam = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val dodeli = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.agents_assign); isEnabled = false }
    @Volatile private var dela = false
    private var zadnje: StanjeAgentov? = null

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    init {
        koren.addView(TextView(a, null, 0, R.style.Gw_Heading).apply {
            setText(R.string.agents_title); isAccessibilityHeading = true; setPadding(0, dp(16), 0, 0)
        })
        koren.addView(TextView(a, null, 0, R.style.Gw_Muted).apply { setText(R.string.agents_desc) })
        koren.addView(stanje)
        dodeli.setOnClickListener { izberiAgenta() }
        koren.addView(dodeli)
        koren.addView(seznam)
        koren.addView(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.builds_refresh); setOnClickListener { osvezi() } })
        starsi.addView(koren, if (mesto in 0..starsi.childCount) mesto else starsi.childCount)
    }

    /** Id in ime iz tabele telefona. Ime iz odgovora streznika sem ne pride. */
    private fun imeAgenta(id: String): String = AgentiLine.prikazAgenta(id)

    private fun besediloStanja(s: String): String = a.getString(when (s) {
        "caka" -> R.string.agents_state_caka
        "zaganja" -> R.string.agents_state_zaganja
        "tece" -> R.string.agents_state_tece
        "koncano" -> R.string.agents_state_koncano
        "odklonjeno" -> R.string.agents_state_odklonjeno
        "poteklo" -> R.string.agents_state_poteklo
        "dodeljeno" -> R.string.agents_state_dodeljeno
        "zamujeno" -> R.string.agents_state_zamujeno
        "preklicano" -> R.string.agents_state_preklicano
        "nepopolno" -> R.string.agents_state_nepopolno
        else -> R.string.agents_state_napaka
    })

    private fun sporocilo(n: IzidAgentov.Napaka): String = when (n.vrsta) {
        NapakaGradenj.NEDOSEGLJIV -> a.getString(R.string.agents_err_unreachable)
        NapakaGradenj.ZAVRNJENO -> a.getString(R.string.agents_err_denied)
        NapakaGradenj.PREVEC -> a.getString(R.string.builds_err_busy)
        NapakaGradenj.STARA_LINA -> a.getString(R.string.agents_err_old)
        NapakaGradenj.NI_POTRDITVE -> a.getString(R.string.builds_need_warning)
        NapakaGradenj.NAPAKA -> a.getString(R.string.builds_err_generic)
        NapakaGradenj.RACUNALNIK -> when (n.razlog) {
            "geslo" -> a.getString(R.string.agents_err_password)
            "agent-izklopljen", "agent-ni-pripravljen", "agent" -> a.getString(R.string.agents_err_agent)
            "mapa-prepovedana" -> a.getString(R.string.agents_err_forbidden)
            "pogoj" -> a.getString(R.string.agents_err_condition)
            "predolgo" -> a.getString(R.string.agents_err_too_long)
            "polno-cakajoce" -> a.getString(R.string.agents_err_full)
            else -> if (n.razlog?.startsWith("mapa") == true) a.getString(R.string.agents_err_folder)
            else a.getString(R.string.builds_err_computer, n.razlog.orEmpty())
        }
    }

    private fun povezava(): HttpPovezavaZLino? = AsistentShramba.beri(a)?.let { HttpPovezavaZLino(it) }

    /** Klic na Lino v ozadju (samo LAN povezava). Ena zahteva naenkrat. */
    private fun vOzadju(delo: (HttpPovezavaZLino, String) -> IzidAgentov, obUspehu: (IzidAgentov) -> Unit) {
        if (dela) return
        dela = true
        dodeli.isEnabled = false
        stanje.setText(R.string.builds_loading)
        Thread({
            val pov = povezava()
            val izid = try {
                val id = runCatching { NapravaKljuc.id() }.getOrNull()
                if (pov == null || id == null) IzidAgentov.Napaka(NapakaGradenj.NEDOSEGLJIV) else delo(pov, id)
            } catch (_: Exception) {
                IzidAgentov.Napaka(NapakaGradenj.NAPAKA)
            } finally {
                pov?.zapri()
            }
            glavna.post {
                dela = false
                dodeli.isEnabled = zadnje != null
                if (izid is IzidAgentov.Napaka) {
                    stanje.text = sporocilo(izid)
                    if (izid.vrsta == NapakaGradenj.NI_POTRDITVE) pokaziOpozorilo()
                } else obUspehu(izid)
            }
        }, "lina-agenti").start()
    }

    /** Pokaze kartico samo, ce je telefon seznanjen z racunalnikom, in prebere vrsto; [potem] ostane vidno po osvezitvi. */
    fun osvezi(potem: Int? = null) {
        val seznanjen = AsistentShramba.beri(a) != null
        koren.visibility = if (seznanjen) View.VISIBLE else View.GONE
        if (!seznanjen) return
        vOzadju({ pov, id ->
            AgentiLine.stanje(pov, id, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { c, e -> NapravaKljuc.podpisiStanjeAgentNalog(c, e) }
        }) { izid ->
            if (izid is IzidAgentov.Stanje) prikazi(izid.stanje)
            if (potem != null) stanje.setText(potem)
        }
    }

    private fun prikazi(s: StanjeAgentov) {
        zadnje = s
        stanje.text = if (s.naloge.isEmpty()) a.getString(R.string.agents_empty) else ""
        dodeli.isEnabled = true
        seznam.removeAllViews()
        for (n in s.naloge.take(15)) seznam.addView(vrstica(n))
    }

    private fun tiho(t: String, izbirno: Boolean = false) = TextView(a, null, 0, R.style.Gw_Muted).apply {
        text = t // NEZAUPANO besedilo z racunalnika: samo setText, brez povezav in HTML
        setTextIsSelectable(izbirno)
    }

    /** »danes ob 10:30« / »jutri ob 10:30« / »27. 11. ob 10:30« po ljubljanskem casu. */
    private fun ura(iso: String?): String? = AgentiLine.danZagona(iso, Instant.now())?.let { d ->
        when (d.dni) {
            0L -> a.getString(R.string.agents_when_at, d.ura)
            1L -> a.getString(R.string.agents_when_at_tomorrow, d.ura)
            else -> a.getString(R.string.agents_when_at_date, d.datum, d.ura)
        }
    }

    private fun kdaj(n: NalogaAgenta): String? = n.pogoj?.let { p ->
        when (p.vrsta) {
            "zdaj" -> a.getString(R.string.agents_when_now)
            "ura" -> ura(p.cas)
            else -> a.getString(R.string.agents_when_after, p.id.orEmpty())
        }
    }

    private fun vrstica(n: NalogaAgenta): View = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(12), 0, 0)
        addView(TextView(a, null, 0, R.style.Gw_Heading).apply { text = a.getString(R.string.agents_item, imeAgenta(n.agent), besediloStanja(n.stanje)) })
        addView(tiho(n.mapa, izbirno = true))
        addView(tiho(n.besedilo.take(200)))
        kdaj(n)?.let { addView(tiho(it)) }
        if (n.stanje in setOf("tece", "zaganja")) GradnjeLine.uraLjubljana(n.ocenaKonca)?.let {
            addView(tiho(a.getString(if (n.ocenaGroba) R.string.agents_eta_rough else R.string.agents_eta, it)))
        }
        GradnjeLine.uraLjubljana(n.koncano)?.let { addView(tiho(a.getString(R.string.builds_finished_at, it))) }
        n.opomnik?.razlog?.let { r ->
            addView(tiho(a.getString(when (r) {
                "se-tece" -> R.string.agents_reminder_running
                "terminal-zaprt" -> R.string.agents_reminder_closed
                else -> R.string.agents_reminder_no_report
            })))
        }
        n.razlog?.let { addView(tiho(a.getString(R.string.builds_reason, it))) }
        if (TockeNalog.vklopljeno(a)) tocke(n).forEach { addView(it) }
        if (n.stanje == "zamujeno") addView(tiho(a.getString(R.string.agents_missed)))
        if (n.stanje in AgentiLine.PREKLICLJIVA) addView(Button(a, null, 0, R.style.Gw_Button).apply {
            setText(R.string.agents_cancel); setOnClickListener { preklici(n) }
        })
    }

    private fun razlogTocke(r: String): String = a.getString(when (r) {
        "ni-narejeno" -> R.string.agents_point_reason_not_done
        "brez-dokaza" -> R.string.agents_point_reason_no_evidence
        "dokaz-ni-najden" -> R.string.agents_point_reason_evidence_missing
        else -> R.string.agents_point_reason_missing
    })

    /**
     * Tocke naloge (24. 11. 2026): »3/5 narejeno«, manjkajoce z razlogom in predlog nove naloge. Predlog pripravi racunalnik in caka
     * na lastnikovo potrditev; telefon tu nicesar ne spremeni. Besedilo tock je NEZAUPANO (samo setText).
     */
    private fun tocke(n: NalogaAgenta): List<View> {
        val t = n.tocke ?: return emptyList()
        val v = mutableListOf<View>(TextView(a, null, 0, R.style.Gw_Body).apply { text = a.getString(R.string.agents_points, t.narejeno, t.skupaj) })
        if (t.manjkajoce.isNotEmpty()) {
            v += tiho(a.getString(R.string.agents_points_missing))
            t.manjkajoce.forEach { m -> v += tiho(a.getString(R.string.agents_point_item, m.st, m.besedilo, razlogTocke(m.razlog)), izbirno = true) }
        }
        when (n.predlogTock) {
            null -> {}
            "napaka" -> v += tiho(a.getString(R.string.agents_points_proposal_failed))
            // stanje predloga iz iste vrste (potrjen, zavrnjen ...), da vrstica ne zastari; predloga ni v vrsti = samo id
            else -> v += tiho(a.getString(R.string.agents_points_proposal,
                zadnje?.naloge?.firstOrNull { it.id == n.predlogTock }?.let { "${it.id} · ${besediloStanja(it.stanje)}" } ?: n.predlogTock))
        }
        return v
    }

    private fun izberi(naslov: Int, imena: List<String>, naprej: (Int) -> Unit) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(naslov)
            .setItems(imena.toTypedArray()) { _, i -> naprej(i) }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun izberiAgenta() {
        val s = zadnje ?: return
        val agenti = s.agenti.filter { it.zaIzbiro && AgentiLine.imeUjema(it.id, it.ime) }
        if (agenti.isEmpty()) { stanje.setText(R.string.agents_none_ready); return }
        if (s.mape.isEmpty()) { stanje.setText(R.string.agents_no_folders); return }
        izberi(R.string.agents_pick_agent, agenti.map { AgentiLine.prikazAgenta(it.id) }) { i -> izberiMapo(s, agenti[i].id) }
    }

    private fun izberiMapo(s: StanjeAgentov, agent: String) =
        izberi(R.string.agents_pick_folder, s.mape) { i -> vpisiBesedilo(s, agent, s.mape[i]) }

    private fun vpisiBesedilo(s: StanjeAgentov, agent: String, mapa: String) {
        val vnos = EditText(a, null, 0, R.style.Gw_Field).apply {
            setHint(R.string.agents_text_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 3
            filters = arrayOf(android.text.InputFilter.LengthFilter(AgentiLine.NAJVEC_BESEDILO))
        }
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.agents_text_title)
            .setView(vnos)
            .setPositiveButton(R.string.agents_next) { _, _ ->
                val surovo = vnos.text.toString()
                val odlocitev = AgentiLine.besediloZaPodpis(surovo)
                when {
                    odlocitev == null -> stanje.setText(if (surovo.length > AgentiLine.NAJVEC_BESEDILO) R.string.agents_err_too_long else R.string.agents_text_empty)
                    !AgentiLine.dolzinaVRedu(odlocitev.besedilo, mapa) -> stanje.setText(R.string.agents_err_too_long)
                    odlocitev.drugic -> potrdiCiscenje(s, agent, mapa, odlocitev.besedilo)
                    else -> izberiKdaj(s, agent, mapa, odlocitev.besedilo)
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .pokaziVarno()
    }

    private fun izberiKdaj(s: StanjeAgentov, agent: String, mapa: String, besedilo: String) {
        val prve = s.naloge.filter { it.stanje in AgentiLine.NEKONCNA }
        val moznosti = listOf(a.getString(R.string.agents_when_now_opt), a.getString(R.string.agents_when_at_opt)) +
            if (prve.isNotEmpty()) listOf(a.getString(R.string.agents_when_after_opt)) else emptyList()
        izberi(R.string.agents_pick_when, moznosti) { i ->
            when (i) {
                0 -> potrdi(s, agent, mapa, besedilo, AgentiLine.ZDAJ, a.getString(R.string.agents_when_now))
                1 -> {
                    val zdaj = java.time.ZonedDateTime.now(java.time.ZoneId.of("Europe/Ljubljana"))
                    TimePickerDialog(a, { _, h, m ->
                        val p = AgentiLine.pogojUra(h, m, Instant.now())
                        ura(p.removePrefix("ura:"))?.let { potrdi(s, agent, mapa, besedilo, p, it) }
                    }, zdaj.hour, zdaj.minute, true).show()
                }
                else -> izberi(R.string.agents_pick_first, prve.map { a.getString(R.string.agents_first_item, imeAgenta(it.agent), it.id, it.besedilo.take(60)) }) { j ->
                    AgentiLine.pogojPo(prve[j].id)?.let { potrdi(s, agent, mapa, besedilo, it, a.getString(R.string.agents_when_after, prve[j].id)) }
                }
            }
        }
    }

    /** Ce ciscenje spremeni besedilo, lastnik vidi ocisceno in ga potrdi, preden izbere kdaj. Podpise se samo ocisceno. */
    private fun potrdiCiscenje(s: StanjeAgentov, agent: String, mapa: String, cisto: String) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.agents_text_cleaned_title)
            .setMessage(a.getString(R.string.agents_text_cleaned, cisto))
            .setPositiveButton(R.string.agents_text_cleaned_ok) { _, _ -> izberiKdaj(s, agent, mapa, cisto) }
            .setNegativeButton(android.R.string.cancel, null)
            .pokaziVarno()
    }

    /** Pred podpisom lastnik vidi id in ime iz tabele, mapo, celo (ze ocisceno) besedilo in kdaj. Ime iz odgovora ni v stavku. */
    private fun potrdi(s: StanjeAgentov, agent: String, mapa: String, besedilo: String, pogoj: String, kdaj: String) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.agents_confirm_title)
            .setMessage(a.getString(R.string.agents_confirm_msg, imeAgenta(agent), mapa, kdaj, besedilo))
            .setPositiveButton(R.string.agents_confirm_sign) { _, _ ->
                vOzadju({ pov, id ->
                    AgentiLine.dodeli(pov, id, s, agent, mapa, besedilo, pogoj, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { z, c, e ->
                        NapravaKljuc.podpisiDodelitevAgentNaloge(z, c, e)
                    }
                }) { glavna.post { osvezi(R.string.agents_assigned) } }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .pokaziVarno()
    }

    private fun preklici(n: NalogaAgenta) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(R.string.agents_cancel)
            .setMessage(a.getString(R.string.agents_cancel_msg, imeAgenta(n.agent), n.mapa, n.besedilo.take(200)))
            .setPositiveButton(R.string.agents_cancel) { _, _ ->
                vOzadju({ pov, id ->
                    AgentiLine.preklici(pov, id, n, System.currentTimeMillis(), NalogaLine.nakljucno(32)) { i, c, e -> NapravaKljuc.podpisiPreklicAgentNaloge(i, c, e) }
                }) { glavna.post { osvezi(R.string.agents_cancelled) } }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .pokaziVarno()
    }
}
