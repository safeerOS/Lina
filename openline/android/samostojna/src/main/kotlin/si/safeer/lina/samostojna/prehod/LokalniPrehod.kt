package si.safeer.lina.samostojna.prehod

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocketFactory
import kotlin.concurrent.thread
import kotlin.experimental.xor

interface PotrdiloDobavitelj {
    fun pridobiSSLContext(): Pair<SSLContext, String>
}

interface ZvocniMost {
    fun vKlic(okvir: ByteArray)
    fun nastaviIzhod(posljiOkvir: (ByteArray) -> Unit)
    fun pocisti()
    fun konecKlica()
}

@Serializable
data class KanalSporocilo(
    val type: String,
    val commandId: String? = null,
    val callId: String? = null,
    val action: String? = null,
    val eventId: String? = null,
    val event: String? = null,
    val timestamp: String? = null
)

interface KanalPoslusalec {
    fun naSporocilo(sporocilo: KanalSporocilo)
}

/** Preprosta implementacija za test. */
class OdmevniMost : ZvocniMost {
    private var prejeto = 0
    private var zadnjiOkvir: ByteArray? = null
    var izhodniCallback: ((ByteArray) -> Unit)? = null

    override fun vKlic(okvir: ByteArray) {
        prejeto++
        zadnjiOkvir = okvir
    }

    override fun nastaviIzhod(posljiOkvir: (ByteArray) -> Unit) {
        izhodniCallback = posljiOkvir
    }
    
    override fun pocisti() {}

    fun preberiZadnjega(): ByteArray? = zadnjiOkvir
    fun steviloPrejetih(): Int = prejeto

    override fun konecKlica() {}
}

