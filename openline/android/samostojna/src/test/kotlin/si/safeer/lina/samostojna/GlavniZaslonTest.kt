package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Preizkusi za GlavniZaslon, vklop/izklop, zmanjsano gibanje, stanje povezave in hitrost lokalnih operacij.
class GlavniZaslonTest {

    @Test
    fun `privzetoStanje - asistentka je privzeto vklopljena na zaslonu DOMOV`() {
        val stanje = GlavniZaslonStanje()
        assertTrue(stanje.vklopljena)
        assertEquals(Faza.MIRUJE, stanje.faza)
        assertEquals(0, stanje.casSekunde)
        assertTrue(stanje.nedavno.isEmpty())
        assertEquals(Zaslon.DOMOV, stanje.zaslon)
    }

    @Test
    fun `nakljucek - ko je vklopljena vrne pravilen naslov svetlo oblo aktivno vrstico in casovnik m_ss`() {
        val kartice = listOf(Kartica("k1", "Opomnik ob 14:00", "Sestanek", "13:50"))
        val stanjePoslusa = GlavniZaslonStanje(
            vklopljena = true,
            faza = Faza.POSLUSA,
            casSekunde = 65,
            nedavno = kartice
        )
        val prikaz = nakljucek(stanjePoslusa)

        assertEquals("Poslušam", prikaz.naslov)
        assertTrue(prikaz.oblaSvetla)
        assertFalse(prikaz.oblaMirna)
        assertTrue(prikaz.spodnjaVrsticaAktivna)
        assertTrue(prikaz.snemanjeOmogoceno)
        assertEquals("1:05", prikaz.casovnik)
        assertEquals(1, prikaz.nedavno.size)

        val prikazNula = nakljucek(stanjePoslusa.copy(casSekunde = 5, faza = Faza.RAZMISLJA))
        assertEquals("Razmišljam", prikazNula.naslov)
        assertEquals("0:05", prikazNula.casovnik)

        val prikazGovori = nakljucek(stanjePoslusa.copy(casSekunde = 600, faza = Faza.GOVORI))
        assertEquals("Govorim", prikazGovori.naslov)
        assertEquals("10:00", prikazGovori.casovnik)
    }

    @Test
    fun `nakljucek - ko je izklopljena je obla mirna in zatemnjena ter snemanje onemogoceno na vseh zaslonih`() {
        for (zaslon in Zaslon.values()) {
            val stanje = GlavniZaslonStanje(
                vklopljena = false,
                faza = Faza.MIRUJE,
                casSekunde = 12,
                nedavno = emptyList(),
                zaslon = zaslon
            )
            val prikaz = nakljucek(stanje)

            assertEquals("Asistentka je izklopljena", prikaz.naslov)
            assertFalse(prikaz.oblaSvetla)
            assertTrue(prikaz.oblaMirna)
            assertFalse(prikaz.spodnjaVrsticaAktivna)
            assertFalse(prikaz.snemanjeOmogoceno)
            assertFalse(prikaz.animacijaAktivna)
            assertEquals(1.0f, prikaz.polmerOble)
        }
    }

    @Test
    fun `preklopiVklop - izklop med POSLUSA RAZMISLJA ali GOVORI ustavi fazo na MIRUJE`() {
        for (aktivnaFaza in listOf(Faza.POSLUSA, Faza.RAZMISLJA, Faza.GOVORI)) {
            val zacetno = GlavniZaslonStanje(
                vklopljena = true,
                faza = aktivnaFaza,
                casSekunde = 30,
                nedavno = emptyList(),
                glasnost = 0.8f
            )
            val poIzklopu = preklopiVklop(zacetno)
            assertFalse(poIzklopu.vklopljena)
            assertEquals(Faza.MIRUJE, poIzklopu.faza)
            assertEquals(0f, poIzklopu.glasnost)

            val poPonovnemVklopu = preklopiVklop(poIzklopu)
            assertTrue(poPonovnemVklopu.vklopljena)
            assertEquals(Faza.MIRUJE, poPonovnemVklopu.faza)
        }
    }

