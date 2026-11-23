package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class BesediloObliokaTest {
    @Test fun `debelo in alineje iz posnetka povzetka klicev`() {
        val vhod = "Pripravila sem povzetek:\n\n*   **Marko Novak (12 klicev):** Porocal je.\n*   **Neznan klicatelj (1 klic):** Brez.\n\n**Odprto/Nujno:** Preveri."
        val pricakovano = "Pripravila sem povzetek:\n\n• Marko Novak (12 klicev): Porocal je.\n• Neznan klicatelj (1 klic): Brez.\n\nOdprto/Nujno: Preveri."
        assertEquals(pricakovano, besediloBrezMarkdowna(vhod))
    }

    @Test fun `naslovi, podcrtaji in navadno besedilo`() {
        assertEquals("Naslov\nvazno besedilo 2 * 3", besediloBrezMarkdowna("## Naslov\n__vazno__ besedilo 2 * 3"))
        assertEquals("Navadno besedilo brez oznak.", besediloBrezMarkdowna("Navadno besedilo brez oznak."))
    }

    @Test fun `koda ostane dobesedna`() {
        assertEquals("Poklici `__init__` in **ne** tole.".replace("**ne**", "ne"), besediloBrezMarkdowna("Poklici `__init__` in **ne** tole."))
        assertEquals("```\n**x** __y__\n```", besediloBrezMarkdowna("```\n**x** __y__\n```"))
    }
}
