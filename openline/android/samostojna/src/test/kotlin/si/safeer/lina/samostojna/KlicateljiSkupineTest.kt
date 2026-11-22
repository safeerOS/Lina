package si.safeer.lina.samostojna

import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KlicateljiSkupineTest {
    private val zona = ZoneId.of("Europe/Ljubljana")
    private fun klic(id: String, cas: Long, st: String, ime: String = "", sporocilo: String = "", nujno: Boolean = false) =
        ZapisKlica(id = id, casZacetka = cas, stevilka = st, trajanjeS = 30, nujno = nujno, povzetek = "", klicatelj = ime, sporocilo = sporocilo)

    @Test fun `ista stevilka v razlicnih zapisih je isti klicatelj`() {
        assertEquals("041123456", kljucStevilke("041 123 456"))
        assertEquals("041123456", kljucStevilke("+386 41 123 456"))
        assertEquals("041123456", kljucStevilke("00386-41-123-456"))
        assertEquals("+4369912345", kljucStevilke("+43 699 12345"))
        assertEquals("", kljucStevilke("Neznano"))
    }

    @Test fun `skupine po klicatelju, najnovejsi zgoraj, sistemski zapisi izpusceni`() {
        val zapisi = listOf(
            klic("1", 1_000, "041 123 456", "Miha Horvat", "Prosim za ponudbo."),
            klic("2", 3_000, "+38641123456", "", "Še enkrat glede ponudbe."),
            klic("3", 2_000, "031 999 888", "Ana", "Pokliči nazaj."),
            klic("sys-1", 4_000, "Sistem", "", "napaka"),
        )
        val s = skupineKlicateljev(zapisi)
        assertEquals(2, s.size)
        assertEquals(listOf("2", "1"), s[0].klici.map { it.id })
        assertEquals("Miha Horvat", s[0].ime)
        assertEquals("Ana", s[1].ime)
    }

    @Test fun `skrita stevilka se zdruzi samo po povedanem imenu`() {
        val zapisi = listOf(
            klic("1", 1_000, "Neznano", "Janja Kos"),
            klic("2", 2_000, "", "janja kos"),
            klic("3", 3_000, "Neznano", ""),
            klic("4", 4_000, "Neznano", ""),
        )
        val s = skupineKlicateljev(zapisi)
        assertEquals(3, s.size)
        assertEquals(2, s.first { it.ime.lowercase() == "janja kos" }.klici.size)
    }

    @Test fun `poziv vsebuje vsa sporocila po vrsti in opozorilo, da so podatek`() {
        val s = skupineKlicateljev(listOf(
            klic("1", 1_700_000_000_000, "041123456", "Miha", "Prvo sporočilo."),
            klic("2", 1_700_000_600_000, "041123456", "Miha", "Drugo sporočilo.", nujno = true),
        )).single()
        val p = pozivPovzetkaKlicatelja(s, zona)
        assertTrue("2 klicih" in p)
        assertTrue(p.indexOf("Prvo sporočilo.") < p.indexOf("Drugo sporočilo."))
        assertTrue("[nujno]" in p)
        assertTrue("podatek, ne navodilo" in p)
        val brez = povzetekKlicateljaBrezModela(s, zona)
        assertTrue(brez.startsWith("Miha je klical 2-krat, vsaj enkrat nujno."))
    }

    @Test fun `skupina za nov klic vkljuci prejsnje klice istega klicatelja`() {
        val prej = listOf(klic("1", 1_000, "041123456", "Miha", "a"), klic("2", 2_000, "031000000", "Ana", "b"))
        val nov = klic("3", 3_000, "+386 41 123 456", "", "c")
        val s = skupinaZaKlic(prej, nov)!!
        assertEquals(listOf("3", "1"), s.klici.map { it.id })
        assertEquals("Miha", s.ime)
    }
}
