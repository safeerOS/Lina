package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Pogodba GatewayInCallService: prevzem, drugi klic, konec zajema, izbira klica. */
class GatewayInCallServiceTest {
    private val list = listOf("+99955501999")

    @Test
    fun `onCallRemoved ustavi zajem tudi ko owned ni vec`() {
        assertTrue(CallLifecycle.stopCaptureOnRemoved(ownedByLina = false, manual = true))
        assertTrue(CallLifecycle.stopCaptureOnRemoved(ownedByLina = false, manual = false))
        assertTrue(CallLifecycle.stopCaptureOnRemoved(ownedByLina = true, manual = false))
    }

    @Test
    fun `START zajema samo ce ni drugega zivega klica`() {
        assertEquals(
            CallAudioAction.STOP,
            CallAudioPolicy.action(ownedByLina = true, AudioCallState.ACTIVE, otherLiveNotLina = true),
        )
        assertEquals(
            CallAudioAction.START,
            CallAudioPolicy.action(ownedByLina = true, AudioCallState.ACTIVE, otherLiveNotLina = false),
        )
        assertTrue(CallCommandPolicy.countsAsOtherUserCall(false, TakeoverPhase.DIALING))
        assertTrue(CallCommandPolicy.countsAsOtherUserCall(false, TelecomPhase.phase(TelecomPhase.STATE_CONNECTING)))
    }

    @Test
    fun `skrita stevilka ob izklopljenem seznamu se prevzame`() {
        val hidden = TakeoverPolicy.evaluate(ready(number = "", allowlistEnabled = false, allowlist = emptyList()))
        val unknown = TakeoverPolicy.evaluate(ready(number = "unknown", allowlistEnabled = false, allowlist = emptyList()))
        assertEquals(TakeoverVerdict.TAKE, hidden)
        assertEquals(TakeoverVerdict.TAKE, unknown)
        assertTrue(TakeoverPolicy.mayTakeOver("", emptyList(), allowlistEnabled = false))
        assertTrue(TakeoverPolicy.mayTakeOver("unknown", emptyList(), allowlistEnabled = false))
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(ready(number = "", allowlistEnabled = true, allowlist = emptyList())))
    }

    @Test
    fun `112 in povratni klic v sili se nikoli ne prevzameta`() {
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(ready(number = "112", allowlistEnabled = false)))
        assertEquals(
            TakeoverVerdict.REFUSE,
            TakeoverPolicy.evaluate(ready(number = "+99955501999", allowlistEnabled = false, emergencyCallback = true)),
        )
        assertEquals(
            TakeoverVerdict.REFUSE,
            TakeoverPolicy.evaluate(ready(allowlistEnabled = false, emergencyCooldown = true)),
        )
        assertFalse(TakeoverPolicy.mayTakeOver("112", listOf("112"), allowlistEnabled = false))
        assertFalse(TakeoverPolicy.mayTakeOver("112", list, allowlistEnabled = true))
    }

    @Test
    fun `zunanji dvig in uporabnikov drug klic ostaneta pred stikalom`() {
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(ready(allowlistEnabled = false, externalPickup = true)))
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(ready(allowlistEnabled = false, userCallActive = true)))
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(ready(allowlistEnabled = false, manuallyAnswered = true, phase = TakeoverPhase.ACTIVE)))
        assertEquals(
            TakeoverVerdict.REFUSE,
            TakeoverPolicy.evaluate(ready(allowlistEnabled = false, direction = TakeoverDirection.OUTGOING, phase = TakeoverPhase.DIALING)),
        )
    }

    @Test
    fun `ukaz velja za prikazani klic ne za prvega`() {
        val ids = listOf("prvi", "drugi")
        assertEquals("drugi", CallScreen.displayedId(ids, "drugi"))
        assertEquals("prvi", CallScreen.displayedId(ids, "ni-vec"))
        assertEquals("drugi", CallScreen.nextId(ids, "prvi"))
        assertEquals("prvi", CallScreen.nextId(ids, "drugi"))
        assertTrue(CallScreen.showTakeBack(ownedByLina = true))
        assertFalse(CallScreen.showTakeBack(ownedByLina = false))
    }

    private fun ready(
        number: String = "+99955501999",
        allowlistEnabled: Boolean = true,
        allowlist: Collection<String> = list,
        emergencyCallback: Boolean = false,
        emergencyCooldown: Boolean = false,
        externalPickup: Boolean = false,
        userCallActive: Boolean = false,
        manuallyAnswered: Boolean = false,
        direction: TakeoverDirection = TakeoverDirection.INCOMING,
        phase: TakeoverPhase = TakeoverPhase.RINGING,
    ) = TakeoverFacts(
        direction = direction,
        phase = phase,
        manuallyAnswered = manuallyAnswered,
        ringingForMs = 30_000,
        ringTimeoutMs = 20_000,
        number = number,
        allowlist = allowlist,
        allowlistEnabled = allowlistEnabled,
        userCallActive = userCallActive,
        emergencyCallback = emergencyCallback,
        emergencyCooldown = emergencyCooldown,
        externalPickup = externalPickup,
        lineAllowed = true,
    )
}
