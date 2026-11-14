package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** Isti vrstni red, kot ga CallCommandController izvede pred Telecom klicem. */
class CallCommandControllerTest {
    @Test
    fun `rocna prekinitev Lininega klica ustavi zajem se preden owned izgine`() {
        val guard = LocalCallGuard()
        guard.announce("klic")
        assertTrue(guard.beginAnswer("klic"))
        assertFalse(guard.finishAnswer("klic", success = true))
        assertFalse(guard.isOwned("klic"))
        assertTrue(guard.confirmOwnedOnActive("klic"))
        assertTrue(guard.isOwned("klic"))
        assertTrue(CallCommandPolicy.claimsBeforeTelecom(CommandAction.HANGUP))
        val wasLina = guard.markManual("klic")
        assertTrue(wasLina)
        assertFalse(guard.isOwned("klic"))
        assertTrue(guard.isManual("klic"))
    }

    @Test
    fun `UNHOLD ob drugem klicu in zunanji dvig sta zavrnjena`() {
        val unhold = CallCommandPolicy.displacesUserCall(
            CommandAction.UNHOLD,
            targetIsUserCall = false,
            userOwnsOtherActiveCall = true,
        )
        assertFalse(unhold.allowed)
        assertEquals("would_hold_user_call", unhold.reason)
        for (action in listOf(CommandAction.ANSWER, CommandAction.HANGUP, CommandAction.REJECT)) {
            val blocked = CallCommandPolicy.blockedByExternalPickup(action, externalPickup = true)
            assertFalse(blocked.allowed, action.wireName)
            assertEquals("external_pickup", blocked.reason)
        }
        assertTrue(CallCommandPolicy.blockedByExternalPickup(CommandAction.DTMF, externalPickup = false).allowed)
    }

    @Test
    fun `owned sele po uspesnem answer in ne ob izjemi`() {
        val guard = LocalCallGuard()
        assertTrue(guard.beginAnswer("klic"))
        assertFalse(guard.isOwned("klic"))
        assertFalse(guard.finishAnswer("klic", success = false))
        assertFalse(guard.isOwned("klic"))
        assertFalse(guard.confirmOwnedOnActive("klic"))
        assertTrue(guard.beginAnswer("klic"))
        assertFalse(guard.finishAnswer("klic", success = true))
        assertFalse(guard.isOwned("klic"))
        assertTrue(guard.confirmOwnedOnActive("klic"))
        assertTrue(guard.isOwned("klic"))
    }

    @Test
    fun `zavrnjen ukaz ne poslje call failed`() {
        assertEquals("command.completed", CallCommandPolicy.commandResultEvent(false))
        assertNotEquals("call.failed", CallCommandPolicy.commandResultEvent(false))
        assertEquals("command.completed", CallCommandPolicy.commandResultEvent(true))
    }

    @Test
    fun `dtmf se ustavi ko klic preide uporabniku`() {
        val guard = LocalCallGuard()
        guard.announce("klic")
        assertTrue(guard.beginAnswer("klic"))
        assertFalse(guard.finishAnswer("klic", success = true))
        assertTrue(guard.confirmOwnedOnActive("klic"))
        val epoch = guard.dtmfToken()
        assertTrue(guard.dtmfStill(epoch))
        guard.markManual("klic")
        assertFalse(guard.dtmfStill(epoch))
        assertTrue(guard.isManual("klic"))
    }

    @Test
    fun `klic v DIALING in CONNECTING steje kot uporabnikov`() {
        assertEquals(TakeoverPhase.DIALING, TelecomPhase.phase(TelecomPhase.STATE_DIALING))
        assertEquals(TakeoverPhase.DIALING, TelecomPhase.phase(TelecomPhase.STATE_CONNECTING))
        assertTrue(CallCommandPolicy.countsAsOtherUserCall(false, TelecomPhase.phase(TelecomPhase.STATE_DIALING)))
        assertTrue(CallCommandPolicy.countsAsOtherUserCall(false, TelecomPhase.phase(TelecomPhase.STATE_CONNECTING)))
        assertFalse(CallCommandPolicy.countsAsOtherUserCall(true, TakeoverPhase.DIALING))
        assertFalse(CallCommandPolicy.countsAsOtherUserCall(false, TakeoverPhase.ENDED))
    }
}
