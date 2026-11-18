package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Preizkusi za barvne teme in izracun kontrasta po WCAG.
class TemeTest {

    @Test
    fun `barve - temna tema je privzeta in vrne tocne tokene Aura`() {
        val privzeta = barve()
        val temna = barve(Tema.TEMNA)

        assertEquals(temna, privzeta)
        assertEquals("#0E0B24", temna.ozadje)
        assertEquals("#171236", temna.povrsina)
        assertEquals("#1F1948", temna.povrsina2)
        assertEquals("#5CE1E6", temna.poudarekCian)
        assertEquals("#FF4F9A", temna.rozaSnemanje)
        assertEquals("#EEF0FF", temna.besedilo)
        assertEquals("#A7A9D6", temna.tiho)
        assertEquals("#FF8087", temna.napaka)
    }

    @Test
    fun `barve - kontrast besedilo proti ozadju je vsaj 4_5 proti 1 v obeh temah`() {
        val temna = barve(Tema.TEMNA)
        val svetla = barve(Tema.SVETLA)

        val kontrastTemna = kontrast(temna.besedilo, temna.ozadje)
        val kontrastSvetla = kontrast(svetla.besedilo, svetla.ozadje)

        assertTrue(kontrastTemna >= 4.5, "Kontrast temne teme mora biti >= 4.5, bil je $kontrastTemna")
        assertTrue(kontrastSvetla >= 4.5, "Kontrast svetle teme mora biti >= 4.5, bil je $kontrastSvetla")
    }

    @Test
    fun `barve - kontrast besedila na povrsinah in tihega besedila v obeh temah`() {
        for (tema in Tema.values()) {
            val b = barve(tema)
            assertTrue(kontrast(b.besedilo, b.povrsina) >= 4.5)
            assertTrue(kontrast(b.besedilo, b.povrsina2) >= 4.5)
            assertTrue(kontrast(b.tiho, b.ozadje) >= 4.5)
        }
    }

    @Test
    fun `kontrast - pravilno izracuna razmerje za crno belo in enaki barvi`() {
        val crnoBelo = kontrast("#000000", "#FFFFFF")
        val beloCrno = kontrast("#FFFFFF", "#000000")
        val enaki = kontrast("#171236", "#171236")

        assertEquals(21.0, crnoBelo, 0.05)
        assertEquals(crnoBelo, beloCrno, 0.0001)
        assertEquals(1.0, enaki, 0.0001)
    }

    @Test
    fun `kontrast - neveljaven barvni niz ne vrze izjeme in vrne 1_0`() {
        assertEquals(1.0, kontrast("", "#000000"), 0.0001)
        assertEquals(1.0, kontrast("neveljavno", "#FFFFFF"), 0.0001)
    }

    @Test
    fun `relativnaSvetlost in kontrast - zavrne predznacene RGB hex nize kot je #-00001 in sprejme #FFFFFF`() {
        assertNull(relativnaSvetlost("#-00001"))
        assertNull(relativnaSvetlost("-00001"))
        assertNull(relativnaSvetlost("#+00001"))
        assertEquals(1.0, kontrast("#-00001", "#000000"), 0.0001)
        assertEquals(1.0, relativnaSvetlost("#FFFFFF")!!, 0.0001)
        assertEquals(1.0, relativnaSvetlost("FFFFFF")!!, 0.0001)
    }
}
