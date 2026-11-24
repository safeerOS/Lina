package si.safeer.lina.podpis

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Agenti in naloge s telefona (lastnik 24. 11. 2026 »Bo gumb na telefonu?« - DA): nizi in zgostitev navzkrizno s TS
 * (agenti-telefon.test.ts in teki/vektor-agenti.mts), varovalo »Razumem«, stroga razclenitev, dodelitev s preverbami pred podpisom, preklic.
 */
class AgentiLineTest {
    private val id = "n-0123456789abcdef"
    private val e = "e".repeat(16)

    @Test
    fun `nizi so dobesedno isti kot vektor v agenti-telefon test ts`() {
        assertEquals("safeer-lina-agenti-stanje-v1\n$id\n1\n$e", NiziLine.nizStanjaAgentNalog(id, 1, e))
        assertEquals("safeer-lina-agent-dodeli-v1\n$id\n${"f".repeat(64)}\n1\n$e", NiziLine.nizDodelitveAgentNaloge(id, "f".repeat(64), 1, e))
        assertEquals("safeer-lina-agent-preklici-v1\n$id\n0123456789abcdef\n1\n$e", NiziLine.nizPreklicaAgentNaloge(id, "0123456789abcdef", 1, e))
        assertNull(NiziLine.nizDodelitveAgentNaloge(id, "F".repeat(64), 1, e))
        assertNull(NiziLine.nizPreklicaAgentNaloge(id, "../etc/passwd0000", 1, e))
        assertNull(NiziLine.nizStanjaAgentNalog("tuj", 1, e))
    }

    /** Zgostitve izracunal Node (JSON.stringify v kanal-claude.ts zgostitevDodelitve); prva je doslovni vektor iz agenti-telefon.test.ts. */
    @Test
    fun `zgostitev dodelitve je bajt za bajtom JSON stringify`() {
        assertEquals("d7047e26de2a47d4722c5d3f50d03aaa5bb4eb5b7255b44c3cb9cd7a01e0c3e5",
            AgentiLine.zgostitevDodelitve("pi", "/home/a/čaj", "naloga \"x\"\\y\nkonec", "zdaj"))
        assertEquals("407edd6f859c725faf7937166102bdceedb9e2c7fef3a0ac55a6b0501eb136c6",
            AgentiLine.zgostitevDodelitve("claude", "/home/a/p",
                "tab\tcr\rff\u000cbs\bctl\u0001\u001f del\u007f nbsp\u00a0 ls\u2028 emoji \uD83D\uDE00 </script>", "ura:2026-11-24T10:00:00.000Z"))
        assertEquals("a7919062289570f76f9cdf73ecd339572b274e65f3cf2fa470978bb064f97026",
            AgentiLine.zgostitevDodelitve("grok", "/home/a/mapa s presledki", "", "po:0123456789abcdef"))
        // meje polj ne zdrsnejo
        assertFalse(AgentiLine.zgostitevDodelitve("pi", "/home/a/p", "vrstica 1\nvrstica 2", "zdaj") ==
            AgentiLine.zgostitevDodelitve("pi", "/home/a/p\nvrstica 1", "vrstica 2", "zdaj"))
    }

