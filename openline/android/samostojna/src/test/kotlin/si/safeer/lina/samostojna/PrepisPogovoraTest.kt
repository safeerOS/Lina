package si.safeer.lina.samostojna

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Naloga 17 (telefon): prepis pogovora (govorec, cas, besedilo) v zapisu klica in v sinhronizaciji z racunalnikom. */
class PrepisPogovoraTest {
    private val json = Json { encodeDefaults = true }

    @Test
    fun `izmenjave so v vrstnem redu, z govorcem in casom prvega odlomka, odlomki istega govorca se zdruzijo`() {
        var ura = 1_000L
        val s = SejaKlica(1_000L, "+99955501001") { ura }
        s.dodajIzhod("Dober dan. ")
        ura = 1_500L
        s.dodajIzhod("Pogovor se zapisuje.")
        s.konecObrata()
        ura = 4_000L
        s.dodajVhod("Tukaj Ana")
        ura = 4_200L
        s.dodajVhod(" Novak.")
        ura = 6_000L
        s.dodajIzhod("Hvala, Ana.")
        val z = s.zakljuci(9_000L)
        assertEquals(
            listOf(
                IzmenjavaKlica("lina", 1_000L, "Dober dan. Pogovor se zapisuje."),
                IzmenjavaKlica("klicatelj", 4_000L, "Tukaj Ana Novak."),
                IzmenjavaKlica("lina", 6_000L, "Hvala, Ana."),
            ),
            z.prepisPogovora,
        )
        assertFalse(z.prepisOkrnjen)
        // id ostane enak v zapisu in v projekciji za racunalnik (zapis je nespremenljiv)
        assertEquals(z.id, z.zaSinhronizacijo().id)
        assertEquals(z.prepisPogovora, z.zaSinhronizacijo().prepisPogovora)
    }

    @Test
    fun `nov obrat istega govorca po koncu obrata je nova izmenjava`() {
        val s = SejaKlica(0L, "+99955501001") { 7L }
        s.dodajIzhod("Prvi stavek.")
        s.konecObrata()
        s.dodajIzhod("Drugi obrat.")
        assertEquals(2, s.zakljuci(10L).prepisPogovora.size)
    }

    @Test
    fun `odlomka brez presledka med stavkoma loci presledek`() {
        val s = SejaKlica(0L, "+99955501001") { 1L }
        s.dodajVhod("slovensko.")
        s.dodajVhod("Pa ni")
        s.dodajVhod(" res.")
        assertEquals("slovensko. Pa ni res.", s.zakljuci(2L).prepisPogovora.single().besedilo)
    }

    @Test
    fun `prepis je ze med klicem omejen in oznacen kot okrnjen`() {
        val s = SejaKlica(0L, "+99955501001") { 1L }
        repeat(SejaKlica.MEJA_IZMENJAV + 50) { i ->
            if (i % 2 == 0) s.dodajVhod("klicatelj ${"x".repeat(300)}") else s.dodajIzhod("lina ${"y".repeat(300)}")
            s.konecObrata()
        }
        val z = s.zakljuci(2L)
        assertTrue(z.prepisOkrnjen)
        assertTrue(z.prepisPogovora.size <= SejaKlica.MEJA_IZMENJAV)
        assertTrue(z.prepisPogovora.sumOf { it.besedilo.length } <= SejaKlica.MEJA_PREPISA_ZNAKOV)
        assertTrue(z.prepisPogovora.all { it.besedilo.length <= SejaKlica.MEJA_IZMENJAVE_ZNAKOV })
    }

    @Test
    fun `prepis, ki ga seja ne okrni dodatno, gre na racunalnik cel (meji v znakih in bajtih sta usklajeni)`() {
        val s = SejaKlica(0L, "+99955501001") { 1_700_000_000_000L }
        var i = 0
        while (i < SejaKlica.MEJA_IZMENJAV) {
            if (i % 2 == 0) s.dodajVhod("Dober dan, želim naročiti štiri hrastove mize za čajnico.") else s.dodajIzhod("Zapisala sem, še kaj?")
            s.konecObrata(); i++
        }
        val z = s.zakljuci(1_700_000_000_001L)
        val p = z.zaSinhronizacijo()
        assertEquals(z.prepisPogovora, p.prepisPogovora)
        assertEquals(z.prepisOkrnjen, p.prepisOkrnjen)
        assertTrue(json.encodeToString(p.prepisPogovora).toByteArray(Charsets.UTF_8).size <= MEJA_PREPISA_SINHRON_B)
    }

    @Test
    fun `dolg izrek se razdeli na izmenjave do meje znakov`() {
        val s = SejaKlica(0L, "+99955501001") { 1L }
        s.dodajVhod("a".repeat(SejaKlica.MEJA_IZMENJAVE_ZNAKOV + 10))
        val p = s.zakljuci(2L).prepisPogovora
        assertEquals(2, p.size)
        assertTrue(p.all { it.govorec == "klicatelj" && it.besedilo.length <= SejaKlica.MEJA_IZMENJAVE_ZNAKOV })
    }

