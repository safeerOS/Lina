package si.safeer.lina.asistent

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import si.safeer.lina.samostojna.Asistent
import si.safeer.lina.samostojna.KoledarIzvajalec
import si.safeer.lina.samostojna.GoogleZetonOsvezevalnik
import si.safeer.lina.samostojna.PrijavaGoogle
import si.safeer.lina.samostojna.ProjektGoogle
import si.safeer.lina.samostojna.VertexOdjemalec
import si.safeer.lina.samostojna.poPrijaviGoogle
import si.safeer.lina.samostojna.vklopiVertex
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.ustvariOdjemalca
import si.safeer.lina.samostojna.IzbiraAsistentke
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.Odgovor
import si.safeer.lina.samostojna.SistemskoNavodilo
import si.safeer.lina.samostojna.dodajZapisek
import si.safeer.lina.samostojna.izbrisiZapisek
import si.safeer.lina.samostojna.vidniZapiski
import si.safeer.lina.samostojna.Zapisek
import si.safeer.lina.samostojna.NAJVEC_BAJTOV_PRIPONK
import si.safeer.lina.samostojna.NAJVEC_PRIPONK
import si.safeer.lina.samostojna.PRIVZETA_ZAHTEVA_PRIPONKE
import si.safeer.lina.samostojna.PripravljenaPriponka
import si.safeer.lina.samostojna.besediloZPriponkami
import si.safeer.lina.samostojna.pripraviPriponko
import java.time.LocalDate
import java.time.ZonedDateTime
import java.util.UUID
import java.util.concurrent.Executors

