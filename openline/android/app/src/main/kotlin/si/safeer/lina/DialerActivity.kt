package si.safeer.lina

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.content.Context
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.AdapterView
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import android.widget.Button
import android.widget.Toast
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import si.safeer.lina.audio.CallAudioBridge
import si.safeer.lina.config.GatewayConfig
import si.safeer.lina.config.GatewayConfigStore
import si.safeer.lina.config.GatewayPairing
import si.safeer.lina.config.LinaSettingsStore
import si.safeer.lina.shell.PairingService
import si.safeer.lina.shell.ShellClient
import si.safeer.lina.shell.ShellLauncher
import si.safeer.lina.telecom.CallCommandController
import si.safeer.lina.telecom.LineSource
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.asistent.AsistentKontroler
import si.safeer.lina.asistent.AsistentShramba
import si.safeer.lina.asistent.OzjiKrogSafeerLepilo
import si.safeer.lina.podpis.OzjiKrogSafeer
import si.safeer.lina.podpis.AsistentPrikaz
import si.safeer.lina.podpis.SporociloNapake
import si.safeer.lina.seznanitev.AsistentVabilo
import si.safeer.lina.seznanitev.QrSeznanitev
import si.safeer.lina.protocol.LinePicker
import si.safeer.lina.protocol.LineStatus
import si.safeer.lina.protocol.PermissionDenial
import si.safeer.lina.telecom.MissedCallNotice
import si.safeer.lina.transport.DeviceHealth
import si.safeer.lina.transport.GatewayRuntime
import si.safeer.lina.transport.TlsPin
import si.safeer.lina.protocol.FailureMessages
import si.safeer.lina.protocol.GatewayUrl
import si.safeer.lina.protocol.NoticePermission
import si.safeer.lina.protocol.ShellLoss
import si.safeer.lina.protocol.ShownError
import java.util.UUID

class DialerActivity : Activity() {
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    private class Step(root: View, number: Int, title: String) {
        val badge: TextView = root.findViewById(R.id.stepNumber)
        val status: TextView = root.findViewById(R.id.stepStatus)
        val action: Button = root.findViewById(R.id.stepAction)

        init {
            badge.text = number.toString()
            root.findViewById<TextView>(R.id.stepTitle).text = title
        }

        fun render(done: Boolean, statusText: String, actionText: String?) {
            status.text = statusText
            badge.setBackgroundResource(if (done) R.drawable.step_badge_done else R.drawable.step_badge)
            badge.setTextColor(badge.context.getColor(if (done) R.color.on_accent else R.color.muted))
            action.visibility = if (actionText == null) View.GONE else View.VISIBLE
            if (actionText != null) action.text = actionText
        }
    }

    private lateinit var stepRole: Step
    private lateinit var stepServer: Step
    private lateinit var stepAudio: Step
    private lateinit var stepBattery: Step
    private lateinit var connectionDot: View
    private lateinit var connectionText: TextView
    private lateinit var numberInput: EditText
    private lateinit var contactQuery: EditText
    private lateinit var wsUrlInput: EditText
    private lateinit var deviceIdInput: EditText
    private lateinit var deviceTokenInput: EditText
    private lateinit var certInput: EditText
    private lateinit var ringTimeoutInput: EditText
    private lateinit var allowlistInput: EditText
    private lateinit var allowlistEnabled: CheckBox
    private lateinit var stopCleanButton: Button
    private lateinit var lineStatus: TextView
    private lateinit var linePermissionButton: Button
    private lateinit var lineSpinner: Spinner
    private lateinit var tabCalls: View
    private lateinit var tabHome: View
    private lateinit var tabNotes: View
    private lateinit var tabSummary: View
    private lateinit var nastavitveMeni: si.safeer.lina.asistent.NastavitveMeni
    private lateinit var domov: si.safeer.lina.asistent.DomovPogled
    private val linaKlici by lazy {
        si.safeer.lina.asistent.LinaKlicPogled(this) { prikaz, poziv ->
            // Povzetek vseh sporocil klicatelja pripravi Lina v Pogovoru; brez mozganov LinaKlicPogled pokaze lokalni povzetek.
            if (!::samostojniPogled.isInitialized || !samostojniPogled.imaMozgane()) false
            else {
                showTab(Zavihek.LINA)
                samostojniPogled.posljiPoziv(prikaz, poziv)
            }
        }
    }
    private val povzetekKlicev by lazy {
        si.safeer.lina.asistent.PovzetekKlicevPogled(this) { prikaz, poziv, dodatek ->
            // Povzetek vseh klicev pripravi Lina v Pogovoru; brez mozganov PovzetekKlicevPogled pokaze lokalni povzetek.
            if (!::samostojniPogled.isInitialized || !samostojniPogled.imaMozgane()) false
            else {
                val poslano = samostojniPogled.posljiPoziv(prikaz, poziv, dodatek)
                if (poslano) showTab(Zavihek.LINA)
                poslano
            }
        }
    }
    private lateinit var tabPhone: View
    private lateinit var tabLina: View
    private lateinit var tabSettings: View
    private lateinit var tabComputer: View
    private lateinit var dodatkiRacunalnika: si.safeer.lina.asistent.DodatkiRacunalnikaPogled
    private lateinit var gradnje: si.safeer.lina.asistent.GradnjePogled
    private lateinit var agentiNaloge: si.safeer.lina.asistent.AgentiNalogePogled
    /** Opozorilo ob prvem zagonu in Nastavitve > O Lini (24. 11. 2026). */
    private val opozorilo by lazy { si.safeer.lina.asistent.OpozoriloPogled(this) }
    private lateinit var navButtons: Map<Zavihek, Button>

    /** Podmeniji spodnje navigacije (lastnik 18. 11. 2026: brez dolgega drsenja, vsak sklop svoj meni). */
    private enum class Zavihek { DOMOV, KLICI, TELEFON, LINA, ZAPISKI, POVZETEK, RACUNALNIK, NASTAVITVE }

    /** Zavihek pred odprtimi Nastavitvami: gumb Nazaj ga obnovi. */
    private var zavihekPred = Zavihek.DOMOV
    private var zavihekZdaj = Zavihek.DOMOV
    private lateinit var assistantStatus: TextView
    private lateinit var assistantDeviceId: TextView
    private lateinit var assistantTaskInput: EditText
    private lateinit var assistantSendButton: Button
    private lateinit var asistent: AsistentKontroler
    private var odkrivanje: si.safeer.lina.asistent.OdkrivanjeLine? = null
    private var iscemLino = false
    private var ponovniVnosOdprt = false
    private lateinit var assistantOpenSetupButton: Button
    private lateinit var assistantCodeButton: Button
    private lateinit var assistantCircleButton: Button
    private lateinit var assistantForgetButton: Button
    private lateinit var assistantStopButton: Button
    private lateinit var assistantLog: TextView
    private lateinit var samostojniPogled: si.safeer.lina.asistent.LinaPogovorPogled
    private lateinit var assistantApproval: View
    private lateinit var assistantApprovalTool: TextView
    private lateinit var assistantApprovalPreview: TextView
    private lateinit var assistantApprovalDescription: TextView
    /** Polozaj, ki ga je nastavila koda (ne uporabnik): izbirnik ga ne shrani. */
    private var lineProgrammatic = -1

    private lateinit var configStore: GatewayConfigStore
    private lateinit var linaSettings: LinaSettingsStore
    private lateinit var controller: CallCommandController
    private val handler = Handler(Looper.getMainLooper())
    private var pendingPermissionNumber: String? = null
    private var pairingMessage: String? = null
    private var audioStatus: CallAudioBridge.Status? = null
    private var audioWasReady = false
    private var wifiDialog: AlertDialog? = null
    /**
     * Okna ob zagonu (opozorilo, parjenje iz povezave, prosnja za obvestila, Wi-Fi) eno za drugim (lastnik 24. 11. 2026: opozorilo
     * in Wi-Fi sta bila odprta hkrati). Logika in preizkusi: samostojna/VrstaOkenZagona. Stanje prezivi zasuk (onSaveInstanceState).
     */
    private var vrstaOken = si.safeer.lina.samostojna.VrstaOkenZagona()
    /** Med onResume in onPause; okno, dodano zunaj tega (npr. iz onCreate ali po onPause), pocaka na naslednji onResume. */
    private var oknaAktivna = false
    /** Prvi onResume po zasuku ne pozabi zaprtega okna Wi-Fi (sicer bi se po »Ne zdaj« ob zasuku pokazalo znova). */
    private var poZasuku = false
    private var parDialog: AlertDialog? = null
    private var cakajociPar: GatewayPairing.Invite? = null
    /** Last start attempt said Wi-Fi is needed (adbd not reachable on mobile data). */
    private var needsWifi = false

