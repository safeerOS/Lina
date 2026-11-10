package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pogodba ShellClient: zeton ne gre na zico, staticni pozdrav ni dokaz,
 * start nese samo id klica.
 */
class ShellClientTest {
    private val token = "odjemalec-zeton-ki-ne-sme-na-zico-1234"
    private val config = ShellAuth.LaunchConfig(
        token = token,
        appUid = 10123,
        mediaUrl = "wss://127.0.0.1:8787/v1/device-media",
        certSha256 = "ab".repeat(32),
        deviceId = "naprava",
        deviceToken = "zeton-naprave-ki-ne-sme-v-start",
    )

    @Test
    fun `odjemalec ne poslje zetona in ne verjame OL1`() {
        val serverNonce = ShellAuth.nonce()
        val hello = ShellAuth.serverHello(serverNonce)
        assertFalse(ShellAuth.isStaticHello(hello))
        assertFalse(hello.contains(token))

        val legacy = "OL1 " + "cd".repeat(32)
        assertNull(ShellAuth.clientProof(token, legacy, 43111))
        assertFalse(ShellAuth.acceptServer(token, serverNonce, ShellAuth.nonce(), legacy, 43111))

        val clientNonce = ShellAuth.nonce()
        val line = ShellAuth.clientLine(token, serverNonce, clientNonce, 43111)
        assertFalse(line.contains(token))
        assertFalse(line.contains(config.deviceToken))
        assertTrue(ShellAuth.acceptClient(token, serverNonce, line, 43111))
        val reply = ShellAuth.serverLine(token, serverNonce, clientNonce, 43111)
        assertFalse(reply.contains(token))
        assertTrue(ShellAuth.acceptServer(token, serverNonce, clientNonce, reply, 43111))
    }

    @Test
    fun `start odjemalca nima mediaUrl odtisa ali zetona`() {
        val line = """{"op":"start","callId":"klic-1"}"""
        assertFalse(ShellAuth.requestCarriesSecrets(line))
        assertFalse(line.contains(token))
        assertFalse(line.contains(config.mediaUrl))
        assertEquals("start", ShellAuth.parseOp(line)?.get("op"))
    }
}
