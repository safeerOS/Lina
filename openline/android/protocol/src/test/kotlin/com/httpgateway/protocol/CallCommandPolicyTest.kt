package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Isti pogoj, kot ga CallCommandController.execute uporabi pred Telecom klicem. */
class CallCommandPolicyTest {
    private val taken = setOf("call-lina")

    @Test
    fun `DIAL je vedno izklopljen`() {
        val owned = CallCommandPolicy.decide(CommandAction.DIAL, "call-lina", taken)
        val other = CallCommandPolicy.decide(CommandAction.DIAL, "call-drug", taken)
        assertFalse(owned.allowed)
        assertEquals("dial_disabled", owned.reason)
        assertFalse(other.allowed)
        assertEquals("dial_disabled", other.reason)
    }

    @Test
    fun `ANSWER HANGUP HOLD in DTMF samo za prevzeti klic`() {
        for (action in listOf(CommandAction.ANSWER, CommandAction.HANGUP, CommandAction.HOLD, CommandAction.DTMF)) {
            val yes = CallCommandPolicy.decide(action, "call-lina", taken)
            val no = CallCommandPolicy.decide(action, "call-drug", taken)
            assertTrue(yes.allowed, action.wireName)
            assertFalse(no.allowed, action.wireName)
            assertEquals("call_not_taken_over", no.reason)
        }
    }

    @Test
    fun `prazen seznam prevzetih ne dovoli nobenega ukaza`() {
        val decision = CallCommandPolicy.decide(CommandAction.ANSWER, "call-lina", emptySet())
        assertFalse(decision.allowed)
    }

    @Test
    fun `rocno sprejet klic in zakasnel ANSWER je zavrnjen`() {
        val manual = CallCommandPolicy.allowRemoteAnswer(TakeoverPhase.ACTIVE, manuallyAnswered = true)
        assertFalse(manual.allowed)
        assertEquals("call_answered_manually", manual.reason)

        val alreadyUp = CallCommandPolicy.allowRemoteAnswer(TakeoverPhase.ACTIVE, manuallyAnswered = false)
        assertFalse(alreadyUp.allowed)
        assertEquals("call_not_ringing", alreadyUp.reason)

        val ringing = CallCommandPolicy.allowRemoteAnswer(TakeoverPhase.RINGING, manuallyAnswered = false)
        assertTrue(ringing.allowed)
    }
}
