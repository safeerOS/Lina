package si.safeer.lina.podpis

import si.safeer.lina.seznanitev.KodaLine
import si.safeer.lina.seznanitev.Spake2
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Tok s kodo proti posnetku Line (Spake2.streznik kot koda-seznanitev.ts @a384a3e): napacna cA -> /koda/odpovej in brez
 * /koda/potrdi; nacin B ista koda in isti pair_id; nacin A nova koda na istem pair_id; rok 10 s in meje 429.
 */
class TokKodeTest {
    private val id = "n-e255066f6635ba17"
    private val pairId = "pairVektorK18-0123456_"
    private val odtis = "3f".repeat(32)

    /** Lina: koda (null = lastnik je se ni vtipkal), dnevnik poti; v nacinu B odpoved kodo pozabi (lastnik jo vtipka znova). */
    private inner class Lina(var koda: String?, val nacinB: Boolean = true) : PrenosKode {
        val poti = mutableListOf<String>()
        val telesa = mutableListOf<String>()
        var odgovorOdpovedi: OdgovorLine = OdgovorLine.Ok("""{"stanje":"odpovedano"}""")
        var potrdi: OdgovorLine? = null
        var spakeNapaka: OdgovorLine? = null
        private var s: Spake2? = null
        override fun spake(telo: String): OdgovorLine {
            poti += "spake"; telesa += telo
            spakeNapaka?.let { return it }
            val k = koda ?: return OdgovorLine.Napaka(409, "caka_kodo")
            val pb = Regex("\"pb\":\"([0-9a-f]+)\"").find(telo)!!.groupValues[1]
            val st = Spake2.streznik(k, KodaLine.ID_LINE, id, odtis.toByteArray(), pairId.toByteArray())
            val ca = st.zakljuci(Spake2.hex(pb)); s = st
            return OdgovorLine.Ok("""{"pa":"${Spake2.hex(st.sporocilo())}","ca":"${Spake2.hex(ca)}"}""")
        }
        override fun potrdi(cb: String, mac: String): OdgovorLine {
            poti += "potrdi"
            potrdi?.let { return it }
            return if (s!!.preveri(Spake2.hex(cb))) OdgovorLine.Ok("""{"stanje":"caka"}""") else OdgovorLine.Napaka(401, "napacna_koda")
        }
        override fun odpovej(telo: String): OdgovorLine {
            poti += "odpovej"; telesa += telo
            if (nacinB) koda = null
            return odgovorOdpovedi
        }
    }

    private fun tok(l: Lina, ura: () -> Long = { 0L }) = TokKode(id, pairId, odtis, "kljuc-naprave", l, ura)

    @Test
    fun `napacna cA - takoj odpovej, nikoli potrdi`() {
        val l = Lina("111111")
        assertEquals(IzidKroga.NapacnaKoda, tok(l).krog("482913"))
        assertEquals(listOf("spake", "odpovej"), l.poti)
        assertEquals("""{"pair_id":"$pairId","id":"$id"}""", l.telesa.last())
    }

    @Test
    fun `odpoved z 409 ali 404 se ne ponovi`() {
        for (o in listOf(OdgovorLine.Napaka(409, "manjka_korak"), OdgovorLine.Napaka(404, "prijava_ne_obstaja"))) {
            val l = Lina("111111").apply { odgovorOdpovedi = o }
            val zapis = mutableListOf<String>()
            assertEquals(IzidKroga.NapacnaKoda, TokKode(id, pairId, odtis, "k", l, { 0L }, { zapis += it }).krog("482913"))
            assertEquals(1, l.poti.count { it == "odpovej" }); assertEquals(1, zapis.size)
        }
    }

    @Test
    fun `prava koda - potrdi, brez odpovedi`() {
        val l = Lina("482913")
        assertIs<IzidKroga.Sprejeto>(tok(l).krog("482913"))
        assertEquals(listOf("spake", "potrdi"), l.poti)
    }

    @Test
    fun `nacin B - po napacni kodi isti pair_id in ista koda, caka na ponovni vnos`() {
        val l = Lina("111111") // lastnik se je zatipkal
        var napacnih = 0
        var spanj = 0
        val izid = tok(l).nacinB("482913", Long.MAX_VALUE, spi = { spanj++; if (spanj == 3) l.koda = "482913" }, obNapacni = { napacnih++ })
        assertIs<IzidKroga.Sprejeto>(izid)
        assertEquals(1, napacnih)
        assertEquals(listOf("spake", "odpovej", "spake", "spake", "spake", "potrdi"), l.poti)
        assertTrue(l.telesa.filter { it.contains("\"pb\"") }.all { it.contains("\"pair_id\":\"$pairId\"") })
    }

    @Test
    fun `nacin A - nova koda na istem pair_id, preklic konca`() {
        val l = Lina("482913", nacinB = false)
        val vnosi = ArrayDeque(listOf("482913"))
        assertIs<IzidKroga.Sprejeto>(tok(l).nacinA("111111", Long.MAX_VALUE) { vnosi.removeFirstOrNull() })
        assertEquals(listOf("spake", "odpovej", "spake", "potrdi"), l.poti)
        val l2 = Lina("482913", nacinB = false)
        assertEquals(IzidKroga.Konec(NapakaKode.PREKINJENO), TokKode(id, pairId, odtis, "k", l2).nacinA("111111", Long.MAX_VALUE) { null })
        assertEquals(listOf("spake", "odpovej"), l2.poti)
    }

    @Test
    fun `rok 10 s - po roku potrditve ne poslje, 409 manjka_korak da en nov krog`() {
        var t = 0L
        val l = Lina("482913")
        val tk = TokKode(id, pairId, odtis, "k", object : PrenosKode by l {
            override fun spake(telo: String): OdgovorLine = l.spake(telo).also { t += 0 }
        }, { t.also { t += 9_500 } })
        assertEquals(IzidKroga.NovKrog, tk.krog("482913"))
        assertEquals(listOf("spake"), l.poti, "po roku ni potrditve")
        val l2 = Lina("482913").apply { potrdi = OdgovorLine.Napaka(409, "manjka_korak") }
        assertEquals(IzidKroga.NovKrog, tok(l2).krog("482913"))
        assertEquals(IzidKroga.Konec(NapakaKode.NAPAKA), tok(l2).nacinA("482913", Long.MAX_VALUE) { null })
        assertEquals(listOf("spake", "potrdi", "spake", "potrdi", "spake", "potrdi"), l2.poti, "en sam samodejni nov krog")
    }

    @Test
    fun `429 prevec_poskusov konca prijavo, seznanitev_zaprta je zapora`() {
        val l = Lina("482913").apply { spakeNapaka = OdgovorLine.Napaka(429, "prevec_poskusov") }
        assertEquals(IzidKroga.Konec(NapakaKode.PREVEC), tok(l).nacinB("482913", Long.MAX_VALUE, {}, {}))
        assertEquals(1, l.poti.size)
        val z = Lina("482913").apply { potrdi = OdgovorLine.Napaka(429, "seznanitev_zaprta") }
        assertEquals(IzidKroga.Konec(NapakaKode.ZAPRTO), tok(z).krog("482913"))
        assertEquals(IzidKroga.Konec(NapakaKode.POTEKLO), tok(Lina(null), { 5L }).nacinB("482913", 4L, {}, {}))
    }
}
