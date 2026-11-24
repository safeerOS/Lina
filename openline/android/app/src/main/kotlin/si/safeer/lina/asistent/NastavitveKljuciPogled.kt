package si.safeer.lina.asistent

import android.app.Activity
import android.os.Handler
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.IzidOrodja
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.PomnilniskiShranjevalnik
import si.safeer.lina.samostojna.SamodejniModel
import si.safeer.lina.samostojna.Prenos
import si.safeer.lina.samostojna.SpletnaOrodja
import java.util.concurrent.ExecutorService
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.GoogleOAuth
import si.safeer.lina.samostojna.GoogleZetonOsvezevalnik
import si.safeer.lina.samostojna.PrijavaGoogle
import si.safeer.lina.samostojna.ProjektGoogle
import si.safeer.lina.samostojna.poPrijaviGoogle
import si.safeer.lina.samostojna.vklopiVertex
import si.safeer.lina.samostojna.IzbiraAsistentke
import si.safeer.lina.samostojna.OpenRouterRacun
import si.safeer.lina.samostojna.PRIVZETI_BREZPLACNI
import si.safeer.lina.samostojna.StanjeOpenRouter
import android.widget.CheckBox
import android.widget.Switch

class NastavitveKljuciPogled(
    private val a: Activity,
    private val prenos: Prenos,
    private val nit: ExecutorService,
    private val glavna: Handler,
    private val obSpremembi: () -> Unit,
) {
    private val vsebnik: LinearLayout = a.findViewById(R.id.assistantToolsList)
    private val googleShramba = GoogleShramba(a)
    private val google = GoogleZetonOsvezevalnik(SkupniKljuci.shrambaZaPonudnika(a, Ponudnik.VERTEX), prenos)
    private var googleSporocilo: String? = null
    private var caka = false

    private val kljucBlok: View = a.findViewById(R.id.assistantKeyBlock)
    private val kljucVnos: EditText = a.findViewById(R.id.assistantKeyInput)
    private val kljucShrani: Button = a.findViewById(R.id.assistantKeySave)
    private val kljucPozabi: Button = a.findViewById(R.id.assistantKeyForget)
    private val ponudnikVrstica: LinearLayout = a.findViewById(R.id.assistantProviderRow)
    private val ponudnikStanje: TextView = a.findViewById(R.id.assistantProviderStatus)
    private val kljucZaPonudnika: TextView = a.findViewById(R.id.assistantKeyProviderInfo)
    private val googleBlok: View = a.findViewById(R.id.assistantGoogleBlock)
    private val googleInfo: TextView = a.findViewById(R.id.assistantGoogleInfo)
    private val googleGumb: Button = a.findViewById(R.id.assistantGoogleSignIn)

    private val brave = SkupniKljuci.shrambaZaOrodje(a, VrstaOrodja.BRAVE)
    private val tinyfish = SkupniKljuci.shrambaZaOrodje(a, VrstaOrodja.TINYFISH)
    private val twilioZeton = SkupniKljuci.shrambaZaOrodje(a, VrstaOrodja.TWILIO_ZETON)
    private val twilio = TwilioShramba(a)
    private val kljucAsistentke = SkupniKljuci.shrambaAsistentke(a)
    private val nastavitveAsistentke = AsistentkaShramba(a)
    private val osveziVse = mutableListOf<() -> Unit>()

    init {
        // Ime in spomin sta svoja razdelka pred naslovom spletnih orodij (zaslon 22. 11. 2026: bila sta pod »Spletno iskanje in povezave«).
        val naslovOrodij: View = a.findViewById(R.id.assistantToolsTitle)
        val starsi = naslovOrodij.parent as LinearLayout
        val mesto = starsi.indexOfChild(naslovOrodij)
        val ime = ImeUporabnikaPogled(a, starsi, mesto)
        SpominPogovorovPogled(a, starsi, mesto + ime.dodanih)
        kljucShrani.setOnClickListener { shraniKljuc() }
        googleGumb.setOnClickListener { zacniPrijavoGoogle() }
        kljucPozabi.setOnClickListener {
            val p = SkupniKljuci.aktivniPonudnik(a)
            if (p == Ponudnik.VERTEX) { google.odjava(); googleShramba.shraniProjekt(null); googleSporocilo = null } else SkupniKljuci.shrambaZaPonudnika(a, p).izbrisi()
            obSpremembi()
            osvezi()
        }

        for (p in Ponudnik.entries) {
            ponudnikVrstica.addView(
                Button(a, null, 0, R.style.Gw_Button).apply { tag = p; setOnClickListener { izberiPonudnika(p) } },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .apply { topMargin = (6 * a.resources.displayMetrics.density).toInt() },
            )
        }

        razdelekAsistentke()
        razdelek(
            naslov = R.string.tool_brave_title, opomba = R.string.tool_brave_note,
            polja = listOf(R.string.tool_brave_hint), skrita = listOf(true),
            povezan = { if (brave.preberi() != null) a.getString(R.string.tool_connected) else null },
            preveri = { SpletnaOrodja.preveriBrave(prenos, it[0]) },
            shrani = { v, _ -> brave.shrani(KljucGemini(v[0])) },
            pozabi = { brave.izbrisi() },
        )
        razdelek(
            naslov = R.string.tool_tinyfish_title, opomba = R.string.tool_tinyfish_note,
            polja = listOf(R.string.tool_tinyfish_hint), skrita = listOf(true),
            povezan = { if (tinyfish.preberi() != null) a.getString(R.string.tool_connected) else null },
            preveri = { SpletnaOrodja.preveriTinyFish(prenos, it[0]) },
            shrani = { v, _ -> tinyfish.shrani(KljucGemini(v[0])) },
            pozabi = { tinyfish.izbrisi() },
        )
        razdelek(
            naslov = R.string.tool_twilio_title, opomba = R.string.tool_twilio_note,
            polja = listOf(R.string.tool_twilio_sid_hint, R.string.tool_twilio_token_hint), skrita = listOf(false, true),
            povezan = {
                if (twilio.sid() != null && twilioZeton.preberi() != null)
                    twilio.ime()?.takeIf { it.isNotBlank() }?.let { a.getString(R.string.tool_twilio_connected_fmt, it) } ?: a.getString(R.string.tool_connected)
                else null
            },
            preveri = { SpletnaOrodja.preveriTwilio(prenos, it[0], it[1]) },
            shrani = { v, izid -> twilio.shrani(v[0], izid.besedilo); twilioZeton.shrani(KljucGemini(v[1])) },
            pozabi = { twilio.izbrisi(); twilioZeton.izbrisi() },
        )
        osvezi()
    }

    fun orodja(): SpletnaOrodja =
        SpletnaOrodja(prenos, { brave.preberi()?.izpostavi() }, { tinyfish.preberi()?.izpostavi() })

    private fun izberiPonudnika(p: Ponudnik) {
        if (p == SkupniKljuci.aktivniPonudnik(a) || caka) return
        SkupniKljuci.nastaviAktivnegaPonudnika(a, p)
        kljucVnos.setText("")
        kljucVnos.error = null
        googleSporocilo = null
        obSpremembi()
        osvezi()
    }

    private fun jeVertex() = SkupniKljuci.aktivniPonudnik(a) == Ponudnik.VERTEX
    private fun imaDostop() = if (jeVertex()) google.prijavljen() && googleShramba.projekt() != null else SkupniKljuci.preberiKljucAktivnegaPonudnika(a) != null

    /**
     * Lastnik 24. 11. 2026: ob shranjevanju Lina sama izbere delujoc model (seznam, priporoceni, preizkusni klic). Kljuc, ki ga
     * ponudnik zavrne (kljuc, dobroimetje, omejitev), se ne shrani in uporabnik vidi pravi vzrok; brez povezave privzeti model.
     */
    private fun shraniKljuc() {
        val k = kljucVnos.text.toString().trim()
        if (k.length < 20 || k.any { it.isWhitespace() }) { kljucVnos.error = a.getString(R.string.local_key_bad); return }
        if (caka) return
        val p = SkupniKljuci.aktivniPonudnik(a)
        caka = true
        kljucShrani.isEnabled = false
        nit.execute {
            val izbira = SamodejniModel.izberi(prenos, p, PomnilniskiShranjevalnik().also { it.shrani(KljucGemini(k)) })
            glavna.post {
                caka = false
                kljucShrani.isEnabled = true
                if (a.isFinishing) return@post
                val model = when (izbira) {
                    is SamodejniModel.Izbira.Model -> izbira.model
                    is SamodejniModel.Izbira.Napaka -> if (izbira.vzrok == null) p.model else { kljucVnos.error = izbira.sporocilo; return@post }
                }
                SkupniKljuci.shrambaZaPonudnika(a, p).shrani(KljucGemini(k))
                ModelShrambaAndroid(a).shrani(p, model)
                val sporocilo = if (izbira is SamodejniModel.Izbira.Model) a.getString(R.string.local_key_model_fmt, model) else a.getString(R.string.local_key_model_unchecked_fmt, model)
                android.widget.Toast.makeText(a, sporocilo, android.widget.Toast.LENGTH_LONG).show()
                kljucVnos.setText("")
                obSpremembi()
                osvezi()
            }
        }
    }

    private fun zacniPrijavoGoogle() {
        if (caka) return
        val z = GoogleOAuth.zacni()
        googleShramba.shraniZacetek(z.preverjalnik, z.stanje, System.currentTimeMillis() + 10 * 60_000L)
        googleSporocilo = a.getString(R.string.local_google_working)
        osvezi()
        try { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(z.naslov))) }
        catch (e: ActivityNotFoundException) { googleSporocilo = a.getString(R.string.local_google_err_fmt, "brskalnik"); osvezi() }
    }

    fun obdelajPovezavo(povezava: String) {
        val zacetek = googleShramba.vzemiZacetek(System.currentTimeMillis())
        val koda = zacetek?.let { GoogleOAuth.kodaIzPovezave(povezava, it.second) }
        if (zacetek == null || koda == null) { googleSporocilo = a.getString(R.string.local_google_err_fmt, "state"); osvezi(); return }
        googleSporocilo = a.getString(R.string.local_google_working); osvezi()
        nit.execute {
            val zetona = GoogleOAuth.zamenjajKodo(prenos, koda, zacetek.first)
            val izid = if (zetona == null) PrijavaGoogle.Napaka("koda")
            else { google.nastavi(zetona); poPrijaviGoogle(zetona.dostop, prenos, googleShramba.projekt()) }
            glavna.post { if (!a.isFinishing) obdelajIzid(izid, zetona?.dostop) }
        }
    }

    private fun obdelajIzid(izid: PrijavaGoogle, zeton: String?) {
        when (izid) {
            is PrijavaGoogle.Pripravljeno -> { googleShramba.shraniProjekt(izid.projekt.id); googleSporocilo = null; obSpremembi() }
            is PrijavaGoogle.Napaka -> { google.odjava(); googleSporocilo = a.getString(R.string.local_google_err_fmt, izid.sporocilo) }
            is PrijavaGoogle.Izbira -> { izberiProjekt(izid.projekti, zeton ?: return); return }
        }
        osvezi()
    }

    private fun izberiProjekt(projekti: List<ProjektGoogle>, zeton: String) {
        AlertDialog.Builder(a).setTitle(R.string.local_google_pick)
            .setItems(projekti.map {
                val obracun = when (it.obracun) { true -> " – " + a.getString(R.string.local_google_billing_on); false -> " – " + a.getString(R.string.local_google_billing_off); null -> "" }
                "${it.ime} (${it.id})$obracun"
            }.toTypedArray()) { _, i ->
                nit.execute {
                    val izid = vklopiVertex(zeton, prenos, projekti[i])
                    glavna.post { if (!a.isFinishing) obdelajIzid(izid, zeton) }
                }
            }
            .setNegativeButton(android.R.string.cancel) { _, _ -> google.odjava(); googleSporocilo = null; osvezi() }
            .setOnCancelListener { google.odjava(); googleSporocilo = null; osvezi() }
            .show()
    }

    fun osvezi() {
        val imaKljuc = imaDostop()
        val ponudnik = SkupniKljuci.aktivniPonudnik(a)
        kljucVnos.hint = a.getString(R.string.local_key_hint_fmt, ponudnik.oznaka)
        ponudnikStanje.text = a.getString(if (imaKljuc) R.string.assistant_provider_ready_fmt else R.string.assistant_provider_missing_fmt, ponudnik.oznaka)
        kljucZaPonudnika.text = a.getString(R.string.assistant_key_provider_fmt, ponudnik.oznaka)
        
        for (i in 0 until ponudnikVrstica.childCount) {
            val b = ponudnikVrstica.getChildAt(i) as Button
            val p = b.tag as Ponudnik
            val izbran = p == ponudnik
            b.text = if (izbran) "\u2713 ${p.oznaka}" else p.oznaka
            b.isSelected = izbran
            b.alpha = if (izbran) 1f else 0.6f
            b.contentDescription = if (izbran) "${p.oznaka}, ${a.getString(R.string.local_provider_selected)}" else p.oznaka
            b.isEnabled = !caka
        }

        kljucBlok.visibility = if (imaKljuc || jeVertex()) View.GONE else View.VISIBLE
        googleBlok.visibility = if (!imaKljuc && jeVertex()) View.VISIBLE else View.GONE
        googleInfo.text = googleSporocilo ?: a.getString(R.string.local_google_info)
        googleGumb.isEnabled = !caka
        kljucPozabi.text = if (jeVertex()) a.getString(R.string.local_google_sign_out) else a.getString(R.string.local_key_forget)
        kljucPozabi.visibility = if (imaKljuc) View.VISIBLE else View.GONE

        osveziVse.forEach { it() }
    }

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    /**
     * Kljuc OpenRouter SAMO za asistentko (lastnik 24. 11. 2026, C1-C4, C8, A6): svoje mesto shrambe, ponudnik za klice ostane.
     * Brezplacen model samo s potrditvijo (enkrat); stikalo ostane za kasnejso spremembo. Brez kljuca: isti model kot klici.
     */
    private fun razdelekAsistentke() {
        fun vrstica(v: View, zgoraj: Int) = vsebnik.addView(
            v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
        )
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.asist_or_title); typeface = android.graphics.Typeface.DEFAULT_BOLD }, 16)
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.asist_or_note) }, 4)
        val vnos = EditText(a, null, 0, R.style.Gw_Field).apply {
            setHint(R.string.asist_or_key_hint)
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            filters = arrayOf(android.text.InputFilter.LengthFilter(400))
        }.also { vrstica(it, 8) }
        val model = EditText(a, null, 0, R.style.Gw_Field).apply {
            setHint(R.string.asist_or_model_hint)
            setText(nastavitveAsistentke.model() ?: PRIVZETI_BREZPLACNI)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            filters = arrayOf(android.text.InputFilter.LengthFilter(80))
        }.also { vrstica(it, 8) }
        val izberi = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.asist_or_pick) }.also { vrstica(it, 8) }
        val soglasje = CheckBox(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.asist_or_consent) }.also { vrstica(it, 8) }
        val shrani = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.asist_or_save) }.also { vrstica(it, 8) }
        val stanje = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }.also { vrstica(it, 8) }
        val pozabi = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.asist_or_forget) }.also { vrstica(it, 8) }
        val stikalo = Switch(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.asist_or_free_switch) }.also { vrstica(it, 12) }
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.asist_or_free_note) }, 4)

        var sporocilo: String? = null
        fun narisi() {
            val ima = kljucAsistentke.preberi() != null
            soglasje.visibility = if (nastavitveAsistentke.brezplacni()) View.GONE else View.VISIBLE
            pozabi.visibility = if (ima) View.VISIBLE else View.GONE
            stikalo.isChecked = nastavitveAsistentke.brezplacni()
            shrani.isEnabled = !caka
            stanje.text = sporocilo ?: if (ima) a.getString(R.string.asist_or_ready_fmt, nastavitveAsistentke.model() ?: PRIVZETI_BREZPLACNI, SkupniKljuci.aktivniPonudnik(a).oznaka)
            else a.getString(R.string.asist_or_same)
        }
        osveziVse.add(::narisi)

        fun preberiStanje() = nit.execute {
            val st = OpenRouterRacun.stanje(prenos, kljucAsistentke)
            glavna.post { if (!a.isFinishing) { sporocilo = opisStanja(st); narisi() } }
        }
        shrani.setOnClickListener {
            val k = vnos.text.toString().trim()
            val m = model.text.toString().trim().ifEmpty { PRIVZETI_BREZPLACNI }
            IzbiraAsistentke.razlogZavrnitve(k, kljucAsistentke.preberi() != null, m, soglasje.isChecked, nastavitveAsistentke.brezplacni())
                ?.let { sporocilo = it; narisi(); return@setOnClickListener }
            if (k.isNotEmpty()) kljucAsistentke.shrani(KljucGemini(k))
            nastavitveAsistentke.shraniModel(m)
            if (soglasje.isChecked) nastavitveAsistentke.nastaviBrezplacne(true)
            vnos.setText(""); sporocilo = null; obSpremembi(); narisi()
            preberiStanje()
        }
        // C3: brez dobroimetja samo brezplacni modeli z orodji, z dobroimetjem vsi (javni seznam).
        izberi.setOnClickListener {
            nit.execute {
                val st = OpenRouterRacun.stanje(prenos, kljucAsistentke)
                val modeli = OpenRouterRacun.modeli(prenos, samoBrezplacni = st?.brezplacniRacun != false)
                glavna.post {
                    if (a.isFinishing || modeli.isEmpty()) return@post
                    AlertDialog.Builder(a).setTitle(R.string.asist_or_pick)
                        .setItems(modeli.toTypedArray()) { _, i -> model.setText(modeli[i]) }
                        .setNegativeButton(android.R.string.cancel, null).show()
                }
            }
        }
        pozabi.setOnClickListener { kljucAsistentke.izbrisi(); sporocilo = null; obSpremembi(); narisi() }
        stikalo.setOnCheckedChangeListener { _, v ->
            if (v != nastavitveAsistentke.brezplacni()) { nastavitveAsistentke.nastaviBrezplacne(v); obSpremembi(); narisi() }
        }
    }

    private fun opisStanja(st: StanjeOpenRouter?): String? {
        if (st == null) return null
        val deli = listOfNotNull(
            when (st.brezplacniRacun) { true -> a.getString(R.string.asist_or_account_free); false -> a.getString(R.string.asist_or_account_paid); null -> null },
            if (st.dnevnoPreostalo != null && st.dnevnoMeja != null) a.getString(R.string.asist_or_daily_fmt, st.dnevnoPreostalo, st.dnevnoMeja) else null,
        )
        return deli.joinToString(" ").ifEmpty { null }
    }

    private fun razdelek(
        naslov: Int, opomba: Int, polja: List<Int>, skrita: List<Boolean>,
        povezan: () -> String?,
        preveri: (List<String>) -> IzidOrodja,
        shrani: (List<String>, IzidOrodja.Besedilo) -> Unit,
        pozabi: () -> Unit,
    ) {
        fun vrstica(v: View, zgoraj: Int) = vsebnik.addView(
            v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
        )
        val glava = TextView(a).apply { setTextAppearance(R.style.Gw_Body); setText(naslov); typeface = android.graphics.Typeface.DEFAULT_BOLD }
        vrstica(glava, 16)
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(opomba) }, 4)
        val vnosi = polja.mapIndexed { i, hint ->
            EditText(a, null, 0, R.style.Gw_Field).apply {
                setHint(hint)
                isFocusable = true
                isFocusableInTouchMode = true
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
                inputType = InputType.TYPE_CLASS_TEXT or (if (skrita[i]) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)
                filters = arrayOf(android.text.InputFilter.LengthFilter(200))
            }.also { vrstica(it, 8) }
        }
        val gumbShrani = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.tool_save) }
        vrstica(gumbShrani, 8)
        val stanje = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        vrstica(stanje, 8)
        val gumbPozabi = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.tool_forget) }
        vrstica(gumbPozabi, 8)

        var sporocilo: String? = null
        fun narisi() {
            val p = povezan()
            vnosi.forEach { it.visibility = if (p == null) View.VISIBLE else View.GONE }
            gumbShrani.visibility = if (p == null) View.VISIBLE else View.GONE
            gumbShrani.isEnabled = !caka
            gumbPozabi.visibility = if (p != null) View.VISIBLE else View.GONE
            stanje.text = sporocilo ?: p ?: a.getString(R.string.tool_not_connected)
        }
        osveziVse.add(::narisi)

        gumbShrani.setOnClickListener {
            if (caka) return@setOnClickListener
            val v = vnosi.map { it.text.toString().trim() }
            if (v.any { it.isEmpty() }) { sporocilo = a.getString(R.string.tool_err_format); narisi(); return@setOnClickListener }
            caka = true; sporocilo = a.getString(R.string.tool_checking); narisi()
            nit.execute {
                val izid = try { preveri(v) } catch (e: Exception) { IzidOrodja.Napaka("omrezje") }
                glavna.post {
                    if (a.isFinishing) return@post
                    caka = false
                    when (izid) {
                        is IzidOrodja.Besedilo -> {
                            shrani(v, izid); vnosi.forEach { it.setText("") }; sporocilo = null; obSpremembi()
                            vnosi.forEach { it.clearFocus() }
                            (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)
                                ?.hideSoftInputFromWindow(vsebnik.windowToken, 0)
                        }
                        is IzidOrodja.Napaka -> sporocilo = a.getString(
                            when (izid.razlog) {
                                "kljuc" -> R.string.tool_err_key
                                "oblika" -> R.string.tool_err_format
                                "meja" -> R.string.tool_err_limit
                                "racun" -> R.string.tool_err_account
                                else -> R.string.tool_err_net
                            },
                        )
                    }
                    osvezi()
                }
            }
        }
        gumbPozabi.setOnClickListener { pozabi(); sporocilo = null; obSpremembi(); narisi() }
    }
}
