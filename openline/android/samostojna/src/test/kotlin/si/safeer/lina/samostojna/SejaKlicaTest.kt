package si.safeer.lina.samostojna

import java.time.ZoneId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class SejaKlicaTest {
    private val zona = ZoneId.of("Europe/Ljubljana")
    private val t0 = 1_795_000_000_000L // 2026-11-18 v Ljubljani, vrednost je pomembna samo za obliko imena

    @Test
    fun `odlomki prepisa brez locila se ob veliki crki locijo z novo vrstico`() {
        val s = SejaKlica(t0, "+38641123456")
        s.dodajVhod("Prosim bolj pravilno slovensko.")
        s.dodajVhod("Pa ni umetnikova inteligenca")
        s.dodajVhod(", ampak pomocnica.")
        s.dodajVhod(" Ana Novak")
        s.dodajVhod("Pravilno.")
        val z = s.zakljuci(t0 + 5_000)
        assertEquals(
            "Prosim bolj pravilno slovensko.\nPa ni umetnikova inteligenca, ampak pomocnica. Ana Novak\nPravilno.",
            z.sporociloDobesedno,
        )
    }

    @Test
    fun `klic s sporocilom ima ime, podjetje, povzetek in dobesedni zapis`() {
        val s = SejaKlica(t0, "+38641123456")
        s.dodajVhod("Dober dan, tukaj Miha Horvat ")
        s.dodajVhod("iz podjetja Alfa.")
        s.konecObrata()
        s.dodajVhod("Prosim, naj me pokliče nazaj, stane 50 evrov.")
        s.shraniSporocilo("Miha", "Horvat", "Alfa", "Prosi za povratni klic glede ponudbe.")
        val z = s.zakljuci(t0 + 75_000)
        assertEquals("Miha Horvat", z.klicatelj)
        assertEquals("Alfa", z.podjetje)
        assertEquals("+38641123456", z.stevilka)
        assertEquals(75, z.trajanjeS)
        assertEquals("", z.brezSporocilaRazlog)
        assertTrue(z.sporociloDobesedno.contains("tukaj Miha Horvat iz podjetja Alfa."))
        assertTrue(z.sporociloDobesedno.contains("\n"))
        // Sporocilo klicatelja z ceno ne sme izgubiti zapisa (pravilo o cenah velja za Linine izjave).
        assertTrue(jeVeljavenZapisKlica(z.copy(sporocilo = "Sporoča, da stane 50 evrov.")))
    }

    @Test
    fun `klic brez sporocila in brez zvoka pove razlog`() {
        val z = SejaKlica(t0, "").zakljuci(t0 + 3_000)
        assertEquals("skrita številka", z.stevilka)
        assertTrue(z.brezSporocilaRazlog.contains("ni bilo mogoče zapisati"))
        assertEquals("", z.sporocilo)
        val b = besediloDatotekeKlica(z, zona)
        assertTrue(b.contains("Sporočila ni bilo."))
        assertTrue(b.contains("Razlog:"))
    }

    @Test
    fun `klicatelj je govoril, Lina pa sporocila ni zapisala, dobesedni zapis ostane`() {
        val s = SejaKlica(t0, "+38631000111")
        s.dodajVhod("Rad bi govoril z direktorjem.")
        val z = s.zakljuci(t0 + 20_000)
        assertTrue(z.brezSporocilaRazlog.contains("Lina sporočila ni zapisala"))
        assertEquals("Rad bi govoril z direktorjem.", z.sporociloDobesedno)
        assertFalse(s.imaSporocilo())
    }

    @Test
    fun `poznejsi klic orodja dopolni in prazno polje ne izbrise zapisanega`() {
        val s = SejaKlica(t0, "+38631000111")
        s.shraniSporocilo("Ana", null, null, "Prvo sporočilo")
        s.shraniSporocilo("", "Kovač", "Beta", "")
        val z = s.zakljuci(t0 + 1_000)
        assertEquals("Ana Kovač", z.klicatelj)
        assertEquals("Beta", z.podjetje)
        assertEquals("Prvo sporočilo", z.sporocilo)
    }

    @Test
    fun `ime datoteke ima cas, ime in stevilko ter nima prepovedanih znakov`() {
        val z = SejaKlica(t0, "+386 41/123*456").also { it.shraniSporocilo("Ana", "Kovač", null, "x") }.zakljuci(t0 + 1_000)
        val ime = imeDatotekeKlica(z, zona)
        assertTrue(ime.endsWith(".txt"))
        assertTrue(ime.contains("Ana Kovač"))
        assertTrue(ime.contains("+386 41 123 456"))
        assertFalse(ime.any { it in "\\/:*?\"<>|" })
        val neznan = imeDatotekeKlica(SejaKlica(t0, "041123456").zakljuci(t0), zona)
        assertTrue(neznan.contains("Neznan 041123456"))
    }

    @Test
    fun `stare zapise brez novih polj se se vedno bere`() {
        val z = zapisKlicaIzJson("""{"id":"a","casZacetka":1,"stevilka":"041","trajanjeS":2,"povzetek":"x"}""")
        assertTrue(z != null && z.klicatelj.isEmpty() && z.sporocilo.isEmpty())
    }

    @Test
    fun `dolgo ime ne odreze stevilke v imenu datoteke`() {
        val z = ZapisKlica(id = "x", casZacetka = 1000L, stevilka = "+38640123456", trajanjeS = 1, povzetek = "p", klicatelj = "A".repeat(400))
        val ime = imeDatotekeKlica(z, java.time.ZoneId.of("UTC"))
        assertTrue(ime.length <= 154)
        assertTrue(ime.endsWith("+38640123456.txt"))
    }

    @Test
    fun `zapis samo s povzetkom izvozi povzetek`() {
        val z = ZapisKlica(id = "y", casZacetka = 1000L, stevilka = "041123456", trajanjeS = 5, povzetek = "Poklical bo jutri.")
        val b = besediloDatotekeKlica(z, java.time.ZoneId.of("UTC"))
        assertTrue(b.contains("Poklical bo jutri."))
        assertFalse(b.contains("Sporočila ni bilo."))
    }

    @Test
    fun `Linine vrstice so v zapisu in v datoteki klica, vsak obrat v svoji vrstici`() {
        val s = SejaKlica(t0, "+38641123456")
        s.dodajIzhod("Dober dan, tukaj Lina. ")
        s.dodajIzhod("Kako vam lahko pomagam?")
        s.konecObrata()
        s.dodajVhod("Prosim za povratni klic.")
        s.konecObrata()
        s.dodajIzhod("Sem zapisala.")
        s.konecObrata()
        val z = s.zakljuci(t0 + 30_000)
        assertEquals("Dober dan, tukaj Lina. Kako vam lahko pomagam?\nSem zapisala.", z.linaDobesedno)
        val datoteka = besediloDatotekeKlica(z, zona)
        assertTrue(datoteka.contains("Dobesedno, kar je rekla Lina:\nDober dan, tukaj Lina. Kako vam lahko pomagam?\nSem zapisala."))
        assertTrue(datoteka.contains("Dobesedno, kar je povedal klicatelj:\nProsim za povratni klic."))
    }
}
