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
}
