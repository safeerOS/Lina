package si.safeer.lina.samostojna

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue

class SinhronLineTest {
    private fun klic(id: String, ime: String = "Miha Horvat") = ZapisKlica(
        id = id, casZacetka = 1000L, stevilka = "+38640111222", trajanjeS = 30, povzetek = "$ime se je oglasil.",
        klicatelj = ime, sporocilo = "Naj ga poklicete nazaj.", sporociloDobesedno = "poklicite me nazaj",
    )

    private fun odgovor(rev: Long, klici: String = "[]", ostane: Boolean = false, pogovor: String = "[]", navodila: String = "null") =
        """{"rev":$rev,"klici":$klici,"pogovor":$pogovor,"navodila":$navodila,"ostane":$ostane}"""

    private fun racKlic(id: String) =
        """{"id":"$id","casZacetka":2000,"stevilka":"+38641222333","trajanjeS":12,"nujno":true,"povzetek":"Racunalnik ga pozna.","nacin":"osebna","klicatelj":"Ana Novak","podjetje":"","sporocilo":"Pokliceta.","sporociloDobesedno":"","brezSporocilaRazlog":""}"""

    @Test
    fun `poslje vrsto, po uspehu jo potrdi in si zapomni revizijo`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        assertTrue(d.dodaj(klic("klic-1")))
        val rev = PomnilniskaShramba()
        val poslano = mutableListOf<String>()
        val ok = SinhronLine.izmenjaj(d, rev, poslji = { telo -> poslano.add(telo); odgovor(5) })
        assertTrue(ok)
        assertEquals(1, poslano.size)
        assertTrue(poslano[0].contains("\"klic-1\"") && poslano[0].contains("\"rev\":0"))
        assertTrue(poslano[0].contains("\"nacin\":\"osebna\""))
        assertTrue(d.cakajociZaSinhronizacijo().isEmpty())
        assertEquals("5:", rev.preberi())
        assertEquals(1, d.seznam().size)
    }

    @Test
    fun `ob neuspehu in neveljavnem odgovoru vrsta ostane`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        d.dodaj(klic("klic-1"))
        val rev = PomnilniskaShramba()
        assertFalse(SinhronLine.izmenjaj(d, rev, poslji = { null }))
        assertFalse(SinhronLine.izmenjaj(d, rev, poslji = { "to ni json" }))
        assertFalse(SinhronLine.izmenjaj(d, rev, poslji = { """{"rev":-4}""" }))
        assertEquals(1, d.cakajociZaSinhronizacijo().size)
        assertNull(rev.preberi())
    }

    @Test
    fun `klic z racunalnika se doda brez vrste, dvojnik se ne podvoji`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        d.dodaj(klic("klic-1"))
        val rev = PomnilniskaShramba("3")
        SinhronLine.izmenjaj(d, rev, poslji = { odgovor(7, "[${racKlic("klic-rac")},${racKlic("klic-1")}]") })
        assertEquals(setOf("klic-1", "klic-rac"), d.seznam().map { it.id }.toSet())
        assertTrue(d.cakajociZaSinhronizacijo().isEmpty())
        assertEquals("Ana Novak", d.seznam().first { it.id == "klic-rac" }.klicatelj)
        assertEquals("Miha Horvat", d.seznam().first { it.id == "klic-1" }.klicatelj)
        assertEquals("7:", rev.preberi())
    }

    @Test
    fun `ce je se vnosov, takoj poizve znova od vrnjene revizije`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        val rev = PomnilniskaShramba()
        val telesa = mutableListOf<String>()
        val odgovori = ArrayDeque(listOf(odgovor(10, "[${racKlic("a")}]", ostane = true), odgovor(12, "[${racKlic("b")}]")))
        assertTrue(SinhronLine.izmenjaj(d, rev, poslji = { telesa.add(it); odgovori.removeFirst() }))
        assertEquals(2, telesa.size)
        assertTrue(telesa[1].contains("\"rev\":10"))
        assertEquals("12:", rev.preberi())
        assertEquals(2, d.seznam().size)
    }

    @Test
    fun `revizija se ne zmanjsa in navodila ter pogovor gredo samo v prvem krogu`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        val rev = PomnilniskaShramba("9")
        val telesa = mutableListOf<String>()
        var navodilo: NavodilaSinhron? = null
        SinhronLine.izmenjaj(
            d, rev,
            navodila = NavodilaSinhron("Bodi kratka.", 55L),
            pogovor = listOf(PogovorSinhron("lastnik", "Zdravo", "2026-11-20T10:00:00.000Z")),
            poslji = { telesa.add(it); odgovor(2, navodila = """{"besedilo":"Z racunalnika","cas":60}""") },
            prejetoNavodilo = { navodilo = it },
        )
        assertEquals("9", rev.preberi())
        assertTrue(telesa[0].contains("Bodi kratka.") && telesa[0].contains("Zdravo"))
        assertEquals("Z racunalnika", navodilo?.besedilo)
    }

    @Test
    fun `neveljaven zapis z racunalnika se zavrne`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        val slab = racKlic("slab").replace("\"+38641222333\"", "\" \"")
        SinhronLine.izmenjaj(d, PomnilniskaShramba(), poslji = { odgovor(1, "[$slab]") })
        assertTrue(d.seznam().isEmpty())
    }

    @Test
    fun `nova epoha racunalnika ponastavi revizijo telefona`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        val rev = PomnilniskaShramba("50:aaaaaaaaaaaaaaaa")
        val telesa = mutableListOf<String>()
        SinhronLine.izmenjaj(d, rev, poslji = { telesa.add(it); """{"epoha":"bbbbbbbbbbbbbbbb","rev":3,"klici":[${racKlic("nov")}],"pogovor":[],"navodila":null,"ostane":false}""" })
        assertTrue(telesa[0].contains("\"epoha\":\"aaaaaaaaaaaaaaaa\""))
        assertEquals("3:bbbbbbbbbbbbbbbb", rev.preberi())
        assertEquals(1, d.seznam().size)
    }

    @Test
    fun `zahteva ima meje bajtov, preostanek gre v naslednjem krogu`() {
        val d = DnevnikKlicev(PomnilniskaShramba())
        repeat(100) { d.dodaj(klic("klic-$it").copy(sporociloDobesedno = "č".repeat(5000))) }
        val telesa = mutableListOf<String>()
        val ok = SinhronLine.izmenjaj(d, PomnilniskaShramba(), poslji = { telesa.add(it); odgovor(1) })
        assertTrue(ok)
        assertTrue(telesa.size > 1)
        assertTrue(telesa.all { it.toByteArray(Charsets.UTF_8).size < 600_000 })
        assertTrue(d.cakajociZaSinhronizacijo().isEmpty())
    }

    @Test
    fun `predolgo polje in osamljen nadomestni znak ne zatakneta sinhronizacije`() {
        val z = klic("klic-x").copy(klicatelj = "A".repeat(400) + "\uD800", sporociloDobesedno = "x".repeat(9000)).zaSinhronizacijo()
        assertEquals(240, z.klicatelj.length)
        assertEquals(6000, z.sporociloDobesedno.length)
        assertEquals("abc", skrajsajZaSinhronizacijo("a\uD800bc", 10))
    }
}
