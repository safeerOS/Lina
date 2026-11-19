package si.safeer.lina.samostojna.soglasja

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class TrajnaSoglasjaTest {

    class LaznaShramba : ShrambaSoglasij {
        private var podatki = listOf<Soglasje>()

        override fun preberi(): List<Soglasje> = podatki

        override fun shrani(soglasja: List<Soglasje>) {
            podatki = soglasja
        }
    }

    @Test
    fun `osnovni tok - potrdi enkrat, drugic ne vprasa, odstrani, spet vprasa`() {
        val shramba = LaznaShramba()
        val soglasja = TrajnaSoglasja(shramba)
        val vrsta = VrstaDejanja.POSLJI_SPOROCILO
        val obseg = Obseg("mama")

        assertFalse(soglasja.jeDovoljeno(vrsta, obseg), "Na zacetku ni dovoljeno")

        soglasja.dodaj(vrsta, obseg, Izvor.UPORABNIK_V_APLIKACIJI, 1000L)
        assertTrue(soglasja.jeDovoljeno(vrsta, obseg), "Po dodajanju je dovoljeno")

        soglasja.odstrani(vrsta)
        assertFalse(soglasja.jeDovoljeno(vrsta, obseg), "Po odstranitvi spet ni dovoljeno")
    }

    @Test
    fun `varovalka 1 - soglasje velja natanko za vrsto in obseg`() {
        val shramba = LaznaShramba()
        val soglasja = TrajnaSoglasja(shramba)
        
        soglasja.dodaj(VrstaDejanja.POSLJI_SPOROCILO, Obseg("mama"), Izvor.UPORABNIK_V_APLIKACIJI, 1000L)
        
        assertTrue(soglasja.jeDovoljeno(VrstaDejanja.POSLJI_SPOROCILO, Obseg("mama")))
        assertFalse(soglasja.jeDovoljeno(VrstaDejanja.POSLJI_SPOROCILO, Obseg("ata")), "Drug obseg ni dovoljen")
        assertFalse(soglasja.jeDovoljeno(VrstaDejanja.USTVARI_ZAPISEK, Obseg("mama")), "Druga vrsta ni dovoljena")
    }

    @Test
    fun `varovalka 2 - visoko tvegana dejanja zavrnejo trajno soglasje in vedno vrnejo false`() {
        val shramba = LaznaShramba()
        val soglasja = TrajnaSoglasja(shramba)
        
        val izjema = assertThrows(IllegalArgumentException::class.java) {
            soglasja.dodaj(VrstaDejanja.DENAR, Obseg.VSE, Izvor.UPORABNIK_V_APLIKACIJI, 1000L)
        }
        assertTrue(izjema.message!!.contains("Visoko tvegana"), "Mora jasno povedati zakaj zavrne")
        
        // Ce bi se soglasje nekako znaslo v shrambi (npr. rocni vpis)
        shramba.shrani(listOf(Soglasje(VrstaDejanja.BRISANJE_PODATKOV, Obseg.VSE, 1000L)))
        assertFalse(soglasja.jeDovoljeno(VrstaDejanja.BRISANJE_PODATKOV, Obseg.VSE), "Kljub shranjenemu soglasju mora vrniti false za visoko tveganje")
    }

    @Test
    fun `varovalka 3 - samo uporabnik v aplikaciji lahko doda soglasje`() {
        val shramba = LaznaShramba()
        val soglasja = TrajnaSoglasja(shramba)
        
        val neveljavniIzvori = listOf(Izvor.KLIC, Izvor.SPOROCILO, Izvor.SPLET, Izvor.DRUGI_AGENT, Izvor.OPOMNIK)
        
        for (izvor in neveljavniIzvori) {
            val izjema = assertThrows(IllegalArgumentException::class.java) {
                soglasja.dodaj(VrstaDejanja.POSLJI_SPOROCILO, Obseg("mama"), izvor, 1000L)
            }
            assertTrue(izjema.message!!.contains("Zavrnjen izvor: $izvor"), "Jasno sporocilo o napaki za izvor")
        }
    }

    @Test
    fun `varovalka 4 - odstrani vsa soglasja`() {
        val shramba = LaznaShramba()
        val soglasja = TrajnaSoglasja(shramba)
        
        soglasja.dodaj(VrstaDejanja.POSLJI_SPOROCILO, Obseg("mama"), Izvor.UPORABNIK_V_APLIKACIJI, 1000L)
        soglasja.dodaj(VrstaDejanja.USTVARI_ZAPISEK, Obseg.VSE, Izvor.UPORABNIK_V_APLIKACIJI, 1000L)
        
        assertEquals(2, soglasja.seznam().size)
        
        soglasja.odstraniVsa()
        
        assertTrue(soglasja.seznam().isEmpty(), "Vsa soglasja morajo biti odstranjena")
    }

    @Test
    fun `soglasje za vse velja za vsak obseg te vrste, ne pa za drugo vrsto`() {
        val soglasja = TrajnaSoglasja(LaznaShramba())
        soglasja.dodaj(VrstaDejanja.USTVARI_ZAPISEK, Obseg.VSE, Izvor.UPORABNIK_V_APLIKACIJI, 1L)
        assertTrue(soglasja.jeDovoljeno(VrstaDejanja.USTVARI_ZAPISEK, Obseg("karkoli")))
        assertFalse(soglasja.jeDovoljeno(VrstaDejanja.POSLJI_SPOROCILO, Obseg("karkoli")))
    }
}
