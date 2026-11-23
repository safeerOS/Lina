package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Skupni vektorji TS <-> Kotlin. Pricakovane vrednosti so izracunane 14. 11. 2026 s kodo lina-asistent2 kanal-claude.ts @f871fc2;
 * kljuc in podpis sta iz kanal-claude.test.ts (narejena z core/link_kripto.py, zasebni kljuc zavrzen).
 */
class NiziLineTest {
    private val kljuc = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESRaSzANyZX89Q5duUY1kYuh4Vrlh7ZmN/dWCWm4Fra3bOTpATKEgcrh8X/YLWMaPSQRAAJCnk7tcoyZzYKgKwA=="
    private val podpisNaloge = "MEYCIQDgj5XLP7ebbO/m1DcGtOWT1sekXK9MYuxzextK6E8IRAIhAPDwr4MLBVRFssJVayIgutJuoLT2GkT4cQ8iX53q/9sH"
    private val id = "n-5ef0fcb562008e97"
    private val cas = 1763120000000L
    private val zgostitev = "1ff96f9b02dde42794cc31a2f482cd354dceb99f074788ed51db8b1575772981"

    @Test
    fun `niz nadaljevanja enak TS nizNadaljevanja, lastna predpona, podpis ni prenosljiv z naloge`() {
        val besedilo = "Načrt je v docs/nacrt.md.\nKorak 2 😀"
        val niz = NiziLine.nizNadaljevanja("naloga-vektor-01", id, besedilo, cas, "enkratni-vektor-0010")!!
        // izracunano s TS: nizNadaljevanja("naloga-vektor-01", "n-5ef0fcb562008e97", besedilo, 1763120000000, "enkratni-vektor-0010")
        assertEquals("safeer-lina-nadaljuj-v1\nnaloga-vektor-01\nn-5ef0fcb562008e97\n1763120000000\nenkratni-vektor-0010\nNačrt je v docs/nacrt.md.\nKorak 2 😀", niz)
        assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, niz.toByteArray(Charsets.UTF_8), podpisNaloge), "podpis naloge ne velja za nadaljevanje")
        assertEquals(null, NiziLine.nizNadaljevanja("naloga\nvektor", id, "x", cas, "enkratni-vektor-0010"))
        assertEquals(null, NiziLine.nizNadaljevanja("naloga-vektor-01", "$id\nx", "x", cas, "enkratni-vektor-0010"))
        val par = java.security.KeyPairGenerator.getInstance("EC").apply { initialize(java.security.spec.ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val p = NalogaLine.podpisiNadaljevanje("a".repeat(22), id, "  odgovor  ", cas, "enkratni-vektor-0011") { b ->
            java.util.Base64.getEncoder().encodeToString(java.security.Signature.getInstance("SHA256withECDSA").apply { initSign(par.private); update(b) }.sign())
        }!!
        assertEquals("odgovor", p.besedilo)
        assertEquals(null, NalogaLine.podpisiNadaljevanje("kratek", id, "x", cas, "enkratni-vektor-0011") { "" })
        assertEquals(null, NalogaLine.podpisiNadaljevanje("a".repeat(22), id, "x".repeat(4001), cas, "enkratni-vektor-0011") { "" })
    }

    @Test
    fun `id iz kljuca kot Python in TS`() {
        assertEquals(id, KrogKljuc.idIzKljuca(kljuc))
        assertTrue(KrogKljuc.jeIdIzKljuca(id))
        assertTrue(KrogKljuc.jeIdIzKljuca("$id-lina"))
        assertFalse(KrogKljuc.jeIdIzKljuca("$id lina"))
    }

    @Test
    fun `podpis Python velja za niz naloge iz Kotlina`() {
        val niz = NiziLine.nizNaloge("naloga-vektor-01", id, "izpisi git status", cas, "enkratni-vektor-0001")!!
        assertEquals("safeer-lina-naloga-v1\nnaloga-vektor-01\n$id\n$cas\nenkratni-vektor-0001\nizpisi git status", niz)
        assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, niz.toByteArray(Charsets.UTF_8), podpisNaloge))
        assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, niz.replace("git status", "rm -rf .").toByteArray(Charsets.UTF_8), podpisNaloge))
    }

    @Test
    fun `zgostitev prikaza in odobritev v3 enako kot TS`() {
        assertEquals(zgostitev, NiziLine.zgostitevPrikaza("Bash", "git status\nčšž ✓", "Izpis stanja"))
        assertEquals(
            "safeer-lina-odobritev-v3\nabcde\nallow\n$id\n$cas\nenkratni-vektor-0002\nnaloga-vektor-01\n$zgostitev",
            NiziLine.nizOdobritve("abcde", true, id, cas, "enkratni-vektor-0002", "naloga-vektor-01", zgostitev),
        )
        assertEquals(
            "safeer-lina-odobritev-v3\nabcde\ndeny\n$id\n$cas\nenkratni-vektor-0002\nnaloga-vektor-01\n$zgostitev",
            NiziLine.nizOdobritve("abcde", false, id, cas, "enkratni-vektor-0002", "naloga-vektor-01", zgostitev),
        )
        assertEquals(
            "safeer-lina-ustavi-v1\nnaloga-vektor-01\n$id\n$cas\nenkratni-vektor-0003",
            NiziLine.nizUstavitve("naloga-vektor-01", id, cas, "enkratni-vektor-0003"),
        )
    }

    @Test
    fun `podpis in preverba s kljucem P-256 iz Jave (oblika DER, SPKI)`() {
        val par = java.security.KeyPairGenerator.getInstance("EC").apply {
            initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()
        val b64 = java.util.Base64.getEncoder().encodeToString(par.public.encoded)
        val niz = NiziLine.nizNaloge("naloga-n1", KrogKljuc.idIzKljuca(b64), "x", cas, "enkratni-vektor-0009")!!.toByteArray(Charsets.UTF_8)
        val s = java.security.Signature.getInstance("SHA256withECDSA").apply { initSign(par.private); update(niz) }
        val podpis = java.util.Base64.getEncoder().encodeToString(s.sign())
        assertTrue(KrogKljuc.preveriPodpisSKljucem(b64, niz, podpis))
        assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, niz, podpis), "tuj kljuc")
    }

    @Test
    fun `osamljeni nadomestni znaki se zavrnejo`() {
        assertTrue(NiziLine.praviUnicode("ok ✓ 😀"))
        assertFalse(NiziLine.praviUnicode("a\uD83Db"))
        assertFalse(NiziLine.praviUnicode("a\uDE00"))
        assertTrue(NiziLine.ENKRATNI.matches("enkratni-vektor-0001"))
        assertFalse(NiziLine.ENKRATNI.matches("kratek"))
    }

    @Test
    fun `sinhronizacija enako kot TS (vektor 20 11 2026)`() {
        val vsebina = "{\"rev\":0,\"klici\":[]}"
        val z = NiziLine.zgostitevSinhron(vsebina)
        assertEquals("2e2061a39b66a6602255b0df766ca95c2229a96cbdfae7423c77fdd32f2b02e4", z)
        assertEquals(
            "safeer-lina-sinhron-v1\n$id\n$cas\nenkratni-vektor-0004\n$z",
            NiziLine.nizSinhron(id, cas, "enkratni-vektor-0004", z),
        )
        assertEquals(null, NiziLine.nizSinhron("tuja\nnaprava", cas, "enkratni-vektor-0004", z))
        assertEquals(null, NiziLine.nizSinhron(id, cas, "enkratni-vektor-0004", "ni-zgostitev"))
    }
}
