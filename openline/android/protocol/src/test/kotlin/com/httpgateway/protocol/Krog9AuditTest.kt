package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class Krog9AuditTest {

    @Test
    fun testStartLoop() {
        var startCount = 0
        var isOwned = true
        
        // Pade po prvem, poskusi drugič
        val success2 = CapturePermit.startLoop("call1", { isOwned }) {
            startCount++
            startCount == 2
        }
        assertTrue(success2)
        assertEquals(2, startCount)
        
        // Ne poskusi če ni lastnik
        startCount = 0
        isOwned = false
        val success3 = CapturePermit.startLoop("call1", { isOwned }) {
            startCount++
            true
        }
        assertFalse(success3)
        assertEquals(0, startCount)

        // Ne poskusi drugič, če izgubi lastništvo vmes
        startCount = 0
        isOwned = true
        val success4 = CapturePermit.startLoop("call1", { isOwned }) {
            startCount++
            isOwned = false
            false
        }
        assertFalse(success4)
        assertEquals(1, startCount)
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
