package si.safeer.lina.protocol

import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.Timeout

/**
 * Preizkusi, ki padejo, ce se produkcijska vrata odstrani:
 * rememberNonce, SecretCompare.equals, oznaka s, acceptServer, soTimeout,
 * requestCarriesSecrets, isAnnounced.
 */
@Timeout(20, unit = TimeUnit.SECONDS)
class Krog6AuditTest {
    private val config = ShellAuth.LaunchConfig(
        token = "streznik-zeton-samo-na-vhodu-123456",
        appUid = 10123,
        mediaUrl = "wss://127.0.0.1:8787/v1/device-media",
        certSha256 = "ef".repeat(32),
        deviceId = "naprava-dolga",
        deviceToken = "zeton-naprave-samo-ob-zagonu",
    )

    @Test
    fun `ponovitev istega odjemalcevega nonce ne odpre ukaza`() {
        val serverNonce = "ab".repeat(32)
        val calls = AtomicInteger(0)
        val endpoint = ShellEndpoint(config, nonces = { serverNonce }) { _, _ ->
            calls.incrementAndGet()
            """{"ok":true,"marker":"DOVOLJENO"}"""
        }
        try {
            val clientNonce = "cd".repeat(32)
            val proof = handshake(endpoint.port, clientNonce)
            Socket(InetAddress.getByName("127.0.0.1"), endpoint.port).use { sock ->
                sock.soTimeout = 1_000
                val reader = sock.getInputStream().bufferedReader()
                val writer = sock.getOutputStream().bufferedWriter()
                val hello = reader.readLine()
                assertEquals(ShellAuth.serverHello(serverNonce), hello)
                writer.write(proof)
                writer.newLine()
                writer.flush()
                val reply = runCatching { reader.readLine() }.getOrNull()
                val body = if (reply != null) runCatching {
                    writer.write("""{"op":"ping"}""")
                    writer.newLine()
                    writer.flush()
                    reader.readLine()
                }.getOrNull() else null
                assertTrue(reply == null || body == null || !body.contains("DOVOLJENO"))
            }
            assertEquals(1, calls.get())
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `rokovanje steje SecretCompare in ne enakost`() {
        val endpoint = ShellEndpoint(config) { _, _ -> """{"ok":true}""" }
        try {
            val before = SecretCompare.compares.get()
            val body = ShellClientProtocol.exchange(endpoint.port, config.token, """{"op":"ping"}""")
            assertNotNull(body)
            assertTrue(SecretCompare.compares.get() >= before + 2)
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `odsev oznake c ni dokaz lupine`() {
        val captured = captureAgainstFake(serverReply = { clientLine -> clientLine.substringAfter(' ') })
        assertFalse(captured.contains("ping"), captured)
        assertFalse(captured.contains(config.token), captured)
    }

    @Test
    fun `OL2 brez strezniskega HMAC ne dobi ukaza`() {
        val captured = captureAgainstFake(serverReply = { "ne-streznik" })
        assertFalse(captured.contains("ping"), captured)
        assertFalse(captured.contains(config.token), captured)
    }

    @Test
    fun `tisina na vratih ne visi`() {
        val fake = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            val sock = fake.accept()
            Thread.sleep(15_000)
            runCatching { sock.close() }
        }
        thread.isDaemon = true
        thread.start()
        try {
            val started = System.currentTimeMillis()
            val result = ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""", timeoutMs = 400)
            val elapsed = System.currentTimeMillis() - started
            assertTrue(
                result is ShellClientProtocol.RoundTrip.Busy ||
                    result is ShellClientProtocol.RoundTrip.Rejected ||
                    result is ShellClientProtocol.RoundTrip.Absent,
            )
            assertTrue(elapsed < 2_500, "elapsed=$elapsed")
        } finally {
            fake.close()
        }
    }

    @Test
    fun `po kapljicah skupni rok ne tece znova`() {
        val got = StringBuilder()
        val fake = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            val sock = fake.accept()
            sock.soTimeout = 4_000
            val out = sock.getOutputStream()
            out.write("OL2 ${"ab".repeat(32)}\n".toByteArray())
            out.flush()
            val reader = sock.getInputStream().bufferedReader()
            reader.readLine()
            val slow = "abcdef".toByteArray()
            for (b in slow) {
                Thread.sleep(250)
                out.write(byteArrayOf(b))
                out.flush()
            }
            Thread.sleep(250)
            out.write("\n".toByteArray())
            out.flush()
            val buf = ByteArray(200)
            val n = runCatching { sock.getInputStream().read(buf) }.getOrDefault(-1)
            if (n > 0) got.append(String(buf, 0, n))
            runCatching { sock.close() }
        }
        thread.isDaemon = true
        thread.start()
        try {
            val result = ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""", timeoutMs = 700)
            thread.join(4_000)
            assertTrue(
                result is ShellClientProtocol.RoundTrip.Busy ||
                    result is ShellClientProtocol.RoundTrip.Rejected ||
                    result is ShellClientProtocol.RoundTrip.Absent,
            )
            assertFalse(got.contains("ping"), got.toString())
        } finally {
            fake.close()
        }
    }

    @Test
    fun `ukaz s skrivnostjo ne pride do produkcijskega klica`() {
        val calls = AtomicInteger(0)
        val endpoint = ShellEndpoint(config) { _, _ ->
            calls.incrementAndGet()
            """{"ok":true,"marker":"DOVOLJENO"}"""
        }
        try {
            val evil = """{"op":"start","callId":"klic","mediaUrl":"wss://evil.example/x"}"""
            assertTrue(ShellAuth.requestCarriesSecrets(evil))
            sendCommand(endpoint.port, evil)
            Thread.sleep(150)
            assertEquals(0, calls.get())
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `vrstica daljsa od 512 B ne odpre ukaza`() {
        val calls = AtomicInteger(0)
        val endpoint = ShellEndpoint(config) { _, _ ->
            calls.incrementAndGet()
            """{"ok":true}"""
        }
        try {
            val huge = "x".repeat(ShellAuth.MAX_LINE_BYTES + 40)
            sendCommand(endpoint.port, huge)
            Thread.sleep(150)
            assertEquals(0, calls.get())
            assertTrue(
                ShellClientProtocol.roundTrip(endpoint.port, config.token, huge) is ShellClientProtocol.RoundTrip.Rejected,
            )
        } finally {
            endpoint.close()
        }
    }

    @Test
    fun `deveta hkratna povezava ne pride v ukaz`() {
        val calls = AtomicInteger(0)
        val entered = CountDownLatch(ShellAuth.MAX_CONNECTIONS)
        val hold = CountDownLatch(1)
        val endpoint = ShellEndpoint(config) { _, _ ->
            if (calls.incrementAndGet() <= ShellAuth.MAX_CONNECTIONS) entered.countDown()
            hold.await(4, TimeUnit.SECONDS)
            """{"ok":true}"""
        }
        val workers = mutableListOf<Thread>()
        try {
            repeat(ShellAuth.MAX_CONNECTIONS) {
                workers += Thread {
                    ShellClientProtocol.roundTrip(endpoint.port, config.token, """{"op":"ping"}""", timeoutMs = 4_000)
                }.also { it.start() }
            }
            assertTrue(entered.await(4, TimeUnit.SECONDS))
            val started = System.currentTimeMillis()
            val ninth = ShellClientProtocol.roundTrip(endpoint.port, config.token, """{"op":"ping"}""", timeoutMs = 1_000)
            val elapsed = System.currentTimeMillis() - started
            assertTrue(ninth is ShellClientProtocol.RoundTrip.Busy)
            assertTrue(elapsed < 500, "elapsed=$elapsed")
            assertEquals(ShellAuth.MAX_CONNECTIONS, calls.get())
            val raw = Socket(InetAddress.getByName("127.0.0.1"), endpoint.port)
            raw.soTimeout = 500
            raw.use {
                val line = runCatching { it.getInputStream().bufferedReader().readLine() }.getOrNull()
                assertNull(line)
            }
            assertEquals(ShellAuth.MAX_CONNECTIONS, calls.get())
        } finally {
            hold.countDown()
            workers.forEach { it.join(2_000) }
            endpoint.close()
        }
    }

    @Test
    fun `PORT 45 se ne prebere preden pride cela vrstica`() {
        assertNull(ShellAuth.portFromBuffer("PORT 45"))
        assertNull(ShellAuth.portFromBuffer("PORT 45|678"))
        assertNull(ShellAuth.portFromBuffer("PORT 45678"))
        assertEquals(45678, ShellAuth.portFromBuffer("PORT 45" + "678\n"))
        assertEquals(43111, ShellAuth.portFromBuffer("odmev\nPORT 43111\n"))
        assertNull(ShellAuth.portFromBuffer("odmev\nPORT 45"))
    }

    @Test
    fun `toString konfiguracije in cilja ne vsebuje zetona`() {
        assertFalse(config.toString().contains(config.token))
        assertFalse(config.toString().contains(config.deviceToken))
        assertFalse(config.toString().contains(config.mediaUrl))
        assertFalse(config.toString().contains(config.certSha256))
        val target = ShellAuth.targetForStart(config, "klic-1", """{"op":"start","callId":"klic-1"}""")
        assertNotNull(target)
        assertFalse(target.toString().contains(config.deviceToken))
        assertFalse(target.toString().contains(config.mediaUrl))
        assertFalse(target.toString().contains(config.certSha256))
        assertTrue(target.toString().contains("klic-1"))
    }

    @Test
    fun `vrata se pozabijo pred novim zetonom in se zapisejo skupaj`() {
        val began = ShellSessionWrite.beginRotation("n".repeat(32))
        assertEquals(-1, began.port)
        val committed = ShellSessionWrite.commit(began.token, 43111)
        assertEquals(began.token, committed.token)
        assertEquals(43111, committed.port)
        assertNotEquals(ShellAuth.clientLine(began.token, "ab".repeat(16), "cd".repeat(16), 1), ShellAuth.clientLine(began.token, "ab".repeat(16), "cd".repeat(16), 2))
    }

    @Test
    fun `zasedena in zastarela vrata zahtevajo novo lupino`() {
        assertEquals(ShellProbe.Next.RESTART, ShellProbe.next(ShellHandshake.Probe.OCCUPIED))
        assertEquals(ShellProbe.Next.RESTART, ShellProbe.next(ShellHandshake.Probe.STALE))
        assertEquals(ShellProbe.Next.RESTART, ShellProbe.next(ShellHandshake.Probe.ABSENT))
        assertEquals(ShellProbe.Next.USE, ShellProbe.next(ShellHandshake.Probe.OURS))
        val sig = ShellAuth.configSignature(7, config.mediaUrl, config.certSha256, config.deviceToken)
        val updated = ShellAuth.configSignature(8, config.mediaUrl, config.certSha256, config.deviceToken)
        val moved = ShellAuth.configSignature(7, "wss://drug.example/v1/device-media", config.certSha256, config.deviceToken)
        assertNotEquals(sig, updated)
        assertNotEquals(sig, moved)
        assertEquals(ShellHandshake.Probe.STALE, ShellProbe.classify(true, true, versionMatches = false, configMatches = true))
        assertEquals(ShellHandshake.Probe.STALE, ShellProbe.classify(true, true, versionMatches = true, configMatches = false))
        assertEquals(ShellHandshake.Probe.OURS, ShellProbe.classify(true, true, versionMatches = true, configMatches = true))
    }

    @Test
    fun `confirm samo za pricakovano sejo in stop ob tuji`() {
        assertFalse(ShellAuth.acceptConfirm(null, null))
        assertFalse(ShellAuth.acceptConfirm(null, "klic"))
        assertFalse(ShellAuth.acceptConfirm("klic", "drug"))
        assertTrue(ShellAuth.acceptConfirm("klic", "klic"))
        val idle = AudioPing.tick(null, null)
        assertNull(idle.confirmCallId)
        assertFalse(idle.stop)
        val foreign = AudioPing.tick(null, "tuj")
        assertNull(foreign.confirmCallId)
        assertTrue(foreign.stop)
        assertFalse(foreign.notifyDropped)
        val match = AudioPing.tick("klic", "klic")
        assertEquals("klic", match.confirmCallId)
        assertFalse(match.stop)
        val mismatch = AudioPing.tick("klic", "drug")
        assertNull(mismatch.confirmCallId)
        assertTrue(mismatch.stop)
        assertTrue(mismatch.notifyDropped)
    }

    @Test
    fun `TAKE brez pinga ali povezave je REFUSE`() {
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.allowTake(TakeoverVerdict.TAKE, freshPingOk = false, gatewayConnected = true))
        assertEquals(TakeoverVerdict.REFUSE, TakeoverPolicy.allowTake(TakeoverVerdict.TAKE, freshPingOk = true, gatewayConnected = false))
        assertEquals(TakeoverVerdict.TAKE, TakeoverPolicy.allowTake(TakeoverVerdict.TAKE, freshPingOk = true, gatewayConnected = true))
        assertEquals(TakeoverVerdict.WAIT, TakeoverPolicy.allowTake(TakeoverVerdict.WAIT, freshPingOk = false, gatewayConnected = false))
    }

    @Test
    fun `odhodni klic v sili steje tudi operaterja`() {
        assertTrue(EmergencyNote.record(outgoing = true, listedEmergency = false, carrierEmergency = true))
        assertTrue(EmergencyNote.record(outgoing = true, listedEmergency = true, carrierEmergency = false))
        assertFalse(EmergencyNote.record(outgoing = true, listedEmergency = false, carrierEmergency = false))
        assertFalse(EmergencyNote.record(outgoing = false, listedEmergency = false, carrierEmergency = true))
    }

    @Test
    fun `owned se ne potrdi ce je med answer uporabnik dvignil`() {
        val guard = LocalCallGuard()
        assertTrue(guard.beginAnswer("klic"))
        assertFalse(guard.finishAnswer("klic", success = true))
        assertFalse(guard.isOwned("klic"))
        guard.markManual("klic")
        assertFalse(guard.confirmOwnedOnActive("klic"))
        assertFalse(guard.isOwned("klic"))
    }

    @Test
    fun `najavljen klic brez owned se javi in zvonjenje ni uporabnikovo`() {
        val guard = LocalCallGuard()
        guard.announce("klic")
        assertTrue(guard.isAnnounced("klic"))
        assertFalse(guard.isOwned("klic"))
        assertTrue(CallLifecycle.emitRemoval(guard.isOwned("klic"), guard.isAnnounced("klic")))
        assertFalse(CallLifecycle.emitRemoval(owned = false, announced = false))
        assertTrue(CallLifecycle.publishWhileAnnounced(guard.isAnnounced("klic")))
        assertFalse(CallLifecycle.publishWhileAnnounced(false))
        assertFalse(
            CallCommandPolicy.isUserControlled(
                ownedByLina = false,
                manuallyAnswered = false,
                outgoing = false,
                phase = TakeoverPhase.RINGING,
                announced = true,
            ),
        )
        assertTrue(
            CallCommandPolicy.isUserControlled(
                ownedByLina = false,
                manuallyAnswered = false,
                outgoing = false,
                phase = TakeoverPhase.RINGING,
                announced = false,
            ),
        )
    }

    @Test
    fun `markManual pobrise cakajoco stevilko`() {
        val queue = PendingCallEvents()
        queue.add("klic", """{"callId":"klic","number":"+38640111222"}""")
        queue.add("drug", """{"callId":"drug","number":"+100"}""")
        queue.drop("klic")
        assertFalse(queue.encoded().any { it.contains("+38640111222") })
        assertEquals("""{"callId":"drug","number":"+100"}""", queue.peek())
    }

    @Test
    fun `surova koda ne ostane besedilo in Povezan je v obeh jezikih`() {
        assertEquals("didnt_work", FailureMessages.resourceName("Wireless debugging not reachable"))
        assertEquals("didnt_work", FailureMessages.resourceName("vrata so zasedena"))
        assertEquals("didnt_work", FailureMessages.resourceName(null))
        assertEquals("telecom_action_failed", FailureMessages.resourceName("telecom_action_failed"))
        assertEquals("audio_not_returned", FailureMessages.resourceName("audio_not_returned"))
        val sl = File("../app/src/main/res/values-sl/strings.xml").readText()
        val en = File("../app/src/main/res/values/strings.xml").readText()
        for (name in listOf(
            "telecom_action_failed",
            "shell_lost",
            "shell_still_running",
            "audio_not_returned",
            "wireless_unreachable",
            "secret_in_argv",
            "shell_did_not_start",
        )) {
            val slValue = stringValue(sl, name)
            val enValue = stringValue(en, name)
            assertNotEquals(name, slValue)
            assertNotEquals(name, enValue)
            assertTrue(slValue.any { it.isLetter() && it.code > 127 || slValue.contains(" ") })
        }
        assertTrue(AudioReturn.shouldWarn(exitFailed = true))
        assertFalse(AudioReturn.shouldWarn(exitFailed = false))
        assertTrue(ShellLoss.shouldNotify(wasServing = true, servesNow = false))
        assertFalse(ShellLoss.shouldNotify(wasServing = false, servesNow = false))
    }

    @Test
    fun `vrata seje in sporocila se preverijo z izvajanjem`() {
        assertNull(ShellAuth.portFromBuffer("PORT 45"))
        assertEquals(456, ShellAuth.portFromBuffer("odmev\nPORT 456\n"))
        val token = "z".repeat(24)
        val began = ShellSessionWrite.beginRotation(token)
        assertEquals(-1, began.port)
        assertFalse(began.toString().contains(token))
        val committed = ShellSessionWrite.commit(token, 43111)
        assertEquals(43111, committed.port)
        assertFalse(committed.toString().contains(token))
        assertEquals("didnt_work", FailureMessages.resourceName("Wireless debugging not reachable"))
        assertEquals("didnt_work", FailureMessages.resourceName("vrata so zasedena"))
        assertFalse(ShellAuth.argvHasSecret(listOf("sh", "start"), config))
        assertTrue(ShellAuth.argvHasSecret(listOf(config.token), config))
    }

    @Test
    fun `obvestilo povezave sledi stanju in ni vedno Povezan`() {
        assertEquals("connection_connected", ConnectionNotice.resourceName(true))
        assertEquals("connection_offline", ConnectionNotice.resourceName(false))
        assertNotEquals(ConnectionNotice.resourceName(true), ConnectionNotice.resourceName(false))
        val sl = File("../app/src/main/res/values-sl/strings.xml").readText()
        val en = File("../app/src/main/res/values/strings.xml").readText()
        assertEquals("Povezan", stringValue(sl, "connection_connected"))
        assertEquals("Ni povezave", stringValue(sl, "connection_offline"))
        assertEquals("Connected", stringValue(en, "connection_connected"))
        assertEquals("Not connected", stringValue(en, "connection_offline"))
    }

    @Test
    fun `hranjena skripta z print prenese zeton po vhodu ne po argv`() {
        val script = ShellStarter.heldScript(
            "/data/app/base.apk",
            "si.safeer.lina.shell.ShellServerMain",
            7,
            "httpgateway_shell",
        )
        assertFalse(script.contains("printf"))
        assertFalse(script.contains("stty"))
        assertFalse(script.contains("cgroup"))
        assertTrue(script.contains("print -r --"))
        val mksh = listOf("/usr/local/bin/mksh", "/bin/mksh", "/usr/bin/mksh").firstOrNull { File(it).canExecute() }
        val sh = listOf("/bin/sh", "/usr/bin/sh").firstOrNull { File(it).canExecute() }
        val shell = mksh ?: sh
        org.junit.jupiter.api.Assumptions.assumeTrue(shell != null) {
            "ni mksh ne sh; print se ne da izvesti"
        }
        val runnable = if (mksh != null) {
            script
        } else {
            val printFn = """
                print() {
                  while [ ${'$'}# -gt 0 ]; do
                    case "${'$'}1" in
                      -r|--|-n) shift ;;
                      *) break ;;
                    esac
                  done
                  printf '%s\n' "${'$'}1"
                }

            """.trimIndent() + "\n"
            val lines = script.lines()
            if (lines.firstOrNull()?.startsWith("#!") == true) {
                lines.first() + "\n" + printFn + lines.drop(1).joinToString("\n")
            } else {
                printFn + script
            }
        }
        val dir = Files.createTempDirectory("openline-script")
        val bin = dir.resolve("bin")
        Files.createDirectories(bin)
        val app = bin.resolve("app_process")
        Files.writeString(
            app,
            "#!/bin/sh\nprintf '%s\\n' \"\$@\" > \"${dir}/argv\"\ncat > \"${dir}/stdin\"\nexit 0\n",
        )
        app.toFile().setExecutable(true)
        val token = "TAJNI-ZETON-KI-NE-SME-V-ARGV-123456"
        val file = dir.resolve("start.sh")
        Files.writeString(file, runnable)
        val running = ProcessBuilder(checkNotNull(shell), file.toString())
            .redirectErrorStream(true)
            .apply { environment()["PATH"] = bin.toString() + ":" + (System.getenv("PATH") ?: "") }
            .start()
        val stdin = listOf(token, "10123", config.mediaUrl, config.certSha256, config.deviceId, config.deviceToken)
            .joinToString("\n", postfix = "\n")
        running.outputStream.write(stdin.toByteArray())
        running.outputStream.close()
        val out = running.inputStream.bufferedReader().readText()
        val code = running.waitFor()
        assertEquals(0, code, out)
        val argv = dir.resolve("argv").toFile().readText()
        val body = dir.resolve("stdin").toFile().readText()
        assertTrue(body.contains(token), body)
        assertFalse(argv.contains(token), argv)
        assertFalse(argv.contains(config.deviceToken), argv)
    }

    @Test
    fun `pkill ne potrdi konca ce ni KONEC`() {
        assertFalse(ShellCleanup.killAcknowledged(""))
        assertFalse(ShellCleanup.killAcknowledged("PORT 1"))
        assertTrue(ShellCleanup.killAcknowledged("KONEC\n"))
        assertFalse(ShellCleanup.wipeStopped(stillAnswersPing = true))
        assertTrue(ShellCleanup.wipeStopped(stillAnswersPing = false))
        assertTrue(ShellLaunchVerdict.skipDetachedAttempt("HOLD"))
        assertFalse(ShellLaunchVerdict.skipDetachedAttempt(null))
        assertFalse(ShellLaunchVerdict.skipDetachedAttempt("DETACHED"))
    }

    private fun handshake(port: Int, clientNonce: String): String {
        val sock = Socket(InetAddress.getByName("127.0.0.1"), port)
        sock.soTimeout = 2_000
        sock.use {
            val reader = it.getInputStream().bufferedReader()
            val writer = it.getOutputStream().bufferedWriter()
            val hello = reader.readLine()
            val proof = ShellAuth.clientProof(config.token, hello, port, clientNonce)!!
            writer.write(proof.line)
            writer.newLine()
            writer.flush()
            val server = reader.readLine()
            assertTrue(ShellAuth.acceptServer(config.token, proof.serverNonce, proof.clientNonce, server, port))
            writer.write("""{"op":"ping"}""")
            writer.newLine()
            writer.flush()
            val body = reader.readLine()
            assertNotNull(body)
            assertTrue(body.contains("DOVOLJENO"))
            return proof.line
        }
    }

    private fun sendCommand(port: Int, command: String) {
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
            runCatching { reader.readLine() }
        }
    }

    private fun captureAgainstFake(serverReply: (String) -> String): String {
        val captured = StringBuilder()
        val fake = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val thread = Thread {
            val sock = fake.accept()
            sock.soTimeout = 2_000
            sock.getOutputStream().write("OL2 ${"ef".repeat(32)}\n".toByteArray())
            sock.getOutputStream().flush()
            val reader = sock.getInputStream().bufferedReader()
            val clientLine = reader.readLine() ?: return@Thread
            val reply = serverReply(clientLine)
            sock.getOutputStream().write((reply + "\n").toByteArray())
            sock.getOutputStream().flush()
            val buf = ByteArray(400)
            val n = runCatching { sock.getInputStream().read(buf) }.getOrDefault(-1)
            if (n > 0) captured.append(String(buf, 0, n))
            runCatching { sock.close() }
        }
        thread.isDaemon = true
        thread.start()
        try {
            val result = ShellClientProtocol.roundTrip(fake.localPort, config.token, """{"op":"ping"}""")
            thread.join(3_000)
            assertTrue(result is ShellClientProtocol.RoundTrip.Rejected, result.toString())
            return captured.toString()
        } finally {
            fake.close()
        }
    }

    private fun stringValue(xml: String, name: String): String {
        val key = "name=\"$name\">"
        val at = xml.indexOf(key)
        assertTrue(at >= 0, name)
        return xml.substring(at + key.length).substringBefore('<')
    }
}
