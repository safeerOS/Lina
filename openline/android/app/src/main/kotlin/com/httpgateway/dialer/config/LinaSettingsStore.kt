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
    )

    private val prefs = context.applicationContext.getSharedPreferences("lina_policy", Context.MODE_PRIVATE)

    fun load(): Settings {
        val seconds = prefs.getInt(KEY_RING, DEFAULT_RING_SEC).coerceIn(MIN_RING_SEC, MAX_RING_SEC)
        val raw = prefs.getString(KEY_LIST, "").orEmpty()
        val list = raw.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val enabled = if (prefs.contains(KEY_ENABLED)) prefs.getBoolean(KEY_ENABLED, true) else true
        return Settings(seconds, list, enabled)
    }

    fun save(ringTimeoutSec: Int, allowlistText: String, allowlistEnabled: Boolean = true) {
        val seconds = ringTimeoutSec.coerceIn(MIN_RING_SEC, MAX_RING_SEC)
        val cleaned = allowlistText.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        prefs.edit()
            .putInt(KEY_RING, seconds)
            .putString(KEY_LIST, cleaned.joinToString("\n"))
            .putBoolean(KEY_ENABLED, allowlistEnabled)
            .commit()
    }

    companion object {
        const val DEFAULT_RING_SEC = 20
        const val MIN_RING_SEC = 5
        const val MAX_RING_SEC = 120
        private const val KEY_RING = "ring_timeout_sec"
        private const val KEY_LIST = "allowlist"
        private const val KEY_ENABLED = "allowlist_enabled"
    }
}
