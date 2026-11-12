package com.httpgateway.protocol

/**
 * Obvestilo o zgresenem klicu (N13-5). Od Androida 13 (API 33) obvestila brez dovoljenja
 * POST_NOTIFICATIONS niso prikazana: zavrnjen klic bi bil viden samo v dnevniku Telecoma, uporabnik pa
 * ne bi izvedel, da ga je kdo klical. Odlocitev je tu, da jo preizkus zazene brez Androida.
 */
object NoticePermission {
    const val API_NOTIFICATION_PERMISSION = 33

    /** True: aplikacija mora dovoljenje za obvestila se zahtevati. */
    fun mustAsk(sdk: Int, granted: Boolean): Boolean = sdk >= API_NOTIFICATION_PERMISSION && !granted

    /**
     * N14-3: prosnja za dovoljenje samo, ko je potrebno: ob zgresenem klicu, ki ga ni bilo videti, ali ko je OpenLine
     * privzeti klicnik (obvestilo dohodnega klica z dvigni/zavrni potrebuje dovoljenje). Ne ob vsakem prvem zagonu.
     */
    fun shouldAsk(sdk: Int, granted: Boolean, unseenMissed: Int, isDefaultDialer: Boolean): Boolean =
        mustAsk(sdk, granted) && (unseenMissed > 0 || isDefaultDialer)

    /** True: obvestilo bo uporabnik res videl. Pod API 33 dovoljenja ni; izklop obvestil v nastavitvah velja povsod. */
    fun canShow(sdk: Int, granted: Boolean, notificationsEnabled: Boolean): Boolean =
        notificationsEnabled && !mustAsk(sdk, granted)

    /** Stevilo zgresenih klicev, ki jih uporabnik ni videl v obvestilu, a jih ob odprtju aplikacije pove. */
    fun nextUnseen(current: Int, shown: Boolean): Int = if (shown) current else (current + 1).coerceAtMost(99)
}
