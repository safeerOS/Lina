package si.safeer.lina.samostojna.live

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class IzhodniLimiterTest {
    private fun pcm(vararg v: Int): ByteArray { val b = ByteArray(v.size * 2); v.forEachIndexed { i, x -> b[i * 2] = (x and 0xFF).toByte(); b[i * 2 + 1] = ((x shr 8) and 0xFF).toByte() }; return b }
    private fun vz(b: ByteArray) = IntArray(b.size / 2) { ((b[it * 2].toInt() and 0xFF) or (b[it * 2 + 1].toInt() shl 8)).toShort().toInt() }

    @Test
    fun `tih signal je samo ojacan za -3 dB`() {
        val o = vz(IzhodniLimiter.obdelaj(pcm(1000, -1000, 10000, -10000)))
        assertEquals(708, o[0]); assertEquals(-708, o[1]); assertEquals(7080, o[2]); assertEquals(-7080, o[3])
    }

    @Test
    fun `vrh na polni skali ne preseze stropa in je monoton`() {
        val vhod = IntArray(33) { it * 1000 - 0 }.map { it.coerceIn(-32768, 32767) }.toIntArray() + intArrayOf(32767, -32768)
        val o = vz(IzhodniLimiter.obdelaj(pcm(*vhod)))
        assertTrue(o.all { it in -29000..29000 }, o.max().toString())
        for (i in 1 until 33) assertTrue(o[i] >= o[i - 1], "monotono pri $i")
        assertTrue(o[33] > 22000 && o[34] < -22000)
    }
}