    /** Wi-Fi came up while the screen is open: start call audio without another tap. */
    private val wifiCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            runOnUiThread {
                wifiDialog?.dismiss()
                if (audioStatus == CallAudioBridge.Status.STOPPED) refreshAudioStatus()
                else renderAudioStep()
            }
        }

        override fun onLost(network: Network) {
            runOnUiThread(::renderAudioStep)
        }
    }

    /**
     * Znacka novih klicev na zavihku Klici (znanje 22. 11. 2026, Material 3: znacka z dinamicnim stevilom). Novi = klici po zadnjem
     * ogledu zavihka Klici; ogled zavihka znacko pobrise. Napis ostane berljiv tudi za bralnik zaslona.
     */
    private var znackaCas = 0L
    private var znackaZavihek: Zavihek? = null

    private fun osveziZnackoKlicev() {
        val gumb = findViewById<Button>(R.id.navCalls) ?: return
        // Dnevnik klicev ne beremo ob vsakem tiku (1,5 s): najvec na 10 s, takoj ob menjavi zavihka.
        val zdaj = System.currentTimeMillis()
        if (zavihekZdaj == znackaZavihek && zdaj - znackaCas < 10_000) return
        znackaCas = zdaj
        znackaZavihek = zavihekZdaj
        val prefs = getSharedPreferences("lina_ui", MODE_PRIVATE)
        if (zavihekZdaj == Zavihek.KLICI) prefs.edit().putLong("klici_videno", System.currentTimeMillis()).apply()
        // Prvi zagon: dosedanji klici niso »novi« (cas ogleda se zapise samo, ce ga se ni).
        if (!prefs.contains("klici_videno")) prefs.edit().putLong("klici_videno", zdaj).apply()
        val videno = prefs.getLong("klici_videno", zdaj)
        val novi = runCatching {
            si.safeer.lina.asistent.DnevnikKlicevSkupni.dobi(this).seznamPoDatumu(nujniNaVrhu = false)
                .count { !it.id.startsWith("sys-") && it.stevilka != "Sistem" && it.casZacetka > videno }
        }.getOrDefault(0)
        val osnova = getString(R.string.tab_calls)
        val napis = if (novi > 0) "$osnova ${if (novi > 9) "9+" else novi}" else osnova
        if (gumb.text.toString() != napis) gumb.text = napis
        gumb.contentDescription = if (novi > 0) getString(R.string.tab_calls_new_fmt, osnova, novi) else osnova
    }

    private val ticker = object : Runnable {
        override fun run() {
            renderConnection()
            osveziZnackoKlicev()
            handler.postDelayed(this, 1_500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configStore = GatewayConfigStore(this)
        linaSettings = LinaSettingsStore(this)
        controller = CallCommandController(this)
        setContentView(R.layout.activity_dialer)
        if (savedInstanceState != null) {
            poZasuku = true
            // Okna aplikacije so umrla s staro Activity in spet cakajo; prosnja za obvestila (sistem) prezivi, izid pride sem.
            vrstaOken = si.safeer.lina.samostojna.VrstaOkenZagona.izNiza(savedInstanceState.getString(STANJE_OKEN))
                .poZasuku(setOf(si.safeer.lina.samostojna.OknoZagona.OBVESTILA))
            val par = savedInstanceState.getStringArray(STANJE_PAR)
            if (par != null && par.size == 3) cakajociPar = GatewayPairing.Invite(par[0], par[1], par[2])
        }
        bindViews()
        // T1 (pregled 1915): oznaka besedila iz Deli v osnutku prezivi zasuk in smrt procesa (osnutek EditText obnovi sam).
        if (savedInstanceState?.getBoolean(STANJE_DELJENO) == true) samostojniPogled.deljenoVOsnutku = true
        // Deli -> Lina: samo ob prvem zagonu za ta namen (ob vrtenju zaslona bi se priponke dodale znova; iz Nedavnih pride isti
        // namen brez zacasnega dovoljenja za URI, zato ga ne obdelamo).
        val izZgodovine = (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (savedInstanceState == null && !izZgodovine && sprejmiDeljenje(intent)) return
        applyDialIntent(intent)
        applyPairingIntent(intent)
    }

    /** Deljenje iz druge aplikacije odpre Pogovor s priponkami; poslje lastnik sam (LinaPogovorPogled.sprejmiDeljenje). */
    private fun sprejmiDeljenje(namen: Intent): Boolean {
        if (namen.action != Intent.ACTION_SEND && namen.action != Intent.ACTION_SEND_MULTIPLE) return false
        showTab(Zavihek.LINA)
        samostojniPogled.sprejmiDeljenje(namen)
        return true
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STANJE_OKEN, vrstaOken.vNiz())
        if (::samostojniPogled.isInitialized) outState.putBoolean(STANJE_DELJENO, samostojniPogled.deljenoVOsnutku)
        cakajociPar?.let { outState.putStringArray(STANJE_PAR, arrayOf(it.serverUrl, it.code, it.certSha256)) }
    }

    private fun dodajOkno(o: si.safeer.lina.samostojna.OknoZagona) {
        vrstaOken = vrstaOken.dodaj(o)
        pokaziNaslednjeOkno()
    }

    private fun zaprtoOkno(o: si.safeer.lina.samostojna.OknoZagona) {
        vrstaOken = vrstaOken.zapri(o)
        pokaziNaslednjeOkno()
    }

    /** Pokaze naslednje okno iz vrste, ce nobeno ni odprto. Okno, ki ni vec potrebno, se takoj zapre in pride naslednje. */
    private fun pokaziNaslednjeOkno() {
        if (!oknaAktivna || isFinishing || isDestroyed) return
        val (o, nova) = vrstaOken.naslednje() ?: return
        vrstaOken = nova
        val pokazano = when (o) {
            si.safeer.lina.samostojna.OknoZagona.OPOZORILO ->
                opozorilo.trebaObOdprtju().also { if (it) opozorilo.pokazi { zaprtoOkno(o) } }
            si.safeer.lina.samostojna.OknoZagona.PARJENJE ->
                cakajociPar?.let { inv ->
                    // Poslusalec dismiss tece kasneje (sporocilo): ce je medtem prislo novo vabilo, ga staro okno ne sme pobrisati.
                    confirmAndPair(inv).setOnDismissListener { if (cakajociPar === inv) { cakajociPar = null; zaprtoOkno(o) } }
                    true
                } ?: false
            si.safeer.lina.samostojna.OknoZagona.OBVESTILA -> {
                // Izid (tudi preklic) pride v onRequestPermissionsResult, ki okno zapre.
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS_MISSED)
                true
            }
            // V vrsto pride samo ob needsWifi (tudi iz shranjene vrste po zasuku, ko nova Activity se ni preverila zvoka);
            // ce se je Wi-Fi medtem povezal, okna ne potrebujemo.
            si.safeer.lina.samostojna.OknoZagona.WIFI -> !DeviceHealth.isOnWifi(this) && showWifiRequired()
        }
        if (!pokazano) zaprtoOkno(o)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Vrnitev prijave z Google (shema ID odjemalca): samo to povezavo obdela asistent, drugo gre po starem.
        if (intent.action == Intent.ACTION_VIEW && intent.data?.scheme == si.safeer.lina.samostojna.GoogleOAuth.SHEMA) {
            odpriNastavitveKljucev()   // prijava Google je v Nastavitvah
            samostojniPogled.obdelajPovezavo(intent.data.toString())
            return
        }
        if (sprejmiDeljenje(intent)) return
        fillAdvancedFields()
        applyDialIntent(intent)
        applyPairingIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // Ob vsaki vrnitvi v aplikacijo se sme okno Wi-Fi spet pokazati (kot prej), razen ob zasuku zaslona.
        if (poZasuku) poZasuku = false else vrstaOken = vrstaOken.pozabi(si.safeer.lina.samostojna.OknoZagona.WIFI)
        // Opozorilo prvo v vrsti; enkrat na odprtje (»Pozneje« se ob vracanju iz nastavitev ali zasuku ne ponovi).
        if (opozorilo.trebaObOdprtju()) vrstaOken = vrstaOken.dodaj(si.safeer.lina.samostojna.OknoZagona.OPOZORILO)
        si.safeer.lina.asistent.SinhronizacijaZLino.zazeni(this)
        notifyMissedWithoutPermission()
        renderSteps()
        renderLines()
        refreshAudioStatus()
        handler.post(ticker)
        runCatching {
            getSystemService(ConnectivityManager::class.java).registerNetworkCallback(
                NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(),
                wifiCallback,
            )
        }
        oknaAktivna = true
        pokaziNaslednjeOkno()
    }

    override fun onDestroy() {
        // Okna ob zagonu umrejo s to Activity (zasuk): zapremo jih, nova Activity jih pokaze iz shranjene vrste.
        opozorilo.zapri()
        parDialog?.dismiss()
        wifiDialog?.dismiss()
        odkrivanje?.ustavi()
        if (::asistent.isInitialized) asistent.zapri()
        super.onDestroy()
    }

    override fun onPause() {
        oknaAktivna = false
        handler.removeCallbacks(ticker)
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(wifiCallback) }
        // Ob zasuku ga ne zapremo tu (zapisalo bi se kot zaprto); zapre ga onDestroy, nova Activity ga pokaze iz shranjene vrste.
        if (!isChangingConfigurations) wifiDialog?.dismiss()
        if (::samostojniPogled.isInitialized) samostojniPogled.ustaviMikrofon()
        super.onPause()
    }

    /** Pomakne polje v fokusu v vidni del drsnega obmocja (nad tipkovnico). */
    private fun pokaziVDrsnemObmocju(drsno: android.widget.ScrollView, pogled: View) {
        // Fokus je lahko zunaj drsnega obmocja (zgornja vrstica, vrstica za vnos, Pogovor): offsetDescendantRectToMyCoords
        // bi vrgel IllegalArgumentException (sesutje na Samsungu 22. 11. 2026), zato najprej preveri, da je pogled potomec.
        if (!jePotomec(drsno, pogled)) return
        val r = android.graphics.Rect()
        pogled.getDrawingRect(r)
        drsno.offsetDescendantRectToMyCoords(pogled, r)
        r.inset(0, -(16 * resources.displayMetrics.density).toInt())
        drsno.requestChildRectangleOnScreen(drsno.getChildAt(0), r, false)
    }

    private fun jePotomec(prednik: View, pogled: View): Boolean {
        var p: android.view.ViewParent? = pogled.parent
        while (p != null) {
            if (p === prednik) return true
            p = p.parent
        }
        return false
    }

    /** Pomik drsnega obmocja na dno BREZ premika fokusa (fullScroll bi fokus vzel polju za vnos). */
    private fun naDnoBrezFokusa(drsno: android.widget.ScrollView) {
        val vsebina = drsno.getChildAt(0) ?: return
        drsno.scrollTo(0, maxOf(0, vsebina.height - drsno.height + drsno.paddingBottom))
    }

    private fun bindViews() {
        // Zgoraj in ob straneh odmik dobi vsebina, spodnji odmik (navigacijska vrstica sistema) spodnja navigacija.
        findViewById<View>(R.id.okno).setOnApplyWindowInsetsListener { okno, insets ->
            val view = findViewById<View>(R.id.root)
            val b = SistemskeVrstice.odmiki(insets)
            // Tipkovnica: ob robu do roba je zaslon ne zmanjsa sam, zato drsno obmocje dobi spodnji odmik v visini tipkovnice,
            // spodnja navigacija se skrije, polje v fokusu pa se pomakne nad tipkovnico (lastnik 18. 11. 2026: ni videl, kaj tipka).
            val tipkovnica = SistemskeVrstice.visinaTipkovnice(insets)
            val nav = findViewById<View>(R.id.navBar)
            nav.visibility = if (tipkovnica > 0) View.GONE else View.VISIBLE
            // Vsebina se ne sme drsati pod vrstico stanja (lastnik 22. 11. 2026: prekrivanje); odmik je izven obmocja risanja.
            (view as android.view.ViewGroup).clipToPadding = true
            // Prenova 22. 11. 2026: odmik vrstice stanja in tipkovnice dobi celotno okno; zgornja vrstica in vrstica za vnos
            // (zunaj drsnih obmocij) zato stojita pod vrstico stanja in tik nad tipkovnico.
            okno.setPadding(b[0], b[1], b[2], tipkovnica)
            nav.setPadding(b[0], 0, b[2], b[3])
            if (tipkovnica > 0) view.post {
                currentFocus?.let { f ->
                    // Polje pogovora je v vrstici nad tipkovnico (zunaj drsnega obmocja); zadnji odgovor ostane viden na dnu.
                    // Lastnik 22. 11. 2026: po dotiku polja je moral klikniti se enkrat. ScrollView.fullScroll s FOCUS_DOWN PRESTAVI FOKUS
                    // na zadnji pogled v drsnem obmocju in polju vzame fokus; zato samo pomik (scrollTo), fokus ostane v polju.
                    if (f.id == R.id.assistantChatInput) naDnoBrezFokusa(findViewById(R.id.chatScroll))
                    else pokaziVDrsnemObmocju(view as android.widget.ScrollView, f)
                }
            }
            insets
        }
        connectionDot = findViewById(R.id.connectionDot)
        connectionText = findViewById(R.id.connectionText)
        stepRole = Step(findViewById(R.id.stepRole), 1, getString(R.string.step_role_title))
        stepServer = Step(findViewById(R.id.stepServer), 2, getString(R.string.step_server_title))
        stepAudio = Step(findViewById(R.id.stepAudio), 3, getString(R.string.step_audio_title))
        stepBattery = Step(findViewById(R.id.stepBattery), 4, getString(R.string.step_battery_title))
        stepBattery.action.setOnClickListener { requestBackgroundRunning() }
        stepRole.action.setOnClickListener { requestDialerRole() }
        stepServer.action.setOnClickListener { scanPairingQr() }
        stepAudio.action.setOnClickListener {
            when (audioStatus) {
                CallAudioBridge.Status.STOPPED -> restartAudio()
                CallAudioBridge.Status.READY -> openWirelessDebugging()
                else -> startAudioSetup()
            }
        }

        numberInput = findViewById(R.id.numberInput)
        findViewById<View>(R.id.callButton).setOnClickListener { requestOrDial(numberInput.text.toString().trim()) }
        setupContactSearch()
        setupDialPad()

        wsUrlInput = findViewById(R.id.wsUrlInput)
        deviceIdInput = findViewById(R.id.deviceIdInput)
        deviceTokenInput = findViewById(R.id.deviceTokenInput)
        certInput = findViewById(R.id.certInput)
        ringTimeoutInput = findViewById(R.id.ringTimeoutInput)
        allowlistInput = findViewById(R.id.allowlistInput)
        allowlistEnabled = findViewById(R.id.allowlistEnabled)
        stopCleanButton = findViewById(R.id.stopCleanButton)
        lineStatus = findViewById(R.id.lineStatus)
        linePermissionButton = findViewById(R.id.linePermissionButton)
        lineSpinner = findViewById(R.id.lineSpinner)
        bindTabs()
        linePermissionButton.setOnClickListener {
            if (phonePermissionDeniedForever()) {
                // Pregled 17 (B5): sistem prosnje ne pokaze vec - odpremo nastavitve aplikacije, razlaga je v besedilu stanja.
                runCatching {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }.onFailure { toast(getString(R.string.line_permission_settings)) }
            } else {
                requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_PHONE_NUMBERS), REQUEST_PHONE_STATE)
            }
        }
        fillAdvancedFields()
        fillLinaFields()
        val advanced = findViewById<View>(R.id.advanced)
        val toggle = findViewById<TextView>(R.id.advancedToggle)
        toggle.setOnClickListener {
            val show = advanced.visibility != View.VISIBLE
            advanced.visibility = if (show) View.VISIBLE else View.GONE
            toggle.text = if (show) getString(R.string.hide_advanced) else getString(R.string.show_advanced)
        }
        findViewById<Button>(R.id.saveConfigButton).setOnClickListener { saveGatewayConfig() }
        findViewById<Button>(R.id.restartAudioButton).setOnClickListener { restartAudio() }
        findViewById<Button>(R.id.saveLinaButton).setOnClickListener { saveLinaSettings() }
        stopCleanButton.setOnClickListener { stopAndWipe() }
        bindLanguage()
    }

    private fun bindLanguage() {
        val spinner = findViewById<Spinner>(R.id.languageSpinner)
        val codes = listOf(AppLocale.SYSTEM, AppLocale.EN, AppLocale.SL, AppLocale.DE, AppLocale.ES, AppLocale.FR, AppLocale.IT)
        val labels = listOf(
            getString(R.string.language_system),
            getString(R.string.language_english),
            getString(R.string.language_slovenian),
            getString(R.string.language_german),
            getString(R.string.language_spanish),
            getString(R.string.language_french),
            getString(R.string.language_italian),
        )
        spinner.adapter = ArrayAdapter(this, R.layout.spinner_item, labels).apply { setDropDownViewResource(R.layout.spinner_dropdown_item) }
        spinner.setSelection(codes.indexOf(AppLocale.mode(this)).coerceAtLeast(0))
        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val chosen = codes[position]
                if (chosen == AppLocale.mode(this@DialerActivity)) return
                AppLocale.save(this@DialerActivity, chosen)
                recreate()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun fillAdvancedFields() {
        if (!::wsUrlInput.isInitialized) return
        val config = configStore.load()
        wsUrlInput.setText(config.wsUrl)
        deviceIdInput.setText(config.deviceId)
        deviceTokenInput.setText(config.deviceToken)
        certInput.setText(config.certSha256)
    }

    private fun fillLinaFields() {
        if (!::ringTimeoutInput.isInitialized) return
        val settings = linaSettings.load()
        ringTimeoutInput.setText(settings.ringTimeoutSec.toString())
        allowlistInput.setText(settings.allowlist.joinToString("\n"))
        allowlistEnabled.isChecked = settings.allowlistEnabled
        renderLines()
    }

    /** Dovoljenje smo ze zahtevali, uporabnik ga je zavrnil in sistem prosnje ne pokaze vec (»Ne vprasaj vec«). */
    private fun phonePermissionDeniedForever(): Boolean = PermissionDenial.deniedForever(
        granted = checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED,
        recordedDenial = getSharedPreferences(PREFS_UI, MODE_PRIVATE).getBoolean(KEY_PHONE_DENIED, false),
        showRationale = shouldShowRequestPermissionRationale(Manifest.permission.READ_PHONE_STATE),
    )

    /**
     * Zavihka »Klici« in »Asistent« (lastnik 14. 11. 2026: ena aplikacija). Asistentka ne uporablja nicesar iz poti klicev:
     * podpis je samo v modulu podpis, gumb je samo tu.
     */
    private fun bindTabs() {
        tabCalls = findViewById(R.id.tabCalls)
        // Lastnik 22. 11. 2026: kartice »Lina je odgovorila na N klicev« na zavihku Klici ne zelimo (preveč; klici so v Domov > Sprejeti).
        // linaKlici ostane samo za odpiranje klicatelja iz obvestila po klicu (pogled ni v zavihku).
        tabPhone = findViewById(R.id.tabPhone)
        tabLina = findViewById(R.id.tabLina)
        tabSettings = findViewById(R.id.tabSettings)
        tabComputer = findViewById(R.id.tabComputer)
        dodatkiRacunalnika = si.safeer.lina.asistent.DodatkiRacunalnikaPogled(this, tabComputer as android.widget.LinearLayout)
        gradnje = si.safeer.lina.asistent.GradnjePogled(this, tabComputer as android.widget.LinearLayout) { opozorilo.pokazi() }
        // Agenti in naloge (24. 11. 2026): na istem mestu kot Dovoli/Zavrni za Claude Code - kartica tik nad tem razdelkom.
        (tabComputer as android.widget.LinearLayout).let { t ->
            agentiNaloge = si.safeer.lina.asistent.AgentiNalogePogled(this, t, t.indexOfChild(findViewById(R.id.assistantApproval))) { opozorilo.pokazi() }
        }
        tabHome = findViewById(R.id.tabHome)
        tabNotes = findViewById(R.id.tabNotes)
        tabSummary = findViewById(R.id.tabSummary)
        domov = si.safeer.lina.asistent.DomovPogled(this, { odpriIzDomova(it) }, { vprasajLino() }, { showTab(Zavihek.TELEFON) }, { linaKlici.odpriMapo() })
        findViewById<View>(R.id.topSettings).setOnClickListener { showTab(Zavihek.NASTAVITVE); nastavitveMeni.pokaziMeni() }
        findViewById<View>(R.id.topComputer).setOnClickListener { showTab(Zavihek.RACUNALNIK) }
        navButtons = mapOf(
            Zavihek.DOMOV to findViewById<Button>(R.id.navHome),
            Zavihek.KLICI to findViewById<Button>(R.id.navCalls),
            Zavihek.TELEFON to findViewById<Button>(R.id.navPhone),
            Zavihek.LINA to findViewById<Button>(R.id.navLina),
            Zavihek.ZAPISKI to findViewById<Button>(R.id.navNotes),
            Zavihek.RACUNALNIK to findViewById<Button>(R.id.navComputer),
            Zavihek.NASTAVITVE to findViewById<Button>(R.id.navSettings),
        )
        for ((z, b) in navButtons) b.setOnClickListener { showTab(z) }
        assistantStatus = findViewById(R.id.assistantStatus)
        assistantDeviceId = findViewById(R.id.assistantDeviceId)
        assistantTaskInput = findViewById(R.id.assistantTaskInput)
        assistantSendButton = findViewById(R.id.assistantSendButton)
        assistantSendButton.setOnClickListener { sendTask() }
        assistantOpenSetupButton = findViewById(R.id.assistantOpenSetupButton)
        assistantCodeButton = findViewById(R.id.assistantCodeButton)
        assistantCodeButton.setOnClickListener { izberiNacinKode() }
        assistantCircleButton = findViewById(R.id.assistantCircleButton)
        assistantCircleButton.setOnClickListener { potrdiVOzjiKrog() }
        assistantForgetButton = findViewById(R.id.assistantForgetButton)
        assistantStopButton = findViewById(R.id.assistantStopButton)
        assistantLog = findViewById(R.id.assistantLog)
        samostojniPogled = si.safeer.lina.asistent.LinaPogovorPogled(this, nazaj = { showTab(zavihekPred) }, odpriNastavitve = { odpriNastavitveKljucev() },
            racunalnikPovezan = { ::asistent.isInitialized && asistent.dosegljivZdaj() },
            racunalnikSeznanjen = { AsistentShramba.beri(this) != null },
            posljiRacunalniku = { besedilo, izid -> if (::asistent.isInitialized) asistent.poslji(besedilo, izid) else izid(si.safeer.lina.samostojna.IzidPredaje.NEDOSEGLJIV, null) },
            shraniZaPozneje = { besedilo, obIzidu -> ::asistent.isInitialized && asistent.shraniZaPozneje(besedilo, obIzidu) })
        // Podmeniji nastavitev (lastnik 22. 11. 2026); po LinaPogovorPogled, ker ta v nastavitve vstavi razdelka Ime in Spomin.
        nastavitveMeni = si.safeer.lina.asistent.NastavitveMeni(this, { showTab(Zavihek.TELEFON) }, { showTab(Zavihek.RACUNALNIK) }, { opozorilo.pokazi() })
        assistantApproval = findViewById(R.id.assistantApproval)
        assistantApprovalTool = findViewById(R.id.assistantApprovalTool)
        assistantApprovalPreview = findViewById(R.id.assistantApprovalPreview)
        assistantApprovalDescription = findViewById(R.id.assistantApprovalDescription)
        asistent = AsistentKontroler(this) { if (tabLina.visibility == View.VISIBLE || tabSettings.visibility == View.VISIBLE || tabComputer.visibility == View.VISIBLE) renderAssistant() }
        // En gumb »Skeniraj QR« za obe poti (lastnik 14. 11. 2026): isti bralnik kot v koraku 2.
        assistantOpenSetupButton.setOnClickListener { showTab(Zavihek.TELEFON) }
        findViewById<Button>(R.id.setupCodeButton).setOnClickListener { izberiNacinKode() }
        assistantForgetButton.setOnClickListener { AsistentShramba.pozabi(this); renderAssistant() }
        assistantStopButton.setOnClickListener { asistent.ustavi(); toast(getString(R.string.assistant_stop_sent)) }
        // Lina sama odgovori Claude Code (lastnik 23. 11. 2026); lastnik jo za nalogo ustavi s tem gumbom.
        findViewById<Button>(R.id.assistantAutoStopButton).setOnClickListener { asistent.ustaviSamodejne(); renderAssistant() }
        asistent.naVprasanje = { id, naloga, vprasanje -> samodejnoOdgovori(id, naloga, vprasanje) }
        asistent.naIzid = { id, naloga, izid -> samodejnoOdgovori(id, naloga, izid, izid = true) }
        findViewById<Button>(R.id.assistantAllowButton).setOnClickListener { asistent.odgovori(dovoli = true) }
        findViewById<Button>(R.id.assistantDenyButton).setOnClickListener { asistent.odgovori(dovoli = false) }
        // Zacetni zaslon je Domov po skici Lina 2.0 (lastnik 22. 11. 2026); klicanje (ACTION_DIAL) odpre Klice.
        showTab(Zavihek.DOMOV)
        // Proces je bil med prijavo v brskalniku ubit: vrnitev pride v onCreate namesto onNewIntent.
        if (intent.action == Intent.ACTION_VIEW && intent.data?.scheme == si.safeer.lina.samostojna.GoogleOAuth.SHEMA) {
            odpriNastavitveKljucev()   // prijava Google je v Nastavitvah
            samostojniPogled.obdelajPovezavo(intent.data.toString())
        }
    }

    /** Kljuci so v Nastavitvah (lastnik 19. 11. 2026: zavihek Lina je pogovor): odpri jih in drsi do ploscice kljucev. */
    private fun odpriNastavitveKljucev() {
        showTab(Zavihek.NASTAVITVE)
        nastavitveMeni.odpri(si.safeer.lina.asistent.NastavitveMeni.Podmeni.MOZGANI)
    }

    /** Racunalnik ima opravilo samo med seznanjanjem, po seznanitvi ali ko je izid seznanitve se za prebrati (lastnik 19. 11. 2026); seznanjanje je v Pripravi. */
    private fun racunalnikPotreben(): Boolean {
        if (!::asistent.isInitialized) return false
        val st = asistent.stanje()
        return st.seznanjen || st.cakaPotrditev || iscemLino || asistent.korakKode != null || asistent.izidSeznanitve != null
    }

    private fun osveziNavRacunalnik() {
        navButtons[Zavihek.RACUNALNIK]?.visibility =
            if (racunalnikPotreben() || zavihekZdaj == Zavihek.RACUNALNIK) View.VISIBLE else View.GONE
        // Prenova 22. 11. 2026: spodaj 4 enakovredni zavihki; Racunalnik je ikona v zgornji vrstici (samo ko je potreben),
        // Priprava se odpre iz vrstice stanja na Domovu, Nastavitve iz zgornje vrstice.
        navButtons[Zavihek.RACUNALNIK]?.visibility = View.GONE
        navButtons[Zavihek.TELEFON]?.visibility = View.GONE
        navButtons[Zavihek.NASTAVITVE]?.visibility = View.GONE
        findViewById<View>(R.id.topComputer).visibility = if (racunalnikPotreben() || zavihekZdaj == Zavihek.RACUNALNIK) View.VISIBLE else View.GONE
    }

    /** Vrstica za vnos pogovora: samo v zavihku Lina in samo, ko je pogovor na voljo. */
    private fun osveziSestavljalnik() {
        val viden = zavihekZdaj == Zavihek.LINA && samostojniPogled.imaKlepet()
        findViewById<View>(R.id.assistantComposer).visibility = if (viden) View.VISIBLE else View.GONE
        // Izbrane priponke ostanejo, vrstica pa je vidna samo skupaj z vrstico za vnos.
        val vrstica = findViewById<android.view.ViewGroup>(R.id.assistantComposerAttachments)
        vrstica.visibility = if (viden && vrstica.childCount > 0) View.VISIBLE else View.GONE
    }

    private fun odpriIzDomova(p: si.safeer.lina.samostojna.PloscaDomov) {
        when (p) {
            si.safeer.lina.samostojna.PloscaDomov.POGOVOR -> showTab(Zavihek.LINA)
            si.safeer.lina.samostojna.PloscaDomov.KLICI -> showTab(Zavihek.KLICI)
            si.safeer.lina.samostojna.PloscaDomov.PRIPRAVA -> showTab(Zavihek.TELEFON)
            si.safeer.lina.samostojna.PloscaDomov.RACUNALNIK -> showTab(Zavihek.RACUNALNIK)
            si.safeer.lina.samostojna.PloscaDomov.NASTAVITVE -> showTab(Zavihek.NASTAVITVE)
            si.safeer.lina.samostojna.PloscaDomov.ZAPISKI -> showTab(Zavihek.ZAPISKI)
            si.safeer.lina.samostojna.PloscaDomov.POVZETEK -> showTab(Zavihek.POVZETEK)
        }
    }

    /** Vrstica »Vprasajte Lino« na Domovu: pogovor s kurzorjem v polju in tipkovnico. */
    private fun vprasajLino() {
        showTab(Zavihek.LINA)
        val polje = findViewById<EditText>(R.id.assistantChatInput)
        polje.post {
            if (polje.isShown && polje.requestFocus()) {
                getSystemService(android.view.inputmethod.InputMethodManager::class.java)?.showSoftInput(polje, 0)
            }
        }
    }

    /** Nazaj: podmeni nastavitev -> seznam podmenijev, drug zavihek -> Domov, Domov -> privzeto (zapre okno). */
    @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
    override fun onBackPressed() {
        if (zavihekZdaj == Zavihek.NASTAVITVE && nastavitveMeni.nazaj()) return
        if (zavihekZdaj != Zavihek.DOMOV) { showTab(Zavihek.DOMOV); return }
        super.onBackPressed()
    }

    private fun showTab(z: Zavihek) {
        if (z != Zavihek.NASTAVITVE) zavihekPred = z
        zavihekZdaj = z
        tabHome.visibility = if (z == Zavihek.DOMOV) View.VISIBLE else View.GONE
        tabNotes.visibility = if (z == Zavihek.ZAPISKI) View.VISIBLE else View.GONE
        tabSummary.visibility = if (z == Zavihek.POVZETEK) View.VISIBLE else View.GONE
        // Domov in Pogovor imata svoj prostor brez skupnega drsenja; ostali zavihki so v drsnem obmocju.
        findViewById<View>(R.id.root).visibility = if (z == Zavihek.DOMOV || z == Zavihek.LINA) View.GONE else View.VISIBLE
        tabCalls.visibility = if (z == Zavihek.KLICI) View.VISIBLE else View.GONE
        tabPhone.visibility = if (z == Zavihek.TELEFON) View.VISIBLE else View.GONE
        tabLina.visibility = if (z == Zavihek.LINA) View.VISIBLE else View.GONE
        tabSettings.visibility = if (z == Zavihek.NASTAVITVE) View.VISIBLE else View.GONE
        tabComputer.visibility = if (z == Zavihek.RACUNALNIK) View.VISIBLE else View.GONE
        for ((t, b) in navButtons) { b.isSelected = t == z; b.contentDescription = b.text }
        findViewById<View>(R.id.root).scrollTo(0, 0)
        if (z == Zavihek.DOMOV) domov.osvezi()
        if (z == Zavihek.POVZETEK) povzetekKlicev.osvezi()
        osveziSestavljalnik()
        if (z != Zavihek.KLICI && z != Zavihek.TELEFON && z != Zavihek.DOMOV) renderAssistant()
        // Domov kaze stanje povezave (vrstica stanja je zdaj na Domovu).
        if (z == Zavihek.DOMOV) renderAssistant()
        if (z == Zavihek.LINA || z == Zavihek.RACUNALNIK) asistent.preveriSejo()
        if (z == Zavihek.RACUNALNIK) { dodatkiRacunalnika.osvezi(); gradnje.osvezi(); agentiNaloge.osvezi() }
        osveziNavRacunalnik()
    }

    private fun renderAssistant() {
        samostojniPogled.osvezi()
        osveziSestavljalnik()
        val stanje = asistent.stanje()
        val p = AsistentPrikaz.izracunaj(stanje)
        val naslov = AsistentShramba.beri(this)
        val izidS = asistent.izidSeznanitve
        val koda = asistent.kodaZaPrikaz
        val glavno = when {
            iscemLino -> getString(R.string.assistant_code_searching)
            asistent.korakKode == AsistentKontroler.KorakKode.POVEZUJEM -> getString(R.string.assistant_code_connecting)
            asistent.korakKode == AsistentKontroler.KorakKode.CAKA_KODO && koda != null && asistent.kodaNiBilaPrava ->
                getString(R.string.assistant_code_wrong_on_pc, si.safeer.lina.seznanitev.KodaLine.prikaz(koda))
            asistent.korakKode == AsistentKontroler.KorakKode.CAKA_KODO && koda != null ->
                getString(R.string.assistant_code_show, si.safeer.lina.seznanitev.KodaLine.prikaz(koda))
            asistent.korakKode == AsistentKontroler.KorakKode.VNESI_ZNOVA -> getString(R.string.assistant_code_retry_message)
            stanje.cakaPotrditev -> getString(R.string.assistant_wait_confirm)
            !stanje.seznanjen && izidS != null && izidNizKode(izidS) != null -> getString(izidNizKode(izidS)!!)
            !stanje.seznanjen && izidS == AsistentKontroler.IzidSeznanitve.ZAVRNJENO -> getString(R.string.assistant_pair_refused)
            !stanje.seznanjen && izidS == AsistentKontroler.IzidSeznanitve.POTEKLO -> getString(R.string.assistant_pair_expired)
            !stanje.seznanjen && izidS == AsistentKontroler.IzidSeznanitve.NAPAKA -> getString(R.string.assistant_pair_failed)
            !stanje.seznanjen -> getString(R.string.assistant_no_link)
            asistent.napaka != null -> getString(napakaNiz(asistent.napaka!!))
            stanje.posiljam -> getString(R.string.assistant_sending)
            stanje.nalogaTece && stanje.cakaOdgovor -> getString(R.string.assistant_waiting_answer)
            stanje.nalogaTece -> getString(R.string.assistant_running)
            asistent.izid != null -> getString(if (asistent.izid!!.ok) R.string.assistant_done_ok else R.string.assistant_done_fail)
            izidS == AsistentKontroler.IzidSeznanitve.SPREJETO -> getString(R.string.assistant_pair_accepted)
            else -> getString(R.string.assistant_paired, naslov?.naslov.orEmpty())
        }
        // Stanje seje Claude Code (GET /stanje); neznano se ne pokaze.
        val seja = if (!stanje.seznanjen) null else when (asistent.seja) {
            true -> getString(R.string.assistant_session_open)
            false -> getString(R.string.assistant_session_closed)
            null -> null
        }
        // Pot samo iz dejanskega izida zadnje zahteve (PovezavaLine.zadnjaPot); neznana se ne pokaze (naloga 22).
        val pot = if (!stanje.seznanjen) null else when (si.safeer.lina.asistent.PovezavaLine.zadnjaPot) {
            si.safeer.lina.podpis.PotLine.DOMACE_OMREZJE -> getString(R.string.assistant_route_home)
            si.safeer.lina.podpis.PotLine.GLOBAL_LINK -> getString(R.string.assistant_route_global)
            si.safeer.lina.podpis.PotLine.NEPOSREDNO -> getString(R.string.assistant_route_direct)
            null -> null
        }
        assistantStatus.text = listOfNotNull(glavno, seja, pot).joinToString("\n")
        // Kar ni narejeno, se ne pokaze: vsak gumb samo, ko ima ucinek (AsistentPrikaz, preizkusi v modulu podpis).
        assistantOpenSetupButton.visibility = if (p.seznani && !iscemLino) View.VISIBLE else View.GONE
        assistantCodeButton.visibility = if (p.seznani && !iscemLino) View.VISIBLE else View.GONE
        if (asistent.korakKode == AsistentKontroler.KorakKode.VNESI_ZNOVA && !ponovniVnosOdprt) kodoZnova()
        // Razdelek klicev iz /koda/potrdi: ista potrditev kot pri QR (gostitelj in odtis na zaslonu).
        asistent.vzemiKlice()?.let { confirmAndPair(GatewayPairing.Invite(it.serverUrl, it.code, it.certSha256)) }
        assistantForgetButton.visibility = if (p.pozabi) View.VISIBLE else View.GONE
        assistantTaskInput.visibility = if (p.vnos) View.VISIBLE else View.GONE
        assistantSendButton.visibility = if (p.poslji) View.VISIBLE else View.GONE
        // naloga 23t: naloga, ki je racunalnik zaradi zagona Claude Code ni sprejel, je v vnosu za rocno ponovitev (en dotik Poslji)
        if (p.vnos && !p.odgovor && assistantTaskInput.text.isNullOrEmpty()) asistent.vzemiZaPonovitev()?.let { assistantTaskInput.setText(it) }
        assistantStopButton.visibility = if (p.ustavi) View.VISIBLE else View.GONE
        val zaOdgovor = asistent.nalogaZaOdgovor()
        findViewById<Button>(R.id.assistantAutoStopButton).visibility =
            if (p.ustavi && zaOdgovor != null && !asistent.samodejni.ustavljen(zaOdgovor)) View.VISIBLE else View.GONE
        assistantTaskInput.hint = getString(if (p.odgovor) R.string.assistant_answer_hint else R.string.assistant_task_hint)
        assistantSendButton.text = getString(if (p.odgovor) R.string.assistant_answer_send else R.string.assistant_send)
        assistantLog.text = asistent.dnevnik.joinToString("\n")
        assistantLog.visibility = if (asistent.dnevnik.isEmpty()) View.GONE else View.VISIBLE
        osveziNavRacunalnik()
        val o = asistent.odprta
        assistantApproval.visibility = if (p.odobritev && o != null) View.VISIBLE else View.GONE
        if (o != null) {
            // Prikazano je natanko to, kar podpis zgosti (orodje, predogled, opis); opis modela je loceno oznacen.
            assistantApprovalTool.text = getString(R.string.assistant_approval_tool, o.orodje)
            assistantApprovalPreview.text = o.predogled
            assistantApprovalDescription.text = o.opis
        }
        // Pregled 17 (B6): KeyStore ne na glavni niti.
        Thread {
            val id = runCatching { NapravaKljuc.id() }.getOrNull()
            runOnUiThread {
                if (id != null && !isFinishing) {
                    assistantDeviceId.text = getString(R.string.assistant_device_id, id)
                    assistantDeviceId.visibility = View.VISIBLE
                }
            }
            // Potrditev v ozji krog prek Safeerja: gumb vedno, ko je Safeer na voljo; clanstvo preveri Safeer, Lina ga ne hrani (T4-6).
            val cilj = OzjiKrogSafeerLepilo.cilj(this)
            val pokazi = id != null && OzjiKrogSafeer.pokaziGumb(cilj != null)
            runOnUiThread { if (!isFinishing) assistantCircleButton.visibility = if (pokazi) View.VISIBLE else View.GONE }
        }.start()
    }

    /** Ena potrditev v Safeerju (okno zasciteno z dovoljenjem ravni signature); Lina sama sebe ne more vpisati. */
    private fun potrdiVOzjiKrog() {
        assistantCircleButton.isEnabled = false
        Thread {
            val cilj = OzjiKrogSafeerLepilo.cilj(this)
            val namera = cilj?.let { OzjiKrogSafeerLepilo.namera(it) }
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                if (namera == null) { assistantCircleButton.isEnabled = true; toast(getString(R.string.circle_failed)); return@runOnUiThread }
                try { startActivityForResult(namera, OzjiKrogSafeerLepilo.ZAHTEVA) }
                catch (_: Throwable) { assistantCircleButton.isEnabled = true; toast(getString(R.string.circle_failed)) }
            }
        }.start()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // Priponke za pogovor z Lino (22. 11. 2026).
        if (requestCode == si.safeer.lina.asistent.LinaPogovorPogled.ZAHTEVA_PRIPONKA) {
            if (resultCode == RESULT_OK) samostojniPogled.dodajPriponke(data)
            return
        }
        if (requestCode == si.safeer.lina.asistent.LinaPogovorPogled.ZAHTEVA_FOTO) {
            samostojniPogled.dodajFotografijo(resultCode == RESULT_OK)
            return
        }
        if (requestCode == si.safeer.lina.asistent.LinaPogovorPogled.ZAHTEVA_GOVOR) {
            if (resultCode == RESULT_OK) data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { samostojniPogled.vstaviGovor(it) }
            return
        }
        if (requestCode == si.safeer.lina.asistent.ZapiskiIzvoz.ZAHTEVA_MAPA) {
            if (resultCode == RESULT_OK) data?.data?.let { samostojniPogled.obdelajMapo(it) }
            return
        }
        // Mapa za lokalno iskanje po dokumentih (Nastavitve > Dokumenti, 23. 11. 2026).
        if (requestCode == si.safeer.lina.asistent.DokumentiLokalno.ZAHTEVA_MAPA) {
            if (resultCode == RESULT_OK) data?.data?.let { nastavitveMeni.dokumenti.obdelajMapo(it) }
            return
        }
        if (requestCode != OzjiKrogSafeerLepilo.ZAHTEVA) return
        assistantCircleButton.isEnabled = true
        val izid = OzjiKrogSafeer.izid(resultCode == RESULT_OK, data?.getStringExtra(OzjiKrogSafeer.POLJE_IZID))
        if (OzjiKrogSafeer.jeUspeh(izid)) {
            if (!isFinishing) toast(getString(R.string.circle_done))
        } else {
            toast(getString(if (izid == OzjiKrogSafeer.Izid.ZAVRNJENO) R.string.circle_refused else R.string.circle_failed))
        }
    }

    /** Izidi seznanitve s kodo; QR ima svoja besedila spodaj (null = obicajno besedilo). */
    private fun izidNizKode(i: AsistentKontroler.IzidSeznanitve): Int? = when (i) {
        AsistentKontroler.IzidSeznanitve.POTEKLO -> if (asistent.zadnjaSKodo) R.string.assistant_code_expired else null
        AsistentKontroler.IzidSeznanitve.NAPACNA_KODA -> R.string.assistant_code_wrong
        AsistentKontroler.IzidSeznanitve.PREVEC -> R.string.assistant_code_busy
        AsistentKontroler.IzidSeznanitve.ZAPRTO -> R.string.assistant_code_locked
        AsistentKontroler.IzidSeznanitve.NI_ODPRTO -> R.string.assistant_code_not_open
        AsistentKontroler.IzidSeznanitve.ZE_DODAN -> R.string.assistant_code_already
        AsistentKontroler.IzidSeznanitve.ODTIS -> R.string.assistant_code_fingerprint
        else -> null
    }

    /** »Poveži s kodo«: nacin (kodo kaze Lina ali telefon), nato DNS-SD najvec 5 s, rezerva je rocni vnos naslova. */
    private fun izberiNacinKode() {
        val nacini = arrayOf(getString(R.string.assistant_code_mode_pc), getString(R.string.assistant_code_mode_phone))
        AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.assistant_code_button))
            .setItems(nacini) { _, i -> showTab(Zavihek.RACUNALNIK); poisciLino(naTelefonu = i == 1) }
            .setNegativeButton(getString(R.string.pair_cancel), null)
            .show()
    }

    private fun poisciLino(naTelefonu: Boolean) {
        odkrivanje?.ustavi()
        iscemLino = true
        renderAssistant()
        val o = si.safeer.lina.asistent.OdkrivanjeLine(this)
        odkrivanje = o
        o.isci { najdene ->
            if (odkrivanje !== o || isFinishing) return@isci
            odkrivanje = null
            iscemLino = false
            renderAssistant()
            when (najdene.size) {
                0 -> rocniNaslov(naTelefonu)
                1 -> naprejKoda(najdene[0].naslov, najdene[0].vrata, naTelefonu)
                else -> AlertDialog.Builder(this, R.style.Gw_Dialog)
                    .setTitle(getString(R.string.assistant_code_pick))
                    .setItems(najdene.map { "${it.ime} (${it.naslov})" }.toTypedArray()) { _, i ->
                        naprejKoda(najdene[i].naslov, najdene[i].vrata, naTelefonu)
                    }
                    .setNegativeButton(getString(R.string.pair_cancel), null)
                    .show()
            }
        }
    }

    private fun rocniNaslov(naTelefonu: Boolean) {
        val vnos = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            hint = getString(R.string.assistant_code_manual_hint)
            filters = arrayOf(android.text.InputFilter.LengthFilter(60))
        }
        AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.assistant_code_manual_title))
            .setMessage(getString(R.string.assistant_code_manual_message))
            .setView(vnos)
            .setPositiveButton(getString(R.string.assistant_code_next)) { _, _ ->
                val n = si.safeer.lina.seznanitev.KodaLine.rocniNaslov(vnos.text.toString())
                if (n == null) toast(getString(R.string.assistant_code_bad_address)) else naprejKoda(n.first, n.second, naTelefonu)
            }
            .setNegativeButton(getString(R.string.pair_cancel), null)
            .pokaziVarno()
    }

    /** Nacin A: koda ni bila prava; nov krog gre na isti pair_id (brez novega iskanja Line). */
    private fun kodoZnova() {
        ponovniVnosOdprt = true
        val vnos = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(android.text.InputFilter.LengthFilter(7))
            hint = "482 913"
        }
        AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.assistant_code_retry_title))
            .setMessage(getString(R.string.assistant_code_retry_message))
            .setView(vnos)
            .setCancelable(false)
            .setPositiveButton(getString(R.string.assistant_code_next)) { _, _ ->
                ponovniVnosOdprt = false
                val k = si.safeer.lina.seznanitev.KodaLine.koda(vnos.text.toString())
                if (k == null) { toast(getString(R.string.assistant_code_bad_code)); kodoZnova() } else asistent.vnesiKodoZnova(k)
            }
            .setNegativeButton(getString(R.string.pair_cancel)) { _, _ -> ponovniVnosOdprt = false; asistent.vnesiKodoZnova(null) }
            .pokaziVarno()
    }

    private fun naprejKoda(naslov: String, vrata: Int, naTelefonu: Boolean) {
        if (naTelefonu) { asistent.povezisKodo(naslov, vrata, null); return }
        val vnos = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(android.text.InputFilter.LengthFilter(7))
            hint = "482 913"
        }
        AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.assistant_code_enter_title))
            .setMessage(getString(R.string.assistant_code_enter_message))
            .setView(vnos)
            .setPositiveButton(getString(R.string.assistant_code_next)) { _, _ ->
                if (si.safeer.lina.seznanitev.KodaLine.koda(vnos.text.toString()) == null) toast(getString(R.string.assistant_code_bad_code))
                else asistent.povezisKodo(naslov, vrata, vnos.text.toString())
            }
            .setNegativeButton(getString(R.string.pair_cancel), null)
            .pokaziVarno()
    }

    private fun napakaNiz(n: SporociloNapake): Int = when (n) {
        SporociloNapake.NEDOSEGLJIVA -> R.string.assistant_err_unreachable
        SporociloNapake.CLAUDE_CODE_NI -> R.string.assistant_err_claude
        SporociloNapake.ZAVRNJENO -> R.string.assistant_err_refused
        SporociloNapake.PREVEC -> R.string.assistant_err_busy
        SporociloNapake.NI_NALOGE -> R.string.assistant_err_gone
        SporociloNapake.NAPAKA -> R.string.assistant_err_other
        SporociloNapake.NEZNAN_IZID -> R.string.assistant_err_unknown
    }

    private fun sendTask() {
        // Claude Code caka odgovor: besedilo gre v ISTO nalogo (POST /nadaljuj), ne kot nova naloga.
        val odgovor = AsistentPrikaz.izracunaj(asistent.stanje()).odgovor
        // Brez »Razumem« kljuc naprave naloge ne podpise (Podpisnik); tu samo jasno sporocilo namesto »ni dosegljiv«.
        if (!si.safeer.lina.config.OpozoriloShramba(this).smeDelati()) { toast(getString(R.string.builds_need_warning)); opozorilo.pokazi(); return }
        val ok = if (odgovor) asistent.nadaljuj(assistantTaskInput.text.toString()) else asistent.poslji(assistantTaskInput.text.toString())
        if (!ok) return toast(getString(R.string.assistant_bad_text))
        assistantTaskInput.setText("")
    }

    /**
     * Claude Code je vprasal (lastnik 23. 11. 2026 »Lina sama odgovori Claude Code«): Lina odgovori iz nacrta, zapiskov in pogovora.
     * Meje v kodi (SamodejniOdgovor): najvec 10 na nalogo, nikoli odobritev, brisanje, push ali sudo; ce ne ve, vprasa lastnika.
     * Deluje, dokler je aplikacija odprta (poizvedovanje se ustavi z zaslonom) - NEPREVERJENO na napravi.
     */
    private fun samodejnoOdgovori(id: String, naloga: String, vprasanje: String, izid: Boolean = false) {
        val s = asistent.samodejni
        val razlogBrez = when {
            s.ustavljen(id) -> getString(R.string.assistant_auto_off)
            !s.lahko(id) -> getString(R.string.assistant_auto_limit, si.safeer.lina.samostojna.SamodejniOdgovor.NAJVEC_NA_NALOGO)
            !::samostojniPogled.isInitialized || !samostojniPogled.imaMozgane() -> getString(R.string.assistant_auto_no_brain)
            else -> null
        }
        // pregled izida brez mozganov ali po meji: nic (naloga je koncana, lastnik izid vidi)
        if (razlogBrez != null) return if (izid) Unit else vprasajLastnika(vprasanje, razlogBrez)
        samostojniPogled.odgovoriClaudeCode(naloga, vprasanje, izid) { o ->
            when (o) {
                is si.safeer.lina.samostojna.SamodejniOdgovor.Odlocitev.Koncano -> Unit
                is si.safeer.lina.samostojna.SamodejniOdgovor.Odlocitev.Poslji ->
                    // lastnik je medtem morda ze odgovoril, ustavil ali dal novo nalogo: takrat Lina ne poslje nicesar
                    if (asistent.nalogaZaOdgovor() == id && (asistent.cakaOdgovor || izid) && s.porabi(id)) {
                        if (!asistent.nadaljuj(o.besedilo, samodejno = true)) vprasajLastnika(vprasanje, getString(R.string.assistant_auto_busy))
                    }
                is si.safeer.lina.samostojna.SamodejniOdgovor.Odlocitev.VprasajLastnika -> vprasajLastnika(vprasanje, o.razlog)
            }
            renderAssistant()
        }
    }

    private fun vprasajLastnika(vprasanje: String, razlog: String) {
        asistent.dodaj(getString(R.string.assistant_auto_ask_owner, razlog))
        if (::samostojniPogled.isInitialized) samostojniPogled.obvestilo(getString(R.string.assistant_claude_asks, vprasanje.take(500), razlog))
        renderAssistant()
    }

    private fun confirmAsistent(v: AsistentVabilo) {
        val a = v.naslov
        AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.assistant_pair_title))
            .setMessage(getString(R.string.assistant_pair_message, "${a.naslov}:${a.vrata}", TlsPin.pretty(a.odtis)))
            .setPositiveButton(getString(R.string.assistant_pair_ok)) { _, _ ->
                // Shrani se sele, ko lastnik telefon potrdi v Lini na racunalniku (AsistentKontroler.seznani).
                asistent.seznani(v)
                showTab(Zavihek.RACUNALNIK)
            }
            .setNegativeButton(getString(R.string.pair_cancel), null)
            .pokaziVarno()
    }

    /**
     * Pregled 16 (N1, N4): izbirnik linije in prosnja za dovoljenje Telefon z razlago. Brez dovoljenja ali brez izbire
     * med vec linijami se Lina ne oglasa (GatewayInCallService.lineAllowed) - to uporabnik tu vidi z besedami.
     */
    private fun renderLines() {
        if (!::lineSpinner.isInitialized) return
        val key = linaSettings.lineIdKey()
        val source = key?.let { LineSource(this, it) }
        val permission = checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        val saved = linaSettings.load().selectedLineId
        // Brez shranjenega kljuca namestitve (CR1) linij ni mogoce zanesljivo prepoznati: Invalid (Lina se ne oglasa).
        val lines = if (permission && source != null) source.getLines() else emptyList()
        val view = if (permission && source == null) LinePicker.View(LineStatus.INVALID, null, emptyList(), -1)
            else LinePicker.view(permission, lines, saved)
        val denied = view.status == LineStatus.NO_PERMISSION && phonePermissionDeniedForever()
        lineStatus.text = when (view.status) {
            LineStatus.NO_PERMISSION -> getString(if (denied) R.string.line_permission_settings else R.string.line_permission_reason)
            LineStatus.USING -> getString(R.string.line_status_using, view.usingLabel)
            LineStatus.AMBIGUOUS -> getString(R.string.line_status_ambiguous)
            LineStatus.SAVED_UNAVAILABLE -> getString(R.string.line_status_unavailable)
            LineStatus.NONE -> getString(R.string.line_status_none)
            LineStatus.INVALID -> getString(R.string.line_status_invalid)
        }
        linePermissionButton.visibility = if (view.status == LineStatus.NO_PERMISSION) View.VISIBLE else View.GONE
        linePermissionButton.text = getString(if (denied) R.string.line_open_settings else R.string.line_permission_button)
        if (view.choices.isEmpty()) {
            lineSpinner.visibility = View.GONE
            return
        }
        val labels = listOf(getString(R.string.line_choose)) +
            view.choices.map { if (it.isEsim) getString(R.string.line_esim, it.label) else it.label }
        lineSpinner.onItemSelectedListener = null
        lineSpinner.adapter = ArrayAdapter(this, R.layout.spinner_item, labels).apply { setDropDownViewResource(R.layout.spinner_dropdown_item) }
        lineProgrammatic = view.selectedIndex + 1
        lineSpinner.setSelection(lineProgrammatic, false)
        lineSpinner.visibility = View.VISIBLE
        val choices = view.choices
        lineSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, v: View?, position: Int, id: Long) {
                if (position == lineProgrammatic) { lineProgrammatic = -1; return }
                lineProgrammatic = -1
                if (position == 0) return
                val chosen = choices.getOrNull(position - 1) ?: return
                if (chosen.id == linaSettings.load().selectedLineId) return
                linaSettings.saveSelectedLine(chosen.id)
                toast(getString(R.string.line_saved))
                renderLines()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    /** Shrani cas zvonjenja, seznam in stikalo. Privzeto je seznam vklopljen. */
    private fun saveLinaSettings() {
        val seconds = ringTimeoutInput.text.toString().trim().toIntOrNull() ?: LinaSettingsStore.DEFAULT_RING_SEC
        val enabled = allowlistEnabled.isChecked
        linaSettings.save(seconds, allowlistInput.text.toString(), enabled)
        fillLinaFields()
        toast(
            if (enabled) getString(R.string.saved_allowlist_on)
            else getString(R.string.saved_allowlist_off),
        )
    }

    /** Poslje exit lupini in pozabi lokalni kljuc. Kljuca na telefonu ne moremo zbrisati. */
    private fun stopAndWipe() {
        stopCleanButton.isEnabled = false
        Thread {
            val stopped = ShellLauncher.stopAndWipe(applicationContext)
            runOnUiThread {
                stopCleanButton.isEnabled = true
                audioStatus = CallAudioBridge.Status.SETUP_REQUIRED
                audioWasReady = false
                renderAudioStep()
                if (isFinishing) return@runOnUiThread
                val message = if (stopped) {
                    getString(R.string.stop_message)
                } else {
                    getString(R.string.shell_still_running)
                }
                AlertDialog.Builder(this, R.style.Gw_Dialog)
                    .setTitle(getString(R.string.stop_title))
                    .setMessage(message)
                    .setPositiveButton(getString(R.string.open_wireless)) { _, _ -> openWirelessDebugging() }
                    .setNegativeButton(getString(R.string.close), null)
                    .pokaziVarno()
            }
        }.start()
    }

    // ---- Status ---------------------------------------------------------------------------

    private fun renderConnection() {
        val config = configStore.load()
        val isDefault = getSystemService(android.app.role.RoleManager::class.java).isRoleHeld(android.app.role.RoleManager.ROLE_DIALER)
        val pcConnected = GatewayRuntime.isConnected()
        val localReady = si.safeer.lina.telecom.SamostojnaPripravljenost.jePripravljena(this)
        
        val host = config.wsUrl.let { runCatching { Uri.parse(it).host }.getOrNull() } ?: config.wsUrl
        val (color, text) = when {
            pairingMessage != null -> R.color.ring to pairingMessage!!
            pcConnected -> R.color.live to getString(R.string.lina_answers_pc)
            !isDefault -> R.color.bad to getString(R.string.lina_silent_no_role)
            localReady -> R.color.live to getString(R.string.lina_answers_local)
            else -> R.color.line to getString(R.string.lina_silent_no_key)
        }
        connectionDot.backgroundTintList = ColorStateList.valueOf(getColor(color))
        connectionText.text = text
        renderServerStep(config, host)
    }

    private fun renderSteps() {
        val isDefault = getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_DIALER)
        stepRole.render(
            done = isDefault,
            statusText = if (isDefault) getString(R.string.role_done) else getString(R.string.role_needed),
            actionText = if (isDefault) null else getString(R.string.set),
        )
        renderConnection()
        renderAudioStep()
        renderBatteryStep()
    }

    private fun renderBatteryStep() {
        val exempt = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        stepBattery.render(
            done = exempt,
            statusText = if (exempt) {
                getString(R.string.battery_done)
            } else {
                getString(R.string.battery_needed)
            },
            // Ko je izjema za baterijo ze dovoljena (na Samsungu to pomeni »Neomejeno«), nadaljnjega koraka ni (lastnik 18. 11. 2026).
            actionText = if (exempt) null else getString(R.string.allow),
        )
    }

    /** Battery-optimisation exemption first; once granted, the button opens the app's settings for OEM power options. */
    private fun requestBackgroundRunning() {
        val exempt = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        val intent = if (exempt) {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        } else {
            @Suppress("BatteryLife")
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        }
        runCatching { startActivity(intent) }.onFailure { toast(getString(R.string.battery_manual)) }
    }

    private fun renderServerStep(config: GatewayConfig, host: String) {
        val paired = config.deviceToken.isNotBlank()
        stepServer.render(
            // 22. 11. 2026 (lastnik: »Čeprav sem povezan z računalnikom«): brez parjenja s strežnikom OpenLine Lina odgovarja sama v telefonu,
            // zato korak ni zahtevan; povezava z računalnikom (ikona prenosnika) je loceno in se tu ne preverja.
            done = !paired || GatewayRuntime.isConnected(),
            statusText = when {
                !paired -> getString(R.string.server_scan)
                GatewayRuntime.isConnected() -> host
                else -> getString(R.string.server_offline, host)
            },
            actionText = if (paired) getString(R.string.scan_again) else getString(R.string.scan_qr),
        )
    }

    private fun renderAudioStep() {
        val held = ShellClient(this).sessionHeld()
        val (done, text, action) = when (audioStatus) {
            null -> Triple(false, getString(R.string.audio_checking), null)
            CallAudioBridge.Status.READY -> Triple(
                true,
                if (held) getString(R.string.audio_ready_held) else getString(R.string.audio_ready_detached),
                getString(R.string.wireless_debugging),
            )
            CallAudioBridge.Status.STOPPED ->
                if (needsWifi && !DeviceHealth.isOnWifi(this)) {
                    Triple(false, getString(R.string.audio_stopped_wifi), getString(R.string.start))
                } else {
                    Triple(false, getString(R.string.audio_stopped), getString(R.string.start))
                }
            CallAudioBridge.Status.SETUP_REQUIRED -> Triple(false, getString(R.string.audio_setup), getString(R.string.set_up))
        }
        stepAudio.render(done, text, action)
    }

    /**
     * Opening the app also (re)starts a stopped audio server, so nobody has to tap Start. Starting
     * goes through Wireless debugging, which Android only runs on Wi-Fi, so off Wi-Fi we ask for it.
     */
    private fun refreshAudioStatus() {
        Thread {
            var status = CallAudioBridge.status(this)
            var result: ShellLauncher.Result? = null
            if (status == CallAudioBridge.Status.STOPPED) {
                runOnUiThread { stepAudio.status.text = getString(R.string.audio_starting) }
                result = ShellLauncher.ensureRunning(applicationContext)
                status = CallAudioBridge.status(this)
            }
            GatewayRuntime.reportHealthSoon()
            runOnUiThread {
                val ready = status == CallAudioBridge.Status.READY
                if (ShellLoss.shouldNotify(audioWasReady, ready)) toast(getString(R.string.shell_lost))
                audioWasReady = ready
                audioStatus = status
                needsWifi = result == ShellLauncher.Result.NeedsWifi
                renderAudioStep()
                // V vrsto: nikoli cez opozorilo ali drugo okno (najdba lastnika 24. 11. 2026).
                if (needsWifi) dodajOkno(si.safeer.lina.samostojna.OknoZagona.WIFI)
            }
        }.start()
    }

    /**
     * Android can't switch Wi-Fi on for an app; this opens the Wi-Fi panel over the app instead. Ob zagonu jo klice samo vrsta oken
     * (pokaziNaslednjeOkno); neposredno samo uporabnikov gumb. Vrne, ali je okno odprto.
     */
    private fun showWifiRequired(): Boolean {
        if (isFinishing) return false
        if (wifiDialog?.isShowing == true) return true
        val wifiOn = runCatching { getSystemService(WifiManager::class.java).isWifiEnabled }.getOrDefault(false)
        wifiDialog = AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.wifi_title))
            .setMessage(
                (if (wifiOn) getString(R.string.wifi_on_prefix) else "") + getString(R.string.wifi_body),
            )
            .setPositiveButton(getString(R.string.open_wifi)) { _, _ -> openWifiSettings() }
            .setNegativeButton(getString(R.string.not_now), null)
            .setOnDismissListener { zaprtoOkno(si.safeer.lina.samostojna.OknoZagona.WIFI) }
            .pokaziVarno()
        return true
    }

    private fun openWifiSettings() {
        val panel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Intent(Settings.Panel.ACTION_WIFI)
        } else {
            Intent(Settings.ACTION_WIFI_SETTINGS)
        }
        runCatching { startActivity(panel) }
            .recoverCatching { startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) }
            .onFailure { toast(getString(R.string.wifi_manual)) }
    }

    private fun restartAudio() {
        stepAudio.status.text = getString(R.string.audio_starting)
        // Uporabnik je sam pritisnil Zazeni: okno Wi-Fi se sme spet pokazati (prej wifiPromptShown = false).
        vrstaOken = vrstaOken.pozabi(si.safeer.lina.samostojna.OknoZagona.WIFI)
        CallAudioBridge.restart(this) { result ->
            runOnUiThread {
                if (result == ShellLauncher.Result.NeedsWifi) {
                    needsWifi = true
                    audioStatus = CallAudioBridge.Status.STOPPED
                    renderAudioStep()
                    showWifiRequired()
                } else {
                    refreshAudioStatus()
                }
            }
        }
    }

    /**
     * N13-5: zavrnjen klic (zaseden znak) brez dovoljenja za obvestila ni viden. Prosimo za dovoljenje in
     * povemo, koliko klicev je bilo zgresenih. Dovoljenje zahtevamo najvec enkrat na zagon zaslona.
     */
    private fun notifyMissedWithoutPermission() {
        val granted = Build.VERSION.SDK_INT < NoticePermission.API_NOTIFICATION_PERMISSION ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val unseen = MissedCallNotice.takeUnseen(this)
        if (unseen > 0) toast(getString(R.string.missed_unseen, unseen))
        val isDefaultDialer = getSystemService(RoleManager::class.java).isRoleHeld(RoleManager.ROLE_DIALER)
        // Enkrat na odprtje zaslona (vrsta oken: zaprto okno se ne doda znova), za opozorilom.
        if (NoticePermission.shouldAsk(Build.VERSION.SDK_INT, granted, unseen, isDefaultDialer)) {
            dodajOkno(si.safeer.lina.samostojna.OknoZagona.OBVESTILA)
        }
    }

    // ---- Actions --------------------------------------------------------------------------

    private fun requestDialerRole() {
        val roleManager = getSystemService(RoleManager::class.java)
        if (!roleManager.isRoleAvailable(RoleManager.ROLE_DIALER)) {
            toast(getString(R.string.no_dialer_role))
            return
        }
        startActivityForResult(roleManager.createRequestRoleIntent(RoleManager.ROLE_DIALER), REQUEST_DIALER_ROLE)
    }

    /** Starts pairing and opens the Wireless debugging screen. */
    private fun startAudioSetup() {
        if (!DeviceHealth.isOnWifi(this)) {
            showWifiRequired()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
            return
        }
        PairingService.start(this)
        openWirelessDebugging()
        toast(getString(R.string.pair_toast))
    }

    /** Odpre Brezžično odpravljanje napak, sicer Možnosti za razvijalce. */
    private fun openWirelessDebugging() {
        val wirelessDebugging = Intent("android.settings.WIRELESS_DEBUGGING_SETTINGS")
        val target = if (wirelessDebugging.resolveActivity(packageManager) != null) {
            wirelessDebugging
        } else {
            Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
        }
        runCatching { startActivity(target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { toast(getString(R.string.wireless_manual)) }
    }

    @Deprecated("Deprecated in Android API; retained for the minimal permission flow.")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        if (requestCode == REQUEST_CALL_PHONE && granted) pendingPermissionNumber?.let(::dialLocally)
        if (requestCode == REQUEST_CONTACTS) refreshContactSearch()
        if (requestCode == si.safeer.lina.asistent.LinaPogovorPogled.KODA_MIKROFON && ::samostojniPogled.isInitialized) samostojniPogled.poDovoljenjuMikrofona(granted)
        if (requestCode == REQUEST_NOTIFICATIONS && granted) startAudioSetup()
        if (requestCode == REQUEST_NOTIFICATIONS_MISSED) zaprtoOkno(si.safeer.lina.samostojna.OknoZagona.OBVESTILA)
        if (requestCode == REQUEST_PHONE_STATE) {
            // Prazen izid je preklic (okno se ni pokazalo), ne zavrnitev: zapis se spremeni samo ob pravem izidu.
            val prefs = getSharedPreferences(PREFS_UI, MODE_PRIVATE)
            prefs.edit().putBoolean(KEY_PHONE_DENIED,
                PermissionDenial.afterResult(prefs.getBoolean(KEY_PHONE_DENIED, false), grantResults)).apply()
            renderLines()
        }
        pendingPermissionNumber = null
    }

    // Lastnik 18. 11. 2026: klicalnik Line mora iskati po imeniku. Brez dovoljenja se pokaze samo povezava za dovoljenje.
    private val contactSearch by lazy { ContactSearch(this) }
    private val contactExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
    private var contactSeq = 0
    private var contactSuppress = false

    /**
     * Tipkovnica 3x4 s tipko za brisanje (lastnik 18. 11. 2026: »se vedno mi ne pokaze tipkovnice da lahko klicem«).
     * Polje za stevilko ne odpira sistemske tipkovnice, da ta ne prekrije tipk; lepljenje in izbira ostaneta.
     */
    private fun setupDialPad() {
        val pad = findViewById<android.widget.GridLayout>(R.id.dialPad)
        numberInput.showSoftInputOnFocus = false
        val ink = getColor(R.color.ink)
        val muted = getColor(R.color.muted)
        for (tipka in si.safeer.lina.protocol.DialKeys.ALL) {
            val gumb = Button(this, null, 0, R.style.Gw_Button).apply {
                text = besediloTipke(tipka, ink, muted, 1f)
                tag = tipka
                background = getDrawable(R.drawable.key_round)
                setPadding(0, 0, 0, 0)
                minHeight = 0; minimumHeight = 0; minWidth = 0; minimumWidth = 0
                setLineSpacing(0f, 0.9f)
                contentDescription = if (tipka.letters.isEmpty()) tipka.digit else tipka.digit + " " + tipka.letters
                setOnClickListener { vstaviZnak(tipka.digit) }
                if (tipka.digit == "0") setOnLongClickListener { vstaviZnak("+"); true }
            }
            pad.addView(gumb, android.widget.GridLayout.LayoutParams(
                android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED),
                android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED, 1, 1f),
            ).apply {
                width = dp(62); height = dp(62)
                setGravity(android.view.Gravity.CENTER)
                setMargins(0, dp(2), 0, dp(2))
            })
        }
        // Tipkovnica se prilagodi visini zaslona (lastnik 22. 11. 2026, Samsung z vecjo pisavo: gumb za klic je bil odrezan pod
        // spodnjo navigacijo): ce vsebina zavihka Klici ne gre na zaslon, se tipke zmanjsajo (najmanj 46 dp), sicer ostanejo 62 dp.
        val drsno = findViewById<android.widget.ScrollView>(R.id.root)
        drsno.viewTreeObserver.addOnGlobalLayoutListener { prilagodiTipkovnico(pad, drsno, ink, muted) }
        val brisi = findViewById<View>(R.id.backspaceButton)
        brisi.setOnClickListener { izbrisiZnak() }
        brisi.setOnLongClickListener { numberInput.setText(""); true }
    }

    /** Stevilka velika, crke pod njo majhne (kot v aplikaciji Telefon); [faktor] pomanjsa pisavo skupaj s tipko. */
    private fun besediloTipke(tipka: si.safeer.lina.protocol.DialKey, ink: Int, muted: Int, faktor: Float): CharSequence =
        android.text.SpannableStringBuilder(tipka.digit).apply {
            setSpan(android.text.style.AbsoluteSizeSpan(Math.round(28 * faktor), true), 0, length, 0)
            setSpan(android.text.style.ForegroundColorSpan(ink), 0, length, 0)
            if (tipka.letters.isNotEmpty()) {
                val od = length
                append("\n").append(tipka.letters)
                setSpan(android.text.style.AbsoluteSizeSpan(Math.max(8, Math.round(10 * faktor)), true), od, length, 0)
                setSpan(android.text.style.ForegroundColorSpan(muted), od, length, 0)
            }
        }

    private var zadnjaVisinaDrsnega = -1

    /**
     * Velikost tipk iz razpolozljive visine: presezek vsebine nad visino drsnega obmocja (pri trenutni velikosti) se razdeli na
     * stiri vrstice tipk. Izracun je vedno od polne velikosti 62 dp, zato se ne ziba; ponovi se samo ob spremembi visine zaslona.
     */
    private fun prilagodiTipkovnico(pad: android.widget.GridLayout, drsno: android.widget.ScrollView, ink: Int, muted: Int) {
        if (findViewById<View>(R.id.tabCalls).visibility != View.VISIBLE || pad.childCount == 0) return
        val vsebina = drsno.getChildAt(0) ?: return
        val visina = drsno.height - drsno.paddingTop - drsno.paddingBottom
        if (visina <= 0 || (visina == zadnjaVisinaDrsnega && vsebina.height <= visina)) return
        zadnjaVisinaDrsnega = visina
        val zdaj = (pad.getChildAt(0).layoutParams as android.widget.GridLayout.LayoutParams).height
        val polna = dp(62)
        val presezekPriPolni = vsebina.height - visina + 4 * (polna - zdaj)
        val cilj = (polna - Math.max(0, (presezekPriPolni + 3) / 4)).coerceIn(dp(46), polna)
        if (cilj == zdaj) return
        val faktor = cilj.toFloat() / polna
        for (i in 0 until pad.childCount) {
            val gumb = pad.getChildAt(i) as Button
            (gumb.layoutParams as android.widget.GridLayout.LayoutParams).apply { width = cilj; height = cilj }
            (gumb.tag as? si.safeer.lina.protocol.DialKey)?.let { gumb.text = besediloTipke(it, ink, muted, faktor) }
        }
        pad.requestLayout()
    }

    private fun vstaviZnak(znak: String) {
        val zacetek = numberInput.selectionStart.coerceAtLeast(0)
        val konec = numberInput.selectionEnd.coerceAtLeast(zacetek)
        numberInput.text.replace(zacetek, konec, znak)
    }

    private fun izbrisiZnak() {
        val zacetek = numberInput.selectionStart.coerceAtLeast(0)
        val konec = numberInput.selectionEnd.coerceAtLeast(zacetek)
        if (konec > zacetek) numberInput.text.delete(zacetek, konec)
        else if (zacetek > 0) numberInput.text.delete(zacetek - 1, zacetek)
    }

    private fun setupContactSearch() {
        contactQuery = findViewById(R.id.contactQuery)
        findViewById<TextView>(R.id.contactsAllow).setOnClickListener {
            requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), REQUEST_CONTACTS)
        }
        val opazovalec = object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) {
                if (!contactSuppress) refreshContactSearch()
            }
        }
        numberInput.addTextChangedListener(opazovalec)
        contactQuery.addTextChangedListener(opazovalec)
        contactQuery.setOnEditorActionListener { v, _, _ ->
            getSystemService(android.view.inputmethod.InputMethodManager::class.java)
                .hideSoftInputFromWindow(v.windowToken, 0)
            true
        }
        refreshContactSearch()
    }

    /** Iskanje po imenu (polje na vrhu) ali po stevilkah, vpisanih na tipkovnici; prednost ima ime (lastnik 18. 11. 2026). */
    private fun refreshContactSearch() {
        val allow = findViewById<TextView>(R.id.contactsAllow)
        val results = findViewById<android.widget.LinearLayout>(R.id.contactResults)
        if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            allow.visibility = View.VISIBLE
            results.visibility = View.GONE
            return
        }
        allow.visibility = View.GONE
        val query = contactQuery.text.toString().ifBlank { numberInput.text.toString() }
        val seq = ++contactSeq
        if (query.trim().length < 2) {
            results.removeAllViews(); results.visibility = View.GONE
            return
        }
        contactExecutor.execute {
            val rows = contactSearch.search(query)
            runOnUiThread {
                if (seq != contactSeq || isFinishing) return@runOnUiThread
                results.removeAllViews()
                if (rows.isEmpty()) {
                    results.addView(TextView(this).apply {
                        text = getString(R.string.contacts_none); setTextColor(getColor(R.color.hint)); textSize = 14f
                        setPadding(0, dp(8), 0, dp(8))
                    })
                }
                rows.forEach { row ->
                    results.addView(android.widget.LinearLayout(this).apply {
                        orientation = android.widget.LinearLayout.VERTICAL
                        minimumHeight = dp(56)
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        setPadding(dp(4), dp(6), dp(4), dp(6))
                        isClickable = true; isFocusable = true
                        setBackgroundResource(android.R.drawable.list_selector_background)
                        addView(TextView(context).apply {
                            text = row.name; setTextColor(getColor(R.color.ink)); textSize = 17f
                        })
                        addView(TextView(context).apply {
                            text = row.number; setTextColor(getColor(R.color.muted)); textSize = 14f
                        })
                        setOnClickListener {
                            // Stevilka iz imenika gre v polje za klicanje; ime se pocisti, da se seznam skrije.
                            contactSuppress = true
                            contactQuery.setText("")
                            numberInput.setText(row.number); numberInput.setSelection(numberInput.text.length)
                            contactSuppress = false
                            results.removeAllViews(); results.visibility = View.GONE
                            getSystemService(android.view.inputmethod.InputMethodManager::class.java)
                                .hideSoftInputFromWindow(windowToken, 0)
                        }
                    })
                }
                results.visibility = View.VISIBLE
            }
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun requestOrDial(number: String) {
        if (number.isBlank()) {
            numberInput.requestFocus()
            return
        }
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            pendingPermissionNumber = number
            requestPermissions(arrayOf(Manifest.permission.CALL_PHONE), REQUEST_CALL_PHONE)
            return
        }
        dialLocally(number)
    }

    private fun dialLocally(number: String) {
        controller.placeLocalCall("call_${UUID.randomUUID()}", number) { result ->
            if (!result.ok) runOnUiThread { toast(textFor(result.error)) }
        }
    }

    private fun scanPairingQr() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { barcode ->
                val s = barcode.rawValue?.let { QrSeznanitev.razberi(it, System.currentTimeMillis()) }
                when {
                    s == null -> toast(getString(R.string.qr_bad))
                    else -> {
                        s.klici?.let { confirmAndPair(GatewayPairing.Invite(it.serverUrl, it.code, it.certSha256)) }
                        s.asistent?.let { confirmAsistent(it) }
                    }
                }
            }
            .addOnFailureListener { error ->
                toast(stringByKey(ShownError.resource("scanner_unavailable", error.message)))
            }
    }

    /** Zunanji intent ne sme sam povezati. Uporabnik najprej vidi gostitelja in odtis. */
    private fun applyPairingIntent(intent: Intent) {
        val data = intent.data ?: return
        val invite = GatewayPairing.parse(data.toString())
        intent.data = null
        if (invite != null) {
            // Ob zagonu prek povezave: v vrsto oken (za opozorilom), ne cez drugo okno. Vsaka nova povezava se sme pokazati
            // (pozabi); odprto okno starega vabila se zapre in novo pride na vrsto.
            if (parDialog?.isShowing == true) parDialog?.dismiss()
            cakajociPar = invite
            vrstaOken = vrstaOken.zapri(si.safeer.lina.samostojna.OknoZagona.PARJENJE).pozabi(si.safeer.lina.samostojna.OknoZagona.PARJENJE)
            dodajOkno(si.safeer.lina.samostojna.OknoZagona.PARJENJE)
        }
    }

    private fun confirmAndPair(invite: GatewayPairing.Invite): AlertDialog {
        val host = Uri.parse(invite.serverUrl).host ?: invite.serverUrl
        return AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.pair_title))
            .setMessage(getString(R.string.pair_message, host, TlsPin.pretty(invite.certSha256)))
            .setPositiveButton(getString(R.string.pair_connect)) { _, _ -> pairWith(invite) }
            .setNegativeButton(getString(R.string.pair_cancel), null)
            .pokaziVarno()
            .also { parDialog = it }
    }

    private fun pairWith(invite: GatewayPairing.Invite) {
        pairingMessage = getString(R.string.connecting_to, Uri.parse(invite.serverUrl).host ?: invite.serverUrl)
        renderConnection()
        Thread {
            val result = runCatching { GatewayPairing.pair(this, invite) }
            runOnUiThread {
                pairingMessage = null
                result.onSuccess {
                    fillAdvancedFields()
                    GatewayRuntime.reconfigure()
                    CallAudioBridge.restart(this) { }
                    toast(getString(R.string.connected))
                }.onFailure { error ->
                    val key = (error as? GatewayPairing.Refused)?.resource ?: "couldnt_connect"
                    toast(stringByKey(ShownError.resource(key, error.message)))
                }
                renderConnection()
            }
        }.start()
    }

    private fun saveGatewayConfig() {
        val wsUrl = wsUrlInput.text.toString().trim()
        val deviceToken = deviceTokenInput.text.toString().trim()
        val fingerprint = certInput.text.toString().trim()
        val deviceId = deviceIdInput.text.toString().trim()
        if (!GatewayUrl.accept(wsUrl, deviceToken)) {
            toast(getString(R.string.need_wss))
            return
        }
        val idCheck = si.safeer.lina.protocol.GatewayDeviceId.check(deviceId)
        if (idCheck == si.safeer.lina.protocol.GatewayDeviceId.Problem.EMPTY) {
            toast(getString(R.string.empty_device_id))
            return
        }
        if (idCheck == si.safeer.lina.protocol.GatewayDeviceId.Problem.NOT_ASCII) {
            toast(getString(R.string.need_ascii_device_id))
            return
        }
        if (TlsPin.normalize(fingerprint).length != 64) {
            toast(getString(R.string.need_pin))
            return
        }
        configStore.save(
            GatewayConfig(
                wsUrl = wsUrl,
                deviceId = deviceIdInput.text.toString().trim(),
                deviceToken = deviceTokenInput.text.toString().trim(),
                certSha256 = fingerprint,
            ),
        )
        GatewayRuntime.reconfigure()
        CallAudioBridge.restart(this) { }
        toast(getString(R.string.saved_reconnecting))
    }

    private fun applyDialIntent(intent: Intent) {
        if (intent.action == si.safeer.lina.telecom.ObvestiloKlicaLine.ODPRI_KLICE) {
            showTab(Zavihek.KLICI)
            // Obvestilo ponovnega klicatelja odpre vsa njegova sporocila (z gumbom za povzetek).
            intent.getStringExtra(si.safeer.lina.telecom.ObvestiloKlicaLine.ID_KLICA)?.let { id ->
                if (intent.getBooleanExtra(si.safeer.lina.telecom.ObvestiloKlicaLine.PONOVNI, false)) linaKlici.odpriKlicatelja(id)
            }
        }
        if (intent.action == Intent.ACTION_DIAL) {
            showTab(Zavihek.KLICI)
            intent.data?.schemeSpecificPart?.let { numberInput.setText(it) }
        }
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private fun stringByKey(key: String): String {
        val id = resources.getIdentifier(key, "string", packageName)
        return if (id != 0) getString(id) else getString(R.string.didnt_work)
    }

    private fun textFor(code: String?): String {
        val key = FailureMessages.resourceName(code)
        val id = resources.getIdentifier(key, "string", packageName)
        return if (id != 0) getString(id) else getString(R.string.didnt_work)
    }

    private companion object {
        const val REQUEST_DIALER_ROLE = 1001
        const val REQUEST_CALL_PHONE = 1002
        const val REQUEST_NOTIFICATIONS = 1003
        const val REQUEST_NOTIFICATIONS_MISSED = 1004
        const val REQUEST_PHONE_STATE = 1005
        const val STANJE_OKEN = "vrsta_oken_zagona"
        const val STANJE_PAR = "cakajoci_par"
        const val STANJE_DELJENO = "deljeno_v_osnutku"
        const val REQUEST_CONTACTS = 1006
        private const val PREFS_UI = "lina_ui"
        private const val KEY_PHONE_DENIED = "phone_permission_denied"
    }
}
