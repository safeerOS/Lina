package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Telesa in odgovori poti /koda/zacni, /koda/spake, /koda/potrdi (asistent-streznik.server.ts @fdd787b). */
class KodaProtokolTest {
    @Test
    fun `telesa zahtev`() {
        assertEquals("""{"id":"n-e255066f6635ba17","ime":"Telefon"}""", KodaProtokol.teloZacni("n-e255066f6635ba17", "Telefon", false))
        assertEquals("""{"id":"n-1","ime":"T","kodaNaTelefonu":true}""", KodaProtokol.teloZacni("n-1", "T", true))
        assertEquals("""{"pair_id":"p","id":"n-1","pb":"04aa"}""", KodaProtokol.teloSpake("p", "n-1", "04aa"))
        assertEquals("""{"pair_id":"p","id":"n-1","kljuc":"k","ime":"T","cas":5,"enkratni":"e","podpis":"s","cb":"c","mac":"m"}""",
            KodaProtokol.teloPotrdi("p", "n-1", "k", "T", 5, "e", "s", "c", "m"))
    }

    @Test
    fun `odgovori`() {
        val z = assertNotNull(KodaProtokol.razberiZacetek("""{"pair_id":"pairVektorK18-0123456_","nacin":"spake2","hub_id":"lina-asistent","fp":"${"ab".repeat(32)}","expires_in_seconds":287}"""))
        assertEquals("pairVektorK18-0123456_", z.pairId); assertEquals(287, z.poteceS)
        assertNull(KodaProtokol.razberiZacetek("""{"pair_id":"p","nacin":"spake2","hub_id":"lina-asistent","fp":"x","expires_in_seconds":"287"}"""))
        assertNull(KodaProtokol.razberiZacetek("""{"pair_id":"pairVektorK18-0123456_x","nacin":"spake2","hub_id":"lina-asistent","fp":"x","expires_in_seconds":1}"""))
        assertEquals("04" to "aa", KodaProtokol.razberiSpake("""{"pa":"04","ca":"aa"}"""))
        assertNull(KodaProtokol.razberiSpake("""{"pa":"04"}"""))
        assertEquals(true to null, KodaProtokol.razberiPotrdi("""{"stanje":"caka"}"""))
        assertEquals(KliciIzKode("https://10.0.0.2:8443", "ABCD2345", "ab"),
            KodaProtokol.razberiPotrdi("""{"stanje":"caka","klici":{"url":"https://10.0.0.2:8443","code":"ABCD2345","fp":"ab"}}""")?.second)
        assertNull(KodaProtokol.razberiPotrdi("""{"stanje":"sprejeto"}"""))
        assertNull(KodaProtokol.razberiPotrdi("""{"stanje":"caka","klici":{"url":"https://10.0.0.2:8443","code":5,"fp":"ab"}}"""))
    }

    @Test
    fun `napake`() {
        assertEquals(NapakaKode.CAKA_KODO, KodaProtokol.napaka(409, "caka_kodo"))
        assertEquals(NapakaKode.NAPACNA_KODA, KodaProtokol.napaka(401, "napacna_koda"))
        assertEquals(NapakaKode.ID_ZASEDEN, KodaProtokol.napaka(409, "id_zaseden"))
        assertEquals(NapakaKode.ZAPRTO, KodaProtokol.napaka(429, "seznanitev_zaprta"))
        assertEquals(NapakaKode.PREVEC, KodaProtokol.napaka(429, "prevec_poskusov"))
        assertEquals(NapakaKode.NI_PRIJAVE, KodaProtokol.napaka(404, "prijava_ne_obstaja"))
        assertEquals(NapakaKode.NI_ODPRTO, KodaProtokol.napaka(403, "ni_odprto"))
        assertEquals(NapakaKode.ZAVRNJENO, KodaProtokol.napaka(403, null))
        assertEquals(NapakaKode.NAPAKA, KodaProtokol.napaka(500, "notranja"))
    }
}
