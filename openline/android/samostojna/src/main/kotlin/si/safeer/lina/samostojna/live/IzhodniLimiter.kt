package si.safeer.lina.samostojna.live

import kotlin.math.abs

/**
 * Raven Linine izhodne zvocne poti (lastnik 22. 11. 2026: oddaja zvoka mora biti najbolj kvalitetna). Posnetek izhoda 22. 11.
 * 13.19: vrh na 0 dBFS, povprecna raven -13 dB - prevroce za kodek operaterja (AMR/EVS), ki jo zaokrozi ali popaci.
 * Zato: ojacanje -3 dB (0,708) in mehek omejevalnik: nad 22000 se vrh stisne, trdi strop 29000 (-0,9 dBFS) - nikoli trdega rezanja.
 * Brez stanja, zato rezultat ni odvisen od razreza toka. 16 kHz s16le mono.
 */
internal object IzhodniLimiter {
    const val OJACANJE = 0.708
    private const val KOLENO = 22000.0
    private const val STROP = 29000.0

    fun obdelaj(vhod: ByteArray): ByteArray {
        val n = vhod.size / 2
        val ven = ByteArray(n * 2)
        for (i in 0 until n) {
            var y = (((vhod[i * 2].toInt() and 0xFF) or (vhod[i * 2 + 1].toInt() shl 8)).toShort().toDouble()) * OJACANJE
            val a = abs(y)
            if (a > KOLENO) {
                // mehko koleno: nad kolenom narascanje 0,3 in asimptoticni strop
                val nad = a - KOLENO
                val m = (STROP - KOLENO) * Math.tanh(nad * 0.3 / (STROP - KOLENO))
                y = Math.signum(y) * (KOLENO + m)
            }
            val s = Math.round(y).toInt().coerceIn(-32768, 32767)
            ven[i * 2] = (s and 0xFF).toByte(); ven[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        return ven
    }
}
