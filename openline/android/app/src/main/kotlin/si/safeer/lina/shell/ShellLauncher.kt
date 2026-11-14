package si.safeer.lina.shell

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import si.safeer.lina.config.GatewayConfigStore
import si.safeer.lina.protocol.BusyStreak
import si.safeer.lina.protocol.FifoCleanup
import si.safeer.lina.protocol.LaunchSteps
import si.safeer.lina.protocol.ShellAuth
import si.safeer.lina.protocol.ShellCleanup
import si.safeer.lina.protocol.ShellLaunchVerdict
import si.safeer.lina.protocol.ShellStarter
import org.lsposed.hiddenapibypass.HiddenApiBypass
import java.io.InputStream

/**
 * Zazene zvocni streznik lupine prek lastnega adbd, kot Shizuku, brez korena in brez racunalnika.
 * Klic je blokirajoc; klici ga izven glavne niti.
 *
 * Ne preklapljamo adbd na tcpip 5555, ne podeljujemo WRITE_SECURE_SETTINGS in ne vklapljamo
 * brezzicnega odpravljanja napak sami. Po vnovicnem zagonu telefona lupina ne stece sama.
 * Running pomeni, da je lupina odgovorila sele po zaprtju seje ADB. Ce seja na tem
 * Androidu lupino ubije, sejo drzimo odprto, dokler je brezzicno odpravljanje napak vklopljeno.
 */
object ShellLauncher {
    private const val TAG = "ShellLauncher"
    private const val CONNECT_TIMEOUT_MS = 10_000L
    private const val PROCESS_NAME = "httpgateway_shell"

    sealed interface Result {
        /** Lupina zivi brez odprte seje ADB. */
        data object Running : Result
        /** Seja ADB mora ostati odprta. To ni Running. */
        data object Held : Result
        data object PairingRequired : Result
        /** Se ne tece, zagon pa potrebuje Wi-Fi (adbd brez njega ni dosegljiv). */
        data object NeedsWifi : Result
        data class Failed(val reason: String) : Result
    }

    fun Result.servesAudio(): Boolean = this is Result.Running || this is Result.Held

    fun isPaired(context: Context): Boolean = prefs(context).getBoolean(KEY_PAIRED, false)

    /** Enkratna seznanitev s 6-mestno kodo iz "Seznani napravo s kodo". */
    fun pair(context: Context, port: Int, code: String) {
        prepare()
        check(GatewayAdbManager.get(context).pair("127.0.0.1", port, code.trim())) { "pairing rejected" }
        prefs(context).edit().putBoolean(KEY_PAIRED, true).apply()
    }

    /** Poskrbi, da lupina tece. Brez samodejnega tcpip in brez vklopa brezzicnega odpravljanja napak. */
    /** Po vrsti: vzporedni zagoni bi ubili streznik drug drugega (`pkill`) in se stepli za vrata. */
    @Synchronized
    fun ensureRunning(context: Context): Result =
        launch(context).also { if (!it.servesAudio()) Log.w(TAG, "shell server not running: $it") }

    /**
     * Ustavi lupino in pozabi lokalni kljuc. Kljuca na telefonu ne brišemo:
     * adb_keys lupina ne sme pisati, parjenje je v adb_temp_keys.xml.
     * Sporocilo tega ne oznaci kot uspeh.
     */
    @Synchronized
    fun stopAndWipe(context: Context): Boolean {
        val client = ShellClient(context)
        client.exit()
        var acknowledged = false
        runCatching {
            prepare()
            val adb = GatewayAdbManager.get(context)
            if (!adb.isConnected && isOnWifi(context)) {
                adb.autoConnect(context, CONNECT_TIMEOUT_MS)
            }
            if (adb.isConnected) {
                val stream = adb.openStream("shell:" + ShellStarter.killCommand(PROCESS_NAME))
                val output = readAck(stream.openInputStream())
                acknowledged = ShellCleanup.killAcknowledged(output)
                runCatching { stream.close() }
            }
        }
        releaseHeld()
        val waitDown = ShellCleanup.waitUntilDown(
            answers = { client.isRunning() },
            sleep = { Thread.sleep(it) },
            now = { System.currentTimeMillis() },
        )
        val still = !waitDown
        runCatching {
            prepare()
            GatewayAdbManager.get(context).disconnect()
        }
        GatewayAdbManager.forget(context)
        prefs(context).edit()
            .putBoolean(KEY_PAIRED, false)
            .remove("token")
            .remove("port")
            .putBoolean("adb_session_held", false)
            .remove("detach_verdict")
            .apply()
        if (!acknowledged && still) Log.w(TAG, "pkill ni potrdil konca")
        return ShellCleanup.wipeStopped(still)
    }

