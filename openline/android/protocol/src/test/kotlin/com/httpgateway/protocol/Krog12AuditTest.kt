package com.httpgateway.protocol

import java.net.ConnectException
import java.net.SocketTimeoutException
import kotlin.test.Test
import kotlin.test.assertEquals
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
}
