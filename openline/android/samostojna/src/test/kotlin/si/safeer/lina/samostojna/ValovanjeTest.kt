package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Preizkusi za Valovanje (izracun RMS stolpcev in glajenje).
class ValovanjeTest {

    @Test
    fun `stolpci - prazen vhod vrne same nicle`() {
        val rezultat = stolpci(ShortArray(0), 5)
        assertEquals(5, rezultat.size)
        for (v in rezultat) {
            assertEquals(0f, v)
        }
    }

    @Test
    fun `stolpci - stevilo stolpcev nic ali negativno vrne prazno tabelo`() {
        val vzorci = shortArrayOf(1000, 2000, 3000)
        assertEquals(0, stolpci(vzorci, 0).size)
        assertEquals(0, stolpci(vzorci, -1).size)
        assertEquals(0, stolpci(vzorci, Int.MIN_VALUE).size)
    }

    @Test
    fun `stolpci - tisina in polna glasnost ter negativni vzorci`() {
        val tisina = ShortArray(100) { 0 }
        val stolpciTisine = stolpci(tisina, 4)
        assertEquals(4, stolpciTisine.size)
        assertTrue(stolpciTisine.all { it == 0f })

        val polnoPoz = ShortArray(100) { Short.MAX_VALUE }
        val stolpciPolno = stolpci(polnoPoz, 4)
        assertEquals(4, stolpciPolno.size)
        for (v in stolpciPolno) {
            assertEquals(1f, v, 0.001f)
        }

        // Short.MIN_VALUE (-32768) ne sme povzrociti prekoracitve in mora dati 1.0
        val polnoNeg = ShortArray(100) { Short.MIN_VALUE }
        val stolpciNeg = stolpci(polnoNeg, 4)
        assertEquals(4, stolpciNeg.size)
        for (v in stolpciNeg) {
            assertEquals(1f, v, 0.001f)
        }
    }

    @Test
    fun `stolpci - razlicna glasnost po odsekih`() {
        // Prva polovica tisina, druga polovica polna glasnost
        val vzorci = ShortArray(200) { i -> if (i < 100) 0 else Short.MAX_VALUE }
        val izhod = stolpci(vzorci, 2)
        assertEquals(2, izhod.size)
        assertEquals(0f, izhod[0], 0.0001f)
        assertEquals(1f, izhod[1], 0.001f)
    }

    @Test
    fun `stolpci - veliko stevilo stolpcev in ogromen vhod v mejah 0 do 1`() {
        // Manj vzorcev kot stolpcev
        val kratko = shortArrayOf(16384)
        val vecStolpcev = stolpci(kratko, 10)
        assertEquals(10, vecStolpcev.size)
        assertTrue(vecStolpcev.all { it in 0f..1f })

        // Velik vhod (64000 vzorcev)
        val velikVhod = ShortArray(64000) { i -> ((i * 123) % 32767).toShort() }
        val izhodVelik = stolpci(velikVhod, 32)
        assertEquals(32, izhodVelik.size)
        assertTrue(izhodVelik.all { !it.isNaN() && it in 0f..1f })
    }

    @Test
    fun `glajenje - hitro navzgor in pocasi navzdol`() {
        val glajenje = Glajenje(napad = 0.8f, upad = 0.1f)
        val gor = glajenje.korak(floatArrayOf(1.0f))
        assertEquals(1, gor.size)
        // Zacetek iz 0 z napadom 0.8 -> 0.8
        assertEquals(0.8f, gor[0], 0.0001f)

        val dol = glajenje.korak(floatArrayOf(0.0f))
        // Upad za 0.1 iz 0.8 -> 0.72 (sprememba navzdol 0.08 je manjsa od spremembe navzgor 0.8)
        assertEquals(0.72f, dol[0], 0.0001f)
        assertTrue(gor[0] > (gor[0] - dol[0]))
    }

    @Test
    fun `glajenje - prilagoditev velikosti vhodu in prazen vhod`() {
        val glajenje = Glajenje(napad = 0.5f, upad = 0.5f)
        assertEquals(0, glajenje.korak(FloatArray(0)).size)

        val prvi = glajenje.korak(floatArrayOf(1f, 1f))
        assertEquals(2, prvi.size)

        val razsirjen = glajenje.korak(floatArrayOf(1f, 1f, 1f, 1f))
        assertEquals(4, razsirjen.size)
        assertTrue(razsirjen.all { it in 0f..1f })

        val skrcen = glajenje.korak(floatArrayOf(0.5f))
        assertEquals(1, skrcen.size)
    }

    @Test
    fun `glajenje - mejne vrednosti NaN negativno in ogromno ostanejo v 0 do 1`() {
        val glajenje = Glajenje(napad = 1.5f, upad = -0.5f)
        val izhod = glajenje.korak(
            floatArrayOf(Float.NaN, -100f, 999999f, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)
        )
        assertEquals(5, izhod.size)
        for (v in izhod) {
            assertTrue(!v.isNaN() && v in 0f..1f)
        }
    }

    @Test
    fun `glajenje - parametri NaN v konstruktorju ne povzrocijo NaN na izhodu`() {
        val glajenje = Glajenje(napad = Float.NaN, upad = Float.NaN)
        val izhod = glajenje.korak(floatArrayOf(0.5f, 1.0f))
        assertEquals(2, izhod.size)
        assertTrue(izhod.all { !it.isNaN() && it in 0f..1f })
    }

    @Test
    fun `glajenje - zaporedni koraki konvergirajo k ciljni vrednosti`() {
        val glajenje = Glajenje(napad = 0.5f, upad = 0.2f)
        var zadnji = FloatArray(0)
        repeat(20) {
            zadnji = glajenje.korak(floatArrayOf(1.0f, 0.0f))
        }
        assertEquals(1.0f, zadnji[0], 0.01f)
        assertEquals(0.0f, zadnji[1], 0.01f)
    }
}