    private fun launch(context: Context): Result {
        val client = ShellClient(context)
        val config = GatewayConfigStore(context).load()
        val signature = ShellAuth.configSignature(client.version, config.wsUrl, config.certSha256, config.deviceToken)
        var busySeen = 0
        while (true) {
            val probe = client.probe(signature)
            val steps = LaunchSteps.sequence(
                probe,
                paired = isPaired(context),
                detachedPort = client.port.takeIf { it > 0 },
                busySeen = busySeen,
            )
            val (nextSeen, action) = BusyStreak.action(busySeen, probe)
            busySeen = nextSeen
            when (action) {
                BusyStreak.StepAction.USE ->
                    return if (client.sessionHeld()) Result.Held else Result.Running
                BusyStreak.StepAction.RETRY -> continue
                BusyStreak.StepAction.FORGET,
                BusyStreak.StepAction.START,
                -> {
                    if (steps.contains(LaunchSteps.Step.EXIT_AND_FORGET)) {
                        client.exit()
                        releaseHeld()
                        client.forgetPort()
                    }
                    break
                }
            }
        }
        if (!isPaired(context)) return Result.PairingRequired

        val adb = GatewayAdbManager.get(context)
        return try {
            prepare()
            if (!adb.isConnected) {
                if (!isOnWifi(context)) return Result.NeedsWifi
                if (!adb.autoConnect(context, CONNECT_TIMEOUT_MS)) return Result.Failed("wireless_unreachable")
            }
            client.exit()
            releaseHeld()
            client.rotateToken()
            val fresh = GatewayConfigStore(context).load()
            val launch = client.launchConfig(
                mediaUrl = fresh.wsUrl,
                certSha256 = fresh.certSha256,
                deviceId = fresh.deviceId,
                deviceToken = fresh.deviceToken,
            )
            val apk = context.applicationInfo.sourceDir
            val main = ShellServerMain::class.java.name
            val known = client.detachMemory()
            if (!ShellLaunchVerdict.skipDetachedAttempt(known)) {
                val detached = ShellStarter.detachedScript(apk, main, client.version, PROCESS_NAME)
                val command = ShellStarter.adbShellCommand(detached, PROCESS_NAME)
                if (ShellAuth.argvHasSecret(listOf(command, detached), launch)) {
                    return Result.Failed("secret_in_argv")
                }
                val port = runStarter(adb, command, ShellAuth.stdinText(launch), hold = false)
                if (port == null) {
                    client.rememberDetach(ShellLaunchVerdict.Kind.HOLD)
                    cleanupFifos(adb)
                } else {
                    client.rememberPort(port)
                }
                runCatching { adb.disconnect() }
                if (port != null) {
                    val verdict = if (ShellLaunchVerdict.shouldMeasure(known)) {
                        measureDetach(client)
                    } else if (client.isRunning()) {
                        ShellLaunchVerdict.Kind.DETACHED
                    } else {
                        ShellLaunchVerdict.Kind.HOLD
                    }
                    client.rememberDetach(verdict)
                    if (verdict == ShellLaunchVerdict.Kind.DETACHED) {
                        client.setSessionHeld(false)
                        return Result.Running
                    }
                }
            }
            if (!adb.isConnected) {
                if (!isOnWifi(context)) return Result.NeedsWifi
                if (!adb.autoConnect(context, CONNECT_TIMEOUT_MS)) return Result.Failed("wireless_unreachable")
            }
            val held = ShellStarter.heldScript(apk, main, client.version, PROCESS_NAME)
            val heldCommand = ShellStarter.adbShellCommand(held, PROCESS_NAME)
            if (ShellAuth.argvHasSecret(listOf(heldCommand, held), launch)) {
                return Result.Failed("secret_in_argv")
            }
            val heldPort = runStarter(adb, heldCommand, ShellAuth.stdinText(launch), hold = true)
            if (heldPort != null) client.rememberPort(heldPort)
            if (heldPort == null || !waitUntil { client.isRunning() }) {
                releaseHeld()
                runCatching { adb.disconnect() }
                return Result.Failed("shell_did_not_start")
            }
            client.rememberPort(heldPort)
            client.setSessionHeld(true)
            if (ShellLaunchVerdict.shouldMeasure(known)) client.rememberDetach(ShellLaunchVerdict.Kind.HOLD)
            Result.Held
        } catch (_: io.github.muntashirakon.adb.AdbPairingRequiredException) {
            prefs(context).edit().putBoolean(KEY_PAIRED, false).apply()
            Result.PairingRequired
        } catch (e: Exception) {
            Log.e(TAG, "launch failed", e)
            cleanupFifos(adb)
            releaseHeld()
            runCatching { adb.disconnect() }
            Result.Failed("shell_did_not_start")
        }
    }

