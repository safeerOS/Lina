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
import si.safeer.lina.samostojna.GoogleZetonOsvezevalnik
import si.safeer.lina.samostojna.PrijavaGoogle
import si.safeer.lina.samostojna.ProjektGoogle
import si.safeer.lina.samostojna.VertexOdjemalec
import si.safeer.lina.samostojna.poPrijaviGoogle
import si.safeer.lina.samostojna.vklopiVertex
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.ustvariOdjemalca
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.Odgovor
import si.safeer.lina.samostojna.SistemskoNavodilo
import si.safeer.lina.samostojna.dodajZapisek
import si.safeer.lina.samostojna.izbrisiZapisek
import si.safeer.lina.samostojna.vidniZapiski
import si.safeer.lina.samostojna.Zapisek
import java.time.LocalDate
import java.time.ZonedDateTime
import java.util.UUID
import java.util.concurrent.Executors

class LinaPogovorPogled(
    private val a: Activity,
    private val nazaj: () -> Unit = {},
    /** Odpre podmeni Mozgani v Nastavitvah (namig v praznem pogovoru brez kljuca). */
    private val odpriNastavitve: () -> Unit = {},
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
    private fun imaDostop() = if (jeVertex()) google.prijavljen() && googleShramba.projekt() != null else SkupniKljuci.preberiKljucAktivnegaPonudnika(a) != null

    fun obdelajPovezavo(povezava: String) {
        nastavitveKljuci.obdelajPovezavo(povezava)
    }

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    companion object {
        const val ZAHTEVA_GOVOR = 7311
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

    private fun narisiSporocila() {
        klepetDnevnik.removeAllViews()
        for ((jeLina, besedilo) in sporocila) {
            klepetDnevnik.addView(TextView(a, null, 0, R.style.Gw_Body).apply {
                text = besedilo
                setTextIsSelectable(true)
                background = a.getDrawable(if (jeLina) R.drawable.bg_bubble_lina else R.drawable.bg_bubble_jaz)
                if (!jeLina) setTextColor(0xFFFFFFFF.toInt())
                setPadding(dp(14), dp(10), dp(14), dp(10))
                maxWidth = (a.resources.displayMetrics.widthPixels * 0.8f).toInt()
                contentDescription = (if (jeLina) a.getString(R.string.local_lina) else a.getString(R.string.local_you)) + ": " + besedilo
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = dp(8)
                    gravity = if (jeLina) android.view.Gravity.START else android.view.Gravity.END
                }
            })
        }
        klepetDrsno.post { klepetDrsno.fullScroll(View.FOCUS_DOWN) }
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
        val odjemalec = if (jeVertex()) VertexOdjemalec(google, { googleShramba.projekt() }, prenos = prenos) else ustvariOdjemalca(SkupniKljuci.aktivniPonudnik(a), SkupniKljuci.shrambaZaPonudnika(a, SkupniKljuci.aktivniPonudnik(a)), prenos)
        val orodja = nastavitveKljuci.orodja()
        val navodilo = SistemskoNavodilo.zgradi(zdaj, iskanje = orodja.iskanjeNaVoljo, branje = orodja.branjeNaVoljo)
        return Asistent(odjemalec, navodilo, orodja = orodja, spomin = SpominPogovorovPogled.spomin(a)).also { asistent = it; asistentDan = danes }
    }

    private fun poslji() {
        val vnos = klepetVnos.text.toString().trim()
        if (vnos.isEmpty() || caka) return
        caka = true
        klepetVnos.setText("")
        (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(klepetVnos.windowToken, 0)
        sporocila += false to vnos
        sporocila += true to a.getString(R.string.local_thinking)
        osvezi()
        val asist = trenutniAsistent()
        val mojRod = rod
        nit.execute {
            val odgovor = try { asist.povej(vnos) } catch (e: Exception) { Odgovor.Napaka(e.javaClass.simpleName) }
            glavna.post {
                if (a.isFinishing) return@post
                if (mojRod != rod) { odstraniZadnjo(); caka = false; osvezi(); return@post }
                odstraniZadnjo()
                val besedilo = when (odgovor) {
                    is Odgovor.Besedilo -> odgovor.besedilo
                    is Odgovor.Zapisek -> {
                        shraniZapiske(dodajZapisek(zapiski.beri(), odgovor.besedilo, System.currentTimeMillis(), UUID.randomUUID().toString()))
                        a.getString(R.string.local_note_saved, odgovor.besedilo)
                    }
                    is Odgovor.Opomnik -> {
                        val tekst = "${odgovor.besedilo} (${odgovor.cas})"
                        shraniZapiske(dodajZapisek(zapiski.beri(), tekst, System.currentTimeMillis(), UUID.randomUUID().toString()))
                        a.getString(R.string.local_note_saved, tekst)
                    }
                    is Odgovor.Napaka -> when (odgovor.sporocilo) {
                        "Brez povezave" -> a.getString(R.string.local_err_offline)
                        "Prijava poteka" -> { google.odjava(); a.getString(R.string.local_google_relogin) }
                        else -> a.getString(R.string.local_err_generic, odgovor.sporocilo)
                    }
                }
                sporocila += true to besedilo
                if (odgovor !is Odgovor.Napaka) runCatching {
                    val trajen = PogovorSkupni.dobi(a)
                    trajen.dodaj("lastnik", vnos)
                    trajen.dodaj("lina", besedilo)
                    SinhronizacijaZLino.zazeni(a, takoj = true)
                }
                caka = false
                osvezi()
            }
        }
    }

    private fun odstraniZadnjo() {
        if (sporocila.isNotEmpty()) sporocila.removeAt(sporocila.lastIndex)
    }
}
