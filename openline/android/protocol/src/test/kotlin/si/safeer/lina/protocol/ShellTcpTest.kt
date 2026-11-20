package si.safeer.lina.protocol

import java.io.BufferedReader
import java.io.Reader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * TCP namesto abstraktne vticnice. Ponovitev posnetega rokovanja, lazni
 * streznik in napacen HMAC ne smejo dobiti nicesar in ne smejo izvabiti zetona.
 */
class ShellTcpTest {
    private val config = ShellAuth.LaunchConfig(
        token = "streznik-zeton-samo-na-vhodu-123456",
        appUid = 10123,
        mediaUrl = "wss://127.0.0.1:8787/v1/device-media",
        certSha256 = "ef".repeat(32),
        deviceId = "naprava-dolga",
        deviceToken = "zeton-naprave-samo-ob-zagonu",
    )

    @Test
    fun `beri natanko 6 vrstic in ne cakaj na konec vhoda`() {
        val text = ShellAuth.stdinText(config)
        val reader = StopAfter(text)
        val read = ShellAuth.readConfigLines(reader)
        assertEquals(config.mediaUrl, read?.mediaUrl)
        assertEquals(config.token, read?.token)
        assertEquals(0, reader.pastEof)
        assertNull(ShellAuth.parsePortLine(config.token))
        assertEquals(43111, ShellAuth.parsePortLine("PORT 43111"))
        assertNull(ShellAuth.parsePortLine("echo ${config.token}"))
    }

