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
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.NiPovezave
import si.safeer.lina.podpis.PovezavaZLino
import si.safeer.lina.protocol.LinePicker
import si.safeer.lina.protocol.LineStatus
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
            badge.setTextColor(badge.context.getColor(if (done) R.color.on_ink else R.color.muted))
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
    private lateinit var tabAssistant: View
    private lateinit var tabCallsButton: Button
    private lateinit var tabAssistantButton: Button
    private lateinit var assistantStatus: TextView
    private lateinit var assistantDeviceId: TextView
    private lateinit var assistantTaskInput: EditText
    private lateinit var assistantSendButton: Button
    /** Povezava z Lino na racunalniku. Koncne tocke v Lini se ni (14. 11. 2026), zato NiPovezave. */
    private val linaLink: PovezavaZLino = NiPovezave
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

    override fun onPause() {
        handler.removeCallbacks(ticker)
        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(wifiCallback) }
        wifiDialog?.dismiss()
        super.onPause()
    }

    private fun bindViews() {
        findViewById<View>(R.id.root).setOnApplyWindowInsetsListener { view, insets ->
            val b = SistemskeVrstice.odmiki(insets)
            view.setPadding(b[0], b[1], b[2], b[3])
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
        findViewById<Button>(R.id.callButton).setOnClickListener { requestOrDial(numberInput.text.toString().trim()) }

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
                getSharedPreferences(PREFS_UI, MODE_PRIVATE).edit().putBoolean(KEY_PHONE_ASKED, true).apply()
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
        val codes = listOf(AppLocale.SYSTEM, AppLocale.EN, AppLocale.SL)
        val labels = listOf(
            getString(R.string.language_system),
            getString(R.string.language_english),
            getString(R.string.language_slovenian),
        )
        spinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
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
    private fun phonePermissionDeniedForever(): Boolean =
        checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED &&
            getSharedPreferences(PREFS_UI, MODE_PRIVATE).getBoolean(KEY_PHONE_ASKED, false) &&
            !shouldShowRequestPermissionRationale(Manifest.permission.READ_PHONE_STATE)

    /**
     * Zavihka »Klici« in »Asistent« (lastnik 14. 11. 2026: ena aplikacija). Asistentka ne uporablja nicesar iz poti klicev:
     * podpis je samo v modulu podpis, gumb je samo tu.
     */
    private fun bindTabs() {
        tabCalls = findViewById(R.id.tabCalls)
        tabAssistant = findViewById(R.id.tabAssistant)
        tabCallsButton = findViewById(R.id.tabCallsButton)
        tabAssistantButton = findViewById(R.id.tabAssistantButton)
        assistantStatus = findViewById(R.id.assistantStatus)
        assistantDeviceId = findViewById(R.id.assistantDeviceId)
        assistantTaskInput = findViewById(R.id.assistantTaskInput)
        assistantSendButton = findViewById(R.id.assistantSendButton)
        tabCallsButton.setOnClickListener { showTab(assistant = false) }
        tabAssistantButton.setOnClickListener { showTab(assistant = true) }
        assistantSendButton.setOnClickListener { sendTask() }
        showTab(assistant = false)
    }

    private fun showTab(assistant: Boolean) {
        tabCalls.visibility = if (assistant) View.GONE else View.VISIBLE
        tabAssistant.visibility = if (assistant) View.VISIBLE else View.GONE
        tabCallsButton.isSelected = !assistant
        tabAssistantButton.isSelected = assistant
        tabCallsButton.alpha = if (assistant) 0.6f else 1f
        tabAssistantButton.alpha = if (assistant) 1f else 0.6f
        if (assistant) renderAssistant()
    }

    private fun renderAssistant() {
        val connected = linaLink.povezana()
        assistantStatus.text = getString(if (connected) R.string.assistant_ready else R.string.assistant_no_link)
        // Pregled 17 (B6): KeyStore ne na glavni niti.
        assistantDeviceId.visibility = View.GONE
        Thread {
            val id = runCatching { NapravaKljuc.id() }.getOrNull()
            runOnUiThread {
                if (id != null && !isFinishing) {
                    assistantDeviceId.text = getString(R.string.assistant_device_id, id)
                    assistantDeviceId.visibility = View.VISIBLE
                }
            }
        }.start()
        // Kar ni narejeno, se ne pokaze: vnos in gumb samo ob povezavi z Lino.
        assistantTaskInput.visibility = if (connected) View.VISIBLE else View.GONE
        assistantSendButton.visibility = if (connected) View.VISIBLE else View.GONE
    }

    private fun sendTask() {
        if (!linaLink.povezana()) { renderAssistant(); return }
        if (NalogaLine.besedilo(assistantTaskInput.text.toString()) == null) return toast(getString(R.string.assistant_bad_text))
        val vnos = assistantTaskInput.text.toString()
        assistantSendButton.isEnabled = false
        // Pregled 17 (B6): podpis (KeyStore) in posiljanje zunaj glavne niti.
        Thread {
            val naloga = runCatching {
                NapravaKljuc.podpisiNalogo(NalogaLine.nakljucno(), vnos, System.currentTimeMillis(), NalogaLine.nakljucno())
            }.getOrNull()
            val ok = naloga != null && runCatching { linaLink.poslji(naloga) }.getOrDefault(false)
            runOnUiThread {
                assistantSendButton.isEnabled = true
                if (ok) assistantTaskInput.setText("")
                toast(getString(if (ok) R.string.assistant_sent else R.string.assistant_not_sent))
            }
        }.start()
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
        lineSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
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
            actionText = if (exempt) getString(R.string.vivo_setting) else getString(R.string.allow),
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
        if (requestCode == REQUEST_NOTIFICATIONS && granted) startAudioSetup()
        if (requestCode == REQUEST_PHONE_STATE) renderLines()
        pendingPermissionNumber = null
    }

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
                val invite = barcode.rawValue?.let(GatewayPairing::parse)
                if (invite == null) toast(getString(R.string.qr_bad)) else confirmAndPair(invite)
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
        private const val PREFS_UI = "lina_ui"
        private const val KEY_PHONE_ASKED = "phone_permission_asked"
    }
}