class LinaPogovorPogled(
    private val a: Activity,
    private val nazaj: () -> Unit = {},
    /** Odpre podmeni Mozgani v Nastavitvah (namig v praznem pogovoru brez kljuca). */
    private val odpriNastavitve: () -> Unit = {},
    /** Povezava z Lino na racunalniku (nalogo podpise telefon, prevzame jo Claude Code). */
    private val racunalnikPovezan: () -> Boolean = { false },
    private val posljiRacunalniku: (String) -> Boolean = { false },
) {
    private val glavna = Handler(Looper.getMainLooper())
    private val nit = Executors.newSingleThreadExecutor()
    private val zapiski = ZapiskiShramba(a)
    private val googleShramba = GoogleShramba(a)
    private val prenos = AndroidPrenos()
    private val google = GoogleZetonOsvezevalnik(SkupniKljuci.shrambaZaPonudnika(a, Ponudnik.VERTEX), prenos)
    private var asistent: Asistent? = null
    private var asistentDan: LocalDate? = null
    private var caka = false
    /** Sporocila na zaslonu (true = Lina). Ob zagonu se nalozi zadnjih [NAJVEC_PRIKAZANIH] iz trajnega pogovora. */
    private val sporocila = mutableListOf<Pair<Boolean, String>>()
    private var nalozeno = false
    /** Priponke za naslednje sporocilo (22. 11. 2026); prebrane in preverjene ob izbiri. */
    private val priponke = mutableListOf<PripravljenaPriponka>()
    private val vrsticaPriponk: LinearLayout by lazy { a.findViewById(R.id.assistantComposerAttachments) }

    private val info: TextView = a.findViewById(R.id.assistantLocalInfo)
    private val namig: TextView = a.findViewById<TextView>(R.id.assistantSetupHint).apply {
        // Uporabnik brez kljuca ne isce nastavitev sam: namig je gumb, ki odpre pravi podmeni (22. 11. 2026).
        setOnClickListener { odpriNastavitve() }
        isClickable = true
    }
    private val klepetBlok: View = a.findViewById(R.id.assistantChatBlock)
    private val klepetDnevnik: LinearLayout = a.findViewById(R.id.assistantChatLog)
    private val klepetPrazno: View = a.findViewById(R.id.chatEmpty)
    private val klepetPredlogi: LinearLayout = a.findViewById(R.id.chatChips)
    private val klepetDrsno: android.widget.ScrollView = a.findViewById(R.id.chatScroll)
    private val zapiskiPrazno: View = a.findViewById(R.id.notesEmpty)
    private val klepetVnos: EditText = a.findViewById(R.id.assistantChatInput)
    private val klepetPosli: View = a.findViewById(R.id.assistantChatSend)
    private val zapisekNaslov: TextView = a.findViewById(R.id.assistantNotesTitle)
    private val zapiskiSeznam: LinearLayout = a.findViewById(R.id.assistantNotesList)
    private val izvoz = ZapiskiIzvoz(a)
    private val izvozInfo: TextView = a.findViewById(R.id.notesStorageInfo)
    private val izvozStanje: TextView = a.findViewById(R.id.notesStorageStatus)
    private val izvozIzberi: Button = a.findViewById(R.id.notesStoragePick)
    private val izvozPrivzeto: Button = a.findViewById(R.id.notesStorageDefault)
    /** Povecamo ob spremembi nastavitev: odgovor, ki je bil zahtevan prej, se zavrze. */
    private var rod = 0
    private val nastavitveKljuci = NastavitveKljuciPogled(a, prenos, nit, glavna) {
        rod++; asistent = null
        // Ključ ali prijava sta se spremenila: lokalni prehod mora steči takoj (19. 11. 2026 je bil po vnosu ključa zagnan šele ob ponovnem zagonu aplikacije).
        Thread({ si.safeer.lina.transport.GatewayRuntime.checkLokalniPrehod() }, "lokalni-prehod-zagon").start()
        osvezi()
    }

    init {
        a.findViewById<Button>(R.id.assistantBackToAssistant).setOnClickListener { nazaj() }
        klepetPosli.setOnClickListener { poslji() }
        a.findViewById<View>(R.id.assistantChatMic).setOnClickListener { govori() }
        a.findViewById<View>(R.id.assistantChatAttach).setOnClickListener { izberiPriponke() }
        for (predlog in listOf(R.string.chat_chip_today, R.string.chat_chip_calls, R.string.chat_chip_remind)) {
            klepetPredlogi.addView(Button(a, null, 0, R.style.Gw_Button).apply {
                setText(predlog)
                background = a.getDrawable(R.drawable.bg_chip)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
                setOnClickListener {
                    val besedilo = a.getString(predlog)
                    // »Opomni me …« potrebuje nadaljevanje: v polje, kurzor na konec; ostala dva se poslji takoj.
                    if (besedilo.endsWith("…")) {
                        klepetVnos.setText(besedilo.removeSuffix("…").trimEnd() + " ")
                        klepetVnos.setSelection(klepetVnos.text.length)
                        klepetVnos.requestFocus()
                    } else { klepetVnos.setText(besedilo); poslji() }
                }
            })
        }
        izvozIzberi.setOnClickListener {
            try { a.startActivityForResult(ZapiskiIzvoz.izbiraMape(), ZapiskiIzvoz.ZAHTEVA_MAPA) }
            catch (e: ActivityNotFoundException) { izvozStanje.text = a.getString(R.string.notes_storage_no_picker) }
        }
        izvozPrivzeto.setOnClickListener { izvoz.nastaviMapo(null); izvoziZapiske(); osveziIzvoz() }
        if (vidniZapiski(zapiski.beri()).isNotEmpty()) izvoziZapiske()
    }

    private fun jeVertex() = SkupniKljuci.aktivniPonudnik(a) == Ponudnik.VERTEX
    private fun imaDostop() = imaKljucAsistentke() ||
        if (jeVertex()) google.prijavljen() && googleShramba.projekt() != null else SkupniKljuci.preberiKljucAktivnegaPonudnika(a) != null
    private fun imaKljucAsistentke() = SkupniKljuci.shrambaAsistentke(a).preberi() != null

    fun obdelajPovezavo(povezava: String) {
        nastavitveKljuci.obdelajPovezavo(povezava)
    }

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    companion object {
        const val ZAHTEVA_GOVOR = 7311
        const val ZAHTEVA_PRIPONKA = 7312
        private const val NAJVEC_PRIKAZANIH = 40
    }

    /** Mikrofon: prepoznava govora sistema (slovenscina), besedilo gre v polje, da ga uporabnik pregleda pred posiljanjem. */
    private fun govori() {
        val namen = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, java.util.Locale.getDefault().toLanguageTag())
        try { a.startActivityForResult(namen, ZAHTEVA_GOVOR) }
        catch (e: ActivityNotFoundException) { klepetVnos.requestFocus() }
    }

    fun vstaviGovor(besedilo: String) {
        if (besedilo.isBlank()) return
        val prej = klepetVnos.text.toString().trimEnd()
        klepetVnos.setText(if (prej.isEmpty()) besedilo else "$prej $besedilo")
        klepetVnos.setSelection(klepetVnos.text.length)
    }

    private fun naloziZgodovino() {
        if (nalozeno) return
        nalozeno = true
        runCatching {
            for (p in PogovorSkupni.dobi(a).vsa().takeLast(NAJVEC_PRIKAZANIH)) sporocila += (p.vloga == "lina") to p.besedilo
        }
    }

    /**
     * Znanje 22. 11. 2026 (skil safeer-lina-tajnica-asistent-ui-znanje): pod odgovorom Line »Kopiraj«, pod napako »Poskusi znova«
     * (besedilo uporabnika ostane), samodejni pomik na dno samo, ce je uporabnik ze na dnu ali je pravkar poslal sporocilo.
     */
    private var napakaZaPonovitev: Triple<String, String, List<si.safeer.lina.samostojna.Priponka>>? = null
    /** Dodatek (npr. blok »Za klic nazaj«) neuspele prosnje: ob ponovitvi se pripne enako kot prvic. */
    private var dodatekZaPonovitev: String = ""
    private var prisilnoNaDno = true

    private fun jeNaDnu(): Boolean {
        val vsebina = klepetDrsno.getChildAt(0) ?: return true
        return klepetDrsno.scrollY + klepetDrsno.height >= vsebina.bottom - dp(96)
    }

    private fun kopiraj(besedilo: String) {
        val odlozisce = a.getSystemService(android.content.ClipboardManager::class.java) ?: return
        odlozisce.setPrimaryClip(android.content.ClipData.newPlainText("Lina", besedilo))
        // Android 13+ sam pokaze potrditev kopiranja; prej kratko obvestilo.
        if (android.os.Build.VERSION.SDK_INT < 33) opozori(a.getString(R.string.chat_copied))
    }

    private fun dejanje(besedilo: String, klik: () -> Unit) = TextView(a).apply {
        setTextAppearance(R.style.Gw_Muted)
        text = besedilo
        minHeight = dp(40)
        gravity = android.view.Gravity.CENTER_VERTICAL
        setPadding(dp(14), 0, dp(14), 0)
        isClickable = true
        isFocusable = true
        setOnClickListener { klik() }
    }

    private fun ponovi() {
        val (prikaz, vnos, binarne) = napakaZaPonovitev ?: return
        if (caka) return
        napakaZaPonovitev = null
        // Odstrani neuspelo prosnjo in napako; poslje se znova enako (tudi priponke).
        repeat(2) { odstraniZadnjo() }
        posljiBesedilo(prikaz, vnos, binarne, dodatek = dodatekZaPonovitev)
    }

    private fun narisiSporocila() {
        val doDna = prisilnoNaDno || jeNaDnu()
        prisilnoNaDno = false
        klepetDnevnik.removeAllViews()
        val razmislja = a.getString(R.string.local_thinking)
        for ((i, par) in sporocila.withIndex()) {
            val (jeLina, besedilo) = par
            val prikazano = if (jeLina) si.safeer.lina.samostojna.besediloBrezMarkdowna(besedilo) else besedilo
            klepetDnevnik.addView(TextView(a, null, 0, R.style.Gw_Body).apply {
                text = prikazano
                setTextIsSelectable(true)
                background = a.getDrawable(if (jeLina) R.drawable.bg_bubble_lina else R.drawable.bg_bubble_jaz)
                if (!jeLina) setTextColor(0xFFFFFFFF.toInt())
                setPadding(dp(14), dp(10), dp(14), dp(10))
                maxWidth = (a.resources.displayMetrics.widthPixels * 0.8f).toInt()
                contentDescription = (if (jeLina) a.getString(R.string.local_lina) else a.getString(R.string.local_you)) + ": " + prikazano
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(8)
                    gravity = if (jeLina) android.view.Gravity.START else android.view.Gravity.END
                }
            })
            if (jeLina && besedilo != razmislja) {
                val vrstica = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
                vrstica.addView(dejanje(a.getString(R.string.chat_copy)) { kopiraj(besedilo) })
                if (i == sporocila.lastIndex && napakaZaPonovitev != null) {
                    vrstica.addView(dejanje(a.getString(R.string.chat_retry)) { ponovi() })
                }
                klepetDnevnik.addView(vrstica)
            }
        }
        // Brez fullScroll: ta prestavi fokus na zadnji gumb (»Kopiraj«) in polju za vnos vzame tipkovnico (lastnik 22. 11. 2026).
        if (doDna) klepetDrsno.post {
            val vsebina = klepetDrsno.getChildAt(0)
            if (vsebina != null) klepetDrsno.scrollTo(0, maxOf(0, vsebina.height - klepetDrsno.height + klepetDrsno.paddingBottom))
        }
    }

    /** Pogovor je na voljo (ponudnik ima kljuc ali prijavo): takrat je vrstica za vnos vidna v zavihku Lina. */
    fun imaKlepet(): Boolean = klepetBlok.visibility == View.VISIBLE

    fun osvezi() {
        val imaKljuc = imaDostop()
        val ponudnik = SkupniKljuci.aktivniPonudnik(a)
        info.text = a.getString(R.string.local_info)
        namig.text = if (imaKljuc) a.getString(R.string.assistant_setup_hint_active_fmt, ponudnik.oznaka) else a.getString(R.string.assistant_setup_hint_missing)
        naloziZgodovino()
        klepetBlok.visibility = if (imaKljuc) View.VISIBLE else View.GONE
        // Prazno stanje samo pred prvim sporocilom; brez kljuca pove, kje se nastavi ponudnik (predlogov ni).
        klepetPrazno.visibility = if (sporocila.isEmpty() || !imaKljuc) View.VISIBLE else View.GONE
        klepetPredlogi.visibility = if (imaKljuc) View.VISIBLE else View.GONE
        namig.visibility = if (imaKljuc) View.GONE else View.VISIBLE
        narisiSporocila()
        klepetPosli.isEnabled = !caka
        nastavitveKljuci.osvezi()
        osveziZapiske()
        osveziIzvoz()
    }

    private fun shraniZapiske(novi: List<Zapisek>) {
        zapiski.shrani(novi)
        izvoziZapiske()
    }

    private fun izvoziZapiske() {
        val seznam = zapiski.beri()
        nit.execute {
            izvoz.izvozi(seznam)
            glavna.post { if (!a.isFinishing) osveziIzvoz() }
        }
    }

    fun obdelajMapo(uri: Uri) {
        try {
            a.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        } catch (e: SecurityException) {
            izvozStanje.text = a.getString(R.string.notes_storage_fail)
            return
        }
        izvoz.nastaviMapo(uri)
        izvoziZapiske()
        osveziIzvoz()
    }

    private fun osveziIzvoz() {
        izvozInfo.text = a.getString(R.string.notes_storage_info_fmt, izvoz.opis())
        val (cas, uspelo) = izvoz.zadnji()
        izvozStanje.text = when {
            cas == 0L -> a.getString(R.string.notes_storage_empty)
            uspelo -> a.getString(R.string.notes_storage_ok_fmt, izvoz.oblikaCasa(cas))
            else -> a.getString(R.string.notes_storage_fail)
        }
        izvozPrivzeto.visibility = if (izvoz.mapa() != null) View.VISIBLE else View.GONE
    }

    private fun osveziZapiske() {
        val vidni = vidniZapiski(zapiski.beri())
        zapisekNaslov.text = a.getString(R.string.local_notes_title) + if (vidni.isEmpty()) "" else " (" + vidni.size + ")"
        zapiskiPrazno.visibility = if (vidni.isEmpty()) View.VISIBLE else View.GONE
        val oblika = java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.MEDIUM, java.time.format.FormatStyle.SHORT)
        zapiskiSeznam.removeAllViews()
        for (z in vidni) {
            val vrstica = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
            val vsebina = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
            vsebina.addView(TextView(a).apply {
                text = oblika.format(java.time.Instant.ofEpochMilli(z.cas).atZone(java.time.ZoneId.systemDefault()))
                setTextAppearance(R.style.Gw_Muted)
            })
            vsebina.addView(TextView(a).apply { text = z.besedilo; setTextIsSelectable(true); setTextAppearance(R.style.Gw_Body) })
            vrstica.addView(vsebina, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            vrstica.addView(Button(a, null, 0, R.style.Gw_Button).apply {
                text = a.getString(R.string.local_note_delete)
                setOnClickListener { shraniZapiske(izbrisiZapisek(zapiski.beri(), z.id, System.currentTimeMillis())); osveziZapiske() }
            })
            zapiskiSeznam.addView(vrstica)
        }
    }

    private fun trenutniAsistent(): Asistent {
        val zdaj = ZonedDateTime.now()
        val danes = zdaj.toLocalDate()
        val obstojeci = asistent
        if (obstojeci != null && asistentDan == danes) return obstojeci
        // A4, C (24. 11. 2026): kljuc samo za asistentko ima prednost; brez njega isti ponudnik kot klici (A6).
        val nastavitveAsistentke = AsistentkaShramba(a)
        val odjemalec = IzbiraAsistentke.odjemalec(SkupniKljuci.shrambaAsistentke(a), nastavitveAsistentke.model(), nastavitveAsistentke.brezplacni(), prenos)
            ?: if (jeVertex()) VertexOdjemalec(google, { googleShramba.projekt() }, prenos = prenos) else ustvariOdjemalca(SkupniKljuci.aktivniPonudnik(a), SkupniKljuci.shrambaZaPonudnika(a, SkupniKljuci.aktivniPonudnik(a)), prenos)
        val orodja = nastavitveKljuci.orodja()
        val navodilo = SistemskoNavodilo.zgradi(zdaj, iskanje = orodja.iskanjeNaVoljo, branje = orodja.branjeNaVoljo, koledar = true)
        vprasajZaKoledar()
        // Trajna zgodovina seje in zapiski kot podatek (lastnik 23. 11. 2026: Lina je pozabljala pogovor in ni brala zapiskov).
        return Asistent(odjemalec, navodilo, orodja = orodja, spomin = SpominPogovorovPogled.spomin(a), racunalnikPovezan = racunalnikPovezan,
            koledar = KoledarIzvajalec(KoledarAndroid(a)), seja = SpominPogovorovPogled.seja(a),
            zapiski = { vidniZapiski(zapiski.beri()).map { it.besedilo } }).also { asistent = it; asistentDan = danes }
    }

    /** Enkrat (ob prvem pogovoru) vpraša za dovoljenje branja koledarja; zavrnitev se ne ponavlja (orodje takrat pove, da dovoljenja ni). */
    private fun vprasajZaKoledar() {
        val prefs = a.getSharedPreferences("lina_koledar", android.content.Context.MODE_PRIVATE)
        if (prefs.getBoolean("vprasano", false)) return
        if (a.checkSelfPermission(android.Manifest.permission.READ_CALENDAR) == android.content.pm.PackageManager.PERMISSION_GRANTED) return
        prefs.edit().putBoolean("vprasano", true).apply()
        a.requestPermissions(arrayOf(android.Manifest.permission.READ_CALENDAR), 1010)
    }

    /**
     * Lina sama odgovori Claude Code (23. 11. 2026): klic modela na niti pogovora (Asistent ni varen za hkratno rabo); rezultat
     * na glavni niti. Podpis in posiljanje naredi AsistentKontroler.
     */
    fun odgovoriClaudeCode(
        naloga: String, vprasanje: String, jeIzid: Boolean, izid: (si.safeer.lina.samostojna.SamodejniOdgovor.Odlocitev) -> Unit,
    ) {
        val asist = trenutniAsistent()
        nit.execute {
            val o = try { asist.odgovorZaClaudeCode(naloga, vprasanje, jeIzid) }
                catch (e: Exception) { si.safeer.lina.samostojna.SamodejniOdgovor.Odlocitev.VprasajLastnika(e.javaClass.simpleName) }
            glavna.post { if (!a.isFinishing) izid(o) }
        }
    }

    /** Obvestilo Line v pogovoru (npr. Claude Code sprasuje in Lina ne ve odgovora); ostane v trajnem pogovoru. */
    fun obvestilo(besedilo: String) {
        sporocila += true to besedilo
        runCatching { PogovorSkupni.dobi(a).dodaj("lina", besedilo) }
        osvezi()
    }

    /** Ali ima Lina mozgane (kljuc ali prijava Google s projektom); uporablja povzetek klicatelja v zavihku Klici. */
    fun imaMozgane(): Boolean = imaDostop()

    /**
     * Povzetek klicatelja iz zavihka Klici (22. 11. 2026): v klepetu se pokaze kratka prosnja, model dobi celoten poziv s
     * sporocili. Vrne false, ce Lina se caka na prejsnji odgovor.
     */
    fun posljiPoziv(prikaz: String, poziv: String, dodatek: String = ""): Boolean {
        if (caka) return false
        posljiBesedilo(prikaz, poziv, dodatek = dodatek)
        return true
    }

    private fun poslji() {
        val vnos = klepetVnos.text.toString().trim()
        if ((vnos.isEmpty() && priponke.isEmpty()) || caka) return
        klepetVnos.setText("")
        (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(klepetVnos.windowToken, 0)
        if (priponke.isEmpty()) { posljiBesedilo(vnos, vnos); return }
        val izbrane = priponke.toList()
        priponke.clear()
        narisiPriponke()
        val imena = izbrane.joinToString(", ") { ime(it) }
        val prikaz = listOf(vnos, "📎 $imena").filter { it.isNotEmpty() }.joinToString("\n")
        val binarne = izbrane.filterIsInstance<PripravljenaPriponka.Binarna>().map { it.priponka }
        posljiBesedilo(prikaz, besediloZPriponkami(vnos.ifEmpty { PRIVZETA_ZAHTEVA_PRIPONKE }, izbrane), binarne)
    }

    private fun ime(p: PripravljenaPriponka) = when (p) {
        is PripravljenaPriponka.Binarna -> p.priponka.ime
        is PripravljenaPriponka.Besedilna -> p.ime
        is PripravljenaPriponka.Napaka -> ""
    }

    /** Sistemski izbirnik datotek (brez dovoljenja za pomnilnik): slike, PDF, video, zvok, besedilo; vec naenkrat. */
    private fun izberiPriponke() {
        val namen = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf", "video/*", "audio/*", "text/*", "application/json"))
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        try { a.startActivityForResult(namen, ZAHTEVA_PRIPONKA) }
        catch (e: ActivityNotFoundException) { opozori(a.getString(R.string.chat_attach_no_picker)) }
    }

    /** Rezultat izbirnika (DialerActivity.onActivityResult). Branje in preverjanje na ozadni niti, meja 15 MB na datoteko. */
    fun dodajPriponke(data: Intent?) {
        val uriji = buildList {
            data?.clipData?.let { c -> for (i in 0 until c.itemCount) add(c.getItemAt(i).uri) }
            if (isEmpty()) data?.data?.let { add(it) }
        }
        if (uriji.isEmpty()) return
        val ponudnik = if (imaKljucAsistentke()) Ponudnik.OPENROUTER else SkupniKljuci.aktivniPonudnik(a)
        nit.execute {
            val izidi = uriji.map { uri -> preberiPriponko(uri, ponudnik) }
            glavna.post {
                if (a.isFinishing) return@post
                for (izid in izidi) {
                    when {
                        izid is PripravljenaPriponka.Napaka -> opozori(izid.sporocilo)
                        priponke.size >= NAJVEC_PRIPONK -> opozori(a.getString(R.string.chat_attach_too_many, NAJVEC_PRIPONK))
                        else -> priponke += izid
                    }
                }
                narisiPriponke()
            }
        }
    }

    private fun preberiPriponko(uri: Uri, ponudnik: Ponudnik): PripravljenaPriponka {
        val r = a.contentResolver
        var ime: String? = null
        var velikost = -1L
        runCatching {
            r.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE), null, null, null)?.use {
                if (it.moveToFirst()) {
                    ime = it.getString(0)
                    if (!it.isNull(1)) velikost = it.getLong(1)
                }
            }
        }
        if (velikost > NAJVEC_BAJTOV_PRIPONK) return PripravljenaPriponka.Napaka(a.getString(R.string.chat_attach_too_big, ime ?: ""))
        val bajti = try {
            r.openInputStream(uri)?.use { vhod ->
                // Branje z mejo: ponudnik velikosti lahko ne pove, zato preberemo najvec meja + 1 bajt.
                val izhod = java.io.ByteArrayOutputStream()
                val med = ByteArray(64 * 1024)
                var skupaj = 0
                while (true) {
                    val n = vhod.read(med)
                    if (n < 0) break
                    skupaj += n
                    if (skupaj > NAJVEC_BAJTOV_PRIPONK) return PripravljenaPriponka.Napaka(a.getString(R.string.chat_attach_too_big, ime ?: ""))
                    izhod.write(med, 0, n)
                }
                izhod.toByteArray()
            }
        } catch (e: Exception) { null } ?: return PripravljenaPriponka.Napaka(a.getString(R.string.chat_attach_read_fail, ime ?: ""))
        return pripraviPriponko(ime, bajti, ponudnik)
    }

    private fun narisiPriponke() {
        vrsticaPriponk.removeAllViews()
        for (p in priponke.toList()) {
            vrsticaPriponk.addView(TextView(a).apply {
                setTextAppearance(R.style.Gw_Muted)
                text = "📎 ${ime(p)}   ✕"
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
                minHeight = dp(40)
                gravity = android.view.Gravity.CENTER_VERTICAL
                contentDescription = a.getString(R.string.chat_attach_remove, ime(p))
                setOnClickListener { priponke.remove(p); narisiPriponke() }
            })
        }
        vrsticaPriponk.visibility = if (priponke.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun opozori(besedilo: String) {
        android.widget.Toast.makeText(a, besedilo, android.widget.Toast.LENGTH_LONG).show()
    }

    private fun posljiBesedilo(prikaz: String, vnos: String, binarne: List<si.safeer.lina.samostojna.Priponka> = emptyList(), dodatek: String = "") {
        caka = true
        napakaZaPonovitev = null
        prisilnoNaDno = true
        sporocila += false to prikaz
        sporocila += true to a.getString(R.string.local_thinking)
        osvezi()
        val asist = trenutniAsistent()
        val mojRod = rod
        nit.execute {
            val odgovor = try { asist.povej(vnos, binarne) } catch (e: Exception) { Odgovor.Napaka(e.javaClass.simpleName) }
            glavna.post {
                if (a.isFinishing) return@post
                if (mojRod != rod) { odstraniZadnjo(); caka = false; osvezi(); return@post }
                odstraniZadnjo()
                val besedilo = when (odgovor) {
                    is Odgovor.Besedilo -> if (dodatek.isBlank()) odgovor.besedilo else odgovor.besedilo.trimEnd() + "\n\n" + dodatek
                    is Odgovor.Zapisek -> {
                        shraniZapiske(dodajZapisek(zapiski.beri(), odgovor.besedilo, System.currentTimeMillis(), UUID.randomUUID().toString()))
                        a.getString(R.string.local_note_saved, odgovor.besedilo)
                    }
                    is Odgovor.Opomnik -> {
                        // 2j: pravi alarm ob casu; neveljaven ali pretekel cas se ne nastavi tiho, ampak se uporabniku pove.
                        val casMs = si.safeer.lina.samostojna.OpomnikCas.izracunaj(odgovor.cas, System.currentTimeMillis())
                        if (casMs == null) a.getString(R.string.local_reminder_bad, odgovor.besedilo)
                        else {
                            val natancno = si.safeer.lina.asistent.OpomnikAlarm.nastavi(
                                a, si.safeer.lina.samostojna.CakajociOpomnik(UUID.randomUUID().toString(), casMs, odgovor.besedilo),
                            )
                            val kdaj = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(casMs))
                            a.getString(R.string.local_reminder_set, odgovor.besedilo, kdaj) + if (natancno) "" else " " + a.getString(R.string.local_reminder_approx)
                        }
                    }
                    is Odgovor.NovaBudilka -> {
                        potrdiBudilko(odgovor)
                        a.getString(R.string.local_alarm_proposed, opisBudilke(odgovor))
                    }
                    is Odgovor.NoviDogodek -> {
                        val kdaj = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(odgovor.zacetekMs))
                        potrdiDogodek(odgovor)
                        a.getString(R.string.local_event_proposed, odgovor.naslov, kdaj)
                    }
                    is Odgovor.NalogaRacunalniku ->
                        if (posljiRacunalniku(odgovor.besedilo)) { asist.nalogaPredana(odgovor.besedilo); a.getString(R.string.local_task_sent, odgovor.besedilo) }
                        else a.getString(R.string.local_task_busy)
                    is Odgovor.Napaka -> when (odgovor.sporocilo) {
                        "Brez povezave" -> a.getString(R.string.local_err_offline)
                        "Prijava poteka" -> { google.odjava(); a.getString(R.string.local_google_relogin) }
                        else -> a.getString(R.string.local_err_generic, odgovor.sporocilo)
                    }
                }
                sporocila += true to besedilo
                if (odgovor is Odgovor.Napaka) { napakaZaPonovitev = Triple(prikaz, vnos, binarne); dodatekZaPonovitev = dodatek }
                if (odgovor !is Odgovor.Napaka) runCatching {
                    val trajen = PogovorSkupni.dobi(a)
                    trajen.dodaj("lastnik", prikaz)
                    trajen.dodaj("lina", besedilo)
                    SinhronizacijaZLino.zazeni(a, takoj = true)
                }
                caka = false
                osvezi()
            }
        }
    }

    /** Dogodek gre v koledar telefona sele po uporabnikovi potrditvi; brez dovoljenj se najprej zahtevajo (nato uporabnik znova povej). */
    private fun potrdiDogodek(d: Odgovor.NoviDogodek) {
        if (!KoledarAndroid.imaDovoljenja(a)) {
            a.requestPermissions(KoledarAndroid.DOVOLJENJA, KoledarAndroid.KODA_DOVOLJENJ)
            return
        }
        val kdaj = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(d.zacetekMs))
        android.app.AlertDialog.Builder(a)
            .setTitle(R.string.local_event_confirm_title)
            .setMessage("${d.naslov}\n$kdaj")
            .setPositiveButton(R.string.local_event_add) { _, _ ->
                nit.execute {
                    val ok = KoledarAndroid(a).dodaj(d.naslov, d.zacetekMs, d.konecMs)
                    glavna.post { android.widget.Toast.makeText(a, if (ok) R.string.local_event_added else R.string.local_event_failed, android.widget.Toast.LENGTH_LONG).show() }
                }
            }
            .setNegativeButton(R.string.local_event_cancel, null)
            .show()
    }

    /** Opis za uporabnika: ura, oznaka in dnevi (kratka imena dni v jeziku telefona). */
    private fun opisBudilke(b: Odgovor.NovaBudilka): String {
        val ura = String.format(java.util.Locale.ROOT, "%02d:%02d", b.ura, b.minuta)
        val imena = java.text.DateFormatSymbols.getInstance().shortWeekdays
        val dnevi = b.dnevi.joinToString(", ") { imena[(it % 7) + 1] }
        return listOf(ura, b.oznaka, dnevi).filter { it.isNotBlank() }.joinToString(" · ")
    }

    /** Budilka gre v aplikacijo Ura (AlarmClock.ACTION_SET_ALARM) sele po uporabnikovi potrditvi. */
    private fun potrdiBudilko(b: Odgovor.NovaBudilka) {
        android.app.AlertDialog.Builder(a)
            .setTitle(R.string.local_alarm_confirm_title)
            .setMessage(opisBudilke(b))
            .setPositiveButton(R.string.local_alarm_add) { _, _ ->
                val namen = android.content.Intent(android.provider.AlarmClock.ACTION_SET_ALARM)
                    .putExtra(android.provider.AlarmClock.EXTRA_HOUR, b.ura)
                    .putExtra(android.provider.AlarmClock.EXTRA_MINUTES, b.minuta)
                    .putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
                    .putExtra(android.provider.AlarmClock.EXTRA_VIBRATE, true)
                // Izrecno zvok budilke: brez njega Ura obstojeco (morda tiho) budilko ob isti uri samo vklopi in ta ostane tiha.
                android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)?.let {
                    namen.putExtra(android.provider.AlarmClock.EXTRA_RINGTONE, it.toString())
                }
                if (b.oznaka.isNotBlank()) namen.putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, b.oznaka)
                // ISO 1 = ponedeljek ... 7 = nedelja -> java.util.Calendar (nedelja = 1, ponedeljek = 2 ...).
                if (b.dnevi.isNotEmpty()) namen.putExtra(android.provider.AlarmClock.EXTRA_DAYS, ArrayList(b.dnevi.map { (it % 7) + 1 }))
                val ok = runCatching { a.startActivity(namen) }.isSuccess
                android.widget.Toast.makeText(a, if (ok) R.string.local_alarm_set else R.string.local_alarm_failed, android.widget.Toast.LENGTH_LONG).show()
            }
            .setNegativeButton(R.string.local_event_cancel, null)
            .show()
    }

    private fun odstraniZadnjo() {
        if (sporocila.isNotEmpty()) sporocila.removeAt(sporocila.lastIndex)
    }
}
