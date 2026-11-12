package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Krog 14: logika, izvlecena iz modula app (N13-2, N13-5). */
class Krog14AuditTest {
    private val x = "klic-x"
    private val w = "klic-w"
    private fun lina(state: Int) = LineCall(x, ownedByLina = true, androidState = state)
    private fun ringing(rejected: Boolean) =
        LineCall(w, ownedByLina = false, androidState = TelecomPhase.STATE_RINGING, rejectedBusy = rejected)

    @Test
    fun `N13-2 zvoneci klic ki ni zavrnjen zasede linijo zavrnjen je ne`() {
        val lina = lina(TelecomPhase.STATE_ACTIVE)
        assertTrue(CallLineFacts.blocksCapture(listOf(lina, ringing(rejected = false)), x))
        assertFalse(CallLineFacts.permitsCapture(listOf(lina, ringing(rejected = false)), x))
        assertFalse(CallLineFacts.blocksCapture(listOf(lina, ringing(rejected = true)), x))
        assertTrue(CallLineFacts.permitsCapture(listOf(lina, ringing(rejected = true)), x))
        // Oznaka velja samo za zvonjenje: zavrnjen klic, ki je kljub temu postal aktiven, linijo zaseda.
        for (state in listOf(TelecomPhase.STATE_ACTIVE, TelecomPhase.STATE_HOLDING, TelecomPhase.STATE_DIALING)) {
            val call = LineCall(w, false, state, rejectedBusy = true)
            assertTrue(CallLineFacts.blocksCapture(listOf(lina, call), x), "$state")
        }
        // Linin drug klic in sam klic ne zasedeta linije.
        assertFalse(CallLineFacts.blocksCapture(listOf(lina, LineCall(w, true, TelecomPhase.STATE_RINGING)), x))
        assertFalse(CallLineFacts.blocksCapture(listOf(lina), x))
    }

    @Test
    fun `N13-2 zvonenje klica v sili po zavrnitvi ostane na liniji`() {
        // Klica v sili storitev ne zavrne (rejectedBusy = false): zasebnost pred tisino.
        val emergency = SecondCallPolicy.rejectAsBusy(ringing(false), incoming = true, emergency = true, calls = listOf(lina(TelecomPhase.STATE_ACTIVE), ringing(false)))
        assertFalse(emergency)
        assertTrue(CallLineFacts.blocksCapture(listOf(lina(TelecomPhase.STATE_ACTIVE), ringing(rejected = false)), x))
    }

    @Test
    fun `N13-5 brez dovoljenja za obvestila na API 33 in vec ga je treba zahtevati`() {
        assertTrue(NoticePermission.mustAsk(sdk = 33, granted = false))
        assertTrue(NoticePermission.mustAsk(sdk = 36, granted = false))
        assertFalse(NoticePermission.mustAsk(sdk = 33, granted = true))
        assertFalse(NoticePermission.mustAsk(sdk = 32, granted = false))
        assertFalse(NoticePermission.mustAsk(sdk = 29, granted = false))
    }

    @Test
    fun `N13-5 obvestilo je vidno samo z dovoljenjem in vklopljenimi obvestili`() {
        assertTrue(NoticePermission.canShow(sdk = 34, granted = true, notificationsEnabled = true))
        assertFalse(NoticePermission.canShow(sdk = 34, granted = false, notificationsEnabled = true))
        assertFalse(NoticePermission.canShow(sdk = 34, granted = true, notificationsEnabled = false))
        assertTrue(NoticePermission.canShow(sdk = 30, granted = false, notificationsEnabled = true))
        assertFalse(NoticePermission.canShow(sdk = 30, granted = false, notificationsEnabled = false))
    }

    @Test
    fun `N13-5 nevidni zgreseni klici se stejejo do meje in vidni stevca ne povecajo`() {
        assertEquals(1, NoticePermission.nextUnseen(0, shown = false))
        assertEquals(5, NoticePermission.nextUnseen(4, shown = false))
        assertEquals(4, NoticePermission.nextUnseen(4, shown = true))
        assertEquals(99, NoticePermission.nextUnseen(99, shown = false))
    }

    // ---- Pregled 14 (N14-1, N14-3, N14-4) ---------------------------------------------------

    private fun alert(
        phase: TakeoverPhase = TakeoverPhase.RINGING,
        direction: TakeoverDirection = TakeoverDirection.INCOMING,
        busyRejected: Boolean = false,
        owned: Boolean = false,
        manual: Boolean = false,
        uiVisible: Boolean = false,
    ) = IncomingCallAlert.decide(phase, direction, busyRejected, owned, manual, uiVisible)

