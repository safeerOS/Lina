package com.httpgateway.protocol

/**
 * Vrata za oddaljene ukaze.
 * DIAL je vedno izklopljen. ANSWER je dovoljen samo, ce klic se zvoni
 * in ga uporabnik ni dvignil sam. Owned se oznaci sele po uspesnem answer,
 * ne prej.
 */
object CallCommandPolicy {
    data class Decision(val allowed: Boolean, val reason: String? = null)

    private val controlled = setOf(
        CommandAction.ANSWER,
        CommandAction.HANGUP,
        CommandAction.HOLD,
        CommandAction.UNHOLD,
        CommandAction.DTMF,
        CommandAction.REJECT,
    )

    fun decide(action: CommandAction, callId: String, takenOverCallIds: Set<String>): Decision {
        if (action == CommandAction.DIAL) return Decision(false, "dial_disabled")
        if (action in controlled && callId in takenOverCallIds) return Decision(true)
        return Decision(false, "call_not_taken_over")
    }

    /**
     * ANSWER samo za klic, ki se se zvoni in ni bil rocno sprejet.
     * Zakasnel ANSWER po rocnem dvigu je zavrnitev.
     */
    fun allowRemoteAnswer(phase: TakeoverPhase, manuallyAnswered: Boolean): Decision {
        if (manuallyAnswered) return Decision(false, "call_answered_manually")
        if (phase != TakeoverPhase.RINGING) return Decision(false, "call_not_ringing")
        return Decision(true)
    }

    /** Lokalni odgovor, zavrnitev in prekinitev oznacijo klic, se preden gre ukaz v Telecom. */
    fun claimsBeforeTelecom(action: CommandAction): Boolean =
        action == CommandAction.ANSWER || action == CommandAction.REJECT || action == CommandAction.HANGUP

    /**
     * Lina ne sme zadrzati, prekiniti ali zamenjati klica, ki ga ima uporabnik.
     * Odgovor na cakajoci klic, ko je drug uporabnikov klic aktiven, bi ga dal na cakanje.
     */
    fun displacesUserCall(
        action: CommandAction,
        targetIsUserCall: Boolean,
        userOwnsOtherActiveCall: Boolean,
    ): Decision {
        if (targetIsUserCall && action != CommandAction.DIAL) return Decision(false, "user_call")
        if (userOwnsOtherActiveCall && (action == CommandAction.ANSWER || action == CommandAction.UNHOLD)) {
            return Decision(false, "would_hold_user_call")
        }
        return Decision(true)
    }

    /** Slusalka, zicna slusalka ali avtomobilski nacin: oddaljeni prevzem je zavrnjen. */
    fun blockedByExternalPickup(action: CommandAction, externalPickup: Boolean): Decision {
        if (!externalPickup) return Decision(true)
        if (action == CommandAction.ANSWER || action == CommandAction.HANGUP || action == CommandAction.REJECT) {
            return Decision(false, "external_pickup")
        }
        return Decision(true)
    }

    /**
     * Drug klic, ki ni Linin in ni koncan, je uporabnikov.
     * To velja tudi za DIALING in CONNECTING, ne samo za ACTIVE.
     */
    fun countsAsOtherUserCall(ownedByLina: Boolean, phase: TakeoverPhase): Boolean {
        if (ownedByLina) return false
        return phase != TakeoverPhase.ENDED
    }

    /** Zavrnjen ukaz ne sme poslati call.failed, sicer ziv klic umre. */
    fun commandResultEvent(@Suppress("UNUSED_PARAMETER") ok: Boolean): String = "command.completed"

    /**
     * Klic, ki ga je uporabnik sprejel ali zacel sam.
     * Najavljen klic, ki se se zvoni, se ne steje, dokler uporabnik slusalke ne dvigne.
     */
    fun isUserControlled(
        ownedByLina: Boolean,
        manuallyAnswered: Boolean,
        outgoing: Boolean,
        phase: TakeoverPhase,
        announced: Boolean,
    ): Boolean {
        if (ownedByLina) return false
        if (phase == TakeoverPhase.ENDED) return false
        if (manuallyAnswered) return true
        // Ta dohodni, ki se se zvoni, se ni uporabnikov.
        if (announced && phase == TakeoverPhase.RINGING && !outgoing) return false
        return true
    }
}
