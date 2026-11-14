package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pregled 16: N1 (izbira linije velja pri prevzemu), N3 (brez preusmeritev), N4 (izbirnik brez dovoljenja). */
class Krog17LinijaTest {
    private val a = Line("linija-a", "SIM 1", isEsim = false, active = true)
    private val b = Line("linija-b", "eSIM", isEsim = true, active = true)
    private val bOff = b.copy(active = false)

    @Test
    fun `N1 Lina prevzame samo na izbrani ali edini liniji`() {
        assertTrue(LineGate.allows(listOf(a, b), "linija-a", "linija-a"))
        assertFalse(LineGate.allows(listOf(a, b), "linija-a", "linija-b"), "klic na drugi liniji ostane na telefonu")
        assertFalse(LineGate.allows(listOf(a, b), null, "linija-a"), "vec linij brez izbire")
        assertTrue(LineGate.allows(listOf(a, bOff), null, "linija-a"), "edina aktivna linija")
        assertFalse(LineGate.allows(listOf(a, bOff), null, "linija-b"))
        assertFalse(LineGate.allows(listOf(a.copy(active = false), b), "linija-a", "linija-b"), "izbrana neaktivna: ne druga")
        assertFalse(LineGate.allows(emptyList(), null, "linija-a"), "brez dovoljenja ali brez linij")
        assertFalse(LineGate.allows(listOf(a, a), "linija-a", "linija-a"), "neveljaven seznam")
        assertFalse(LineGate.allows(listOf(a), "linija-a", null), "klic brez racuna")
        assertFalse(LineGate.allows(listOf(a), "linija-a", ""))
    }

    @Test
    fun `N1 prevzem zavrnjen, ce linija ni dovoljena, tudi ko je vse drugo za prevzem`() {
        val take = TakeoverFacts(
            direction = TakeoverDirection.INCOMING,
            phase = TakeoverPhase.RINGING,
            manuallyAnswered = false,
            ringingForMs = 30_000,
            ringTimeoutMs = 20_000,
            number = "+99955501001",
            allowlist = listOf("+99955501001"),
            lineAllowed = true,
        )
        assertEquals(TakeoverVerdict.TAKE, TakeoverPolicy.evaluate(take))
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(take.copy(lineAllowed = false)))
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(take.copy(lineAllowed = false, ringingForMs = 0)), "ne WAIT")
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.evaluate(take.copy(lineAllowed = false, allowlistEnabled = false)))
    }

    @Test
    fun `N4 izbirnik brez dovoljenja ne pokaze linij`() {
        val v = LinePicker.view(permission = false, lines = listOf(a), saved = null)
        assertEquals(LineStatus.NO_PERMISSION, v.status)
        assertTrue(v.choices.isEmpty())
    }

    @Test
    fun `izbirnik linije pokaze stanje in samo aktivne linije`() {
        LinePicker.view(true, listOf(a, b), "linija-b").let {
            assertEquals(LineStatus.USING, it.status)
            assertEquals("eSIM", it.usingLabel)
            assertEquals(1, it.selectedIndex)
        }
        LinePicker.view(true, listOf(a, b), null).let {
            assertEquals(LineStatus.AMBIGUOUS, it.status)
            assertEquals(-1, it.selectedIndex)
            assertEquals(2, it.choices.size)
        }
        LinePicker.view(true, listOf(a, bOff), "linija-b").let {
            assertEquals(LineStatus.SAVED_UNAVAILABLE, it.status)
            assertEquals(listOf(a), it.choices)
        }
        LinePicker.view(true, listOf(a, bOff), null).let {
            assertEquals(LineStatus.USING, it.status)
            assertEquals(0, it.selectedIndex)
        }
        assertEquals(LineStatus.NONE, LinePicker.view(true, emptyList(), null).status)
        assertEquals(LineStatus.INVALID, LinePicker.view(true, listOf(a, a), null).status)
        assertNull(LinePicker.view(true, listOf(a, b), null).usingLabel)
    }

    @Test
    fun `N3 odjemalec s pripetim odtisom ne sledi preusmeritvam`() {
        val c = PinnedHttp.client("ab".repeat(32))
        assertFalse(c.followRedirects, "zeton bi sel na drug naslov")
        assertFalse(c.followSslRedirects)
        c.dispatcher.executorService.shutdown()
    }

    // Krog 17c: WP28 S brez SIM je ponudil in izbral »Klici v sili« (14. 11. 2026).
    private fun racun(id: String, label: String, emergencyOnly: Boolean = false, subId: Int? = 1, active: Boolean = true, sim: Boolean = true) =
        PhoneAccountFacts(id, label, simSubscription = sim, emergencyCallsOnly = emergencyOnly, subscriptionId = subId,
            activeSubscription = active, isEsim = false, enabled = true)

    @Test
    fun `racun samo za klice v sili ni linija`() {
        // Kot WP28 S brez kartice: en SIM racun brez narocnine, samo klici v sili.
        val sos = racun("sos", "Klici v sili", emergencyOnly = true, subId = -1, active = false)
        assertTrue(LineAccounts.lines(listOf(sos)).isEmpty())
        assertEquals(LineStatus.NONE, LinePicker.view(true, LineAccounts.lines(listOf(sos)), null).status)
        // Vsak znak posebej zadostuje za izlocitev.
        assertTrue(LineAccounts.lines(listOf(racun("a", "SIM 1", emergencyOnly = true))).isEmpty())
        assertTrue(LineAccounts.lines(listOf(racun("a", "SIM 1", subId = -1))).isEmpty())
        assertTrue(LineAccounts.lines(listOf(racun("a", "SIM 1", active = false))).isEmpty())
        assertTrue(LineAccounts.lines(listOf(racun("a", "SIP", sim = false))).isEmpty())
        // Prava linija ostane, racun za klice v sili ne.
        val lines = LineAccounts.lines(listOf(racun("a", "SIM 1"), sos))
        assertEquals(listOf("a"), lines.map { it.id })
        // Android 10: subscriptionId ni znan - velja aktivna narocnina.
        assertEquals(1, LineAccounts.lines(listOf(racun("a", "SIM 1", subId = null))).size)
    }

    @Test
    fun `LineGate klica na racunu za klice v sili nikoli ne dovoli`() {
        val sos = racun("sos", "Klici v sili", emergencyOnly = true, subId = -1, active = false)
        for (saved in listOf(null, "sos", "a")) {
            assertFalse(LineGate.allows(LineAccounts.lines(listOf(sos)), saved, "sos"), "saved=$saved")
            assertFalse(LineGate.allows(LineAccounts.lines(listOf(racun("a", "SIM 1"), sos)), saved, "sos"), "saved=$saved")
        }
        assertTrue(LineGate.allows(LineAccounts.lines(listOf(racun("a", "SIM 1"), sos)), null, "a"))
    }
}
