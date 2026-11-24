package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Kljuc OpenRouter samo za asistentko na telefonu (lastnik 24. 11. 2026, A4, A6, C1-C4, C8). Brez pravega omrezja. */
class OpenRouterAsistentkaTest {
    class Lazen(private val odg: (String) -> OdgovorHttp) : Prenos {
        val zahteve = mutableListOf<Triple<String, Map<String, String>, String?>>()
        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp { zahteve.add(Triple(url, glave, telo)); return odg(url) }
        override fun get(url: String, glave: Map<String, String>, casMs: Long): OdgovorHttp { zahteve.add(Triple(url, glave, null)); return odg(url) }
    }

    private fun shramba(k: String?) = PomnilniskiShranjevalnik().also { if (k != null) it.shrani(KljucGemini(k)) }
    private val ok = OdgovorHttp(200, """{"choices":[{"message":{"content":"ok"}}]}""")

    @Test
    fun `brez kljuca asistentke ni odjemalca (A6 isti kot klici)`() {
        assertNull(IzbiraAsistentke.odjemalec(shramba(null), null, true, Lazen { ok }))
    }

    @Test
    fun `kljuc asistentke gre samo na openrouter ai, privzeti brezplacni model, deny samo brez potrditve`() {
        val p = Lazen { ok }
        IzbiraAsistentke.odjemalec(shramba("sk-or-asist-1"), null, brezplacni = true, prenos = p)!!.poslji(listOf(Sporocilo("user", "a")), "")
        val (url, glave, telo) = p.zahteve.single()
        assertEquals("https://openrouter.ai/api/v1/chat/completions", url)
        assertEquals("Bearer sk-or-asist-1", glave["Authorization"])
        assertTrue(telo!!.contains("\"model\":\"$PRIVZETI_BREZPLACNI\"") && !telo.contains("data_collection"))
        val brez = Lazen { ok }
        IzbiraAsistentke.odjemalec(shramba("sk-or-asist-1"), PRIVZETI_BREZPLACNI, brezplacni = false, prenos = brez)!!.poslji(emptyList(), "")
        assertTrue(brez.zahteve.single().third!!.contains("\"data_collection\":\"deny\""))
    }

    @Test
    fun `C4 brezplacen model brez potrditve ni sprejet, placljiv je`() {
        assertEquals(SOGLASJE_BREZPLACNI, IzbiraAsistentke.razlogZavrnitve("sk-or-asist-1", false, PRIVZETI_BREZPLACNI, soglasje = false, zePotrjeno = false))
        assertNull(IzbiraAsistentke.razlogZavrnitve("sk-or-asist-1", false, PRIVZETI_BREZPLACNI, soglasje = true, zePotrjeno = false))
        assertNull(IzbiraAsistentke.razlogZavrnitve("", true, PRIVZETI_BREZPLACNI, soglasje = false, zePotrjeno = true))
        assertNull(IzbiraAsistentke.razlogZavrnitve("sk-or-asist-1", false, "anthropic/claude-sonnet-4.5", soglasje = false, zePotrjeno = false))
        assertNotNull(IzbiraAsistentke.razlogZavrnitve("", false, "openai/gpt-4o", soglasje = true, zePotrjeno = true))
        assertNotNull(IzbiraAsistentke.razlogZavrnitve("kratek", false, "openai/gpt-4o", soglasje = true, zePotrjeno = true))
        assertNotNull(IzbiraAsistentke.razlogZavrnitve("sk-or-asist-1", false, "zlo nameren model", soglasje = true, zePotrjeno = true))
    }

    @Test
    fun `stanje racuna z ovojem data ali brez, neznano ostane null`() {
        val polno = """{"is_free_tier":true,"limit_remaining":0.5,"free_model_daily_requests":{"used":10,"limit":50,"remaining":40}}"""
        assertEquals(StanjeOpenRouter(true, 0.5, 40, 50), OpenRouterRacun.razberiStanje("""{"data":$polno}"""))
        assertEquals(OpenRouterRacun.razberiStanje(polno), OpenRouterRacun.razberiStanje("""{"data":$polno}"""))
        assertEquals(StanjeOpenRouter(null, null, null, null), OpenRouterRacun.razberiStanje("ni json"))
        assertNull(OpenRouterRacun.razberiStanje("""{"data":{"is_free_tier":"true"}}""").brezplacniRacun)
    }

    @Test
    fun `seznam modelov brez dobroimetja samo brezplacni z orodji, sicer vsi`() {
        val telo = """{"data":[
            {"id":"a/b:free","pricing":{"prompt":"0","completion":"0"},"supported_parameters":["tools"]},
            {"id":"c/d:free","pricing":{"prompt":"0","completion":"0"},"supported_parameters":["temperature"]},
            {"id":"e/f","pricing":{"prompt":"0.000001","completion":"0.000002"},"supported_parameters":["tools"]},
            {"id":"zlo nameren","pricing":{"prompt":"0","completion":"0"},"supported_parameters":["tools"]}]}"""
        assertEquals(listOf("a/b:free"), OpenRouterRacun.razberiModele(telo, true))
        assertEquals(listOf("a/b:free", "c/d:free", "e/f"), OpenRouterRacun.razberiModele(telo, false))
    }

    @Test
    fun `stanje bere key s kljucem v glavi, modeli brez kljuca, samo openrouter ai`() {
        val p = Lazen { url ->
            if (url.endsWith("/key")) OdgovorHttp(200, """{"data":{"is_free_tier":false,"free_model_daily_requests":{"remaining":999,"limit":1000}}}""")
            else OdgovorHttp(200, """{"data":[{"id":"e/f","pricing":{"prompt":"1","completion":"1"},"supported_parameters":["tools"]}]}""")
        }
        assertEquals(StanjeOpenRouter(false, null, 999, 1000), OpenRouterRacun.stanje(p, shramba("sk-or-asist-1")))
        assertEquals(listOf("e/f"), OpenRouterRacun.modeli(p, samoBrezplacni = false))
        assertEquals("Bearer sk-or-asist-1", p.zahteve[0].second["Authorization"])
        assertTrue(p.zahteve[1].second.isEmpty(), "seznam modelov je javen")
        assertTrue(p.zahteve.all { it.first.startsWith("https://openrouter.ai/api/v1/") })
        assertNull(OpenRouterRacun.stanje(p, shramba(null)))
    }
}