    private fun cleanupFifos(adb: GatewayAdbManager) {
        if (!adb.isConnected) return
        runCatching {
            val stream = adb.openStream("shell:" + FifoCleanup.command())
            val input = stream.openInputStream()
            val finished = java.util.concurrent.atomic.AtomicBoolean(false)
            val reader = Thread({
                runCatching {
                    val buf = ByteArray(128)
                    while (input.read(buf) >= 0) Unit
                }
                finished.set(true)
            }, "fifo-clean")
            reader.isDaemon = true
            reader.start()
            FifoCleanup.awaitExit(
                poll = { if (finished.get()) -1 else 0 },
                sleep = { Thread.sleep(it) },
                now = { System.currentTimeMillis() },
            )
            runCatching { stream.close() }
            runCatching { reader.join(FifoCleanup.WAIT_MS) }
        }
    }

    /**
     * Running steje sele po pingih skozi 3–5 s po odklopu in se enem po ~10 s.
     * Ce zgodnji pingi padejo, je to Held brez cakanja do 10 s.
     */
    private fun measureDetach(client: ShellClient): ShellLaunchVerdict.Kind {
        val start = System.currentTimeMillis()
        var earlyOk = 0
        var earlyTried = 0
        while (System.currentTimeMillis() - start < ShellLaunchVerdict.EARLY_WINDOW_MS) {
            earlyTried += 1
            if (client.isRunning()) earlyOk += 1
            val left = ShellLaunchVerdict.EARLY_WINDOW_MS - (System.currentTimeMillis() - start)
            if (left <= 0) break
            Thread.sleep(minOf(ShellLaunchVerdict.PING_GAP_MS, left))
        }
        if (earlyTried < ShellLaunchVerdict.MIN_EARLY_PINGS || earlyOk != earlyTried) {
            return ShellLaunchVerdict.Kind.HOLD
        }
        val rest = ShellLaunchVerdict.LATE_AFTER_MS - (System.currentTimeMillis() - start)
        if (rest > 0) Thread.sleep(rest)
        return ShellLaunchVerdict.afterDisconnect(earlyOk, earlyTried, lateOk = client.isRunning())
    }

    private fun waitUntil(ping: () -> Boolean): Boolean {
        repeat(20) {
            if (ping()) return true
            Thread.sleep(200)
        }
        return false
    }

    private fun isOnWifi(context: Context): Boolean {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val caps = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    /**
     * Skrivnosti grejo na stdin. Izhod, ki ni vrstica PORT, se zavrze in
     * ne gre v dnevnik: pty odmeva vhod, v njem je zeton.
     * hold=true pusti tok ADB odprt, da proces prezivi konec ukaza.
     */
    private fun runStarter(adb: GatewayAdbManager, command: String, stdin: String, hold: Boolean): Int? {
        val stream = adb.openStream("shell:$command")
        if (hold) heldClose = { runCatching { stream.close() } }
        return try {
            val output = stream.openOutputStream()
            output.write(stdin.toByteArray(Charsets.UTF_8))
            output.flush()
            val port = readPort(stream.openInputStream())
            if (!hold) {
                runCatching { output.close() }
                runCatching { stream.close() }
            }
            port
        } catch (e: java.io.IOException) {
            if (!hold) runCatching { stream.close() }
            if (e.message?.contains("closed", ignoreCase = true) == true) null else throw e
        }
    }

    private fun readPort(input: InputStream): Int? {
        val buffer = ByteArray(256)
        val text = StringBuilder()
        val started = System.currentTimeMillis()
        while (System.currentTimeMillis() - started < 8_000) {
            val available = runCatching { input.available() }.getOrDefault(0)
            if (available <= 0) {
                Thread.sleep(50)
                continue
            }
            val n = input.read(buffer)
            if (n < 0) break
            text.append(String(buffer, 0, n, Charsets.UTF_8))
            val port = ShellAuth.portFromBuffer(text.toString())
            if (port != null) return port
        }
        return null
    }

    /** KONEC iz pkill. Nepopolna vrstica se ne steje. */
    private fun readAck(input: InputStream): String {
        val buffer = ByteArray(256)
        val text = StringBuilder()
        val started = System.currentTimeMillis()
        while (System.currentTimeMillis() - started < 4_000) {
            val available = runCatching { input.available() }.getOrDefault(0)
            if (available <= 0) {
                if (ShellCleanup.killAcknowledged(text.toString())) break
                Thread.sleep(40)
                continue
            }
            val n = input.read(buffer)
            if (n < 0) break
            text.append(String(buffer, 0, n, Charsets.UTF_8))
            if (ShellCleanup.killAcknowledged(text.toString())) break
        }
        return text.toString()
    }

    private fun releaseHeld() {
        heldClose?.invoke()
        heldClose = null
    }

    /** libadb do Conscrypt pride prek skritih API-jev. */
    private fun prepare() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) HiddenApiBypass.addHiddenApiExemptions("L")
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences("shell_server", Context.MODE_PRIVATE)

    private const val KEY_PAIRED = "paired"

    @Volatile
    private var heldClose: (() -> Unit)? = null
}
