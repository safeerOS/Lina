package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Seznanitev telefona in stanje seje (lina-asistent2 AGENTS.md @7a065fb). Skupni vektor: nize in podpis je naredila TS koda
 * kanal-claude.ts @7a065fb (nizSeznanitve, nizStanja) z novim kljucem P-256 (Node crypto, DER); Kotlin mora zgraditi iste
 * bajte, sicer podpis ne velja.
 */
class SeznanitevTest {
    private val kljuc = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAENyoh/+d/SY9F0wJP/HEiv6O8GMcrM1/HmdpnsljNsPXDA2lTHdogl4lJnQ8aoSDvcX74p7exi85XDEVT/5nBEA=="
    private val id = "n-e255066f6635ba17"
    private val cas = 1763120000000L
    private val koda = "koda-vektor-0123456789AB"
    private val ime = "Lina – telefon ✓"

    @Test
    fun `vektor TS - niz seznanitve in podpis`() {
        assertEquals(id, KrogKljuc.idIzKljuca(kljuc))
        val niz = assertNotNull(NiziLine.nizSeznanitve(koda, id, kljuc, ime, cas, "enkratni-vektor-0005"))
        assertEquals("safeer-lina-seznani-v1\n$koda\n$id\n$kljuc\n$cas\nenkratni-vektor-0005\n$ime", niz)
        assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, niz.toByteArray(Charsets.UTF_8),
            "MEUCIDYfPh5QRrknn5J8NnGWZ79zYeEhJt6SRgsxuxJAFe0zAiEA4IguVBMEyJeH1YCnmLUxo79Phgk5D6mPYQtmDlEJugQ="))
    }

    @Test
    fun `vektor TS - niz stanja in podpis`() {
        val niz = assertNotNull(NiziLine.nizStanja(id, cas, "enkratni-vektor-0006"))
        assertEquals("safeer-lina-stanje-v1\n$id\n$cas\nenkratni-vektor-0006", niz)
        assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, niz.toByteArray(Charsets.UTF_8),
            "MEYCIQDx3035gymKcb8FyDwvZk8ryrKRUpSDd2sj+dJVHc/YegIhAModLF5H4UUF5Ld/9ry9YlKonq+z5utdeLQGxF2Vu1jM"))
    }

    @Test
    fun `seznanitev z napacnimi polji se ne sestavi`() {
        val e = "enkratni-vektor-0005"
        assertNull(NiziLine.nizSeznanitve("kratka", id, kljuc, ime, cas, e))
        assertNull(NiziLine.nizSeznanitve(koda, "n-0000000000000000", kljuc, ime, cas, e), "id ni iz tega kljuca")
        assertNull(NiziLine.nizSeznanitve(koda, id, "$kljuc\n", ime, cas, e))
        assertNull(NiziLine.nizSeznanitve(koda, id, kljuc, "", cas, e))
        assertNull(NiziLine.nizSeznanitve(koda, id, kljuc, "a".repeat(61), cas, e))
        assertNull(NiziLine.nizSeznanitve(koda, id, kljuc, "Lina\nsafeer-krog-clan-v1", cas, e), "nadzorni znak")
        assertNull(NiziLine.nizSeznanitve(koda, id, kljuc, "Lina‮", cas, e), "oblikovni znak")
        assertNull(NiziLine.nizSeznanitve(koda, id, kljuc, ime, 0, e))
        assertNull(NiziLine.nizSeznanitve(koda, id, kljuc, ime, cas, "kratek"))
        assertNull(NiziLine.nizStanja("telefon", cas, e))
    }

    @Test
    fun `podpisnik podpise seznanitev in stanje s predpono namena`() {
        val podpisano = mutableListOf<String>()
        val p = Podpisnik({ b -> podpisano += String(b, Charsets.UTF_8); "podpis" }, { id }, { kljuc })
        val s = assertNotNull(p.podpisiSeznanitev(koda, ime, cas, "enkratni-vektor-0005"))
        assertEquals(id, s.id); assertEquals(kljuc, s.kljuc); assertEquals("podpis", s.podpis)
        assertNotNull(p.podpisiStanje(cas, "enkratni-vektor-0006"))
        assertNull(p.podpisiSeznanitev("kratka", ime, cas, "enkratni-vektor-0005"))
        assertEquals(2, podpisano.size)
        assertTrue(podpisano[0].startsWith("safeer-lina-seznani-v1\n") && podpisano[1].startsWith("safeer-lina-stanje-v1\n"))
    }

    @Test
    fun `odgovori seznanitve in stanja seje`() {
        assertEquals(StanjeSeznanitve.CAKA, AsistentProtokol.razberiSeznanitev("""{"stanje":"caka"}"""))
        assertEquals(StanjeSeznanitve.SPREJETO, AsistentProtokol.razberiSeznanitev("""{"stanje":"sprejeto"}"""))
        assertEquals(StanjeSeznanitve.ZAVRNJENO, AsistentProtokol.razberiSeznanitev("""{"stanje":"zavrnjeno"}"""))
        assertNull(AsistentProtokol.razberiSeznanitev("""{"stanje":"da"}"""))
        assertNull(AsistentProtokol.razberiSeznanitev("""{"stanje":true}"""))
        assertEquals(true, AsistentProtokol.razberiSejo("""{"claudeCode":"odprta"}"""))
        assertEquals(false, AsistentProtokol.razberiSejo("""{"claudeCode":"zaprta"}"""))
        assertEquals(false, AsistentProtokol.razberiSejo("""{"napaka":"claude-code-ni","stanje":{"claudeCode":"zaprta"}}"""))
        assertNull(AsistentProtokol.razberiSejo("""{"claudeCode":"morda"}"""))
        val t = AsistentProtokol.teloSeznanitve(koda, id, kljuc, ime, cas, "enkratni-vektor-0005", "p")
        assertEquals("""{"koda":"$koda","id":"$id","kljuc":"$kljuc","ime":"$ime","cas":$cas,"enkratni":"enkratni-vektor-0005","podpis":"p"}""", t)
    }

    @Test
    fun `med cakanjem na potrditev ni gumbov za seznanitev ali nalogo`() {
        val p = AsistentPrikaz.izracunaj(StanjeAsistenta(seznanjen = false, nalogaTece = false, odprtaOdobritev = null, cakaPotrditev = true))
        assertFalse(p.seznani || p.vnos || p.poslji || p.ustavi || p.odobritev || p.pozabi)
        assertTrue(AsistentPrikaz.izracunaj(StanjeAsistenta(false, false, null)).seznani)
    }
}
