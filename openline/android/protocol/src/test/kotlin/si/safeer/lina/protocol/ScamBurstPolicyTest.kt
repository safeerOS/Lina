package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import si.safeer.lina.protocol.ScamBurstPolicy.Verdict.ALLOW
import si.safeer.lina.protocol.ScamBurstPolicy.Verdict.BLOCK

class ScamBurstPolicyTest {
    @Test
    fun `tri razlicne stevilke v 10 s so val prevar, prvi dve se ne blokirata, tretja in vse pozneje da`() {
        val p = ScamBurstPolicy()
        assertEquals(ALLOW, p.onIncoming("+38670000001", 0, false))
        assertEquals(ALLOW, p.onIncoming("+38570000002", 3_000, false))
        assertEquals(BLOCK, p.onIncoming("+38640000003", 7_000, false))
        // Stevilke vala so zapomnjene: ob vrnitvi ob drugem casu jih blokiramo ze ob prvem klicu.
        assertEquals(BLOCK, p.onIncoming("+38670000001", 3_600_000, false))
        assertTrue(p.isBlocked("+386 70 000 001"))
    }

    @Test
    fun `dve stevilki ali pocasno zaporedje nista val`() {
        val p = ScamBurstPolicy()
        assertEquals(ALLOW, p.onIncoming("+38670000001", 0, false))
        assertEquals(ALLOW, p.onIncoming("+38570000002", 3_000, false))
        assertEquals(ALLOW, p.onIncoming("+38640000003", 60_000, false))
        assertFalse(p.isBlocked("+38640000003"))
    }

    @Test
    fun `ista stevilka ob ponovnem zvonenju ni val`() {
        val p = ScamBurstPolicy()
        repeat(5) { assertEquals(ALLOW, p.onIncoming("+38670000001", it * 1_000L, false)) }
    }

    @Test
    fun `stik, seznam dovoljenih in klic v sili se ne stejejo`() {
        val p = ScamBurstPolicy()
        repeat(6) { assertEquals(ALLOW, p.onIncoming("+3864000000$it", it * 1_000L, exempt = true)) }
        assertEquals(ALLOW, p.onIncoming("112", 7_000, false))
        assertEquals(ALLOW, p.onIncoming("", 8_000, false))
        assertTrue(p.blockedNumbers().isEmpty())
    }

    @Test
    fun `stik ne postane blokiran, ce je v prejsnjem valu enaka stevilka`() {
        val p = ScamBurstPolicy(initialBlocked = listOf("+38670000001"))
        assertEquals(ALLOW, p.onIncoming("+38670000001", 0, exempt = true))
    }

    @Test
    fun `spomin je omejen`() {
        val p = ScamBurstPolicy(maxRemembered = 4)
        var t = 0L
        repeat(10) { i ->
            p.onIncoming("+3867000${i}1", t, false); p.onIncoming("+3857000${i}2", t + 1, false)
            p.onIncoming("+3864000${i}3", t + 2, false); t += 100_000
        }
        assertEquals(4, p.blockedNumbers().size)
    }

    @Test
    fun `nepravilna stevilka se blokira takoj, pravilna ne`() {
        val p = ScamBurstPolicy()
        assertEquals(BLOCK, p.onMalformed("+3860701599", false))
        assertEquals(BLOCK, p.onMalformed("+386 70 159 9999", false))
        assertEquals(ALLOW, p.onMalformed("+386 70 159 999", false))
        assertEquals(ALLOW, p.onMalformed("+3860701599", exempt = true))
        assertEquals(ALLOW, p.onMalformed("112", false))
        assertTrue(p.isBlocked("+3860701599"))
    }

    @Test
    fun `wangiri - kratko zvonjenje tuje neznane stevilke se zapomni, slovenska in dolga ne`() {
        val p = ScamBurstPolicy()
        assertTrue(p.onUnansweredShortRing("+21612345678", 2_000, false))
        assertEquals(BLOCK, p.onIncoming("+21612345678", 1_000_000, false))
        assertFalse(p.onUnansweredShortRing("+38631000000", 2_000, false))
        assertFalse(p.onUnansweredShortRing("+4915112345678", 20_000, false))
        assertFalse(p.onUnansweredShortRing("+4915112345678", 2_000, exempt = true))
    }
}
