package si.safeer.lina.protocol

/**
 * Shramba kljuc-vrednost brez Androida (v aplikaciji SharedPreferences). Krog 17: logika nastavitev Line je tu,
 * da jo preizkusi navaden JUnit - pregled 15 (N2) je ugotovil, da save() brise izbrano linijo, preizkusa pa ni bilo.
 */
interface SettingsKv {
    fun getInt(key: String): Int?
    fun getString(key: String): String?
    fun getBoolean(key: String): Boolean?
    /** Vse spremembe v enem zapisu; vrednost null odstrani kljuc. */
    fun commit(changes: Map<String, Any?>): Boolean
}

data class LinaSettings(
    val ringTimeoutSec: Int,
    val allowlist: List<String>,
    val allowlistEnabled: Boolean = true,
    val selectedLineId: String? = null,
)

/**
 * Cas zvonjenja in seznam dovoljenih stevilk. allowlistEnabled je stikalo za preizkus, privzeto vklopljeno:
 * prazen seznam ne dovoli nobenega klica. Ob izklopu Lina prevzame vse dohodne, razen stevilk v sili.
 */
class LinaSettingsLogic(
    private val kv: SettingsKv,
    private val randomBytes: (ByteArray) -> Unit = { java.security.SecureRandom().nextBytes(it) },
) {
    fun load(): LinaSettings {
        val seconds = (kv.getInt(KEY_RING) ?: DEFAULT_RING_SEC).coerceIn(MIN_RING_SEC, MAX_RING_SEC)
        val list = kv.getString(KEY_LIST).orEmpty().split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        val enabled = kv.getBoolean(KEY_ENABLED) ?: true
        return LinaSettings(seconds, list, enabled, kv.getString(KEY_SELECTED_LINE_ID))
    }

    // Pregled 15 (N2): izbrane linije save() ne spreminja - prej jo je vsak shranjen cas zvonjenja tiho izbrisal.
    fun save(ringTimeoutSec: Int, allowlistText: String, allowlistEnabled: Boolean = true): Boolean {
        val seconds = ringTimeoutSec.coerceIn(MIN_RING_SEC, MAX_RING_SEC)
        val cleaned = allowlistText.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        return kv.commit(
            mapOf(KEY_RING to seconds, KEY_LIST to cleaned.joinToString("\n"), KEY_ENABLED to allowlistEnabled),
        )
    }

    /** Izbira linije za Lino (null = izbira izbrisana). */
    fun saveSelectedLine(lineId: String?): Boolean = kv.commit(mapOf(KEY_SELECTED_LINE_ID to lineId))

    /** Nakljucen kljuc te namestitve za id linije (HMAC); ustvari se ob prvi rabi, ostane samo v zasebnih nastavitvah. */
    fun lineIdKey(): ByteArray {
        kv.getString(KEY_LINE_ID_KEY)?.let { s ->
            val k = try { java.util.Base64.getDecoder().decode(s) } catch (_: IllegalArgumentException) { null }
            if (k != null && k.size >= LineIdCodec.KEY_BYTES) return k
        }
        val k = ByteArray(LineIdCodec.KEY_BYTES).also(randomBytes)
        // Nov kljuc = novi id-ji: stara izbira ne velja vec. En zapis, da kljuc in izbira ne prideta narazen.
        kv.commit(mapOf(KEY_LINE_ID_KEY to java.util.Base64.getEncoder().encodeToString(k), KEY_SELECTED_LINE_ID to null))
        return k
    }

    companion object {
        const val DEFAULT_RING_SEC = 20
        const val MIN_RING_SEC = 5
        const val MAX_RING_SEC = 120
        const val KEY_RING = "ring_timeout_sec"
        const val KEY_LIST = "allowlist"
        const val KEY_ENABLED = "allowlist_enabled"
        const val KEY_SELECTED_LINE_ID = "selected_line_id"
        const val KEY_LINE_ID_KEY = "line_id_key"
    }
}
