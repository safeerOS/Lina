package si.safeer.lina.telecom

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Prevzem Linine tajnice s tipko na slušalkah (lastnik 22. 11. 2026: »Prevzem prek slušalk lahko najdeš«).
 *
 * Samo za tipke slušalk (kavelj, predvajaj/pavza). Dostopnostna storitev prejme tipke PRED aplikacijami in sistemom
 * (FLAG_REQUEST_FILTER_KEY_EVENTS), zato lahko prehiti Telecom, ki bi sicer klic končal. Storitev NE bere vsebine zaslona
 * (brez canRetrieveWindowContent, brez dogodkov dostopnosti) in v dnevnik zapiše samo kodo tipke.
 *
 * Delovanje: če je klic, ki ga je prevzela Lina, še avtomatski, tipka klic prevzame (Lina utihne, mikrofon se vklopi) in se
 * porabi; sicer se tipka ne dotakne (sistem jo obdela kot običajno). Stikalo: SharedPreferences [PREFS]/[KLJUC], privzeto vklopljeno.
 *
 * NEPREVERJENO na napravi: ali storitev tipke Bluetooth/žičnih slušalk sploh vidi in ali je pred Telecomom (preizkus:
 * `adb shell input keyevent 79` med Lininim klicem in `adb logcat -s TipkaSlusalk`). Storitev mora uporabnik sam vklopiti
 * v nastavitvah dostopnosti.
 */
class TipkaSlusalkStoritev : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    /** Pritiski, ki jih je storitev zaceli porabiti (DOWN): njihov UP in ponovitve porabimo tudi, ce se lastnistvo klica vmes spremeni (celoten pritisk ali nic). */
    private val porabljeni = HashMap<Pair<Int, Int>, String>() // tipka -> klic, ki ga je DOWN izbral

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode !in TIPKE) return false
        val kljuc = event.keyCode to event.deviceId
        Log.i(TAG, "tipka koda=${event.keyCode} dejanje=${event.action} ponovitev=${event.repeatCount} naprava=${event.deviceId}")
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount > 0) return kljuc in porabljeni
        if (event.action == KeyEvent.ACTION_UP && kljuc in porabljeni) {
            val izbran = porabljeni.remove(kljuc)
            // Deluje SAMO na klic, ki ga je izbral DOWN, in samo ce je se Linin; sicer UP samo porabimo (drug klic ne sme biti vzet z istim pritiskom).
            val l = CallRegistry.snapshot().firstOrNull { it.callId == izbran && LinaCallGate.isOwned(it.callId) && !LinaCallGate.isManual(it.callId) }
            if (l != null) {
                Log.i(TAG, "prevzem klica ${l.callId}: tipka slusalk")
                PrevzemKlica.ustavi(l.callId)
                runCatching { CallBackgroundAudio.exit(l.call) }
            }
            return true
        }
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            if (!getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KLJUC, true)) return false
            val l = linin() ?: return false
            // Porabi DOWN in UP, da Telecom ob istem pritisku klica ne konča.
            porabljeni[kljuc] = l.callId
            return true
        }
        return false
    }

    private fun linin() = CallRegistry.snapshot().firstOrNull { LinaCallGate.isOwned(it.callId) && !LinaCallGate.isManual(it.callId) }

    companion object {
        const val TAG = "TipkaSlusalk"
        const val PREFS = "lina_prevzem"
        const val KLJUC = "tipka_slusalk"
        val TIPKE = setOf(
            KeyEvent.KEYCODE_HEADSETHOOK,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE,
        )
    }
}
