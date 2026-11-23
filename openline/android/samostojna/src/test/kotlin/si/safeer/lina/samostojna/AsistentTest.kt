package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AsistentTest {

    class LazenPrenos : Prenos {
        var naslednjiTeloOdgovora = ""
        var kodaOdgovora = 200
        var zadnjiPostTelo = ""

        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
            zadnjiPostTelo = telo
            return OdgovorHttp(kodaOdgovora, naslednjiTeloOdgovora)
        }
    }

    private fun ustvariOdjemalca(prenos: LazenPrenos): GeminiOdjemalec {
        val shramba = PomnilniskiShranjevalnik()
        shramba.shrani(KljucGemini("test-kljuc"))
        return GeminiOdjemalec(shramba, prenos = prenos)
    }

    private fun formatirajOdgovor(besedilo: String): String {
        return """{"candidates":[{"content":{"parts":[{"text":"$besedilo"}]}}]}"""
    }

    @Test
    fun `povej - obicajno besedilo`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Nekaj besedila")
        val asistent = Asistent(ustvariOdjemalca(prenos), "Sistemsko")

        val odgovor = asistent.povej("Zdravo")
        assertTrue(odgovor is Odgovor.Besedilo)
        assertEquals("Nekaj besedila", (odgovor as Odgovor.Besedilo).besedilo)
        assertTrue(prenos.zadnjiPostTelo.contains("Sistemsko"))
        assertTrue(prenos.zadnjiPostTelo.contains("Zdravo"))
    }

    @Test
    fun `povej - prazen vnos`() {
        val prenos = LazenPrenos()
        val asistent = Asistent(ustvariOdjemalca(prenos), "Sistemsko")
        val odgovor = asistent.povej("   ")
        assertTrue(odgovor is Odgovor.Besedilo)
        assertEquals("", (odgovor as Odgovor.Besedilo).besedilo)
        assertEquals("", prenos.zadnjiPostTelo)
    }

    @Test
    fun `povej - zgodovina se skrajsa`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("A")
        val asistent = Asistent(ustvariOdjemalca(prenos), "Sistemsko", najvecSporocil = 2)
        
        asistent.povej("Ena")
        
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("B")
        asistent.povej("Dva")
        
        // Zgodovina poslana odjemalcu mora biti najvec velikosti 2.
        // Ker prenos.zadnjiPostTelo vsebuje JSON zahtevo, preverimo da vsebuje "A" in "Dva", a ne "Ena".
        assertTrue(prenos.zadnjiPostTelo.contains("A"))
        assertTrue(prenos.zadnjiPostTelo.contains("Dva"))
        assertTrue(!prenos.zadnjiPostTelo.contains("Ena"))
    }

    @Test
    fun `povej - ukaz za zapisek`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Tukaj je: \\n[[zapisek: Kupi mleko]]\\nIn se nekaj.")
        val asistent = Asistent(ustvariOdjemalca(prenos), "")

        val odgovor = asistent.povej("Dodaj")
        assertTrue(odgovor is Odgovor.Zapisek)
        assertEquals("Kupi mleko", (odgovor as Odgovor.Zapisek).besedilo)
    }

    @Test
    fun `povej - ukaz za opomnik z veljavnim casom`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("[[opomnik: 2026-11-18T10:00:00Z | Poklici mamo]]")
        val asistent = Asistent(ustvariOdjemalca(prenos), "")

        val odgovor = asistent.povej("Opomni me")
        assertTrue(odgovor is Odgovor.Opomnik)
        val op = odgovor as Odgovor.Opomnik
        assertEquals("Poklici mamo", op.besedilo)
        assertEquals("2026-11-18T10:00:00Z", op.cas)
    }

    @Test
    fun `povej - neveljaven cas opomnika postane navadno besedilo`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("[[opomnik: jutri | Poklici]]")
        val asistent = Asistent(ustvariOdjemalca(prenos), "")

        val odgovor = asistent.povej("Opomni me")
        assertTrue(odgovor is Odgovor.Besedilo)
        assertEquals("[[opomnik: jutri | Poklici]]", (odgovor as Odgovor.Besedilo).besedilo)
    }

    @Test
    fun `povej - prazen besedilo opomnika postane navadno besedilo`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("[[opomnik: 2026-11-18T10:00:00Z | ]]")
        val asistent = Asistent(ustvariOdjemalca(prenos), "")

        val odgovor = asistent.povej("Opomni me")
        assertTrue(odgovor is Odgovor.Besedilo)
        assertEquals("[[opomnik: 2026-11-18T10:00:00Z | ]]", (odgovor as Odgovor.Besedilo).besedilo)
    }

    @Test
    fun `povej - napaka odjemalca`() {
        val prenos = LazenPrenos()
        prenos.kodaOdgovora = 500
        val asistent = Asistent(ustvariOdjemalca(prenos), "")

        val odgovor = asistent.povej("Napaka")
        assertTrue(odgovor is Odgovor.Napaka)
        assertEquals("Neveljaven JSON", (odgovor as Odgovor.Napaka).sporocilo)
    }

    @Test
    fun `vprasanje o nalogi ne poslje nove naloge racunalniku`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Predam.\\n[[racunalnik: Preveri posodobitev]]")
        val asistent = Asistent(ustvariOdjemalca(prenos), "", racunalnikPovezan = { true })
        assertTrue(asistent.povej("Predaj nalogo racunalniku") is Odgovor.NalogaRacunalniku)
        asistent.nalogaPredana("Preveri posodobitev")
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Takoj.\\n[[racunalnik: Izvedi celovit pregled sistema]]")
        val odgovor = asistent.povej("Ne znas opisati naloge katero si dala racunalniku?")
        assertTrue(odgovor is Odgovor.Besedilo, "vprasanje o nalogi mora vrniti razlago")
        assertTrue((odgovor as Odgovor.Besedilo).besedilo.contains("Preveri posodobitev"))
        assertFalse(odgovor.besedilo.contains("celovit pregled"))
        assertTrue(asistent.povej("Predaj se eno nalogo racunalniku") is Odgovor.NalogaRacunalniku)
        assertTrue(asistent.povej("Lahko predas novo nalogo racunalniku?") is Odgovor.NalogaRacunalniku)
    }

    @Test
    fun `vrstica dogodek postane predlog dogodka, neveljavni se ne zapisejo`() {
        val prenos = LazenPrenos()
        val cez = java.time.ZonedDateTime.now().plusDays(1).withNano(0).toString()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Predlagam termin.\\n[[dogodek: $cez|45|Sestanek z Ano]]")
        val d = Asistent(ustvariOdjemalca(prenos), "").povej("Dogovorila sva se za jutri")
        assertTrue(d is Odgovor.NoviDogodek)
        d as Odgovor.NoviDogodek
        assertEquals("Sestanek z Ano", d.naslov)
        assertEquals(45 * 60_000L, d.konecMs - d.zacetekMs)
        val zdaj = System.currentTimeMillis()
        assertEquals(null, DogodekKoledarZapis.razclenji("2020-01-01T10:00:00+01:00|60|Staro", zdaj))
        assertEquals(null, DogodekKoledarZapis.razclenji("$cez|2|Prekratko", zdaj))
        assertEquals(null, DogodekKoledarZapis.razclenji("$cez|60|  ", zdaj))
        assertEquals(null, DogodekKoledarZapis.razclenji("$cez|60", zdaj))
    }

    @Test
    fun `vrstica budilka postane predlog budilke, opomnik ostane opomnik`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Predlagam budilko.\\n[[budilka: 06:00|Sluzba|1,2,3,4,5]]")
        val b = Asistent(ustvariOdjemalca(prenos), "").povej("Nastavi budilko ob 6 zjutraj za v sluzbo")
        assertTrue(b is Odgovor.NovaBudilka)
        b as Odgovor.NovaBudilka
        assertEquals(6, b.ura)
        assertEquals(0, b.minuta)
        assertEquals("Sluzba", b.oznaka)
        assertEquals(listOf(1, 2, 3, 4, 5), b.dnevi)
        val enkratna = BudilkaZapis.razclenji("7:30")!!
        assertEquals(7, enkratna.ura)
        assertEquals(30, enkratna.minuta)
        assertEquals(emptyList<Int>(), enkratna.dnevi)
        assertEquals("", enkratna.oznaka)
        assertEquals(listOf(6, 7), BudilkaZapis.razclenji("09.15|Vikend|7,6,7")!!.dnevi)
        assertEquals(null, BudilkaZapis.razclenji("24:00"))
        assertEquals(null, BudilkaZapis.razclenji("6:60"))
        assertEquals(null, BudilkaZapis.razclenji("jutri ob 6"))
        assertEquals(null, BudilkaZapis.razclenji("06:00|x|0"))
        assertEquals(null, BudilkaZapis.razclenji("06:00|x|8"))
        assertEquals(null, BudilkaZapis.razclenji("06:00|x|pon"))
        assertTrue(SistemskoNavodilo.zgradi(java.time.ZonedDateTime.now()).contains("[[budilka:"))
    }

    @Test
    fun `povej - SAFETY zavrnitev`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = """{"candidates":[{"finishReason":"SAFETY"}]}"""
        val asistent = Asistent(ustvariOdjemalca(prenos), "")

        val odgovor = asistent.povej("Naredi nekaj slabega")
        assertTrue(odgovor is Odgovor.Napaka)
        assertEquals("Zavrnjeno: SAFETY", (odgovor as Odgovor.Napaka).sporocilo)
    }

    @Test
    fun `povezan racunalnik - vrstica racunalnik postane naloga, navodilo to pove modelu`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Predam.\\n[[racunalnik: Izboljsaj zvok klica]]")
        val asistent = Asistent(ustvariOdjemalca(prenos), "", racunalnikPovezan = { true })
        val odgovor = asistent.povej("Predaj nalogo racunalniku")
        assertTrue(odgovor is Odgovor.NalogaRacunalniku)
        // samostojna naloga (23. 11. 2026): besedilo naloge ostane na zacetku, priloge in omejitve so dodane za njim
        val nal = (odgovor as Odgovor.NalogaRacunalniku).besedilo
        assertTrue(nal.startsWith("Izboljsaj zvok klica\n\n") && nal.endsWith(SamostojnaNaloga.OMEJITVE), nal)
        assertTrue(prenos.zadnjiPostTelo.contains("[[racunalnik:"), "navodilo mora modelu povedati, kako preda nalogo")
        assertTrue(prenos.zadnjiPostTelo.contains("Nikoli ne trdi, da nimas dostopa"))
    }

    @Test
    fun `racunalnik ni povezan - vrstica ni naloga, navodilo pove resnico`() {
        val prenos = LazenPrenos()
        prenos.naslednjiTeloOdgovora = formatirajOdgovor("Ne morem.\\n[[racunalnik: nekaj]]")
        val asistent = Asistent(ustvariOdjemalca(prenos), "")
        val odgovor = asistent.povej("Predaj nalogo racunalniku")
        assertTrue(odgovor is Odgovor.Besedilo)
        assertTrue(!(odgovor as Odgovor.Besedilo).besedilo.contains("[["), "vrstice orodja uporabnik ne vidi")
        assertTrue(prenos.zadnjiPostTelo.contains("Racunalnik ni povezan"))
    }

    @Test
    fun `povej - model zahteva koledar, izvede se KoledarIzvajalec in rezultat gre modelu kot podatek`() {
        val zona = java.time.ZoneId.of("Europe/Ljubljana")
        val vir = object : KoledarOrodje {
            override fun dogodki(odMs: Long, doMs: Long) = listOf(
                DogodekKoledarja("Zobozdravnik", java.time.ZonedDateTime.of(2026, 12, 1, 9, 0, 0, 0, zona).toInstant().toEpochMilli(),
                    java.time.ZonedDateTime.of(2026, 12, 1, 10, 0, 0, 0, zona).toInstant().toEpochMilli(), false),
            )
        }
        val videnaSporocila = mutableListOf<List<Sporocilo>>()
        var krog = 0
        val model = object : PonudnikOdjemalec {
            override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
                videnaSporocila += zgodovina.toList()
                return if (krog++ == 0) Rezultat.Besedilo("[[koledar: 2026-12-01]]") else Rezultat.Besedilo("Ob 9.00 imate zobozdravnika.")
            }
        }
        val a = Asistent(model, "S", koledar = KoledarIzvajalec(vir) { java.time.ZonedDateTime.of(2026, 11, 22, 12, 0, 0, 0, zona) })
        val odgovor = a.povej("Kaj imam 1. decembra?")
        assertEquals("Ob 9.00 imate zobozdravnika.", (odgovor as Odgovor.Besedilo).besedilo)
        val povratno = videnaSporocila.last().last().besedilo
        assertTrue(povratno.contains("Zobozdravnik") && povratno.contains("<<<") && povratno.contains("koledarja"), povratno)
    }
}
