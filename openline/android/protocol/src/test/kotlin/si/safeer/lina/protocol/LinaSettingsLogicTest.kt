package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Krog 17: preizkus za N2 (pregled 15) - shranjevanje nastavitev ne sme izbrisati izbrane linije. */
class LinaSettingsLogicTest {
    /** Shramba v pomnilniku z enako semantiko kot SharedPreferences.commit (null odstrani). */
    private class MemKv : SettingsKv {
        val map = HashMap<String, Any>()
        var commits = 0
        var odpove = false
        override fun getInt(key: String) = map[key] as? Int
        override fun getString(key: String) = map[key] as? String
        override fun getBoolean(key: String) = map[key] as? Boolean
        override fun commit(changes: Map<String, Any?>): Boolean {
            commits++
            if (odpove) return false
            for ((k, v) in changes) if (v == null) map.remove(k) else map[k] = v
            return true
        }
    }

    private fun fixedRandom(b: ByteArray) { for (i in b.indices) b[i] = (i + 1).toByte() }

    @Test
    fun `N2 save ne izbrise izbrane linije`() {
        val kv = MemKv()
        val s = LinaSettingsLogic(kv)
        s.saveSelectedLine("linija-a")
        s.save(30, "+99955501001\n +99955501002 \n", allowlistEnabled = false)
        val loaded = s.load()
        assertEquals("linija-a", loaded.selectedLineId)
        assertEquals(30, loaded.ringTimeoutSec)
        assertEquals(listOf("+99955501001", "+99955501002"), loaded.allowlist)
        assertFalse(loaded.allowlistEnabled)
        // Tudi privzeti argument (kot klic iz DialerActivity s tremi argumenti) linije ne brise.
        s.save(25, "")
        assertEquals("linija-a", s.load().selectedLineId)
        assertTrue(kv.map.containsKey(LinaSettingsLogic.KEY_SELECTED_LINE_ID))
    }

    @Test
    fun `saveSelectedLine null izbrise samo izbiro`() {
        val s = LinaSettingsLogic(MemKv())
        s.save(40, "+99955501001", true)
        s.saveSelectedLine("linija-b")
        s.saveSelectedLine(null)
        val loaded = s.load()
        assertNull(loaded.selectedLineId)
        assertEquals(40, loaded.ringTimeoutSec)
        assertEquals(listOf("+99955501001"), loaded.allowlist)
    }

    @Test
    fun `privzete vrednosti in meje casa zvonjenja`() {
        val kv = MemKv()
        val s = LinaSettingsLogic(kv)
        val empty = s.load()
        assertEquals(LinaSettingsLogic.DEFAULT_RING_SEC, empty.ringTimeoutSec)
        assertEquals(25, empty.ringTimeoutSec, "lastnik 18. 11. 2026: Lina se oglasi po 25 s")
        assertTrue(empty.allowlistEnabled, "seznam je privzeto vklopljen (prazen = noben klic)")
        assertTrue(empty.allowlist.isEmpty())
        s.save(1, "")
        assertEquals(LinaSettingsLogic.MIN_RING_SEC, s.load().ringTimeoutSec)
        kv.map[LinaSettingsLogic.KEY_RING] = 10_000
        assertEquals(LinaSettingsLogic.MAX_RING_SEC, s.load().ringTimeoutSec)
    }

    @Test
    fun `kljuc linije ostane enak in izbira ostane veljavna`() {
        val kv = MemKv()
        val s = LinaSettingsLogic(kv, ::fixedRandom)
        val k1 = s.lineIdKey()!!
        s.saveSelectedLine("linija-a")
        val k2 = s.lineIdKey()!!
        assertContentEquals(k1, k2)
        assertEquals(LineIdCodec.KEY_BYTES, k1.size)
        assertEquals("linija-a", s.load().selectedLineId)
    }

    @Test
    fun `nov kljuc linije izbrise staro izbiro v istem zapisu`() {
        val kv = MemKv()
        kv.map[LinaSettingsLogic.KEY_SELECTED_LINE_ID] = "stara"
        kv.map[LinaSettingsLogic.KEY_LINE_ID_KEY] = "kratek"   // neveljaven base64 / prekratek kljuc
        val s = LinaSettingsLogic(kv, ::fixedRandom)
        val before = kv.commits
        val k = s.lineIdKey()!!
        assertEquals(LineIdCodec.KEY_BYTES, k.size)
        assertNull(s.load().selectedLineId)
        assertEquals(before + 1, kv.commits, "kljuc in izbris izbire v enem zapisu")
        // Shranjen kljuc je standardni base64 (enako kot android.util.Base64.NO_WRAP).
        assertContentEquals(k, java.util.Base64.getDecoder().decode(kv.map[LinaSettingsLogic.KEY_LINE_ID_KEY] as String))
    }

    @Test
    fun `CR1 neshranjen kljuc linije se ne vrne`() {
        val kv = MemKv()
        kv.map[LinaSettingsLogic.KEY_SELECTED_LINE_ID] = "stara"
        kv.odpove = true
        val s = LinaSettingsLogic(kv, ::fixedRandom)
        assertNull(s.lineIdKey(), "kljuc, ki ga ni na disku, bi ob naslednjem zagonu dal druge id-je")
        assertFalse(kv.map.containsKey(LinaSettingsLogic.KEY_LINE_ID_KEY))
        kv.odpove = false
        assertEquals(LineIdCodec.KEY_BYTES, s.lineIdKey()!!.size)
    }
}