class LokalniPrehod(
    private val sslContext: SSLContext,
    private val zetonNaprave: String,
    private val zvocniMost: ZvocniMost,
    private val kanalPoslusalec: KanalPoslusalec? = null
) {
    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private var port: Int = 0
    
    private val channelConnection = AtomicReference<Socket>(null)
    private val mediaConnection = AtomicReference<Socket>(null)
    private val allSockets = Collections.newSetFromMap(ConcurrentHashMap<Socket, Boolean>())
    private var activeCallId: String? = null
    private val unauthenticatedCount = AtomicInteger(0)

    private val cleanups = ConcurrentHashMap<Socket, () -> Unit>()

    fun start() {
        if (!running.compareAndSet(false, true)) return

        val serverSocketFactory: SSLServerSocketFactory = sslContext.serverSocketFactory
        val socket = serverSocketFactory.createServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        this.serverSocket = socket
        this.port = socket.localPort

        thread(name = "LokalniPrehod-Accept") {
            try {
                while (running.get()) {
                    val client = socket.accept()
                    allSockets.add(client)
                    val count = unauthenticatedCount.incrementAndGet()
                    if (count > 4) {
                        try { client.close() } catch (_: Exception) {}
                        unauthenticatedCount.decrementAndGet()
                        continue
                    }
                    thread(name = "LokalniPrehod-Client") {
                        try {
                            client.soTimeout = 5000
                            handleClient(client)
                        } finally {
                            unauthenticatedCount.decrementAndGet()
                        }
                    }
                }
            } catch (e: Exception) {
                // Ignore if closed
            }
        }
    }

    fun stop() {
        if (running.compareAndSet(true, false)) {
            try { serverSocket?.close() } catch (_: Exception) {}
            
            for (cleanup in cleanups.values) {
                cleanup()
            }
            cleanups.clear()

            val copy = allSockets.toTypedArray()
            for (socket in copy) {
                try { socket.close() } catch (_: Exception) {}
            }
            allSockets.clear()
        }
    }
    
    fun pocisti() {
        mediaConnection.get()?.let { socket ->
            try {
                sendFrame(socket.getOutputStream(), 0x01, """{"type":"clear"}""".toByteArray())
            } catch (e: Exception) {}
        }
    }

    fun getPort(): Int = port
    fun getAddress(): String = serverSocket?.inetAddress?.hostAddress ?: ""

    private fun handleClient(client: Socket) {
        try {
            val input = client.getInputStream()
            val output = client.getOutputStream()

            val request = readHttpRequest(input)
            if (request == null) {
                client.close()
                return
            }

            val lines = request.split("\r\n")
            val requestLine = lines[0].split(" ")
            if (requestLine.size < 3 || requestLine[0] != "GET") {
                client.close()
                return
            }
            val path = requestLine[1]

            var authHeader: String? = null
            var wsKey: String? = null
            for (i in 1 until lines.size) {
                val line = lines[i]
                if (line.startsWith("Authorization: Bearer ", ignoreCase = true)) {
                    authHeader = line.substring("Authorization: Bearer ".length).trim()
                } else if (line.startsWith("Sec-WebSocket-Key: ", ignoreCase = true)) {
                    wsKey = line.substring("Sec-WebSocket-Key: ".length).trim()
                }
            }

            if (authHeader == null || authHeader.length > 256) {
                sendHttpError(output, 401, "Unauthorized")
                client.close()
                return
            }
            
            val md = MessageDigest.getInstance("SHA-256")
            val authHash = md.digest(authHeader.toByteArray())
            val tokenHash = md.digest(zetonNaprave.toByteArray())
            
            if (!MessageDigest.isEqual(authHash, tokenHash)) {
                sendHttpError(output, 401, "Unauthorized")
                client.close()
                return
            }
            
            if (!running.get()) {
                client.close()
                return
            }

            if (wsKey == null) {
                sendHttpError(output, 400, "Bad Request")
                client.close()
                return
            }

            val isChannel = path == "/v1/device-channel"
            val isMedia = path.startsWith("/v1/device-media?callId=")
            
            if (!isChannel && !isMedia) {
                sendHttpError(output, 404, "Not Found")
                client.close()
                return
            }

            val currentRef = if (isChannel) channelConnection else mediaConnection
            if (!currentRef.compareAndSet(null, client)) {
                sendHttpError(output, 409, "Conflict")
                client.close()
                return
            }

            val cleanedUp = AtomicBoolean(false)
            val cleanup = {
                if (cleanedUp.compareAndSet(false, true)) {
                    if (isMedia) {
                        activeCallId = null
                        zvocniMost.konecKlica()
                        mediaConnection.compareAndSet(client, null)
                    } else {
                        channelConnection.compareAndSet(client, null)
                    }
                }
            }
            cleanups[client] = cleanup

            try {
                client.soTimeout = 30000

                if (isMedia) {
                    val callId = path.substringAfter("callId=")
                    if (activeCallId != null && activeCallId != callId) {
                        sendHttpError(output, 409, "Conflict Call")
                        client.close()
                        return
                    }
                    activeCallId = callId
                    zvocniMost.nastaviIzhod { bytes ->
                        try {
                            sendFrame(output, 0x02, bytes)
                        } catch (e: Exception) {}
                    }
                }

                sendWsHandshake(output, wsKey)
                readFrames(client, input, output, isChannel)
            } finally {
                cleanup()
                cleanups.remove(client)
            }
        } catch (e: Exception) {
            try { client.close() } catch (_: Exception) {}
        } finally {
            allSockets.remove(client)
        }
    }

    private fun readHttpRequest(input: InputStream): String? {
        val buffer = ByteArray(8192)
        var pos = 0
        while (pos < buffer.size) {
            val b = input.read()
            if (b == -1) return null
            buffer[pos++] = b.toByte()
            if (pos >= 4 && 
                buffer[pos - 4] == '\r'.code.toByte() && buffer[pos - 3] == '\n'.code.toByte() &&
                buffer[pos - 2] == '\r'.code.toByte() && buffer[pos - 1] == '\n'.code.toByte()) {
                return String(buffer, 0, pos)
            }
        }
        return null
    }

    private fun sendHttpError(output: OutputStream, code: Int, reason: String) {
        val msg = "HTTP/1.1 $code $reason\r\nConnection: close\r\n\r\n"
        output.write(msg.toByteArray())
        output.flush()
    }

    private fun sendWsHandshake(output: OutputStream, key: String) {
        val magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        val acceptStr = key + magic
        val sha1 = MessageDigest.getInstance("SHA-1").digest(acceptStr.toByteArray())
        val acceptKey = Base64.getEncoder().encodeToString(sha1)

        val response = "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: $acceptKey\r\n\r\n"
        output.write(response.toByteArray())
        output.flush()
    }

    private val jsonParser = Json { ignoreUnknownKeys = true }

    private fun readFrames(socket: Socket, input: InputStream, output: OutputStream, isChannel: Boolean) {
        while (true) {
            val b0 = input.read()
            if (b0 == -1) break
            val fin = (b0 and 0x80) != 0
            val opcode = b0 and 0x0F

            val b1 = input.read()
            if (b1 == -1) break
            val masked = (b1 and 0x80) != 0
            if (!masked) {
                socket.close()
                break
            }
            val payloadLen = b1 and 0x7F

            var len: Long = payloadLen.toLong()
            if (payloadLen == 126) {
                val b2 = input.read()
                val b3 = input.read()
                if (b2 == -1 || b3 == -1) { socket.close(); break }
                len = ((b2 shl 8) or b3).toLong()
            } else if (payloadLen == 127) {
                len = 0
                for (i in 0..7) {
                    val r = input.read()
                    if (r == -1) { socket.close(); break }
                    len = (len shl 8) or r.toLong()
                }
            }
            
            if (len < 0 || len > 128 * 1024) {
                socket.close()
                break
            }
            
            val isControl = opcode >= 0x08
            if (isControl && (!fin || len > 125)) {
                socket.close()
                break
            }
            
            if (!fin || opcode == 0) {
                sendFrame(output, 0x08, ByteArray(0))
                socket.close()
                break
            }
            
            if (opcode == 0x02 && !isChannel && len != 640L) {
                sendFrame(output, 0x08, ByteArray(0))
                socket.close()
                break
            }
            
            if (opcode != 0x01 && opcode != 0x02 && opcode != 0x08 && opcode != 0x09 && opcode != 0x0A) {
                sendFrame(output, 0x08, ByteArray(0))
                socket.close()
                break
            }

            val maskKey = ByteArray(4)
            var readMask = 0
            while (readMask < 4) {
                val r = input.read(maskKey, readMask, 4 - readMask)
                if (r == -1) { socket.close(); return }
                readMask += r
            }

            val payload = ByteArray(len.toInt())
            var readPayload = 0
            while (readPayload < len.toInt()) {
                val r = input.read(payload, readPayload, len.toInt() - readPayload)
                if (r == -1) { socket.close(); return }
                readPayload += r
            }

            for (i in payload.indices) {
                payload[i] = payload[i] xor maskKey[i % 4]
            }

            when (opcode) {
                0x01 -> {
                    if (isChannel) {
                        val text = String(payload)
                        try {
                            val msg = jsonParser.decodeFromString<KanalSporocilo>(text)
                            kanalPoslusalec?.naSporocilo(msg)
                        } catch (e: Exception) {
                            socket.close()
                            break
                        }
                    }
                }
                0x02 -> {
                    if (!isChannel) {
                        zvocniMost.vKlic(payload)
                        if (zvocniMost is OdmevniMost) {
                            sendFrame(output, 0x02, payload)
                        }
                    }
                }
                0x08 -> {
                    socket.close()
                    break
                }
                0x09 -> {
                    sendFrame(output, 0x0A, payload)
                }
                0x0A -> {
                }
            }
        }
    }

    private fun sendFrame(output: OutputStream, opcode: Int, payload: ByteArray) {
        synchronized(output) {
            output.write(0x80 or opcode)
            if (payload.size < 126) {
                output.write(payload.size)
            } else if (payload.size <= 65535) {
                output.write(126)
                output.write((payload.size ushr 8) and 0xFF)
                output.write(payload.size and 0xFF)
            } else {
                output.write(127)
                for (i in 7 downTo 0) {
                    output.write((payload.size ushr (i * 8)) and 0xFF)
                }
            }
            output.write(payload)
            output.flush()
        }
    }
}
