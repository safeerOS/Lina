package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

// Preizkusi za StanjeZaslona in prehode med fazami.
class StanjeZaslonaTest {

    private val zacetno = StanjeZaslona(
        faza = Faza.MIRUJE,
        glasnost = 0f,
        besedilo = "",
        napaka = null
    )

    @Test
    fun `naslednje - celoten veljaven potek od miruje do govora in nazaj`() {
        val s1 = naslednje(zacetno, Dogodek.ZacetekPoslusanja)
        assertEquals(Faza.POSLUSA, s1.faza)
        assertEquals(0f, s1.glasnost)
        assertNull(s1.napaka)

        val s2 = naslednje(s1, Dogodek.Glasnost(0.6f))
        assertEquals(Faza.POSLUSA, s2.faza)
        assertEquals(0.6f, s2.glasnost, 0.0001f)

        val s3 = naslednje(s2, Dogodek.KonecGovoraUporabnika)
        assertEquals(Faza.RAZMISLJA, s3.faza)
        assertEquals(0f, s3.glasnost)

        val s4 = naslednje(s3, Dogodek.Odgovor("Pozdravljeni, kako vam lahko pomagam?"))
        assertEquals(Faza.GOVORI, s4.faza)
        assertEquals("Pozdravljeni, kako vam lahko pomagam?", s4.besedilo)

        val s5 = naslednje(s4, Dogodek.KonecOdgovora)
        assertEquals(Faza.MIRUJE, s5.faza)
        assertEquals(0f, s5.glasnost)
    }

    @Test
    fun `naslednje - neveljavni prehodi stanja ne spremenijo`() {
        // Odgovor ob MIRUJE ne spremeni stanja
        assertEquals(zacetno, naslednje(zacetno, Dogodek.Odgovor("Nepricakovano")))
        // KonecGovoraUporabnika ob MIRUJE ne spremeni stanja
        assertEquals(zacetno, naslednje(zacetno, Dogodek.KonecGovoraUporabnika))
        // KonecOdgovora ob POSLUSA ne spremeni stanja
        val poslusa = naslednje(zacetno, Dogodek.ZacetekPoslusanja)
        assertEquals(poslusa, naslednje(poslusa, Dogodek.KonecOdgovora))
        // Odgovor ob POSLUSA ne spremeni stanja
        assertEquals(poslusa, naslednje(poslusa, Dogodek.Odgovor("Prehitro")))
        // ZacetekPoslusanja ob RAZMISLJA ne spremeni stanja
        val razmislja = naslednje(poslusa, Dogodek.KonecGovoraUporabnika)
        assertEquals(razmislja, naslednje(razmislja, Dogodek.ZacetekPoslusanja))
    }

    @Test
    fun `naslednje - glasnost se sprejme samo v POSLUSA in omeji na 0 do 1 ter NaN na 0`() {
        // V MIRUJE se glasnost ignorira
        assertEquals(zacetno, naslednje(zacetno, Dogodek.Glasnost(0.5f)))

        val poslusa = naslednje(zacetno, Dogodek.ZacetekPoslusanja)

        // Negativna glasnost -> 0
        val neg = naslednje(poslusa, Dogodek.Glasnost(-5.0f))
        assertEquals(0f, neg.glasnost)

        // Ogromna glasnost -> 1
        val ogromna = naslednje(poslusa, Dogodek.Glasnost(1e10f))
        assertEquals(1f, ogromna.glasnost)

        // Neskoncna glasnost -> 1 oziroma 0
        assertEquals(1f, naslednje(poslusa, Dogodek.Glasnost(Float.POSITIVE_INFINITY)).glasnost)
        assertEquals(0f, naslednje(poslusa, Dogodek.Glasnost(Float.NEGATIVE_INFINITY)).glasnost)

        // NaN glasnost -> 0
        val nanStanje = naslednje(ogromna, Dogodek.Glasnost(Float.NaN))
        assertEquals(0f, nanStanje.glasnost)
    }

    @Test
    fun `naslednje - napaka vedno pelje v NAPAKA in skrije kljuc AIza`() {
        val poslusa = naslednje(zacetno, Dogodek.ZacetekPoslusanja)
        val zNapako = naslednje(
            poslusa,
            Dogodek.Napaka("Napaka avtentikacije za kljuc AIzaSyD1234567890_abc-def pri klicu")
        )
        assertEquals(Faza.NAPAKA, zNapako.faza)
        assertEquals("Napaka avtentikacije za kljuc *** pri klicu", zNapako.napaka)
        assertFalse(zNapako.napaka!!.contains("AIza"))

        // Samostojen kljuc in prazen niz
        val samoKljuc = naslednje(zacetno, Dogodek.Napaka("AIzaTajniKljuc999"))
        assertEquals(Faza.NAPAKA, samoKljuc.faza)
        assertEquals("***", samoKljuc.napaka)

        val praznaNapaka = naslednje(zacetno, Dogodek.Napaka(""))
        assertEquals(Faza.NAPAKA, praznaNapaka.faza)
        assertEquals("", praznaNapaka.napaka)
    }

    @Test
    fun `naslednje - preklic iz katerekoli faze vrne MIRUJE`() {
        val poslusa = StanjeZaslona(Faza.POSLUSA, 0.8f, "", null)
        val razmislja = StanjeZaslona(Faza.RAZMISLJA, 0f, "", null)
        val govori = StanjeZaslona(Faza.GOVORI, 0f, "Odgovor", null)
        val napaka = StanjeZaslona(Faza.NAPAKA, 0f, "", "Nekaj ni v redu")

        for (stanje in listOf(zacetno, poslusa, razmislja, govori, napaka)) {
            val poPreklicu = naslednje(stanje, Dogodek.Preklic)
            assertEquals(Faza.MIRUJE, poPreklicu.faza)
            assertEquals(0f, poPreklicu.glasnost)
            assertEquals("", poPreklicu.besedilo)
            assertNull(poPreklicu.napaka)
        }
    }

    @Test
    fun `naslednje - ponovni zacetek poslusanja po napaki pocisti napako`() {
        val napaka = naslednje(zacetno, Dogodek.Napaka("Brez povezave"))
        assertEquals(Faza.NAPAKA, napaka.faza)

        val znova = naslednje(napaka, Dogodek.ZacetekPoslusanja)
        assertEquals(Faza.POSLUSA, znova.faza)
        assertEquals(0f, znova.glasnost)
        assertNull(znova.napaka)
    }
}
