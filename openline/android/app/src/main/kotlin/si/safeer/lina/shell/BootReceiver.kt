package si.safeer.lina.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import si.safeer.lina.transport.GatewayConnectionService

/**
 * Po zagonu telefona samo znova odpre povezavo do streznika.
 * Po posodobitvi aplikacije se lupina znova zazene: stara nosi staro konfiguracijo.
 * Ni tcpip 5555, ni podelitve pravic in ni vklopa brezzicnega odpravljanja napak.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in HANDLED) return
        val app = context.applicationContext
        GatewayConnectionService.start(app)
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Thread { runCatching { ShellLauncher.ensureRunning(app) } }.start()
        }
    }

    private companion object {
        val HANDLED = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)
    }
}
