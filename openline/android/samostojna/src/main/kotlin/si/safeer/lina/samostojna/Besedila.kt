package si.safeer.lina.samostojna

// Podprti jeziki uporabniskega vmesnika samostojne asistentke.
enum class Jezik {
    SL,
    EN
}

// Zbirka besedil za glavni zaslon v izbranem jeziku.
data class BesedilaZaslona(
    val naslovMiruje: String,
    val naslovPoslusa: String,
    val naslovRazmislja: String,
    val naslovGovori: String,
    val naslovNapaka: String,
    val naslovIzklopljena: String,
    val stikaloVklop: String,
    val stikaloIzklop: String,
    val gumbSporocila: String,
    val gumbSnemanje: String,
    val gumbZapri: String,
    val povezavaNiParjeno: String,
    val povezavaDomaLan: String,
    val povezavaGlobalNeposredno: String,
    val povezavaGlobalRele: String,
    val povezavaNedosegljivo: String
)

private val slovenskaBesedila = BesedilaZaslona(
    naslovMiruje = "Pripravljena",
    naslovPoslusa = "Poslušam",
    naslovRazmislja = "Razmišljam",
    naslovGovori = "Govorim",
    naslovNapaka = "Napaka",
    naslovIzklopljena = "Asistentka je izklopljena",
    stikaloVklop = "Vklop asistentke",
    stikaloIzklop = "Izklop asistentke",
    gumbSporocila = "Sporočila",
    gumbSnemanje = "Snemanje",
    gumbZapri = "Zapri",
    povezavaNiParjeno = "Samostojno delovanje (ni parjeno z računalnikom)",
    povezavaDomaLan = "Povezano v domačem omrežju (LAN)",
    povezavaGlobalNeposredno = "Povezano prek Safeer Global Link (neposredno)",
    povezavaGlobalRele = "Povezano prek Safeer Global Link (rele)",
    povezavaNedosegljivo = "Računalnik nedosegljiv (deluje samostojno)"
)

private val angleskaBesedila = BesedilaZaslona(
    naslovMiruje = "Ready",
    naslovPoslusa = "Listening",
    naslovRazmislja = "Thinking",
    naslovGovori = "Speaking",
    naslovNapaka = "Error",
    naslovIzklopljena = "Assistant is turned off",
    stikaloVklop = "Turn on assistant",
    stikaloIzklop = "Turn off assistant",
    gumbSporocila = "Messages",
    gumbSnemanje = "Record",
    gumbZapri = "Close",
    povezavaNiParjeno = "Standalone mode (not paired with computer)",
    povezavaDomaLan = "Connected on home network (LAN)",
    povezavaGlobalNeposredno = "Connected via Safeer Global Link (direct)",
    povezavaGlobalRele = "Connected via Safeer Global Link (relay)",
    povezavaNedosegljivo = "Computer unreachable (works standalone)"
)

// Vrne besedila za izbrani jezik (privzeto slovenscina).
fun besedila(jezik: Jezik = Jezik.SL): BesedilaZaslona {
    return when (jezik) {
        Jezik.SL -> slovenskaBesedila
        Jezik.EN -> angleskaBesedila
    }
}

// Vrne naslov glavnega zaslona glede na stanje vklopa, fazo in jezik.
fun naslovZaStanje(vklopljena: Boolean, faza: Faza, jezik: Jezik = Jezik.SL): String {
    val b = besedila(jezik)
    if (!vklopljena) return b.naslovIzklopljena
    return when (faza) {
        Faza.MIRUJE -> b.naslovMiruje
        Faza.POSLUSA -> b.naslovPoslusa
        Faza.RAZMISLJA -> b.naslovRazmislja
        Faza.GOVORI -> b.naslovGovori
        Faza.NAPAKA -> b.naslovNapaka
    }
}

// Vrne seznam vseh besedil v izbranem jeziku (zasloni, oznake, opisi, stanja) za preverjanje pravil.
fun vsaBesedila(jezik: Jezik = Jezik.SL): List<String> {
    val b = besedila(jezik)
    val osnovna = listOf(
        b.naslovMiruje,
        b.naslovPoslusa,
        b.naslovRazmislja,
        b.naslovGovori,
        b.naslovNapaka,
        b.naslovIzklopljena,
        b.stikaloVklop,
        b.stikaloIzklop,
        b.gumbSporocila,
        b.gumbSnemanje,
        b.gumbZapri,
        b.povezavaNiParjeno,
        b.povezavaDomaLan,
        b.povezavaGlobalNeposredno,
        b.povezavaGlobalRele,
        b.povezavaNedosegljivo
    )
    val zasloniBesedila = Zaslon.values().flatMap { listOf(it.oznaka(jezik), it.opis(jezik)) }
    return osnovna + zasloniBesedila
}

private val vzorecValute = Regex(
    "(?:€|\\$|\\b(?:eur|usd|gbp|chf)\\b|\\b\\d+(?:[.,]\\d+)?\\s*(?:evrov|evra|eur|usd|sit)\\b)",
    RegexOption.IGNORE_CASE
)

private val vzorecBrezplacnosti = Regex(
    "\\b(?:brezplacn[oaie]|brez\\s+doplacila|zastonj|gratis|podarimo|free\\s+of\\s+charge|for\\s+free|(?:is|are)\\s+free)\\b",
    RegexOption.IGNORE_CASE
)

// Preveri, ali besedilo vsebuje nedovoljene navedbe cen ali obljube o brezplacnosti.
fun vsebujeCenoAliBrezplacno(besedilo: String): Boolean {
    val normalizirano = besedilo
        .replace('č', 'c')
        .replace('Č', 'C')
        .replace('š', 's')
        .replace('Š', 'S')
        .replace('ž', 'z')
        .replace('Ž', 'Z')
    return vzorecValute.containsMatchIn(normalizirano) || vzorecBrezplacnosti.containsMatchIn(normalizirano)
}
