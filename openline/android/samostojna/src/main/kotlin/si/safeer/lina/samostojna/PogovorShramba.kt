package si.safeer.lina.samostojna

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Trajen pogovor lastnika z Lino na telefonu (20. 11. 2026): shrani se, da ga sinhronizacija prenese na racunalnik in da se pogovor
 * lahko nadaljuje tam (in obratno). Najvec [NAJVEC] sporocil; sporocilo je enolicno po (vloga, cas, besedilo), kot na racunalniku.
 */
class PogovorShramba(private val shramba: Shramba) {
    companion object {
        const val NAJVEC = 200
        const val NAJVEC_ZNAKOV = 2000
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    }

    private var sporocila: MutableList<PogovorSinhron> = nalozi()

    private fun nalozi(): MutableList<PogovorSinhron> = try {
        val s = shramba.preberi()
        if (s.isNullOrBlank()) mutableListOf() else json.decodeFromString<List<PogovorSinhron>>(s).filter(::veljavno).toMutableList()
    } catch (_: Exception) {
        mutableListOf()
    }

    private fun veljavno(p: PogovorSinhron) =
        (p.vloga == "lastnik" || p.vloga == "lina") && p.besedilo.isNotBlank() && p.besedilo.length <= NAJVEC_ZNAKOV &&
            runCatching { java.time.Instant.parse(p.cas) }.isSuccess

    @Synchronized
    fun vsa(): List<PogovorSinhron> = sporocila.toList()

    /** Doda sporocilo (besedilo se skrajsa na mejo); vrne false, ce je prazno ali ze obstaja. */
    @Synchronized
    fun dodaj(vloga: String, besedilo: String, cas: java.time.Instant = java.time.Instant.now()): Boolean =
        zlij(listOf(PogovorSinhron(vloga, besedilo.trim().take(NAJVEC_ZNAKOV), cas.toString()))) > 0

    /** Sporocila z racunalnika: dodajo se manjkajoca, vrstni red po casu; vrne stevilo dodanih. */
    @Synchronized
    fun zlij(prejeta: List<PogovorSinhron>): Int = zlijInVrni(prejeta).size

    /** Kot [zlij], vrne pa dodana sporocila (za spomin pogovorov: samo nova, brez podvajanja). */
    @Synchronized
    fun zlijInVrni(prejeta: List<PogovorSinhron>): List<PogovorSinhron> {
        val znana = sporocila.map { Triple(it.vloga, it.cas, it.besedilo) }.toHashSet()
        val dodana = mutableListOf<PogovorSinhron>()
        for (p in prejeta) {
            if (!veljavno(p) || !znana.add(Triple(p.vloga, p.cas, p.besedilo))) continue
            sporocila.add(p); dodana += p
        }
        if (dodana.isEmpty()) return dodana
        sporocila = sporocila.sortedBy { java.time.Instant.parse(it.cas) }.takeLast(NAJVEC).toMutableList()
        try { shramba.shrani(json.encodeToString(sporocila)) } catch (_: Exception) { /* ostane v pomnilniku, naslednji zapis poskusi znova */ }
        return dodana
    }
}
