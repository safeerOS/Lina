package si.safeer.lina.seznanitev

import java.math.BigInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Skupni bajtni vektor celotnega toka s kodo: izracunal ga je TS (lina-asistent2 @fdd787b, spake2.ts + koda-seznanitev.ts,
 * Node 22) z znanima skalarjema x (Lina) in y (telefon), soljo pair_id in AAD = odtis. Kotlin mora dati iste pA, pB, cA, cB, Ke, MAC.
 */
class KodaLineTest {
    private val pairId = "pairVektorK18-0123456_"
    private val id = "n-e255066f6635ba17"
    private val odtis = "3f".repeat(32)
    private val kljuc = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENyoh/+d/SY9F0wJP/HEiv6O8GMcrM1/HmdpnsljNsPXDA2lTHdogl4lJnQ8aoSDvcX74p7exi85XDEVT/5nBEA=="
    private val x = BigInteger("1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", 16)
    private val y = BigInteger("0fedcba9876543210fedcba9876543210fedcba9876543210fedcba987654321", 16)
    private val pa = "044e3aad2c610d96692149db2c6f1e6f6e7bbc4cba8ccb7b35fc7f6cf427b1335064861434c6534b6276002a0c1c5b4d34abd8130fee13598e8ca5cb191e64d5d4"
    private val pb = "04e8d4d795eb7d692d1649e0e8f92ec01bb258f43373482d5cb7fc25927a874e53c96af200d5daae7559e976b8262859ab54b3b6cd8cb9071f9155b93b5a59419a"
    private val ca = "d50d4c1357535b0ff560daa519995ffc010c3cfbd63b0b8041150c49e5f5b513"
    private val cb = "6670b3cabb17cc3133a82cac8e03df99f51d4e5ed0121a792cd284a2953e3aac"
    private val mac = "db89a07091eaad5aa1874e33f8eb3f127cf83fec050d6bc2ff5457cb31f1719f"

    @Test
    fun `vektor TS - celoten tok pB, cA, cB, Ke in MAC kljuca`() {
        assertEquals("3cb77d4c2093d667abe06e939d6fae1a31093169b7bd14d7f398e4b627c3c7c3", Spake2.wIzKode("482913", pairId.toByteArray()).toString(16))
        val lina = Spake2.zaTest(Spake2.wIzKode("482913", pairId.toByteArray()), KodaLine.ID_LINE, id, true, x, odtis.toByteArray())
        assertEquals(pa, Spake2.hex(lina.sporocilo()))
        val t = KodaOdjemalec.zaTest("482913", id, pairId, odtis, y)
        assertEquals(pb, t.pb)
        assertNull(t.mac(kljuc), "MAC sele po veljavni cA")
        assertEquals(cb, t.potrdi(pa, ca))
        assertEquals(mac, t.mac(kljuc))
        assertEquals(ca, Spake2.hex(lina.zakljuci(Spake2.hex(pb))))
        assertEquals("088823e411cbedef0cd0e9485e7cd848", Spake2.hex(lina.ke!!))
        assertTrue(lina.preveri(Spake2.hex(cb)))
    }

    @Test
    fun `cA drugega potrdila TLS, druge kode ali pokvarjena ne velja`() {
        assertNull(KodaOdjemalec.zaTest("482913", id, pairId, "40".repeat(32), y).potrdi(pa, ca), "drug odtis (posrednik)")
        assertNull(KodaOdjemalec.zaTest("482914", id, pairId, odtis, y).potrdi(pa, ca), "druga koda")
        assertNull(KodaOdjemalec.zaTest("482913", id, "pairVektorK18-0123456X", odtis, y).potrdi(pa, ca), "drug pair_id")
        assertNull(KodaOdjemalec.zaTest("482913", id, pairId, odtis, y).potrdi(pa, ca.replaceRange(0, 2, "00")))
        assertNull(KodaOdjemalec.zaTest("482913", id, pairId, odtis, y).potrdi("04" + "00".repeat(64), ca), "tocka izven krivulje")
        val t = KodaOdjemalec.zaTest("482913", id, pairId, odtis, y)
        assertNotNull(t.potrdi(pa, ca)); assertNull(t.potrdi(pa, ca), "en krog na objekt")
    }

