package si.safeer.lina.samostojna

/**
 * Moske oblike, s katerimi Lina govori o sebi, in zenske ustreznice (glagoli v pretekliku in pogosti pridevniki).
 * 23. 11. 2026: dodani glagoli in pridevniki iz klicev in klepeta; »hotel« namenoma ni na seznamu (samostalnik: »Našla sem hotel.«).
 */
private val ZENSKE = mapOf(
    "zapisal" to "zapisala", "popravil" to "popravila", "posodobil" to "posodobila", "razumel" to "razumela", "shranil" to "shranila",
    "slišal" to "slišala", "slisal" to "slisala", "poslal" to "poslala", "pripravil" to "pripravila", "preveril" to "preverila",
    "našel" to "našla", "nasel" to "nasla", "zabeležil" to "zabeležila", "zabelezil" to "zabelezila", "naredil" to "naredila",
    "pozabil" to "pozabila", "prebral" to "prebrala", "dodal" to "dodala", "izbrisal" to "izbrisala", "prestavil" to "prestavila",
    "zaključil" to "zaključila", "zakljucil" to "zakljucila",
    "poklical" to "poklicala", "sporočil" to "sporočila", "sporocil" to "sporocila", "obvestil" to "obvestila", "poiskal" to "poiskala",
    "iskal" to "iskala", "dobil" to "dobila", "pogledal" to "pogledala", "uredil" to "uredila", "odprl" to "odprla", "potrdil" to "potrdila",
    "vprašal" to "vprašala", "vprasal" to "vprasala", "odgovoril" to "odgovorila", "nastavil" to "nastavila", "spremenil" to "spremenila",
    "ustvaril" to "ustvarila", "opazil" to "opazila", "prejel" to "prejela", "mislil" to "mislila", "želel" to "želela", "zelel" to "zelela",
    "vedel" to "vedela", "videl" to "videla", "posredoval" to "posredovala", "predal" to "predala", "napisal" to "napisala", "bil" to "bila",
    "vesel" to "vesela", "prepričan" to "prepričana", "preprican" to "prepricana", "pripravljen" to "pripravljena",
    "hvaležen" to "hvaležna", "hvalezen" to "hvalezna", "zadovoljen" to "zadovoljna", "gotov" to "gotova",
)

private val GLAGOLI = ZENSKE.keys.sortedByDescending { it.length }.joinToString("|")

/** Kratke besede med pomoznikom in glagolom: »sem ponovno posodobil«, »sem ti že poslal«, »sem sporočilo zapisal« (do tri). */
private const val VMES = "(?:(?:ti|vam|ga|jo|jih|mu|ji|to|vse|že|ze|še|ponovno|spet|tudi|ravnokar|pravkar|res|sporočilo|sporocilo)\\s+){0,3}"

/** Pomožnik (sem, nisem, bi bil; »sem bil« tudi pred pridevnikom), nato do tri kratke besede, nato glagol: »sem zapisal«, »nisem bil prepričan«. */
private val MOSKA_OBLIKA = Regex(
    "\\b(?:sem|(?<!\\p{Lu}\\p{Ll}{1,20}\\s)bi\\s+bil|nisem)\\s+(?:${VMES}bil\\s+)?$VMES($GLAGOLI)\\b",
    RegexOption.IGNORE_CASE,
)

/** Obratni vrstni red: »Zapisal sem sporočilo«. Tretja oseba (»je zapisal«) se ne ujame, ker zahteva »sem« takoj za glagolom. */
private val MOSKA_OBLIKA_OBRATNO = Regex("(?:(?<![\\p{L}\\p{N}»\"“„]\\s{0,3})|(?<=(?<!\\p{L})(?:in|ter|pa|ali|ampak|ker)\\s{1,3}))(?<![\\p{L}\\p{N}])($GLAGOLI)\\s+sem\\b", RegexOption.IGNORE_CASE)

/** Moške oblike, s katerimi Lina govori o sebi (»sem zapisal«, »zapisal sem«). Ženski »zapisala« se ne ujame. Vrne najdene glagole (brez ponovitev). */
fun moskeOblikeLine(besedilo: String): List<String> =
    (MOSKA_OBLIKA.findAll(besedilo) + MOSKA_OBLIKA_OBRATNO.findAll(besedilo)).map { it.groupValues[1].lowercase() }.distinct().toList()


private fun zenskaOblika(glagol: String): String? {
    val zenska = ZENSKE[glagol.lowercase()] ?: return null
    return if (glagol.first().isUpperCase()) zenska.replaceFirstChar { it.uppercase() } else zenska
}

private val BI_BIL = Regex("\\bbil\\b", RegexOption.IGNORE_CASE)

/**
 * Zasciteni odseki ostanejo dobesedni: vrstice z oznakami ([[zapisek: ...]] ipd., besede uporabnika) in navedki (»...«, "...", „...“;
 * besede nekoga drugega ali osnutek v uporabnikovem imenu), tudi cez vec vrstic (23. 11. 2026).
 */
private val ZASCITENO = Regex("(?m)^[ \\t]*\\[\\[.*]][ \\t]*$|»[^«]*«|„[^“”]*[“”]|\"[^\"]*\"")

/** Besedilni odgovor: moške oblike, s katerimi Lina govori o sebi (»sem zapisal«, »bi bil zapisal«), zamenja z ženskimi (tudi pomožnik »bil« -> »bila«). */
fun popraviMoskeOblike(besedilo: String): String {
    val izhod = StringBuilder()
    var od = 0
    for (n in ZASCITENO.findAll(besedilo)) {
        izhod.append(popraviOdsek(besedilo.substring(od, n.range.first))).append(n.value)
        od = n.range.last + 1
    }
    return izhod.append(popraviOdsek(besedilo.substring(od))).toString()
}

private fun popraviOdsek(besedilo: String): String {
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
