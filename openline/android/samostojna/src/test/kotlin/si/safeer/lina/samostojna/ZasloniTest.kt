package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Preizkusi za 6 zaslonov, navigacijo, potrditve obcutljivih dejanj in samostojno delovanje.
class ZasloniTest {

    @Test
    fun `zasloni - vseh 6 zaslonov ima pravilne oznake in opise v sl in en`() {
        val pricakovaniSl = listOf("Domov", "Pogovor", "Koledar", "Opravila", "Zapiski", "Komunikacija")
        val pricakovaniEn = listOf("Home", "Chat", "Calendar", "Tasks", "Notes", "Communication")

        val zasloni = Zaslon.values().toList()
        assertEquals(6, zasloni.size)
        assertEquals(pricakovaniSl, zasloni.map { it.oznaka(Jezik.SL) })
        assertEquals(pricakovaniEn, zasloni.map { it.oznaka(Jezik.EN) })

        assertTrue(Zaslon.DOMOV.opis(Jezik.SL).lowercase().contains("obla"))
        assertTrue(Zaslon.POGOVOR.opis(Jezik.SL).lowercase().contains("mikrofon"))
        assertTrue(Zaslon.KOLEDAR.opis(Jezik.SL).lowercase().contains("pregled"))
        assertTrue(Zaslon.OPRAVILA.opis(Jezik.SL).lowercase().contains("opravila"))
        assertTrue(Zaslon.ZAPISKI.opis(Jezik.SL).lowercase().contains("narekovanje"))
        assertTrue(Zaslon.KOMUNIKACIJA.opis(Jezik.SL).lowercase().contains("klic"))

        for (z in zasloni) {
            assertTrue(z.opis(Jezik.EN).isNotBlank())
        }
    }

    @Test
    fun `naslednji - premik naprej in nazaj pravilno krozi med 6 zasloni`() {
        assertEquals(Zaslon.POGOVOR, naslednji(Zaslon.DOMOV, Smer.NAPREJ))
        assertEquals(Zaslon.KOLEDAR, naslednji(Zaslon.POGOVOR, Smer.NAPREJ))
        assertEquals(Zaslon.OPRAVILA, naslednji(Zaslon.KOLEDAR, Smer.NAPREJ))
        assertEquals(Zaslon.ZAPISKI, naslednji(Zaslon.OPRAVILA, Smer.NAPREJ))
        assertEquals(Zaslon.KOMUNIKACIJA, naslednji(Zaslon.ZAPISKI, Smer.NAPREJ))
        assertEquals(Zaslon.DOMOV, naslednji(Zaslon.KOMUNIKACIJA, Smer.NAPREJ))

        assertEquals(Zaslon.KOMUNIKACIJA, naslednji(Zaslon.DOMOV, Smer.NAZAJ))
        assertEquals(Zaslon.DOMOV, naslednji(Zaslon.POGOVOR, Smer.NAZAJ))

        // Tudi s celostevilskim korakom
        assertEquals(Zaslon.POGOVOR, naslednji(Zaslon.DOMOV, 1))
        assertEquals(Zaslon.KOMUNIKACIJA, naslednji(Zaslon.DOMOV, -1))
        assertEquals(Zaslon.DOMOV, naslednji(Zaslon.DOMOV, 6))
    }

    @Test
    fun `spodnjaVrstica - prikaze vseh 6 zaslonov in poudari samo izbranega`() {
        for (izbran in Zaslon.values()) {
            val vrstica = spodnjaVrsticaZasloni(izbran, Jezik.SL)
            assertEquals(6, vrstica.size)
            assertEquals(1, vrstica.count { it.poudarjen })
            assertEquals(izbran, vrstica.first { it.poudarjen }.zaslon)
            assertTrue(vrstica.all { it.omogocen })
        }
    }

    @Test
    fun `potrebujePotrditev - vrne true za posiljanje sporocil e-poste in brisanje`() {
        assertTrue(potrebujePotrditev(Dejanje.POSLJI_SPOROCILO))
        assertTrue(potrebujePotrditev(Dejanje.POSLJI_EPOSTO))
        assertTrue(potrebujePotrditev(Dejanje.IZBRISI))
        assertTrue(potrebujePotrditev(Dejanje.POKLICI))

        assertFalse(potrebujePotrditev(Dejanje.PREBERI_KOLEDAR))
        assertFalse(potrebujePotrditev(Dejanje.USTVARI_OSNUTEK))
        assertFalse(potrebujePotrditev(Dejanje.DODAJ_ZAPISEK))
        assertFalse(potrebujePotrditev(Dejanje.DODAJ_OPOMNIK))
        assertFalse(potrebujePotrditev(Dejanje.PREKLOPI_ZASLON))

        // Preizkus tudi za besedilne oznake dejanj
        assertTrue(potrebujePotrditev("poslji_sporocilo"))
        assertTrue(potrebujePotrditev("poslji_eposto"))
        assertTrue(potrebujePotrditev("brisanje_zapiska"))
        assertFalse(potrebujePotrditev("ustvari_osnutek"))
    }

    @Test
    fun `zmoznostBrezRacunalnika - vrne true za vseh 6 zaslonov`() {
        for (zaslon in Zaslon.values()) {
            assertTrue(
                zmoznostBrezRacunalnika(zaslon),
                "Zaslon $zaslon mora delovati samostojno na telefonu brez racunalnika"
            )
        }
    }
}
