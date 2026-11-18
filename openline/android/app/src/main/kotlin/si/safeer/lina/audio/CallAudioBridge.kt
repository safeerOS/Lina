package si.safeer.lina.audio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import si.safeer.lina.DialerActivity
import si.safeer.lina.R
import si.safeer.lina.config.GatewayConfigStore
import si.safeer.lina.shell.ShellClient
import si.safeer.lina.shell.ShellLauncher
import si.safeer.lina.telecom.CallBackgroundAudio
import si.safeer.lina.telecom.CallLine
import si.safeer.lina.telecom.CallRegistry
import si.safeer.lina.telecom.LinaCallGate
import si.safeer.lina.transport.DeviceHealth
import si.safeer.lina.transport.GatewayRuntime
import si.safeer.lina.protocol.CaptureDriver
import si.safeer.lina.protocol.CaptureMachine
import si.safeer.lina.protocol.CapturePorts
import si.safeer.lina.protocol.GatewayUrl
import si.safeer.lina.protocol.MediaStream
import si.safeer.lina.protocol.ReturnNotice
import si.safeer.lina.protocol.ShellCleanup
import si.safeer.lina.protocol.TlsPin
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * App side of call audio: tells the shell server which call to stream. Audio itself flows
 * directly between the shell server and the gateway; it never passes through this process.
 * Odtis je isti kot pri nadzorni povezavi. Brez njega se zvok ne zacne.
 *
 * Razred ne odloca nicesar: dogodke odda v vrsto, odlocitve sprejme CaptureMachine,
 * ucinke izvede CaptureDriver prek vrat [Ports]. Stanja zajema tu ni.
 */
object CallAudioBridge {
    private const val TAG = "CallAudioBridge"

    enum class Status { SETUP_REQUIRED, STOPPED, READY }

    /** Ena nit za vse prehode avtomata. Nikoli ne caka na lupino. */
    private val queue = Executors.newSingleThreadExecutor { Thread(it, "callaudio-machine") }

    /** start, stop in izhod iz ozadja v vrstnem redu izdaje. */
    private val shellOps = Executors.newSingleThreadExecutor { Thread(it, "callaudio-shell") }

    /** Kar ne sme cakati na start, ki visi pri lupini: nujni stop, izhod po roku, prekinitev, obvestilo. */
    private val urgent = Executors.newSingleThreadExecutor { Thread(it, "callaudio-urgent") }

    /** Casovnika (drugi poskus, rok starta) samo oddata dogodek. Na niti najema bi ju zadrzal ping. */
    private val timer: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { Thread(it, "callaudio-timer") }

    /** Priprava in zagon lupine trajata sekunde, zato ne smeta zadrzati stopa. */
    private val prep = Executors.newSingleThreadExecutor { Thread(it, "callaudio-bridge") }
    private val lease: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { Thread(it, "callaudio-lease") }

    @Volatile
    private var appContext: Context? = null

    private val lineRecheck = AtomicReference<((String) -> Unit)?>(null)

    private val driver = CaptureDriver(
        ports = Ports,
        queue = queue,
        shellOps = shellOps,
        urgent = urgent,
        prep = prep,
        lease = lease,
        later = { delayMs, task -> timer.schedule(task, delayMs, TimeUnit.MILLISECONDS) },
    )

    fun initialize(context: Context) {
        appContext = context.applicationContext
        prep.execute { ShellLauncher.ensureRunning(context.applicationContext) }
        lease.scheduleWithFixedDelay({ driver.post(CaptureMachine.Event.LeaseDue) }, 3, 3, TimeUnit.SECONDS)
    }

    /** Blocking (local socket); call off the main thread. */
    fun status(context: Context): Status = when {
        ShellClient(context).isRunning() -> Status.READY
        !ShellLauncher.isPaired(context) -> Status.SETUP_REQUIRED
        else -> Status.STOPPED
    }

    fun restart(context: Context, onResult: (ShellLauncher.Result) -> Unit) {
        prep.execute {
            val client = ShellClient(context)
            client.exit()
            ShellCleanup.waitUntilDown(
                answers = { client.isRunning() },
                sleep = { Thread.sleep(it) },
                now = { System.currentTimeMillis() },
            )
            onResult(ShellLauncher.ensureRunning(context.applicationContext))
        }
    }

    /** Klic je ACTIVE in ga ima Lina: zazeni zvok samo s pripetim odtisom. */
    fun onCallActive(callId: String) = driver.post(CaptureMachine.Event.CallActive(callId))

    /** Linin klic je na cakanju ali je na liniji uporabnikov klic: zajem se zadrzi. */
    fun onCallSuspended(callId: String) = driver.post(CaptureMachine.Event.CallSuspended(callId))

    /** Klic je odstranjen ali ga je prevzel uporabnik. Klice se za vsak klic, ne le Linin. */
    fun onCallEnded(callId: String) = driver.post(CaptureMachine.Event.CallEnded(callId))

    /** Na liniji je klic, ki ga Lina nima. Zajem ustavimo, ne glede na id seje. */
    fun onUnsafeDownlink() = driver.post(CaptureMachine.Event.UnsafeDownlink)

    /** Storitev klicev pove, kako znova oceniti linijo. Klic ne sme blokirati. */
    fun setLineRecheck(hook: (String) -> Unit) {
        lineRecheck.set(hook)
    }

    /** Pobrise samo SVOJ kavelj: onDestroy stare storitve ne sme odstraniti kavlja nove (N12-10). */
    fun clearLineRecheck(hook: (String) -> Unit) {
        lineRecheck.compareAndSet(hook, null)
    }