    @Test
    fun `zmanjsanoGibanje - prikaz nima animacijskih vrednosti in polmer ostane 1_0`() {
        for (faza in Faza.values()) {
            val stanje = GlavniZaslonStanje(
                vklopljena = true,
                faza = faza,
                casSekunde = 42,
                nedavno = emptyList(),
                zmanjsanoGibanje = true,
                glasnost = 0.9f
            )
            val prikaz = nakljucek(stanje)
            assertEquals(1.0f, prikaz.polmerOble)
            assertFalse(prikaz.animacijaAktivna)
            assertTrue(prikaz.oblaMirna)
            assertTrue(prikaz.stolpciValovanja.all { it == 0f })
        }
    }

    @Test
    fun `stikaloVklopa - prikaze se samo na zaslonu DOMOV in ne na drugih zaslonih`() {
        for (zaslon in Zaslon.values()) {
            val stanje = GlavniZaslonStanje(
                vklopljena = true,
                faza = Faza.MIRUJE,
                casSekunde = 0,
                nedavno = emptyList(),
                zaslon = zaslon
            )
            val prikaz = nakljucek(stanje)
            if (zaslon == Zaslon.DOMOV) {
                assertTrue(prikaz.prikaziStikaloVklopa, "Stikalo vklopa mora biti vidno na DOMOV")
            } else {
                assertFalse(prikaz.prikaziStikaloVklopa, "Stikalo vklopa NE sme biti vidno na $zaslon")
            }
        }
    }

    @Test
    fun `prikazPovezave - vsa stanja povezave imajo besedilo in ikono ter so prikazana na Domovu`() {
        for (povezava in PovezavaStanje.values()) {
            val podrobnosti = prikazPovezave(povezava, Jezik.SL)
            assertTrue(podrobnosti.besedilo.isNotBlank())
            assertTrue(podrobnosti.ikona.isNotBlank())

            val prikazDomov = nakljucek(GlavniZaslonStanje(zaslon = Zaslon.DOMOV, povezava = povezava))
            assertNotNull(prikazDomov.povezavaPrikaz)
            assertEquals(podrobnosti, prikazDomov.povezavaPrikaz)

            val prikazKoledar = nakljucek(GlavniZaslonStanje(zaslon = Zaslon.KOLEDAR, povezava = povezava))
            assertNull(prikazKoledar.povezavaPrikaz)
        }

        // Preizkus Global Link sinhronizacije zunaj domace mreze
        assertTrue(prikazPovezave(PovezavaStanje.DOMA_LAN, sinhronizacijaAktivna = true).sinhronizacijaAktivna)
        assertTrue(prikazPovezave(PovezavaStanje.GLOBAL_NEPOSREDNO, sinhronizacijaAktivna = true).sinhronizacijaAktivna)
        assertTrue(prikazPovezave(PovezavaStanje.GLOBAL_RELE, sinhronizacijaAktivna = true).sinhronizacijaAktivna)
        assertFalse(prikazPovezave(PovezavaStanje.NI_PARJENO).sinhronizacijaAktivna)
        assertFalse(prikazPovezave(PovezavaStanje.NEDOSEGLJIVO).sinhronizacijaAktivna)
    }

    @Test
    fun `samostojnoDelovanje - NI_PARJENO in NEDOSEGLJIVO ne onemogocita nobenega zaslona le sinhronizacijo`() {
        for (povezava in listOf(PovezavaStanje.NI_PARJENO, PovezavaStanje.NEDOSEGLJIVO)) {
            for (zaslon in Zaslon.values()) {
                val stanje = GlavniZaslonStanje(
                    vklopljena = true,
                    faza = Faza.MIRUJE,
                    casSekunde = 0,
                    nedavno = emptyList(),
                    zaslon = zaslon,
                    povezava = povezava
                )
                val prikaz = nakljucek(stanje)
                assertTrue(prikaz.delujeBrezRacunalnika)
                assertTrue(prikaz.snemanjeOmogoceno)
                assertTrue(prikaz.spodnjaVrsticaAktivna)
                assertTrue(prikaz.zasloniSpodaj.all { it.omogocen })
                assertFalse(prikaz.sinhronizacijaAktivna)
            }
        }
    }

