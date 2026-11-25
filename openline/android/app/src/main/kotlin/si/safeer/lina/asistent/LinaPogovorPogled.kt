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
import si.safeer.lina.pokaziVarno
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
import si.safeer.lina.samostojna.SamodejniOdjemalec
import si.safeer.lina.samostojna.IzbiraAsistentke
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.Odgovor
import si.safeer.lina.samostojna.SistemskoNavodilo
import si.safeer.lina.samostojna.SistemskiNadzor
import si.safeer.lina.samostojna.soglasja.Izvor
import si.safeer.lina.samostojna.soglasja.VrstaDejanja
import android.widget.CheckBox
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
import si.safeer.lina.samostojna.poizvedbaFts
import si.safeer.lina.samostojna.zahtevaIskanjaVDokumentih
import si.safeer.lina.samostojna.OdlocitevDeljenja
import si.safeer.lina.samostojna.ZavrnitevDeljenja
import si.safeer.lina.samostojna.odlociDeljenje
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
    /** Izmerjena dosegljivost racunalnika (klice se v ozadju ob vprasanju); seznanitev je [racunalnikSeznanjen] (naloga 11). */
    private val racunalnikPovezan: () -> Boolean = { false },
    private val racunalnikSeznanjen: () -> Boolean = { false },
    /** Poslje nalogo; izid (sprejeta s stevilko ali napaka) pride na glavni niti, sele po odgovoru racunalnika. */
    private val posljiRacunalniku: (String, (si.safeer.lina.samostojna.IzidPredaje, String?) -> Unit) -> Unit = { _, izid -> izid(si.safeer.lina.samostojna.IzidPredaje.NEDOSEGLJIV, null) },
    /** Shrani nalogo, ki jo telefon poslje, ko bo racunalnik dosegljiv (lastnikova potrditev v oknu). */
    private val shraniZaPozneje: (String, (si.safeer.lina.samostojna.IzidPredaje, String?) -> Unit) -> Boolean = { _, _ -> false },
) {
    private val glavna = Handler(Looper.getMainLooper())
    private val nit = Executors.newSingleThreadExecutor()
    private val zapiski = ZapiskiShramba(a)
    private val googleShramba = GoogleShramba(a)
    private val prenos = AndroidPrenos()
    private val google = GoogleZetonOsvezevalnik(SkupniKljuci.shrambaZaPonudnika(a, Ponudnik.VERTEX), prenos)
    /** Sistemski nadzor telefona in skupni modul soglasij (24. 11. 2026). */
    private val sistem = SistemskiNadzorAndroid(a)
    private val soglasja = SistemskiNadzorAndroid.soglasja(a)
    private var asistent: Asistent? = null
    private var asistentDan: LocalDate? = null
    private var caka = false
    /** Sporocila na zaslonu (true = Lina). Ob zagonu se nalozi zadnjih [NAJVEC_PRIKAZANIH] iz trajnega pogovora. */
    private val sporocila = mutableListOf<Pair<Boolean, String>>()
    private var nalozeno = false
    /** Priponke za naslednje sporocilo (22. 11. 2026); prebrane in preverjene ob izbiri. */
    private val priponke = mutableListOf<PripravljenaPriponka>()
    /** Besedila lokalnih rezultatov na zaslonu (pod njimi je gumb »Pošlji Lini«). */
    private val lokalniRezultati = mutableSetOf<String>()
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
        a.findViewById<View>(R.id.assistantChatPhoto).setOnClickListener { fotografiraj() }
        a.findViewById<android.widget.Switch>(R.id.assistantShareSwitch).apply {
            isChecked = sprejemaDeljenje(a)
            setOnCheckedChangeListener { _, vklop -> nastaviDeljenje(a, vklop) }
        }
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
        const val ZAHTEVA_FOTO = 7313
        const val KODA_MIKROFON = 7314
        private const val NAJVEC_PRIKAZANIH = 40
        private const val NASTAVITVE_VIDA = "lina_vid"
        private const val KLJUC_DELJENJE = "sprejemaj_deljenje"

        /** Stikalo »Sprejemaj slike iz drugih aplikacij« (lastnik 24. 11. 2026: privzeto vklopljeno). */
        fun sprejemaDeljenje(c: android.content.Context) =
            c.getSharedPreferences(NASTAVITVE_VIDA, android.content.Context.MODE_PRIVATE).getBoolean(KLJUC_DELJENJE, true)

        fun nastaviDeljenje(c: android.content.Context, vklop: Boolean) =
            c.getSharedPreferences(NASTAVITVE_VIDA, android.content.Context.MODE_PRIVATE).edit().putBoolean(KLJUC_DELJENJE, vklop).apply()
    }

    /**
     * Mikrofon (lastnik 24. 11. 2026, hrupna tiskarna): s stikalom »Zmanjsanje hrupa« (privzeto vklopljeno) in ponudnikom, ki bere zvok,
     * Lina zajame sama (VOICE_COMMUNICATION + NoiseSuppressor/AEC/AGC, konec govora odporen na hrup) in posnetek prepise isti ponudnik
     * kot pogovor. Sicer (stikalo izklopljeno, drug ponudnik, brez dovoljenja) sistemska prepoznava kot prej. Drugi dotik konca posnetek.
     * Besedilo gre v obeh primerih v polje, da ga uporabnik pregleda pred posiljanjem.
     */
    private fun govori() {
        zajem?.let { it.ustavi(); return }
        val ponudnik = if (imaKljucAsistentke()) Ponudnik.OPENROUTER else SkupniKljuci.aktivniPonudnik(a)
        if (imaDostop() && si.safeer.lina.samostojna.lastniZajemGovora(ZmanjsanjeHrupa.vklopljeno(a), ponudnik)) {
            if (a.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) zacniZajem()
            else a.requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), KODA_MIKROFON)
            return
        }
        sistemskaPrepoznava()
    }

    /** Izid vprasanja za mikrofon (DialerActivity): brez dovoljenja sistemska prepoznava kot prej. */
    fun poDovoljenjuMikrofona(dano: Boolean) = if (dano) zacniZajem() else sistemskaPrepoznava()

    /** Aktivnost gre v ozadje: zajem se ustavi in zavrze (mikrofon ne tece v ozadju). */
    fun ustaviMikrofon() { zajem?.ustavi(zavrzi = true); zajem = null }

    private var zajem: ZajemMikrofona? = null

    private fun zacniZajem() {
        if (zajem != null) return
        opozori(a.getString(R.string.chat_mic_listening))
        val nov = ZajemMikrofona { pcm, govor ->
            glavna.post {
                zajem = null
                if (a.isFinishing) return@post
                if (govor) prepisi(pcm) else opozori(a.getString(R.string.chat_mic_no_speech))
            }
        }
        zajem = nov
        nov.zacni()
    }

    private fun prepisi(pcm: ByteArray) {
        opozori(a.getString(R.string.chat_mic_transcribing))
        val odjemalec = odjemalecAsistentke()
        val wav = si.safeer.lina.samostojna.wavIzPcm(pcm)
        val posnetek = si.safeer.lina.samostojna.Priponka("govor.wav", "audio/wav", java.util.Base64.getEncoder().encodeToString(wav), si.safeer.lina.samostojna.VrstaPriponke.ZVOK)
        val mojRod = rod
        nit.execute {
            val prepis = try {
                si.safeer.lina.samostojna.prepisIzRezultata(odjemalec.poslji(
                    listOf(si.safeer.lina.samostojna.Sporocilo("user", "Prepiši posnetek.", listOf(posnetek))), si.safeer.lina.samostojna.NAVODILO_PREPISA))
            } catch (e: Exception) { "" }
            glavna.post {
                if (a.isFinishing || mojRod != rod) return@post
                if (prepis.isEmpty()) opozori(a.getString(R.string.chat_mic_fail)) else vstaviGovor(prepis)
            }
        }
    }

    private fun sistemskaPrepoznava() {
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
    /** Neuspela prosnja je bila nezaupana (N2): ponovitev jo poslje enako oznaceno. */
    private var nezaupanoZaPonovitev = false
    /** V osnutku je besedilo iz Deli (druga aplikacija): naslednja poslana prosnja je nezaupana (N2). */
    // T1 (pregled 1915): DialerActivity jo shrani v onSaveInstanceState (EditText osnutek obnovi sam, zastavice ne).
    var deljenoVOsnutku = false
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
        posljiBesedilo(prikaz, vnos, binarne, dodatek = dodatekZaPonovitev, nezaupano = nezaupanoZaPonovitev)
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
                // Lokalni rezultat iskanja po dokumentih gre Lini (v oblak) samo, ce ga uporabnik poslje sam.
                if (besedilo in lokalniRezultati) vrstica.addView(dejanje(a.getString(R.string.docs_chat_send)) {
                    if (!caka) a.getString(R.string.docs_chat_send_prefix).let { posljiBesedilo(it + "\n\n" + besedilo, it + "\n\n" + besedilo, nezaupano = true) }
                })
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

    private fun odjemalecAsistentke(): si.safeer.lina.samostojna.PonudnikOdjemalec {
        // A4, C (24. 11. 2026): kljuc samo za asistentko ima prednost; brez njega isti ponudnik kot klici (A6).
        val nastavitveAsistentke = AsistentkaShramba(a)
        return IzbiraAsistentke.odjemalec(SkupniKljuci.shrambaAsistentke(a), nastavitveAsistentke.model(), nastavitveAsistentke.brezplacni(), prenos)
            // Lastnik 24. 11. 2026: model, ki ga ponudnik ne pozna vec, Lina sama zamenja z delujocim istega ponudnika.
            ?: if (jeVertex()) VertexOdjemalec(google, { googleShramba.projekt() }, prenos = prenos)
            else SamodejniOdjemalec(SkupniKljuci.aktivniPonudnik(a), SkupniKljuci.shrambaZaPonudnika(a, SkupniKljuci.aktivniPonudnik(a)), prenos, ModelShrambaAndroid(a))
    }

    private fun trenutniAsistent(): Asistent {
        val zdaj = ZonedDateTime.now()
        val danes = zdaj.toLocalDate()
        val obstojeci = asistent
        if (obstojeci != null && asistentDan == danes) return obstojeci
        val odjemalec = odjemalecAsistentke()
        val orodja = nastavitveKljuci.orodja()
        val navodilo = SistemskoNavodilo.zgradi(zdaj, iskanje = orodja.iskanjeNaVoljo, branje = orodja.branjeNaVoljo, koledar = true)
        vprasajZaKoledar()
        // Trajna zgodovina seje in zapiski kot podatek (lastnik 23. 11. 2026: Lina je pozabljala pogovor in ni brala zapiskov).
        return Asistent(odjemalec, navodilo, orodja = orodja, spomin = SpominPogovorovPogled.spomin(a), racunalnikPovezan = racunalnikPovezan,
            racunalnikSeznanjen = racunalnikSeznanjen, razlicica = si.safeer.lina.BuildConfig.VERSION_NAME,
            koledar = KoledarIzvajalec(KoledarAndroid(a)), seja = SpominPogovorovPogled.seja(a),
            zapiski = { vidniZapiski(zapiski.beri()).map { it.besedilo } }, tockeNaloge = { TockeNalog.vklopljeno(a) }, sistem = sistem).also { asistent = it; asistentDan = danes }
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
        // Povzetek klicev nosi besedilo klicateljev: nezaupano (N2).
        posljiBesedilo(prikaz, poziv, dodatek = dodatek, nezaupano = true)
        return true
    }

    private fun poslji() {
        val vnos = klepetVnos.text.toString().trim()
        if ((vnos.isEmpty() && priponke.isEmpty()) || caka) return
        klepetVnos.setText("")
        val nezaupano = deljenoVOsnutku
        deljenoVOsnutku = false
        (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(klepetVnos.windowToken, 0)
        if (priponke.isEmpty() && DokumentiLokalno.vklopljeno(a)) zahtevaIskanjaVDokumentih(vnos)?.let { isciVDokumentih(vnos, it); return }
        if (priponke.isEmpty()) { posljiBesedilo(vnos, vnos, nezaupano = nezaupano); return }
        val izbrane = priponke.toList()
        priponke.clear()
        narisiPriponke()
        val imena = izbrane.joinToString(", ") { ime(it) }
        val prikaz = listOf(vnos, "📎 $imena").filter { it.isNotEmpty() }.joinToString("\n")
        val binarne = izbrane.filterIsInstance<PripravljenaPriponka.Binarna>().map { it.priponka }
        posljiBesedilo(prikaz, besediloZPriponkami(vnos.ifEmpty { PRIVZETA_ZAHTEVA_PRIPONKE }, izbrane), binarne, nezaupano = nezaupano)
    }

    /**
     * »Poišči v mojih dokumentih …« (23. 11. 2026): isce samo lokalni indeks na telefonu. Vprasanje in rezultat sta samo na
     * zaslonu: ne gresta v trajni pogovor, sinhronizacijo z racunalnikom ali model, dokler uporabnik rezultata ne poslje Lini.
     */
    private fun isciVDokumentih(vnos: String, iskano: String) {
        napakaZaPonovitev = null
        prisilnoNaDno = true
        sporocila += false to vnos
        val poizvedba = poizvedbaFts(iskano)
        if (poizvedba == null || !DokumentiLokalno.imaIndeks(a)) {
            sporocila += true to a.getString(R.string.docs_chat_no_index)
            osvezi()
            return
        }
        caka = true
        osvezi()
        DokumentiLokalno.iskanje.execute {
            val zadetki = runCatching { DokumentiLokalno.isci(a, poizvedba) }.getOrDefault(emptyList())
            glavna.post {
                if (a.isFinishing) return@post
                caka = false
                val besedilo = if (zadetki.isEmpty()) a.getString(R.string.docs_chat_none) else
                    a.getString(R.string.docs_chat_found) + "\n\n" + zadetki.joinToString("\n\n") { z ->
                        (z.stran?.let { a.getString(R.string.docs_source_page_fmt, z.ime, it) } ?: z.ime) + "\n" + z.izrezek
                    }
                sporocila += true to besedilo
                if (zadetki.isNotEmpty()) lokalniRezultati += besedilo
                osvezi()
            }
        }
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
        dodajUrije(uriji)
    }

    /**
     * Ista pot za izbiro, deljenje in fotografijo: branje na ozadni niti (z mejo), vrsta po bajtih, meje priponk.
     * [poBranju] tece na ozadni niti po branju (fotografija: brisanje zacasne datoteke).
     */
    private fun dodajUrije(uriji: List<Uri>, poBranju: () -> Unit = {}) {
        if (uriji.isEmpty()) { poBranju(); return }
        val ponudnik = if (imaKljucAsistentke()) Ponudnik.OPENROUTER else SkupniKljuci.aktivniPonudnik(a)
        nit.execute {
            val izidi = try { uriji.map { uri -> preberiPriponko(uri, ponudnik) } } finally { poBranju() }
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

    /**
     * Deli -> Lina (24. 11. 2026). Vrne false, ce namen ni deljenje. Datoteke gredo samo med priponke, besedilo v polje:
     * NIC se ne poslje samo (tuja aplikacija ne sme sama sprozit poziva modelu), poslje lastnik s tapom Poslji.
     * URI se prebere takoj z zacasnim dovoljenjem namena (brez takePersistableUriPermission); file:// in lasten ponudnik se zavrneta.
     */
    fun sprejmiDeljenje(namen: Intent): Boolean {
        val uriji = runCatching { urijiDeljenja(namen) }.getOrDefault(emptyList())
        val besedilo = runCatching { namen.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() }.getOrNull()
        val o = odlociDeljenje(namen.action, namen.type, uriji.map { it.scheme to it.authority }, besedilo, sprejemaDeljenje(a), priponke.size,
            setOf(PosnetekPonudnik.avtoriteta(a)))
        when (o) {
            OdlocitevDeljenja.NiDeljenje -> return false
            is OdlocitevDeljenja.Zavrni -> opozori(a.getString(when (o.razlog) {
                ZavrnitevDeljenja.IZKLOPLJENO -> R.string.share_off
                ZavrnitevDeljenja.NEPODPRTA_VRSTA -> R.string.share_unsupported
                ZavrnitevDeljenja.PRAZNO -> R.string.share_empty
            }))
            is OdlocitevDeljenja.Sprejmi -> {
                o.besedilo?.let { b ->
                    val zdaj = klepetVnos.text.toString().trimEnd()
                    klepetVnos.setText(if (zdaj.isEmpty()) b else "$zdaj\n$b")
                    deljenoVOsnutku = true
                    klepetVnos.setSelection(klepetVnos.text.length)
                }
                if (o.cezMejo > 0) opozori(a.getString(R.string.chat_attach_too_many, NAJVEC_PRIPONK))
                if (o.nedovoljeni > 0) opozori(a.getString(R.string.share_not_allowed, o.nedovoljeni))
                if (o.indeksi.isNotEmpty()) opozori(a.getString(R.string.share_ready))
                dodajUrije(o.indeksi.map { uriji[it] })
            }
        }
        return true
    }

    @Suppress("DEPRECATION")
    private fun urijiDeljenja(namen: Intent): List<Uri> {
        val izDodatka = when (namen.action) {
            Intent.ACTION_SEND -> listOfNotNull(namen.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE -> namen.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.filterNotNull().orEmpty()
            else -> emptyList()
        }
        if (izDodatka.isNotEmpty()) return izDodatka
        val c = namen.clipData ?: return emptyList()
        return (0 until c.itemCount).mapNotNull { c.getItemAt(it).uri }
    }

    /**
     * Gumb »Fotografiraj«: program za fotografiranje, ki ga izbere sistem, zapise sliko v cacheDir prek [PosnetekPonudnik]
     * (zacasno dovoljenje za pisanje iz namena; Lina nima dovoljenja CAMERA).
     */
    private fun fotografiraj() {
        PosnetekPonudnik.datoteka(a).delete()   // ostanek, ce je bil proces med fotografiranjem ubit
        val uri = PosnetekPonudnik.naslov(a)
        val namen = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        namen.clipData = android.content.ClipData.newRawUri("", uri)
        try { a.startActivityForResult(namen, ZAHTEVA_FOTO) }
        catch (e: ActivityNotFoundException) { opozori(a.getString(R.string.chat_photo_no_app)) }
        catch (e: SecurityException) { opozori(a.getString(R.string.chat_photo_no_app)) }
    }

    /** Rezultat programa za fotografiranje (DialerActivity.onActivityResult): slika gre med priponke, zacasna datoteka se pobrise. */
    fun dodajFotografijo(uspeh: Boolean) {
        val uri = PosnetekPonudnik.naslov(a)
        a.revokeUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val f = PosnetekPonudnik.datoteka(a)
        if (!uspeh || f.length() == 0L) {
            f.delete()
            // Nekateri programi EXTRA_OUTPUT prezrejo in vrnejo samo sliciko: datoteka ostane prazna.
            if (uspeh) opozori(a.getString(R.string.chat_attach_read_fail, f.name))
            return
        }
        dodajUrije(listOf(uri)) { f.delete() }
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

    private fun posljiBesedilo(prikaz: String, vnos: String, binarne: List<si.safeer.lina.samostojna.Priponka> = emptyList(), dodatek: String = "", nezaupano: Boolean = false) {
        caka = true
        napakaZaPonovitev = null
        prisilnoNaDno = true
        sporocila += false to prikaz
        sporocila += true to a.getString(R.string.local_thinking)
        osvezi()
        val asist = trenutniAsistent()
        val mojRod = rod
        nit.execute {
            val odgovor = try { asist.povej(vnos, binarne, nezaupano) } catch (e: Exception) { Odgovor.Napaka(e.javaClass.simpleName) }
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
                    is Odgovor.NovaBudilka ->
                        if (potrdiBudilko(odgovor, asist.zadnjiObratPoOrodjih)) a.getString(R.string.local_alarm_proposed, opisBudilke(odgovor))
                        else a.getString(R.string.sys_alarm_auto, opisBudilke(odgovor))
                    // Brez dostopa ostane v klepetu natancno ime nastavitve (tudi, ce uporabnik okno zapre).
                    is Odgovor.NeMoti ->
                        if (potrdiNeMoti(odgovor)) a.getString(if (odgovor.vklop) R.string.sys_dnd_proposed_on else R.string.sys_dnd_proposed_off)
                        else a.getString(R.string.sys_dnd_access_msg)
                    is Odgovor.Svetlost ->
                        if (potrdiSvetlost(odgovor)) a.getString(R.string.sys_brightness_proposed, odgovor.odstotek)
                        else a.getString(R.string.sys_brightness_access_msg)
                    is Odgovor.NoviDogodek -> {
                        val kdaj = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(odgovor.zacetekMs))
                        potrdiDogodek(odgovor)
                        a.getString(R.string.local_event_proposed, odgovor.naslov, kdaj)
                    }
                    // T7 (pregled 1915): naloga iz nezaupane seje gre racunalniku sele po lastnikovi potrditvi.
                    is Odgovor.NalogaRacunalniku ->
                        if (asist.zadnjiObratPoOrodjih) { potrdiNalogoRacunalniku(asist, odgovor.besedilo); a.getString(R.string.local_task_proposed, odgovor.besedilo) }
                        else { predajNalogo(asist, odgovor.besedilo); a.getString(R.string.local_task_preverjam) }
                    is Odgovor.Napaka -> when (odgovor.sporocilo) {
                        "Brez povezave" -> a.getString(R.string.local_err_offline)
                        "Prijava poteka" -> { google.odjava(); a.getString(R.string.local_google_relogin) }
                        else -> a.getString(R.string.local_err_generic, odgovor.sporocilo)
                    }
                }
                sporocila += true to besedilo
                if (odgovor is Odgovor.Napaka) { napakaZaPonovitev = Triple(prikaz, vnos, binarne); dodatekZaPonovitev = dodatek; nezaupanoZaPonovitev = nezaupano }
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
            .pokaziVarno()
    }

    /**
     * Naloga 11 (lastnik 25. 11. 2026): besedilo o predaji samo iz dejanskega izida (stevilka iz potrditve racunalnika); nedosegljiv
     * racunalnik -> »nisem mogla poslati« in ponudba, da jo telefon shrani in poslje, ko bo racunalnik dosegljiv.
     */
    private fun predajNalogo(asist: Asistent, besedilo: String) {
        posljiRacunalniku(besedilo) { izid, id -> izidNaloge(asist, besedilo, izid, id, ponudiShranitev = true) }
    }

    /** Glavna nit: izid v klepet in (na niti pogovora, kot povej) v zgodovino Asistenta, da model ve, kaj se je zgodilo. */
    private fun izidNaloge(asist: Asistent, besedilo: String, izid: si.safeer.lina.samostojna.IzidPredaje, id: String?, ponudiShranitev: Boolean) {
        if (a.isFinishing) return
        // imena nizov = PredajaNaloge.kljuc(izid); ZvestobaVirom11Test preveri, da obstajajo v vseh jezikih
        val kljuc = when (izid) {
            si.safeer.lina.samostojna.IzidPredaje.SPREJETA -> R.string.local_task_sprejeta
            si.safeer.lina.samostojna.IzidPredaje.NEDOSEGLJIV -> R.string.local_task_nedosegljiv
            si.safeer.lina.samostojna.IzidPredaje.CLAUDE_CODE_NI -> R.string.local_task_claude_code_ni
            si.safeer.lina.samostojna.IzidPredaje.ZAVRNJENA -> R.string.local_task_zavrnjena
            si.safeer.lina.samostojna.IzidPredaje.PREVEC -> R.string.local_task_prevec
            si.safeer.lina.samostojna.IzidPredaje.ZASEDENO -> R.string.local_task_zasedeno
            si.safeer.lina.samostojna.IzidPredaje.NAPAKA -> R.string.local_task_napaka
        }
        val sprejeta = izid == si.safeer.lina.samostojna.IzidPredaje.SPREJETA
        val sporocilo = if (sprejeta) a.getString(kljuc, besedilo, si.safeer.lina.samostojna.PredajaNaloge.stevilka(id ?: "")) else a.getString(kljuc)
        nit.execute { if (sprejeta) asist.nalogaPredana(besedilo) else asist.nalogaNiPredana(besedilo, sporocilo) }
        obvestilo(sporocilo)
        if (izid == si.safeer.lina.samostojna.IzidPredaje.NEDOSEGLJIV && ponudiShranitev) ponudiShranjevanje(asist, besedilo)
    }

    private fun ponudiShranjevanje(asist: Asistent, besedilo: String) {
        android.app.AlertDialog.Builder(a)
            .setTitle(R.string.local_task_shrani_naslov)
            .setMessage(besedilo)
            .setPositiveButton(R.string.local_task_shrani) { _, _ ->
                // izid poznejse predaje gre v klepet in zgodovino (shranjena naloga se ne ponudi znova)
                val ok = shraniZaPozneje(besedilo) { izid, id -> glavna.post { izidNaloge(asist, besedilo, izid, id, ponudiShranitev = false) } }
                obvestilo(a.getString(if (ok) R.string.local_task_shranjena else R.string.local_task_napaka))
            }
            .setNegativeButton(R.string.local_event_cancel, null)
            .pokaziVarno()
    }

    /** Naloga za racunalnik iz nezaupane seje: vedno potrditev (brez »Velja za podobne«), okno zavrne dotike skozi prekrivno plast. */
    private fun potrdiNalogoRacunalniku(asist: Asistent, besedilo: String) {
        android.app.AlertDialog.Builder(a)
            .setTitle(R.string.local_task_confirm_title)
            .setMessage(a.getString(R.string.local_task_confirm_msg, besedilo))
            .setPositiveButton(R.string.local_task_confirm_send) { _, _ ->
                predajNalogo(asist, besedilo)
            }
            .setNegativeButton(R.string.local_event_cancel, null)
            .pokaziVarno()
    }

    /** Opis za uporabnika: ura, oznaka in dnevi (kratka imena dni v jeziku telefona). */
    private fun opisBudilke(b: Odgovor.NovaBudilka): String {
        val ura = String.format(java.util.Locale.ROOT, "%02d:%02d", b.ura, b.minuta)
        val imena = java.text.DateFormatSymbols.getInstance().shortWeekdays
        val dnevi = b.dnevi.joinToString(", ") { imena[(it % 7) + 1] }
        return listOf(ura, b.oznaka, dnevi).filter { it.isNotBlank() }.joinToString(" · ")
    }

    /**
     * Potrditev dejanja s skupnim modulom soglasij (pravilo lastnika 19. in 24. 11. 2026): ob prvi potrditvi »Velja tudi za vse
     * podobne« (privzeto obkljukano, preklic v Nastavitve > Dovoljenja); spremembe nastavitev sistema vprasajo vedno.
     * Vrne true, ce je pokazala okno (dejanje se izvede ob potrditvi), false, ce je dejanje izvedla takoj.
     */
    private fun potrdi(vrsta: VrstaDejanja, naslov: Int, sporocilo: String, gumb: Int, poOrodjih: Boolean, izvedi: () -> Unit): Boolean {
        if (!SistemskiNadzor.potrebnaPotrditev(vrsta, soglasja, poOrodjih)) { izvedi(); return false }
        val zaPodobne = if (SistemskiNadzor.ponudiZaPodobne(vrsta)) CheckBox(a).apply {
            setTextAppearance(R.style.Gw_Body); setText(R.string.consent_similar); isChecked = true
        } else null
        val okno = android.app.AlertDialog.Builder(a).setTitle(naslov)
            .setMessage(if (zaPodobne == null) sporocilo + "\n\n" + a.getString(R.string.consent_always_asks) else sporocilo)
            .setPositiveButton(gumb) { _, _ ->
                if (zaPodobne?.isChecked == true) runCatching { soglasja.dodaj(vrsta, SistemskiNadzor.OBSEG, Izvor.UPORABNIK_V_APLIKACIJI, System.currentTimeMillis()) }
                izvedi()
            }
            .setNegativeButton(R.string.local_event_cancel, null)
        if (zaPodobne != null) okno.setView(android.widget.FrameLayout(a).apply { setPadding(dp(20), dp(4), dp(20), 0); addView(zaPodobne) })
        okno.pokaziVarno()
        return true
    }

    /** Dostop, ki ga da uporabnik sam v nastavitvah telefona: razlaga z natancnim imenom nastavitve in gumb, ki jo odpre. */
    private fun razloziDostop(sporocilo: Int, namen: android.content.Intent) {
        android.app.AlertDialog.Builder(a)
            .setTitle(R.string.sys_access_title)
            .setMessage(sporocilo)
            .setPositiveButton(R.string.sys_access_open) { _, _ ->
                if (runCatching { a.startActivity(namen) }.isFailure) opozori(a.getString(R.string.sys_access_open_failed))
            }
            .setNegativeButton(R.string.local_event_cancel, null)
            .pokaziVarno()
    }

    /** Vrne false, ce dostopa ni (pokazana je razlaga), sicer true. */
    private fun potrdiNeMoti(o: Odgovor.NeMoti): Boolean {
        if (!sistem.imaDostopNeMoti()) { razloziDostop(R.string.sys_dnd_access_msg, sistem.namenDostopNeMoti()); return false }
        return potrdi(VrstaDejanja.SPREMEMBA_NASTAVITEV_ALI_DOSTOPA, R.string.sys_dnd_confirm_title,
            a.getString(if (o.vklop) R.string.sys_dnd_on else R.string.sys_dnd_off), R.string.sys_apply, poOrodjih = false) {
            // Stikalo in dostop se preverita znova ob izvedbi (uporabnik ju je lahko vmes spremenil).
            val ok = sistem.vklopljen() && sistem.nastaviNeMoti(o.vklop)
            opozori(a.getString(if (ok) R.string.sys_done else R.string.sys_failed))
        }
    }

    private fun potrdiSvetlost(o: Odgovor.Svetlost): Boolean {
        if (!sistem.imaDostopSvetlost()) { razloziDostop(R.string.sys_brightness_access_msg, sistem.namenDostopSvetlost()); return false }
        return potrdi(VrstaDejanja.SPREMEMBA_NASTAVITEV_ALI_DOSTOPA, R.string.sys_brightness_confirm_title,
            a.getString(R.string.sys_brightness_msg, o.odstotek), R.string.sys_apply, poOrodjih = false) {
            val ok = sistem.vklopljen() && sistem.nastaviSvetlost(o.odstotek)
            opozori(a.getString(if (ok) R.string.sys_done else R.string.sys_failed))
        }
    }

    /** Budilka gre v aplikacijo Ura (AlarmClock.ACTION_SET_ALARM) po potrditvi ali s trajnim soglasjem; vrne true, ce je vprasala. */
    private fun potrdiBudilko(b: Odgovor.NovaBudilka, poOrodjih: Boolean): Boolean =
        potrdi(VrstaDejanja.NASTAVI_BUDILKO, R.string.local_alarm_confirm_title, opisBudilke(b), R.string.local_alarm_add, poOrodjih) {
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

    private fun odstraniZadnjo() {
        if (sporocila.isNotEmpty()) sporocila.removeAt(sporocila.lastIndex)
    }
}
