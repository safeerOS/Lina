package si.safeer.lina.samostojna

private const val GLAGOLI = "zapisal|popravil|posodobil|razumel|shranil|slišal|slisal|poslal|pripravil|preveril|našel|nasel|zabeležil|zabelezil|naredil|pozabil|prebral|dodal|izbrisal|prestavil|zaključil|zakljucil"

/** Pomožnik pred glagolom (sem, bi bil, nisem ...), nato morebitni predmet, nato glagol: »sem zapisal«, »bi bil zapisal«. */
private val MOSKA_OBLIKA = Regex(
    "\\b(?:sem|(?<!\\p{Lu}\\p{Ll}{1,20}\\s)bi\\s+bil|nisem|sem\\s+tudi|sem\\s+ravnokar)\\s+(?:ti\\s+|vam\\s+|to\\s+|vse\\s+|sporočilo\\s+|sporocilo\\s+)?($GLAGOLI)\\b",
    RegexOption.IGNORE_CASE,
)

/** Obratni vrstni red: »Zapisal sem sporočilo«. Tretja oseba (»je zapisal«) se ne ujame, ker zahteva »sem« takoj za glagolom. */
private val MOSKA_OBLIKA_OBRATNO = Regex("(?<![\\p{L}\\p{N}»\"“„]\\s{0,3})\\b($GLAGOLI)\\s+sem\\b", RegexOption.IGNORE_CASE)

/** Moške oblike, s katerimi Lina govori o sebi (»sem zapisal«, »zapisal sem«). Ženski »zapisala« se ne ujame. Vrne najdene glagole (brez ponovitev). */
fun moskeOblikeLine(besedilo: String): List<String> =
    (MOSKA_OBLIKA.findAll(besedilo) + MOSKA_OBLIKA_OBRATNO.findAll(besedilo)).map { it.groupValues[1].lowercase() }.distinct().toList()

private val ZENSKE = mapOf(
    "zapisal" to "zapisala", "popravil" to "popravila", "posodobil" to "posodobila", "razumel" to "razumela", "shranil" to "shranila",
    "slišal" to "slišala", "slisal" to "slisala", "poslal" to "poslala", "pripravil" to "pripravila", "preveril" to "preverila",
    "našel" to "našla", "nasel" to "nasla", "zabeležil" to "zabeležila", "zabelezil" to "zabelezila", "naredil" to "naredila",
    "pozabil" to "pozabila", "prebral" to "prebrala", "dodal" to "dodala", "izbrisal" to "izbrisala", "prestavil" to "prestavila",
    "zaključil" to "zaključila", "zakljucil" to "zakljucila",
)

private fun zenskaOblika(glagol: String): String? {
    val zenska = ZENSKE[glagol.lowercase()] ?: return null
    return if (glagol.first().isUpperCase()) zenska.replaceFirstChar { it.uppercase() } else zenska
}

private val BI_BIL = Regex("\\bbil\\b", RegexOption.IGNORE_CASE)

/** Besedilni odgovor: moške oblike, s katerimi Lina govori o sebi (»sem zapisal«, »bi bil zapisal«), zamenja z ženskimi (tudi pomožnik »bil« -> »bila«). */
fun popraviMoskeOblike(besedilo: String): String {
    val prvi = MOSKA_OBLIKA.replace(besedilo) { m ->
        val glagol = m.groupValues[1]
        val nova = zenskaOblika(glagol) ?: return@replace m.value
        val glava = m.value.dropLast(glagol.length)
        // »bi bil zapisal« -> »bi bila zapisala«
        val glava2 = BI_BIL.replace(glava) { b -> if (b.value.first().isUpperCase()) "Bila" else "bila" }
        glava2 + nova
    }
    return MOSKA_OBLIKA_OBRATNO.replace(prvi) { m ->
        val glagol = m.groupValues[1]
        val nova = zenskaOblika(glagol) ?: return@replace m.value
        nova + m.value.drop(glagol.length)
    }
}

private fun besede(s: String) = s.lowercase().replace(Regex("[^\\p{L}\\p{N}\\s]"), " ").split(Regex("\\s+")).filter { it.isNotBlank() }

/** Koliko Lininih stavkov (vrstic) je skoraj enakih (>= 80 % skupnih besed) enemu od prejšnjih. Kratke vrstice (< 4 besede) se ne štejejo. */
fun stevilePonovitev(besedilo: String): Int {
    val prej = mutableListOf<Set<String>>()
    var n = 0
    for (v in besedilo.lines()) {
        val b = besede(v)
        if (b.size < 4) continue
        val mn = b.toSet()
        if (prej.any { p -> mn.intersect(p).size.toDouble() / maxOf(mn.union(p).size, 1) >= 0.8 }) n++
        prej += mn
    }
    return n
}
