package si.safeer.lina.protocol

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Mutacije, ki so v krogu 6 prezivele: omejitev vrstice, odjemalceva mesta,
 * skrivnost v ukazu, carriesConfig, dolzina writeLine, emitRemoval(false, false).
 * Plus RST, zasedenost, tekma start/najem in odlocitve iz aplikacije.
 */
class Krog7AuditTest {
    private val config = ShellAuth.LaunchConfig(
        token = "krog7-zeton-samo-na-vhodu-123456",
        appUid = 10123,
        mediaUrl = "wss://127.0.0.1:8787/v1/device-media",
        certSha256 = "ef".repeat(32),
        deviceId = "naprava-dolga",
        deviceToken = "zeton-naprave-samo-ob-zagonu",
    )

    @Test
    fun `RST ne pobegne iz serve in ping se uspe`() {
        val escaped = Collections.synchronizedList(mutableListOf<Throwable>())
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { _, error -> escaped.add(error) }
        val endpoint = ShellEndpoint(config) { _, _ -> """{"ok":true,"marker":"DOVOLJENO"}""" }
        try {
            repeat(8) {
                val sock = Socket()
                sock.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), endpoint.port), 1_000)
                sock.setSoLinger(true, 0)
                sock.close()
            }
            Thread.sleep(400)
            val ping = ShellClientProtocol.roundTrip(endpoint.port, config.token, """{"op":"ping"}""")
            assertTrue(ping is ShellClientProtocol.RoundTrip.Ok, ping.toString())
            assertTrue(ping.body.contains("DOVOLJENO"))
            assertTrue(escaped.isEmpty(), escaped.toString())
        } finally {
            endpoint.close()
            Thread.setDefaultUncaughtExceptionHandler(previous)
        }
    }

    @Test
    fun `ShellIo ob IOException vrne null`() {
        val input = object : InputStream() {
            override fun read(): Int = throw java.net.SocketException("Connection reset")
        }
        val line = ShellIo.readLine(input, ShellAuth.MAX_LINE_BYTES, System.currentTimeMillis() + 1_000) { }
        assertNull(line)
    }

    @Test
    fun `roundTrip ob OL2 in RST ne vrze`() {
        val result = roundTripAfterHelloThenRst(config.token)
        assertTrue(result is ShellClientProtocol.RoundTrip.Busy, result.toString())
    }

    @Test
    fun `rok dokaza je kratek`() {
        assertTrue(ShellAuth.PROOF_TIMEOUT_MS in 50..400, "rok=${ShellAuth.PROOF_TIMEOUT_MS}")
        val endpoint = ShellEndpoint(config) { _, _ -> """{"ok":true}""" }
        val sock = Socket()
        try {
            sock.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), endpoint.port), 1_000)
            sock.soTimeout = 2_000
            val reader = sock.getInputStream().bufferedReader()
            val hello = reader.readLine()
            assertTrue(hello.startsWith("OL2 "))
            val started = System.currentTimeMillis()
            val next = runCatching { reader.readLine() }.getOrNull()
            val elapsed = System.currentTimeMillis() - started
            assertNull(next)
            assertTrue(elapsed < 800, "elapsed=$elapsed")
        } finally {
            runCatching { sock.close() }
            endpoint.close()
        }
    }

    @Test
    fun `deset tihih povezav ne izrine pinga`() {
        val endpoint = ShellEndpoint(config) { _, _ -> """{"ok":true,"marker":"DOVOLJENO"}""" }
        val stop = java.util.concurrent.CountDownLatch(1)
        val connected = java.util.concurrent.CountDownLatch(10)
        val attackers = (1..10).map {
            Thread {
                val sock = Socket()
                try {
                    sock.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), endpoint.port), 1_000)
                    connected.countDown()
                    stop.await(8, java.util.concurrent.TimeUnit.SECONDS)
                } catch (_: Exception) {
                    connected.countDown()
                } finally {
                    runCatching { sock.close() }
                }
            }.also { it.isDaemon = true; it.start() }
        }
        try {
            assertTrue(connected.await(3, java.util.concurrent.TimeUnit.SECONDS))
            var ok = 0
            repeat(40) {
                val result = ShellClientProtocol.roundTrip(
                    endpoint.port,
                    config.token,
                    """{"op":"ping"}""",
                    timeoutMs = 1_000,
                )
                if (result is ShellClientProtocol.RoundTrip.Ok && result.body.contains("DOVOLJENO")) ok += 1
            }
            assertTrue(ok >= 36, "ok=$ok")
        } finally {
            stop.countDown()
            attackers.forEach { it.join(1_000) }
            endpoint.close()
        }
    }

    @Test
    fun `deveti odjemalec brez strezniskega limita se vrne takoj`() {
        val fake = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val accepted = java.util.concurrent.CountDownLatch(ShellAuth.MAX_CONNECTIONS)
        val release = java.util.concurrent.CountDownLatch(1)
        val holder = Thread {
            repeat(ShellAuth.MAX_CONNECTIONS) {
                val sock = fake.accept()
                accepted.countDown()
                Thread {
                    release.await(8, java.util.concurrent.TimeUnit.SECONDS)
                    runCatching { sock.close() }
                }.also { it.isDaemon = true }.start()
            }
        }
        holder.isDaemon = true
        holder.start()
        val workers = (1..ShellAuth.MAX_CONNECTIONS).map {
            Thread {
                ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""", timeoutMs = 8_000)
            }.also { it.isDaemon = true; it.start() }
        }
        try {
            assertTrue(accepted.await(3, java.util.concurrent.TimeUnit.SECONDS))
            val started = System.currentTimeMillis()
            val ninth = ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""", timeoutMs = 2_000)
            val elapsed = System.currentTimeMillis() - started
            assertTrue(ninth is ShellClientProtocol.RoundTrip.Busy, ninth.toString())
            assertTrue(elapsed < 200, "elapsed=$elapsed")
        } finally {
            release.countDown()
            fake.close()
            workers.forEach { it.join(2_000) }
        }
    }

    @Test
    fun `ShellIo ne prebere cez 512`() {
        val over = ByteArrayInputStream(("x".repeat(600) + "\n").toByteArray())
        assertNull(ShellIo.readLine(over, ShellAuth.MAX_LINE_BYTES, System.currentTimeMillis() + 1_000) { })
        val exact = ByteArrayInputStream(("y".repeat(ShellAuth.MAX_LINE_BYTES) + "\n").toByteArray())
        assertNull(ShellIo.readLine(exact, ShellAuth.MAX_LINE_BYTES, System.currentTimeMillis() + 1_000) { })
        val fit = "z".repeat(ShellAuth.MAX_LINE_BYTES - 1)
        val ok = ByteArrayInputStream((fit + "\n").toByteArray())
        assertEquals(fit, ShellIo.readLine(ok, ShellAuth.MAX_LINE_BYTES, System.currentTimeMillis() + 1_000) { })
    }

    @Test
    fun `odjemalec ne poslje ukaza s skrivnostjo na lazno lupino`() {
        val captured = StringBuilder()
        val fake = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            while (!fake.isClosed) {
                val sock = runCatching { fake.accept() }.getOrNull() ?: break
                runCatching { recordIfCommand(fake.localPort, sock, captured) }
                runCatching { sock.close() }
            }
        }
        thread.isDaemon = true
        thread.start()
        try {
            val evil = """{"op":"start","callId":"klic","mediaUrl":"wss://evil.example/x"}"""
            assertTrue(ShellAuth.requestCarriesSecrets(evil))
            val result = ShellClientProtocol.roundTrip(fake.localPort, config.token, evil, timeoutMs = 1_000)
            assertTrue(result is ShellClientProtocol.RoundTrip.Rejected, result.toString())
            Thread.sleep(200)
            assertFalse(captured.contains("evil.example"), captured.toString())
            assertFalse(captured.contains("mediaUrl"), captured.toString())
            assertFalse(captured.contains(config.deviceToken), captured.toString())
            assertFalse(captured.contains(config.token), captured.toString())
        } finally {
            fake.close()
            thread.join(1_000)
        }
    }

    @Test
    fun `odgovor s konfiguracijo ne gre na zico`() {
        val endpoint = ShellEndpoint(config) { _, _ -> config.deviceToken }
        try {
            val reply = commandReply(endpoint.port, """{"op":"ping"}""")
            assertTrue(reply == null || !reply.contains(config.deviceToken), reply ?: "")
            assertTrue(reply == null || !reply.contains(config.token), reply ?: "")
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `writeLine ne poslje vrstice cez 512`() {
        val huge = "q".repeat(ShellAuth.MAX_LINE_BYTES + 80)
        val endpoint = ShellEndpoint(config) { _, _ -> huge }
        try {
            val reply = commandReply(endpoint.port, """{"op":"ping"}""")
            assertTrue((reply?.length ?: 0) <= ShellAuth.MAX_LINE_BYTES, reply ?: "")
            assertFalse(reply == huge)
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `Busy ni OCCUPIED in en ponovni poskus ne ubije`() {
        assertEquals(
            ShellHandshake.Probe.BUSY,
            ShellProbe.fromTrip(ShellClientProtocol.RoundTrip.Busy, versionMatches = false, configMatches = false),
        )
        assertEquals(
            ShellHandshake.Probe.OCCUPIED,
            ShellProbe.fromTrip(ShellClientProtocol.RoundTrip.Rejected, versionMatches = false, configMatches = false),
        )
        assertEquals(ShellProbe.Next.USE, ShellProbe.next(ShellHandshake.Probe.BUSY))
        assertEquals(ShellProbe.Next.USE, ShellProbe.next(ShellProbe.afterRetry(ShellHandshake.Probe.BUSY, ShellHandshake.Probe.BUSY)))
        assertEquals(ShellHandshake.Probe.OURS, ShellProbe.afterRetry(ShellHandshake.Probe.BUSY, ShellHandshake.Probe.OURS))
        assertEquals(
            ShellProbe.Next.RESTART,
            ShellProbe.next(ShellProbe.afterRetry(ShellHandshake.Probe.BUSY, ShellHandshake.Probe.OCCUPIED)),
        )
        assertFalse(LaunchSteps.sequence(ShellHandshake.Probe.BUSY, paired = true, detachedPort = null).contains(LaunchSteps.Step.EXIT_AND_FORGET))
        assertTrue(LaunchSteps.sequence(ShellHandshake.Probe.OCCUPIED, paired = true, detachedPort = 1).contains(LaunchSteps.Step.EXIT_AND_FORGET))
    }

    @Test
    fun `najava pred start ne ustavi zajema`() {
        val arm = CaptureOrder.beforeStart("klic")
        assertEquals("klic", arm.expected)
        assertTrue(arm.startInFlight)
        assertFalse(CaptureOrder.lease(arm.expected, "klic", arm.startInFlight).stop)
        assertFalse(CaptureOrder.lease(arm.expected, null, arm.startInFlight).stop)
        assertTrue(CaptureOrder.lease(null, "klic", startInFlight = false).stop)
        assertTrue(AudioPing.tick(null, "klic").stop)
        assertFalse(AudioPing.tick("klic", "klic").stop)
        val kept = CaptureOrder.afterStart("klic", keep = true)
        assertEquals("klic", kept.expected)
        assertFalse(kept.startInFlight)
        assertEquals("klic", CaptureOrder.lease(kept.expected, "klic", kept.startInFlight).confirmCallId)
        assertNull(CaptureOrder.afterStart("klic", keep = false).expected)
    }

    @Test
    fun `stevilka brez owned in brez najave ne gre na streznik`() {
        assertFalse(CallLifecycle.emitRemoval(owned = false, announced = false))
        assertTrue(CallLifecycle.emitRemoval(owned = true, announced = false))
        assertTrue(CallLifecycle.emitRemoval(owned = false, announced = true))
        val queue = PendingCallEvents()
        queue.add("klic", """{"number":"+38640111222"}""")
        queue.drop("klic")
        assertTrue(queue.isEmpty())
        assertFalse(queue.encoded().any { it.contains("+38640111222") })
    }

    @Test
    fun `padec zvoka vrne slusalko in opozori`() {
        val drop = AudioDrop.plan(dropped = true)
        assertTrue(drop.stopCapture)
        assertTrue(drop.returnToHandset)
        assertTrue(drop.warn)
        assertFalse(AudioDrop.simulatedRinging())
        assertFalse(AudioDrop.plan(dropped = false).returnToHandset)
        assertFalse(BackgroundAudioSignatures.SHOULD_RING_WHEN_RETURNING_AUDIO)
    }

    @Test
    fun `start zavrnjen ni ok`() {
        assertFalse(StartReply.accepted(false))
        assertTrue(StartReply.accepted(true))
    }

    @Test
    fun `obvestilo dokler je seznanjeno in lupina molci`() {
        assertTrue(ShellLoss.showWhileDown(paired = true, up = false))
        assertFalse(ShellLoss.showWhileDown(paired = true, up = true))
        assertFalse(ShellLoss.showWhileDown(paired = false, up = false))
        assertTrue(ShellLoss.shouldNotify(wasServing = true, servesNow = false))
        val first = ShellLoss.nextWifi(paired = true, shellUp = false, wifi = true, seen = false, wifiWasUp = false)
        assertFalse(first.shouldRetry)
        val lost = ShellLoss.nextWifi(paired = true, shellUp = false, wifi = false, seen = true, wifiWasUp = true)
        assertFalse(lost.shouldRetry)
        assertFalse(lost.wifiWasUp)
        val back = ShellLoss.nextWifi(paired = true, shellUp = false, wifi = true, seen = true, wifiWasUp = false)
        assertTrue(back.shouldRetry)
        val steady = ShellLoss.nextWifi(paired = true, shellUp = false, wifi = true, seen = true, wifiWasUp = true)
        assertFalse(steady.shouldRetry)
    }

    @Test
    fun `neuspel samostojni zagon si zapomni HOLD in pobrise cevi`() {
        val failed = LaunchSteps.sequence(ShellHandshake.Probe.ABSENT, paired = true, detachedPort = null)
        assertTrue(failed.contains(LaunchSteps.Step.REMEMBER_HOLD))
        assertTrue(failed.contains(LaunchSteps.Step.CLEAN_FIFOS))
        assertEquals("rm -f /data/local/tmp/openline.port.*", FifoCleanup.command())
        val script = ShellStarter.detachedScript("/data/app/base.apk", "Main", 1, "httpgateway_shell")
        assertFalse(script.contains("openline.port.*"))
        assertTrue(script.contains("print -r --"))
        assertEquals(300L, ShellCleanup.settleBeforeRecheck(acknowledged = false))
    }

    @Test
    fun `toString seje in konfiguracije nima zetona`() {
        val token = "z".repeat(24)
        val record = ShellSessionWrite.commit(token, 43111)
        assertFalse(record.toString().contains(token), record.toString())
        assertTrue(record.toString().contains("43111"))
        val began = ShellSessionWrite.beginRotation(token)
        assertFalse(began.toString().contains(token), began.toString())
        val text = ConfigPrivacy.gateway("naprava")
        assertTrue(text.contains("naprava"))
        assertFalse(text.contains(token))
        assertFalse(text.contains("wss://"))
        assertFalse(text.contains(config.deviceToken))
    }

    @Test
    fun `potrditev na ACTIVE in casovnik s svezim pingom`() {
        val guard = LocalCallGuard()
        assertTrue(guard.beginAnswer("klic"))
        assertTrue(guard.confirmOwnedOnActive("klic"))
        assertTrue(guard.isOwned("klic"))
        val manual = LocalCallGuard()
        assertTrue(manual.beginAnswer("klic"))
        manual.markManual("klic")
        assertFalse(manual.confirmOwnedOnActive("klic"))
        assertFalse(manual.isOwned("klic"))
        assertFalse(RingTimeoutGate.admit(TakeoverVerdict.TAKE, freshPing = false, gatewayConnected = true, still = TakeoverVerdict.TAKE))
        assertFalse(RingTimeoutGate.admit(TakeoverVerdict.TAKE, freshPing = true, gatewayConnected = false, still = TakeoverVerdict.TAKE))
        assertFalse(RingTimeoutGate.admit(TakeoverVerdict.TAKE, freshPing = true, gatewayConnected = true, still = TakeoverVerdict.REFUSE))
        assertTrue(RingTimeoutGate.admit(TakeoverVerdict.TAKE, freshPing = true, gatewayConnected = true, still = TakeoverVerdict.TAKE))
    }

    @Test
    fun `sporocila uporabniku nimajo besedila izjeme`() {
        val leak = "java.io.IOException: /data/secret-token"
        assertEquals("scanner_unavailable", ShownError.resource("scanner_unavailable", leak))
        assertEquals("couldnt_connect", ShownError.resource("couldnt_connect", leak))
        assertEquals("pair_error", ShownError.resource("pair_error", leak))
        assertFalse(ShownError.resource("pair_error", leak).contains("IOException"))
        assertFalse(ShownError.resource("couldnt_connect", leak).contains("secret"))
        val sl = java.io.File("../app/src/main/res/values-sl/strings.xml").readText()
        val en = java.io.File("../app/src/main/res/values/strings.xml").readText()
        for (name in listOf("scanner_unavailable", "couldnt_connect", "pair_error")) {
            assertFalse(stringValue(sl, name).contains("%"), name)
            assertFalse(stringValue(en, name).contains("%"), name)
        }
        assertTrue(stringValue(sl, "audio_returned").contains("slušalk"))
        assertTrue(stringValue(en, "audio_returned").contains("handset"))
    }

    private fun roundTripAfterHelloThenRst(token: String): ShellClientProtocol.RoundTrip {
        val fake = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            val sock = runCatching { fake.accept() }.getOrNull() ?: return@Thread
            sock.soTimeout = 2_000
            val out = sock.getOutputStream()
            out.write("OL2 ${"ab".repeat(32)}\n".toByteArray())
            out.flush()
            runCatching { sock.getInputStream().bufferedReader().readLine() }
            sock.setSoLinger(true, 0)
            runCatching { sock.close() }
        }
        thread.isDaemon = true
        thread.start()
        return try {
            ShellClientProtocol.roundTrip(fake.localPort, token, """{"op":"ping"}""", timeoutMs = 2_000)
        } finally {
            runCatching { fake.close() }
            thread.join(2_000)
        }
    }

    private fun recordIfCommand(port: Int, sock: Socket, captured: StringBuilder) {
        sock.soTimeout = 250
        val input = sock.getInputStream()
        val peeked = runCatching {
            val buf = ByteArray(64)
            val n = input.read(buf)
            if (n > 0) String(buf, 0, n) else ""
        }.getOrDefault("")
        if (peeked.startsWith("GET") || peeked.startsWith("HEAD") || peeked.startsWith("PRI")) {
            captured.append(peeked)
            return
        }
        val serverNonce = "ab".repeat(32)
        val out = sock.getOutputStream()
        out.write("OL2 $serverNonce\n".toByteArray())
        out.flush()
        sock.soTimeout = 1_000
        val reader = input.bufferedReader()
        val clientLine = runCatching { reader.readLine() }.getOrNull() ?: return
        val clientNonce = ShellAuth.clientNonceOf(clientLine) ?: return
        out.write(ShellAuth.serverLine(config.token, serverNonce, clientNonce, port).toByteArray())
        out.write("\n".toByteArray())
        out.flush()
        val command = runCatching { reader.readLine() }.getOrNull() ?: return
        captured.append(command)
    }

    private fun commandReply(port: Int, command: String): String? {
        val sock = Socket(InetAddress.getByName("127.0.0.1"), port)
        sock.soTimeout = 2_000
        sock.use {
            val reader = it.getInputStream().bufferedReader()
            val writer = it.getOutputStream().bufferedWriter()
            val hello = reader.readLine()
            val proof = ShellAuth.clientProof(config.token, hello, port)!!
            writer.write(proof.line)
            writer.newLine()
            writer.flush()
            val server = reader.readLine()
            assertTrue(ShellAuth.acceptServer(config.token, proof.serverNonce, proof.clientNonce, server, port))
            writer.write(command)
            writer.newLine()
            writer.flush()
            return runCatching { reader.readLine() }.getOrNull()
        }
    }

    private fun stringValue(xml: String, name: String): String {
        val key = "name=\"$name\">"
        val at = xml.indexOf(key)
        assertTrue(at >= 0, name)
        return xml.substring(at + key.length).substringBefore('<')
    }
}
