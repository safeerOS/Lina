package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PovzetekDomovTest {
    private fun z(id: String, cas: Long, nujno: Boolean = false) =
        ZapisKlica(id = id, casZacetka = cas, stevilka = "+38640111222", trajanjeS = 30, nujno = nujno, povzetek = "Povzetek $id")

    @Test
    fun `brez novih klicev kartice ni`() {
        val p = povzetekDomov(listOf(z("a", 10)), odCasa = 100)
        assertFalse(p.kartica); assertEquals("", p.naslov)
    }

    @Test
    fun `slovenska dvojina v naslovu`() {
        fun naslov(n: Int) = povzetekDomov((1..n).map { z("k$it", 100L + it) }, 0).naslov
        assertEquals("Lina je odgovorila na 1 klic", naslov(1))
        assertEquals("Lina je odgovorila na 2 klica", naslov(2))
        assertEquals("Lina je odgovorila na 3 klice", naslov(3))
        assertEquals("Lina je odgovorila na 5 klicev", naslov(5))
        assertEquals("Lina je odgovorila na 101 klic", naslov(101))
    }

    @Test
    fun `nujni so loceni, najnovejsi prvi, stevilo je omejeno`() {
        val zapisi = listOf(z("a", 10), z("b", 20, true), z("c", 30), z("d", 40, true))
        val p = povzetekDomov(zapisi, 0, najvecPrikazanih = 1)
        assertEquals(4, p.stevilo); assertEquals(2, p.nujnih)
        assertEquals(listOf("d"), p.nujni.map { it.id })
        assertEquals(listOf("c"), p.ostali.map { it.id })
        assertTrue(p.kartica)
    }
}
