package si.safeer.lina.samostojna

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Slepi pregled 17t (slepi-17t/NAJDBE.md): prepis klica v sinhronizaciji telefon -> racunalnik. Preizkusi uporabljajo samo API,
 * ki je obstajal pred popravki, zato pred popravkom padejo na trditvi (ne pri prevajanju).
 */
class NajdbeSlepi17tTest {
    private val json = Json { encodeDefaults = true }
    private val ODGOVOR_STAR = """{"rev":1,"klici":[]}"""
    private val ODGOVOR_NOV = """{"rev":2,"klici":[],"zmoznosti":["prepis-v1","izbris-v1"]}"""

    private fun zapisSPrepisom(id: String = "klic-1-1", cas: Long = 1_700_000_000_000L, nacin: NacinKlica = NacinKlica.OSEBNA) = ZapisKlica(
        id = id, casZacetka = cas, stevilka = "+99955501001", trajanjeS = 30, povzetek = "Povratni klic", nacin = nacin,
        prepisPogovora = listOf(IzmenjavaKlica("klicatelj", cas, "Tukaj Miha Horvat."), IzmenjavaKlica("lina", cas + 1, "Zapisala sem.")),
    )

    // N1: racunalnik 0.2.13 polje prepisPogovora tiho zavrze; telefon zapisa s prepisom ne sme za vedno potrditi.
    @Test
    fun `N1 - star racunalnik brez zmoznosti prepisa - zapis s prepisom gre po posodobitvi racunalnika znova, tudi po ponovnem zagonu`() {
        val shramba = PomnilniskaShramba()
        val z = zapisSPrepisom()
        assertTrue(DnevnikKlicev(shramba).dodaj(z))
        val reviziji = PomnilniskaShramba()
        val poslano = mutableListOf<String>()
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_STAR }))
        assertEquals(1, poslano.size, "star racunalnik: en krog, brez ponavljanja istega zapisa")
        // Ponovni zagon aplikacije, nato racunalnik po posodobitvi (javi zmoznost prepis-v1).
        val d2 = DnevnikKlicev(shramba)
        poslano.clear()
        assertTrue(SinhronLine.izmenjaj(d2, reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertTrue(poslano.any { it.contains("\"${z.id}\"") && it.contains("Tukaj Miha Horvat.") }, "zapis s prepisom ni bil poslan znova: $poslano")
        // Ko racunalnik prepis sprejme, se ne poslje vec.
        poslano.clear()
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertFalse(poslano.any { it.contains("\"${z.id}\"") }, "sprejet prepis se je poslal se enkrat")
    }

    @Test
    fun `N1 - nov racunalnik z zmoznostjo prepisa - zapis se potrdi takoj in se ne poslje znova`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba)
        assertTrue(d.dodaj(zapisSPrepisom()))
        val reviziji = PomnilniskaShramba()
        assertTrue(SinhronLine.izmenjaj(d, reviziji, poslji = { ODGOVOR_NOV }))
        val poslano = mutableListOf<String>()
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertFalse(poslano.any { it.contains("klic-1-1") })
    }

    // N3: izbris na telefonu se sinhronizira kot izbris in racunalnik ga ne more vrniti.
    @Test
    fun `N3 - izbrisan klic gre racunalniku kot izbris in se ob novi epohi ne vrne na telefon`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba)
        val z = zapisSPrepisom()
        assertTrue(d.dodaj(z))
        val reviziji = PomnilniskaShramba()
        assertTrue(SinhronLine.izmenjaj(d, reviziji, poslji = { ODGOVOR_STAR }))
        assertTrue(d.izbrisi(z.id, potrditevUporabnika = true))
        val nazaj = z.zaSinhronizacijo()
        val poslano = mutableListOf<String>()
        // Racunalnik je bil ponastavljen (nova epoha) in vrne vse, tudi izbrisani klic.
        val odgovor = """{"epoha":"00112233aabbccdd","rev":5,"klici":[${json.encodeToString(nazaj)}]}"""
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); odgovor }))
        assertTrue(poslano.first().contains("\"izbrisani\":[\"${z.id}\"]"), "izbris ni bil poslan: ${poslano.first()}")
        assertTrue(DnevnikKlicev(shramba).seznam().none { it.id == z.id }, "izbrisan klic (s prepisom) se je vrnil na telefon")
    }

    @Test
    fun `N3 - izbris ostane v vrsti, dokler ga racunalnik ne potrdi`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba)
        val z = zapisSPrepisom()
        assertTrue(d.dodaj(z))
        assertTrue(d.izbrisi(z.id, potrditevUporabnika = true))
        val reviziji = PomnilniskaShramba()
        val poslano = mutableListOf<String>()
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_STAR }))
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertEquals(listOf(true, true, false), poslano.map { it.contains("\"izbrisani\":[\"${z.id}\"]") })
    }

    // N4: rok hrambe prepisa (osebni do izbrisa, podjetniski 90 dni) in omejitev rasti dnevnika.
    @Test
    fun `N4 - podjetniski prepis starejsi od 90 dni se ne hrani, osebni ostane`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        val star = 1_000L // 1970: davno cez rok
        val podjetje = zapisSPrepisom("rac-p", star, NacinKlica.PODJETJE).zaSinhronizacijo()
        val osebni = zapisSPrepisom("rac-o", star, NacinKlica.OSEBNA).zaSinhronizacijo()
        assertEquals(2, d.sprejmiIzRacunalnika(listOf(podjetje, osebni)))
        assertTrue(d.seznam().single { it.id == "rac-p" }.prepisPogovora.isEmpty(), "podjetniski prepis po roku ostal")
        assertEquals(2, d.seznam().single { it.id == "rac-o" }.prepisPogovora.size, "osebni prepis se hrani do izbrisa")
    }

    @Test
    fun `N4 - dnevnik na telefonu ne raste cez 1000 zapisov, cakajoci v vrsti pa se ne izgubijo`() {
        val zapisi = (1..1000).joinToString(",") { """{"id":"k-$it","casZacetka":$it,"stevilka":"+99955501001","trajanjeS":1,"povzetek":"p"}""" }
        val shramba = PomnilniskaShramba("""{"verzija":1,"zapisi":[$zapisi],"cakajoci":[]}""")
        val d = DnevnikKlicev(shramba)
        assertEquals(1000, d.seznam().size)
        assertTrue(d.dodaj(zapisSPrepisom("nov", 5_000L)))
        val ostali = DnevnikKlicev(shramba).seznam()
        assertEquals(1000, ostali.size, "dnevnik je presegel mejo")
        assertTrue(ostali.any { it.id == "nov" } && ostali.none { it.id == "k-1" }, "odstraniti se mora najstarejsi, nov ostane")
        assertEquals(listOf("nov"), DnevnikKlicev(shramba).cakajociZaSinhronizacijo().map { it.id })
    }

    // N2: meja celega zapisa v BAJTIH tudi za kontrolne znake (JSON \u0001 = 6 B).
    @Test
    fun `N2 - zapis s polji polnimi kontrolnih znakov in narekovajev ostane pod 46 KiB`() {
        for (k in listOf("\u0001", "\"", "\u001f")) {
            val z = ZapisKlica(
                id = "k-n2", casZacetka = 1L, stevilka = "+99955501001", trajanjeS = 1, povzetek = k.repeat(2000),
                klicatelj = k.repeat(240), podjetje = k.repeat(240), sporocilo = k.repeat(2000), sporociloDobesedno = k.repeat(6000),
                brezSporocilaRazlog = k.repeat(2000), prepisPogovora = listOf(IzmenjavaKlica("klicatelj", 1L, k.repeat(2000))),
            )
            val b = json.encodeToString(z.zaSinhronizacijo()).toByteArray(Charsets.UTF_8).size
            assertTrue(b <= MEJA_ZAPISA_SINHRON_B, "zapis z '${k.codePointAt(0)}' ima $b B")
        }
    }

    // N8: meja seje steje bajte (UTF-8 + pobeg JSON), zato je seja ne okrni drugace kot projekcija za racunalnik.
    @Test
    fun `N8 - prepis s sumniki, ki ga seja ne okrni dodatno, gre na racunalnik cel`() {
        val s = SejaKlica(0L, "+99955501001") { 1_700_000_000_000L }
        repeat(SejaKlica.MEJA_IZMENJAV) { i ->
            if (i % 2 == 0) s.dodajVhod("č".repeat(50)) else s.dodajIzhod("\"ž\"".repeat(10))
            s.konecObrata()
        }
        val z = s.zakljuci(1_700_000_000_001L)
        val p = z.zaSinhronizacijo()
        assertEquals(z.prepisPogovora.size, p.prepisPogovora.size, "projekcija je odrezala konec, ki ga telefon hrani")
        assertEquals(z.prepisOkrnjen, p.prepisOkrnjen)
    }

    // N9: vhod in izhod seje sta omejena ze med klicem.
    @Test
    fun `N9 - dobesedni vhod in izhod ne rasteta brez meje med klicem`() {
        val s = SejaKlica(0L, "+99955501001") { 1L }
        repeat(50) { s.dodajVhod("a".repeat(10_000)); s.dodajIzhod("b".repeat(10_000)) }
        for (ime in listOf("vhod", "izhod")) {
            val f = SejaKlica::class.java.getDeclaredField(ime).apply { isAccessible = true }
            val dolzina = (f.get(s) as StringBuilder).length
            assertTrue(dolzina <= 2 * SejaKlica.MEJA_DOBESEDNO, "$ime ima $dolzina znakov")
        }
        val z = s.zakljuci(2L)
        assertEquals(SejaKlica.MEJA_DOBESEDNO, z.sporociloDobesedno.length)
        assertEquals(SejaKlica.MEJA_DOBESEDNO, z.linaDobesedno.length)
    }

    // N7 (sorodni rezi): meja sporocila in dobesednega ne prereze nadomestnega para.
    @Test
    fun `N7 - meja sporocila in dobesednega ne pusti osamljenega nadomestnega znaka`() {
        val s = SejaKlica(0L, "+99955501001") { 1L }
        s.shraniSporocilo("Ana", null, null, "a".repeat(SejaKlica.MEJA_SPOROCILA - 1) + "😀")
        s.dodajVhod("b".repeat(SejaKlica.MEJA_DOBESEDNO - 1) + "😀")
        val z = s.zakljuci(2L)
        for (t in listOf(z.sporocilo, z.sporociloDobesedno)) {
            assertFalse(t.indices.any { i -> Character.isHighSurrogate(t[i]) && (i + 1 >= t.length || !Character.isLowSurrogate(t[i + 1])) }, "osamljen visoki nadomestni znak")
        }
    }

    // N11: prepleteni odlomki obeh govorcev v istem obratu ne razbijejo prepisa.
    @Test
    fun `N11 - prepleteni odlomki v istem obratu so ena izmenjava na govorca`() {
        var ura = 10L
        val s = SejaKlica(0L, "+99955501001") { ura++ }
        s.dodajVhod("Tukaj Ana")
        s.dodajIzhod("Dober")
        s.dodajVhod(" Novak.")
        s.dodajIzhod(" dan.")
        s.konecObrata()
        s.dodajVhod("Hvala.")
        assertEquals(
            listOf(IzmenjavaKlica("klicatelj", 10L, "Tukaj Ana Novak."), IzmenjavaKlica("lina", 11L, "Dober dan."), IzmenjavaKlica("klicatelj", 12L, "Hvala.")),
            s.zakljuci(20L).prepisPogovora,
        )
    }

    @Test
    fun `N11 - po prekinitvi Line gre nov odgovor v novo izmenjavo, ne k prekinjenemu`() {
        val s = SejaKlica(0L, "+99955501001") { 1L }
        s.dodajIzhod("Zapisala sem vase")
        s.prekinjenObrat()
        s.dodajVhod("Pocakajte.")
        s.dodajIzhod("Seveda.")
        assertEquals(listOf("lina", "klicatelj", "lina"), s.zakljuci(2L).prepisPogovora.map { it.govorec })
    }

}
