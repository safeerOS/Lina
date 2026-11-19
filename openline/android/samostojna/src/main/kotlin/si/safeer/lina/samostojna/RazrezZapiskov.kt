package si.safeer.lina.samostojna

/**
 * Velik zapisek gre prek lokalnega vmesnika Safeer OS v vec manjsih delih po vrsti (odlocitev lastnika 19. 11. 2026: najbolj
 * enostavna sinhronizacija, brez datotecnega deskriptorja in brez sprememb v Safeer OS). Za Safeer je del navaden zapisek z ID-jem
 * <osnovniId>~<k>~<m>; zlitje po skupnih pravilih ostane nespremenjeno. Lina del zlozi nazaj v en zapisek.
 *
 * Pravila:
 *  - zapisek, ki ga JSON ne spravi pod mejo Bindra, se razreze na dele po najvec DEL_NAJVEC_JSON znakov JSON, po kodnih tockah
 *    (surrogatni par se ne prelomi); vsi deli imajo cas zapiska;
 *  - zapisek se sestavi samo, ko so prisotni VSI deli iste verzije (isti cas in m); nepopolna verzija ni vidna (sinhronizacija v teku);
 *  - zmaga najnovejsa verzija (navaden zapisek ali popolna skupina delov); pri enakem casu zmaga izbris, nato navaden zapisek;
 *  - zastareli ziv deli (cas < cas zmagovalca) dobijo nagrobnik s casom zmagovalca; deli nepopolne novejse verzije ostanejo;
 *  - izbris velikega zapiska je en navaden nagrobnik (prazno besedilo), ki skrije dele.
 * Znana omejitev: zastareli navadni zapisek (pred razrezom) ostane ziv v Safeer shrambi, dokler ga uporabnik ne izbrise.
 */
const val DEL_NAJVEC_JSON = 90_000
private const val CEZ_BINDER_NAJVEC_JSON = 118_000
private val vzorecDela = Regex("^(.+)~(\\d{1,4})~(\\d{1,4})$")

data class DelZapiska(val osnovniId: String, val k: Int, val m: Int)

fun razberiDel(id: String): DelZapiska? {
    val r = vzorecDela.matchEntire(id) ?: return null
    val k = r.groupValues[2].toInt()
    val m = r.groupValues[3].toInt()
    if (m < 2 || k < 1 || k > m) return null
    return DelZapiska(r.groupValues[1], k, m)
}

/** Dolzina enega znaka v JSON besedilu (kot ga izpise kotlinx.serialization), v enotah UTF-16 kot String.length. */
private fun jsonDolzina(cp: Int): Int = when {
    cp == '"'.code || cp == '\\'.code -> 2
    cp == 8 || cp == 9 || cp == 10 || cp == 12 || cp == 13 -> 2
    cp < 0x20 -> 6
    cp > 0xFFFF -> 2
    else -> 1
}

/** Majhen zapisek ostane nespremenjen; velik ziv gre v dele; velik nagrobnik postane navaden nagrobnik brez besedila. */
fun razrezi(z: Zapisek): List<Zapisek> {
    if (zapiskiVJson(listOf(z)).length <= CEZ_BINDER_NAJVEC_JSON) return listOf(z)
    if (z.izbrisan) return listOf(z.copy(besedilo = ""))
    val deli = mutableListOf<String>()
    val sb = StringBuilder()
    var dol = 0
    var i = 0
    val s = z.besedilo
    while (i < s.length) {
        val cp = s.codePointAt(i)
        val d = jsonDolzina(cp)
        if (dol + d > DEL_NAJVEC_JSON && sb.isNotEmpty()) { deli += sb.toString(); sb.setLength(0); dol = 0 }
        sb.appendCodePoint(cp)
        dol += d
        i += Character.charCount(cp)
    }
    if (sb.isNotEmpty()) deli += sb.toString()
    val m = deli.size
    return deli.mapIndexed { n, del -> Zapisek("${z.id}~${n + 1}~$m", del, z.cas, false) }
}

data class SestavljenoStanje(
    val zapiski: List<Zapisek>,
    /** Nagrobniki za zastarele dele; pošlji jih skupaj s stanjem. */
    val ciscenje: List<Zapisek>,
    /** Nepopolne novejse verzije (sinhronizacija v teku). */
    val nepopolnih: Int,
)

/** Zlozi dele v zapiske po pravilih zgoraj. Vhod je lahko mešan (navadni zapiski in deli). */
fun sestavi(vse: List<Zapisek>): SestavljenoStanje {
    val enolicni = zdruzi(vse, emptyList())
    val navadni = mutableMapOf<String, Zapisek>()
    val deli = mutableMapOf<String, MutableList<Pair<DelZapiska, Zapisek>>>()
    for (z in enolicni) {
        val d = razberiDel(z.id)
        if (d == null) navadni[z.id] = z else deli.getOrPut(d.osnovniId) { mutableListOf() }.add(d to z)
    }
    val izhod = mutableListOf<Zapisek>()
    val ciscenje = mutableListOf<Zapisek>()
    var nepopolnih = 0
    for (osnovni in (navadni.keys + deli.keys).toSortedSet()) {
        val navaden = navadni[osnovni]
        val zivi = deli[osnovni].orEmpty().filter { !it.second.izbrisan }
        val skupine = zivi.groupBy { it.second.cas to it.first.m }
        val popolne = mutableListOf<Zapisek>()
        val nepopolneCasi = mutableListOf<Long>()
        for ((kljuc, clani) in skupine) {
            val (cas, m) = kljuc
            val ks = clani.map { it.first.k }.toSet()
            if (clani.size == m && ks == (1..m).toSet()) {
                popolne += Zapisek(osnovni, clani.sortedBy { it.first.k }.joinToString("") { it.second.besedilo }, cas, false)
            } else {
                nepopolneCasi += cas
            }
        }
        val kandidati = listOfNotNull(navaden) + popolne
        val zmagovalec = kandidati.maxWithOrNull(compareBy<Zapisek>({ it.cas }, { it.izbrisan }))
        if (zmagovalec != null) {
            izhod += zmagovalec
            for ((_, del) in zivi) if (del.cas < zmagovalec.cas) ciscenje += Zapisek(del.id, "", zmagovalec.cas, true)
        }
        nepopolnih += nepopolneCasi.count { zmagovalec == null || it > zmagovalec.cas }
    }
    return SestavljenoStanje(izhod.sortedBy { it.id }, ciscenje, nepopolnih)
}
