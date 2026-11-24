package si.safeer.lina.samostojna

/**
 * Okna, ki se lahko odprejo sama ob odprtju zaslona Line. Vrstni red v enumu je prednost: opozorilo je vedno prvo.
 * (Lastnik 24. 11. 2026: po posodobitvi sta bila hkrati odprta opozorilo in okno Wi-Fi, Wi-Fi ga je prekril.)
 */
enum class OknoZagona { OPOZORILO, PARJENJE, OBVESTILA, WIFI }

/**
 * Vrsta oken ob zagonu: najvec eno odprto, naslednje sele, ko se prejsnje zapre. Okno, ki ga je uporabnik ze zaprl, se v istem
 * odprtju zaslona (tudi po zasuku) ne doda znova, dokler ga zaslon izrecno ne pozabi (Wi-Fi ob vrnitvi v aplikacijo).
 * Cisto stanje brez Androida; DialerActivity ga hrani in shrani ob zasuku (vNiz/izNiza).
 */
data class VrstaOkenZagona(
    val odprto: OknoZagona? = null,
    val cakajo: Set<OknoZagona> = emptySet(),
    val zaprta: Set<OknoZagona> = emptySet(),
) {
    fun dodaj(o: OknoZagona): VrstaOkenZagona =
        if (o == odprto || o in cakajo || o in zaprta) this else copy(cakajo = cakajo + o)

    /** Okno za prikaz zdaj in novo stanje; null, ce je eno ze odprto ali nobeno ne caka. */
    fun naslednje(): Pair<OknoZagona, VrstaOkenZagona>? {
        if (odprto != null) return null
        val o = cakajo.minOrNull() ?: return null
        return o to copy(odprto = o, cakajo = cakajo - o)
    }

    /** Okno je zaprto (ali ni vec potrebno): odprto ali cakajoce gre med zaprta. */
    fun zapri(o: OknoZagona): VrstaOkenZagona =
        copy(odprto = if (odprto == o) null else odprto, cakajo = cakajo - o, zaprta = zaprta + o)

    /** Zaprto okno se sme spet pokazati (npr. Wi-Fi ob vrnitvi v aplikacijo). */
    fun pozabi(o: OknoZagona): VrstaOkenZagona = copy(zaprta = zaprta - o)

    /**
     * Po zasuku (nova Activity): okna aplikacije so umrla s staro, zato odprto spet caka na vrsto; okno sistema (prosnja za
     * dovoljenje) prezivi in njegov izid pride v novo Activity, zato ostane odprto.
     */
    fun poZasuku(prezivijo: Set<OknoZagona>): VrstaOkenZagona =
        if (odprto == null || odprto in prezivijo) this else copy(odprto = null, cakajo = cakajo + odprto)

    fun vNiz(): String = listOf(odprto?.let(::setOf).orEmpty(), cakajo, zaprta).joinToString(";") { s -> s.joinToString(",") { it.name } }

    companion object {
        /** Neznan ali pokvarjen zapis = prazna vrsta (okna se ob odprtju dodajo znova). */
        fun izNiza(niz: String?): VrstaOkenZagona {
            val deli = niz?.split(";") ?: return VrstaOkenZagona()
            if (deli.size != 3) return VrstaOkenZagona()
            fun mn(s: String) = s.split(",").mapNotNull { ime -> OknoZagona.values().firstOrNull { it.name == ime } }.toSet()
            val odprto = mn(deli[0])
            if (odprto.size > 1) return VrstaOkenZagona()
            return VrstaOkenZagona(odprto.firstOrNull(), mn(deli[1]) - odprto, mn(deli[2]))
        }
    }
}
