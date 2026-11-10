package com.httpgateway.dialer.telecom

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.httpgateway.dialer.R

/**
 * Obvestilo o klicu, ki je dobil zaseden znak, ker je Lina govorila z drugim klicateljem.
 * Telecom zavrnjen klic zapise po svoje (na nekaterih napravah kot zavrnjen, ne zgresen) in zanj
 * ne pokaze obvestila; dnevnika klicev aplikacija ne pise (nima WRITE_CALL_LOG). Zato lastno obvestilo.
 * Stevilka gre samo v obvestilo uporabniku, nikoli v dnevnik.
 */
object MissedCallNotice {
    private const val CHANNEL = "missed"

    fun show(context: Context, callId: String, number: String) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.missed_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val who = number.ifBlank { context.getString(R.string.unknown_number) }
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_missed_call)
            .setContentTitle(context.getString(R.string.missed_title))
            .setContentText(context.getString(R.string.missed_while_lina, who))
            .setAutoCancel(true)
            .setShowWhen(true)
            .build()
        // Vsak klic svoje obvestilo: drugi zgreseni klic prvega ne prepise.
        manager.notify(callId, 7005, notification)
    }
}
