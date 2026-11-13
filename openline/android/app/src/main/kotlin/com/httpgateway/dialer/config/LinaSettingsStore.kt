package com.httpgateway.dialer.config

import android.content.Context

/**
 * Cas zvonjenja in seznam dovoljenih stevilk.
 * allowlistEnabled je stikalo za preizkus. Privzeto je vklopljeno:
 * prazen seznam ne dovoli nobenega klica. Ob izklopu Lina prevzame vse dohodne,
 * tudi neznane in skrite, razen stevilk v sili.
 */
class LinaSettingsStore(context: Context) {
    data class Settings(
        val ringTimeoutSec: Int,
        val allowlist: List<String>,
        val allowlistEnabled: Boolean = true,
        val selectedLineId: String? = null,
    )

    private val prefs = context.applicationContext.getSharedPreferences("lina_policy", Context.MODE_PRIVATE)

    fun load(): Settings {
        val seconds = prefs.getInt(KEY_RING, DEFAULT_RING_SEC).coerceIn(MIN_RING_SEC, MAX_RING_SEC)
        val raw = prefs.getString(KEY_LIST, "").orEmpty()
        val list = raw.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val enabled = if (prefs.contains(KEY_ENABLED)) prefs.getBoolean(KEY_ENABLED, true) else true
        val selectedLineId = prefs.getString(KEY_SELECTED_LINE_ID, null)
        return Settings(seconds, list, enabled, selectedLineId)
    }

    // Pregled 15 (N2): izbrane linije save() ne spreminja - prej jo je vsak shranjen cas zvonjenja tiho izbrisal.
    fun save(ringTimeoutSec: Int, allowlistText: String, allowlistEnabled: Boolean = true) {
        val seconds = ringTimeoutSec.coerceIn(MIN_RING_SEC, MAX_RING_SEC)
        val cleaned = allowlistText.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        prefs.edit()
            .putInt(KEY_RING, seconds)
            .putString(KEY_LIST, cleaned.joinToString("\n"))
            .putBoolean(KEY_ENABLED, allowlistEnabled)
            .commit()
    }

    /** Izbira linije za Lino (null = izbira izbrisana). */
    fun saveSelectedLine(lineId: String?) {
        prefs.edit().putString(KEY_SELECTED_LINE_ID, lineId).commit()
    }

    /** Nakljucen kljuc te namestitve za id linije (HMAC); ustvari se ob prvi rabi, ostane samo v zasebnih nastavitvah. */
    fun lineIdKey(): ByteArray {
        prefs.getString(KEY_LINE_ID_KEY, null)?.let { s ->
            val k = try { android.util.Base64.decode(s, android.util.Base64.NO_WRAP) } catch (_: IllegalArgumentException) { null }
            if (k != null && k.size >= com.httpgateway.protocol.LineIdCodec.KEY_BYTES) return k
        }
        val k = ByteArray(com.httpgateway.protocol.LineIdCodec.KEY_BYTES).also { java.security.SecureRandom().nextBytes(it) }
        prefs.edit().putString(KEY_LINE_ID_KEY, android.util.Base64.encodeToString(k, android.util.Base64.NO_WRAP)).commit()
        // Nov kljuc = novi id-ji: stara izbira ne velja vec.
        prefs.edit().remove(KEY_SELECTED_LINE_ID).commit()
        return k
    }

    companion object {
        const val DEFAULT_RING_SEC = 20
        const val MIN_RING_SEC = 5
        const val MAX_RING_SEC = 120
        private const val KEY_RING = "ring_timeout_sec"
        private const val KEY_LIST = "allowlist"
        private const val KEY_ENABLED = "allowlist_enabled"
        private const val KEY_SELECTED_LINE_ID = "selected_line_id"
        private const val KEY_LINE_ID_KEY = "line_id_key"
    }
}
