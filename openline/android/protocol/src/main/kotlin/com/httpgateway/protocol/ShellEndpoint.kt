package com.httpgateway.protocol

import java.io.BufferedWriter
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicInteger

/** Vrstnik mora biti loopback. Null in javni naslov se zavrneta. */
internal fun shellPeerAllowed(address: InetAddress?): Boolean = address?.isLoopbackAddress == true

/**
 * Nadzor lupine po TCP samo na 127.0.0.1.
 * Abstraktna vticnica na zalogi Android pade: SELinux zavrne connectto
 * iz untrusted_app na shell. UID vrstnika na TCP ni, zato je vrata
 * obojestranski HMAC, vezan tudi na stevilko vrat. Tuj proces, ki vrata
 * zasede ali ponovi stari zapis, ne dobi zetona, mediaUrl, odtisa ali
 * zetona naprave. Zaklepa po napakah ni: veljaven HMAC vedno pride skozi,
 * sicer tuj program z INTERNET ustavi confirm sredi klica.
 *
 * Neoverjena povezava drzi mesto le do dokaza (~300 ms). Ob polni zasedbi
 * se zapre najstarejsa se neoverjena, da prava aplikacija pride skozi.
 * RST in prekinjena povezava ostaneta v tej niti.
 */
class ShellEndpoint(
    private val config: ShellAuth.LaunchConfig,
    private val nonces: () -> String = { ShellAuth.nonce() },
    private val peerAllowed: (InetAddress?) -> Boolean = ::shellPeerAllowed,
    private val onCommand: (op: Map<String, String>, raw: String) -> String,
) : AutoCloseable {
    val socket: ServerSocket = ServerSocket()
    val port: Int
    private val seenClientNonces = Collections.synchronizedSet(LinkedHashSet<String>())
    private val inFlight = AtomicInteger(0)
    private val unverified = ConcurrentLinkedDeque<Held>()
    private val thread: Thread

    init {
        val loopback = InetAddress.getByName("127.0.0.1")
        check(loopback.isLoopbackAddress)
        socket.reuseAddress = false
        socket.bind(InetSocketAddress(loopback, 0))
        check(socket.inetAddress.isLoopbackAddress) { "lupina mora vezati samo loopback" }
        port = socket.localPort
        thread = Thread({ acceptLoop() }, "shell-control").apply { isDaemon = true; start() }
    }

    fun portLine(): String = ShellAuth.portLine(port)

    /** Stevilo zasedenih mest. Preizkus pade, ce release odsteje dvakrat. */
    internal fun connectionsInFlight(): Int = inFlight.get()

    private fun acceptLoop() {
        while (!socket.isClosed) {
            val client = try {
                socket.accept()
            } catch (_: Exception) {
                break
            }
            val held = reserve(client) ?: continue
            Thread({ serve(held) }, "shell-conn").apply { isDaemon = true }.start()
        }
    }

    /**
     * Mesto se steje pred nitjo. Ce so vsa polna, se zapre najstarejsa
     * se neoverjena povezava. Ze dokazana se ne zapre. Sprosti se natanko enkrat.
     */
    private fun reserve(client: Socket): Held? {
        val held = Held(client)
        repeat(64) {
            val n = inFlight.get()
            if (n < ShellAuth.MAX_CONNECTIONS && inFlight.compareAndSet(n, n + 1)) {
                unverified.addLast(held)
                return held
            }
            val victim = pollUnverified()
            if (victim == null) {
                if (inFlight.get() >= ShellAuth.MAX_CONNECTIONS) {
                    runCatching { client.close() }
                    return null
                }
                Thread.yield()
                return@repeat
            }
            if (victim.releaseIfUnverified(inFlight)) {
                runCatching { victim.socket.close() }
            }
        }
        runCatching { client.close() }
        return null
    }

    private fun pollUnverified(): Held? {
        while (true) {
            val victim = unverified.pollFirst() ?: return null
            if (victim.isHolding()) return victim
        }
    }

    private fun serve(held: Held) {
        val sock = held.socket
        try {
            if (!peerAllowed(sock.inetAddress)) return
            val proofDeadline = System.currentTimeMillis() + ShellAuth.PROOF_TIMEOUT_MS
            val input = sock.getInputStream()
            val writer = sock.getOutputStream().bufferedWriter()
            fun readUntil(deadline: Long) =
                ShellIo.readLine(input, ShellAuth.MAX_LINE_BYTES, deadline) { sock.soTimeout = it }
            val serverNonce = nonces()
            writeLine(writer, ShellAuth.serverHello(serverNonce))
            val clientLine = readUntil(proofDeadline)
            val clientNonce = ShellAuth.clientNonceOf(clientLine)
            val fresh = clientNonce != null && rememberNonce(clientNonce)
            if (clientNonce == null || !fresh || !ShellAuth.acceptClient(config.token, serverNonce, clientLine, port)) {
                return
            }
            if (!held.markVerified()) return
            unverified.remove(held)
            writeLine(writer, ShellAuth.serverLine(config.token, serverNonce, clientNonce, port))
            val commandDeadline = System.currentTimeMillis() + ShellAuth.HANDSHAKE_TIMEOUT_MS
            val raw = readUntil(commandDeadline) ?: return
            if (ShellAuth.requestCarriesSecrets(raw) || carriesConfig(raw)) return
            val op = ShellAuth.parseOp(raw) ?: run {
                writeLine(writer, """{"ok":false,"error":"zavrnjeno"}""")
                return
            }
            val reply = runCatching { onCommand(op, raw) }
                .getOrElse { """{"ok":false,"error":"zavrnjeno"}""" }
            if (carriesConfig(reply)) return
            writeLine(writer, reply)
        } catch (_: Exception) {
            // RST, zaprtje ob izselitvi, prekinjen tok. Nit ne sme umreti neujeta.
        } finally {
            unverified.remove(held)
            held.release(inFlight)
            runCatching { sock.close() }
        }
    }

    private fun carriesConfig(text: String): Boolean =
        listOf(config.token, config.deviceToken, config.certSha256, config.mediaUrl, config.deviceId)
            .any { it.length >= 8 && text.contains(it) }

    private fun rememberNonce(nonce: String): Boolean {
        synchronized(seenClientNonces) {
            if (!seenClientNonces.add(nonce)) return false
            while (seenClientNonces.size > 64) {
                val first = seenClientNonces.first()
                seenClientNonces.remove(first)
            }
            return true
        }
    }

    private fun writeLine(writer: BufferedWriter, line: String) {
        if (line.length > ShellAuth.MAX_LINE_BYTES) return
        writer.write(line)
        writer.newLine()
        writer.flush()
    }

    override fun close() {
        runCatching { socket.close() }
        thread.interrupt()
    }

    private class Held(val socket: Socket) {
        private val state = AtomicInteger(HOLDING)

        fun isHolding(): Boolean = state.get() == HOLDING

        fun markVerified(): Boolean = state.compareAndSet(HOLDING, VERIFIED)

        /** Izselitev samo, ce dokaz se ni prispel. Drugi klic ne odsteje se enkrat. */
        fun releaseIfUnverified(inFlight: AtomicInteger): Boolean {
            if (!state.compareAndSet(HOLDING, RELEASED)) return false
            inFlight.decrementAndGet()
            return true
        }

        fun release(inFlight: AtomicInteger) {
            val prev = state.getAndSet(RELEASED)
            if (prev != RELEASED) inFlight.decrementAndGet()
        }

        private companion object {
            const val HOLDING = 0
            const val VERIFIED = 1
            const val RELEASED = 2
        }
    }
}