    @Test
    fun `nakljucni odjemalec s pravim strezniskim krogom se ujema, z napacno kodo ne`() {
        val tel = assertNotNull(KodaOdjemalec.zacni("482 913", id, pairId, odtis))
        val lina = Spake2.streznik("482913", KodaLine.ID_LINE, id, odtis.toByteArray(), pairId.toByteArray())
        val c = lina.zakljuci(Spake2.hex(tel.pb))
        val cbT = assertNotNull(tel.potrdi(Spake2.hex(lina.sporocilo()), Spake2.hex(c)))
        assertTrue(lina.preveri(Spake2.hex(cbT)))
        val zla = Spake2.streznik("111111", KodaLine.ID_LINE, id, odtis.toByteArray(), pairId.toByteArray())
        val tel2 = assertNotNull(KodaOdjemalec.zacni("482913", id, pairId, odtis))
        val c2 = zla.zakljuci(Spake2.hex(tel2.pb))
        assertNull(tel2.potrdi(Spake2.hex(zla.sporocilo()), Spake2.hex(c2)))
        assertNull(KodaOdjemalec.zacni("48291", id, pairId, odtis)); assertNull(KodaOdjemalec.zacni("482913", id, "kratek", odtis))
        assertNull(KodaOdjemalec.zacni("482913", id, pairId, "AB".repeat(32)))
    }

    @Test
    fun `zacetek velja samo z istim odtisom, kot ga telefon vidi`() {
        assertTrue(KodaLine.veljavenZacetek(pairId, "spake2", "lina-asistent", odtis, odtis))
        assertFalse(KodaLine.veljavenZacetek(pairId, "spake2", "lina-asistent", "40".repeat(32), odtis))
        assertFalse(KodaLine.veljavenZacetek(pairId, "spake2", "drug-hub", odtis, odtis))
        assertFalse(KodaLine.veljavenZacetek(pairId, "qr", "lina-asistent", odtis, odtis))
        assertFalse(KodaLine.veljavenZacetek("kratek", "spake2", "lina-asistent", odtis, odtis))
    }

    @Test
    fun `koda, prikaz in nova koda nacina B`() {
        assertEquals("482913", KodaLine.koda(" 482 913 "))
        assertNull(KodaLine.koda("48291a")); assertNull(KodaLine.koda("4829134"))
        assertEquals("482 913", KodaLine.prikaz("482913"))
        repeat(200) { val k = KodaLine.novaKoda(); assertEquals(6, k.length); assertTrue(k.toInt() in 100000..999999) }
        assertEquals(mac, Spake2.hex(KodaLine.macKljuca(Spake2.hex("088823e411cbedef0cd0e9485e7cd848"), pairId, id, kljuc)))
    }

    @Test
    fun `oglas DNS-SD in rocni naslov samo v domacem omrezju`() {
        assertEquals("192.168.1.20" to 8446, KodaLine.sprejmiOglas("192.168.1.20", 8446, "1"))
        assertNull(KodaLine.sprejmiOglas("192.168.1.20", 8446, "2"))
        assertNull(KodaLine.sprejmiOglas("192.168.1.20", 8446, null))
        assertNull(KodaLine.sprejmiOglas("203.0.113.5", 8446, "1"), "javni naslov")
        assertNull(KodaLine.sprejmiOglas(null, 8446, "1")); assertNull(KodaLine.sprejmiOglas("10.0.0.2", 0, "1"))
        assertEquals("192.168.1.20" to 8446, KodaLine.rocniNaslov(" 192.168.1.20 "))
        assertEquals("10.0.0.2" to 9000, KodaLine.rocniNaslov("10.0.0.2:9000"))
        assertEquals("fd00::5" to 8446, KodaLine.rocniNaslov("fd00::5"))
        assertEquals("fd00::5" to 9001, KodaLine.rocniNaslov("[fd00::5]:9001"))
        for (z in listOf("8.8.8.8", "lina.local", "10.0.0.2:0", "10.0.0.2:70000", "[fd00::5]x", "https://10.0.0.2", "10.0.0.2:80a", ""))
            assertNull(KodaLine.rocniNaslov(z), z)
    }
}
