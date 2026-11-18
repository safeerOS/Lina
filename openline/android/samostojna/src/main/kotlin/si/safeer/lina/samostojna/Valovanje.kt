package si.safeer.lina.samostojna

import kotlin.math.sqrt

// Pretvori 16-bitne PCM vzorce v podano stevilo stolpcev (0..1) po efektivni vrednosti (RMS).
fun stolpci(vzorci: ShortArray, stevilo: Int): FloatArray {
    if (stevilo <= 0) return FloatArray(0)
    if (vzorci.isEmpty()) return FloatArray(stevilo) { 0f }

    val rezultat = FloatArray(stevilo)
    val n = vzorci.size
    val delitelj = Short.MAX_VALUE.toDouble()

    for (i in 0 until stevilo) {
        val zacetek = (i.toLong() * n / stevilo).toInt()
        val konec = ((i + 1).toLong() * n / stevilo).toInt()
        if (zacetek >= konec) {
            rezultat[i] = 0f
            continue
        }
        var vsotaKvadratov = 0.0
        for (j in zacetek until konec) {
            val normirano = vzorci[j].toDouble() / delitelj
            vsotaKvadratov += normirano * normirano
        }
        val rms = sqrt(vsotaKvadratov / (konec - zacetek)).toFloat()
        rezultat[i] = if (rms.isNaN()) 0f else rms.coerceIn(0f, 1f)
    }
    return rezultat
}

// Casovno glajenje stolpcev z locenim faktorjem za napad (navzgor) in upad (navzdol).
class Glajenje(napad: Float, upad: Float) {
    private val varenNapad = if (napad.isNaN()) 0f else napad.coerceIn(0f, 1f)
    private val varenUpad = if (upad.isNaN()) 0f else upad.coerceIn(0f, 1f)
    private var stanje = FloatArray(0)

    fun korak(vhod: FloatArray): FloatArray {
        if (vhod.isEmpty()) {
            stanje = FloatArray(0)
            return FloatArray(0)
        }

        if (stanje.size != vhod.size) {
            val staro = stanje
            stanje = FloatArray(vhod.size) { i ->
                if (i < staro.size) staro[i] else 0f
            }
        }

        for (i in vhod.indices) {
            val surovo = vhod[i]
            val cilj = if (surovo.isNaN()) 0f else surovo.coerceIn(0f, 1f)
            val prejsnja = stanje[i]
            val faktor = if (cilj >= prejsnja) varenNapad else varenUpad
            val nova = prejsnja + faktor * (cilj - prejsnja)
            stanje[i] = if (nova.isNaN()) 0f else nova.coerceIn(0f, 1f)
        }

        return stanje.copyOf()
    }
}
