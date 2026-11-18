package si.safeer.lina.protocol

/** Zadetek iskanja po imeniku v klicalniku (ime in stevilka stika). */
data class ContactRow(val name: String, val number: String)

/**
 * Lastnik 18. 11. 2026: klicalnik Line mora iskati po imeniku. Zadetke iz ContactsProvider (ena vrstica na stevilko,
 * isti stik ima lahko vec zapisov z isto stevilko v razlicnem zapisu) uredimo: brez praznih stevilk, brez podvojenih
 * stevilk (primerjamo samo stevke, »+386 64 1« in »0641« NISTA ista stevilka, a »+386 64 1« in »+38664 1« sta),
 * po imenu (brez velikosti crk), najvec [max].
 */
object ContactMatches {
    const val DEFAULT_MAX = 6

    fun top(rows: List<ContactRow>, max: Int = DEFAULT_MAX): List<ContactRow> {
        val seen = HashSet<String>()
        return rows.asSequence()
            .filter { it.number.any(Char::isDigit) }
            .filter { seen.add(it.number.filter { c -> c.isDigit() || c == '+' }) }
            .sortedWith(compareBy({ it.name.lowercase() }, { it.number }))
            .take(max.coerceAtLeast(0))
            .toList()
    }
}
