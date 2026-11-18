package si.safeer.lina.samostojna

// Faze zaslona samostojne asistentke Line.
enum class Faza {
    MIRUJE,
    POSLUSA,
    RAZMISLJA,
    GOVORI,
    NAPAKA
}

// Nespremenljivo stanje zaslona v dolocenem trenutku.
data class StanjeZaslona(
    val faza: Faza = Faza.MIRUJE,
    val glasnost: Float = 0f,
    val besedilo: String = "",
    val napaka: String? = null
)

// Dogodki, ki sprozijo prehode med stanji zaslona.
sealed class Dogodek {
    object ZacetekPoslusanja : Dogodek()
    data class Glasnost(val vrednost: Float) : Dogodek() {
        val glasnost: Float get() = vrednost
    }
    object KonecGovoraUporabnika : Dogodek()
    data class Odgovor(val besedilo: String) : Dogodek()
    object KonecOdgovora : Dogodek()
    data class Napaka(val sporocilo: String) : Dogodek()
    object Preklic : Dogodek()
}

private val vzorecKljuca = Regex("AIza[A-Za-z0-9_\\-]*")

private fun ocistiKljuc(sporocilo: String): String {
    return vzorecKljuca.replace(sporocilo, "***")
}

private fun omejiGlasnost(vrednost: Float): Float {
    if (vrednost.isNaN()) return 0f
    return vrednost.coerceIn(0f, 1f)
}

// Cista funkcija za izracun naslednjega stanja zaslona glede na trenutni dogodek.
fun naslednje(s: StanjeZaslona, d: Dogodek): StanjeZaslona {
    return when (d) {
        is Dogodek.Preklic -> StanjeZaslona(
            faza = Faza.MIRUJE,
            glasnost = 0f,
            besedilo = "",
            napaka = null
        )
        is Dogodek.Napaka -> StanjeZaslona(
            faza = Faza.NAPAKA,
            glasnost = 0f,
            besedilo = "",
            napaka = ocistiKljuc(d.sporocilo)
        )
        is Dogodek.ZacetekPoslusanja -> {
            if (s.faza == Faza.MIRUJE || s.faza == Faza.NAPAKA) {
                StanjeZaslona(
                    faza = Faza.POSLUSA,
                    glasnost = 0f,
                    besedilo = "",
                    napaka = null
                )
            } else {
                s
            }
        }
        is Dogodek.Glasnost -> {
            if (s.faza == Faza.POSLUSA) {
                s.copy(glasnost = omejiGlasnost(d.vrednost))
            } else {
                s
            }
        }
        is Dogodek.KonecGovoraUporabnika -> {
            if (s.faza == Faza.POSLUSA) {
                s.copy(faza = Faza.RAZMISLJA, glasnost = 0f, napaka = null)
            } else {
                s
            }
        }
        is Dogodek.Odgovor -> {
            if (s.faza == Faza.RAZMISLJA) {
                s.copy(faza = Faza.GOVORI, glasnost = 0f, besedilo = d.besedilo, napaka = null)
            } else {
                s
            }
        }
        is Dogodek.KonecOdgovora -> {
            if (s.faza == Faza.GOVORI) {
                StanjeZaslona(
                    faza = Faza.MIRUJE,
                    glasnost = 0f,
                    besedilo = "",
                    napaka = null
                )
            } else {
                s
            }
        }
    }
}
