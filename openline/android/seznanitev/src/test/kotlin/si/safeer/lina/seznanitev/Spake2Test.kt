package si.safeer.lina.seznanitev

import java.math.BigInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Kopija Spake2 iz Android-tv mora dati iste bajte kot original (RFC 9382 vektor, enak kot Android-tv tests/Spake2Test.kt)
 * in kot Linux core/spake2.py (vektor izracunan 14. 11. 2026 s Safeer-linux origin/gtk4 @aa27e90, w iz kode 482913).
 */
class Spake2Test {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test
    fun `RFC 9382 vektor`() {
        val w = BigInteger("2ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f", 16)
        val x = BigInteger("43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729", 16)
        val y = BigInteger("dcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be", 16)
        val a = Spake2.zaTest(w, "server", "client", true, x)
        val b = Spake2.zaTest(w, "client", "server", false, y)
        val pa = a.sporocilo(); val pb = b.sporocilo()
        assertEquals("04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c", hex(pa))
        assertEquals("0406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676d09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b7", hex(pb))
        val ca = a.zakljuci(pb); val cb = b.zakljuci(pa)
        assertEquals("0e0672dc86f8e45565d338b0540abe69", hex(a.ke!!))
        assertEquals("58ad4aa88e0b60d5061eb6b5dd93e80d9c4f00d127c65b3b35b1b5281fee38f0", hex(ca))
        assertEquals("d3e2e547f1ae04f2dbdbf0fc4b79f8ecff2dff314b5d32fe9fcef2fb26dc459b", hex(cb))
        assertTrue(a.preveri(cb) && b.preveri(ca))
    }

    @Test
    fun `isti bajti kot Linux core spake2 py`() {
        val w = Spake2.wIzKode("482913", "pair-lina-01".toByteArray())
        assertEquals("6fd75b3fd99610e56bc5bda963052279cab3f7ceaee03d594b090c7db5cb8585", w.toString(16))
        val x = BigInteger("43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729", 16)
        val y = BigInteger("dcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be", 16)
        val a = Spake2.zaTest(w, "lina-racunalnik", "n-5ef0fcb562008e97", true, x)
        val b = Spake2.zaTest(w, "n-5ef0fcb562008e97", "lina-racunalnik", false, y)
        val pa = a.sporocilo(); val pb = b.sporocilo()
        assertEquals("04319ebf26edad8b9119a7cf9c104a671e9c53e29a4909887acb96f881f2e376a97b51c390546485d6003b6c9b3aedb47a65555c8864eee3be0edd599bf13d290f", hex(pa))
        assertEquals("04bb727b7c9f9f8f3036816e02da04640e8d8cd6e4209d9c20fcedf12f55c768b02fabea4bc973ca33c24810689dff33dea1573a0c82db4b6211b91b4fb6dc52e1", hex(pb))
        val ca = a.zakljuci(pb); val cb = b.zakljuci(pa)
        assertEquals("8dd6eb999482fa9a9a3931e2128d857e", hex(a.ke!!))
        assertEquals("ba506a9bb06f7d2e7a185d10fc90f3b35524210bd30df642b5125fd429ba0dad", hex(ca))
        assertEquals("61925903113d2fc90492ee81b0e21885bbd5de821b6844b206cda2e8714672ff", hex(cb))
    }

    @Test
    fun `napacna koda ne da skupnega kljuca, neveljavna tocka se zavrne`() {
        val s = Spake2.streznik("482913", "lina-racunalnik", "telefon", sol = "pair1".toByteArray())
        val o = Spake2.odjemalec("482914", "telefon", "lina-racunalnik", sol = "pair1".toByteArray())
        val cs = s.zakljuci(o.sporocilo()); val co = o.zakljuci(s.sporocilo())
        assertFalse(s.preveri(co) || o.preveri(cs))
        val s2 = Spake2.streznik("482913", "lina-racunalnik", "telefon", sol = "pair1".toByteArray())
        assertFailsWith<IllegalArgumentException> { s2.zakljuci(ByteArray(65) { 4 }) }
    }
}
