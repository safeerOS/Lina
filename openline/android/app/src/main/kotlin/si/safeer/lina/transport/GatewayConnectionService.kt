package si.safeer.lina.transport

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import si.safeer.lina.AppLocale
import si.safeer.lina.DialerActivity
import si.safeer.lina.R
import si.safeer.lina.protocol.ConnectionNotice

/**
 * Keeps the app process running so the gateway WebSocket survives in the background. Without it
 * Android (and Vivo's power manager in particular) freezes the app within minutes and the phone
 * drops off the gateway.
 */
class GatewayConnectionService : Service() {
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification(GatewayRuntime.isConnected())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        GatewayRuntime.setConnectionChangedListener { connected ->
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(connected))
        }
        GatewayRuntime.initialize(applicationContext)
        return START_STICKY
    }

    override fun onDestroy() {
        GatewayRuntime.setConnectionChangedListener(null)
        super.onDestroy()
    }

    private fun buildNotification(connected: Boolean): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.connection_channel), NotificationManager.IMPORTANCE_MIN).apply {
                description = getString(R.string.connection_channel_desc)
                setShowBadge(false)
            },
        )
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, DialerActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        // Lastnik 22. 11. 2026: »zakaj pise ni povezave« - Lina je klice sprejemala sama v telefonu, obvestilo pa je javljalo samo
        // povezavo z racunalnikom. Brez racunalnika in s pripravljeno samostojno potjo obvestilo pove, da Lina odgovarja v telefonu.
        val lokalno = !connected && runCatching { si.safeer.lina.telecom.SamostojnaPripravljenost.jePripravljena(this) }.getOrDefault(false)
        val text = when {
            lokalno -> getString(R.string.lina_answers_local)
            ConnectionNotice.resourceName(connected) == "connection_connected" -> getString(R.string.connection_connected)
            else -> getString(R.string.connection_offline)
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_lina)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "connection"
        private const val NOTIFICATION_ID = 7002

        /** Safe to call from anywhere; background start restrictions are logged, not thrown. */
        fun start(context: Context) {
            runCatching { context.startForegroundService(Intent(context, GatewayConnectionService::class.java)) }
                .onFailure { Log.w("GatewayConnection", "could not start foreground service", it) }
        }
    }
}
