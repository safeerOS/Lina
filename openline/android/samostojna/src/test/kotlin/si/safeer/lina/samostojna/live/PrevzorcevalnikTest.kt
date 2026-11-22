package si.safeer.lina.samostojna.live

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertTrue

class PrevzorcevalnikTest {
    private fun ton(hz: Double, vzorci: Int, amp: Double = 12000.0): ByteArray {
        val b = ByteArray(vzorci * 2)
        for (i in 0 until vzorci) {
            val s = (amp * sin(2 * PI * hz * i / 24000.0)).toInt()
            b[i * 2] = (s and 0xFF).toByte(); b[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        return b
    }

    private fun vzorci(b: ByteArray) = IntArray(b.size / 2) { ((b[it * 2].toInt() and 0xFF) or (b[it * 2 + 1].toInt() shl 8)).toShort().toInt() }

    private fun rms(v: IntArray, od: Int, do_: Int): Double {
        var s = 0.0; for (i in od until do_) s += v[i].toDouble() * v[i]; return sqrt(s / (do_ - od))
    }

    @Test
    fun `rezultat ne zavisi od razreza toka na kose`() {
        val vhod = ton(1000.0, 24000)
        val celota = Prevzorcevalnik24v16().obdelaj(vhod)
        val p = Prevzorcevalnik24v16()
        val kosi = java.io.ByteArrayOutputStream()
        var o = 0
        val velikosti = intArrayOf(1920, 722, 3001 * 2, 14, 960, 5000)
        var j = 0
        while (o < vhod.size) {
            val d = minOf(velikosti[j++ % velikosti.size], vhod.size - o) and 1.inv()
            if (d == 0) break
            kosi.write(p.obdelaj(vhod.copyOfRange(o, o + d)))
            o += d
        }
        assertContentEquals(celota, kosi.toByteArray())
    }

    @Test
    fun `ton 1 kHz ohrani glasnost in nima skokov na mejah kosov`() {
        val p = Prevzorcevalnik24v16()
        val vhod = ton(1000.0, 24000)
        val ven = java.io.ByteArrayOutputStream()
        var o = 0
        while (o < vhod.size) { ven.write(p.obdelaj(vhod.copyOfRange(o, minOf(o + 1440, vhod.size)))); o += 1440 }
        val v = vzorci(ven.toByteArray())
        val r = rms(v, 200, v.size - 200)
        assertTrue(abs(r - 12000.0 / sqrt(2.0)) < 120, "glasnost $r")
        var najvecjiSkok = 0
        for (i in 201 until v.size - 200) najvecjiSkok = maxOf(najvecjiSkok, abs(v[i] - v[i - 1]))
        // idealen ton 1 kHz pri 16 kHz: najvecji korak ~ 12000*2*pi*1000/16000 = 4712
        assertTrue(najvecjiSkok < 4900, "skok $najvecjiSkok")
    }

    @Test
    fun `ton nad mejo 10 kHz se ne zrcali v slisno obmocje`() {
        val v = vzorci(Prevzorcevalnik24v16().obdelaj(ton(10000.0, 24000)))
        val r = rms(v, 200, v.size - 200)
        assertTrue(r < 12000.0 / sqrt(2.0) * 0.1, "zrcaljenje $r")
    }
}
