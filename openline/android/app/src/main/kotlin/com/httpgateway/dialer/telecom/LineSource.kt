package com.httpgateway.dialer.telecom

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.httpgateway.protocol.Line
import com.httpgateway.protocol.LineIdCodec

/**
 * Branje dostopnih klicnih linij (SIM in eSIM) iz sistema Android.
 * Ne bere telefonskih stevilk; identifikator racuna (pri SIM pogosto ICCID) gre samo kot HMAC s kljucem namestitve (LineIdCodec).
 * Samo racuni SIM/eSIM (CAPABILITY_SIM_SUBSCRIPTION): racuni SIP/VoIP drugih aplikacij niso linije za Lino (pregled 15, N14).
 */
class LineSource(private val context: Context, private val key: ByteArray) {

    /** Id linije za klic (isti zapis kot v getLines); null, ce klic nima racuna. */
    fun idOf(handle: PhoneAccountHandle?): String? =
        handle?.let { LineIdCodec.encode(key, it.componentName.flattenToString(), it.id) }

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED


    /** Vse SIM/eSIM linije; brez dovoljenja READ_PHONE_STATE prazen seznam (Lina potem ne prevzema, N1/N4). */
    fun getLines(): List<Line> {
        // Preverimo dovoljenje preden poskusamo brati linije
        if (!hasPermission()) return emptyList()

        val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager? ?: return emptyList()
        val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager? ?: return emptyList()
        val subscriptionManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager? ?: return emptyList()

        val handles = try {
            telecomManager.callCapablePhoneAccounts
        } catch (e: SecurityException) {
            emptyList<PhoneAccountHandle>()
        }

        return handles.mapNotNull { handle ->
            // Racun drugega uporabnika naprave ali nedosegljiv racun ne sme sesuti branja.
            val account = telecomManager.getPhoneAccount(handle) ?: return@mapNotNull null
            if (!account.hasCapabilities(android.telecom.PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION)) return@mapNotNull null
            // Racun brez imena izpustimo (prej je en tak racun naredil ves izbor neveljaven).
            val label = account.label?.toString()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val id = idOf(handle) ?: return@mapNotNull null
            val active = account.isEnabled

            var isEsim = false
            try {
                // Subscription ID iz PhoneAccountHandle zahteva API 30+; na Androidu 10 je linija brez oznake eSIM.
                val subId = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) telephonyManager.getSubscriptionId(handle)
                    else SubscriptionManager.INVALID_SUBSCRIPTION_ID
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
