package si.safeer.lina.protocol

/**
 * Odlocitev, ali Lina prevzame klic.
 * Prevzem je dovoljen samo za se neodgovorjen dohodni klic, ko potece cas zvonjenja
 * in je stevilka na seznamu. Prazen seznam ne dovoli nobene. Klici v sili nikoli.
 */
enum class TakeoverDirection { INCOMING, OUTGOING, UNKNOWN }

enum class TakeoverPhase { RINGING, DIALING, ACTIVE, ENDED, OTHER }

enum class TakeoverVerdict { TAKE, WAIT, REFUSE }

data class TakeoverFacts(
    val direction: TakeoverDirection,
    val phase: TakeoverPhase,
    /** Uporabnik je slusalko ze dvignil, preden je Lina prevzela klic. */
    val manuallyAnswered: Boolean,
    val ringingForMs: Long,
    val ringTimeoutMs: Long,
    val number: String,
    val allowlist: Collection<String>,
    /** Operaterjev seznam stevilk v sili (TelephonyManager), ce je na voljo. */
    val carrierEmergency: Boolean = false,
    /**
     * Uporabnik ze ima svoj aktiven klic.
     * Prevzem cakajocega bi ta klic dal na cakanje, zato je zavrnjen.
     */
    val userCallActive: Boolean = false,
    /** Seznam je stikalo. Privzeto vklopljen. Ob izklopu se prevzame tudi prazna in neznana stevilka. */
    val allowlistEnabled: Boolean = true,
    /** PROPERTY_EMERGENCY_CALLBACK_MODE. */
    val emergencyCallback: Boolean = false,
    /** Nekaj minut po uporabnikovem klicu na stevilko v sili. */
    val emergencyCooldown: Boolean = false,
    /** Prikljucena slusalka, zica ali avtomobilski nacin. */
    val externalPickup: Boolean = false,
    /**
     * Pregled 16 (N1): klic je na liniji, ki jo uporabnik dovoli Lini (LineGate.allows). Brez privzete vrednosti:
     * vsak klicatelj mora odlociti, sicer bi Lina prevzemala klice na drugi SIM/eSIM.
     */
    val lineAllowed: Boolean,
)

object TakeoverPolicy {
    const val EMERGENCY_COOLDOWN_MS = 5 * 60 * 1000L

    fun inEmergencyCooldown(lastEmergencyDialAtMs: Long?, nowMs: Long): Boolean =
        lastEmergencyDialAtMs != null && nowMs >= lastEmergencyDialAtMs &&
            nowMs - lastEmergencyDialAtMs < EMERGENCY_COOLDOWN_MS

    fun evaluate(facts: TakeoverFacts): TakeoverVerdict {
        if (facts.carrierEmergency || isEmergency(facts.number)) return TakeoverVerdict.REFUSE
        if (facts.emergencyCallback || facts.emergencyCooldown) return TakeoverVerdict.REFUSE
        // Cakajoci klic ne sme dati uporabnikovega klica na cakanje.
        if (facts.userCallActive) return TakeoverVerdict.REFUSE
        if (facts.direction != TakeoverDirection.INCOMING) return TakeoverVerdict.REFUSE
        if (facts.manuallyAnswered || facts.phase == TakeoverPhase.ACTIVE || facts.phase == TakeoverPhase.ENDED) {
            return TakeoverVerdict.REFUSE
        }
        if (facts.phase != TakeoverPhase.RINGING) return TakeoverVerdict.REFUSE
        if (facts.externalPickup) return TakeoverVerdict.REFUSE
        // Klic na drugi liniji (SIM/eSIM, ki je uporabnik ni izbral) ostane samo na telefonu.
        if (!facts.lineAllowed) return TakeoverVerdict.REFUSE
        // Stikalo je za preizkus. Pred njim ostanejo sila, smer, rocni dvig in drug klic.
        if (!mayTakeOver(facts.number, facts.allowlist, facts.allowlistEnabled)) return TakeoverVerdict.REFUSE
        if (facts.ringingForMs < facts.ringTimeoutMs) return TakeoverVerdict.WAIT
        return TakeoverVerdict.TAKE
    }

    /**
     * TAKE brez sveze lupine in brez povezave na prehod pomeni tisino.
     * Brez pinga ali brez povezave je odgovor REFUSE.
     */
    fun allowTake(verdict: TakeoverVerdict, freshPingOk: Boolean, gatewayConnected: Boolean): TakeoverVerdict {
        if (verdict != TakeoverVerdict.TAKE) return verdict
        if (!freshPingOk || !gatewayConnected) return TakeoverVerdict.REFUSE
        return TakeoverVerdict.TAKE
    }

    /**
     * Ena odlocitev za seznam. Ob izklopu velja tudi prazna in neznana stevilka.
     * Stevilka v sili ne velja nikoli, tudi ko je stikalo izklopljeno.
     */
    fun mayTakeOver(number: String, allowlist: Collection<String>, allowlistEnabled: Boolean): Boolean {
        if (isEmergency(number)) return false
        if (!allowlistEnabled) return true
        return onAllowlist(number, allowlist)
    }

    fun onAllowlist(number: String, allowlist: Collection<String>): Boolean {
        if (isEmergency(number)) return false
        val mine = digits(number)
        if (mine.isEmpty() || allowlist.isEmpty()) return false
        return allowlist.any { sameNumber(mine, digits(it)) }
    }

    fun isEmergency(number: String): Boolean {
        val raw = digits(number)
        if (raw.isEmpty()) return false
        if (raw in EMERGENCY) return true
        val stripped = raw.trimStart('0')
        return stripped != raw && stripped in EMERGENCY
    }

    fun digits(value: String): String = value.filter(Char::isDigit)

    private fun sameNumber(a: String, b: String): Boolean {
        if (a.isEmpty() || b.isEmpty()) return false
        if (a == b) return true
        // Zadnjih 8 stevk pokrije lokalni zapis in E.164, kratkih stevilk pa ne.
        return a.length >= 8 && b.length >= 8 && a.takeLast(8) == b.takeLast(8)
    }

    private val EMERGENCY = setOf(
        "112", "911", "999", "000", "110", "113", "114", "118", "119",
        "100", "101", "102", "103", "108", "122", "133", "144", "155",
    )
}
