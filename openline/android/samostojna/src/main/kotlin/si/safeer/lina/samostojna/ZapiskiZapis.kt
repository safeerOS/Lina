package si.safeer.lina.samostojna

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/** Zapiski kot JSON za trajno shrambo na telefonu. Izbrisani zapiski ostanejo kot oznaka (za poznejso sinhronizacijo). */
fun zapiskiVJson(zapiski: List<Zapisek>): String = json.encodeToString(ListSerializer(Zapisek.serializer()), zapiski)

/** null = poskodovan zapis: klicatelj ga NE prepise s praznim seznamom, da ne izgubi lastnikovih zapiskov. */
fun zapiskiIzJsona(besedilo: String): List<Zapisek>? =
    try { json.decodeFromString(ListSerializer(Zapisek.serializer()), besedilo) } catch (_: Exception) { null }

/** Doda zapisek; prazno besedilo ne doda nicesar. */
fun dodajZapisek(seznam: List<Zapisek>, besedilo: String, zdajMs: Long, id: String): List<Zapisek> {
    val b = besedilo.trim()
    if (b.isEmpty()) return seznam
    return seznam + Zapisek(id, b, zdajMs, false)
}

/** Izbris je oznaka (izbrisan = true) z novim casom, da zdruzi() ob sinhronizaciji izbris obdrzi. */
fun izbrisiZapisek(seznam: List<Zapisek>, id: String, zdajMs: Long): List<Zapisek> =
    seznam.map { if (it.id == id && !it.izbrisan) it.copy(izbrisan = true, cas = maxOf(zdajMs, it.cas + 1)) else it }

fun vidniZapiski(seznam: List<Zapisek>): List<Zapisek> = seznam.filter { !it.izbrisan }.sortedByDescending { it.cas }


/**
 * Besedilo datoteke z zapiski (lastnik 19. 11. 2026: privzeto v Dokumentih): naslov, opomba, nato zapiski od najnovejsega,
 * vsak z datumom in uro. Izbrisani zapiski v datoteki ne nastopajo.
 */
fun zapiskiVBesedilo(seznam: List<Zapisek>, naslov: String, opomba: String, oblikaCasa: (Long) -> String): String {
    val sb = StringBuilder(naslov).append('\n').append(opomba).append('\n')
    for (zapisek in vidniZapiski(seznam)) {
        sb.append('\n').append('[').append(oblikaCasa(zapisek.cas)).append("]\n").append(zapisek.besedilo).append('\n')
    }
    return sb.toString()
}

/** Skupne meje shrambe zapiskov (isti v Safeer OS): vec kot to shramba ne sprejme (sprejeto=false). */
const val NAJVEC_ZAPISKOV = 5000
const val NAJVEC_ZNAKOV = 262_144
/** Nagrobnik (izbrisan=true) se po tem roku odstrani. Naprava, ki je dlje brez povezave, lahko izbrisan zapisek spet oživi. */
const val ROK_NAGROBNIKA_MS = 90L * 24 * 60 * 60 * 1000

data class IzidCiscenja(val zapiski: List<Zapisek>, val sprejeto: Boolean)

private fun znakov(seznam: List<Zapisek>): Int = seznam.sumOf { it.besedilo.codePointCount(0, it.besedilo.length) }

/**
 * Ciscenje nagrobnikov po skupnih pravilih (skupni-vektorji/zapiski-zdruzitev-v1.json, razdelek ciscenje):
 * stari nagrobniki gredo, ob preseku meje najprej najstarejsi nagrobnik (pri enakem casu manjsi id); zivi zapiski nikoli.
 */
fun pocistiNagrobnike(
    seznam: List<Zapisek>, zdajMs: Long,
    rokMs: Long = ROK_NAGROBNIKA_MS, najvecZapiskov: Int = NAJVEC_ZAPISKOV, najvecZnakov: Int = NAJVEC_ZNAKOV,
): IzidCiscenja {
    val s = seznam.filterNot { it.izbrisan && it.cas < zdajMs - rokMs }.toMutableList()
    while (s.size > najvecZapiskov || znakov(s) > najvecZnakov) {
        val najstarejsi = s.filter { it.izbrisan }.minWithOrNull(compareBy<Zapisek>({ it.cas }, { it.id })) ?: break
        s.remove(najstarejsi)
    }
    return IzidCiscenja(s.sortedBy { it.id }, s.size <= najvecZapiskov && znakov(s) <= najvecZnakov)
}
