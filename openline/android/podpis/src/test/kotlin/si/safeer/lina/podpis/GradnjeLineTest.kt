package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Gradnje na GitHubu s telefona (24. 11. 2026): nizi (navzkrizno s TS), podpisnik z varovalom opozorila, stroga razclenitev
 * /gradnje, predlog in potrditev (zgostitev telefon izracuna sam), napake.
 */
class GradnjeLineTest {
    private val id = "n-0123456789abcdef"
    private val e = "e".repeat(16)

    @Test
    fun `nizi so dobesedno isti kot vektor v gradnje-telefon test ts`() {
        assertEquals("safeer-lina-gradnje-stanje-v1\n$id\n1\n$e", NiziLine.nizStanjaGradenj(id, 1, e))
        assertEquals("safeer-lina-gradnja-predlog-v1\n$id\ngradnja.yml\nmain\n1\n$e", NiziLine.nizPredlogaGradnje(id, "gradnja.yml", "main", 1, e))
        assertEquals("safeer-lina-gradnja-potrdi-v1\n$id\n0123456789abcdef\n${"f".repeat(64)}\n1\n$e", NiziLine.nizPotrditveGradnje(id, "0123456789abcdef", "f".repeat(64), 1, e))
        assertEquals("safeer-lina-gradnja-apk-v1\n$id\n1\n$e", NiziLine.nizApkGradnje(id, 1, e))
    }

