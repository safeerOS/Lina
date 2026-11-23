package si.safeer.lina.samostojna

/**
 * Vrstica [[budilka: 06:00|oznaka|dnevi]] postane predlog budilke v aplikaciji Ura (lastnik 23. 11. 2026:
 * »nastavi budilko ob 6 zjutraj za v sluzbo« mora res zvoniti, ne biti samo opomnik).
 * Ura je HH:MM (24 ur). Oznaka je neobvezna in kratka. Dnevi so neobvezni: ISO stevilke 1 = ponedeljek ... 7 = nedelja,
 * locene z vejico (ponavljajoca budilka); brez dni je budilka enkratna (naslednja taka ura).
 * Budilko nastavi aplikacija SAMO po uporabnikovi potrditvi, ne model.
 */
object BudilkaZapis {
    const val NAJVEC_ZNAKOV_OZNAKE = 60
    private val CAS = Regex("^([01]?\\d|2[0-3])[:.]([0-5]\\d)$")

    fun razclenji(vsebina: String): Odgovor.NovaBudilka? {
        val deli = vsebina.split("|", limit = 3).map { it.trim() }
        val m = CAS.matchEntire(deli[0]) ?: return null
        val oznaka = deli.getOrNull(1).orEmpty().replace(Regex("[\\u0000-\\u001f]"), " ").trim().take(NAJVEC_ZNAKOV_OZNAKE)
        val niz = deli.getOrNull(2).orEmpty()
        val dnevi = if (niz.isBlank()) {
            emptyList()
        } else {
            val seznam = niz.split(",").map { it.trim().toIntOrNull() ?: return null }
            if (seznam.any { it !in 1..7 }) return null
            seznam.distinct().sorted()
        }
        return Odgovor.NovaBudilka(m.groupValues[1].toInt(), m.groupValues[2].toInt(), oznaka, dnevi)
    }
}
