package com.httpgateway.protocol

/**
 * Ponovni zagon zajema in vticnice.
 * Po omejenem stevilu poskusov se stanje pocisti. Zanke ni.
 */
object AudioWatchdog {
    const val MAX_ATTEMPTS = 3

    enum class Action { RETRY, STOP }

    /** attempt je 1 ob prvi napaki. Ob MAX_ATTEMPTS in cez je STOP (pocisti, ne zaganjaj znova). */
    fun afterFailure(attempt: Int, maxAttempts: Int = MAX_ATTEMPTS): Action =
        if (attempt in 1 until maxAttempts) Action.RETRY else Action.STOP

    fun releasesSession(action: Action): Boolean = action == Action.STOP
}
