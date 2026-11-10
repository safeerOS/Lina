package com.httpgateway.protocol

import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.Timeout

/**
 * Krog 8. Mutacije, ki so prej prezivele, morajo pasti ob izvajanju, ne ob branju izvora.
 */
class Krog8AuditTest {
    private val config = ShellAuth.LaunchConfig(
        token = "krog8-zeton-samo-na-vhodu-123456",
        appUid = 10123,
        mediaUrl = "wss://127.0.0.1:8787/v1/device-media",
        certSha256 = "ab".repeat(32),
        deviceId = "naprava-dolga",
        deviceToken = "zeton-naprave-samo-ob-zagonu",
    )

    @Test
    fun `en Busy med dvema Ok ne vrne slusalke dva zaporedna jo`() {
        val view = CaptureOrder.Armed("klic", startInFlight = false)
        val firstMiss = LeaseRound.evaluate(view, view, pingOk = false, reported = null, misses = 0)
        assertFalse(firstMiss.giveBackSilence)
        assertFalse(firstMiss.plan.notifyDropped)
        assertEquals(1, firstMiss.misses)
        val recovered = LeaseRound.evaluate(view, view, pingOk = true, reported = "klic", misses = firstMiss.misses)
        assertFalse(recovered.giveBackSilence)
        assertEquals(0, recovered.misses)
        assertEquals("klic", recovered.plan.confirmCallId)
        val again = LeaseRound.evaluate(view, view, pingOk = false, reported = null, misses = 0)
        val second = LeaseRound.evaluate(view, view, pingOk = false, reported = null, misses = again.misses)
        assertTrue(second.giveBackSilence)
        assertFalse(second.plan.notifyDropped)
        val foreign = LeaseRound.evaluate(view, view, pingOk = true, reported = "drug", misses = 0)
        assertTrue(foreign.plan.notifyDropped)
        assertFalse(foreign.giveBackSilence)
        val flying = LeaseRound.evaluate(CaptureOrder.Armed("klic", true), CaptureOrder.Armed("klic", true), pingOk = false, reported = null, misses = 0)
        assertFalse(flying.giveBackSilence)
        assertFalse(CaptureOrder.lease(null, "klic", startInFlight = true).stop)
        assertTrue(CaptureOrder.lease("klic", null, startInFlight = false).notifyDropped)
    }

    @Test
    fun `sto krogov lupina ne dela je ena objava`() {
        var state = ShellNotice.State(false, 0)
        val first = ShellNotice.next(paired = true, up = false, state = state)
        assertFalse(first.publish)
        
        var posts = 0
        var cancels = 0
        state = first.state
        repeat(99) {
            val next = ShellNotice.next(paired = true, up = false, state = state)
            if (next.publish) posts += 1
            if (next.cancel) cancels += 1
            state = next.state
        }
        assertEquals(1, posts)
        assertEquals(0, cancels)
        assertTrue(state.armed)
        val back = ShellNotice.next(paired = true, up = true, state = state)
        assertFalse(back.publish)
        assertTrue(back.cancel)
        assertFalse(back.state.armed)
        assertFalse(ShellNotice.next(paired = false, up = false, state = ShellNotice.State(false, 0)).publish)
    }

