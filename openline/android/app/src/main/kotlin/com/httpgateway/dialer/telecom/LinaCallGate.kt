package com.httpgateway.dialer.telecom

import com.httpgateway.protocol.LocalCallGuard

/**
 * Katere klice je Lina prevzela.
 * Odlocitev je v [LocalCallGuard]: lokalno dejanje oznaci klic kot rocni takoj,
 * se preden se izvede Telecom. Oddaljeni ANSWER potem ne more prevzeti klica,
 * tudi ce je ze bil sprozen. Owned je sele po uspesnem answer in samo ce
 * uporabnik medtem ni prevzel klica.
 */
object LinaCallGate {
    private val guard = LocalCallGuard()
    private var ownedListener: ((String) -> Unit)? = null
    private var manualListener: ((String) -> Unit)? = null

    @Synchronized
    fun setOwnedListener(listener: ((String) -> Unit)?) {
        ownedListener = listener
    }

    @Synchronized
    fun setManualListener(listener: ((String) -> Unit)?) {
        manualListener = listener
    }

    @Synchronized
    fun announce(callId: String) {
        guard.announce(callId)
    }

    /** False, ce je klic ze rocni: oddaljeni ANSWER se ne sme zaceti. */
    @Synchronized
    fun beginAnswer(callId: String): Boolean = guard.beginAnswer(callId)

    /**
     * Owned sele po uspehu in samo ce uporabnik medtem ni prevzel klica.
     * Vrne true, ko Lina klic res dobi. Poslusalec se sprozi samo takrat.
     */
    @Synchronized
    fun finishAnswer(callId: String, success: Boolean): Boolean {
        val took = guard.finishAnswer(callId, success)
        if (took) ownedListener?.invoke(callId)
        return took
    }

    /** Owned samo ob ACTIVE, ce beginAnswer se velja in ni bilo lokalnega dejanja. */
    @Synchronized
    fun confirmOwnedOnActive(callId: String): Boolean {
        val took = guard.confirmOwnedOnActive(callId)
        if (took) ownedListener?.invoke(callId)
        return took
    }

    /** ANSWER ni uspel: klic ostane najavljen, a zvoka se ne preusmeri. */
    @Synchronized
    fun abandonOwn(callId: String) {
        guard.abandonOwn(callId)
    }

    /** Uporabnik je prevzel klic. Velja tudi, ce je oddaljeni ANSWER ze v teku. */
    /** Vrne true, ce je klic prej imela Lina (owned ali najavljen). */
    @Synchronized
    fun markManual(callId: String): Boolean {
        val was = guard.markManual(callId)
        manualListener?.invoke(callId)
        return was
    }

    @Synchronized
    fun dtmfToken(): Int = guard.dtmfToken()

    @Synchronized
    fun dtmfStill(token: Int): Boolean = guard.dtmfStill(token)

    @Synchronized
    fun isManual(callId: String): Boolean = guard.isManual(callId)

    @Synchronized
    fun isOwned(callId: String): Boolean = guard.isOwned(callId)

    @Synchronized
    fun isAnnounced(callId: String): Boolean = guard.isAnnounced(callId)

    @Synchronized
    fun controllableIds(): Set<String> = guard.controllableIds()

    @Synchronized
    fun clear(callId: String) {
        guard.clear(callId)
    }
}