    @Test
    fun `loopback in HMAC, ponovitev posnetega rokovanja ne dobi odgovora`() {
        val calls = AtomicInteger(0)
        val endpoint = ShellEndpoint(config) { _, _ ->
            calls.incrementAndGet()
            """{"ok":true,"marker":"DOVOLJENO"}"""
        }
        try {
            assertTrue(endpoint.socket.inetAddress.isLoopbackAddress)
            assertFalse(endpoint.portLine().contains(config.token))
            val first = ShellClientProtocol.exchange(endpoint.port, config.token, """{"op":"ping"}""")
            assertNotNull(first)
            assertTrue(first.contains("DOVOLJENO"))
            assertFalse(first.contains(config.token))
            assertFalse(first.contains(config.deviceToken))
            assertEquals(1, calls.get())

            val recorded = recordClientLine(endpoint.port, config.token)
            val replayed = Socket(InetAddress.getByName("127.0.0.1"), endpoint.port)
            replayed.soTimeout = 2_000
            replayed.use { sock ->
                val reader = sock.getInputStream().bufferedReader()
                val writer = sock.getOutputStream().bufferedWriter()
                val hello = reader.readLine()
                assertTrue(hello.startsWith("OL2 "))
                writer.write(recorded)
                writer.newLine()
                writer.flush()
                val reply = runCatching { reader.readLine() }.getOrNull()
                val body = (reply ?: "") 
                assertFalse(body.contains("DOVOLJENO"))
                assertFalse(body.contains(config.deviceToken))
                assertFalse(body.contains(config.mediaUrl))
            }
            assertEquals(1, calls.get())
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `lazni streznik na vratih ne dobi zetona`() {
        val fake = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val captured = StringBuilder()
        val thread = Thread {
            val sock = fake.accept()
            sock.soTimeout = 2_000
            sock.getOutputStream().write("OL1 ${"ab".repeat(32)}\n".toByteArray())
            sock.getOutputStream().flush()
            val buf = ByteArray(1024)
            val n = runCatching { sock.getInputStream().read(buf) }.getOrDefault(-1)
            if (n > 0) captured.append(String(buf, 0, n))
            sock.close()
        }
        thread.start()
        try {
            val result = ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""")
            assertTrue(result is ShellClientProtocol.RoundTrip.Rejected)
            thread.join(2_000)
            val wire = captured.toString()
            assertFalse(wire.contains(config.token))
            assertFalse(wire.contains(config.deviceToken))
            assertFalse(wire.contains(config.mediaUrl))
            assertFalse(wire.contains(config.certSha256))
            assertFalse(wire.contains("ping"))
        } finally {
            fake.close()
        }
    }

    @Test
    fun `napacen HMAC ne odpre ukaza`() {
        val calls = AtomicInteger(0)
        val endpoint = ShellEndpoint(config) { _, _ ->
            calls.incrementAndGet()
            """{"ok":true,"marker":"DOVOLJENO"}"""
        }
        try {
            val sock = Socket(InetAddress.getByName("127.0.0.1"), endpoint.port)
            sock.soTimeout = 2_000
            sock.use {
                val reader = it.getInputStream().bufferedReader()
                val writer = it.getOutputStream().bufferedWriter()
                val hello = reader.readLine()
                val proof = ShellAuth.clientProof(config.token, hello, endpoint.port)!!
                val broken = proof.line.dropLast(2) + "00"
                writer.write(broken)
                writer.newLine()
                writer.flush()
                val reply = runCatching { reader.readLine() }.getOrNull()
                assertTrue(reply == null || !reply.contains("DOVOLJENO"))
            }
            Thread.sleep(100)
            assertEquals(0, calls.get())
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `po napakah veljaven HMAC se vedno pride skozi`() {
        val endpoint = ShellEndpoint(config) { _, _ -> """{"ok":true,"marker":"DOVOLJENO"}""" }
        try {
            repeat(6) {
                val sock = Socket(InetAddress.getByName("127.0.0.1"), endpoint.port)
                sock.soTimeout = 1_000
                sock.use {
                    val reader = it.getInputStream().bufferedReader()
                    val writer = it.getOutputStream().bufferedWriter()
                    reader.readLine()
                    writer.write("ne-hmac\n")
                    writer.flush()
                }
                Thread.sleep(40)
            }
            val still = ShellClientProtocol.exchange(endpoint.port, config.token, """{"op":"ping"}""")
            assertNotNull(still)
            assertTrue(still.contains("DOVOLJENO"))
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `skripta nima cgroup ne stty ne printf in pkill ne ubije lupine`() {
        val script = ShellStarter.heldScript(
            "/data/app/base.apk",
            "si.safeer.lina.shell.ShellServerMain",
            7,
            "httpgateway_shell",
        )
        assertEquals(9, Regex("""IFS= read -r OL_""").findAll(script).count())
        assertFalse(script.contains("cgroup"))
        assertFalse(script.contains("stty"))
        assertFalse(script.contains("printf"))
        assertTrue(script.contains("print -r --"))
        assertFalse(script.contains("set -x"))
        assertFalse(script.contains(config.token))
        val command = ShellStarter.adbShellCommand(script, "httpgateway_shell")
        assertFalse(command.contains("pkill -f httpgateway_shell"))
        assertFalse(command.contains("pkill -f 'httpgateway_shell'"))
        assertTrue(command.contains(ShellStarter.killPattern("httpgateway_shell")))
        assertFalse(ShellAuth.argvHasSecret(listOf(command), config))
        val kill = ShellStarter.killCommand("httpgateway_shell")
        val proc = ProcessBuilder("sh", "-c", kill)
            .redirectErrorStream(true)
            .apply { environment()["PATH"] = "/usr/local/bin:" + (System.getenv("PATH") ?: "") }
            .start()
        val output = proc.inputStream.bufferedReader().readText()
        val code = proc.waitFor()
        assertEquals(0, code, output)
        assertTrue(output.contains("KONEC"), output)
        assertEquals(ShellLaunchVerdict.Kind.HOLD, ShellLaunchVerdict.afterDisconnect(1, 3, lateOk = true))
        assertEquals(ShellLaunchVerdict.Kind.HOLD, ShellLaunchVerdict.afterDisconnect(3, 3, lateOk = false))
        assertEquals(ShellLaunchVerdict.Kind.DETACHED, ShellLaunchVerdict.afterDisconnect(3, 3, lateOk = true))
        assertTrue(ShellLaunchVerdict.skipDetachedAttempt(ShellLaunchVerdict.Kind.HOLD.name))
        assertFalse(ShellLaunchVerdict.shouldMeasure(ShellLaunchVerdict.Kind.HOLD.name))
    }

    @Test
    fun `podpisi izhoda zvoka in zasebnost stevilke`() {
        assertNull(BackgroundAudioSignatures.exitParameterTypes(29))
        assertEquals(listOf("boolean"), BackgroundAudioSignatures.exitParameterTypes(30))
        assertEquals(listOf("boolean"), BackgroundAudioSignatures.exitParameterTypes(35))
        assertFalse(BackgroundAudioSignatures.SHOULD_RING_WHEN_RETURNING_AUDIO)
        assertFalse(CallLifecycle.emitRemoval(owned = false, announced = false))
        assertFalse(CallLifecycle.emitRemoval(owned = false, announced = false))
        assertTrue(CallLifecycle.emitRemoval(owned = true, announced = false))
        assertTrue(CallLifecycle.emitRemoval(owned = false, announced = true))
        val saved = 1_700_000_000_000L
        assertNull(EmergencyLock.read(0L))
        assertEquals(saved, EmergencyLock.read(saved))
        assertTrue(TakeoverPolicy.inEmergencyCooldown(EmergencyLock.read(saved), saved + 60_000))
        assertFalse(TakeoverPolicy.inEmergencyCooldown(null, saved + 60_000))
    }

    private fun recordClientLine(port: Int, token: String): String {
        val sock = Socket(InetAddress.getByName("127.0.0.1"), port)
        sock.soTimeout = 2_000
        sock.use {
            val reader = it.getInputStream().bufferedReader()
            val hello = reader.readLine()
            return ShellAuth.clientProof(token, hello, port)!!.line
        }
    }
}

/** Po 6 vrsticah branje ne sme vleci konca vhoda. */
private class StopAfter(text: String) : BufferedReader(Reader.nullReader()) {
    private val source = text.reader().buffered()
    var pastEof: Int = 0

    override fun readLine(): String? {
        val line = source.readLine()
        if (line == null) {
            pastEof += 1
            throw IllegalStateException("bral cez konfiguracijo, caka na EOF")
        }
        return line
    }
}
