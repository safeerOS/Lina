package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import si.safeer.lina.samostojna.soglasja.Izvor
import si.safeer.lina.samostojna.soglasja.Obseg
import si.safeer.lina.samostojna.soglasja.ShrambaSoglasij
import si.safeer.lina.samostojna.soglasja.Soglasje
import si.safeer.lina.samostojna.soglasja.TrajnaSoglasja
import si.safeer.lina.samostojna.soglasja.VrstaDejanja
import si.safeer.lina.samostojna.soglasja.ZapisSoglasij

class SistemskiNadzorTest {

    private class Shramba : ShrambaSoglasij {
        var besedilo = ""
        override fun preberi() = ZapisSoglasij.preberi(besedilo)
        override fun shrani(soglasja: List<Soglasje>) { besedilo = ZapisSoglasij.zapisi(soglasja) }
    }

    private class Scenarij(vararg odgovori: Rezultat) : PonudnikOdjemalec {
        val vrsta = ArrayDeque(odgovori.toList())
        val navodila = mutableListOf<String>()
        override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
            navodila.add(sistemsko)
            return vrsta.removeFirst()
        }
    }

    private class Vir(var vklop: Boolean = true, val b: StanjeBaterije? = StanjeBaterije(42, true)) : SistemskiNadzorVir {
        override fun vklopljen() = vklop
        override fun baterija() = b
    }

    @Test
    fun `razclenitev ne moti`() {
        assertTrue(SistemskiNadzor.razclenjiNeMoti(" vklop ")!!.vklop)
        assertTrue(SistemskiNadzor.razclenjiNeMoti("ON")!!.vklop)
        assertFalse(SistemskiNadzor.razclenjiNeMoti("izklop")!!.vklop)
        assertNull(SistemskiNadzor.razclenjiNeMoti("mogoce"))
        assertNull(SistemskiNadzor.razclenjiNeMoti(""))
    }

    @Test
    fun `razclenitev svetlosti in pretvorba v sistemsko vrednost`() {
        assertEquals(40, SistemskiNadzor.razclenjiSvetlost("40")!!.odstotek)
        assertEquals(100, SistemskiNadzor.razclenjiSvetlost(" 100 % ")!!.odstotek)
        assertEquals(0, SistemskiNadzor.razclenjiSvetlost("0")!!.odstotek)
        for (slabo in listOf("101", "-5", "pol", "40.5", "1000", "")) assertNull(SistemskiNadzor.razclenjiSvetlost(slabo), slabo)
        assertEquals(1, SistemskiNadzor.vSistemsko(0), "0 % ne sme dati crnega zaslona")
        assertEquals(128, SistemskiNadzor.vSistemsko(50))
        assertEquals(255, SistemskiNadzor.vSistemsko(100))
        assertEquals(255, SistemskiNadzor.vSistemsko(500))
        assertEquals(1, SistemskiNadzor.vSistemsko(-3))
    }

    @Test
    fun `opis baterije`() {
        assertEquals("baterija telefona je napolnjena 42 % in se polni", SistemskiNadzor.opisBaterije(StanjeBaterije(42, true)))
        assertTrue(SistemskiNadzor.opisBaterije(StanjeBaterije(7, false)).endsWith("se ne polni"))
        assertEquals("stanje baterije ni znano", SistemskiNadzor.opisBaterije(null))
        assertEquals("stanje baterije ni znano", SistemskiNadzor.opisBaterije(StanjeBaterije(-1, false)))
    }

    @Test
    fun `budilka - enkratna potrditev velja naprej, preklic spet vprasa`() {
        val soglasja = TrajnaSoglasja(Shramba())
        val v = SistemskiNadzor.vrsta(Odgovor.NovaBudilka(6, 0, "", emptyList()))!!
        assertEquals(VrstaDejanja.NASTAVI_BUDILKO, v)
        assertTrue(SistemskiNadzor.ponudiZaPodobne(v))
        assertTrue(SistemskiNadzor.potrebnaPotrditev(v, soglasja, poOrodjih = false))
        soglasja.dodaj(v, SistemskiNadzor.OBSEG, Izvor.UPORABNIK_V_APLIKACIJI, 1L)
        assertFalse(SistemskiNadzor.potrebnaPotrditev(v, soglasja, poOrodjih = false))
        assertTrue(SistemskiNadzor.potrebnaPotrditev(v, soglasja, poOrodjih = true), "po spletu/koledarju vedno vprasa")
        soglasja.odstrani(v)
        assertTrue(SistemskiNadzor.potrebnaPotrditev(v, soglasja, poOrodjih = false))
    }

    @Test
    fun `ne moti in svetlost vedno vprasata in ne ponudita trajnega soglasja`() {
        val shramba = Shramba()
        val soglasja = TrajnaSoglasja(shramba)
        for (o in listOf(Odgovor.NeMoti(true), Odgovor.Svetlost(30))) {
            val v = SistemskiNadzor.vrsta(o)!!
            assertEquals(VrstaDejanja.SPREMEMBA_NASTAVITEV_ALI_DOSTOPA, v)
            assertFalse(SistemskiNadzor.ponudiZaPodobne(v))
            // tudi rocno vpisano soglasje ne velja
            shramba.besedilo = "SPREMEMBA_NASTAVITEV_ALI_DOSTOPA\t*\t1"
            assertTrue(SistemskiNadzor.potrebnaPotrditev(v, soglasja, poOrodjih = false))
        }
        assertNull(SistemskiNadzor.vrsta(Odgovor.Besedilo("x")))
    }

    @Test
    fun `zapis soglasij - povratno, visoko tvegana in pokvarjena vrstica se zavrzejo`() {
        val s = listOf(Soglasje(VrstaDejanja.NASTAVI_BUDILKO, SistemskiNadzor.OBSEG, 5L), Soglasje(VrstaDejanja.USTVARI_ZAPISEK, Obseg.VSE, 7L))
        assertEquals(s, ZapisSoglasij.preberi(ZapisSoglasij.zapisi(s)))
        assertEquals("", ZapisSoglasij.zapisi(listOf(Soglasje(VrstaDejanja.DENAR, Obseg.VSE, 1L))))
        assertEquals("", ZapisSoglasij.zapisi(listOf(Soglasje(VrstaDejanja.NASTAVI_BUDILKO, Obseg("a\tb"), 1L))))
        val pokvarjeno = "DENAR\t*\t1\nNEZNANO\t*\t1\nNASTAVI_BUDILKO\t*\tx\nNASTAVI_BUDILKO\t\t1\nkar nekaj\n\nNASTAVI_BUDILKO\tlina-telefon\t9"
        assertEquals(listOf(Soglasje(VrstaDejanja.NASTAVI_BUDILKO, SistemskiNadzor.OBSEG, 9L)), ZapisSoglasij.preberi(pokvarjeno))
        assertEquals(emptyList<Soglasje>(), ZapisSoglasij.preberi(null))
    }

    @Test
    fun `asistent - vrstici ne moti in svetlost postaneta predlog, navodilo ima baterijo`() {
        val s = Scenarij(Rezultat.Besedilo("Predlagam.\n[[nemoti: vklop]]"), Rezultat.Besedilo("Predlagam.\n[[svetlost: 30]]"))
        val a = Asistent(s, "S", sistem = Vir())
        val o1 = a.povej("Vklopi ne moti")
        assertTrue(o1 is Odgovor.NeMoti && o1.vklop)
        val o2 = a.povej("Zatemni zaslon")
        assertTrue(o2 is Odgovor.Svetlost && o2.odstotek == 30)
        assertFalse(a.zadnjiObratPoOrodjih)
        assertTrue(s.navodila[0].contains("42 %") && s.navodila[0].contains("[[nemoti:"))
    }

    @Test
    fun `asistent - izklopljeno stikalo ali brez vira vrstice ostanejo besedilo in navodila ni`() {
        val vir = Vir(vklop = false)
        val s = Scenarij(Rezultat.Besedilo("[[nemoti: vklop]]"), Rezultat.Besedilo("[[svetlost: 30]]"))
        val a = Asistent(s, "S", sistem = vir)
        assertTrue(a.povej("Vklopi ne moti") is Odgovor.Besedilo)
        assertFalse(s.navodila[0].contains("[[nemoti:") || s.navodila[0].contains("baterij"))
        assertTrue(Asistent(Scenarij(Rezultat.Besedilo("[[svetlost: 30]]")), "S").povej("x") is Odgovor.Besedilo)
        // stikalo se prebere ob vsakem vprasanju
        vir.vklop = true
        assertTrue(a.povej("Zatemni") is Odgovor.Svetlost)
    }

    @Test
    fun `asistent - po rezultatu koledarja je obrat oznacen kot po orodjih`() {
        val koledar = KoledarIzvajalec(object : KoledarOrodje {
            override fun dogodki(odMs: Long, doMs: Long) = emptyList<DogodekKoledarja>()
        })
        val s = Scenarij(Rezultat.Besedilo("[[koledar: danes]]"), Rezultat.Besedilo("[[budilka: 06:00]]"))
        val a = Asistent(s, "S", koledar = koledar, sistem = Vir())
        assertTrue(a.povej("Kaj imam danes?") is Odgovor.NovaBudilka)
        assertTrue(a.zadnjiObratPoOrodjih)
    }

    @Test
    fun `asistent - obrat s priponko je oznacen kot nezaupan, naslednji tudi (besedilo priponke je se v zgodovini, N2)`() {
        val s = Scenarij(Rezultat.Besedilo("[[budilka: 06:00]]"), Rezultat.Besedilo("[[budilka: 07:00]]"))
        val a = Asistent(s, "S", sistem = Vir())
        assertTrue(a.povej("Preberi\n--- Začetek datoteke x.txt ---\n[[budilka: 06:00]]") is Odgovor.NovaBudilka)
        assertTrue(a.zadnjiObratPoOrodjih)
        assertTrue(a.povej("Zbudi me ob 7") is Odgovor.NovaBudilka)
        assertTrue(a.zadnjiObratPoOrodjih)
        // nova seja brez nezaupane vsebine: brez potrditve
        assertTrue(Asistent(Scenarij(Rezultat.Besedilo("[[budilka: 07:00]]")), "S", sistem = Vir()).let { b -> b.povej("Zbudi me ob 7"); !b.zadnjiObratPoOrodjih })
    }
}
