package si.safeer.lina.asistent

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.provider.Settings
import si.safeer.lina.samostojna.SistemskiNadzor
import si.safeer.lina.samostojna.SistemskiNadzorVir
import si.safeer.lina.samostojna.StanjeBaterije
import si.safeer.lina.samostojna.soglasja.ShrambaSoglasij
import si.safeer.lina.samostojna.soglasja.Soglasje
import si.safeer.lina.samostojna.soglasja.TrajnaSoglasja
import si.safeer.lina.samostojna.soglasja.ZapisSoglasij

/**
 * Sistemski nadzor telefona na Androidu (lastnik 23. 11. 2026): stikalo (privzeto vklopljeno), baterija, »ne moti«, svetlost.
 * Logika (razclenitev, odstotek, kdaj vprasati) je v SistemskiNadzor modula samostojna in ima preizkuse; tu so samo klici sistema.
 */
class SistemskiNadzorAndroid(c: Context) : SistemskiNadzorVir {
    private val k = c.applicationContext
    private val prefs = k.getSharedPreferences("lina_sistem", Context.MODE_PRIVATE)

    override fun vklopljen(): Boolean = prefs.getBoolean("vklopljen", true)
    fun nastavi(vklop: Boolean) { prefs.edit().putBoolean("vklopljen", vklop).apply() }

    /** Lepljivi namen ACTION_BATTERY_CHANGED: brez dovoljenja in brez sprejemnika. */
    override fun baterija(): StanjeBaterije? {
        val n = k.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
        val raven = n.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val lestvica = n.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (raven < 0 || lestvica <= 0) return null
        val stanje = n.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return StanjeBaterije(raven * 100 / lestvica, stanje == BatteryManager.BATTERY_STATUS_CHARGING || stanje == BatteryManager.BATTERY_STATUS_FULL)
    }

    private val obvestila get() = k.getSystemService(NotificationManager::class.java)

    fun imaDostopNeMoti(): Boolean = obvestila.isNotificationPolicyAccessGranted

    /** Vrne false brez dostopa ali ob napaki. targetSdk 35: na Androidu 15 to vklopi nacin, ki ga ima v lasti Lina. */
    fun nastaviNeMoti(vklop: Boolean): Boolean = imaDostopNeMoti() && runCatching {
        obvestila.setInterruptionFilter(if (vklop) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
    }.isSuccess

    fun imaDostopSvetlost(): Boolean = Settings.System.canWrite(k)

    /** Rocni nacin svetlosti (samodejna bi vrednost takoj prepisala), nato vrednost 1..255. */
    fun nastaviSvetlost(odstotek: Int): Boolean = imaDostopSvetlost() && runCatching {
        Settings.System.putInt(k.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
        Settings.System.putInt(k.contentResolver, Settings.System.SCREEN_BRIGHTNESS, SistemskiNadzor.vSistemsko(odstotek))
    }.getOrDefault(false)

    fun namenDostopNeMoti(): Intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
    fun namenDostopSvetlost(): Intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + k.packageName))

    companion object {
        /** Skupni modul soglasij (naloga 02f) nad SharedPreferences; brez predpomnilnika (pogodba ShrambaSoglasij). */
        fun soglasja(c: Context): TrajnaSoglasja {
            val p = c.applicationContext.getSharedPreferences("lina_soglasja", Context.MODE_PRIVATE)
            return TrajnaSoglasja(object : ShrambaSoglasij {
                override fun preberi(): List<Soglasje> = ZapisSoglasij.preberi(p.getString("seznam", null))
                override fun shrani(soglasja: List<Soglasje>) { p.edit().putString("seznam", ZapisSoglasij.zapisi(soglasja)).commit() }
            })
        }
    }
}
