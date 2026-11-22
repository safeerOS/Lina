package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
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
        assertEquals("Izboljsaj zvok klica", (odgovor as Odgovor.NalogaRacunalniku).besedilo)
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
}
