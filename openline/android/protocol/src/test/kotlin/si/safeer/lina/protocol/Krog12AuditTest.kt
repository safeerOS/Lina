package si.safeer.lina.protocol

import java.net.ConnectException
import java.net.SocketTimeoutException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Krog 12: najdbe enajstega pregleda zunaj avtomata zajema. */
class Krog12AuditTest {
    private val token = "krog12-zeton-samo-na-vhodu-123456"

    @Test
    fun `N6 rok povezave v roundTrip je Busy in ne Absent`() {
        // Skozi roundTrip, ne skozi pomozno funkcijo: `return RoundTrip.Absent` na mestu klica mora pasti.
        var waited = -1
        val timedOut = ShellClientProtocol.roundTrip(45_678, token, """{"op":"ping"}""", 300) { _, address, wait ->
            waited = wait
            assertTrue(address.address.isLoopbackAddress)
            throw SocketTimeoutException("Connect timed out")
        }
        assertEquals(ShellClientProtocol.RoundTrip.Busy, timedOut)
        assertTrue(waited in 1..300, "rok povezave: $waited")
    }

    @Test
    fun `N6 zavrnjena povezava v roundTrip je Absent in druge napake Busy`() {
        val refused = ShellClientProtocol.roundTrip(45_678, token, """{"op":"ping"}""", 300) { _, _, _ ->
            throw ConnectException("Connection refused")
        }
        assertEquals(ShellClientProtocol.RoundTrip.Absent, refused)
        val reset = ShellClientProtocol.roundTrip(45_678, token, """{"op":"ping"}""", 300) { _, _, _ ->
            throw java.io.IOException("reset")
        }
        assertEquals(ShellClientProtocol.RoundTrip.Busy, reset)
    }

    @Test
    fun `N6 napaka povezave sprosti mesto`() {
        // Vec kot MAX_CONNECTIONS zaporednih rokov: ce se mesto ne sprosti, zadnji vrnejo Busy brez klica connect.
        var calls = 0
        repeat(ShellAuth.MAX_CONNECTIONS + 2) {
            ShellClientProtocol.roundTrip(45_678, token, """{"op":"ping"}""", 300) { _, _, _ ->
                calls++
                throw SocketTimeoutException()
            }
        }
        assertEquals(ShellAuth.MAX_CONNECTIONS + 2, calls)
    }

    @Test
    fun `N11-2 start je dovoljen samo ob istem pogoju kot CallAudioPolicy START`() {
        for (owned in listOf(true, false)) for (other in listOf(true, false)) for (state in AudioCallState.entries) {
            val expected = CallAudioPolicy.action(owned, state, other) == CallAudioAction.START
            assertEquals(expected, CapturePermit.allowed(owned, state, other), "$owned $state $other")
        }
        assertTrue(CapturePermit.allowed(true, AudioCallState.AUDIO_PROCESSING, false))
        assertTrue(CapturePermit.allowed(true, AudioCallState.ACTIVE, false))
        assertFalse(CapturePermit.allowed(true, AudioCallState.ACTIVE, otherLiveNotLina = true))
        assertFalse(CapturePermit.allowed(false, AudioCallState.ACTIVE, false))
        assertFalse(CapturePermit.allowed(true, AudioCallState.HOLDING, false))
        // Klica ni vec v registru.
        assertFalse(CapturePermit.allowed(true, null, false))
    }

    @Test
    fun `N11-5 klic ki je ACTIVE in slisen ni tih`() {
        assertEquals("audio_returned", AudioDrop.outcome(callPresent = true, exitOk = false, audible = true).message)
        assertEquals("audio_not_returned", AudioDrop.outcome(callPresent = true, exitOk = false, audible = false).message)
        assertEquals("call_disconnected", AudioDrop.outcome(callPresent = false, exitOk = false, audible = true).message)
        assertEquals("call_disconnected", AudioDrop.outcome(callPresent = true, exitOk = false, disconnected = true).message)
        assertEquals(AudioDrop.DisconnectDecision.KEEP, AudioDrop.shouldDisconnect(TelecomPhase.STATE_ACTIVE, exitOk = false))
        assertEquals(12, TelecomPhase.STATE_AUDIO_PROCESSING)
    }

    @Test
    fun `N11-5 rocni prevzem na API 29 ne opozori da je klic tih`() {
        assertFalse(AudioReturn.shouldWarn(exitFailed = true, audible = true))
        assertTrue(AudioReturn.shouldWarn(exitFailed = true, audible = false))
        assertFalse(AudioReturn.shouldWarn(exitFailed = false, audible = false))
    }

    @Test
    fun `nizi obvestil so v values in values-sl`() {
        val en = java.io.File("../app/src/main/res/values/strings.xml").readText()
        val sl = java.io.File("../app/src/main/res/values-sl/strings.xml").readText()
        fun value(xml: String, name: String): String {
            val key = "name=\"$name\">"
            val at = xml.indexOf(key)
            assertTrue(at >= 0, "manjka niz $name")
            return xml.substring(at + key.length).substringBefore('<')
        }
        val names = ReturnNotice.entries.map { it.key } + listOf("shell_lost", "empty_device_id", "need_ascii_device_id")
        for (name in names) {
            assertTrue(value(en, name).isNotBlank(), name)
            assertTrue(value(sl, name).isNotBlank(), name)
            assertTrue(value(en, name) != value(sl, name), "$name ni preveden")
        }
        // Tri razlicna obvestila za tri razlicne izide, v obeh jezikih.
        assertEquals(3, ReturnNotice.entries.map { value(en, it.key) }.toSet().size)
        assertEquals(3, ReturnNotice.entries.map { value(sl, it.key) }.toSet().size)
        assertTrue(value(sl, "call_disconnected").contains("prekinjen"))
        assertTrue(value(sl, "audio_returned").contains("slušalki"))
        assertTrue(value(sl, "audio_not_returned").contains("tih"))
    }

    @Test
    fun `N11-7 parjenje pokaze vzrok zavrnitve imena naprave`() {
        assertNull(GatewayDeviceId.resourceName(GatewayDeviceId.check("telefon-1")))
        assertEquals("empty_device_id", GatewayDeviceId.resourceName(GatewayDeviceId.check(" ")))
        assertEquals("need_ascii_device_id", GatewayDeviceId.resourceName(GatewayDeviceId.check("telefon-č")))
        // Zaslon pokaze niz po imenu, ne besedila izjeme.
        assertEquals("empty_device_id", ShownError.resource("empty_device_id", "java.lang.IllegalStateException: x"))
    }
}
