package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LocalCallGuardTest {
    @Test
    fun `lokalni odgovor zavrnitev in prekinitev oznacijo klic pred telecomom`() {
        for (action in listOf(CommandAction.ANSWER, CommandAction.REJECT, CommandAction.HANGUP)) {
            assertTrue(CallCommandPolicy.claimsBeforeTelecom(action), action.wireName)
        }
        assertFalse(CallCommandPolicy.claimsBeforeTelecom(CommandAction.HOLD))
        assertFalse(CallCommandPolicy.claimsBeforeTelecom(CommandAction.DTMF))

        val guard = LocalCallGuard()
        guard.announce("klic")
        assertTrue(guard.controllableIds().contains("klic"))

        // Uporabnik pritisne odgovori. Oznaka je pred answer(), zato oddaljeni ANSWER izgubi.
        guard.markManual("klic")
        assertTrue(guard.isManual("klic"))
        assertFalse(guard.beginAnswer("klic"))
        assertFalse(guard.finishAnswer("klic", success = true))
        assertFalse(guard.isOwned("klic"))
        assertFalse(guard.controllableIds().contains("klic"))

        for (action in listOf(
            CommandAction.ANSWER,
            CommandAction.HANGUP,
            CommandAction.HOLD,
            CommandAction.REJECT,
            CommandAction.UNHOLD,
        )) {
            val remote = CallCommandPolicy.displacesUserCall(
                action,
                targetIsUserCall = true,
                userOwnsOtherActiveCall = false,
            )
            assertFalse(remote.allowed, action.wireName)
            assertEquals("user_call", remote.reason)
        }
    }

    @Test
    fun `oznaka med answer v teku prepreci prevzem`() {
        val guard = LocalCallGuard()
        guard.announce("klic")
        assertTrue(guard.beginAnswer("klic"))
        guard.markManual("klic")
        assertFalse(guard.finishAnswer("klic", success = true))
        assertTrue(guard.isManual("klic"))
        assertFalse(guard.isOwned("klic"))
    }
}
