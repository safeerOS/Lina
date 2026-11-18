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
    private var notificationAsked = false
    private lateinit var allowlistInput: EditText
    private lateinit var allowlistEnabled: CheckBox
    private lateinit var stopCleanButton: Button
    private lateinit var lineStatus: TextView
    private lateinit var linePermissionButton: Button
    private lateinit var lineSpinner: Spinner
    private lateinit var tabCalls: View
    private lateinit var tabPhone: View
    private lateinit var tabLina: View
    private lateinit var tabAssistant: View
    private lateinit var tabComputer: View
    private lateinit var navButtons: Map<Zavihek, Button>

    /** Podmeniji spodnje navigacije (lastnik 18. 11. 2026: brez dolgega drsenja, vsak sklop svoj meni). */
    private enum class Zavihek { KLICI, TELEFON, LINA, ASISTENT, RACUNALNIK }
    private lateinit var assistantStatus: TextView
    private lateinit var assistantDeviceId: TextView
    private lateinit var assistantTaskInput: EditText
    private lateinit var assistantSendButton: Button
    private lateinit var asistent: AsistentKontroler
    private lateinit var assistantPairButton: Button
    private lateinit var assistantCodeButton: Button
    private lateinit var assistantCircleButton: Button
    private var odkrivanje: si.safeer.lina.asistent.OdkrivanjeLine? = null
    private var iscemLino = false
    private var ponovniVnosOdprt = false
    private lateinit var assistantForgetButton: Button
    private lateinit var assistantStopButton: Button
    private lateinit var assistantLog: TextView
    private lateinit var samostojniPogled: si.safeer.lina.asistent.SamostojniPogled
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
    private var wifiPromptShown = false
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

    private val ticker = object : Runnable {
        override fun run() {
            renderConnection()
            handler.postDelayed(this, 1_500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configStore = GatewayConfigStore(this)
        linaSettings = LinaSettingsStore(this)
        controller = CallCommandController(this)
        setContentView(R.layout.activity_dialer)
        bindViews()
        applyDialIntent(intent)
        applyPairingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Vrnitev prijave z Google (shema ID odjemalca): samo to povezavo obdela asistent, drugo gre po starem.
        if (intent.action == Intent.ACTION_VIEW && intent.data?.scheme == si.safeer.lina.samostojna.GoogleOAuth.SHEMA) {
            showTab(Zavihek.ASISTENT)
            samostojniPogled.obdelajPovezavo(intent.data.toString())
            return
        }
        fillAdvancedFields()
        applyDialIntent(intent)
        applyPairingIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        wifiPromptShown = false
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
    }

    override fun onDestroy() {
        odkrivanje?.ustavi()
        if (::asistent.isInitialized) asistent.zapri()
        super.onDestroy()
    }

    override fun onPause() {
        handler.removeCallbacks(ticker)
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(wifiCallback) }
        wifiDialog?.dismiss()
        super.onPause()
    }

    /** Pomakne polje v fokusu v vidni del drsnega obmocja (nad tipkovnico). */
    private fun pokaziVDrsnemObmocju(drsno: android.widget.ScrollView, pogled: View) {
        val r = android.graphics.Rect()
        pogled.getDrawingRect(r)
        drsno.offsetDescendantRectToMyCoords(pogled, r)
        r.inset(0, -(16 * resources.displayMetrics.density).toInt())
        drsno.requestChildRectangleOnScreen(drsno.getChildAt(0), r, false)
    }

    private fun bindViews() {
        // Zgoraj in ob straneh odmik dobi vsebina, spodnji odmik (navigacijska vrstica sistema) spodnja navigacija.
        findViewById<View>(R.id.root).setOnApplyWindowInsetsListener { view, insets ->
            val b = SistemskeVrstice.odmiki(insets)
            // Tipkovnica: ob robu do roba je zaslon ne zmanjsa sam, zato drsno obmocje dobi spodnji odmik v visini tipkovnice,
            // spodnja navigacija se skrije, polje v fokusu pa se pomakne nad tipkovnico (lastnik 18. 11. 2026: ni videl, kaj tipka).
            val tipkovnica = SistemskeVrstice.visinaTipkovnice(insets)
            val nav = findViewById<View>(R.id.navBar)
            nav.visibility = if (tipkovnica > 0) View.GONE else View.VISIBLE
            (view as android.view.ViewGroup).clipToPadding = false
            view.setPadding(b[0], b[1], b[2], tipkovnica)
            nav.setPadding(b[0], 0, b[2], b[3])
            if (tipkovnica > 0) view.post { currentFocus?.let { pokaziVDrsnemObmocju(view as android.widget.ScrollView, it) } }
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
                requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQUEST_PHONE_STATE)
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
        tabPhone = findViewById(R.id.tabPhone)
        tabLina = findViewById(R.id.tabLina)
        tabAssistant = findViewById(R.id.tabAssistant)
        tabComputer = findViewById(R.id.tabComputer)
        navButtons = mapOf(
            Zavihek.KLICI to findViewById<Button>(R.id.navCalls),
            Zavihek.TELEFON to findViewById<Button>(R.id.navPhone),
            Zavihek.LINA to findViewById<Button>(R.id.navLina),
            Zavihek.ASISTENT to findViewById<Button>(R.id.navAssistant),
            Zavihek.RACUNALNIK to findViewById<Button>(R.id.navComputer),
        )
        for ((z, b) in navButtons) b.setOnClickListener { showTab(z) }
        assistantStatus = findViewById(R.id.assistantStatus)
        assistantDeviceId = findViewById(R.id.assistantDeviceId)
        assistantTaskInput = findViewById(R.id.assistantTaskInput)
        assistantSendButton = findViewById(R.id.assistantSendButton)
        assistantSendButton.setOnClickListener { sendTask() }
        assistantPairButton = findViewById(R.id.assistantPairButton)
        assistantCodeButton = findViewById(R.id.assistantCodeButton)
        assistantCodeButton.setOnClickListener { izberiNacinKode() }
        assistantCircleButton = findViewById(R.id.assistantCircleButton)
        assistantCircleButton.setOnClickListener { potrdiVOzjiKrog() }
        assistantForgetButton = findViewById(R.id.assistantForgetButton)
        assistantStopButton = findViewById(R.id.assistantStopButton)
        assistantLog = findViewById(R.id.assistantLog)
        samostojniPogled = si.safeer.lina.asistent.SamostojniPogled(this)
        assistantApproval = findViewById(R.id.assistantApproval)
        assistantApprovalTool = findViewById(R.id.assistantApprovalTool)
        assistantApprovalPreview = findViewById(R.id.assistantApprovalPreview)
        assistantApprovalDescription = findViewById(R.id.assistantApprovalDescription)
        asistent = AsistentKontroler(this) { if (tabAssistant.visibility == View.VISIBLE || tabComputer.visibility == View.VISIBLE) renderAssistant() }
        // En gumb »Skeniraj QR« za obe poti (lastnik 14. 11. 2026): isti bralnik kot v koraku 2.
        assistantPairButton.setOnClickListener { scanPairingQr() }
        assistantForgetButton.setOnClickListener { AsistentShramba.pozabi(this); renderAssistant() }
        assistantStopButton.setOnClickListener { asistent.ustavi(); toast(getString(R.string.assistant_stop_sent)) }
        findViewById<Button>(R.id.assistantAllowButton).setOnClickListener { asistent.odgovori(dovoli = true) }
        findViewById<Button>(R.id.assistantDenyButton).setOnClickListener { asistent.odgovori(dovoli = false) }
        showTab(Zavihek.KLICI)
        // Proces je bil med prijavo v brskalniku ubit: vrnitev pride v onCreate namesto onNewIntent.
        if (intent.action == Intent.ACTION_VIEW && intent.data?.scheme == si.safeer.lina.samostojna.GoogleOAuth.SHEMA) {
            showTab(Zavihek.ASISTENT)
            samostojniPogled.obdelajPovezavo(intent.data.toString())
        }
    }

    private fun showTab(z: Zavihek) {
        tabCalls.visibility = if (z == Zavihek.KLICI) View.VISIBLE else View.GONE
        tabPhone.visibility = if (z == Zavihek.TELEFON) View.VISIBLE else View.GONE
        tabLina.visibility = if (z == Zavihek.LINA) View.VISIBLE else View.GONE
        tabAssistant.visibility = if (z == Zavihek.ASISTENT) View.VISIBLE else View.GONE
        tabComputer.visibility = if (z == Zavihek.RACUNALNIK) View.VISIBLE else View.GONE
        for ((t, b) in navButtons) { b.isSelected = t == z; b.contentDescription = b.text }
        findViewById<View>(R.id.root).scrollTo(0, 0)
        if (z == Zavihek.ASISTENT || z == Zavihek.RACUNALNIK) { renderAssistant(); asistent.preveriSejo() }
    }

    private fun renderAssistant() {
        samostojniPogled.osvezi()
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
        assistantStatus.text = if (seja == null) glavno else "$glavno\n$seja"
        // Kar ni narejeno, se ne pokaze: vsak gumb samo, ko ima ucinek (AsistentPrikaz, preizkusi v modulu podpis).
        assistantPairButton.visibility = if (p.seznani && !iscemLino) View.VISIBLE else View.GONE
        assistantCodeButton.visibility = if (p.seznani && !iscemLino) View.VISIBLE else View.GONE
        if (asistent.korakKode == AsistentKontroler.KorakKode.VNESI_ZNOVA && !ponovniVnosOdprt) kodoZnova()
        // Razdelek klicev iz /koda/potrdi: ista potrditev kot pri QR (gostitelj in odtis na zaslonu).
        asistent.vzemiKlice()?.let { confirmAndPair(GatewayPairing.Invite(it.serverUrl, it.code, it.certSha256)) }
        assistantForgetButton.visibility = if (p.pozabi) View.VISIBLE else View.GONE
        assistantTaskInput.visibility = if (p.vnos) View.VISIBLE else View.GONE
        assistantSendButton.visibility = if (p.poslji) View.VISIBLE else View.GONE
        assistantStopButton.visibility = if (p.ustavi) View.VISIBLE else View.GONE
        assistantLog.text = asistent.dnevnik.joinToString("\n")
        assistantLog.visibility = if (asistent.dnevnik.isEmpty()) View.GONE else View.VISIBLE
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
            .setItems(nacini) { _, i -> poisciLino(naTelefonu = i == 1) }
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
            .show()
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
            .show()
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
            .show()
    }

    private fun napakaNiz(n: SporociloNapake): Int = when (n) {
        SporociloNapake.NEDOSEGLJIVA -> R.string.assistant_err_unreachable
        SporociloNapake.CLAUDE_CODE_NI -> R.string.assistant_err_claude
        SporociloNapake.ZAVRNJENO -> R.string.assistant_err_refused
        SporociloNapake.PREVEC -> R.string.assistant_err_busy
        SporociloNapake.NI_NALOGE -> R.string.assistant_err_gone
        SporociloNapake.NAPAKA -> R.string.assistant_err_other
    }

    private fun sendTask() {
        if (!asistent.poslji(assistantTaskInput.text.toString())) return toast(getString(R.string.assistant_bad_text))
        assistantTaskInput.setText("")
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
            .show()
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
                    .show()
            }
        }.start()
    }

    // ---- Status ---------------------------------------------------------------------------

    private fun renderConnection() {
        val config = configStore.load()
        val host = config.wsUrl.let { runCatching { Uri.parse(it).host }.getOrNull() } ?: config.wsUrl
        val (color, text) = when {
            pairingMessage != null -> R.color.ring to pairingMessage!!
            config.deviceToken.isBlank() -> R.color.line to getString(R.string.not_connected)
            GatewayRuntime.isConnected() -> R.color.live to getString(R.string.online_at, host)
            else -> R.color.bad to getString(R.string.cant_reach, host)
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
            done = paired && GatewayRuntime.isConnected(),
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
                if (needsWifi && !wifiPromptShown) showWifiRequired()
            }
        }.start()
    }

    /** Android can't switch Wi-Fi on for an app; this opens the Wi-Fi panel over the app instead. */
    private fun showWifiRequired() {
        if (isFinishing || wifiDialog?.isShowing == true) return
        wifiPromptShown = true
        val wifiOn = runCatching { getSystemService(WifiManager::class.java).isWifiEnabled }.getOrDefault(false)
        wifiDialog = AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.wifi_title))
            .setMessage(
                (if (wifiOn) getString(R.string.wifi_on_prefix) else "") + getString(R.string.wifi_body),
            )
            .setPositiveButton(getString(R.string.open_wifi)) { _, _ -> openWifiSettings() }
            .setNegativeButton(getString(R.string.not_now), null)
            .show()
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
        wifiPromptShown = false
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
        if (NoticePermission.shouldAsk(Build.VERSION.SDK_INT, granted, unseen, isDefaultDialer) && !notificationAsked) {
            notificationAsked = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS_MISSED)
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
        if (requestCode == REQUEST_NOTIFICATIONS && granted) startAudioSetup()
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
            // Stevilka velika, crke pod njo majhne (kot v aplikaciji Telefon).
            val besedilo = android.text.SpannableStringBuilder(tipka.digit).apply {
                setSpan(android.text.style.AbsoluteSizeSpan(28, true), 0, length, 0)
                setSpan(android.text.style.ForegroundColorSpan(ink), 0, length, 0)
                if (tipka.letters.isNotEmpty()) {
                    val od = length
                    append("\n").append(tipka.letters)
                    setSpan(android.text.style.AbsoluteSizeSpan(10, true), od, length, 0)
                    setSpan(android.text.style.ForegroundColorSpan(muted), od, length, 0)
                }
            }
            val gumb = Button(this, null, 0, R.style.Gw_Button).apply {
                text = besedilo
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
        val brisi = findViewById<View>(R.id.backspaceButton)
        brisi.setOnClickListener { izbrisiZnak() }
        brisi.setOnLongClickListener { numberInput.setText(""); true }
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
        if (invite != null) confirmAndPair(invite)
    }

    private fun confirmAndPair(invite: GatewayPairing.Invite) {
        val host = Uri.parse(invite.serverUrl).host ?: invite.serverUrl
        AlertDialog.Builder(this, R.style.Gw_Dialog)
            .setTitle(getString(R.string.pair_title))
            .setMessage(getString(R.string.pair_message, host, TlsPin.pretty(invite.certSha256)))
            .setPositiveButton(getString(R.string.pair_connect)) { _, _ -> pairWith(invite) }
            .setNegativeButton(getString(R.string.pair_cancel), null)
            .show()
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
        if (intent.action == Intent.ACTION_DIAL) {
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
        const val REQUEST_CONTACTS = 1006
        private const val PREFS_UI = "lina_ui"
        private const val KEY_PHONE_DENIED = "phone_permission_denied"
    }
}
