package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class Krog9AuditTest {

    @Test
    fun testStartLoop() {
        // Krog 12: CapturePermit.startLoop je odstranjen, ker je zanka poskusov zdaj v avtomatu (drugi poskus
        // je dogodek z generacijo, da ga preklic ustavi - N11-4). Istih pet primerov tece skozi pravi
        // izvajalec in avtomat; "sleep" je casovnik izvajalca, lastnistvo je dejstvo linije.
        fun started(sim: CaptureSim) = sim.calls.count { it == "start:${CaptureSim.X}" }
        fun fresh(): CaptureSim = CaptureSim().also {
            it.activate()
            it.runPrep()
        }

        // Pade po prvem, poskusi drugic
        val second = fresh()
        second.runOps(ok = false)
        // Krog 13: poleg casovnika drugega poskusa caka se rok starta (N12-6).
        val retries = second.timerLabels.filterIsInstance<CaptureMachine.Effect.ScheduleRetry>()
        assertEquals(1, retries.size)
        assertEquals(CaptureMachine.RETRY_DELAY_MS, retries.single().delayMs)
        second.fireTimer()
        second.runOps()
        assertEquals(CaptureMachine.Phase.CAPTURING, second.state.phase)
        assertEquals(2, started(second))
        assertTrue(second.timerLabels.isEmpty())

        // Ne poskusi, ce ni lastnik
        val notOwned = fresh()
        notOwned.xOwned = false
        notOwned.runOps()
        assertEquals(0, started(notOwned))
        assertFalse(notOwned.state.sessionWanted)

        // Ne poskusi drugic, ce izgubi lastnistvo vmes
        val lostBetween = fresh()
        lostBetween.runOps(ok = false)
        assertEquals(1, lostBetween.timerLabels.count { it is CaptureMachine.Effect.ScheduleRetry })
        lostBetween.userTakesX()
        lostBetween.fireTimer()
        assertTrue(lostBetween.settle())
        assertEquals(1, started(lostBetween))
        assertNull(lostBetween.session)

        // Ce po uspesnem startu izgubi lastnistvo, preden preveri, zajem ne ostane
        val lostAfter = fresh()
        lostAfter.runOps(true) { lostAfter.xOwned = false }
        assertEquals(1, started(lostAfter))
        assertFalse(lostAfter.state.sessionWanted)
        lostAfter.runOps()
        assertNull(lostAfter.session)

        // Tretjega poskusa ni
        val never = fresh()
        never.runOps(ok = false)
        never.fireTimer()
        never.runOps(ok = false)
        assertEquals(2, started(never))
        assertTrue(never.timerLabels.isEmpty())
        assertEquals(CaptureMachine.Phase.IDLE, never.state.phase)
        assertTrue(never.settle())
        assertEquals(2, started(never))
        assertTrue(never.gaveBack)
    }

    @Test
    fun `vrstni red giveBack in AudioDrop`() {
        val order = AudioDrop.giveBackOrder()
        assertEquals(AudioDrop.Step.MARK_MANUAL, order[0])
        assertEquals(AudioDrop.Step.EXIT_BACKGROUND_AUDIO, order[3])
    }

    @Test
    fun `spremenjen armSlot med pingom zavrzi`() {
        val view1 = CaptureOrder.Armed("klic", false)
        val view2 = CaptureOrder.Armed("drug", false)
        val result = LeaseRound.evaluate(view1, view2, pingOk = true, reported = null, misses = 0)
        assertFalse(result.plan.stop) // quiet
    }

    @Test
    fun `K16 occupied in stale pozabita vrata in ne uideta v USE`() {
        assertEquals(ShellProbe.Next.RESTART, ShellProbe.next(ShellHandshake.Probe.OCCUPIED))
        assertEquals(ShellProbe.Next.RESTART, ShellProbe.next(ShellHandshake.Probe.STALE))
        val seq = LaunchSteps.sequence(ShellHandshake.Probe.OCCUPIED, paired = true, detachedPort = null)
        assertTrue(seq.contains(LaunchSteps.Step.EXIT_AND_FORGET))
        assertFalse(seq.contains(LaunchSteps.Step.USE))
    }

    @Test
    fun `K04 startInFlight prepreci povecanje misses`() {
        val view = CaptureOrder.Armed("klic", startInFlight = true)
        val result = LeaseRound.evaluate(view, view, pingOk = false, reported = null, misses = 1)
        assertEquals(1, result.misses) // without check, it would be 2 and giveBackSilence = true
        assertFalse(result.giveBackSilence)
    }

    @Test
    fun `K07 uspešen ping ob startInFlight ponastavi stevec`() {
        val view = CaptureOrder.Armed("klic", startInFlight = true)
        val result = LeaseRound.evaluate(view, view, pingOk = true, reported = null, misses = 1)
        assertEquals(0, result.misses) // without check, it would not reset or reset differently
    }

    @Test
    fun `zeton samo ASCII v GatewayUrl`() {
        assertFalse(GatewayUrl.accept("wss://a.com/v1", "zetonč"))
        assertTrue(GatewayUrl.accept("wss://a.com/v1", "zeton"))
        assertFalse(GatewayUrl.accept("wss://a.com:99999/v1", "zeton"))
    }

    @Test
    fun `N6 BusyStreak action RETRY`() {
        assertEquals(BusyStreak.StepAction.RETRY, BusyStreak.action(0, ShellHandshake.Probe.BUSY).second)
    }

    @Test
    fun `N6 zaprta vrata Absent`() {
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val port = server.localPort
        server.close()
        val trip = ShellClientProtocol.roundTrip(port, "token", """{"op":"ping"}""", 300)
        assertEquals(ShellClientProtocol.RoundTrip.Absent, trip)
    }

    @Test
    fun `N6 klasifikacija izjem`() {
        assertEquals(ShellClientProtocol.RoundTrip.Absent, ShellClientProtocol.classify(java.net.ConnectException()))
        assertEquals(ShellClientProtocol.RoundTrip.Busy, ShellClientProtocol.classify(java.net.SocketTimeoutException()))
    }
}
