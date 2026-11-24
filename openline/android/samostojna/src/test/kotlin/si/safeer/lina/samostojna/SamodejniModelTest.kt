package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Lina sama izbere delujoc model (lastnik 24. 11. 2026). Lazni ponudniki, brez omrezja. Komentarji so brez sumnikov. */
class SamodejniModelTest {
    class Zahteva(val metoda: String, val url: String, val glave: Map<String, String>, val telo: String)

    /** GET vrne seznam, POST odgovor po modelu iz telesa. */
    class Lazen(private val seznam: OdgovorHttp?, private val odgovor: (String) -> OdgovorHttp) : Prenos {
        val zahteve = mutableListOf<Zahteva>()
        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
            zahteve += Zahteva("POST", url, glave, telo)
            val model = Regex("\"model\":\"([^\"]+)\"").find(telo)?.groupValues?.get(1) ?: ""
            return odgovor(model)
        }
        override fun get(url: String, glave: Map<String, String>, casMs: Long): OdgovorHttp {
            zahteve += Zahteva("GET", url, glave, "")
            return seznam ?: throw java.io.IOException("ni povezave")
        }
    }

    private fun shramba(k: String) = PomnilniskiShranjevalnik().also { it.shrani(KljucGemini(k)) }
    private fun anthropic404(m: String) = OdgovorHttp(404, """{"type":"error","error":{"type":"not_found_error","message":"model: $m"}}""")
    private val anthropicOk = OdgovorHttp(200, """{"content":[{"type":"text","text":"da"}]}""")
    private fun seznamAnthropic(vararg ids: String) = OdgovorHttp(200, """{"data":[${ids.joinToString(",") { "{\"id\":\"$it\"}" }}]}""")

    @Test
    fun `privzeti modeli so zivi (dokumentacija 24 11 2026), claude-sonnet-5-5`() {
        assertEquals("claude-sonnet-5-5", Ponudnik.CLAUDE.model)
        val stari = setOf("claude-sonnet-4-5", "gemini-2.5-flash", "gemini-2.0-flash", "gpt-4.1-mini", "grok-4")
        for (p in Ponudnik.entries) assertFalse(p.model in stari, p.name)
    }

    @Test
    fun `vzrok iz statusa in telesa, nikoli samo iz 404`() {
        assertEquals(VzrokNapake.MODEL, SamodejniModel.vzrok(404, anthropic404("claude-sonnet-4-5").telo))
        assertEquals(VzrokNapake.MODEL, SamodejniModel.vzrok(404, """{"error":{"code":"model_not_found","message":"The model x does not exist"}}"""))
        assertEquals(VzrokNapake.MODEL, SamodejniModel.vzrok(404, """{"error":{"code":404,"status":"NOT_FOUND","message":"models/x is not found"}}"""))
        assertEquals(VzrokNapake.MODEL, SamodejniModel.vzrok(400, """{"error":{"code":400,"message":"openai/gpt-4o is not a valid model ID"}}"""))
        assertNull(SamodejniModel.vzrok(404, """{"error":{"code":404,"message":"No endpoints found matching your data policy"}}"""))
        assertNull(SamodejniModel.vzrok(404, ""))
        assertEquals(VzrokNapake.KLJUC, SamodejniModel.vzrok(401, "{}"))
        assertEquals(VzrokNapake.DOBROIMETJE, SamodejniModel.vzrok(400, """{"error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}"""))
        assertEquals(VzrokNapake.OMEJITEV, SamodejniModel.vzrok(429, "{}"))
        // Napaka parametra pri novem modelu ni »model ne obstaja«.
        assertNull(SamodejniModel.vzrok(400, """{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.","code":"unsupported_parameter"}}"""))
        assertEquals(VzrokNapake.MODEL, SamodejniModel.vzrok(404, """{"error":{"message":"The model `gpt-4.1-mini` does not exist or you do not have access to it."}}"""))
    }

    @Test
    fun `seznam brez zgornje meje - priporocen za 400 mestom je na seznamu`() {
        val ids = (0 until 450).map { "openai/gpt-$it-drag" } + "openai/gpt-4o"
        val telo = ids.joinToString(",", "{\"data\":[", "]}") { "{\"id\":\"$it\"}" }
        val seznam = SamodejniModel.razberiSeznam(Ponudnik.OPENROUTER, telo)
        assertEquals(451, seznam.size)
        assertEquals("openai/gpt-4o", SamodejniModel.kandidati(Ponudnik.OPENROUTER, seznam).first())
    }

    @Test
    fun `kandidati - priporoceni s seznama brez brezplacnih in najvec 3`() {
        assertEquals(listOf("claude-haiku-5-5", "claude-opus-5-5"), SamodejniModel.kandidati(Ponudnik.CLAUDE, listOf("claude-opus-5-5", "claude-haiku-5-5", "claude-3-x")))
        assertEquals(listOf("openai/gpt-6-luna"), SamodejniModel.kandidati(Ponudnik.OPENROUTER, listOf("openai/gpt-oss-20b:free", "openai/gpt-6-luna")))
        assertEquals(listOf("openai/gpt-6-luna"), SamodejniModel.kandidati(Ponudnik.OPENROUTER, listOf("anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro", "openai/gpt-6-luna"), samoPredpona = "openai/"))
        assertEquals(listOf("anthropic/claude-sonnet-4.5"), SamodejniModel.kandidati(Ponudnik.OPENROUTER, listOf("anthropic/claude-sonnet-4.5", "openai/gpt-6-luna"), samoPredpona = "anthropic/"))
        assertNull(SamodejniModel.predponaModela("meta/llama-3"))
        assertEquals("google/", SamodejniModel.predponaModela("google/gemini-2.5-pro"))
        assertTrue(SamodejniModel.kandidati(Ponudnik.OPENAI, listOf("gpt-6-luna", "gpt-6.1-terra", "gpt-6.2-sol", "gpt-5")).size <= 3)
    }

    @Test
    fun `ob shranjevanju - seznam brez privzetega, izbran priporocen ki je odgovoril, uradni naslov, kljuc samo v glavi`() {
        val p = Lazen(seznamAnthropic("claude-opus-5-5", "claude-haiku-5-5")) { m -> if (m == "claude-haiku-5-5") anthropicOk else anthropic404(m) }
        val izid = SamodejniModel.izberi(p, Ponudnik.CLAUDE, shramba("sk-ant-tajno"), spanje = {})
        assertEquals(SamodejniModel.Izbira.Model("claude-haiku-5-5"), izid)
        assertEquals("https://api.anthropic.com/v1/models?limit=100", p.zahteve[0].url)
        assertEquals("sk-ant-tajno", p.zahteve[0].glave["x-api-key"])
        for (z in p.zahteve) {
            assertTrue(z.url.startsWith("https://api.anthropic.com/v1/"), z.url)
            assertFalse(z.url.contains("sk-ant-tajno") || z.telo.contains("sk-ant-tajno"))
        }
        assertFalse(p.zahteve.any { it.telo.contains("claude-sonnet-5-5") }, "model, ki ga ni na seznamu, se ne preizkusa")
    }

    @Test
    fun `stari prenos brez GET - preizkusijo se priporoceni`() {
        val p = object : Prenos {
            override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long) =
                if (telo.contains("claude-sonnet-5-5")) anthropic404("claude-sonnet-5-5") else anthropicOk
        }
        assertEquals(SamodejniModel.Izbira.Model("claude-haiku-5-5"), SamodejniModel.izberi(p, Ponudnik.CLAUDE, shramba("k-12345678"), spanje = {}))
    }

    @Test
    fun `noben model - pravi vzrok (kljuc, dobroimetje), nikoli model ne obstaja`() {
        val p = Lazen(seznamAnthropic("claude-sonnet-5-5")) { OdgovorHttp(401, """{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}""") }
        val izid = SamodejniModel.izberi(p, Ponudnik.CLAUDE, shramba("k-12345678"), spanje = {}) as SamodejniModel.Izbira.Napaka
        assertEquals(VzrokNapake.KLJUC, izid.vzrok)
        assertTrue(izid.sporocilo.contains("ključ ni veljaven"), izid.sporocilo)
        val p2 = Lazen(seznamAnthropic("claude-sonnet-5-5")) { OdgovorHttp(400, """{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}""") }
        val izid2 = SamodejniModel.izberi(p2, Ponudnik.CLAUDE, shramba("k-12345678"), spanje = {}) as SamodejniModel.Izbira.Napaka
        assertTrue(izid2.sporocilo.contains("dobroimetja") && !izid2.sporocilo.contains("ne obstaja"), izid2.sporocilo)
    }

    @Test
    fun `med delovanjem - Claude 404 not_found, zamenjava v istem ponudniku, shranitev, ena vrstica, brez surovega model dvopicje`() {
        val modeli = PomnilniskaModelShramba().also { it.shrani(Ponudnik.CLAUDE, "claude-sonnet-4-5") }
        val p = Lazen(seznamAnthropic("claude-sonnet-5-5", "claude-haiku-5-5")) { m -> if (m == "claude-sonnet-4-5") anthropic404(m) else anthropicOk }
        val o = SamodejniOdjemalec(Ponudnik.CLAUDE, shramba("sk-ant-1"), p, modeli).apply { spanje = {} }
        val r = o.poslji(listOf(Sporocilo("user", "zivjo")), "") as Rezultat.Besedilo
        assertTrue(r.besedilo.startsWith("da"))
        assertTrue(r.besedilo.contains("claude-sonnet-4-5") && r.besedilo.contains("claude-sonnet-5-5"), r.besedilo)
        assertFalse(r.besedilo.contains("model: "))
        assertEquals("claude-sonnet-5-5", modeli.beri(Ponudnik.CLAUDE))
        for (z in p.zahteve) assertTrue(z.url.startsWith("https://api.anthropic.com/"), z.url)
        // Naslednji klic iste (dnevne) asistentke gre takoj na nov model.
        val pred = p.zahteve.size
        o.poslji(listOf(Sporocilo("user", "se enkrat")), "")
        assertEquals(1, p.zahteve.size - pred)
        assertTrue(p.zahteve.last().telo.contains("claude-sonnet-5-5"))
    }

    @Test
    fun `med delovanjem - noben model ne odgovori, sporocilo brez surovega model dvopicje`() {
        val modeli = PomnilniskaModelShramba()
        val p = Lazen(seznamAnthropic("claude-haiku-5-5")) { m -> if (m == "claude-sonnet-5-5") anthropic404(m) else OdgovorHttp(401, "{}") }
        val r = SamodejniOdjemalec(Ponudnik.CLAUDE, shramba("sk-ant-1"), p, modeli).apply { spanje = {} }.poslji(listOf(Sporocilo("user", "a")), "") as Rezultat.Napaka
        assertFalse(r.sporocilo.contains("model: "), r.sporocilo)
        assertTrue(r.sporocilo.contains("ključ ni veljaven"), r.sporocilo)
        assertNull(modeli.beri(Ponudnik.CLAUDE))
    }

    @Test
    fun `401 pri delujocem modelu ne sprozi iskanja`() {
        val p = Lazen(seznamAnthropic("claude-haiku-5-5")) { OdgovorHttp(401, """{"error":{"type":"authentication_error"}}""") }
        SamodejniOdjemalec(Ponudnik.CLAUDE, shramba("sk-ant-1"), p, PomnilniskaModelShramba()).apply { spanje = {} }.poslji(listOf(Sporocilo("user", "a")), "")
        assertEquals(1, p.zahteve.size)
    }

    @Test
    fun `OpenRouter - brezplacen se ne izbere, deny ostane, seznam brez kljuca`() {
        val modeli = PomnilniskaModelShramba()
        val p = Lazen(OdgovorHttp(200, """{"data":[{"id":"openai/gpt-oss-20b:free"},{"id":"openai/gpt-6-luna"}]}""")) { m ->
            if (m == "openai/gpt-4o") OdgovorHttp(400, """{"error":{"code":400,"message":"openai/gpt-4o is not a valid model ID"}}""")
            else OdgovorHttp(200, """{"choices":[{"message":{"content":"da"}}]}""")
        }
        val r = SamodejniOdjemalec(Ponudnik.OPENROUTER, shramba("sk-or-1"), p, modeli).apply { spanje = {} }.poslji(listOf(Sporocilo("user", "a")), "")
        assertTrue(r is Rezultat.Besedilo)
        assertEquals("openai/gpt-6-luna", modeli.beri(Ponudnik.OPENROUTER))
        for (z in p.zahteve.filter { it.metoda == "POST" }) {
            assertFalse(z.telo.contains(":free"), z.telo)
            assertTrue(z.telo.contains("\"data_collection\":\"deny\""), z.telo)
        }
        assertNull(p.zahteve.first { it.metoda == "GET" }.glave["Authorization"])
        for (z in p.zahteve) assertTrue(z.url.startsWith("https://openrouter.ai/api/v1/"), z.url)
    }

    @Test
    fun `OpenRouter preklop ostane pri isti predponi in nikoli ne poslje brezplacnega`() {
        val modeli = PomnilniskaModelShramba()
        val p = Lazen(OdgovorHttp(200, """{"data":[{"id":"anthropic/claude-sonnet-4.5"},{"id":"google/gemini-2.5-pro"},{"id":"openai/gpt-oss-20b:free"},{"id":"openai/gpt-6-luna"}]}""")) { m ->
            if (m == "openai/gpt-4o") OdgovorHttp(400, """{"error":{"code":400,"message":"openai/gpt-4o is not a valid model ID"}}""")
            else OdgovorHttp(200, """{"choices":[{"message":{"content":"da"}}]}""")
        }
        val r = SamodejniOdjemalec(Ponudnik.OPENROUTER, shramba("sk-or-1"), p, modeli).apply { spanje = {} }.poslji(listOf(Sporocilo("user", "a")), "")
        assertTrue(r is Rezultat.Besedilo)
        assertEquals("openai/gpt-6-luna", modeli.beri(Ponudnik.OPENROUTER))
        for (z in p.zahteve.filter { it.metoda == "POST" }) {
            assertFalse(z.telo.contains("anthropic/"), z.telo)
            assertFalse(z.telo.contains("google/"), z.telo)
            assertFalse(z.telo.contains(":free"), z.telo)
        }
    }

    @Test
    fun `OpenRouter z neznano predpono ne isce drugega modela`() {
        val modeli = PomnilniskaModelShramba().also { it.shrani(Ponudnik.OPENROUTER, "meta/llama-3.1-70b") }
        val p = Lazen(OdgovorHttp(200, """{"data":[{"id":"openai/gpt-6-luna"},{"id":"anthropic/claude-sonnet-4.5"}]}""")) {
            OdgovorHttp(400, """{"error":{"message":"meta/llama-3.1-70b is not a valid model ID"}}""")
        }
        val r = SamodejniOdjemalec(Ponudnik.OPENROUTER, shramba("sk-or-1"), p, modeli).apply { spanje = {} }.poslji(listOf(Sporocilo("user", "a")), "")
        assertTrue(r is Rezultat.Napaka)
        assertEquals("meta/llama-3.1-70b", modeli.beri(Ponudnik.OPENROUTER))
        assertEquals(1, p.zahteve.size)
        assertEquals("POST", p.zahteve.single().metoda)
    }
}
