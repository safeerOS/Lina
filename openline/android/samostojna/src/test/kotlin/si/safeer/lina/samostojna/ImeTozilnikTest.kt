package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.ZonedDateTime

// Isti primeri kot src/lib/lina/ime-tozilnik.test.ts (lastnik 21. 11. 2026: »Poklicali ste Tomaža«). Imena izmisljena ali obicajna.
class ImeTozilnikTest {
    private val primeri = listOf(
        "Tomaž" to "Tomaža", "Alen" to "Alena", "Ana" to "Ano", "Maja" to "Majo", "Luka" to "Luko", "Žiga" to "Žigo",
        "Marko" to "Marka", "Peter" to "Petra", "Pavel" to "Pavla", "Jure" to "Jureta", "Igor" to "Igorja", "Primož" to "Primoža",
        "Ines" to "Ines", "Karmen" to "Karmen", "Tomaž Novak" to "Tomaža Novaka", "Ana Novak" to "Ano Novak", "Nejc Kranjc" to "Nejca Kranjca",
        "Mitja" to "Mitjo", "Gregor" to "Gregorja", "" to "",
    )

    @Test
    fun `tozilnik - isti primeri kot na racunalniku`() {
        for ((vhod, izhod) in primeri) assertEquals(izhod, ImeTozilnik.imeVTozilniku(vhod), vhod)
    }

    @Test
    fun `tozilnik - uporabnikov zapis ima prednost`() {
        assertEquals("Neznanka", ImeTozilnik.imeVTozilniku("Neznanko", "Neznanka"))
    }

    @Test
    fun `pozdrav - z imenom tozilnik, brez imena glasovna tajnica, nikoli splosne besede`() {
        assertEquals("Tukaj Lina, pomočnica z umetno inteligenco. Pogovor se zapisuje. Poklicali ste Tomaža. Kaj naj sporočim?", ImeTozilnik.pozdrav("Tomaž"))
        assertEquals("Tukaj Lina, pomočnica z umetno inteligenco. Pogovor se zapisuje. Dosegli ste glasovno tajnico. Kaj naj sporočim?", ImeTozilnik.pozdrav(""))
        assertFalse(ImeTozilnik.PREPOVEDANO_ZA_POKLICALI.containsMatchIn(ImeTozilnik.pozdrav("Tomaž")))
        assertTrue(ImeTozilnik.PREPOVEDANO_ZA_POKLICALI.containsMatchIn("Poklicali ste podjetje Forma."))
    }

    @Test
    fun `navodilo za klic - pozdrav z imenom v tozilniku in brez prepovedanih besed`() {
        val zdaj = ZonedDateTime.parse("2026-11-22T10:00:00+01:00[Europe/Ljubljana]")
        val z = SistemskoNavodilo.zgradiZaKlic(zdaj, "Ana", "")
        assertTrue(z.contains("»Tukaj Lina, pomočnica z umetno inteligenco. Pogovor se zapisuje. Poklicali ste Ano. Kaj naj sporočim?«"), z)
        assertFalse(ImeTozilnik.PREPOVEDANO_ZA_POKLICALI.containsMatchIn(z))
        assertFalse(z.contains("vprasaj, kako lahko pomagas"))
        val brez = SistemskoNavodilo.zgradiZaKlic(zdaj)
        assertTrue(brez.contains("Dosegli ste glasovno tajnico."))
        assertFalse(ImeTozilnik.PREPOVEDANO_ZA_POKLICALI.containsMatchIn(brez))
        assertTrue(SistemskoNavodilo.zgradiZaKlic(zdaj, "Ana", "Anko").contains("Poklicali ste Anko."))
    }

    /** Lastnik 22. 11. 2026: zakon zahteva obvestilo o zapisovanju; s snemanjem »Pogovor se snema in zapisuje.«. */
    @Test fun `pozdrav pove zapisovanje in snemanje`() {
        assertEquals("Tukaj Lina, pomočnica z umetno inteligenco. Pogovor se snema in zapisuje. Poklicali ste Ano. Kaj naj sporočim?", ImeTozilnik.pozdrav("Ana", snemanje = true))
        assertTrue("Pogovor se zapisuje." in ImeTozilnik.pozdrav(""))
    }
}
