package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Naloga 17 (lastnik 25. 11. 2026): »Tudi te klice ki jih sprejme moja Lina na telefonu ... bi morala Lina na racunalniku beleziti in
 * zapisovati pogovore in shraniti.« Celoten prepis (klicatelj in Lina, z oznako govorca in casom) gre z zapisom klica na racunalnik.
 * Ta razred uporablja samo obstojeci javni API (SejaKlica, DnevnikKlicev, SinhronLine), zato pred popravkom pade na trditvi.
 */
class PrepisKlicaSinhronTest {
    private fun sejaSPogovorom(): SejaKlica {
        val s = SejaKlica(1_700_000_000_000L, "+99955501001")
        s.dodajIzhod("Dober dan. Tukaj Lina, umetna inteligenca. Pogovor se zapisuje.")
        s.konecObrata()
        s.dodajVhod("Tukaj Miha Horvat, prosim za povratni klic.")
        s.konecObrata()
        s.dodajIzhod("Zapisala sem, Miha Horvat bo poklican nazaj.")
        return s
    }

    @Test
    fun `zahteva za sinhronizacijo nosi celoten prepis z govorcem in Lininimi besedami`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        assertTrue(d.dodaj(sejaSPogovorom().zakljuci(1_700_000_030_000L)))
        val poslano = mutableListOf<String>()
        assertTrue(SinhronLine.izmenjaj(d, PomnilniskaShramba(), poslji = { poslano.add(it); """{"rev":1,"klici":[]}""" }))
        val telo = poslano.single()
        assertTrue(telo.contains("Zapisala sem, Miha Horvat bo poklican nazaj."), "Linine besede manjkajo v sinhronizaciji: $telo")
        assertTrue(telo.contains("\"govorec\":\"lina\"") && telo.contains("\"govorec\":\"klicatelj\""), "oznaka govorca manjka: $telo")
    }

    @Test
    fun `zapis, nastal brez racunalnika, se s prepisom poslje ob naslednji povezavi in pod istim id`() {
        val shramba = PomnilniskaShramba()
        val zapis = sejaSPogovorom().zakljuci(1_700_000_030_000L)
        assertTrue(DnevnikKlicev(shramba).dodaj(zapis))
        // Racunalnik ni dosegljiv: vrsta ostane.
        assertEquals(false, SinhronLine.izmenjaj(DnevnikKlicev(shramba), PomnilniskaShramba(), poslji = { null }))
        // Ponovni zagon aplikacije (nov dnevnik iz iste shrambe), nato povezava.
        val d2 = DnevnikKlicev(shramba)
        assertEquals(listOf(zapis.id), d2.cakajociZaSinhronizacijo().map { it.id })
        val poslano = mutableListOf<String>()
        assertTrue(SinhronLine.izmenjaj(d2, PomnilniskaShramba(), poslji = { poslano.add(it); """{"rev":1,"klici":[]}""" }))
        assertTrue(poslano.single().contains("\"${zapis.id}\""))
        assertTrue(poslano.single().contains("Tukaj Miha Horvat, prosim za povratni klic."))
        assertTrue(poslano.single().contains("Zapisala sem, Miha Horvat bo poklican nazaj."))
        assertTrue(d2.cakajociZaSinhronizacijo().isEmpty())
    }
}