/**
 * Odjemalec nadzora. Zeton ne gre na zico. Napacen HMAC ali staticni
 * pozdrav ustavi izmenjavo, se preden bi sel ukaz. Skupni rok in najvec
 * 8 hkratnih povezav veljata tudi tukaj. IOException ni met izjeme navzven:
 * rok, zasedenost in prekinitev so Busy, ne Rejected (tuj HMAC).
 */
object ShellClientProtocol {
    private val slots = Semaphore(ShellAuth.MAX_CONNECTIONS)

    fun exchange(port: Int, token: String, command: String, timeoutMs: Int = ShellAuth.HANDSHAKE_TIMEOUT_MS): String? =
        when (val result = roundTrip(port, token, command, timeoutMs)) {
            is RoundTrip.Ok -> result.body
            else -> null
        }

    fun classify(e: Exception): RoundTrip = when (e) {
        is java.net.ConnectException -> RoundTrip.Absent
        else -> RoundTrip.Busy
    }

    fun roundTrip(port: Int, token: String, command: String, timeoutMs: Int = ShellAuth.HANDSHAKE_TIMEOUT_MS): RoundTrip {
        if (command.length > ShellAuth.MAX_LINE_BYTES) return RoundTrip.Rejected
        if (ShellAuth.requestCarriesSecrets(command) || command.contains(token)) return RoundTrip.Rejected
        if (!slots.tryAcquire()) return RoundTrip.Busy
        val socket = Socket()
        try {
            val deadline = System.currentTimeMillis() + timeoutMs
            try {
                val connectWait = (deadline - System.currentTimeMillis()).toInt().coerceAtLeast(1)
                socket.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), connectWait)
            } catch (e: Exception) {
                runCatching { socket.close() }
                return classify(e)
            }
            try {
                socket.use { sock ->
                    if (sock.inetAddress?.isLoopbackAddress != true) return RoundTrip.Rejected
                    val input = sock.getInputStream()
                    val writer = sock.getOutputStream().bufferedWriter()
                    fun read() = ShellIo.readLine(input, ShellAuth.MAX_LINE_BYTES, deadline) { sock.soTimeout = it }
                    val hello = read()
                    // Prazen pozdrav je tisina, ne tuj HMAC. Rejected bi lupino ubil.
                    if (hello.isNullOrBlank()) return RoundTrip.Busy
                    val proof = ShellAuth.clientProof(token, hello, port) ?: return RoundTrip.Rejected
                    writeLine(writer, proof.line)
                    val reply = read() ?: return RoundTrip.Busy
                    if (!ShellAuth.acceptServer(token, proof.serverNonce, proof.clientNonce, reply, port)) {
                        return RoundTrip.Rejected
                    }
                    writeLine(writer, command)
                    val body = read() ?: return RoundTrip.Busy
                    return RoundTrip.Ok(body)
                }
            } catch (_: Exception) {
                return RoundTrip.Busy
            }
        } finally {
            slots.release()
            runCatching { if (!socket.isClosed) socket.close() }
        }
    }

    internal fun writeLine(writer: BufferedWriter, line: String) {
        if (line.length > ShellAuth.MAX_LINE_BYTES) return
        writer.write(line)
        writer.newLine()
        writer.flush()
    }

    sealed interface RoundTrip {
        data object Absent : RoundTrip
        /** Napacen HMAC ali staticni pozdrav. To je tuj proces na vratih. */
        data object Rejected : RoundTrip
        /** Rok, zasedenost ali prekinjen tok. To ni tuj proces in lupine ne ubije. */
        data object Busy : RoundTrip
        data class Ok(val body: String) : RoundTrip
    }
}

/** Neujeta izjema v procesu lupine se samo zapise. Proces se zaradi nje ne ubije sam. */
object ShellCrashGuard {
    fun handler(log: (Throwable) -> Unit): Thread.UncaughtExceptionHandler =
        Thread.UncaughtExceptionHandler { _, throwable ->
            runCatching { log(throwable) }
        }
}
