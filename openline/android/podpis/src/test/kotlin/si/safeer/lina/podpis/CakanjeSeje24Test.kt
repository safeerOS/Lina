package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** Naloga 24 (najdbe CodeRabbit CR3, CR5, CR6 na 0.2.14): vsak preizkus brez popravka pade. */
class CakanjeSeje24Test {
    private val odprta = """{"claudeCode":"odprta","rele":"n-0123456789abcdef"}"""
    private val id = "id-naloge-24-abcdefghijklmno"

    /** /stanje vraca [stanja] (po vrsti) in vsaka poizvedba traja [trajanje] ms; /naloga zapise oddajo. */
    private class Lazni(val stanja: ArrayDeque<OdgovorLine>, val ura: Ura, val trajanje: Long = 0) : PovezavaZLino {
        val oddaje = mutableListOf<String>()
        override fun naloga(telo: String): OdgovorLine { oddaje += telo; return OdgovorLine.Ok("""{"id":"x"}""") }
        override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine {
            ura.ms += trajanje
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

    private class Ura(var ms: Long = 1_000_000L) { fun spi(d: Long) { ms += d } }

    private var stevec = 0
    private fun odvisnosti(p: Lazni, ura: Ura, zacetek: Long, preklicano: () -> Boolean = { false },
                           podpisi: () -> Unit = {}, predOddajo: () -> Unit = {}) = CakanjeSeje.Odvisnosti(
        pov = p, posiljatelj = "n-00112233aabbccdd",
        podpisiStanje = { c, e -> "ps-$c-$e" },
        podpisiNalogo = { c, e -> podpisi(); PodpisanaNaloga(id, "n-00112233aabbccdd", "Naredi X", c, e, "pn-$c-$e") },
        nakljucno = { "e" + (++stevec).toString().padStart(31, '0') },
        zdaj = { ura.ms }, spi = ura::spi, preklicano = preklicano, zacetek = zacetek, predOddajo = predOddajo,
    )

    // CR5: zanka zacne pri 179 s, spanje 3 s preseze rok, /stanje nato javi odprto sejo - naloga po roku ne sme oditi.
    @Test fun `CR5 - seja odprta sele po roku (po spanju) - brez oddaje`() {
        val ura = Ura()
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(odprta))), ura)
        val izid = CakanjeSeje.pocakajInOddaj(odvisnosti(p, ura, zacetek = ura.ms - CakanjeSeje.ROK_MS + 1_000))
        assertEquals(CakanjeSeje.Izid.Rok(null), izid)
        assertEquals(0, p.oddaje.size, "naloga je odsla po roku")
    }

    @Test fun `CR5 - pocasna poizvedba stanja preseze rok - brez oddaje`() {
        val ura = Ura()
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(odprta))), ura, trajanje = 20_000)
        val izid = CakanjeSeje.pocakajInOddaj(odvisnosti(p, ura, zacetek = ura.ms - CakanjeSeje.ROK_MS + 10_000))
        assertEquals(CakanjeSeje.Izid.Rok(null), izid)
        assertEquals(0, p.oddaje.size, "naloga je odsla po roku (pocasen /stanje)")
    }

    @Test fun `CR5 - seja odprta pred rokom - ena oddaja ostane`() {
        val ura = Ura()
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(odprta))), ura)
        assertIs<CakanjeSeje.Izid.Oddana>(CakanjeSeje.pocakajInOddaj(odvisnosti(p, ura, zacetek = ura.ms - CakanjeSeje.ROK_MS + 4_000)))
        assertEquals(1, p.oddaje.size)
    }

    // CR6: preklic med podpisovanjem naloge - zastarela naloga ne odide in oznaka oddaje se ne zapise.
    @Test fun `CR6 - preklic med podpisom naloge - brez oddaje in brez oznake`() {
        val ura = Ura()
        val p = Lazni(ArrayDeque(listOf(OdgovorLine.Ok(odprta))), ura)
        var preklic = false
        var oznak = 0
        val izid = CakanjeSeje.pocakajInOddaj(odvisnosti(p, ura, zacetek = ura.ms, preklicano = { preklic },
            podpisi = { preklic = true }, predOddajo = { oznak++ }))
        assertEquals(CakanjeSeje.Izid.Preklicano, izid)
        assertEquals(0, p.oddaje.size, "preklicana naloga je odsla")
        assertEquals(0, oznak, "oznaka oddaje zapisana za nalogo, ki ni odsla")
    }

    // CR3 / CR6: zaslon je zaprt (odgovora ne obdela), lastnik je na novem zaslonu nalogo preklical - nit oddaje jo ustavi sama.
    @Test fun `CR3 - po zaprtju zaslona sprejeta ali neznana oddaja preklicane naloge se ustavi`() {
        val n = PodpisanaNaloga(id, "n-00112233aabbccdd", "Naredi X", 1L, "e".repeat(32), "pn")
        val sprejeta = CakanjeSeje.Izid.Oddana(n, OdgovorLine.Ok("""{"id":"$id"}"""))
        val obstaja = CakanjeSeje.Izid.Oddana(n, OdgovorLine.Napaka(409, "obstaja", null))
        val neznan = CakanjeSeje.Izid.Oddana(n, OdgovorLine.Nedosegljiva)
        assertEquals(id, CakanjeSeje.ustaviPoZaprtju(sprejeta, id))
        assertEquals(id, CakanjeSeje.ustaviPoZaprtju(obstaja, id))
        assertEquals(IzidOddaje.jeNeznan(OdgovorLine.Nedosegljiva), CakanjeSeje.ustaviPoZaprtju(neznan, id) == id)
        // ni preklica ali preklic druge naloge: naloga tece naprej (novi zaslon jo spremlja prek 409)
        assertNull(CakanjeSeje.ustaviPoZaprtju(sprejeta, null))
        assertNull(CakanjeSeje.ustaviPoZaprtju(sprejeta, "druga-naloga-24-abcdefghijk"))
        // racunalnik je ni sprejel (503) ali ni bilo oddaje
        assertNull(CakanjeSeje.ustaviPoZaprtju(CakanjeSeje.Izid.Oddana(n, OdgovorLine.Napaka(503, "claude-code-ni", null)), id))
        assertNull(CakanjeSeje.ustaviPoZaprtju(CakanjeSeje.Izid.Rok(null), id))
        assertNull(CakanjeSeje.ustaviPoZaprtju(CakanjeSeje.Izid.Preklicano, id))
    }
}
