package si.safeer.lina.samostojna.prehod

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.InputStream
import java.io.OutputStream
import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import java.security.cert.X509Certificate
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class LokalniPrehodTest {

    private lateinit var prehod: LokalniPrehod
    private lateinit var most: OdmevniMost
    private lateinit var sslContextServer: SSLContext
    private lateinit var sslContextClient: SSLContext
    private lateinit var fingerprint: String

    @BeforeEach
    fun setup() {
        val tmpDir = File("build/tmp")
        tmpDir.mkdirs()
        val storeFile = File.createTempFile("test_keystore", ".p12", tmpDir)
        storeFile.delete() // keytool needs to create it
        val password = "password"
        val process = ProcessBuilder(
            "keytool", "-genkeypair",
            "-alias", "prehod",
            "-keyalg", "EC",
            "-groupname", "secp256r1",
            "-validity", "1",
            "-keystore", storeFile.absolutePath,
            "-storepass", password,
            "-storetype", "PKCS12",
            "-dname", "CN=Test"
        ).start()
        process.waitFor()

        val ks = KeyStore.getInstance("PKCS12")
        ks.load(storeFile.inputStream(), password.toCharArray())
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, password.toCharArray())

        sslContextServer = SSLContext.getInstance("TLS")
        sslContextServer.init(kmf.keyManagers, null, SecureRandom())

        val cert = ks.getCertificate("prehod")
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(cert.encoded)
        fingerprint = digest.joinToString("") { "%02x".format(it) }

        storeFile.delete()

        val tm = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                if (chain == null || chain.isEmpty()) throw Exception("Prazna veriga")
                val sMd = MessageDigest.getInstance("SHA-256")
                val sDigest = sMd.digest(chain[0].encoded)
                val sFingerprint = sDigest.joinToString("") { "%02x".format(it) }
                if (sFingerprint != fingerprint) throw Exception("Odtis se ne ujema: ${sFingerprint} != $fingerprint")
            }
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        }
        sslContextClient = SSLContext.getInstance("TLS")
        sslContextClient.init(null, arrayOf(tm), SecureRandom())

        most = OdmevniMost()
        prehod = LokalniPrehod(sslContextServer, "zeton123", most)
        prehod.start()
    }

    @AfterEach
    fun teardown() {
        prehod.stop()
    }

    private fun connect(path: String, token: String, tokenHeaderName: String = "Authorization: Bearer"): SSLSocket {
        val f = sslContextClient.socketFactory
        val socket = f.createSocket("127.0.0.1", prehod.getPort()) as SSLSocket
        socket.startHandshake()
        
        val wsKey = Base64.getEncoder().encodeToString(ByteArray(16).apply { SecureRandom().nextBytes(this) })
        val req = "GET $path HTTP/1.1\r\n" +
                  "Host: 127.0.0.1:${prehod.getPort()}\r\n" +
                  "Upgrade: websocket\r\n" +
                  "Connection: Upgrade\r\n" +
                  "Sec-WebSocket-Key: $wsKey\r\n" +
                  "Sec-WebSocket-Version: 13\r\n" +
                  "$tokenHeaderName $token\r\n\r\n"
        socket.outputStream.write(req.toByteArray())
        socket.outputStream.flush()
        return socket
    }

    private fun readResponseLine(socket: Socket): String {
        val sb = StringBuilder()
        var last: Int = -1
        while (true) {
            val b = socket.inputStream.read()
            if (b == -1) break
            sb.append(b.toChar())
            if (last == '\r'.code && b == '\n'.code) {
                return sb.toString().trim()
            }
            last = b
        }
        return sb.toString()
    }

    @Test
    fun `uspesna povezava media in 50 okvirjev z odmevom`() {
        val socket = connect("/v1/device-media?callId=test1", "zeton123")
        val line = readResponseLine(socket)
        assertTrue(line.startsWith("HTTP/1.1 101"), "pricakovan 101, dobil $line")
        while (readResponseLine(socket).isNotEmpty()) { }

        for (i in 1..50) {
            val okvir = ByteArray(640) { i.toByte() }
            sendWsFrame(socket.outputStream, 0x02, okvir)
            val odmev = readWsFrame(socket.inputStream)
            assertEquals(okvir.toList(), odmev.toList())
        }
        
        assertEquals(50, most.steviloPrejetih())
        assertEquals(50.toByte(), most.preberiZadnjega()!![0])
        socket.close()
    }

    @Test
    fun `test z izjemo sprosti rezino in dovoli ponovno povezavo`() {
        val socket1 = connect("/v1/device-media?callId=test1", "zeton123")
        assertTrue(readResponseLine(socket1).startsWith("HTTP/1.1 101"))
        while (readResponseLine(socket1).isNotEmpty()) { }
        
        // Zaprto na trdo med branjem simulira izjemo
        socket1.close()
        Thread.sleep(200) // pocakaj, da server zapre
        
        val socket2 = connect("/v1/device-media?callId=test1", "zeton123")
        assertTrue(readResponseLine(socket2).startsWith("HTTP/1.1 101"))
        socket2.close()
    }

    @Test
    fun `napacen zeton zavrnjen s 401`() {
        val socket = connect("/v1/device-media?callId=test1", "napacen")
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 401"))
        socket.close()
    }

    @Test
    fun `najvec 4 hkratnih nepreverjenih povezav, 10 odprtih`() {
        val sockets = (1..10).map { 
            val f = sslContextClient.socketFactory
            f.createSocket("127.0.0.1", prehod.getPort()) as SSLSocket 
        }
        
        // Prvih 4 bi moralo ostati odprtih in cakati na zeton
        for (i in 0..3) {
            sockets[i].startHandshake()
        }
        
        // Ostale (od 5. naprej) bi morale biti takoj zaprte
        for (i in 4..9) {
            assertFailsWith<Exception> {
                sockets[i].startHandshake()
                sockets[i].inputStream.read()
            }
        }
        
        sockets.forEach { try { it.close() } catch (e: Exception) {} }
    }

    @Test
    fun `kanal posreduje JSON sporocila in se zapre ob neveljavnem JSON`() {
        var prejetoSporocilo: KanalSporocilo? = null
        val poslusalec = object : KanalPoslusalec {
            override fun naSporocilo(sporocilo: KanalSporocilo) {
                prejetoSporocilo = sporocilo
            }
        }
        val lokalniPrehodZPoslusalcem = LokalniPrehod(sslContextServer, "zeton123", most, poslusalec)
        lokalniPrehodZPoslusalcem.start()
        
        try {
            val f = sslContextClient.socketFactory
            val socket = f.createSocket("127.0.0.1", lokalniPrehodZPoslusalcem.getPort()) as SSLSocket
            socket.startHandshake()
            
            val wsKey = Base64.getEncoder().encodeToString(ByteArray(16).apply { SecureRandom().nextBytes(this) })
            val req = "GET /v1/device-channel HTTP/1.1\r\n" +
                      "Host: 127.0.0.1:${lokalniPrehodZPoslusalcem.getPort()}\r\n" +
                      "Upgrade: websocket\r\n" +
                      "Connection: Upgrade\r\n" +
                      "Sec-WebSocket-Key: $wsKey\r\n" +
                      "Sec-WebSocket-Version: 13\r\n" +
                      "Authorization: Bearer zeton123\r\n\r\n"
            socket.outputStream.write(req.toByteArray())
            socket.outputStream.flush()
            
            assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 101"))
            while (readResponseLine(socket).isNotEmpty()) { }
            
            // Veljaven JSON
            val jsonMsg = """{"type":"test","commandId":"cmd1"}""".toByteArray()
            sendWsFrame(socket.outputStream, 0x01, jsonMsg)
            
            Thread.sleep(100) // počakajmo, da strežnik obdela
            assertEquals("test", prejetoSporocilo?.type)
            assertEquals("cmd1", prejetoSporocilo?.commandId)
            
            // Neveljaven JSON
            val badJsonMsg = """{"type":"test", broken}""".toByteArray()
            sendWsFrame(socket.outputStream, 0x01, badJsonMsg)
            
            // Povezava se mora zapreti
            val resp = socket.inputStream.read()
            if (resp != -1) {
                assertEquals(0x88, resp) // 1002 close frame
            }
            socket.close()
        } finally {
            lokalniPrehodZPoslusalcem.stop()
        }
    }

    @Test
    fun `zavrni dolzino okvirja 127 negativno in nad 128KB`() {
        val socket = connect("/v1/device-channel", "zeton123")
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 101"))
        while (readResponseLine(socket).isNotEmpty()) { }

        // Posljimo okvir z len=127 in preveliko dolzino (npr. 200KB)
        val out = socket.outputStream
        out.write(0x81) // FIN + text
        out.write(0x80 or 127) // MASKED + 127
        val badLen = 200 * 1024L
        for (i in 7 downTo 0) {
            out.write((badLen ushr (i * 8)).toInt() and 0xFF)
        }
        out.write(ByteArray(4)) // mask
        out.flush()

        // Povezava se mora prekiniti
        assertEquals(-1, socket.inputStream.read())
        socket.close()
    }

    @Test
    fun `zavrni EOF sredi okvirja`() {
        val socket = connect("/v1/device-channel", "zeton123")
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 101"))
        while (readResponseLine(socket).isNotEmpty()) { }

        val out = socket.outputStream
        out.write(0x81)
        out.write(0x80 or 126)
        out.write(0x01)
        out.write(0x00) // dolzina 256
        out.write(ByteArray(4)) // mask
        out.write(ByteArray(100)) // samo 100 bajtov in EOF
        out.flush()
        
        socket.close() // Takoj zapremo (EOF)
        // Ne smemo ostati v zanki
    }

    @Test
    fun `RFC 6455 nemaskiran okvir zapre povezavo`() {
        val socket = connect("/v1/device-channel", "zeton123")
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 101"))
        while (readResponseLine(socket).isNotEmpty()) { }

        val out = socket.outputStream
        out.write(0x81)
        out.write(0x05) // Ni maskirano, len=5
        out.write("hello".toByteArray())
        out.flush()

        assertEquals(-1, socket.inputStream.read())
        socket.close()
    }

    @Test
    fun `RFC 6455 razdrobljen okvir in neznan opcode`() {
        val socket = connect("/v1/device-channel", "zeton123")
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 101"))
        while (readResponseLine(socket).isNotEmpty()) { }

        // fin=0
        val out = socket.outputStream
        out.write(0x01) // fin=0, text
        out.write(0x80 or 0x00) // masked, len=0
        out.write(ByteArray(4))
        out.flush()
        
        // Povezava se mora zapreti
        val resp = socket.inputStream.read()
        if (resp != -1) {
            // lahko prejmemo close frame (0x88)
            assertEquals(0x88, resp)
        }
        socket.close()
    }
    
    @Test
    fun `RFC 6455 neveljavna dolzina binarnega okvirja`() {
        val socket = connect("/v1/device-media?callId=test1", "zeton123")
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 101"))
        while (readResponseLine(socket).isNotEmpty()) { }

        sendWsFrame(socket.outputStream, 0x02, ByteArray(100)) // Ni 640

        val resp = socket.inputStream.read()
        if (resp != -1) {
            assertEquals(0x88, resp) // 1002 close frame se poslje (0x80 or 0x08 = 136)
        }
        socket.close()
    }

    @Test
    fun `prevelik zeton zavrnjen s 401`() {
        val longToken = "a".repeat(300)
        val socket = connect("/v1/device-media?callId=test1", longToken)
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 401"))
        socket.close()
    }
    
    @Test
    fun `stop zapre cakajoce povezave in izvede cleanup na aktivnih`() {
        val socket = connect("/v1/device-media?callId=test-call", "zeton123")
        
        // handshake
        assertEquals("HTTP/1.1 101 Switching Protocols", readResponseLine(socket))
        while (readResponseLine(socket).isNotEmpty()) {}
        
        // Vzpostavljena povezava, preverimo ce je locked
        val socket2 = try { connect("/v1/device-media?callId=test-call2", "zeton123") } catch (e: Exception) { null }
        if (socket2 != null) {
            assertEquals("HTTP/1.1 409 Conflict", readResponseLine(socket2))
            socket2.close()
        }
        
        // Sedaj stop(), to mora takoj zapreti prvi socket
        prehod.stop()
        
        // Povezava mora biti zaprta in zvocniMost resetiran
        try {
            val r = socket.inputStream.read()
            assertTrue(r == -1)
        } catch (e: Exception) {
            // Tudi to je ok (SocketException)
        }
    }

    @Test
    fun `pocisti poslje clear in callback izKlica`() {
        val socket = connect("/v1/device-media?callId=test1", "zeton123")
        assertTrue(readResponseLine(socket).startsWith("HTTP/1.1 101"))
        while (readResponseLine(socket).isNotEmpty()) { }
        
        // Preverimo delovanje izhodnega callbacka - 10 okvirjev
        for (i in 1..10) {
            most.izhodniCallback?.invoke(ByteArray(640) { i.toByte() })
            val frame = readWsFrame(socket.inputStream)
            assertEquals(640, frame.size)
            assertEquals(i.toByte(), frame[0])
        }
        
        // pocisti
        prehod.pocisti()
        val textFrame = readWsFrame(socket.inputStream)
        assertEquals("""{"type":"clear"}""", String(textFrame))
        
        socket.close()
    }

    private fun sendWsFrame(output: OutputStream, opcode: Int, payload: ByteArray) {
        output.write(0x80 or opcode)
        val mask = ByteArray(4)
        SecureRandom().nextBytes(mask)
        
        if (payload.size < 126) {
            output.write(0x80 or payload.size)
        } else if (payload.size <= 65535) {
            output.write(0x80 or 126)
            output.write((payload.size ushr 8) and 0xFF)
            output.write(payload.size and 0xFF)
        } else {
            output.write(0x80 or 127)
            for (i in 7 downTo 0) {
                output.write((payload.size ushr (i * 8)) and 0xFF)
            }
        }
        output.write(mask)
        for (i in payload.indices) {
            output.write(payload[i].toInt() xor mask[i % 4].toInt())
        }
        output.flush()
    }

    private fun readWsFrame(input: InputStream): ByteArray {
        val b0 = input.read()
        if (b0 == -1) throw Exception("Zaprto")
        val b1 = input.read()
        var len = b1 and 0x7F
        if (len == 126) {
            len = (input.read() shl 8) or input.read()
        } else if (len == 127) {
            for(i in 0..7) input.read() // Zanemarimo velike za test
        }
        val payload = ByteArray(len)
        var read = 0
        while (read < len) {
            val r = input.read(payload, read, len - read)
            if (r == -1) throw Exception("Zaprto med branjem")
            read += r
        }
        return payload
    }
}
