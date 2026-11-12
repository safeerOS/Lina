package com.httpgateway.protocol

/**
 * N14-4: obvestilo dohodnega klica s celozaslonskim namenom (standardna resitev za InCallService).
 *
 * Zakaj: vmesnik dohodnega klica nastane samo s startActivity iz storitve. Android od 10 (BAL) zagon iz ozadja
 * pri zaklenjenem zaslonu lahko tiho zavrne in telefon bi zvonil, dvigniti pa se ne bi dalo. Obvestilo s
 * fullScreenIntent in dejanjema dvigni/zavrni je pot, ki jo sistem za klicalnike sprejme vedno.
 *
 * Odlocitev je tu (cista funkcija), da jo preizkus zazene brez Androida.
 * Stevilka: obvestilo dohodnega klica jo kaze tudi na zaklenjenem zaslonu, kot vsak privzeti klicnik
 * (uporabnik se mora odloci, ali dvigne); vmesnik InCallActivity jo kaze na zaklenjenem zaslonu tako ali tako.
 * Zgresen klic (MissedCallNotice) jo na zaklenjenem zaslonu skrije (N14-1).
 */
object IncomingCallAlert {
    enum class Action { SHOW, CANCEL }

    fun decide(
        phase: TakeoverPhase,
        direction: TakeoverDirection,
        busyRejected: Boolean,
        ownedByLina: Boolean,
        manual: Boolean,
        uiVisible: Boolean,
    ): Action {
        val ringsForUser = phase == TakeoverPhase.RINGING && direction == TakeoverDirection.INCOMING
        // Zavrnjen z zasedenim znakom, Linin ali ze rocno obdelan klic uporabniku ne zvoni; odprt vmesnik obvestila ne rabi.
        val show = ringsForUser && !busyRejected && !ownedByLina && !manual && !uiVisible
        return if (show) Action.SHOW else Action.CANCEL
    }
}
