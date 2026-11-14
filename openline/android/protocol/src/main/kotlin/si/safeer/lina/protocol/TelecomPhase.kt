package si.safeer.lina.protocol

/**
 * Preslikava stanj android.telecom.Call v fazo prevzema.
 * DIALING in CONNECTING sta uporabnikov klic, tudi ce se ni ACTIVE.
 * Stevilke so vrednosti iz android.telecom.Call in se ne smejo razhajati.
 */
object TelecomPhase {
    const val STATE_DIALING = 1
    const val STATE_RINGING = 2
    const val STATE_HOLDING = 3
    const val STATE_ACTIVE = 4
    const val STATE_DISCONNECTED = 7
    const val STATE_CONNECTING = 9
    const val STATE_DISCONNECTING = 10
    const val STATE_AUDIO_PROCESSING = 12
    const val STATE_SIMULATED_RINGING = 13

    fun phase(androidState: Int): TakeoverPhase = when (androidState) {
        STATE_RINGING, STATE_SIMULATED_RINGING -> TakeoverPhase.RINGING
        STATE_DIALING, STATE_CONNECTING -> TakeoverPhase.DIALING
        STATE_ACTIVE, STATE_HOLDING, STATE_AUDIO_PROCESSING -> TakeoverPhase.ACTIVE
        STATE_DISCONNECTED, STATE_DISCONNECTING -> TakeoverPhase.ENDED
        else -> TakeoverPhase.OTHER
    }
}

/**
 * onCallRemoved vedno ustavi zajem. markManual je owned ze pobrisal,
 * zato konec ne sme biti odvisen od tega, ali je klic se Linin.
 */
object CallLifecycle {
    fun stopCaptureOnRemoved(
        @Suppress("UNUSED_PARAMETER") ownedByLina: Boolean,
        @Suppress("UNUSED_PARAMETER") manual: Boolean,
    ): Boolean = true

    /** Stanje in podrobnosti gredo na streznik samo, dokler je klic najavljen. */
    fun publishWhileAnnounced(announced: Boolean): Boolean = announced

    /**
     * Konec se javi, ce je klic Linin ali samo najavljen.
     * Brez pogoja announced bi stevilka najavljenega klica ostala nejavljena
     * ali, obratno, bi se pogoj zbrisal in bi sel vsak klic.
     */
    fun emitRemoval(owned: Boolean, announced: Boolean): Boolean = owned || announced
}

/**
 * Zaslon klica. Ukaz velja za prikazani klic, ne vedno za prvega.
 * Gumb Prevzemi klic je viden samo, ko ima klic Lina.
 */
object CallScreen {
    fun displayedId(ids: List<String>, selectedId: String?): String? {
        if (ids.isEmpty()) return null
        if (selectedId != null && selectedId in ids) return selectedId
        return ids.first()
    }

    fun nextId(ids: List<String>, selectedId: String?): String? {
        val current = displayedId(ids, selectedId) ?: return null
        if (ids.size < 2) return current
        val at = ids.indexOf(current)
        return ids[(at + 1) % ids.size]
    }

    fun showTakeBack(ownedByLina: Boolean): Boolean = ownedByLina
}
