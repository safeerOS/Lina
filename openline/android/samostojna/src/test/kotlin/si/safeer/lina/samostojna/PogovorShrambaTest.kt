package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

class PogovorShrambaTest {
    private val t0 = Instant.parse("2026-11-20T10:00:00Z")

    @Test
    fun `sporocilo se ohrani po ponovnem zagonu in se ne podvoji`() {
        val s = PomnilniskaShramba()
        val p = PogovorShramba(s)
        assertTrue(p.dodaj("lastnik", "Zapisi opomnik za jutri", t0))
        assertFalse(p.dodaj("lastnik", "Zapisi opomnik za jutri", t0))
        assertTrue(p.dodaj("lina", "Zapisano.", t0.plusSeconds(2)))
        val novo = PogovorShramba(s)
        assertEquals(listOf("lastnik", "lina"), novo.vsa().map { it.vloga })
    }

    @Test
    fun `sporocila z racunalnika se zlijejo po casu, neveljavna se zavrnejo`() {
        val p = PogovorShramba(PomnilniskaShramba())
        p.dodaj("lina", "Odgovor", t0.plusSeconds(10))
        val dodanih = p.zlij(listOf(
            PogovorSinhron("lastnik", "Vprasanje", t0.toString()),
            PogovorSinhron("tuja", "x", t0.toString()),
            PogovorSinhron("lastnik", "", t0.toString()),
            PogovorSinhron("lastnik", "slab cas", "včeraj"),
        ))
        assertEquals(1, dodanih)
        assertEquals(listOf("Vprasanje", "Odgovor"), p.vsa().map { it.besedilo })
    }

    @Test
    fun `najvec 200 sporocil, najstarejsa odpadejo, pokvarjena shramba ni zrusitev`() {
        val p = PogovorShramba(PomnilniskaShramba())
        repeat(PogovorShramba.NAJVEC + 20) { p.dodaj("lastnik", "sporocilo $it", t0.plusSeconds(it.toLong())) }
        assertEquals(PogovorShramba.NAJVEC, p.vsa().size)
        assertEquals("sporocilo 20", p.vsa().first().besedilo)
        assertEquals(0, PogovorShramba(PomnilniskaShramba("to ni json")).vsa().size)
    }
}
