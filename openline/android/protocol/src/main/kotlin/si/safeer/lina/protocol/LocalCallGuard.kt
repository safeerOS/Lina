package si.safeer.lina.protocol

/**
 * Kdo ima klic: uporabnik ali Lina.
 * Lokalno dejanje (odgovori, zavrni, prekini) oznaci klic kot rocni takoj,
 * se preden se izvede Telecom. Oddaljeni ukaz za ta klic potem ne velja,
 * tudi ce je ANSWER ze bil sprozen.
 */
class LocalCallGuard {
    private val manual = mutableSetOf<String>()
    private val owned = mutableSetOf<String>()
    private val announced = mutableSetOf<String>()
    private val answering = mutableSetOf<String>()

    fun announce(callId: String) {
        if (callId in manual) return
        announced.add(callId)
    }

    private var dtmfEpoch = 0

    /** Uporabnik je prevzel klic. Vrne true, ce ga je prej imela Lina. */
    fun markManual(callId: String): Boolean {
        val wasLina = callId in owned || callId in announced
        manual.add(callId)
        announced.remove(callId)
        owned.remove(callId)
        answering.remove(callId)
        dtmfEpoch += 1
        return wasLina
    }

    fun dtmfToken(): Int = dtmfEpoch

    fun dtmfStill(token: Int): Boolean = token == dtmfEpoch

    fun isManual(callId: String): Boolean = callId in manual

    /** False, ce je klic ze rocni: oddaljeni ANSWER se ne sme zaceti. */
    fun beginAnswer(callId: String): Boolean {
        if (callId in manual) return false
        answering.add(callId)
        return true
    }

    /**
     * Answer() se je vrnil. Owned se tu se ne postavi: potrditev je sele,
     * ko je klic ACTIVE in beginAnswer se velja.
     */
    fun finishAnswer(callId: String, success: Boolean): Boolean {
        if (!success || callId in manual) answering.remove(callId)
        return false
    }

    /** Owned samo ob ACTIVE, ce answer se tece in ni bilo lokalnega dejanja. */
    fun confirmOwnedOnActive(callId: String): Boolean {
        if (callId in manual) return false
        if (callId !in answering) return false
        answering.remove(callId)
        owned.add(callId)
        announced.add(callId)
        return true
    }

    fun abandonOwn(callId: String) {
        owned.remove(callId)
        answering.remove(callId)
    }

    fun isOwned(callId: String): Boolean = callId in owned

    fun isAnnounced(callId: String): Boolean = callId in announced || callId in owned

    fun controllableIds(): Set<String> = announced + owned

    fun clear(callId: String) {
        manual.remove(callId)
        owned.remove(callId)
        announced.remove(callId)
        answering.remove(callId)
    }
}