    @Test
    fun `tihi poslusalec po treh BUSY pozabi vrata`() {
        val fake = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val hold = CountDownLatch(1)
        val thread = Thread {
            while (!fake.isClosed) {
                val sock = runCatching { fake.accept() }.getOrNull() ?: break
                Thread {
                    hold.await(8, TimeUnit.SECONDS)
                    runCatching { sock.close() }
                }.also { it.isDaemon = true }.start()
            }
        }
        thread.isDaemon = true
        thread.start()
        try {
            assertEquals(BusyStreak.StepAction.RETRY, BusyStreak.action(0, ShellHandshake.Probe.BUSY).second)
            var seen = 0
            var action = BusyStreak.StepAction.RETRY
            var probes = 0
            while (probes < 6 && action == BusyStreak.StepAction.RETRY) {
                val trip = ShellClientProtocol.roundTrip(
                    fake.localPort,
                    config.token,
                    """{"op":"ping"}""",
                    timeoutMs = 300,
                )
                val probe = ShellProbe.fromTrip(trip, versionMatches = true, configMatches = true)
                assertEquals(ShellHandshake.Probe.BUSY, probe, trip.toString())
                val decided = BusyStreak.action(seen, probe)
                seen = decided.first
                action = decided.second
                probes += 1
            }
            assertEquals(BusyStreak.StepAction.FORGET, action)
            assertEquals(3, probes)
            val steps = LaunchSteps.sequence(
                ShellHandshake.Probe.BUSY,
                paired = true,
                detachedPort = fake.localPort,
                busySeen = 2,
            )
            assertTrue(steps.contains(LaunchSteps.Step.EXIT_AND_FORGET))
            assertEquals(BusyStreak.StepAction.USE, BusyStreak.action(2, ShellHandshake.Probe.OURS).second)
        } finally {
            hold.countDown()
            runCatching { fake.close() }
            thread.join(1_000)
        }
    }

    @Test
    fun `wss naslov zahteva gostitelja`() {
        assertFalse(GatewayUrl.accept("wss://", "token"))
        assertFalse(GatewayUrl.accept("wss:// a", "token"))
        assertFalse(GatewayUrl.accept("wss://[", "token"))
        assertFalse(GatewayUrl.accept("wss://:443/v1", "token"))
        assertFalse(GatewayUrl.accept("ws://example.com/v1/device-channel", "token"))
        assertFalse(GatewayUrl.accept("", "token"))
        assertTrue(GatewayUrl.accept("wss://example.com/v1/device-channel", "token"))
        assertTrue(GatewayUrl.accept("wss://127.0.0.1:8787/v1/device-channel", "token"))
    }

    @Test
    fun `izhod iz ozadja ki ne uspe ne trdi da je klic na slusalki`() {
        val failed = AudioDrop.outcome(callPresent = true, exitOk = false)
        assertEquals("audio_not_returned", failed.message)
        assertTrue(failed.warn)
        val ok = AudioDrop.outcome(callPresent = true, exitOk = true)
        assertEquals("audio_returned", ok.message)
        assertTrue(ok.warn)
        val notPresent = AudioDrop.outcome(callPresent = false, exitOk = false)
        assertEquals("audio_not_returned", notPresent.message)
        assertTrue(notPresent.warn)
    }

    @Test
    fun `ArmSlot ne raztrga expected in startInFlight`() {
        val slot = ArmSlot()
        val errors = AtomicInteger()
        val start = CountDownLatch(1)
        val threads = (0 until 8).map { n ->
            Thread {
                start.await()
                repeat(1_500) {
                    if (n % 2 == 0) {
                        slot.set(CaptureOrder.beforeStart("klic"))
                        slot.set(CaptureOrder.afterStart("klic", keep = true))
                        slot.set(CaptureOrder.afterStart("klic", keep = false))
                    } else {
                        val view = slot.get()
                        val valid = (view.expected == "klic" && view.startInFlight) ||
                            (view.expected == "klic" && !view.startInFlight) ||
                            (view.expected == null && !view.startInFlight)
                        if (!valid) errors.incrementAndGet()
                    }
                }
            }
        }
        threads.forEach { it.start() }
        start.countDown()
        threads.forEach { it.join() }
        assertEquals(0, errors.get())
    }

