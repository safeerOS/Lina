package si.safeer.lina.telecom

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import si.safeer.lina.R
import si.safeer.lina.protocol.NoticePermission

/**
 * Obvestilo o klicu, ki je dobil zaseden znak, ker je Lina govorila z drugim klicateljem.
 * Telecom zavrnjen klic zapise po svoje (na nekaterih napravah kot zavrnjen, ne zgresen) in zanj
 * ne pokaze obvestila; dnevnika klicev aplikacija ne pise (nima WRITE_CALL_LOG). Zato lastno obvestilo.
 * Stevilka gre samo v obvestilo uporabniku, nikoli v dnevnik.
 */
object MissedCallNotice {
    private const val CHANNEL = "missed"
    private const val PREFS = "missed_notice"
    private const val KEY_UNSEEN = "unseen"

    /**
     * N13-5: brez dovoljenja za obvestila (API 33+) obvestilo ni vidno. Zgresen klic zato STEJEMO (brez
     * stevilke) in ob odprtju aplikacije uporabniku povemo, da jih je bilo, in zaprosimo za dovoljenje.
     */
    fun canShow(context: Context): Boolean {
        val granted = Build.VERSION.SDK_INT < NoticePermission.API_NOTIFICATION_PERMISSION ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val enabled = context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() ?: false
        return NoticePermission.canShow(Build.VERSION.SDK_INT, granted, enabled)
    }

    /** Stevilo zgresenih klicev brez vidnega obvestila; prebere ga in ponastavi DialerActivity. */
    fun takeUnseen(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val count = prefs.getInt(KEY_UNSEEN, 0)
        if (count != 0) prefs.edit().putInt(KEY_UNSEEN, 0).apply()
        return count
    }

    fun show(context: Context, callId: String, number: String) {
        if (!canShow(context)) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            prefs.edit().putInt(KEY_UNSEEN, NoticePermission.nextUnseen(prefs.getInt(KEY_UNSEEN, 0), shown = false)).apply()
            // Samo dejstvo, brez stevilke (stevilka gre samo v obvestilo uporabniku).
            Log.w("MissedCallNotice", "obvestilo ni dovoljeno; zgresen klic steje samo stevec")
            return
        }
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.missed_channel), NotificationManager.IMPORTANCE_DEFAULT).apply {
                // N14-1: stevilka klicatelja ne sme biti vidna na zaklenjenem zaslonu.
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            },
        )
        val who = si.safeer.lina.ContactSearch(context).nameOf(number)?.let { "$it \u00b7 $number" } ?: number.ifBlank { context.getString(R.string.unknown_number) }
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_lina)
            .setContentTitle(context.getString(R.string.missed_title))
            .setContentText(context.getString(R.string.missed_while_lina, who))
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            // Javna razlicica (zaklenjen zaslon): samo dejstvo, brez stevilke.
            .setPublicVersion(
                Notification.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_lina)
                    .setContentTitle(context.getString(R.string.missed_title))
                    .build(),
            )
            .setAutoCancel(true)
            .setShowWhen(true)
            .build()
        // Vsak klic svoje obvestilo: drugi zgreseni klic prvega ne prepise.
        manager.notify(callId, 7005, notification)
    }
}
