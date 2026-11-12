package com.httpgateway.dialer.telecom

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.httpgateway.protocol.Line
import com.httpgateway.protocol.LineIdCodec

/**
 * Branje dostopnih klicnih linij (SIM in eSIM) iz sistema Android.
 * Ne bere telefonskih stevilk; identifikator racuna (pri SIM pogosto ICCID) gre samo kot SHA-256 (LineIdCodec).
 */
class LineSource(private val context: Context) {

    @RequiresApi(Build.VERSION_CODES.R)
    fun getLines(): List<Line> {
        // Preverimo dovoljenje preden poskusamo brati linije
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            return emptyList()
        }

        val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager? ?: return emptyList()
        val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager? ?: return emptyList()
        val subscriptionManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager? ?: return emptyList()

        val handles = try {
            telecomManager.callCapablePhoneAccounts
        } catch (e: SecurityException) {
            emptyList<PhoneAccountHandle>()
        }

        return handles.mapNotNull { handle ->
            val account = telecomManager.getPhoneAccount(handle) ?: return@mapNotNull null
            // Ustvarimo stabilen in neprozoren identifikator racuna
            val id = LineIdCodec.encode(handle.componentName.flattenToString(), handle.id)
            val label = account.label?.toString() ?: "Neznana linija"
            val active = account.isEnabled

            var isEsim = false
            try {
                // Pridobimo Subscription ID iz PhoneAccountHandle (zahteva API 30+)
                val subId = telephonyManager.getSubscriptionId(handle)
                if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
                    val subInfo = subscriptionManager.getActiveSubscriptionInfo(subId)
                    if (subInfo != null) {
                        isEsim = subInfo.isEmbedded
                    }
                }
            } catch (e: SecurityException) {
                // Ignoriramo napako dovoljenj
            } catch (e: UnsupportedOperationException) {
                // Naprava morda ne podpira te operacije
            }

            Line(id, label, isEsim, active)
        }
    }
}