    @Test
    fun `odjemalec ne poslje ukaza ki vsebuje zeton`() {
        val command = """{"op":"ping","n":"${config.token}"}"""
        assertFalse(ShellAuth.requestCarriesSecrets(command))
        assertTrue(command.contains(config.token))
        val captured = StringBuilder()
        val fake = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            val sock = runCatching { fake.accept() }.getOrNull() ?: return@Thread
            runCatching { recordCommand(fake.localPort, sock, captured) }
            runCatching { sock.close() }
        }
        thread.isDaemon = true
        thread.start()
        try {
            val result = ShellClientProtocol.roundTrip(fake.localPort, config.token, command, timeoutMs = 1_000)
            assertTrue(result is ShellClientProtocol.RoundTrip.Rejected, result.toString())
            assertFalse(captured.contains(config.token), captured.toString())
        } finally {
            fake.close()
            thread.join(1_000)
        }
    }

    @Test
    fun `ukaz s konfiguracijo ne pride v onCommand`() {
        val raw = """{"op":"ping","n":"${config.deviceToken}"}"""
        assertFalse(ShellAuth.requestCarriesSecrets(raw))
        val calls = AtomicInteger()
        val endpoint = ShellEndpoint(config) { _, _ ->
            calls.incrementAndGet()
            """{"ok":true,"marker":"DOVOLJENO"}"""
        }
        try {
            val reply = commandReply(endpoint.port, raw)
            assertEquals(0, calls.get())
            assertTrue(reply == null || !reply.contains("DOVOLJENO"), reply ?: "")
            assertTrue(reply == null || !reply.contains(config.deviceToken), reply ?: "")
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `odjemalcev writeLine ne poslje cez 512`() {
        val out = ByteArrayOutputStream()
        val writer = out.bufferedWriter(Charsets.UTF_8)
        ShellClientProtocol.writeLine(writer, "q".repeat(ShellAuth.MAX_LINE_BYTES + 1))
        assertEquals(0, out.size())
        ShellClientProtocol.writeLine(writer, "ping")
        assertTrue(out.toString(Charsets.UTF_8).startsWith("ping"))
    }

    @Test
    fun `SecretCompare presteje vse bajte tudi ob razliki na zacetku`() {
        val before = SecretCompare.compares.get()
        var seen = 0
        val same = SecretCompare.equals("aaaa-skrivnost", "Xaaa-skrivnost") { left, right ->
            assertEquals(32, left.size)
            assertEquals(32, right.size)
            var equal = true
            for (i in left.indices) {
                seen += 1
                if (left[i] != right[i]) equal = false
            }
            equal
        }
        assertFalse(same)
        assertEquals(32, seen)
        assertTrue(SecretCompare.compares.get() > before)
        seen = 0
        assertTrue(SecretCompare.equals("isto-besedilo-123", "isto-besedilo-123") { left, right ->
            var equal = true
            for (i in left.indices) {
                seen += 1
                if (left[i] != right[i]) equal = false
            }
            equal
        })
        assertEquals(32, seen)
    }

    @Test
    fun `prazen pozdrav je Busy ne Rejected`() {
        assertTrue(helloThen("\n") is ShellClientProtocol.RoundTrip.Busy)
        assertTrue(helloThen("") is ShellClientProtocol.RoundTrip.Busy)
        assertTrue(helloThen(null) is ShellClientProtocol.RoundTrip.Busy)
        assertTrue(helloThen("OL1 ${"ab".repeat(32)}\n") is ShellClientProtocol.RoundTrip.Rejected)
    }

    @Test
    fun `release odsteje samo enkrat`() {
        val endpoint = ShellEndpoint(config) { _, _ -> """{"ok":true}""" }
        try {
            val result = ShellClientProtocol.roundTrip(endpoint.port, config.token, """{"op":"ping"}""")
            assertTrue(result is ShellClientProtocol.RoundTrip.Ok, result.toString())
            assertEquals(0, awaitInFlight(endpoint))
            val held = mutableListOf<Socket>()
            repeat(ShellAuth.MAX_CONNECTIONS) {
                val sock = Socket()
                sock.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), endpoint.port), 1_000)
                held += sock
            }
            Thread.sleep(150)
            val extra = Socket()
            extra.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), endpoint.port), 1_000)
            Thread.sleep(200)
            held.forEach { runCatching { it.close() } }
            runCatching { extra.close() }
            val again = ShellClientProtocol.roundTrip(endpoint.port, config.token, """{"op":"ping"}""")
            assertTrue(again is ShellClientProtocol.RoundTrip.Ok, again.toString())
            assertEquals(0, awaitInFlight(endpoint))
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `ne-loopback vrstnik ne dobi ukaza`() {
        assertFalse(shellPeerAllowed(null))
        assertFalse(shellPeerAllowed(InetAddress.getByName("8.8.8.8")))
        assertTrue(shellPeerAllowed(InetAddress.getByName("127.0.0.1")))
        val calls = AtomicInteger()
        val blocked = ShellEndpoint(config, peerAllowed = { false }) { _, _ ->
            calls.incrementAndGet()
            """{"ok":true,"marker":"DOVOLJENO"}"""
        }
        try {
            val result = ShellClientProtocol.roundTrip(blocked.port, config.token, """{"op":"ping"}""", timeoutMs = 1_000)
            assertFalse(result is ShellClientProtocol.RoundTrip.Ok, result.toString())
            assertEquals(0, calls.get())
        } finally {
            blocked.close()
        }
    }

    @Test
    fun `ShellCrashGuard ne mece naprej`() {
        val swallowing = ShellCrashGuard.handler { throw IllegalStateException("dnevnik") }
        swallowing.uncaughtException(Thread.currentThread(), IllegalStateException("boom"))
        val logged = mutableListOf<Throwable>()
        val handler = ShellCrashGuard.handler { logged += it }
        handler.uncaughtException(Thread.currentThread(), IllegalStateException("boom"))
        assertEquals(1, logged.size)
        assertEquals("boom", logged[0].message)
    }

    @Test
    fun `overjena povezava prezivi poplavo`() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val endpoint = ShellEndpoint(config) { _, _ ->
            started.countDown()
            assertTrue(release.await(8, TimeUnit.SECONDS))
            """{"ok":true,"marker":"DRZI"}"""
        }
        val result = AtomicReference<ShellClientProtocol.RoundTrip>()
        val client = Thread {
            result.set(ShellClientProtocol.roundTrip(endpoint.port, config.token, """{"op":"ping"}""", timeoutMs = 8_000))
        }
        client.isDaemon = true
        client.start()
        val flood = mutableListOf<Socket>()
        try {
            assertTrue(started.await(3, TimeUnit.SECONDS))
            repeat(64) {
                val sock = Socket()
                runCatching {
                    sock.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), endpoint.port), 500)
                    flood += sock
                }
            }
            Thread.sleep(400)
            release.countDown()
            client.join(5_000)
            val trip = result.get()
            assertTrue(trip is ShellClientProtocol.RoundTrip.Ok, trip.toString())
            assertTrue(trip.body.contains("DRZI"))
        } finally {
            release.countDown()
            flood.forEach { runCatching { it.close() } }
            endpoint.close()
            client.join(1_000)
        }
    }

    @Test
    fun `nonce se po 64 naslednikih lahko ponovi prej ne`() {
        val endpoint = ShellEndpoint(config) { _, _ -> """{"ok":true,"marker":"DOVOLJENO"}""" }
        try {
            val first = nonce(0)
            assertTrue(pingWithNonce(endpoint.port, first))
            repeat(63) { index ->
                assertTrue(pingWithNonce(endpoint.port, nonce(index + 1)), "index=$index")
            }
            assertFalse(pingWithNonce(endpoint.port, first))
            assertTrue(pingWithNonce(endpoint.port, nonce(64)))
            assertTrue(pingWithNonce(endpoint.port, first))
        } finally {
            endpoint.close()
        }
    }

    @Test
    @Timeout(60, unit = TimeUnit.SECONDS)
    fun `roundTrip ob OL2 in RST 200-krat ne vrze`() {
        repeat(200) { attempt ->
            val result = roundTripAfterHelloThenRst()
            assertTrue(result is ShellClientProtocol.RoundTrip.Busy, "poskus $attempt -> $result")
        }
    }

    @Test
    fun `cakanje na izhod procesa ni fiksnih 200 ms`() {
        var slept = 0L
        assertTrue(ShellCleanup.waitUntilDown(answers = { false }, sleep = { slept += it }, now = { 0L }))
        assertEquals(0L, slept)
        var now = 0L
        val downAt = 250L
        val stopped = ShellCleanup.waitUntilDown(
            answers = { now < downAt },
            sleep = { delay -> now += delay },
            now = { now },
            deadlineMs = 2_000,
        )
        assertTrue(stopped)
        assertTrue(now >= downAt, "now=$now")
        assertTrue(now < 2_000, "now=$now")
        now = 0L
        val stuck = ShellCleanup.waitUntilDown(
            answers = { true },
            sleep = { delay -> now += delay },
            now = { now },
            deadlineMs = 200,
        )
        assertFalse(stuck)
        assertTrue(now >= 200)
    }

    @Test
    fun `FifoCleanup pocaka na EOF`() {
        var now = 0L
        val done = FifoCleanup.awaitExit(
            poll = { if (now >= 300) -1 else 0 },
            sleep = { delay -> now += delay },
            now = { now },
            deadlineMs = 2_000,
        )
        assertTrue(done)
        assertTrue(now >= 300)
        now = 0L
        val hung = FifoCleanup.awaitExit(
            poll = { 0 },
            sleep = { delay -> now += delay },
            now = { now },
            deadlineMs = 120,
        )
        assertFalse(hung)
        assertTrue(now >= 120)
    }

    private fun nonce(index: Int): String = "n%03d".format(index) + "a".repeat(29)

    private fun awaitInFlight(endpoint: ShellEndpoint): Int {
        val deadline = System.currentTimeMillis() + 2_000
        var left = endpoint.connectionsInFlight()
        while (System.currentTimeMillis() < deadline && left != 0) {
            if (left < 0) return left
            Thread.sleep(15)
            left = endpoint.connectionsInFlight()
        }
        return left
    }

    private fun helloThen(hello: String?): ShellClientProtocol.RoundTrip {
        val fake = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            val sock = runCatching { fake.accept() }.getOrNull() ?: return@Thread
            if (hello != null && hello.isNotEmpty()) {
                sock.getOutputStream().write(hello.toByteArray())
                sock.getOutputStream().flush()
            }
            Thread.sleep(400)
            runCatching { sock.close() }
        }
        thread.isDaemon = true
        thread.start()
        return try {
            ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""", timeoutMs = 800)
        } finally {
            runCatching { fake.close() }
            thread.join(1_000)
        }
    }

    private fun roundTripAfterHelloThenRst(): ShellClientProtocol.RoundTrip {
        val fake = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            val sock = runCatching { fake.accept() }.getOrNull() ?: return@Thread
            sock.soTimeout = 2_000
            val out = sock.getOutputStream()
            out.write("OL2 ${"cd".repeat(32)}\n".toByteArray())
            out.flush()
            runCatching { sock.getInputStream().bufferedReader().readLine() }
            sock.setSoLinger(true, 0)
            runCatching { sock.close() }
        }
        thread.isDaemon = true
        thread.start()
        return try {
            ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""", timeoutMs = 2_000)
        } finally {
            runCatching { fake.close() }
            thread.join(2_000)
        }
    }

    private fun recordCommand(port: Int, sock: Socket, captured: StringBuilder) {
        sock.soTimeout = 1_000
        val input = sock.getInputStream()
        val writer = sock.getOutputStream().bufferedWriter()
        val serverNonce = "cd".repeat(32)
        writer.write("OL2 $serverNonce")
        writer.newLine()
        writer.flush()
        val reader = input.bufferedReader()
        val clientLine = runCatching { reader.readLine() }.getOrNull() ?: return
        val clientNonce = ShellAuth.clientNonceOf(clientLine) ?: return
        writer.write(ShellAuth.serverLine(config.token, serverNonce, clientNonce, port))
        writer.newLine()
        writer.flush()
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

    private fun pingWithNonce(port: Int, clientNonce: String): Boolean {
        val sock = Socket()
        sock.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 1_000)
        sock.soTimeout = 2_000
        sock.use {
            val reader = it.getInputStream().bufferedReader()
            val writer = it.getOutputStream().bufferedWriter()
            val hello = reader.readLine() ?: return false
            val proof = ShellAuth.clientProof(config.token, hello, port, clientNonce) ?: return false
            writer.write(proof.line)
            writer.newLine()
            writer.flush()
            val server = reader.readLine() ?: return false
            if (!ShellAuth.acceptServer(config.token, proof.serverNonce, proof.clientNonce, server, port)) return false
            writer.write("""{"op":"ping"}""")
            writer.newLine()
            writer.flush()
            val body = reader.readLine() ?: return false
            return body.contains("DOVOLJENO")
        }
    }
}
