package si.safeer.lina.samostojna

import java.text.Normalizer

/**
 * Sklanjanje imena uporabnika v tozilnik za osebno tajnico (lastnik 21. 11. 2026): »Poklicali ste Tomaža«, »Alena«, »Ano«.
 * Prenos src/lib/lina/ime-tozilnik.ts (iste tabele in pravila); ImeTozilnikTest ima iste primere kot ime-tozilnik.test.ts.
 * Uporabnikov rocni zapis tozilnika ima prednost; besede brez zanesljivega pravila ostanejo nespremenjene.
 */
object ImeTozilnik {
    private val IZJEME = mapOf(
        "peter" to "Petra", "pavel" to "Pavla", "domen" to "Domna", "aleksander" to "Aleksandra", "alexander" to "Alexandra",
        "ozbej" to "Ožbeja", "lovrenc" to "Lovrenca", "franc" to "Franca", "marjan" to "Marjana",
        "jure" to "Jureta", "tone" to "Toneta", "anze" to "Anžeta", "bine" to "Bineta", "done" to "Doneta", "sime" to "Simeta",
        "mate" to "Mateta", "rene" to "Reneja", "vinko" to "Vinka",
    )
    private val ZENSKA_NA_SOGLASNIK = setOf("ines", "karmen", "mirjam", "nives", "ingrid", "iris", "agnes", "jasmin", "ruth", "sonja_")
    private val MOSKA_NA_A = setOf("luka", "ziga", "miha", "jaka", "mitja", "matija", "tilen_", "saso_")
    private val PRESLEDKI = Regex("\\s+")

    /** Besede, ki v osebnem nacinu NE smejo stati za »poklicali ste« (kazejo, da klic ni osebna raba). */
    val PREPOVEDANO_ZA_POKLICALI = Regex(
        "poklicali ste\\s+(?:podjetje|osebo|organizacijo|društvo|drustvo|družbo|druzbo|firmo|podjetja|oseb|organizacij|ustanovo|zavod)",
        RegexOption.IGNORE_CASE,
    )

    private fun brezNaglasov(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "").lowercase()

    private fun veliko(izvirnik: String, sklonjeno: String): String =
        if (izvirnik[0] == izvirnik[0].uppercaseChar()) sklonjeno.replaceFirstChar { it.uppercaseChar() } else sklonjeno

    private fun sklanjajBesedo(beseda: String): String {
        val b = beseda.trim()
        if (b.length < 2) return b
        val k = brezNaglasov(b)
        IZJEME[k]?.let { return it }
        if (k in ZENSKA_NA_SOGLASNIK) return b
        val zadnja = b.last().lowercaseChar()
        val prej = b.dropLast(1)
        return when {
            zadnja == 'a' -> prej + "o" // Ana -> Ano, Luka -> Luko
            zadnja == 'e' -> b + "ta" // Jure -> Jureta
            zadnja == 'o' -> prej + "a" // Marko -> Marka
            zadnja == 'i' || zadnja == 'u' -> b // brez zanesljivega pravila
            Regex("(or|ar)$", RegexOption.IGNORE_CASE).containsMatchIn(b) && k != "sandor" -> b + "ja" // Igor -> Igorja
            Regex("ec$", RegexOption.IGNORE_CASE).containsMatchIn(b) && b.length > 4 -> b.dropLast(2) + "ca"
            else -> b + "a" // Tomaž -> Tomaža
        }
    }

    private fun jeMoskoIme(prvo: String): Boolean {
        val k = brezNaglasov(prvo)
        if (k in MOSKA_NA_A) return true
        if (k in ZENSKA_NA_SOGLASNIK) return false
        return !k.endsWith("a")
    }

    /** Ime ali ime in priimek v tozilniku. Prazen niz, ce imena ni. Priimek se sklanja samo ob moskem imenu. */
    fun imeVTozilniku(ime: String, uporabnikovZapis: String = ""): String {
        val zapis = uporabnikovZapis.replace(PRESLEDKI, " ").trim()
        if (zapis.isNotEmpty()) return zapis
        val cisto = ime.replace(PRESLEDKI, " ").trim()
        if (cisto.isEmpty()) return ""
        val deli = cisto.split(" ")
        val mosko = jeMoskoIme(deli[0])
        val prvo = veliko(deli[0], sklanjajBesedo(deli[0]))
        val priimki = deli.drop(1).map { if (mosko) veliko(it, sklanjajBesedo(it)) else it }
        return (listOf(prvo) + priimki).joinToString(" ")
    }

    /** Pozdrav osebne tajnice (lastnik 21. 11. 2026); brez imena »Dosegli ste glasovno tajnico.«. */
    fun pozdrav(ime: String, uporabnikovZapis: String = ""): String {
        val toz = imeVTozilniku(ime, uporabnikovZapis)
        val poklicali = if (toz.isNotEmpty()) "Poklicali ste $toz." else "Dosegli ste glasovno tajnico."
        return "Tukaj Lina, pomočnica z umetno inteligenco. $poklicali Kaj naj sporočim?"
    }
}
