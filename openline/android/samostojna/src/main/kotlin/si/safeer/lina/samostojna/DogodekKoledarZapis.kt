package si.safeer.lina.samostojna

/**
 * Vrstica [[dogodek: 2026-11-24T10:00:00+01:00|60|naslov]] (zacetek ISO z odmikom | trajanje v minutah | naslov) postane predlog dogodka.
 * Veljavnost: cas v prihodnosti (do leta naprej, kot pri opomnikih), trajanje 5 min do 24 ur, naslov neprazen in kratek.
 * Dogodek v koledar zapise aplikacija SAMO po uporabnikovi potrditvi (lastnik 23. 11. 2026: Lina sama ureja urnik, ko se dogovorita).
 */
object DogodekKoledarZapis {
    const val NAJVEC_ZNAKOV_NASLOVA = 120

    fun razclenji(vsebina: String, zdajMs: Long): Odgovor.NoviDogodek? {
        val deli = vsebina.split("|", limit = 3).map { it.trim() }
        if (deli.size != 3) return null
        val zacetek = OpomnikCas.izracunaj(deli[0], zdajMs) ?: return null
        val trajanje = deli[1].toIntOrNull()?.takeIf { it in 5..1440 } ?: return null
        val naslov = deli[2].replace(Regex("[\\u0000-\\u001f]"), " ").trim().take(NAJVEC_ZNAKOV_NASLOVA)
        if (naslov.isEmpty()) return null
        return Odgovor.NoviDogodek(naslov, zacetek, zacetek + trajanje * 60_000L)
    }
}
