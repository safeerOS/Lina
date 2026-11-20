package si.safeer.lina.telecom

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import si.safeer.lina.protocol.Line
import si.safeer.lina.protocol.LineIdCodec
import si.safeer.lina.protocol.LineAccounts
import si.safeer.lina.protocol.PhoneAccountFacts
import android.telecom.PhoneAccount

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
    fun getLines(): List<Line> =
        // Na Androidu 13+ branje racunov zahteva tudi READ_PHONE_NUMBERS: brez njega prazen seznam, ne sesutje (Lina potem ne prevzema).
        try { preberiLinije() } catch (e: SecurityException) { emptyList() }

    private fun preberiLinije(): List<Line> {
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

        val activeSubs = try {
            subscriptionManager.activeSubscriptionInfoList.orEmpty()
        } catch (e: SecurityException) {
            emptyList()
        }
        val facts = handles.mapNotNull { handle ->
            val account = telecomManager.getPhoneAccount(handle) ?: return@mapNotNull null
            val id = idOf(handle) ?: return@mapNotNull null
            // subscriptionId racuna zna Telephony sele od Androida 11; na Androidu 10 velja samo, da obstaja aktivna narocnina.
            val subId: Int? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try { telephonyManager.getSubscriptionId(handle) } catch (e: SecurityException) { SubscriptionManager.INVALID_SUBSCRIPTION_ID }
                    catch (e: UnsupportedOperationException) { SubscriptionManager.INVALID_SUBSCRIPTION_ID }
            } else null
            val sub = if (subId != null) activeSubs.firstOrNull { it.subscriptionId == subId } else null
            PhoneAccountFacts(
                id = id,
                label = account.label?.toString().orEmpty(),
                simSubscription = account.hasCapabilities(PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION),
                emergencyCallsOnly = account.hasCapabilities(CAPABILITY_EMERGENCY_CALLS_ONLY),
                subscriptionId = subId,
                // Android 10 (pregled 17, B1): racuna ne moremo zanesljivo povezati z narocnino - velja samo natanko ena aktivna.
                activeSubscription = if (subId != null) sub != null else activeSubs.size == 1,
                isEsim = sub?.isEmbedded ?: false,
                enabled = account.isEnabled,
            )
        }
        return LineAccounts.lines(facts)
    }

    private companion object {
        /**
         * PhoneAccount.CAPABILITY_EMERGENCY_CALLS_ONLY je @SystemApi (ni v javnem SDK); vrednost 0x80 iz izvorne kode SDK
         * android-37.0 (android/telecom/PhoneAccount.java:370). Glavna varovala sta javna: subscriptionId < 0 in brez aktivne narocnine.
         */
        const val CAPABILITY_EMERGENCY_CALLS_ONLY = 0x80
    }
}
