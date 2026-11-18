package si.safeer.lina.samostojna

import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SamostojniAsistentTest {
    @Test
    fun navodiloVsebujeCasInFormatZapiskaInNeObljubljaOpomnikov() {
        val n = SistemskoNavodilo.zgradi(ZonedDateTime.parse("2026-11-18T19:30:00+01:00"))
        assertTrue(n.contains("2026-11-18T19:30:00+01:00"))
        assertTrue(n.contains("[[zapisek:"))
        // Model ne sme dobiti oblike opomnika: aplikacija ga se ne sprozi, zato bi bil opomnik laz.
        assertFalse(n.contains("[[opomnik:"))
    }

    @Test
    fun zapisekPrekoJsonaSePrebereEnak() {
        val s = dodajZapisek(emptyList(), "  mleko in kruh ", 1000L, "a1")
        assertEquals(listOf(Zapisek("a1", "mleko in kruh", 1000L, false)), zapiskiIzJsona(zapiskiVJson(s)))
    }

    @Test
    fun praznoBesediloNeDodaZapiska() {
        assertEquals(emptyList(), dodajZapisek(emptyList(), "   ", 1L, "x"))
    }

    @Test
    fun poskodovanZapisVrneNullInNePrepisePraznegaSeznama() {
        assertNull(zapiskiIzJsona("{ni seznam"))
        assertNotNull(zapiskiIzJsona("[]"))
    }

    @Test
    fun izbrisJeOznakaZNovimCasomInZapisekNiVecVidenVendarObstaja() {
        val s = dodajZapisek(emptyList(), "a", 5000L, "id1")
        val i = izbrisiZapisek(s, "id1", 5000L)
        assertTrue(vidniZapiski(i).isEmpty())
        assertEquals(1, i.size)
        assertTrue(i[0].izbrisan)
        assertTrue(i[0].cas > 5000L)
        // Ob zdruzitvi z neizbrisano kopijo izbris zmaga.
        assertTrue(zdruzi(s, i).single().izbrisan)
    }

    @Test
    fun vidniSoNovejsiNajprej() {
        var s = dodajZapisek(emptyList(), "star", 1L, "1")
        s = dodajZapisek(s, "nov", 2L, "2")
        assertEquals(listOf("nov", "star"), vidniZapiski(s).map { it.besedilo })
    }
}
