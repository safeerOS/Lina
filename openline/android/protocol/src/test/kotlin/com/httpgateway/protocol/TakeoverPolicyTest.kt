package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TakeoverPolicyTest {
    private val list = listOf("+99955501999")

    @Test
    fun `neodgovorjen dohodni klic po casu in na seznamu se prevzame`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(ringingForMs = 20_000, allowlist = list),
        )
        assertEquals(TakeoverVerdict.TAKE, verdict)
    }

    @Test
    fun `pred potekom casa se se caka`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(ringingForMs = 19_999, allowlist = list),
        )
        assertEquals(TakeoverVerdict.WAIT, verdict)
    }

    @Test
    fun `odhodni klic se ne prevzame`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(direction = TakeoverDirection.OUTGOING, phase = TakeoverPhase.OTHER, allowlist = list),
        )
        assertEquals(TakeoverVerdict.REFUSE, verdict)
    }

    @Test
    fun `rocno sprejet klic se ne prevzame`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(manuallyAnswered = true, phase = TakeoverPhase.ACTIVE, ringingForMs = 30_000, allowlist = list),
        )
        assertEquals(TakeoverVerdict.REFUSE, verdict)
    }

    @Test
    fun `stevilka ni na seznamu`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(number = "+99955501000", ringingForMs = 30_000, allowlist = list),
        )
        assertEquals(TakeoverVerdict.REFUSE, verdict)
    }

    @Test
    fun `prazen seznam ne dovoli nobene`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(ringingForMs = 30_000, allowlist = emptyList()),
        )
        assertEquals(TakeoverVerdict.REFUSE, verdict)
        assertFalse(TakeoverPolicy.onAllowlist("+99955501999", emptyList()))
    }

    @Test
    fun `klic v sili 112 se ne prevzame tudi ce je na seznamu`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(number = "112", ringingForMs = 30_000, allowlist = listOf("112", "+99955501999")),
        )
        assertEquals(TakeoverVerdict.REFUSE, verdict)
        assertTrue(TakeoverPolicy.isEmergency("112"))
        assertFalse(TakeoverPolicy.isEmergency("+911111111111"))
    }

    @Test
    fun `lokalni in mednarodni zapis se ujemata`() {
        assertTrue(TakeoverPolicy.onAllowlist("055501999", listOf("+99955501999")))
    }

    @Test
    fun `cakajoci klic ne da uporabnikovega na cakanje`() {
        val verdict = TakeoverPolicy.evaluate(
            facts(ringingForMs = 30_000, allowlist = list, userCallActive = true),
        )
        assertEquals(TakeoverVerdict.REFUSE, verdict)
        val swap = CallCommandPolicy.displacesUserCall(
            CommandAction.ANSWER,
            targetIsUserCall = false,
            userOwnsOtherActiveCall = true,
        )
        assertFalse(swap.allowed)
        assertEquals("would_hold_user_call", swap.reason)
        assertTrue(
            CallCommandPolicy.isUserControlled(
                ownedByLina = false,
                manuallyAnswered = true,
                outgoing = false,
                phase = TakeoverPhase.ACTIVE,
                announced = false,
            ),
        )
        assertTrue(
            CallCommandPolicy.isUserControlled(
                ownedByLina = false,
                manuallyAnswered = false,
                outgoing = true,
                phase = TakeoverPhase.ACTIVE,
                announced = false,
            ),
        )
        assertFalse(
            CallCommandPolicy.isUserControlled(
                ownedByLina = true,
                manuallyAnswered = false,
                outgoing = false,
                phase = TakeoverPhase.ACTIVE,
                announced = true,
            ),
        )
        assertFalse(
            CallCommandPolicy.isUserControlled(
                ownedByLina = false,
                manuallyAnswered = false,
                outgoing = false,
                phase = TakeoverPhase.RINGING,
                announced = true,
            ),
        )
    }

    private fun facts(
        direction: TakeoverDirection = TakeoverDirection.INCOMING,
        phase: TakeoverPhase = TakeoverPhase.RINGING,
        manuallyAnswered: Boolean = false,
        ringingForMs: Long = 0,
        number: String = "+99955501999",
        allowlist: Collection<String> = list,
        userCallActive: Boolean = false,
    ) = TakeoverFacts(
        direction = direction,
        phase = phase,
        manuallyAnswered = manuallyAnswered,
        ringingForMs = ringingForMs,
        ringTimeoutMs = 20_000,
        number = number,
        allowlist = allowlist,
        userCallActive = userCallActive,
        lineAllowed = true,
    )
}