    /**
     * Navzkrizno (24. 11. 2026): nizi in podpisi, ki jih je izracunal Node iz kanal-claude.ts (teki/vektor-gradnje.mts, kljuc P-256
     * samo za ta vektor), Kotlin sestavi bajt za bajtom enako in JCA podpise preveri. Spremenjen niz podpisa ne prestane.
     */
    @Test
    fun `navzkrizni vektor TS - Kotlin, podpis Node preveri JCA`() {
        val kljuc = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7NWyHSO/HbXXtXiVDknvnXRFDa/MUf7hGUWMyAmsxnG7FtQtxs7rVWHjA2sWEVAjotMJmLVL+vf6Oh4AUVLfKw=="
        val n = "n-d4380de681ed3667"
        val ee = "eEeEeEeEeEeEeEeE_-01"
        val c = 1763990000000
        assertEquals(n, KrogKljuc.idIzKljuca(kljuc))
        val primeri = listOf(
            NiziLine.nizStanjaGradenj(n, c, ee) to "MEYCIQDE06D0cAEA/WzT7so0CJFayoShaPorol9W1nuM/p/f4QIhAKGlsFsjTS9ZD8bOD/HSp8xxKtG7z+HHkMBKCTV4wpCO",
            NiziLine.nizPredlogaGradnje(n, "gradnja.yml", "lina-android-namesti-2411", c, ee) to "MEUCIQDzJy8Pqfw9AoqNJPMEcmmxG001Ku3pRln3MtUwflOEpAIgeJLWmsHOUvUAt99iPuIglyJ7Eoe6R0QrqSRQZs1o2SE=",
            NiziLine.nizPotrditveGradnje(n, "0123456789abcdef", "a".repeat(64), c, ee) to "MEUCIQDFVnfpTmqW2jcV1GzMuPopddg8tZLYgPS6hJC1veCvXQIgWLYHORe06popmdOGothbTkmzJo6yn5XNvgZSVHfT4E4=",
            NiziLine.nizApkGradnje(n, c, ee) to "MEUCIGdetlbdDp69uCO3xs8BDD4oHwSEfCab9Se/ddRDXDVrAiEAl8plThIO+tJjtIHdVB5qu0pTseWh0XAhcprrsy7fON8=",
        )
        for ((niz, podpis) in primeri) {
            assertNotNull(niz)
            assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, niz.toByteArray(Charsets.UTF_8), podpis), niz)
            assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, (niz + "x").toByteArray(Charsets.UTF_8), podpis), niz)
        }
        // stanje in apk imata isto obliko, predpona ju loci: podpis stanja ne velja za APK
        assertFalse(KrogKljuc.preveriPodpisSKljucem(kljuc, NiziLine.nizApkGradnje(n, c, ee)!!.toByteArray(Charsets.UTF_8), primeri[0].second))
    }

    @Test
    fun `zgostitev gradnje je ista kot zgostitevGradnje v gradnje-github ts`() {
        val c = "a".repeat(40)
        assertEquals("568d2d5c3e05d4215496a069b13e0bfb1b201c899e19ee6897c7d82c30a2a8e8", GradnjeLine.zgostitev("gradnja.yml", "main", c))
        assertEquals("b5515608d75d0c8d6a615f71270f5962d023298795d6a5da538d56f784fa1103", GradnjeLine.zgostitev("racunalnik.yml", "lina-android-namesti-2411", c))
        assertEquals("da786ae1b4a62668e51dd6287a9f25c2e3fed014d1aff6235ea03f376b0f5b0b", GradnjeLine.zgostitev("gradnja.yml", "dev", c))
        assertEquals("aaaaaaaaaaaa", GradnjeLine.prikazCommita(c))
        assertNull(GradnjeLine.prikazCommita("A".repeat(40)))
        assertNull(GradnjeLine.prikazCommita("a".repeat(39)))
        assertNull(GradnjeLine.prikazCommita(null))
    }

    @Test
    fun `nizi ne nastanejo za neznan tok, slabo vejo, id ali zgostitev`() {
        assertNull(NiziLine.nizPredlogaGradnje(id, "deploy.yml", "main", 1, e))
        for (v in listOf("-main", "a..b", "a//b", "a/.b", "a/", "a.", "x.lock", "a\nb", "a b", "", "a".repeat(101))) {
            assertNull(NiziLine.nizPredlogaGradnje(id, "gradnja.yml", v, 1, e), v)
        }
        assertNotNull(NiziLine.nizPredlogaGradnje(id, "racunalnik.yml", "feature/x-1.2", 1, e))
        assertNull(NiziLine.nizPotrditveGradnje(id, "0123456789ABCDEF", "f".repeat(64), 1, e))
        assertNull(NiziLine.nizPotrditveGradnje(id, "0123456789abcdef", "f".repeat(63), 1, e))
        assertNull(NiziLine.nizApkGradnje("tuj", 1, e))
        assertNull(NiziLine.nizStanjaGradenj(id, 1, "kratek"))
    }

    @Test
    fun `podpisnik brez potrjenega opozorila ne podpise predloga, potrditve, APK, naloge ali nadaljevanja`() {
        val podpisano = mutableListOf<String>()
        var potrjeno = false
        val p = Podpisnik({ b -> podpisano.add(String(b, Charsets.UTF_8)); "PODPIS" }, { id }, { "" }, { potrjeno })
        assertNull(p.podpisiPredlogGradnje("gradnja.yml", "main", 5, e))
        assertNull(p.podpisiPotrditevGradnje("0123456789abcdef", "f".repeat(64), 5, e))
        assertNull(p.podpisiApkGradnje(5, e))
        assertNull(p.podpisiNalogo("naloga-0001-abcdefghijk", "Preveri", 5, e))
        assertNull(p.podpisiNadaljevanje("naloga-0001-abcdefghijk", "Naprej", 5, e))
        assertTrue(podpisano.isEmpty(), "brez Razumem se nic ne podpise")
        // branje stanja in ustavitev ostaneta (varnost: lastnik mora videti in ustaviti tudi brez potrditve)
        assertEquals("PODPIS", p.podpisiStanjeGradenj(5, e))
        assertEquals("PODPIS", p.podpisiUstavitev("naloga-0001-abcdefghijk", 5, e))
        potrjeno = true
        assertEquals("PODPIS", p.podpisiPredlogGradnje("gradnja.yml", "main", 5, e))
        assertEquals("PODPIS", p.podpisiPotrditevGradnje("0123456789abcdef", "f".repeat(64), 5, e))
        assertEquals("PODPIS", p.podpisiApkGradnje(5, e))
        assertNotNull(p.podpisiNalogo("naloga-0001-abcdefghijk", "Preveri", 5, e))
        assertNotNull(p.podpisiNadaljevanje("naloga-0001-abcdefghijk", "Naprej", 5, e))
    }

    @Test
    fun `varovalo, ki vrze izjemo, zapre (fail closed)`() {
        val p = Podpisnik({ "PODPIS" }, { id }, { "" }, { error("shramba ni berljiva") })
        assertNull(p.podpisiPredlogGradnje("gradnja.yml", "main", 5, e))
        assertNull(p.podpisiNalogo("naloga-0001-abcdefghijk", "Preveri", 5, e))
    }

    private val commit = "a".repeat(40)
    private val z = GradnjeLine.zgostitev("gradnja.yml", "main", commit)
    private fun gradnja(
        stanje: String = "koncano", anotacije: String = "[]", mapa: String = "\"/dom/Prejemi/Lina gradnje/2026-11-24 1012-gradnja-main\"",
        zgost: String = z, dodatno: String = "",
    ) = """{"id":"0123456789abcdef","izvor":"telefon","tok":"gradnja.yml","veja":"main","commit":"$commit","zgostitev":"$zgost","stanje":"$stanje",
        "ustvarjeno":"2026-11-24T09:00:00.000Z","potrjeno":"2026-11-24T09:01:00.000Z","prejsnjiTek":5,"tekId":12345,
        "zacetekTeka":"2026-11-24T09:02:00.000Z","konec":"2026-11-24T09:14:00.000Z","zakljucek":"success","anotacije":$anotacije,
        "mapa":$mapa,"datoteke":[{"pot":"app-release.apk","sha256":"${"c".repeat(64)}","velikost":12345678}],
        "paket":{"pot":"app-release.apk","sha256":"${"c".repeat(64)}","velikost":12345678},"podpis":"ujema","razlog":null,
        "obvesceno":true,"ocenaKonca":null,"lahkoNamesti":true$dodatno}"""
    private fun odgovor(g: String = gradnja()) = """{"vklopljeno":true,"geslo":true,"gh":true,
        "tokovi":[{"tok":"gradnja.yml","vrsta":"apk","paket":"si.safeer.lina"},{"tok":"racunalnik.yml","vrsta":"deb","paket":"lina-lupina"}],
        "veje":["main","lina-android-namesti-2411"],"gradnje":[$g]}"""

    @Test
    fun `razclenitev sprejme pravi odgovor in ohrani polno pot ter sha256`() {
        val s = GradnjeLine.razcleni(odgovor())!!
        assertTrue(s.vklopljeno && s.geslo && s.gh)
        assertEquals(listOf("main", "lina-android-namesti-2411"), s.veje)
        assertEquals(2, s.tokovi.size)
        val g = s.gradnje.single()
        assertEquals("/dom/Prejemi/Lina gradnje/2026-11-24 1012-gradnja-main", g.mapa)
        assertEquals("c".repeat(64), g.paket!!.sha256)
        assertEquals(12345678L, g.paket!!.velikost)
        assertEquals("ujema", g.podpis)
        assertTrue(g.lahkoNamesti)
        assertEquals(12345L, g.tekId)
        assertEquals("a".repeat(40), g.commit)
    }

    @Test
    fun `anotacije so golo besedilo brez nevidnih znakov in z mejo dolzine`() {
        val a = """[{"raven":"warning","sporocilo":"Node 20 \u202eje zastarel\u0007  <a href=x>klik</a>","pot":".github/workflows/gradnja.yml"},
            {"raven":"failure","sporocilo":"${"x".repeat(900)}","pot":""}]"""
        val g = GradnjeLine.razcleni(odgovor(gradnja(anotacije = a)))!!.gradnje.single()
        assertEquals("Node 20 je zastarel <a href=x>klik</a>", g.anotacije[0].sporocilo)
        assertEquals(500, g.anotacije[1].sporocilo.length)
        // neznana raven: odgovor se zavrze (nezaupano)
        assertNull(GradnjeLine.razcleni(odgovor(gradnja(anotacije = """[{"raven":"info","sporocilo":"x","pot":""}]"""))))
    }

    @Test
    fun `razclenitev zavrne neznana stanja, slabe id-je, zgostitve, preveliko telo`() {
        for (s in listOf(
            odgovor(gradnja(stanje = "zagnano")),
            odgovor(gradnja(zgost = "z".repeat(64))),
            odgovor(gradnja().replace("\"commit\":\"${"a".repeat(40)}\"", "\"commit\":\"NE\"")),
            odgovor(gradnja().replace("\"0123456789abcdef\"", "\"../../etc\"")),
            odgovor(gradnja().replace("\"izvor\":\"telefon\"", "\"izvor\":\"splet\"")),
            odgovor(gradnja().replace("\"podpis\":\"ujema\"", "\"podpis\":\"da\"")),
            odgovor(gradnja().replace("\"tok\":\"gradnja.yml\"", "\"tok\":\"deploy.yml\"")),
            odgovor(gradnja().replace("\"velikost\":12345678}]", "\"velikost\":-1}]")),
            odgovor(gradnja().replace("\"lahkoNamesti\":true", "\"lahkoNamesti\":\"true\"")),
            odgovor().replace("\"vklopljeno\":true,", ""),
            odgovor().replace("\"main\",", "\"-x\","),
            "{}", "ni json", "x".repeat(GradnjeLine.NAJVEC_ODGOVORA + 1),
        )) assertNull(GradnjeLine.razcleni(s), s.take(80))
    }

    @Test
    fun `ura je po ljubljanskem casu (poletni in zimski cas)`() {
        assertEquals("10:14", GradnjeLine.uraLjubljana("2026-11-24T09:14:00.000Z"))
        assertEquals("11:14", GradnjeLine.uraLjubljana("2026-07-24T09:14:00.000Z"))
        assertNull(GradnjeLine.uraLjubljana("vceraj"))
        assertNull(GradnjeLine.uraLjubljana(null))
    }

    /** Lazna povezava: zapise klice in vrne pripravljen odgovor. */
    private class Lazna(val odgovor: OdgovorLine) : PovezavaZLino {
        val stanja = mutableListOf<List<Any>>()
        val predlogi = mutableListOf<String>()
        val potrditve = mutableListOf<String>()
        override fun stanjeGradenj(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine { stanja.add(listOf(posiljatelj, cas, enkratni, podpis)); return odgovor }
        override fun predlogGradnje(telo: String): OdgovorLine { predlogi.add(telo); return odgovor }
        override fun potrditevGradnje(telo: String): OdgovorLine { potrditve.add(telo); return odgovor }
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
    fun `stanje podpise in vrne razclenjeno, napake so locene, 409 nosi razlog`() {
        val ok = Lazna(OdgovorLine.Ok(odgovor()))
        assertTrue(GradnjeLine.stanje(ok, id, 7, e) { c, x -> "P$c$x" } is IzidGradenj.Stanje)
        assertEquals(listOf<Any>(id, 7L, e, "P7$e"), ok.stanja.single())
        fun st(o: OdgovorLine) = GradnjeLine.stanje(Lazna(o), id, 1, e) { _, _ -> "P" }
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NEDOSEGLJIV), st(OdgovorLine.Nedosegljiva))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.ZAVRNJENO), st(OdgovorLine.Napaka(403, "zavrnjeno")))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.STARA_LINA), st(OdgovorLine.Napaka(404, "ni")))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.STARA_LINA), st(OdgovorLine.Napaka(405, "ni")))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.STARA_LINA), st(OdgovorLine.Napaka(405, null)))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.STARA_LINA), st(OdgovorLine.Napaka(400, "ni")))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), st(OdgovorLine.Napaka(500, null)))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.PREVEC), st(OdgovorLine.Napaka(429, null)))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.RACUNALNIK, "tok-zaseden"), st(OdgovorLine.Napaka(409, "tok-zaseden")))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), st(OdgovorLine.Napaka(409, "<b>")))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), st(OdgovorLine.Ok("{}")))
    }

    @Test
    fun `predlog podpise tok in vejo, neznan tok ali veja zunaj seznama se ne poslje`() {
        val ok = Lazna(OdgovorLine.Ok("""{"id":"0123456789abcdef","zgostitev":"$z"}"""))
        val podpisani = mutableListOf<String>()
        val r = GradnjeLine.predlagaj(ok, id, "gradnja.yml", "main", listOf("main"), 8, e) { t, v, c, x -> podpisani.add("$t|$v|$c|$x"); "SIG" }
        assertEquals(IzidGradenj.Predlog("0123456789abcdef", ""), r, "brez commita zgostitve ne prevzamemo")
        assertEquals(listOf("gradnja.yml|main|8|$e"), podpisani)
        assertEquals("""{"posiljatelj":"$id","tok":"gradnja.yml","veja":"main","cas":8,"enkratni":"$e","podpis":"SIG"}""", ok.predlogi.single())

        val nic = Lazna(OdgovorLine.Ok("{}"))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), GradnjeLine.predlagaj(nic, id, "deploy.yml", "main", listOf("main"), 1, e) { _, _, _, _ -> "SIG" })
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), GradnjeLine.predlagaj(nic, id, "gradnja.yml", "dev", listOf("main"), 1, e) { _, _, _, _ -> "SIG" })
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NI_POTRDITVE), GradnjeLine.predlagaj(nic, id, "gradnja.yml", "main", listOf("main"), 1, e) { _, _, _, _ -> null })
        assertTrue(nic.predlogi.isEmpty())
        // brez commita tujih zgostitev ne prevzamemo
        val tuja = Lazna(OdgovorLine.Ok("""{"id":"0123456789abcdef","zgostitev":"${"b".repeat(64)}"}"""))
        assertEquals(IzidGradenj.Predlog("0123456789abcdef", ""), GradnjeLine.predlagaj(tuja, id, "gradnja.yml", "main", listOf("main"), 1, e) { _, _, _, _ -> "SIG" })
        // commit in zgostitev, ki se ne ujema z izracunom telefona: zavrnjeno, nic se ne podpise naprej
        val lazna = Lazna(OdgovorLine.Ok("""{"id":"0123456789abcdef","zgostitev":"${"b".repeat(64)}","commit":"$commit"}"""))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), GradnjeLine.predlagaj(lazna, id, "gradnja.yml", "main", listOf("main"), 1, e) { _, _, _, _ -> "SIG" })
        val prava = Lazna(OdgovorLine.Ok("""{"id":"0123456789abcdef","zgostitev":"$z","commit":"$commit"}"""))
        assertEquals(IzidGradenj.Predlog("0123456789abcdef", z), GradnjeLine.predlagaj(prava, id, "gradnja.yml", "main", listOf("main"), 1, e) { _, _, _, _ -> "SIG" })
    }

    @Test
    fun `potrditev - samo cakajoca gradnja, zgostitev telefon izracuna iz prikazanega toka, veje in commita`() {
        val g = GradnjeLine.razcleni(odgovor(gradnja(stanje = "caka")))!!.gradnje.single()
        assertEquals(commit.take(12), GradnjeLine.prikazCommita(g.commit))
        val ok = Lazna(OdgovorLine.Ok("""{"id":"0123456789abcdef"}"""))
        val podpisani = mutableListOf<String>()
        assertEquals(IzidGradenj.Potrjeno("0123456789abcdef"), GradnjeLine.potrdi(ok, id, g, 9, e) { i, zz, c, x -> podpisani.add("$i|$zz|$c|$x"); "SIG" })
        assertEquals(listOf("0123456789abcdef|$z|9|$e"), podpisani)
        assertEquals("""{"posiljatelj":"$id","id":"0123456789abcdef","zgostitev":"$z","cas":9,"enkratni":"$e","podpis":"SIG"}""", ok.potrditve.single())

        val nic = Lazna(OdgovorLine.Ok("{}"))
        val koncana = GradnjeLine.razcleni(odgovor(gradnja(stanje = "koncano")))!!.gradnje.single()
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), GradnjeLine.potrdi(nic, id, koncana, 1, e) { _, _, _, _ -> "SIG" })
        // racunalnik poslje zgostitev, ki ne ustreza prikazanemu toku, veji in commitu: telefon ne podpise
        val podtaknjena = g.copy(zgostitev = GradnjeLine.zgostitev("gradnja.yml", "dev", commit))
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), GradnjeLine.potrdi(nic, id, podtaknjena, 1, e) { _, _, _, _ -> "SIG" })
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NAPAKA), GradnjeLine.potrdi(nic, id, g.copy(commit = null), 1, e) { _, _, _, _ -> "SIG" })
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.NI_POTRDITVE), GradnjeLine.potrdi(nic, id, g, 1, e) { _, _, _, _ -> null })
        assertTrue(nic.potrditve.isEmpty())
    }

    @Test
    fun `privzeta povezava brez poti gradenj je kot stara Lina`() {
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
        assertEquals(IzidGradenj.Napaka(NapakaGradenj.STARA_LINA), GradnjeLine.stanje(stara, id, 1, e) { _, _ -> "P" })
    }
}
