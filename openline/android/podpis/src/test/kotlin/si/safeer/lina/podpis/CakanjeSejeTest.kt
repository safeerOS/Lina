package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Naloga 23t: ob 503 claude-code-ni z zagon == "odpira" telefon caka na sejo (podpisan GET /stanje vsake 3 s, najvec 3 min) in
 * nalogo poslje ENKRAT znova z novim podpisom. Oblika odgovorov je ista kot v asistent-streznik.server.ts (naloga, stanjeSeje).
 */
class CakanjeSejeTest {
    private val odpira503 = """{"napaka":"claude-code-ni","sporocilo":"Seja Claude Code na racunalniku ni odprta ali ni dosegljiva.","stanje":{"claudeCode":"zaprta","zagon":"odpira"}}"""
    private val zaprta = """{"claudeCode":"zaprta"}"""
    private val odprta = """{"claudeCode":"odprta","rele":"n-0123456789abcdef"}"""

    /** Lazni odjemalec: /stanje vraca vnaprej dolocene odgovore, /naloga zapise vsako oddajo. */
    private class Lazni(val stanja: ArrayDeque<OdgovorLine>, val naNalogo: OdgovorLine = OdgovorLine.Ok("""{"id":"x"}""")) : PovezavaZLino {
        val oddaje = mutableListOf<String>()
        val poizvedbe = mutableListOf<Pair<Long, String>>()
        override fun naloga(telo: String): OdgovorLine { oddaje += telo; return naNalogo }
        override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine {
            poizvedbe += cas to enkratni
            return stanja.removeFirstOrNull() ?: OdgovorLine.Ok("""{"claudeCode":"zaprta"}""")
        }
        override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) = OdgovorLine.Nedosegljiva
        override fun klici(telo: String) = OdgovorLine.Nedosegljiva
        override fun sinhron(telo: String) = OdgovorLine.Nedosegljiva
        override fun odobritev(telo: String) = OdgovorLine.Nedosegljiva
        override fun ustavi(telo: String) = OdgovorLine.Nedosegljiva
        override fun seznani(telo: String) = OdgovorLine.Nedosegljiva
        override fun stanjeSeznanitve(koda: String) = OdgovorLine.Nedosegljiva
    }

    private class Ura(var ms: Long = 1_000_000L) { val spanja = mutableListOf<Long>(); fun spi(d: Long) { spanja += d; ms += d } }

    private var stevec = 0
    private val podpisi = mutableListOf<Pair<Long, String>>()
    private fun odvisnosti(p: Lazni, ura: Ura, preklicano: () -> Boolean = { false }) = CakanjeSeje.Odvisnosti(
        pov = p, posiljatelj = "n-00112233aabbccdd",
        podpisiStanje = { c, e -> "ps-$c-$e" },
        podpisiNalogo = { c, e -> podpisi += c to e; PodpisanaNaloga("id-naloge-23t-abcdefghijk", "n-00112233aabbccdd", "Naredi X", c, e, "pn-$c-$e") },
        nakljucno = { "e" + (++stevec).toString().padStart(31, '0') },
        zdaj = { ura.ms }, spi = ura::spi, preklicano = preklicano,
    )

    @Test fun `503 odpira se razcleni iz telesa, cakanje samo za odpira`() {
        assertEquals("odpira", AsistentProtokol.razberiZagon(odpira503))
        assertTrue(CakanjeSeje.cakaj(OdgovorLine.Napaka(503, "claude-code-ni", "odpira")))
        assertFalse(CakanjeSeje.cakaj(OdgovorLine.Napaka(503, "claude-code-ni", "izklopljeno")))
        assertFalse(CakanjeSeje.cakaj(OdgovorLine.Napaka(503, "claude-code-ni", null)), "starejsa Lina brez zagon: kot prej, brez cakanja")
        assertFalse(CakanjeSeje.cakaj(OdgovorLine.Napaka(403, "zavrnjeno", "odpira")))
        assertFalse(CakanjeSeje.cakaj(OdgovorLine.Napaka(503, "drugo", "odpira")))
        // samo znani razlogi (nezaupljiv racunalnik); neznan ali predolg = null
        for (r in listOf("ni-terminala", "ni-claude", "izklopljeno", "opozorilo", "omejitev", "napaka")) {
            assertEquals(r, AsistentProtokol.razberiZagon("""{"napaka":"claude-code-ni","stanje":{"claudeCode":"zaprta","zagon":"$r"}}"""))
        }
        assertNull(AsistentProtokol.razberiZagon("""{"napaka":"claude-code-ni","stanje":{"claudeCode":"zaprta","zagon":"rm -rf"}}"""))
        assertNull(AsistentProtokol.razberiZagon("""{"napaka":"claude-code-ni","stanje":{"claudeCode":"zaprta"}}"""))
        assertNull(AsistentProtokol.razberiZagon("""{"napaka":"claude-code-ni","stanje":{"zagon":1}}"""))
        assertNull(AsistentProtokol.razberiZagon("ni json"))
    }

    @Test fun `503 odpira - stanje 2x zaprta - odprta - ENA ponovna oddaja z novim podpisom`() {
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(zaprta), OdgovorLine.Ok(zaprta), OdgovorLine.Ok(odprta))))
        val ura = Ura()
        // prvi podpis (oddaja pred 503) - ta se ne sme ponoviti
        podpisi += 999_000L to "e-prvi-podpis-00000000000000000"
        val izid = CakanjeSeje.pocakajInOddaj(odvisnosti(p, ura))
        val o = assertIs<CakanjeSeje.Izid.Oddana>(izid)
        assertEquals(1, p.oddaje.size, "naloga gre znova natanko enkrat")
        assertEquals(3, p.poizvedbe.size, "odprta je bila tretja poizvedba")
        assertEquals(listOf(3000L, 3000L, 3000L), ura.spanja, "razmik 3 s")
        assertEquals(2, podpisi.size)
        assertNotEquals(podpisi[0].first, podpisi[1].first, "nov cas")
        assertNotEquals(podpisi[0].second, podpisi[1].second, "nov enkratni niz")
        assertEquals(ura.ms, podpisi[1].first, "podpis nastane sele, ko je seja odprta (cas oddaje)")
        assertTrue(p.oddaje[0].contains("\"podpis\":\"pn-${podpisi[1].first}-${podpisi[1].second}\""), p.oddaje[0])
        // vsaka poizvedba /stanje ima svoj cas in enkratni niz (kanal zavrne ponovljen niz)
        assertEquals(p.poizvedbe.size, p.poizvedbe.map { it.second }.toSet().size)
        assertEquals(p.poizvedbe.size, p.poizvedbe.map { it.first }.toSet().size)
        assertFalse(p.poizvedbe.map { it.second }.contains(podpisi[1].second), "enkratni niz oddaje ni niz poizvedbe")
        assertIs<OdgovorLine.Ok>(o.odgovor)
    }

    @Test fun `rok 3 min brez odprte seje - izid Rok, brez oddaje`() {
        val p = Lazni(ArrayDeque())
        val ura = Ura()
        val zacetek = ura.ms
        val izid = CakanjeSeje.pocakajInOddaj(odvisnosti(p, ura))
        assertEquals(CakanjeSeje.Izid.Rok(null), izid)
        assertEquals(0, p.oddaje.size)
        assertEquals(0, podpisi.size, "naloga ni bila niti podpisana")
        assertTrue(ura.ms - zacetek in CakanjeSeje.ROK_MS..CakanjeSeje.ROK_MS + CakanjeSeje.RAZMIK_MS, "${ura.ms - zacetek}")
        assertEquals((CakanjeSeje.ROK_MS / CakanjeSeje.RAZMIK_MS).toInt(), p.poizvedbe.size)
        // nedosegljiv racunalnik med cakanjem ni konec - caka do roka
        val p2 = Lazni(ArrayDeque(List(5) { OdgovorLine.Nedosegljiva }))
        assertEquals(CakanjeSeje.Izid.Rok(null), CakanjeSeje.pocakajInOddaj(odvisnosti(p2, Ura())))
        assertEquals(0, p2.oddaje.size)
    }

    @Test fun `razlog iz stanja (ce ga racunalnik poslje) konca cakanje takoj, brez oddaje`() {
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(zaprta), OdgovorLine.Ok("""{"claudeCode":"zaprta","zagon":"ni-terminala"}"""))))
        val izid = CakanjeSeje.pocakajInOddaj(odvisnosti(p, Ura()))
        assertEquals(CakanjeSeje.Izid.Rok("ni-terminala"), izid)
        assertEquals(2, p.poizvedbe.size)
        assertEquals(0, p.oddaje.size)
    }

    @Test fun `preklic med cakanjem - stara naloga se ne poslje, tudi ce je seja ze odprta`() {
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(zaprta), OdgovorLine.Ok(odprta))))
        var preklic = false
        val ura = Ura()
        val d = odvisnosti(p, ura) { preklic }
        val ovita = d.copy(pov = object : PovezavaZLino by p {
            override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine =
                p.stanjeSeje(posiljatelj, cas, enkratni, podpis).also { if (p.poizvedbe.size == 2) preklic = true } // lastnik preklice tik pred oddajo
        })
        assertEquals(CakanjeSeje.Izid.Preklicano, CakanjeSeje.pocakajInOddaj(ovita))
        assertEquals(0, p.oddaje.size)
        assertEquals(0, podpisi.size)
        // preklic pred prvo poizvedbo: niti /stanje se ne poklice
        val p2 = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(odprta))))
        assertEquals(CakanjeSeje.Izid.Preklicano, CakanjeSeje.pocakajInOddaj(odvisnosti(p2, Ura()) { true }))
        assertEquals(0, p2.poizvedbe.size); assertEquals(0, p2.oddaje.size)
    }

    @Test fun `503 izklopljeno - brez cakanja (ni poizvedb, ni oddaje)`() {
        // klicatelj (kontroler) caka samo, ce cakaj() vrne true; ostali razlogi gredo takoj v sporocilo
        assertFalse(CakanjeSeje.cakaj(OdgovorLine.Napaka(503, "claude-code-ni", AsistentProtokol.razberiZagon(
            """{"napaka":"claude-code-ni","stanje":{"claudeCode":"zaprta","zagon":"izklopljeno"}}"""))))
    }

    @Test fun `ponovna oddaja dobi znova 503 - izid nosi odgovor, ni drugega kroga`() {
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(odprta))), naNalogo = OdgovorLine.Napaka(503, "claude-code-ni", "odpira"))
        val o = assertIs<CakanjeSeje.Izid.Oddana>(CakanjeSeje.pocakajInOddaj(odvisnosti(p, Ura())))
        assertEquals(OdgovorLine.Napaka(503, "claude-code-ni", "odpira"), o.odgovor)
        assertEquals(1, p.oddaje.size)
        assertEquals(1, p.poizvedbe.size)
    }

    @Test fun `kljuc naprave ne podpise ponovne oddaje - brez oddaje`() {
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(odprta))))
        val d = odvisnosti(p, Ura()).copy(podpisiNalogo = { _, _ -> null })
        assertEquals(CakanjeSeje.Izid.BrezPodpisa, CakanjeSeje.pocakajInOddaj(d))
        assertEquals(0, p.oddaje.size)
    }

    @Test fun `oznaka pred oddajo natanko enkrat in pred POST, rok po obnovi tece od prvega zacetka`() {
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(zaprta), OdgovorLine.Ok(odprta))))
        val dogodki = mutableListOf<String>()
        val ovita = object : PovezavaZLino by p {
            override fun naloga(telo: String): OdgovorLine { dogodki += "POST"; return p.naloga(telo) }
        }
        val d = odvisnosti(p, Ura()).copy(pov = ovita, predOddajo = { dogodki += "oznaka" })
        assertIs<CakanjeSeje.Izid.Oddana>(CakanjeSeje.pocakajInOddaj(d))
        assertEquals(listOf("oznaka", "POST"), dogodki)
        // brez oddaje (rok) oznake ni
        var oznak = 0
        CakanjeSeje.pocakajInOddaj(odvisnosti(Lazni(ArrayDeque()), Ura()).copy(predOddajo = { oznak++ }))
        assertEquals(0, oznak)
        // obnova po zasuku: zacetek pred 170 s -> se najvec ~10 s cakanja (ne novih 3 min)
        val ura = Ura()
        val p3 = Lazni(ArrayDeque())
        assertEquals(CakanjeSeje.Izid.Rok(null), CakanjeSeje.pocakajInOddaj(odvisnosti(p3, ura).copy(zacetek = ura.ms - 170_000)))
        assertTrue(p3.poizvedbe.size in 3..4, "${p3.poizvedbe.size}")
    }

    @Test fun `ponovna oddaja z istim id - 409 obstaja pomeni, da jo racunalnik ze ima (ne nova oddaja)`() {
        assertTrue(CakanjeSeje.sprejeta(OdgovorLine.Ok("""{"id":"x"}""")))
        assertTrue(CakanjeSeje.sprejeta(OdgovorLine.Napaka(409, "obstaja")))
        assertFalse(CakanjeSeje.sprejeta(OdgovorLine.Napaka(409, "drugo")))
        assertFalse(CakanjeSeje.sprejeta(OdgovorLine.Napaka(503, "claude-code-ni", "odpira")))
        assertFalse(CakanjeSeje.sprejeta(OdgovorLine.Nedosegljiva))
    }

    @Test fun `preklic, ki pride med oddajo - sprejeto staro nalogo je treba ustaviti`() {
        val n = PodpisanaNaloga("id-naloge-23t-abcdefghijk", "n-00112233aabbccdd", "Naredi X", 1L, "e", "p")
        assertEquals(n.id, CakanjeSeje.ustaviPoPreklicu(CakanjeSeje.Izid.Oddana(n, OdgovorLine.Ok("{}"))))
        assertEquals(n.id, CakanjeSeje.ustaviPoPreklicu(CakanjeSeje.Izid.Oddana(n, OdgovorLine.Napaka(409, "obstaja"))))
        assertNull(CakanjeSeje.ustaviPoPreklicu(CakanjeSeje.Izid.Oddana(n, OdgovorLine.Napaka(503, "claude-code-ni", "odpira"))))
        assertNull(CakanjeSeje.ustaviPoPreklicu(CakanjeSeje.Izid.Rok(null)))
        assertNull(CakanjeSeje.ustaviPoPreklicu(CakanjeSeje.Izid.Preklicano))
        // izid neznan (zahteva oddana, odgovora ni): morda sprejeta - ustavitev je varnejsa od tisine
        assertEquals(n.id, CakanjeSeje.ustaviPoPreklicu(CakanjeSeje.Izid.Oddana(n, IzidOddaje.poNapaki(oddano = true, spreminja = true))))
    }

    @Test fun `med cakanjem je gumb Ustavi viden, nova naloga ostane mogoca`() {
        val s = AsistentPrikaz.izracunaj(StanjeAsistenta(seznanjen = true, nalogaTece = false, odprtaOdobritev = null, cakaSejo = true))
        assertTrue(s.ustavi, "lastnik lahko preklice cakajoco nalogo")
        assertTrue(s.vnos && s.poslji, "lastnik lahko posreduje drugo nalogo")
        val brez = AsistentPrikaz.izracunaj(StanjeAsistenta(seznanjen = true, nalogaTece = false, odprtaOdobritev = null))
        assertFalse(brez.ustavi)
    }
}
