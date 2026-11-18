package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Besedilo datoteke z zapiski v Dokumentih (lastnik 19. 11. 2026).
class ZapiskiBesediloTest {
    private fun cas(ms: Long) = "t$ms"

    @Test
    fun `najnovejsi zapisek je zgoraj in ima datum`() {
        val s = listOf(Zapisek("a", "stari", 100, false), Zapisek("b", "novi", 200, false))
        val b = zapiskiVBesedilo(s, "Naslov", "Opomba", ::cas)
        assertEquals("Naslov\nOpomba\n\n[t200]\nnovi\n\n[t100]\nstari\n", b)
    }

    @Test
    fun `izbrisan zapisek ni v datoteki`() {
        val s = listOf(Zapisek("a", "ostane", 100, false), Zapisek("b", "izbrisan", 200, true))
        val b = zapiskiVBesedilo(s, "N", "O", ::cas)
        assertTrue(b.contains("ostane"))
        assertFalse(b.contains("izbrisan"))
    }

    @Test
    fun `brez zapiskov je samo glava`() {
        assertEquals("N\nO\n", zapiskiVBesedilo(emptyList(), "N", "O", ::cas))
    }
}
