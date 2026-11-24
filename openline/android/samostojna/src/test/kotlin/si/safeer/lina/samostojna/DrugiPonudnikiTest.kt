package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class DrugiPonudnikiTest {
    class Lazen(private val odg: List<OdgovorHttp>) : Prenos {
        var klici = 0
        var url = ""
        var glave = mapOf<String, String>()
        var telo = ""
        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
            this.url = url; this.glave = glave; this.telo = telo
            return odg[minOf(klici++, odg.size - 1)]
        }
    }

    private fun shramba(k: String) = PomnilniskiShranjevalnik().also { it.shrani(KljucGemini(k)) }

    @Test
    fun `OpenAI poslje chat completions z Bearer in vlogami`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"choices":[{"message":{"content":"zivjo"},"finish_reason":"stop"}]}""")))
        val r = ustvariOdjemalca(Ponudnik.OPENAI, shramba("sk-tajno-123"), p).poslji(listOf(Sporocilo("user", "a"), Sporocilo("model", "b")), "navodilo")
        assertEquals("zivjo", (r as Rezultat.Besedilo).besedilo)
        assertEquals("https://api.openai.com/v1/chat/completions", p.url)
        assertEquals("Bearer sk-tajno-123", p.glave["Authorization"])
        assertTrue(p.telo.contains("\"role\":\"system\"") && p.telo.contains("\"role\":\"assistant\""))
        assertFalse(p.telo.contains("sk-tajno-123"), "kljuc ne sme v telo")
    }

    @Test
    fun `Grok gre na xAI in ne na OpenAI`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"choices":[{"message":{"content":"ok"}}]}""")))
        ustvariOdjemalca(Ponudnik.GROK, shramba("xai-123"), p).poslji(emptyList(), "")
        assertEquals("https://api.x.ai/v1/chat/completions", p.url)
    }

    @Test
    fun `OpenRouter gre na openrouter ai, prepove hrambo podatkov in ima model s predpono`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"choices":[{"message":{"content":"ok"}}]}""")))
        val r = ustvariOdjemalca(Ponudnik.OPENROUTER, shramba("sk-or-1"), p).poslji(listOf(Sporocilo("user", "a")), "")
        assertEquals("ok", (r as Rezultat.Besedilo).besedilo)
        assertEquals("https://openrouter.ai/api/v1/chat/completions", p.url)
        assertEquals("Bearer sk-or-1", p.glave["Authorization"])
        assertTrue(p.telo.contains("\"data_collection\":\"deny\"") && p.telo.contains("\"model\":\"openai/gpt-4o\""), p.telo)
        assertEquals(Ponudnik.OPENROUTER, Ponudnik.izId("openrouter"))
    }

    @Test
    fun `OpenAI nima polja OpenRouter`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"choices":[{"message":{"content":"ok"}}]}""")))
        ustvariOdjemalca(Ponudnik.OPENAI, shramba("sk-1"), p).poslji(emptyList(), "")
        assertFalse(p.telo.contains("data_collection")); assertFalse(p.glave.containsKey("X-Title"))
    }

    @Test
    fun `Claude poslje x-api-key in verzijo, system loceno`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"content":[{"type":"text","text":"he"},{"type":"text","text":"j"}]}""")))
        val r = ustvariOdjemalca(Ponudnik.CLAUDE, shramba("sk-ant-1"), p).poslji(listOf(Sporocilo("user", "a")), "nav")
        assertEquals("hej", (r as Rezultat.Besedilo).besedilo)
        assertEquals("https://api.anthropic.com/v1/messages", p.url)
        assertEquals("sk-ant-1", p.glave["x-api-key"])
        assertEquals("2023-06-01", p.glave["anthropic-version"])
        assertTrue(p.telo.contains("\"system\":\"nav\"") && p.telo.contains("\"max_tokens\":1024"))
    }

    @Test
    fun `napaka ponudnika ne vsebuje kljuca in kod 401 ni uspeh`() {
        val p = Lazen(listOf(OdgovorHttp(401, """{"error":{"message":"Incorrect API key"}}""")))
        val r = ustvariOdjemalca(Ponudnik.OPENAI, shramba("sk-tajno-123"), p).poslji(emptyList(), "")
        assertTrue(r is Rezultat.Napaka)
        assertFalse((r as Rezultat.Napaka).sporocilo.contains("sk-tajno-123"))
        assertEquals(1, p.klici, "401 se ne ponavlja")
    }

    @Test
    fun `429 se ponovi, uspeh pri drugem poskusu`() {
        val p = Lazen(listOf(OdgovorHttp(429, "{}"), OdgovorHttp(200, """{"choices":[{"message":{"content":"ok2"}}]}""")))
        val o = OpenAiOdjemalec(shramba("k-123456789012345678901"), prenos = p)
        o.spanje = {}
        assertEquals("ok2", (o.poslji(emptyList(), "") as Rezultat.Besedilo).besedilo)
        assertEquals(2, p.klici)
    }

    @Test
    fun `200 s telesom napake je napaka, ne besedilo`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"error":{"message":"quota"}}""")))
        val r = ustvariOdjemalca(Ponudnik.CLAUDE, shramba("k"), p).poslji(emptyList(), "")
        assertTrue(r is Rezultat.Napaka)
    }

    @Test
    fun `brez kljuca ni zahteve`() {
        val p = Lazen(listOf(OdgovorHttp(200, "{}")))
        val r = ustvariOdjemalca(Ponudnik.OPENAI, PomnilniskiShranjevalnik(), p).poslji(emptyList(), "")
        assertTrue(r is Rezultat.Napaka)
        assertEquals(0, p.klici)
    }

    // ---- Brezplacni modeli OpenRouter samo za asistentko (lastnik 24. 11. 2026, B2, B3, B6, B8, C6, C8) ----

    private fun openRouter(p: Lazen, model: String, dovoli: Boolean = false, rezerva: String? = null) =
        OpenAiOdjemalec(shramba("sk-or-1"), "https://openrouter.ai/api", model, p, openRouter = true, dovoliBrezplacne = dovoli, rezervniBrezplacni = rezerva).also { it.spanje = {} }

    @Test
    fun `deny izpade samo z dovoljenjem asistentke in tocnim free modelom`() {
        val ok = OdgovorHttp(200, """{"choices":[{"message":{"content":"ok"}}]}""")
        fun telo(model: String, dovoli: Boolean) = Lazen(listOf(ok)).also { openRouter(it, model, dovoli).poslji(emptyList(), "") }.telo
        assertFalse(telo("google/gemma-4-31b-it:free", true).contains("data_collection"))
        assertFalse(telo("openrouter/free", true).contains("data_collection"))
        assertTrue(telo("google/gemma-4-31b-it:free", false).contains("\"data_collection\":\"deny\""), "brez dovoljenja (privzeto) deny ostane")
        assertTrue(telo("openai/gpt-4o", true).contains("\"data_collection\":\"deny\""), "placljiv model vedno z deny")
        assertTrue(telo("Google/Gemma:FREE", true).contains("\"data_collection\":\"deny\""), "netocen ID ne izpusti deny")
        // Privzeti odjemalec OpenRouter (ustvariOdjemalca, pot brez asistentke) je vedno z deny.
        val p = Lazen(listOf(ok))
        ustvariOdjemalca(Ponudnik.OPENROUTER, shramba("sk-or-1"), p).poslji(emptyList(), "")
        assertTrue(p.telo.contains("\"data_collection\":\"deny\""))
    }

    @Test
    fun `dovoljenje brezplacnih je samo za OpenRouter, OpenAI in Grok ne dobita polja provider`() {
        assertThrows(IllegalArgumentException::class.java) { OpenAiOdjemalec(shramba("sk-1"), prenos = Lazen(emptyList()), dovoliBrezplacne = true) }
        val p = Lazen(listOf(OdgovorHttp(200, """{"choices":[{"message":{"content":"ok"}}]}""")))
        OpenAiOdjemalec(shramba("sk-1"), "https://api.x.ai", "grok-4", p).poslji(emptyList(), "")
        assertFalse(p.telo.contains("provider"))
    }

    @Test
    fun `predikata brezplacnih modelov enaka kot na racunalniku`() {
        for (m in listOf("a/b:free", "A/B:FREE", " a/b:free ", "openrouter/free", "x:free:extended", "openrouter/free-x")) assertTrue(jeBrezplacenModel(m), m)
        for (m in listOf("openai/gpt-4o", "freedom/model", "a/free")) assertFalse(jeBrezplacenModel(m), m)
        for (m in listOf("a/b:free", "openrouter/free", "google/gemma-4-31b-it:free")) assertTrue(jeTocnoBrezplacen(m), m)
        for (m in listOf("A/B:FREE", " a/b:free", "x:free:extended", "b:free", "openrouter/free-x", "a/b:free/c")) assertFalse(jeTocnoBrezplacen(m), m)
    }

    @Test
    fun `404 pri free modelu pove, kaj vklopiti, 402 in 429 razumljivo`() {
        fun napaka(koda: Int, model: String, dovoli: Boolean) =
            (openRouter(Lazen(listOf(OdgovorHttp(koda, """{"error":{"message":"No endpoints found sk-or-1"}}"""))), model, dovoli).poslji(emptyList(), "") as Rezultat.Napaka)
        assertEquals("OpenRouter: vklopite brezplačne modele v računu OpenRouter (Privacy) ali izberite drug model.", napaka(404, "a/b:free", true).sporocilo)
        assertEquals("OpenRouter: vklopite stikalo za brezplačne modele.", napaka(404, "a/b:free", false).sporocilo)
        assertEquals("OpenRouter: na računu OpenRouter ni dobroimetja ali je negativen; izberite brezplačen model ali dodajte kredit.", napaka(402, "openai/gpt-4o", false).sporocilo)
        assertTrue(napaka(429, "a/b:free", true).sporocilo.contains("omejitev brezplačnih modelov"))
        assertEquals(402, napaka(402, "openai/gpt-4o", false).koda)
        assertFalse(napaka(404, "openai/gpt-4o", false).sporocilo.contains("sk-or-1"))
    }

    @Test
    fun `C6 placljiv model z 402 enkrat poskusi brezplacnega in to pove, brez dovoljenja ne`() {
        val p = Lazen(listOf(OdgovorHttp(402, "{}"), OdgovorHttp(200, """{"choices":[{"message":{"content":"zivjo"}}]}""")))
        val r = openRouter(p, "anthropic/claude-sonnet-4.5", dovoli = true, rezerva = PRIVZETI_BREZPLACNI).poslji(emptyList(), "")
        assertTrue((r as Rezultat.Besedilo).besedilo.startsWith("zivjo"))
        assertTrue(r.besedilo.contains("brezplačni model $PRIVZETI_BREZPLACNI"))
        assertEquals(2, p.klici)
        assertTrue(p.telo.contains("\"model\":\"$PRIVZETI_BREZPLACNI\"") && !p.telo.contains("data_collection"))
        val brez = Lazen(listOf(OdgovorHttp(402, "{}"), OdgovorHttp(200, """{"choices":[{"message":{"content":"x"}}]}""")))
        assertTrue(openRouter(brez, "anthropic/claude-sonnet-4.5", dovoli = false, rezerva = PRIVZETI_BREZPLACNI).poslji(emptyList(), "") is Rezultat.Napaka)
        assertEquals(1, brez.klici, "brez dovoljenja ni povratka")
    }

    @Test
    fun `neznan id ponudnika je Gemini`() {
        assertEquals(Ponudnik.GEMINI, Ponudnik.izId(null))
        assertEquals(Ponudnik.GEMINI, Ponudnik.izId("xyz"))
        assertEquals(Ponudnik.GROK, Ponudnik.izId("grok"))
    }
}
