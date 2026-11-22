package si.safeer.lina.samostojna

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

// Izbira barvne teme zaslona (privzeto temna mornarsko modra; lastnik 22. 11. 2026: ne vijolicna).
enum class Tema {
    TEMNA,
    SVETLA
}

// Barvni tokeni za zaslon asistentke Line.
data class Barve(
    val ozadje: String,
    val povrsina: String,
    val povrsina2: String,
    val poudarekCian: String,
    val rozaSnemanje: String,
    val besedilo: String,
    val tiho: String,
    val napaka: String
) {
    val poudarek: String get() = poudarekCian
    val snemanje: String get() = rozaSnemanje
}

private val temnaBarvnaPaleta = Barve(
    ozadje = "#0B1220",
    povrsina = "#121B2E",
    povrsina2 = "#1A2540",
    poudarekCian = "#5CE1E6",
    rozaSnemanje = "#FF4F9A",
    besedilo = "#EEF2FF",
    tiho = "#A9B6D3",
    napaka = "#FF8087"
)

private val svetlaBarvnaPaleta = Barve(
    ozadje = "#F7F8FF",
    povrsina = "#FFFFFF",
    povrsina2 = "#ECEEFF",
    poudarekCian = "#007B83",
    rozaSnemanje = "#C2185B",
    besedilo = "#12102B",
    tiho = "#4A4B70",
    napaka = "#B71C1C"
)

// Vrne barvne tokene za izbrano temo (privzeto TEMNA).
fun barve(tema: Tema = Tema.TEMNA): Barve {
    return when (tema) {
        Tema.TEMNA -> temnaBarvnaPaleta
        Tema.SVETLA -> svetlaBarvnaPaleta
    }
}

private fun kanalVSvetlost(vrednost: Int): Double {
    val normirano = (vrednost.coerceIn(0, 255)) / 255.0
    return if (normirano <= 0.03928) {
        normirano / 12.92
    } else {
        ((normirano + 0.055) / 1.055).pow(2.4)
    }
}

// Izracuna relativno svetlost barve po standardu WCAG 2.1 (vrne null ob neveljavnem zapisu).
fun relativnaSvetlost(hexBarva: String): Double? {
    val cista = hexBarva.trim().removePrefix("#")
    if (!cista.matches(Regex("^[0-9a-fA-F]{6}$"))) return null
    val rgb = cista.toIntOrNull(16) ?: return null
    val r = (rgb shr 16) and 0xFF
    val g = (rgb shr 8) and 0xFF
    val b = rgb and 0xFF
    return 0.2126 * kanalVSvetlost(r) + 0.7152 * kanalVSvetlost(g) + 0.0722 * kanalVSvetlost(b)
}

// Izracuna kontrastno razmerje med dvema barvama po WCAG (1.0 .. 21.0).
fun kontrast(barva1: String, barva2: String): Double {
    val l1 = relativnaSvetlost(barva1) ?: return 1.0
    val l2 = relativnaSvetlost(barva2) ?: return 1.0
    val svetlejsa = max(l1, l2)
    val temnejsa = min(l1, l2)
    return (svetlejsa + 0.05) / (temnejsa + 0.05)
}