    /** Podpise je naredil Node (kljuc P-256 samo za vektor, teki/vektor-agenti.json); JCA jih preveri nad nizi, ki jih sestavi Kotlin. */
    @Test
    fun `navzkrizni vektor TS - Kotlin, podpis Node preveri JCA`() {
        val kljuc = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEn1m/G2uNQd6Z3VwuhqnSpWJTOVXtDnjhKyQRWo+n7xURVkiZMSKBCm22gBtanJMj4yYPA7hY/HiN7rv8AM76lQ=="
        val n = "n-6a70fca6ce312228"
        val ee = "eEeEeEeEeEeEeEeE_-01"
        val c = 1763990000000
        assertEquals(n, KrogKljuc.idIzKljuca(kljuc))
        val zg = AgentiLine.zgostitevDodelitve("pi", "/home/a/čaj", "naloga \"x\"\\y\nkonec", "zdaj")
        val primeri = listOf(
            NiziLine.nizStanjaAgentNalog(n, c, ee) to "MEUCIBlaC3KzQ1PMHdbTcm8aY/5i/5GVCP7oRMjYQyefkLTHAiEA4n37TsWrGJ/d7nLRmMFMfyHWCsWpiYd/x80yC6FdSU8=",
            NiziLine.nizDodelitveAgentNaloge(n, zg, c, ee) to "MEYCIQD3KsoDhcTD6vl7cnvwoKwwof2dnL8UMzVtW1cswNynRgIhALCBLHFK58dwthRUPkhY9Dqt1jc7FVNxuozcOJCgxjFv",
            NiziLine.nizPreklicaAgentNaloge(n, "0123456789abcdef", c, ee) to "MEQCIBqx7oVEvhCj7MFHQrfeAhRaidNqiaHLfc+xbT/5xX/WAiA/bbGfkGd15bR2IHOmYR1JpN68OWeY4XwojbFTBjWFUw==",
        )
        for ((niz, podpis) in primeri) {
            assertNotNull(niz)
            assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, niz.toByteArray(Charsets.UTF_8), podpis), niz)
            assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, (niz + "x").toByteArray(Charsets.UTF_8), podpis), niz)
        }
        // druga zgostitev (drugo besedilo) z istim podpisom ne velja
        val drugo = NiziLine.nizDodelitveAgentNaloge(n, AgentiLine.zgostitevDodelitve("pi", "/home/a/čaj", "drugo", "zdaj"), c, ee)!!
        assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, drugo.toByteArray(Charsets.UTF_8), primeri[1].second))
    }

    @Test
    fun `podpisnik brez Razumem ne podpise dodelitve, branje in preklic ostaneta`() {
        val podpisano = mutableListOf<String>()
        var potrjeno = false
        val p = Podpisnik({ b -> podpisano.add(String(b, Charsets.UTF_8)); "PODPIS" }, { id }, { "" }, { potrjeno })
        assertNull(p.podpisiDodelitevAgentNaloge("f".repeat(64), 5, e))
        assertTrue(podpisano.isEmpty(), "brez Razumem se dodelitev ne podpise")
        assertEquals("PODPIS", p.podpisiStanjeAgentNalog(5, e))
        assertEquals("PODPIS", p.podpisiPreklicAgentNaloge("0123456789abcdef", 5, e))
        potrjeno = true
        assertEquals("PODPIS", p.podpisiDodelitevAgentNaloge("f".repeat(64), 5, e))
        assertEquals("safeer-lina-agent-dodeli-v1\n$id\n${"f".repeat(64)}\n5\n$e", podpisano.last())
        assertNull(Podpisnik({ "PODPIS" }, { id }, { "" }, { error("shramba") }).podpisiDodelitevAgentNaloge("f".repeat(64), 5, e), "izjema zapre")
    }

    private fun naloga(nid: String = "0123456789abcdef", stanje: String = "dodeljeno", dodatno: String = "") =
        """{"id":"$nid","izvor":"telefon","agent":"pi","mapa":"/dom/projekt","besedilo":"Naloga\nz dvema\u202e vrsticama","stanje":"$stanje",
        "ustvarjeno":"2026-11-24T09:00:00.000Z","potrjeno":"2026-11-24T09:00:00.000Z","razlog":null,
        "pogoj":{"vrsta":"ura","cas":"2026-11-24T10:00:00.000Z"},"ocena":{"konec":"2026-11-24T10:30:00.000Z","groba":true},
        "opomnik":{"cas":"2026-11-24T10:30:00.000Z","razlog":null,"krog":0},"koncano":null$dodatno}"""
    private fun agent(aid: String, stanje: String = "pripravljen", vkl: Boolean = true, poziv: Boolean = true) =
        """{"id":"$aid","ime":"${AgentiLine.IMENA.getValue(aid)}","stanje":"$stanje","vklopljen":$vkl,"zacetniPoziv":$poziv,"kanal":${aid == "claude"}}"""
    private fun odgovor(naloge: String = naloga(), mape: String = "") =
        """{"agenti":[${agent("claude")},${agent("pi")},${agent("kimi", poziv = false)},${agent("grok", stanje = "prijava")},${agent("agy", vkl = false)}],
        "naloge":[$naloge]$mape}"""

    @Test
    fun `razclenitev sprejme pravi odgovor, besedilo brez nevidnih znakov, mape iz vrste ali z racunalnika`() {
        val s = AgentiLine.razcleni(odgovor())!!
        assertEquals(listOf("claude", "pi"), s.agenti.filter { it.zaIzbiro }.map { it.id })
        val n = s.naloge.single()
        assertEquals("Naloga\nz dvema vrsticama", n.besedilo)
        assertEquals(PogojNaloge("ura", cas = "2026-11-24T10:00:00.000Z"), n.pogoj)
        assertEquals("2026-11-24T10:30:00.000Z", n.ocenaKonca)
        assertTrue(n.ocenaGroba)
        assertEquals(listOf("/dom/projekt"), s.mape)
        assertFalse(s.mapeRacunalnika)
        val z = AgentiLine.razcleni(odgovor(mape = ""","mape":["/dom/a","/dom/b  dva presledka"]"""))!!
        assertEquals(listOf("/dom/a", "/dom/b  dva presledka"), z.mape)
        assertTrue(z.mapeRacunalnika)
        assertEquals(emptyList(), AgentiLine.razcleni("""{"agenti":[],"naloge":[]}""")!!.mape)
    }

    /** Dobesedni odgovor telefonStanjeNalog (teki/stanje-streznika.mts proti kodi racunalnika, 24. 11. 2026; zacasna pot zamenjana z /x). */
    @Test
    fun `razclenitev sprejme pravi odgovor racunalnika`() {
        val s = AgentiLine.razcleni("""{"agenti":[{"id":"claude","ime":"Claude Code","stanje":"pripravljen","vklopljen":true,"zacetniPoziv":true,"kanal":true},{"id":"agy","ime":"Antigravity","stanje":"pripravljen","vklopljen":true,"zacetniPoziv":true,"kanal":false},{"id":"opencode","ime":"opencode (Gemini)","stanje":"pripravljen","vklopljen":true,"zacetniPoziv":true,"kanal":false},{"id":"kimi","ime":"Kimi","stanje":"pripravljen","vklopljen":true,"zacetniPoziv":false,"kanal":false},{"id":"pi","ime":"Pi","stanje":"pripravljen","vklopljen":true,"zacetniPoziv":true,"kanal":false},{"id":"grok","ime":"Grok Build","stanje":"pripravljen","vklopljen":true,"zacetniPoziv":true,"kanal":false}],"naloge":[{"id":"0288d0a72b518b8b","izvor":"telefon","agent":"opencode","mapa":"/x/dom/projekt","besedilo":"Zdaj.","stanje":"tece","ustvarjeno":"2026-11-24T05:03:38.287Z","potrjeno":"2026-11-24T05:03:38.287Z","razlog":null,"pogoj":{"vrsta":"zdaj"},"ocena":{"konec":"2026-11-24T05:33:38.287Z","groba":true},"opomnik":{"cas":"2026-11-24T05:33:38.287Z","razlog":null,"krog":0},"koncano":null},{"id":"6e6a24658bcb49a1","izvor":"telefon","agent":"grok","mapa":"/x/dom/projekt","besedilo":"Za preklic.","stanje":"preklicano","ustvarjeno":"2026-11-24T05:03:38.285Z","potrjeno":null,"razlog":null,"pogoj":{"vrsta":"ura","cas":"2026-11-24T06:03:38.282Z"},"ocena":null,"opomnik":null,"koncano":null},{"id":"720efa627962a01f","izvor":"telefon","agent":"claude","mapa":"/x/dom/projekt","besedilo":"Ko konca prva.","stanje":"dodeljeno","ustvarjeno":"2026-11-24T05:03:38.284Z","potrjeno":null,"razlog":null,"pogoj":{"vrsta":"po","id":"9c89fe461d64d960"},"ocena":null,"opomnik":null,"koncano":null},{"id":"9c89fe461d64d960","izvor":"telefon","agent":"pi","mapa":"/x/dom/projekt","besedilo":"Ob uri\nz dvema vrsticama.","stanje":"dodeljeno","ustvarjeno":"2026-11-24T05:03:38.282Z","potrjeno":null,"razlog":null,"pogoj":{"vrsta":"ura","cas":"2026-11-24T06:03:38.282Z"},"ocena":null,"opomnik":null,"koncano":null}]}""")
        assertNotNull(s)
        assertEquals(listOf("claude", "agy", "opencode", "pi", "grok"), s.agenti.filter { it.zaIzbiro }.map { it.id })
        assertEquals(listOf("tece", "preklicano", "dodeljeno", "dodeljeno"), s.naloge.map { it.stanje })
        assertEquals(PogojNaloge("po", id = "9c89fe461d64d960"), s.naloge[2].pogoj)
        assertEquals("2026-11-24T05:33:38.287Z", s.naloge[0].ocenaKonca)
        assertEquals(listOf("/x/dom/projekt"), s.mape)
        assertFalse(s.mapeRacunalnika, "racunalnik polja mape se ne poslje")
    }

    @Test
    fun `razclenitev zavrne neznano, slabe id-je, poti z nevidnimi znaki, dvojnike, preveliko telo`() {
        for (s in listOf(
            odgovor(naloga(stanje = "zagnano")),
            odgovor(naloga(nid = "../../etc")),
            odgovor(naloga().replace("\"agent\":\"pi\"", "\"agent\":\"bash\"")),
            odgovor(naloga().replace("\"izvor\":\"telefon\"", "\"izvor\":\"splet\"")),
            odgovor(naloga().replace("\"vrsta\":\"ura\"", "\"vrsta\":\"vcasih\"")),
            odgovor(naloga().replace("\"/dom/projekt\"", "\"/dom/pro\\njekt\"")),
            odgovor(naloga().replace("\"/dom/projekt\"", "\"/dom/\u202eprojekt\"")),
            odgovor(naloga().replace("\"krog\":0", "\"krog\":-1")),
            odgovor(naloga().replace("\"razlog\":null,\"krog\"", "\"razlog\":\"karkoli\",\"krog\"")),
            odgovor(naloga() + "," + naloga()),
            odgovor(mape = ""","mape":["/a\tb"]"""),
            odgovor(mape = ""","mape":"/a""""),
            odgovor().replace("\"vklopljen\":true", "\"vklopljen\":\"true\""),
            odgovor().replace("\"stanje\":\"prijava\"", "\"stanje\":\"morda\""),
            "{}", "ni json", "x".repeat(AgentiLine.NAJVEC_ODGOVORA + 1),
        )) assertNull(AgentiLine.razcleni(s), s.take(120))
    }

    @Test
    fun `ob uri po ljubljanskem casu - danes ali jutri, poletni in zimski cas`() {
        // 24. 11. (CET, UTC+1): 08:00 UTC = 09:00 v Ljubljani
        assertEquals("ura:2026-11-24T09:30:00Z", AgentiLine.pogojUra(10, 30, Instant.parse("2026-11-24T08:00:00Z")))
        assertEquals("ura:2026-11-25T07:00:00Z", AgentiLine.pogojUra(8, 0, Instant.parse("2026-11-24T08:00:00Z")))
        // poletje (CEST, UTC+2)
        assertEquals("ura:2026-07-24T08:30:00Z", AgentiLine.pogojUra(10, 30, Instant.parse("2026-07-24T06:00:00Z")))
        // ista minuta = ze minila -> jutri
        assertEquals("ura:2026-11-25T09:00:00Z", AgentiLine.pogojUra(10, 0, Instant.parse("2026-11-24T09:00:00Z")))
        // okno pred podpisom pokaze dan: »jutri« za uro, ki je danes ze minila
        val zdaj = Instant.parse("2026-11-24T08:00:00Z")
        assertEquals(AgentiLine.DanZagona(1, "08:00", "25. 11."), AgentiLine.danZagona(AgentiLine.pogojUra(8, 0, zdaj).removePrefix("ura:"), zdaj))
        assertEquals(AgentiLine.DanZagona(0, "10:30", "24. 11."), AgentiLine.danZagona(AgentiLine.pogojUra(10, 30, zdaj).removePrefix("ura:"), zdaj))
        // polnoc po ljubljanskem casu: 23:30 UTC 24. 11. je ze 25. 11. v Ljubljani
        assertEquals(AgentiLine.DanZagona(1, "00:30", "25. 11."), AgentiLine.danZagona("2026-11-24T23:30:00.000Z", zdaj))
        assertEquals(3L, AgentiLine.danZagona("2026-11-27T09:00:00Z", zdaj)!!.dni)
        assertNull(AgentiLine.danZagona("vceraj", zdaj))
        assertEquals("po:0123456789abcdef", AgentiLine.pogojPo("0123456789abcdef"))
        assertNull(AgentiLine.pogojPo("0123"))
    }

    private class Lazna(val odgovor: OdgovorLine) : PovezavaZLino {
        val stanja = mutableListOf<List<Any>>()
        val dodelitve = mutableListOf<String>()
        val preklici = mutableListOf<String>()
        override fun stanjeAgentNalog(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine { stanja.add(listOf(posiljatelj, cas, enkratni, podpis)); return odgovor }
        override fun dodeliAgentNalogo(telo: String): OdgovorLine { dodelitve.add(telo); return odgovor }
        override fun prekliciAgentNalogo(telo: String): OdgovorLine { preklici.add(telo); return odgovor }
        override fun naloga(telo: String) = error("ne")
        override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) = error("ne")
        override fun klici(telo: String) = error("ne")
        override fun sinhron(telo: String) = error("ne")
        override fun odobritev(telo: String) = error("ne")
        override fun ustavi(telo: String) = error("ne")
        override fun seznani(telo: String) = error("ne")
        override fun stanjeSeznanitve(koda: String) = error("ne")
        override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = error("ne")
    }

    @Test
    fun `stanje podpise in vrne razclenjeno, napake so locene, stara Lina 404`() {
        val ok = Lazna(OdgovorLine.Ok(odgovor()))
        assertTrue(AgentiLine.stanje(ok, id, 7, e) { c, x -> "P$c$x" } is IzidAgentov.Stanje)
        assertEquals(listOf<Any>(id, 7L, e, "P7$e"), ok.stanja.single())
        fun st(o: OdgovorLine) = AgentiLine.stanje(Lazna(o), id, 1, e) { _, _ -> "P" }
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NEDOSEGLJIV), st(OdgovorLine.Nedosegljiva))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.ZAVRNJENO), st(OdgovorLine.Napaka(403, null)))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.STARA_LINA), st(OdgovorLine.Napaka(404, "ni")))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA), st(OdgovorLine.Ok("{}")))
    }

    @Test
    fun `povezava brez novih poti (stara izvedba) odgovori 404 - telefon pove, da je Lina na racunalniku stara`() {
        val stara = object : PovezavaZLino {
            override fun naloga(telo: String) = error("ne")
            override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) = error("ne")
            override fun klici(telo: String) = error("ne")
            override fun sinhron(telo: String) = error("ne")
            override fun odobritev(telo: String) = error("ne")
            override fun ustavi(telo: String) = error("ne")
            override fun seznani(telo: String) = error("ne")
            override fun stanjeSeznanitve(koda: String) = error("ne")
            override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = error("ne")
        }
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.STARA_LINA), AgentiLine.stanje(stara, id, 1, e) { _, _ -> "P" })
        assertEquals(OdgovorLine.Napaka(404, "ni"), stara.dodeliAgentNalogo("{}"))
        assertEquals(OdgovorLine.Napaka(404, "ni"), stara.prekliciAgentNalogo("{}"))
    }

    private val stanje = AgentiLine.razcleni(odgovor(naloga() + "," + naloga(nid = "fedcba9876543210", stanje = "koncano"), ""","mape":["/dom/projekt","/dom/drugo"]"""))!!
    private val json = Json

    @Test
    fun `dodelitev podpise zgostitev tega, kar je lastnik potrdil, in poslje ista polja`() {
        val pov = Lazna(OdgovorLine.Ok("""{"id":"00112233aabbccdd"}"""))
        val podpisi = mutableListOf<String>()
        val besedilo = "Naredi \"to\"\nin\\ ono č"
        val izid = AgentiLine.dodeli(pov, id, stanje, "pi", "/dom/drugo", besedilo, "po:0123456789abcdef", 9, e) { zg, c, x -> podpisi.add(zg); "P$c$x" }
        assertEquals(IzidAgentov.Dodeljeno("00112233aabbccdd"), izid)
        assertEquals(AgentiLine.zgostitevDodelitve("pi", "/dom/drugo", besedilo, "po:0123456789abcdef"), podpisi.single())
        val t = json.parseToJsonElement(pov.dodelitve.single()).jsonObject
        for ((k, v) in listOf("posiljatelj" to id, "agent" to "pi", "mapa" to "/dom/drugo", "besedilo" to besedilo, "pogoj" to "po:0123456789abcdef",
            "cas" to "9", "enkratni" to e, "podpis" to "P9$e")) assertEquals(v, t[k]!!.jsonPrimitive.content, k)
    }

    @Test
    fun `dodelitev se ne podpise in ne poslje - agent ni v izbiri, mapa ni s seznama, slab pogoj, prazno ali predolgo besedilo`() {
        val pov = Lazna(OdgovorLine.Ok("""{"id":"00112233aabbccdd"}"""))
        var klicev = 0
        fun d(agent: String = "pi", mapa: String = "/dom/projekt", besedilo: String = "x", pogoj: String = "zdaj") =
            AgentiLine.dodeli(pov, id, stanje, agent, mapa, besedilo, pogoj, 9, e) { _, _, _ -> klicev++; "P" }
        for (izid in listOf(
            d(agent = "kimi"), d(agent = "grok"), d(agent = "agy"), d(agent = "opencode"), d(agent = "bash"),
            d(mapa = "/etc"), d(mapa = "/dom/projekt/../.."),
            d(pogoj = "jutri"), d(pogoj = "po:fedcba9876543210"), d(pogoj = "po:1111111111111111"), d(pogoj = "ura:x"),
            d(pogoj = "ura:" + "2".repeat(37)),
            d(besedilo = "  \n "), d(besedilo = "a".repeat(8001)), d(besedilo = "pol\uD800"),
        )) assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA), izid)
        assertEquals(0, klicev, "nic se ne podpise")
        // 8000 tribajtnih znakov (24 KB): meja racunalnika 16 KB bi dala 413 - telefon ne poslje
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.RACUNALNIK, "predolgo"), d(besedilo = "€".repeat(8000)))
        assertFalse(AgentiLine.dolzinaVRedu("€".repeat(8000), "/dom/projekt"))
        assertTrue(AgentiLine.dolzinaVRedu("a".repeat(8000), "/dom/projekt"))
        assertTrue(AgentiLine.dolzinaVRedu("č".repeat(7900), "/dom/projekt"))
        assertTrue(pov.dodelitve.isEmpty())
        assertEquals(IzidAgentov.Dodeljeno("00112233aabbccdd"), d(agent = "claude", pogoj = "ura:2026-11-24T10:00:00Z"))
    }

    @Test
    fun `dodelitev brez Razumem ne gre na racunalnik, napaka racunalnika nosi razlog, slab odgovor je napaka`() {
        val pov = Lazna(OdgovorLine.Ok("""{"id":"00112233aabbccdd"}"""))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NI_POTRDITVE), AgentiLine.dodeli(pov, id, stanje, "pi", "/dom/projekt", "x", "zdaj", 9, e) { _, _, _ -> null })
        assertTrue(pov.dodelitve.isEmpty())
        fun z(o: OdgovorLine) = AgentiLine.dodeli(Lazna(o), id, stanje, "pi", "/dom/projekt", "x", "zdaj", 9, e) { _, _, _ -> "P" }
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.RACUNALNIK, "mapa-prepovedana"), z(OdgovorLine.Napaka(409, "mapa-prepovedana")))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.ZAVRNJENO), z(OdgovorLine.Napaka(403, null)))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA), z(OdgovorLine.Ok("""{"id":"../x"}""")))
    }

    @Test
    fun `preklic samo dodeljene ali zamujene naloge, podpis veze id, odgovor mora vrniti isti id`() {
        val n = stanje.naloge.first { it.stanje == "dodeljeno" }
        val pov = Lazna(OdgovorLine.Ok("""{"id":"0123456789abcdef"}"""))
        val ids = mutableListOf<String>()
        assertEquals(IzidAgentov.Preklicano("0123456789abcdef"), AgentiLine.preklici(pov, id, n, 3, e) { i, _, _ -> ids.add(i); "P" })
        assertEquals(listOf("0123456789abcdef"), ids)
        assertEquals("0123456789abcdef", json.parseToJsonElement(pov.preklici.single()).jsonObject["id"]!!.jsonPrimitive.content)
        val koncana = stanje.naloge.first { it.stanje == "koncano" }
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA), AgentiLine.preklici(pov, id, koncana, 3, e) { _, _, _ -> "P" })
        assertEquals(1, pov.preklici.size)
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA),
            AgentiLine.preklici(Lazna(OdgovorLine.Ok("""{"id":"fedcba9876543210"}""")), id, n, 3, e) { _, _, _ -> "P" })
    }

    @Test
    fun `prikaz agenta je iz tabele telefona, ne iz imena v odgovoru`() {
        assertEquals("pi (Pi)", AgentiLine.prikazAgenta("pi"))
        assertEquals("claude (Claude Code)", AgentiLine.prikazAgenta("claude"))
        assertEquals("opencode (opencode (Gemini))", AgentiLine.prikazAgenta("opencode"))
        assertEquals("neznan", AgentiLine.prikazAgenta("neznan"))
        assertTrue(AgentiLine.imeUjema("pi", "Pi"))
        assertFalse(AgentiLine.imeUjema("pi", "Ime pi"))
        assertFalse(AgentiLine.imeUjema("pi", ""))
        assertFalse(AgentiLine.prikazAgenta("pi").contains("Zlobni"))
    }

    @Test
    fun `ciscenje besedila je kot na racunalniku in odstrani nevidne znake`() {
        val ze = "Naredi \"to\"\nin\\ ono č"
        assertEquals(BesediloPodpisa(ze, false), AgentiLine.besediloZaPodpis(ze))
        assertEquals("ab\ncd", AgentiLine.ocistiBesediloNaloge("ab\r\ncd"))
        assertEquals("ab\ncd", AgentiLine.ocistiBesediloNaloge("ab\rcd"))
        assertEquals(BesediloPodpisa("a\nb", true), AgentiLine.besediloZaPodpis("a\r\nb"))
        assertEquals("abc", AgentiLine.ocistiBesediloNaloge("a\u202eb\u200bc"))
        assertEquals("abc", AgentiLine.ocistiBesediloNaloge("a\u3164b\uE000c"))
        assertEquals("ab", AgentiLine.ocistiBesediloNaloge("a\uFEFFb"))
        assertEquals("abc", AgentiLine.ocistiBesediloNaloge("\u00A0abc\u00A0"))
        assertEquals("\u00e9", AgentiLine.ocistiBesediloNaloge("e\u0301"))
        assertEquals("ab", AgentiLine.ocistiBesediloNaloge("a\u034Fb"))
        assertEquals("ab", AgentiLine.ocistiBesediloNaloge("a\uFE0Fb"))
        val oznaka = StringBuilder("a").appendCodePoint(0xE0001).append("b").toString()
        assertEquals("ab", AgentiLine.ocistiBesediloNaloge(oznaka))
        val pua = StringBuilder("a").appendCodePoint(0xF0000).append("b").toString()
        assertEquals("ab", AgentiLine.ocistiBesediloNaloge(pua))
        assertEquals("a\tb", AgentiLine.ocistiBesediloNaloge("a\tb"))
        assertNull(AgentiLine.ocistiBesediloNaloge("  \n "))
        assertNull(AgentiLine.ocistiBesediloNaloge("pol\uD800"))
        assertNull(AgentiLine.ocistiBesediloNaloge("a".repeat(8001)))
        assertNull(AgentiLine.besediloZaPodpis("  \n "))
    }

    @Test
    fun `dodelitev ne podpise cudnega imena ali neociscenega besedila, podpise samo ocisceno`() {
        val pov = Lazna(OdgovorLine.Ok("""{"id":"00112233aabbccdd"}"""))
        var klicev = 0
        fun d(s: StanjeAgentov = stanje, besedilo: String = "x") =
            AgentiLine.dodeli(pov, id, s, "pi", "/dom/projekt", besedilo, "zdaj", 9, e) { _, _, _ -> klicev++; "P" }
        val tuje = AgentiLine.razcleni(odgovor().replace("\"ime\":\"Pi\"", "\"ime\":\"Zlobni\""))!!
        val prazno = AgentiLine.razcleni(odgovor().replace("\"ime\":\"Pi\"", "\"ime\":\"\""))!!
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA), d(tuje))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA), d(prazno))
        assertEquals(IzidAgentov.Napaka(NapakaGradenj.NAPAKA), d(besedilo = "a\r\nb"))
        assertEquals(0, klicev)
        val cisto = AgentiLine.besediloZaPodpis("a\r\nb")!!
        assertEquals("a\nb", cisto.besedilo)
        assertTrue(cisto.drugic)
        assertEquals(IzidAgentov.Dodeljeno("00112233aabbccdd"), d(besedilo = cisto.besedilo))
        assertEquals(1, klicev)
        assertTrue(pov.dodelitve.single().contains("\"besedilo\":\"a\\nb\""))
        assertFalse(pov.dodelitve.single().contains("\\r"))
    }
}