    /** Vrata do Androida in lupine. Brez odlocitev: vsaka metoda naredi eno stvar in vrne izid. */
    private object Ports : CapturePorts {
        override fun prepare(callId: String): Boolean {
            val context = appContext ?: return false
            val config = GatewayConfigStore(context).load()
            if (config.wsUrl.isBlank() || config.deviceToken.isBlank()) {
                Log.w(TAG, "zvok se ne zacne za $callId: prehod ni nastavljen")
                return false
            }
            if (!GatewayUrl.accept(config.wsUrl, config.deviceToken)) {
                Log.w(TAG, "zvok se ne zacne za $callId: neveljaven naslov")
                return false
            }
            val mediaUrl = runCatching { MediaStream.deviceMediaUrl(config.wsUrl, callId) }.getOrElse {
                Log.w(TAG, "zvok se ne zacne za $callId: neveljaven naslov")
                return false
            }
            if (runCatching { TlsPin.requireMediaPin(mediaUrl, config.certSha256) }.isFailure) {
                Log.w(TAG, "zvok se ne zacne za $callId: ni wss ali odtisa")
                return false
            }
            val launch = ShellLauncher.ensureRunning(context)
            if (launch !is ShellLauncher.Result.Running && launch !is ShellLauncher.Result.Held) {
                Log.w(TAG, "call audio unavailable for $callId: $launch")
                return false
            }
            return true
        }

        override fun linePermits(callId: String): Boolean = CallLine.permitsCapture(callId)

        override fun start(callId: String): Boolean {
            val context = appContext ?: return false
            val reply = ShellClient(context).start(callId)
            val ok = reply?.optBoolean("ok") == true
            if (ok) Log.i(TAG, "start $callId -> $reply") else Log.w(TAG, "start $callId failed -> $reply")
            return ok
        }

        override fun stop(callId: String?, timeoutMs: Int): Boolean {
            val context = appContext ?: return false
            return ShellClient(context).stop(callId, timeoutMs)?.optBoolean("ok") == true
        }

        override fun markManual(callId: String) {
            LinaCallGate.markManual(callId)
        }

        override fun notifyServerEnded(callId: String) {
            GatewayRuntime.notifyCallEnded(callId)
        }

        override fun exitBackgroundAudio(callId: String, attemptExit: Boolean): CapturePorts.ExitFacts {
            val call = CallRegistry.get(callId)
                ?: return CapturePorts.ExitFacts(callPresent = false, exitOk = false, callState = 0)
            val exitOk = attemptExit && CallBackgroundAudio.exit(call)
            // Stanje po poskusu izhoda in iz istega vira kot drugod (API 31+ bere details.state).
            return CapturePorts.ExitFacts(callPresent = true, exitOk = exitOk, callState = CallRegistry.androidState(call))
        }

        override fun disconnect(callId: String): Boolean {
            // Klica ni vec v registru: je ze koncan, torej ni tih klic, ki bi ga bilo treba dvigniti.
            val call = CallRegistry.get(callId) ?: return true
            return runCatching { call.disconnect() }.isSuccess
        }

        override fun ping(): CapturePorts.PingFacts {
            val context = appContext
                ?: return CapturePorts.PingFacts(ok = false, reported = null, paired = false, wifi = false)
            val reply = try {
                ShellClient(context).ping()
            } catch (t: Throwable) {
                // Samo vrsta napake: sporocilo izjeme lahko nosi pot ali vsebino odgovora (N12-10).
                Log.w(TAG, "lease: ${t.javaClass.simpleName}")
                throw t
            }
            return CapturePorts.PingFacts(
                ok = reply != null,
                reported = reply?.optString("callId")?.takeIf { it.isNotEmpty() },
                paired = ShellLauncher.isPaired(context),
                wifi = DeviceHealth.isOnWifi(context),
            )
        }

        override fun confirm(callId: String) {
            val context = appContext ?: return
            ShellClient(context).confirm(callId)
        }

        override fun openUplink(callId: String): Boolean {
            val context = appContext ?: return false
            val ok = ShellClient(context).open(callId)?.optBoolean("ok") == true
            if (!ok) Log.w(TAG, "open $callId failed")
            return ok
        }

        override fun showNotice(notice: ReturnNotice) {
            val context = appContext ?: return
            notifyReturned(context, notice)
        }

        override fun publishShellLost() {
            val context = appContext ?: return
            notifyLost(context)
        }

        override fun cancelShellLost() {
            val context = appContext ?: return
            cancelLost(context)
        }

        override fun relaunchShell() {
            val context = appContext ?: return
            ShellLauncher.ensureRunning(context)
        }

        override fun recheckLine(callId: String) {
            lineRecheck.get()?.invoke(callId)
        }

        override fun nowMs(): Long = SystemClock.elapsedRealtime()

        override fun sleep(ms: Long) = Thread.sleep(ms)
    }

    private fun notifyLost(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channelId = "shell"
        manager.createNotificationChannel(
            NotificationChannel(channelId, context.getString(R.string.shell_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, DialerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_lina)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.shell_lost))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .build()
        manager.notify(7003, notification)
    }

    private fun cancelLost(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(7003)
    }

    private fun notifyReturned(context: Context, notice: ReturnNotice) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channelId = "shell"
        manager.createNotificationChannel(
            NotificationChannel(channelId, context.getString(R.string.shell_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val text = context.getString(
            when (notice) {
                ReturnNotice.RETURNED -> R.string.audio_returned
                ReturnNotice.NOT_RETURNED -> R.string.audio_not_returned
                ReturnNotice.DISCONNECTED -> R.string.call_disconnected
            },
        )
        val notification = Notification.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_lina)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .build()
        manager.notify(7004, notification)
    }
}
