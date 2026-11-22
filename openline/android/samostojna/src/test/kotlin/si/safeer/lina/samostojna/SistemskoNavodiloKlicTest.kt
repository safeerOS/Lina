package si.safeer.lina.samostojna

import java.time.ZonedDateTime
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue

class SistemskoNavodiloKlicTest {
    private val zdaj = ZonedDateTime.parse("2026-11-19T10:00:00+01:00")

    @Test
    fun `navodilo za klic nima oznak, ki bi jih model prebral na glas`() {
        val n = SistemskoNavodilo.zgradiZaKlic(zdaj)
        assertFalse(n.contains("[["))
        assertFalse(n.contains("zapisek"))
        assertTrue(n.contains("telefonski klic"))
        assertTrue(n.contains("2026-11-19T10:00"))
    }

    /** Znanje 22. 11. 2026: nujni primer (112) in prepoved placilnih podatkov sta v navodilu vsakega klica. */
    @Test fun `navodilo klica vsebuje 112 in prepoved kartic in gesel`() {
        val n = SistemskoNavodilo.zgradiZaKlic(java.time.ZonedDateTime.parse("2026-11-22T10:00:00+01:00[Europe/Ljubljana]"), "Ana")
        kotlin.test.assertTrue("(112)" in n)
        kotlin.test.assertTrue("placilne kartice" in n && "gesla" in n)
    }
}
