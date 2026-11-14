package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class Krog11AuditTest {

    @Test
    fun testN10_1_evaluateStart() {
        // Krog 12: parameter `after` je bil mrtev (N11-7). Trditve so iste, dodan je avtomat, ki funkcijo uporablja.
        val decisionDiff = CaptureOrder.evaluateStart(1, 2)
        assertFalse(decisionDiff.writeArm)
        assertTrue(decisionDiff.immediateStop)

        val decisionSame = CaptureOrder.evaluateStart(1, 1)
        assertTrue(decisionSame.writeArm)
        assertFalse(decisionSame.immediateStop)

        var state = CaptureMachine.reduce(CaptureMachine.State(), CaptureMachine.Event.CallActive("call1")).state
        val granted = state.generation
        state = CaptureMachine.reduce(state, CaptureMachine.Event.Prepared("call1", granted, ok = true)).state
        state = CaptureMachine.reduce(state, CaptureMachine.Event.UnsafeDownlink).state
        val late = CaptureMachine.reduce(
            state,
            CaptureMachine.Event.StartResult("call1", granted, started = true, permitted = true),
        )
        assertEquals(null, late.state.view.expected)
        assertTrue(late.effects.any { it is CaptureMachine.Effect.StopCapture && it.callId == "call1" })
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
        // Krog 12: verjetnostni preizkus z dvema nitma (pregled 11: pade 3 od 4 tekov ob mutaciji) je zamenjan
        // z deterministicnim. ArmSlot ne obstaja vec: par (expected, startInFlight) se izracuna iz enega
        // nespremenljivega stanja avtomata, zato ga ni mogoce prebrati na pol zapisanega.
        var state = CaptureMachine.State()
        val seen = mutableSetOf(state.view)
        val events = listOf(
            CaptureMachine.Event.CallActive("call0"),
            CaptureMachine.Event.Prepared("call0", 1, ok = true),
            CaptureMachine.Event.StartResult("call0", 1, started = false, permitted = true),
            CaptureMachine.Event.RetryDue("call0", 1),
            CaptureMachine.Event.StartResult("call0", 1, started = true, permitted = true),
            CaptureMachine.Event.UnsafeDownlink,
            CaptureMachine.Event.CallEnded("call0"),
        )
        for (event in events) {
            val before = state
            val view = before.view
            state = CaptureMachine.reduce(state, event).state
            // Stari objekt se ne spremeni: bralec, ki ga drzi, vidi skladen par tudi po prehodu.
            assertEquals(view, before.view)
            seen += state.view
        }
        assertEquals(
            setOf(
                CaptureOrder.Armed(null, false),
                CaptureOrder.Armed("call0", true),
                CaptureOrder.Armed("call0", false),
            ),
            seen,
        )
    }
}
