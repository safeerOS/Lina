package si.safeer.lina.samostojna

import kotlin.math.sin

// Izracuna relativni polmer animirane krogle v razponu 0.8..1.2 glede na fazo, glasnost in cas.
fun polmer(faza: Faza, glasnost: Float, cas: Long, zmanjsanoGibanje: Boolean): Float {
    if (zmanjsanoGibanje) {
        return when (faza) {
            Faza.MIRUJE -> 1.0f
            Faza.POSLUSA -> 1.1f
            Faza.RAZMISLJA -> 0.95f
            Faza.GOVORI -> 1.05f
            Faza.NAPAKA -> 0.85f
        }
    }

    val varnaGlasnost = if (glasnost.isNaN()) 0f else glasnost.coerceIn(0f, 1f)
    val surovo = when (faza) {
        Faza.MIRUJE -> 1.0f + 0.1f * sin(cas.toDouble() / 400.0).toFloat()
        Faza.POSLUSA -> 0.8f + 0.4f * varnaGlasnost
        Faza.RAZMISLJA -> 1.0f + 0.1f * sin(cas.toDouble() / 200.0).toFloat()
        Faza.GOVORI -> 1.0f + 0.15f * sin(cas.toDouble() / 150.0).toFloat()
        Faza.NAPAKA -> 0.85f
    }

    return if (surovo.isNaN()) 1.0f else surovo.coerceIn(0.8f, 1.2f)
}
