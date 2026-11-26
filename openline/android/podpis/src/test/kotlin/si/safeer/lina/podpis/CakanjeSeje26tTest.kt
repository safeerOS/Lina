package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals

/** Naloga 26t: CRA3 (rok po podpisu) in vrstni red klicev pred POST (preizkus lastnosti v samostojna ga ponovi). */
class CakanjeSeje26tTest {
    private val odprta = """{"claudeCode":"odprta","rele":"n-0123456789abcdef"}"""
    private val id = "id-naloge-26t-abcdefghijklmno"

    private class Lazni(val dnevnik: MutableList<String>) : PovezavaZLino {
        override fun naloga(telo: String): OdgovorLine { dnevnik += "POST"; return OdgovorLine.Ok("""{"id":"x"}""") }
        override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine {
            dnevnik += "stanje"; return OdgovorLine.Ok("""{"claudeCode":"odprta","rele":"n-0123456789abcdef"}""")
        }
        override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) = OdgovorLine.Nedosegljiva
        override fun klici(telo: String) = OdgovorLine.Nedosegljiva
        override fun sinhron(telo: String) = OdgovorLine.Nedosegljiva
        override fun odobritev(telo: String) = OdgovorLine.Nedosegljiva
        override fun ustavi(telo: String) = OdgovorLine.Nedosegljiva
        override fun seznani(telo: String) = OdgovorLine.Nedosegljiva
        override fun stanjeSeznanitve(koda: String) = OdgovorLine.Nedosegljiva
    }

    private fun odv(d: MutableList<String>, ura: LongArray, zacetek: Long, podpisTraja: Long = 0, preklicano: () -> Boolean = { false },
                    predOddajo: () -> Unit = {}) = CakanjeSeje.Odvisnosti(
        pov = Lazni(d), posiljatelj = "n-00112233aabbccdd",
        podpisiStanje = { c, e -> "ps-$c-$e" },
        podpisiNalogo = { c, e -> d += "podpis"; ura[0] += podpisTraja; PodpisanaNaloga(id, "n-00112233aabbccdd", "Naredi X", c, e, "pn") },
        nakljucno = { "e".repeat(32) }, zdaj = { ura[0] }, spi = { ura[0] += it },
        preklicano = { d += "preklicano"; preklicano() }, zacetek = zacetek, predOddajo = { d += "oznaka"; predOddajo() },
    )

    // CRA3: ostane 4 s, podpis (KeyStore) traja 5 s - naloga ne sme oditi po roku in oznaka se ne zapise.
    @Test fun `CRA3 - podpis prestopi rok - brez oznake in brez oddaje`() {
        val d = mutableListOf<String>()
        val ura = longArrayOf(1_000_000L)
        val izid = CakanjeSeje.pocakajInOddaj(odv(d, ura, zacetek = ura[0] - CakanjeSeje.ROK_MS + CakanjeSeje.RAZMIK_MS + 1_000, podpisTraja = 5_000))
        assertEquals(CakanjeSeje.Izid.Rok(null), izid)
        assertEquals(0, d.count { it == "POST" }, "naloga je odsla po roku: $d")
        assertEquals(0, d.count { it == "oznaka" }, "oznaka zapisana za nalogo, ki ne sme oditi: $d")
    }

    @Test fun `podpis pred rokom - ena oddaja (kontrola)`() {
        val d = mutableListOf<String>()
        val ura = longArrayOf(1_000_000L)
        val izid = CakanjeSeje.pocakajInOddaj(odv(d, ura, zacetek = ura[0] - CakanjeSeje.ROK_MS + CakanjeSeje.RAZMIK_MS + 10_000, podpisTraja = 5_000))
        assertEquals(true, izid is CakanjeSeje.Izid.Oddana)
        assertEquals(1, d.count { it == "POST" })
    }

    // Vrstni red, ki ga ponovi Naloga26tLastnostiTest (Ev.Oznaci, Ev.Poslji): preklicano po oznaki je zadnja vrata pred POST.
    @Test fun `vrstni red - preklicano, stanje, preklicano, podpis, preklicano, oznaka, preklicano, POST`() {
        val d = mutableListOf<String>()
        val ura = longArrayOf(1_000_000L)
        CakanjeSeje.pocakajInOddaj(odv(d, ura, zacetek = ura[0]))
        assertEquals(listOf("preklicano", "preklicano", "stanje", "preklicano", "podpis", "preklicano", "oznaka", "preklicano", "POST"), d)
    }

    // CRA4: kontroler pod zaklepom zavrne oznako (mesto ni vec te naloge) - preverba po oznaki ustavi POST.
    @Test fun `CRA4 - zavrnjena oznaka - brez oddaje`() {
        val d = mutableListOf<String>()
        val ura = longArrayOf(1_000_000L)
        var zavrnjena = false
        val izid = CakanjeSeje.pocakajInOddaj(odv(d, ura, zacetek = ura[0], preklicano = { zavrnjena }, predOddajo = { zavrnjena = true }))
        assertEquals(CakanjeSeje.Izid.Preklicano, izid)
        assertEquals(0, d.count { it == "POST" }, "naloga z zavrnjeno oznako je odsla: $d")
    }
}