    @Test
    fun `hitrost - lokalne operacije koledar opomnik zapisek in preklop zaslona ne klicejo omrezja`() {
        var steviloOmreznihKlicev = 0
        val sleparskiOdjemalec = LokalniPreizkusniOdjemalec {
            steviloOmreznihKlicev++
            throw AssertionError("Lokalna operacija NE sme klicati racunalnika ali omrezja!")
        }

        val zacetno = LokalnoStanjeTelefona(
            zaslonStanje = GlavniZaslonStanje(povezava = PovezavaStanje.NEDOSEGLJIVO),
            zapiski = emptyList(),
            opomniki = emptyList()
        )

        // 1. Preklop zaslona
        val poPreklopu = izvediLokalnoOperacijo(
            zacetno,
            LokalnaOperacija.PreklopZaslona(Zaslon.KOLEDAR),
            sleparskiOdjemalec
        )
        assertEquals(Zaslon.KOLEDAR, poPreklopu.zaslonStanje.zaslon)

        // 2. Dodajanje zapiska
        val poZapisku = izvediLokalnoOperacijo(
            poPreklopu,
            LokalnaOperacija.DodajZapisek(id = "z1", besedilo = "Nakupovalni seznam", cas = 1000L),
            sleparskiOdjemalec
        )
        assertEquals(1, poZapisku.zapiski.size)
        assertEquals("Nakupovalni seznam", poZapisku.zapiski.first().besedilo)

        // 3. Dodajanje opomnika
        val poOpomniku = izvediLokalnoOperacijo(
            poZapisku,
            LokalnaOperacija.DodajOpomnik(id = "o1", besedilo = "Zobozdravnik", cas = 2000L),
            sleparskiOdjemalec
        )
        assertEquals(1, poOpomniku.opomniki.size)

        // 4. Pregled koledarja
        val dogodkiKoledarja = pregledLokalnegaKoledarja(poOpomniku, odCasa = 1500L, doCasa = 2500L, sleparskiOdjemalec)
        assertEquals(1, dogodkiKoledarja.size)
        assertEquals("Zobozdravnik", dogodkiKoledarja.first().besedilo)

        // 5. Sinhroni izracun prikaza
        val prikaz = nakljucek(poOpomniku.zaslonStanje)
        assertEquals(Zaslon.KOLEDAR, prikaz.izbranZaslon)
        assertEquals(0, steviloOmreznihKlicev)
    }

    @Test
    fun `sinhronizacijaAktivna - locena od stanja povezave in brez teka ni true`() {
        for (povezava in listOf(PovezavaStanje.DOMA_LAN, PovezavaStanje.GLOBAL_NEPOSREDNO, PovezavaStanje.GLOBAL_RELE)) {
            // Na povezanem telefonu brez cesar poslati (sync miruje) sinhronizacijaAktivna ni true
            val mirujocaPovezava = prikazPovezave(povezava, Jezik.SL)
            assertFalse(mirujocaPovezava.sinhronizacijaAktivna, "Ob mirovanju sinhronizacijaAktivna ne sme biti true za $povezava")
            assertEquals(povezava, mirujocaPovezava.stanje)
            assertTrue(mirujocaPovezava.besedilo.isNotBlank())

            val prikazMiruje = nakljucek(GlavniZaslonStanje(zaslon = Zaslon.DOMOV, povezava = povezava))
            assertFalse(prikazMiruje.sinhronizacijaAktivna)
            assertNotNull(prikazMiruje.povezavaPrikaz)
            assertEquals(povezava, prikazMiruje.povezavaPrikaz!!.stanje)
            assertFalse(prikazMiruje.povezavaPrikaz!!.sinhronizacijaAktivna)
        }
    }
}
