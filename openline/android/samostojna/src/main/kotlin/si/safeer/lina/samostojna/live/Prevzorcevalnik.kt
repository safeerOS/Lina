package si.safeer.lina.samostojna.live

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

/**
 * Prevzorcenje glasu Line 24 kHz -> 16 kHz (razmerje 2:3) s STANJEM med kosi.
 *
 * Prejsnja izvedba je vsak kos (nekaj 10 ms) obdelala posebej: filter je na robu kosa videl tisino, faza
 * interpolacije se je za vsak kos zacela znova in filter je imel 15 utezi z slabim zadrzanjem -> klikanje na mejah
 * kosov in zrcalenje (aliasing). Tu je okno-sinc filter (66 utezi, Blackman, meja 7,2 kHz), zgodovina in faza se prenasata.
 * Rezultat je enak, ne glede na to, kako je tok razrezan (preizkus PrevzorcevalnikTest).
 */
internal class Prevzorcevalnik24v16 {
    private val pol = 33 // veckratnik 3: zakasnitev je celo stevilo izhodnih vzorcev (22)
    private val tapsCel = naredi(0.0)
    private val tapsPol = naredi(0.5)

    // Se neporabljeni vzorci (od abs. indeksa `baza`) in stevilka naslednjega izhodnega vzorca.
    private var zgodovina = FloatArray(0)
    private var baza = 0L
    // Zacne pri -22: filter gleda 33 vzorcev naprej, zato izhod zacne 1,4 ms tisine prej; stevilo izhodnih vzorcev je tako
    // ob vsakem trenutku enako vhodnemu * 2/3 (kot pri prejsnji izvedbi), zakasnitev je stalna.
    private var k = -(pol * 2L / 3)

    private fun naredi(f: Double): FloatArray {
        val fc = 7200.0 / 24000.0 // sicniki (s, š, č) ostanejo; prej 6800 Hz
        val t = DoubleArray(2 * pol)
        var vsota = 0.0
        for (m in 0 until 2 * pol) {
            val x = f + pol - 1 - m
            val s = if (x == 0.0) 2 * fc else sin(2 * PI * fc * x) / (PI * x)
            val okno = if (kotlin.math.abs(x) >= pol) 0.0 else 0.42 + 0.5 * cos(PI * x / pol) + 0.08 * cos(2 * PI * x / pol)
            t[m] = s * okno
            vsota += t[m]
        }
        return FloatArray(2 * pol) { (t[it] / vsota).toFloat() }
    }

    fun obdelaj(vhod: ByteArray): ByteArray {
        val n = vhod.size / 2
        val vsi = FloatArray(zgodovina.size + n)
        System.arraycopy(zgodovina, 0, vsi, 0, zgodovina.size)
        for (i in 0 until n) {
            val lo = vhod[i * 2].toInt() and 0xFF
            val hi = vhod[i * 2 + 1].toInt() shl 8
            vsi[zgodovina.size + i] = (lo or hi).toShort().toFloat()
        }
        val zadnji = baza + vsi.size - 1
        val ven = java.io.ByteArrayOutputStream()
        while (true) {
            val pos = k * 1.5
            val ni = floor(pos).toLong()
            if (ni + pol > zadnji) break
            val taps = if (Math.floorMod(k, 2L) == 0L) tapsCel else tapsPol
            val prvi = ni - pol + 1
            var vsotaV = 0f
            for (m in 0 until 2 * pol) {
                val idx = prvi + m - baza
                if (idx >= 0) vsotaV += vsi[idx.toInt()] * taps[m]
            }
            val s = vsotaV.toInt().coerceIn(-32768, 32767)
            ven.write(s and 0xFF)
            ven.write((s shr 8) and 0xFF)
            k++
        }
        val nasledniPrvi = floor(k * 1.5).toLong() - pol + 1
        val odrezi = (nasledniPrvi - baza).toInt().coerceIn(0, vsi.size)
        zgodovina = vsi.copyOfRange(odrezi, vsi.size)
        baza += odrezi
        return ven.toByteArray()
    }
}
