package com.httpgateway.protocol

import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pogodba ShellServerMain: pozdrav je enkratni nonce, zeton pride po vhodu,
 * start ne sme prinesti svojega naslova ali odtisa.
 */
class ShellServerMainTest {
    private val config = ShellAuth.LaunchConfig(
        token = "streznik-zeton-samo-na-vhodu-123456",
        appUid = 10123,
        mediaUrl = "wss://127.0.0.1:8787/v1/device-media",
        certSha256 = "ef".repeat(32),
        deviceId = "naprava",
        deviceToken = "zeton-naprave-samo-ob-zagonu",
    )

    @Test
    fun `pozdrav ni OL1 plus zgostitev in zeton ni v argv`() {
        val digest = MessageDigest.getInstance("SHA-256").digest(config.token.encodeToByteArray())
            .joinToString("") { "%02x".format(it) }
        val legacy = "OL1 $digest"
        val nonce = ShellAuth.nonce()
        val hello = ShellAuth.serverHello(nonce)
        assertTrue(ShellAuth.isStaticHello(legacy))
        assertFalse(hello.startsWith("OL1 "))
        assertFalse(hello.contains(digest))
        assertFalse(hello.contains(config.token))
        assertFalse(ShellAuth.acceptClient(config.token, nonce, legacy, 43111))
        assertFalse(ShellAuth.argvHasSecret(listOf("7"), config))
        val stdin = ShellAuth.stdinText(config)
        assertTrue(stdin.startsWith(config.token))
        assertEquals(config.mediaUrl, ShellAuth.readConfig(stdin.trimEnd().lines())?.mediaUrl)
    }

    @Test
    fun `start s tujim mediaUrl in odtisom je zavrnjen`() {
        val evil = """{"op":"start","callId":"klic","mediaUrl":"wss://evil.example/x","certSha256":"${"11".repeat(32)}","deviceToken":"ukraden"}"""
        assertTrue(ShellAuth.requestCarriesSecrets(evil))
        assertNull(ShellAuth.targetForStart(config, "klic", evil))
        val ok = """{"op":"start","callId":"klic"}"""
        val target = ShellAuth.targetForStart(config, "klic", ok)
        assertEquals(config.mediaUrl, target?.mediaUrl)
        assertEquals(config.certSha256, target?.certSha256)
        assertEquals(config.deviceToken, target?.deviceToken)
    }

    @Test
    fun `obojestranski HMAC z enkratnima vrednostma`() {
        val serverNonce = ShellAuth.nonce()
        val clientNonce = ShellAuth.nonce()
        val port = 43111
        val client = ShellAuth.clientLine(config.token, serverNonce, clientNonce, port)
        assertTrue(ShellAuth.acceptClient(config.token, serverNonce, client, port))
        assertFalse(ShellAuth.acceptClient(config.token, ShellAuth.nonce(), client, port))
        assertFalse(ShellAuth.acceptClient(config.token, serverNonce, client, port + 1))
        val server = ShellAuth.serverLine(config.token, serverNonce, clientNonce, port)
        assertTrue(ShellAuth.acceptServer(config.token, serverNonce, clientNonce, server, port))
        assertFalse(ShellAuth.acceptServer(config.token, serverNonce, clientNonce, client, port))
        assertFalse(server.contains(config.token))
        assertFalse(client.contains(config.token))
    }
}
