package com.httpgateway.dialer.telecom

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import com.httpgateway.dialer.InCallActivity
import com.httpgateway.dialer.R

/**
 * N14-4: obvestilo dohodnega klica s celozaslonskim namenom, dvigni/zavrni. Odlocitev, kdaj ga pokazati ali
 * umakniti, je v protocol/IncomingCallAlert (preizkus brez Androida). Tu je samo Android.
 * Zvonjenje in vibriranje opravi Telecom; kanal je zato tih (sicer bi zvonilo dvakrat).
 */
object IncomingCallNotice {
    private const val CHANNEL = "incoming"
    private const val NOTIFICATION_ID = 7006
    private const val TIMEOUT_MS = 90_000L

    fun show(context: Context, callId: String, number: String) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.incoming_call), NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val ui = PendingIntent.getActivity(
            context, callId.hashCode(),
            Intent(context, InCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            flags,
        )
        val answer = PendingIntent.getActivity(
            context, callId.hashCode() + 1,
            Intent(context, InCallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(InCallActivity.EXTRA_ANSWER_CALL_ID, callId),
            flags,
        )
        val decline = PendingIntent.getBroadcast(
            context, callId.hashCode() + 2,
            Intent(context, IncomingCallActionReceiver::class.java).putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId),
            flags,
        )
        val who = number.ifBlank { context.getString(R.string.unknown_number) }
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(context.getString(R.string.incoming_call))
            .setContentText(who)
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(TIMEOUT_MS)
            .setContentIntent(ui)
            .setOnlyAlertOnce(true)
            .setFullScreenIntent(ui, true)
            .addAction(Notification.Action.Builder(Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel), context.getString(R.string.decline), decline).build())
            .addAction(Notification.Action.Builder(Icon.createWithResource(context, android.R.drawable.ic_menu_call), context.getString(R.string.answer), answer).build())
            .build()
        manager.notify(callId, NOTIFICATION_ID, notification)
    }

    fun cancel(context: Context, callId: String) {
        context.getSystemService(NotificationManager::class.java)?.cancel(callId, NOTIFICATION_ID)
    }

    fun cancelAll(context: Context) {
        for (entry in CallRegistry.snapshot()) cancel(context, entry.callId)
    }
}
