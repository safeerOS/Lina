package si.safeer.lina.samostojna

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue

class OpomnikCasTest {
    private val zdaj = java.time.ZonedDateTime.parse("2026-11-22T14:00:00+01:00").toInstant().toEpochMilli()

    @Test
    fun `veljaven prihodnji cas se pretvori v ms`() {
        val ms = OpomnikCas.izracunaj("2026-11-22T15:30:00+01:00", zdaj)
        assertEquals(zdaj + 90 * 60_000L, ms)
    }

    @Test
    fun `isti trenutek v drugem pasu je enak`() {
        assertEquals(OpomnikCas.izracunaj("2026-11-22T15:30:00+01:00", zdaj), OpomnikCas.izracunaj("2026-11-22T14:30:00Z", zdaj))
    }

    @Test
    fun `pretekel neveljaven ali predaleč cas je null`() {
        assertNull(OpomnikCas.izracunaj("2026-11-22T13:00:00+01:00", zdaj), "mimo")
        assertNull(OpomnikCas.izracunaj("jutri ob 8", zdaj), "neveljavno")
        assertNull(OpomnikCas.izracunaj("", zdaj), "prazno")
        assertNull(OpomnikCas.izracunaj("2030-01-01T10:00:00+01:00", zdaj), "predaleč")
    }

    @Test
    fun `milost 5 sekund za sprozitev takoj`() {
        assertNotNull(OpomnikCas.izracunaj("2026-11-22T13:59:57+01:00", zdaj))
        assertNull(OpomnikCas.izracunaj("2026-11-22T13:59:54+01:00", zdaj))
    }

    @Test
    fun `zapis opomnika - krozenje, TAB in nova vrstica v besedilu`() {
        val o = CakajociOpomnik("a-1", 123456789L, "Pokliči\tAnjo\nob 15h | pozno")
        val r = OpomnikZapis.razclenji(OpomnikZapis.kodiraj(o))
        assertEquals(CakajociOpomnik("a-1", 123456789L, "Pokliči Anjo ob 15h | pozno"), r)
    }

    @Test
    fun `zapis opomnika - pokvarjene vrstice se preskocijo, ostali urejeni po casu`() {
        val vsi = OpomnikZapis.razclenjeniVsi(listOf(
            OpomnikZapis.kodiraj(CakajociOpomnik("b", 200, "drugi")),
            "samo-besedilo", "x\tni-stevilo\tbesedilo", "y\t5\t",
            OpomnikZapis.kodiraj(CakajociOpomnik("a", 100, "prvi")),
        ))
        assertEquals(listOf("a", "b"), vsi.map { it.id })
        assertTrue(vsi.all { it.besedilo.isNotEmpty() })
    }

    @Test
    fun `navodilo modelu opisuje opomnik in ga ne zanika`() {
        val n = SistemskoNavodilo.zgradi(java.time.ZonedDateTime.parse("2026-11-22T14:00:00+01:00"))
        assertTrue(n.contains("[[opomnik:"))
        assertTrue(!n.contains("se ne zna sprozati"))
    }
}
