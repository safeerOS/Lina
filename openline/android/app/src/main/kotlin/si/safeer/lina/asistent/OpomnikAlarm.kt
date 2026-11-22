package si.safeer.lina.asistent

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import si.safeer.lina.DialerActivity
import si.safeer.lina.R
import si.safeer.lina.samostojna.CakajociOpomnik
import si.safeer.lina.samostojna.OpomnikZapis

/**
 * Opomniki ob dolocenem casu (2j, 22. 11. 2026). Alarm sprozi sprejemnik, ki pokaze obvestilo.
 * Cakajoci opomniki so v SharedPreferences, da jih po ponovnem zagonu telefona ali posodobitvi znova vklopimo.
 * Cisti del (razclemba casa, zapis) je v samostojna/OpomnikCas.kt s preizkusi; tu je samo Android.
 */
object OpomnikAlarm {
    const val ACTION_SPROZI = "si.safeer.lina.OPOMNIK_SPROZI"
    const val EXTRA_ID = "id"
    const val EXTRA_BESEDILO = "besedilo"
    private const val PREFS = "lina_opomniki"
    private const val KLJUC = "cakajoci"
    private const val CHANNEL = "opomniki"

    /** Vrne true, ce je alarm natancen; false, ce ga je Android zaradi dovoljenja moral zaokrozati (opomnik se vseeno sprozi). */
    fun nastavi(context: Context, o: CakajociOpomnik): Boolean {
        shrani(context, o)
        return vklopi(context, o)
    }

    private fun vklopi(context: Context, o: CakajociOpomnik): Boolean {
        val am = context.getSystemService(AlarmManager::class.java) ?: return false
        val pi = pending(context, o)
        val natancno = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
        if (natancno) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, o.casMs, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, o.casMs, pi)
        return natancno
    }

    private fun pending(context: Context, o: CakajociOpomnik): PendingIntent =
        PendingIntent.getBroadcast(
            context, o.id.hashCode(),
            Intent(context, OpomnikPrejemnik::class.java).setAction(ACTION_SPROZI)
                .putExtra(EXTRA_ID, o.id).putExtra(EXTRA_BESEDILO, o.besedilo),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun shrani(context: Context, o: CakajociOpomnik) {
        val p = prefs(context)
        val novi = (p.getStringSet(KLJUC, emptySet()) ?: emptySet()).filterNot { OpomnikZapis.razclenji(it)?.id == o.id }.toMutableSet()
        novi.add(OpomnikZapis.kodiraj(o))
        p.edit().putStringSet(KLJUC, novi).apply()
    }

    fun odstrani(context: Context, id: String) {
        val p = prefs(context)
        val novi = (p.getStringSet(KLJUC, emptySet()) ?: emptySet()).filterNot { OpomnikZapis.razclenji(it)?.id == id }.toSet()
        p.edit().putStringSet(KLJUC, novi).apply()
    }

    /** Po zagonu telefona ali posodobitvi: vklopi vse cakajoce; zamujene sprozi cez nekaj sekund. */
    fun znovaVklopiVse(context: Context) {
        val zdaj = System.currentTimeMillis()
        val vsi = OpomnikZapis.razclenjeniVsi(prefs(context).getStringSet(KLJUC, emptySet()) ?: emptySet())
        for (o in vsi) vklopi(context, if (o.casMs < zdaj) o.copy(casMs = zdaj + 5_000L) else o)
    }

    fun pokaziObvestilo(context: Context, id: String, besedilo: String) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.reminder_channel), NotificationManager.IMPORTANCE_HIGH),
        )
        val odpri = PendingIntent.getActivity(
            context, id.hashCode(),
            Intent(context, DialerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        manager.notify(
            id.hashCode(),
            Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_lina)
                .setContentTitle(context.getString(R.string.reminder_title))
                .setContentText(besedilo)
                .setStyle(Notification.BigTextStyle().bigText(besedilo))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(odpri)
                .build(),
        )
    }
}

class OpomnikPrejemnik : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        when (intent.action) {
            OpomnikAlarm.ACTION_SPROZI -> {
                val id = intent.getStringExtra(OpomnikAlarm.EXTRA_ID) ?: return
                val besedilo = intent.getStringExtra(OpomnikAlarm.EXTRA_BESEDILO) ?: return
                OpomnikAlarm.pokaziObvestilo(app, id, besedilo)
                OpomnikAlarm.odstrani(app, id)
            }
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> OpomnikAlarm.znovaVklopiVse(app)
        }
    }
}
