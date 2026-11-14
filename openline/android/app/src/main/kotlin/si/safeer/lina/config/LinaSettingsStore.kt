package si.safeer.lina.config

import android.content.Context
import android.content.SharedPreferences
import si.safeer.lina.protocol.LinaSettings
import si.safeer.lina.protocol.LinaSettingsLogic
import si.safeer.lina.protocol.SettingsKv

/**
 * Nastavitve Line v zasebnih SharedPreferences. Vsa logika (N2: save() ne brise izbrane linije) je v
 * LinaSettingsLogic modula protocol in ima preizkus; tu je samo tanek prevod na SharedPreferences.
 */
class LinaSettingsStore(context: Context) {
    private val logic = LinaSettingsLogic(
        PrefsKv(context.applicationContext.getSharedPreferences("lina_policy", Context.MODE_PRIVATE)),
    )

    fun load(): LinaSettings = logic.load()

    fun save(ringTimeoutSec: Int, allowlistText: String, allowlistEnabled: Boolean = true) {
        logic.save(ringTimeoutSec, allowlistText, allowlistEnabled)
    }

    fun saveSelectedLine(lineId: String?) {
        logic.saveSelectedLine(lineId)
    }

    fun lineIdKey(): ByteArray? = logic.lineIdKey()

    private class PrefsKv(private val prefs: SharedPreferences) : SettingsKv {
        override fun getInt(key: String): Int? = if (prefs.contains(key)) prefs.getInt(key, 0) else null
        override fun getString(key: String): String? = prefs.getString(key, null)
        override fun getBoolean(key: String): Boolean? = if (prefs.contains(key)) prefs.getBoolean(key, true) else null

        override fun commit(changes: Map<String, Any?>): Boolean {
            val e = prefs.edit()
            for ((key, value) in changes) {
                when (value) {
                    null -> e.remove(key)
                    is Int -> e.putInt(key, value)
                    is Boolean -> e.putBoolean(key, value)
                    is String -> e.putString(key, value)
                    else -> throw IllegalArgumentException("nepodprta vrsta za $key")
                }
            }
            return e.commit()
        }
    }

    companion object {
        const val DEFAULT_RING_SEC = LinaSettingsLogic.DEFAULT_RING_SEC
        const val MIN_RING_SEC = LinaSettingsLogic.MIN_RING_SEC
        const val MAX_RING_SEC = LinaSettingsLogic.MAX_RING_SEC
    }
}
