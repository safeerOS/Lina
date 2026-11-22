package si.safeer.lina.samostojna.live

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertTrue

class FiltrKlicateljaTest {
    private fun pcm(v: DoubleArray): ByteArray {
        val b = ByteArray(v.size * 2)
        for (i in v.indices) { val s = v[i].toInt().coerceIn(-32768, 32767); b[i * 2] = (s and 0xFF).toByte(); b[i * 2 + 1] = ((s shr 8) and 0xFF).toByte() }
        return b
    }
    private fun vz(b: ByteArray) = DoubleArray(b.size / 2) { ((b[it * 2].toInt() and 0xFF) or (b[it * 2 + 1].toInt() shl 8)).toShort().toDouble() }
    private fun rms(v: DoubleArray, od: Int, do_: Int): Double { var s = 0.0; for (i in od until do_) s += v[i] * v[i]; return sqrt(s / (do_ - od)) }
    private fun ton(hz: Double, n: Int, amp: Double, od: Int = 0) = DoubleArray(n) { amp * sin(2 * PI * hz * (it + od) / 16000.0) }

    @Test
    fun `brumenje 50 Hz je oslabljeno, govorna frekvenca 1 kHz ostane`() {
        val hum = vz(FiltrKlicatelja().obdelaj(pcm(ton(50.0, 32000, 8000.0))))
        assertTrue(rms(hum, 8000, 32000) < 0.3 * rms(ton(50.0, 32000, 8000.0), 8000, 32000), "brum")
        val govor = vz(FiltrKlicatelja().obdelaj(pcm(ton(1000.0, 32000, 8000.0))))
        assertTrue(abs(rms(govor, 8000, 32000) - 8000 / sqrt(2.0)) < 0.03 * 8000, "1 kHz")
    }

    @Test
    fun `sum v ozadju je zmanjsan, zacetek govora ni odrezan`() {
        val r = Random(1)
        val sum = DoubleArray(48000) { r.nextDouble(-170.0, 170.0) }
        val govor = ton(400.0, 8000, 6000.0, 48000)
        val ven = vz(FiltrKlicatelja().obdelaj(pcm(sum + govor)))
        val vSumu = rms(ven, 40000, 47000)
        val vhodSum = rms(sum, 40000, 47000)
        assertTrue(vSumu < 0.6 * vhodSum, "sum $vSumu / $vhodSum")
        val prvih20ms = rms(ven, 48000 + 320, 48000 + 640)
        assertTrue(prvih20ms > 0.85 * 6000 / sqrt(2.0), "zacetek govora $prvih20ms")
    }

    @Test
    fun `rezultat ne zavisi od razreza toka in tisina ostane tisina`() {
        val r = Random(7)
        val v = DoubleArray(30000) { r.nextDouble(-3000.0, 3000.0) * (if (it % 9000 < 4000) 1.0 else 0.02) }
        val b = pcm(v)
        val celota = FiltrKlicatelja().obdelaj(b)
        val f = FiltrKlicatelja(); val o = java.io.ByteArrayOutputStream(); var i = 0
        for (d in intArrayOf(640, 14, 1920, 2002, 100)) { if (i >= b.size) break; val e = minOf(b.size, i + d); o.write(f.obdelaj(b.copyOfRange(i, e))); i = e }
        while (i < b.size) { val e = minOf(b.size, i + 640); o.write(f.obdelaj(b.copyOfRange(i, e))); i = e }
        assertContentEquals(celota, o.toByteArray())
        assertContentEquals(ByteArray(6400), FiltrKlicatelja().obdelaj(ByteArray(6400)))
    }
}