    @Test
    fun `projekcija za racunalnik ostane v mejah bajtov tudi z vecbajtnimi znaki in iz shrambe`() {
        // Zapis iz shrambe (npr. star ali rocno spremenjen) z vec kot dovoljeno: projekcija ga omeji.
        val izmenjave = (0 until 500).map { IzmenjavaKlica(if (it % 2 == 0) "klicatelj" else "lina", it.toLong(), "č".repeat(3000)) } +
            IzmenjavaKlica("napadalec", 1L, "neznan govorec")
        val z = ZapisKlica(id = "k-1", casZacetka = 1L, stevilka = "+99955501001", trajanjeS = 1, povzetek = "p", prepisPogovora = izmenjave)
        val p = z.zaSinhronizacijo()
        assertTrue(p.prepisOkrnjen)
        assertTrue(json.encodeToString(p.prepisPogovora).toByteArray(Charsets.UTF_8).size <= MEJA_PREPISA_SINHRON_B)
        assertTrue(p.prepisPogovora.all { it.besedilo.length <= SejaKlica.MEJA_IZMENJAVE_ZNAKOV && it.govorec in setOf("klicatelj", "lina") })
        // Cel zapis gre v en odgovor racunalnika (MEJA_ODGOVORA_B 48 KiB v sinhron-telefon.server.ts)
        assertTrue(json.encodeToString(p).toByteArray(Charsets.UTF_8).size < 48 * 1024)
        // Deterministicno: ista projekcija ob vsakem klicu (nalaganje iz shrambe primerja projekcije)
        assertEquals(p, z.zaSinhronizacijo())
    }

    @Test
    fun `klicatelj omeni ceno v prepisu - zapis klica se ne izgubi`() {
        val s = SejaKlica(0L, "+99955501001") { 1L }
        s.dodajVhod("Cena je 20 evrov, obljubim, da placam.")
        s.konecObrata()
        s.dodajIzhod("Zapisala sem.")
        val d = DnevnikKlicev(PomnilniskaShramba())
        val z = s.zakljuci(2L)
        assertTrue(d.dodaj(z))
        assertEquals(z.prepisPogovora, d.cakajociZaSinhronizacijo().single().prepisPogovora)
    }

    @Test
    fun `stari zapisi brez prepisa se nalozijo brez prepisa shrambe in brez izmisljenega prepisa`() {
        val staro = """{"verzija":1,"zapisi":[{"id":"star-1","casZacetka":1500,"stevilka":"+99955501001","trajanjeS":25,"nujno":false,"povzetek":"Star","prepis":"","nacin":"osebna"}],""" +
            """"cakajoci":[{"id":"star-1","casZacetka":1500,"stevilka":"+99955501001","trajanjeS":25,"nujno":false,"povzetek":"Star","nacin":"osebna"}]}"""
        val shramba = PomnilniskaShramba(staro)
        val d = DnevnikKlicev(shramba)
        assertEquals(staro, shramba.preberi())
        assertTrue(d.cakajociZaSinhronizacijo().single().prepisPogovora.isEmpty())
        assertFalse(d.cakajociZaSinhronizacijo().single().prepisOkrnjen)
    }

    @Test
    fun `zapis z racunalnika obdrzi prepis (ponovna namestitev telefona)`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        val p = ZapisKlicaSinhronizacija(
            id = "rac-1", casZacetka = 5L, stevilka = "+99955501001", trajanjeS = 3, nujno = false, povzetek = "p", nacin = NacinKlica.OSEBNA,
            prepisPogovora = listOf(IzmenjavaKlica("klicatelj", 5L, "Halo.")), prepisOkrnjen = true,
        )
        assertEquals(1, d.sprejmiIzRacunalnika(listOf(p)))
        val z = d.seznam().single()
        assertEquals(p.prepisPogovora, z.prepisPogovora)
        assertTrue(z.prepisOkrnjen)
        assertTrue(d.cakajociZaSinhronizacijo().isEmpty())
    }

    @Test
    fun `pozdrav klica vedno pove, da se pogovor zapisuje, in nikoli, da se snema`() {
        val zdaj = java.time.ZonedDateTime.of(2026, 11, 25, 12, 0, 0, 0, java.time.ZoneId.of("Europe/Ljubljana"))
        for ((ime, toz) in listOf("" to "", "Ana Novak" to "", "Miha" to "Miho")) {
            val n = SistemskoNavodilo.zgradiZaKlic(zdaj, ime, toz)
            assertTrue(n.contains("Pogovor se zapisuje."), "manjka napoved za ime '$ime'")
            assertFalse(n.contains("snema"), "osebni nacin ne sme napovedati snemanja")
        }
    }
}
