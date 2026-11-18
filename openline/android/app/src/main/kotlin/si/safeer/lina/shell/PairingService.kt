package si.safeer.lina.shell

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import si.safeer.lina.AppLocale
import si.safeer.lina.R
import si.safeer.lina.protocol.FailureMessages
import si.safeer.lina.protocol.ShownError
import io.github.muntashirakon.adb.android.AdbMdns
import java.util.concurrent.Executors

/**
 * Enkratna nastavitev. Dokler je v nastavitvah odprt "Seznani napravo s kodo",
 * storitev po mDNS najde vrata in 6-mestno kodo pobere z odgovorom na obvestilo
 * (prehod v drugo aplikacijo bi zaprl sistemsko okno), nato seznani in zazene lupino.
 */
class PairingService : Service() {
    private val worker = Executors.newSingleThreadExecutor()
    private var mdns: AdbMdns? = null

    @Volatile
    private var pairingPort = -1

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CODE -> RemoteInput.getResultsFromIntent(intent)
                ?.getCharSequence(KEY_CODE)?.toString()
                ?.let(::pairWith)
            ACTION_STOP -> stopSelf()
            else -> begin()
        }
        return START_NOT_STICKY
    }

    private fun begin() {
        createChannel()
        val notification = status(getString(R.string.pair_begin))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        if (mdns != null) return
        mdns = AdbMdns(this, AdbMdns.SERVICE_TYPE_TLS_PAIRING) { _, port ->
            if (port <= 0 || port == pairingPort) return@AdbMdns
            pairingPort = port
            notify(codePrompt())
        }.also(AdbMdns::start)
    }

    private fun pairWith(code: String) {
        val port = pairingPort
        if (port <= 0) return notify(status(getString(R.string.pair_not_found)))
        notify(status(getString(R.string.pair_pairing)))
        worker.execute {
            val message = try {
                ShellLauncher.pair(this, port, code)
                notify(status(getString(R.string.pair_starting)))
                when (val result = ShellLauncher.ensureRunning(this)) {
                    ShellLauncher.Result.Running -> getString(R.string.pair_ready)
                    ShellLauncher.Result.Held -> getString(R.string.pair_ready_held)
                    ShellLauncher.Result.PairingRequired -> getString(R.string.pair_rejected)
                    ShellLauncher.Result.NeedsWifi -> getString(R.string.pair_need_wifi)
                    is ShellLauncher.Result.Failed -> getString(R.string.pair_failed, textFor(result.reason))
                }
            } catch (error: Exception) {
                val key = ShownError.resource("pair_error", error.message)
                val id = resources.getIdentifier(key, "string", packageName)
                if (id != 0) getString(id) else getString(R.string.pair_error)
            }
            notify(status(message, done = true))
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
        }
    }

    @Deprecated("Android 14 variant of the short-service timeout")
    override fun onTimeout(startId: Int) = timedOut()

    override fun onTimeout(startId: Int, fgsType: Int) = timedOut()

    private fun timedOut() {
        notify(status(getString(R.string.pair_timeout), done = true))
        stopSelf()
    }

    override fun onDestroy() {
        mdns?.stop()
        worker.shutdown()
        super.onDestroy()
    }

    private fun codePrompt(): Notification {
        val input = RemoteInput.Builder(KEY_CODE).setLabel(getString(R.string.pair_code_label)).build()
        val reply = PendingIntent.getService(
            this,
            1,
            Intent(this, PairingService::class.java).setAction(ACTION_CODE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        val action = Notification.Action.Builder(null, getString(R.string.pair_enter), reply).addRemoteInput(input).build()
        return builder(getString(R.string.pair_found))
            .addAction(action)
            .build()
    }

    private fun status(text: String, done: Boolean = false): Notification =
        builder(text).setOngoing(!done).setAutoCancel(done).build()

    private fun builder(text: String) = Notification.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_lina)
        .setContentTitle(getString(R.string.pair_title_note))
        .setContentText(text)
        .setStyle(Notification.BigTextStyle().bigText(text))
        .setOnlyAlertOnce(false)

    private fun notify(notification: Notification) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.pair_channel), NotificationManager.IMPORTANCE_HIGH),
        )
    }

    private fun textFor(code: String?): String {
        val key = FailureMessages.resourceName(code)
        val id = resources.getIdentifier(key, "string", packageName)
        return if (id != 0) getString(id) else getString(R.string.didnt_work)
    }

    companion object {
        private const val CHANNEL_ID = "setup"
        private const val NOTIFICATION_ID = 7001
        private const val KEY_CODE = "code"
        private const val ACTION_CODE = "si.safeer.lina.PAIRING_CODE"
        private const val ACTION_STOP = "si.safeer.lina.PAIRING_STOP"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, PairingService::class.java))
        }
    }
}
