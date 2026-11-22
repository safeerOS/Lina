package si.safeer.lina.samostojna.live

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/**
 * Cistilnik zvoka klicatelja pred modelom (16 kHz s16le mono; lastnik 22. 11. 2026: »naredi kar lahko, da zmanjsas sum, brez merjenja«).
 *  1. Visokopasovni filter 100 Hz (2. red): odstrani brumenje omrezja, ropotanje in enosmerno komponento; govor je nad 100 Hz.
 *  2. Mehek ekspander: ko je raven blizu ocenjenega ozadja (minimalna statistika), ga zmanjsa najvec za 9 dB. Govor ga takoj odpre
 *     (pritisk takoj, zadrzanje 200 ms, sprostitev 100 ms); prvih 500 ms ne dela, da se ozadje nauci.
 * Stanje (filter, ozadje) se prenasa med kosi: rezultat ni odvisen od razreza toka. Izklop: nastavitev lina_zvok/filter_suma.
 */
internal class FiltrKlicatelja {
    private val fs = 16000.0
    private val b0: Double; private val b1: Double; private val b2: Double; private val a1: Double; private val a2: Double
    private var x1 = 0.0; private var x2 = 0.0; private var y1 = 0.0; private var y2 = 0.0

    private var env = 0.0
    private var ozadje = -1.0
    private var ojacanje = 1.0
    private var zadrzanje = 0
    private var stevec = 0L
    private val razpadEnv = exp(-1.0 / (0.020 * fs))
    private val sprostitev = 1.0 / (0.100 * fs)

    init {
        val w0 = 2 * PI * 100.0 / fs
        val alfa = sin(w0) / (2 * 0.70710678)
        val c = cos(w0)
        val a0 = 1 + alfa
        b0 = (1 + c) / 2 / a0; b1 = -(1 + c) / a0; b2 = (1 + c) / 2 / a0
        a1 = -2 * c / a0; a2 = (1 - alfa) / a0
    }

    fun obdelaj(vhod: ByteArray): ByteArray {
        val n = vhod.size / 2
        val ven = ByteArray(n * 2)
        for (i in 0 until n) {
            val x = ((vhod[i * 2].toInt() and 0xFF) or (vhod[i * 2 + 1].toInt() shl 8)).toShort().toDouble()
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y

            val a = abs(y)
            env = if (a > env) a else env * razpadEnv
            if (ozadje < 0) ozadje = maxOf(env, MIN_OZADJE)
            ozadje = if (env < ozadje) maxOf(ozadje * 0.995 + env * 0.005, MIN_OZADJE) else minOf(ozadje * 1.00003, MAX_OZADJE)

            stevec++
            val govor = env > ozadje * PRAG || stevec < UCENJE
            if (govor) zadrzanje = ZADRZANJE
            else if (zadrzanje > 0) zadrzanje--
            ojacanje = if (govor || zadrzanje > 0) 1.0 else maxOf(MIN_OJACANJE, ojacanje - sprostitev)

            val s = Math.round(y * ojacanje).toInt().coerceIn(-32768, 32767)
            ven[i * 2] = (s and 0xFF).toByte(); ven[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        return ven
    }

    private companion object {
        const val PRAG = 2.5
        const val UCENJE = 8000L
        const val ZADRZANJE = 3200
        const val MIN_OJACANJE = 0.355 // -9 dB
        const val MIN_OZADJE = 20.0
        const val MAX_OZADJE = 3000.0
    }
}
