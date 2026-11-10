package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

class Krog11AuditTest {

    @Test
    fun testN10_1_evaluateStart() {
        val after = CaptureOrder.Armed("call1", false)
        val decisionDiff = CaptureOrder.evaluateStart(1, 2, after)
        assertFalse(decisionDiff.writeArm)
        assertTrue(decisionDiff.immediateStop)

        val decisionSame = CaptureOrder.evaluateStart(1, 1, after)
        assertTrue(decisionSame.writeArm)
        assertFalse(decisionSame.immediateStop)
    }

    @Test
    fun testN10_2_shouldDisconnect() {
        val keepActive = AudioDrop.shouldDisconnect(4, false)
        assertEquals(AudioDrop.DisconnectDecision.KEEP, keepActive)

        val disconnectProc = AudioDrop.shouldDisconnect(12, false)
        assertEquals(AudioDrop.DisconnectDecision.DISCONNECT, disconnectProc)

        val keepProcOk = AudioDrop.shouldDisconnect(12, true)
        assertEquals(AudioDrop.DisconnectDecision.KEEP, keepProcOk)
    }

    @Test
    fun testN5_deviceId() {
        assertEquals(GatewayDeviceId.Problem.EMPTY, GatewayDeviceId.check(""))
        assertEquals(GatewayDeviceId.Problem.EMPTY, GatewayDeviceId.check("   "))
        assertEquals(GatewayDeviceId.Problem.NOT_ASCII, GatewayDeviceId.check("žžž"))
        assertEquals(GatewayDeviceId.Problem.NONE, GatewayDeviceId.check("phone-1"))
    }

    @Test
    fun testN6_classifyException() {
        val connectEx = java.net.ConnectException("Connection refused")
        assertEquals(ShellClientProtocol.RoundTrip.Absent, ShellClientProtocol.classify(connectEx))

        val timeoutEx = java.net.SocketTimeoutException("Connect timed out")
        assertEquals(ShellClientProtocol.RoundTrip.Busy, ShellClientProtocol.classify(timeoutEx))
    }

    @Test
    fun testK22_ArmSlot_atomicity() {
        val slot = ArmSlot()
        val iters = 100000
        val latch = CountDownLatch(2)
        var failed = false

        thread {
            for (i in 0 until iters) {
                slot.set(CaptureOrder.Armed("call$i", i % 2 == 0))
            }
            latch.countDown()
        }

        thread {
            for (i in 0 until iters) {
                val state = slot.get()
                // In our model, startInFlight determines if we are waiting for start.
                // If it were 2 separate fields, we might see a mix of expected and startInFlight
                // that never naturally occurs if they are written atomically.
                // Actually, Armed is just a data class. 
                // Any read should be a valid pair that was written.
                val expected = state.expected
                if (expected != null && expected.startsWith("call")) {
                    val num = expected.substring(4).toIntOrNull()
                    if (num != null) {
                        val expectedFlag = num % 2 == 0
                        if (state.startInFlight != expectedFlag) {
                            failed = true
                        }
                    }
                }
            }
            latch.countDown()
        }

        latch.await()
        assertFalse(failed, "ArmSlot should be atomic")
    }
}
