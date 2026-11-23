package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Dodatki na racunalniku s telefona (23. 11. 2026): nizi (skupni vektor s TS), telesa, stroga razclenitev in napake. */
class DodatkiLineTest {
    private val id = "n-0123456789abcdef"
    private val e = "enkratni-dodatki-01"

    @Test
    fun `nizi so isti kot v Lini (dodatki-telefon test, skupni vektor)`() {
        // Isti dobesedni niz preverja dodatki-telefon.test.ts (»skupni vektor nizov«) nad kanal-claude.ts.
        assertEquals("safeer-lina-dodatki-stanje-v1\n$id\n1763900000000\n$e", NiziLine.nizStanjaDodatkov(id, 1763900000000, e))
        assertEquals("safeer-lina-dodatek-v1\n$id\nn8n\nvklopi\n1763900000000\n$e", NiziLine.nizDodatka(id, "n8n", true, 1763900000000, e))
        assertEquals("safeer-lina-dodatek-v1\n$id\nslovenski\nizklopi\n1763900000000\n$e", NiziLine.nizDodatka(id, "slovenski", false, 1763900000000, e))
    }

    @Test
    fun `niz dodatka ne nastane za neznan dodatek ali neveljavna polja`() {
        assertNull(NiziLine.nizDodatka(id, "programi", true, 1, e))
        assertNull(NiziLine.nizDodatka(id, "n8n\nvklopi", true, 1, e))
        assertNull(NiziLine.nizDodatka("tuj", "n8n", true, 1, e))
        assertNull(NiziLine.nizStanjaDodatkov(id, 0, e))
        assertNull(NiziLine.nizStanjaDodatkov(id, 1, "kratek"))
    }

    @Test
    fun `podpisnik podpise samo niz z lastno predpono in svojim id-jem`() {
        val podpisano = mutableListOf<String>()
        val p = Podpisnik({ b -> podpisano.add(String(b, Charsets.UTF_8)); "PODPIS" }, { id })
        assertEquals("PODPIS", p.podpisiDodatek("affine", true, 5, e))
        assertEquals("PODPIS", p.podpisiStanjeDodatkov(5, e))
        assertNull(p.podpisiDodatek("docker", true, 5, e))
        assertEquals(listOf("safeer-lina-dodatek-v1\n$id\naffine\nvklopi\n5\n$e", "safeer-lina-dodatki-stanje-v1\n$id\n5\n$e"), podpisano)
    }

    private val dobro = """{"dodatki":[{"id":"paperclip","vklopljen":false,"stanje":"izklopljen","razlog":""},
        {"id":"n8n","vklopljen":true,"stanje":"deluje","razlog":""},{"id":"affine","vklopljen":false,"stanje":"ni_na_voljo","razlog":""},
        {"id":"slovenski","vklopljen":true,"stanje":"napaka","razlog":"namestitev-ni-uspela"}]}"""

    @Test
    fun `razclenitev sprejme samo znane dodatke in stanja`() {
        val d = DodatkiLine.razcleni(dobro)!!
        assertEquals(4, d.size)
        assertEquals(DodatekRacunalnika("slovenski", true, "napaka", "namestitev-ni-uspela"), d[3])
        for (s in listOf(
            """{"dodatki":[{"id":"docker","vklopljen":true,"stanje":"deluje","razlog":""}]}""",
            """{"dodatki":[{"id":"n8n","vklopljen":"true","stanje":"deluje","razlog":""}]}""",
            """{"dodatki":[{"id":"n8n","vklopljen":true,"stanje":"tece","razlog":""}]}""",
            """{"dodatki":[{"id":"n8n","vklopljen":true,"stanje":"deluje","razlog":"<b>poglej</b>"}]}""",
            """{"dodatki":[{"id":"n8n","vklopljen":true,"stanje":"deluje"},{"id":"n8n","vklopljen":false,"stanje":"izklopljen"}]}""",
            """{"x":1}""", "ni json", "x".repeat(AsistentProtokol.NAJVEC_ODGOVORA + 1),
        )) assertNull(DodatkiLine.razcleni(s), s.take(60))
    }

    /** Lazna povezava: zapise klice in vrne pripravljen odgovor. */
    private class Lazna(val odgovor: OdgovorLine) : PovezavaZLino {
        val stanja = mutableListOf<List<Any>>()
        val preklopi = mutableListOf<String>()
        override fun stanjeDodatkov(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine { stanja.add(listOf(posiljatelj, cas, enkratni, podpis)); return odgovor }
        override fun dodatek(telo: String): OdgovorLine { preklopi.add(telo); return odgovor }
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
    fun `stanje in preklop podpiseta in posljeta, napake so locene`() {
        val ok = Lazna(OdgovorLine.Ok(dobro))
        assertTrue(DodatkiLine.stanje(ok, id, 7, e) { c, x -> "P$c$x" } is IzidDodatkov.Ok)
        assertEquals(listOf<Any>(id, 7L, e, "P7$e"), ok.stanja.single())
        val podpisani = mutableListOf<String>()
        val r = DodatkiLine.preklopi(ok, id, "n8n", false, 8, e) { d, v, c, x -> podpisani.add("$d$v$c$x"); "SIG" }
        assertEquals(4, (r as IzidDodatkov.Ok).dodatki.size)
        assertEquals(listOf("n8nfalse8$e"), podpisani)
        assertEquals("""{"posiljatelj":"$id","dodatek":"n8n","vklop":false,"cas":8,"enkratni":"$e","podpis":"SIG"}""", ok.preklopi.single())

        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.NEDOSEGLJIV), DodatkiLine.stanje(Lazna(OdgovorLine.Nedosegljiva), id, 1, e) { _, _ -> "P" })
        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.ZAVRNJENO), DodatkiLine.stanje(Lazna(OdgovorLine.Napaka(403, "zavrnjeno")), id, 1, e) { _, _ -> "P" })
        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.STARA_LINA), DodatkiLine.stanje(Lazna(OdgovorLine.Napaka(404, "ni")), id, 1, e) { _, _ -> "P" })
        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.PREVEC), DodatkiLine.stanje(Lazna(OdgovorLine.Napaka(429, "prevec")), id, 1, e) { _, _ -> "P" })
        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.NAPAKA), DodatkiLine.stanje(Lazna(OdgovorLine.Ok("{}")), id, 1, e) { _, _ -> "P" })

        val brez = Lazna(OdgovorLine.Ok(dobro))
        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.NAPAKA), DodatkiLine.stanje(brez, id, 1, e) { _, _ -> null })
        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.NAPAKA), DodatkiLine.preklopi(brez, id, "programi", true, 1, e) { _, _, _, _ -> "SIG" })
        assertTrue(brez.stanja.isEmpty() && brez.preklopi.isEmpty(), "brez podpisa ali z neznanim dodatkom se nic ne poslje")
    }

    @Test
    fun `privzeta povezava brez poti dodatkov je kot stara Lina`() {
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
        assertEquals(IzidDodatkov.Napaka(NapakaDodatkov.STARA_LINA), DodatkiLine.stanje(stara, id, 1, e) { _, _ -> "P" })
    }
}