    @Test
    fun `N14-4 obvestilo dohodnega klica se pokaze samo za zvoneci dohodni klic ki ga uporabnik lahko dvigne`() {
        assertEquals(IncomingCallAlert.Action.SHOW, alert())
        // Odhodni, aktivni, koncani, drugo.
        assertEquals(IncomingCallAlert.Action.CANCEL, alert(direction = TakeoverDirection.OUTGOING))
        assertEquals(IncomingCallAlert.Action.CANCEL, alert(direction = TakeoverDirection.UNKNOWN))
        for (phase in listOf(TakeoverPhase.ACTIVE, TakeoverPhase.DIALING, TakeoverPhase.ENDED, TakeoverPhase.OTHER)) {
            assertEquals(IncomingCallAlert.Action.CANCEL, alert(phase = phase), "$phase")
        }
        // Zaseden znak, Linin klic, rocno obdelan klic in odprt vmesnik obvestila ne rabijo.
        assertEquals(IncomingCallAlert.Action.CANCEL, alert(busyRejected = true))
        assertEquals(IncomingCallAlert.Action.CANCEL, alert(owned = true))
        assertEquals(IncomingCallAlert.Action.CANCEL, alert(manual = true))
        assertEquals(IncomingCallAlert.Action.CANCEL, alert(uiVisible = true))
    }

    @Test
    fun `N14-4 manifest ima USE_FULL_SCREEN_INTENT in obvestilo dohodnega klica je celozaslonsko z dejanjema`() {
        val manifest = java.io.File("../app/src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.USE_FULL_SCREEN_INTENT"))
        assertTrue(manifest.contains(".telecom.IncomingCallActionReceiver"))
        val notice = java.io.File("../app/src/main/kotlin/com/httpgateway/dialer/telecom/IncomingCallNotice.kt").readText()
        assertTrue(notice.contains("setFullScreenIntent("))
        assertTrue(notice.contains("CATEGORY_CALL"))
        assertTrue(notice.contains("IMPORTANCE_HIGH"))
        assertEquals(2, Regex("addAction\\(").findAll(notice).count(), "dvigni in zavrni")
        // Storitev klice odlocitev iz protocol in obvestilo umika ob koncu klica.
        val service = java.io.File("../app/src/main/kotlin/com/httpgateway/dialer/telecom/GatewayInCallService.kt").readText()
        assertTrue(service.contains("IncomingCallAlert.decide("))
        assertTrue(service.contains("IncomingCallNotice.cancel(this, callId)"))
    }

    @Test
    fun `N14-1 obvestilo o zgresenem klicu ne kaze stevilke na zaklenjenem zaslonu`() {
        val notice = java.io.File("../app/src/main/kotlin/com/httpgateway/dialer/telecom/MissedCallNotice.kt").readText()
        assertTrue(notice.contains(".setVisibility(Notification.VISIBILITY_PRIVATE)"))
        assertTrue(notice.contains("lockscreenVisibility = Notification.VISIBILITY_PRIVATE"))
        // Javna razlicica obstaja in ne vsebuje stevilke (besedilo z `who` je samo v polni razlicici).
        val publicPart = notice.substringAfter(".setPublicVersion(").substringBefore(".build(),")
        assertTrue(publicPart.contains("missed_title"))
        assertFalse(publicPart.contains("who"))
        assertFalse(publicPart.contains("missed_while_lina"))
    }

    @Test
    fun `N14-3 dovoljenje za obvestila se zahteva samo ob zgresenem klicu ali kot privzeti klicnik`() {
        assertFalse(NoticePermission.shouldAsk(sdk = 34, granted = false, unseenMissed = 0, isDefaultDialer = false))
        assertTrue(NoticePermission.shouldAsk(sdk = 34, granted = false, unseenMissed = 1, isDefaultDialer = false))
        assertTrue(NoticePermission.shouldAsk(sdk = 34, granted = false, unseenMissed = 0, isDefaultDialer = true))
        assertFalse(NoticePermission.shouldAsk(sdk = 34, granted = true, unseenMissed = 3, isDefaultDialer = true))
        assertFalse(NoticePermission.shouldAsk(sdk = 32, granted = false, unseenMissed = 3, isDefaultDialer = true))
    }
}
