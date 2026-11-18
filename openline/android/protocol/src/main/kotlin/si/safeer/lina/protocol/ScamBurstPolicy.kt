package si.safeer.lina.protocol

/**
 * Lastnik 18. 11. 2026: Lina se nauci vzorca prevar in jih ne spusti do uporabnika.
 * Izmerjeno v dnevniku klicev lastnika (14:49 in 17:36): 3-4 razlicne stevilke (SI in HR) v 7-10 s, vsak klic 0 s.
 * Pravilo: [minDistinct] RAZLICNIH neznanih stevilk v [windowMs] = val prevar. Vse stevilke vala se zapomnijo
 * (prevara se pogosto vrne s prejsnjo stevilko), zato jih pozneje blokiramo ze ob prvem klicu.
 * Izvzeto in nikoli stetje: klic v sili, stevilka iz imenika ali s seznama dovoljenih, skrita stevilka (ne moremo soditi).
 * Cista logika brez Androida; cas dobi od klicatelja, da jo preizkusimo.
 */
class ScamBurstPolicy(
    private val windowMs: Long = DEFAULT_WINDOW_MS,
    private val minDistinct: Int = DEFAULT_MIN_DISTINCT,
    private val maxRemembered: Int = DEFAULT_MAX_REMEMBERED,
    initialBlocked: Collection<String> = emptyList(),
) {
    enum class Verdict { ALLOW, BLOCK }

    private val recent = ArrayDeque<Pair<String, Long>>()
    private val blocked = LinkedHashSet<String>(initialBlocked.map(TakeoverPolicy::digits).filter { it.isNotEmpty() })

    /** [exempt]: stikli, seznam dovoljenih, klic v sili - te stevilke se ne stejejo in se ne blokirajo. */
    fun onIncoming(number: String, nowMs: Long, exempt: Boolean): Verdict {
        val digits = TakeoverPolicy.digits(number)
        if (digits.isEmpty() || exempt || TakeoverPolicy.isEmergency(number)) return Verdict.ALLOW
        if (digits in blocked) return Verdict.BLOCK
        while (recent.isNotEmpty() && nowMs - recent.first().second > windowMs) recent.removeFirst()
        recent.addLast(digits to nowMs)
        val distinct = recent.map { it.first }.toCollection(LinkedHashSet())
        if (distinct.size < minDistinct) return Verdict.ALLOW
        blocked.addAll(distinct)
        while (blocked.size > maxRemembered) blocked.remove(blocked.first())
        recent.clear()
        return Verdict.BLOCK
    }

    /** Nepravilna stevilka (npr. +386 z napacno dolzino) se blokira takoj in zapomni. */
    fun onMalformed(number: String, exempt: Boolean): Verdict {
        val digits = TakeoverPolicy.digits(number)
        if (digits.isEmpty() || exempt || !ScamNumberSignals.malformed(number)) return Verdict.ALLOW
        remember(digits)
        return Verdict.BLOCK
    }

    /**
     * Wangiri: tuja neznana stevilka zazvoni samo kratko ([WANGIRI_MS]) in prekine, da bi uporabnik poklical nazaj.
     * Stevilko zapomnimo; ob naslednjem klicu se tiho zavrne. Vrne true, ce je bila stevilka zapomnjena.
     */
    fun onUnansweredShortRing(number: String, ringMs: Long, exempt: Boolean): Boolean {
        val digits = TakeoverPolicy.digits(number)
        if (digits.isEmpty() || exempt || TakeoverPolicy.isEmergency(number)) return false
        if (ringMs !in 0 until WANGIRI_MS || !ScamNumberSignals.foreign(number)) return false
        remember(digits)
        return true
    }

    private fun remember(digits: String) {
        blocked.add(digits)
        while (blocked.size > maxRemembered) blocked.remove(blocked.first())
    }

    fun isBlocked(number: String): Boolean = TakeoverPolicy.digits(number) in blocked

    /** Za trajno shranjevanje na telefonu (nikoli v repozitorij). */
    fun blockedNumbers(): List<String> = blocked.toList()

    companion object {
        const val DEFAULT_WINDOW_MS = 15_000L
        const val DEFAULT_MIN_DISTINCT = 3
        const val DEFAULT_MAX_REMEMBERED = 300
        const val WANGIRI_MS = 5_000L
    }
}
