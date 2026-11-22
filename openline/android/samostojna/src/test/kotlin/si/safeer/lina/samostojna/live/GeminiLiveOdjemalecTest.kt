package si.safeer.lina.samostojna.live

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import si.safeer.lina.samostojna.DnevnikKlicev
import si.safeer.lina.samostojna.GoogleZeton
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.ShranjevalnikKljuca
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import java.io.InputStream
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

class LazniWs(val port: Int) {
    var running = AtomicBoolean(true)
    var serverSocket: ServerSocket? = null
    var zadnjeSporocilo: String? = null
    var prejetih = AtomicInteger(0)
    var clientSocket: Socket? = null

    fun start() {
        serverSocket = ServerSocket(port)
        thread {
            try {
                while (running.get()) {
                    val client = serverSocket!!.accept()
                    clientSocket = client
                    thread { handleClient(client) }
                }
            } catch (e: Exception) {}
        }
    }

    private fun handleClient(client: Socket) {
        val input = client.getInputStream()
        val output = client.getOutputStream()
        var key = ""
        while (true) {
            val l = readLine(input)
            if (l == "\r\n" || l.isEmpty()) break
            if (l.startsWith("Sec-WebSocket-Key: ", ignoreCase = true)) {
                key = l.substring(19).trim()
            }
        }
        val magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        val acceptStr = key + magic
        val sha1 = MessageDigest.getInstance("SHA-1").digest(acceptStr.toByteArray())
        val acceptKey = Base64.getEncoder().encodeToString(sha1)

        val resp = "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: $acceptKey\r\n\r\n"
        output.write(resp.toByteArray())
        output.flush()

        while (running.get()) {
            val b0 = input.read()
            if (b0 == -1) break
            val b1 = input.read()
            var len = b1 and 0x7F
            if (len == 126) len = (input.read() shl 8) or input.read()
            else if (len == 127) { for(i in 0..7) input.read() }
            
            val mask = ByteArray(4)
            input.read(mask)
            val payload = ByteArray(len)
            var read = 0
            while(read < len) {
                val r = input.read(payload, read, len - read)
                if (r == -1) break
                read += r
            }
            for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
            
            zadnjeSporocilo = String(payload)
            prejetih.incrementAndGet()
        }
    }

    fun poslji(text: String) {
        clientSocket?.getOutputStream()?.let { out ->
            val payload = text.toByteArray()
            out.write(0x81)
            if (payload.size < 126) {
                out.write(payload.size)
            } else {
                out.write(126)
                out.write((payload.size shr 8) and 0xFF)
                out.write(payload.size and 0xFF)
            }
            out.write(payload)
            out.flush()
        }
    }

    private fun readLine(input: InputStream): String {
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b == -1) break
            sb.append(b.toChar())
            if (sb.endsWith("\r\n")) return sb.toString()
        }
        return sb.toString()
    }

    fun stop() {
        running.set(false)
        serverSocket?.close()
        clientSocket?.close()
    }
}

class GeminiLiveOdjemalecTest {
    private lateinit var strezhnik: LazniWs
    private lateinit var odjemalec: GeminiLiveOdjemalec
    private val dnevnik = DnevnikKlicev(si.safeer.lina.samostojna.PomnilniskaShramba())

    @BeforeEach
    fun setup() {
        val s = ServerSocket(0)
        val port = s.localPort
        s.close()
        strezhnik = LazniWs(port)
        strezhnik.start()

        val shramba = object : ShranjevalnikKljuca {
            override fun shrani(kljuc: KljucGemini) {}
            override fun preberi(): KljucGemini = KljucGemini("test-kljuc-ne-kazi")
            override fun izbrisi() {}
        }
        val zeton = GoogleZeton { "test-zeton" }
        odjemalec = GeminiLiveOdjemalec(
            osnovniUrlApi = "ws://127.0.0.1:$port",
            osnovniUrlVertex = "ws://127.0.0.1:$port",
            apiKljuc = shramba,
            googleZeton = zeton,
            projekt = { "test-projekt" },
            dnevnik = dnevnik,
            izbiraPoti = IzbiraPotiLive(naVoljo = { it == PotLive.API_KLJUC }),
            wsFabrika = JavaNetWsFabrika()
        )
    }

    @AfterEach
    fun teardown() {
        strezhnik.stop()
        odjemalec.konecKlica()
    }

    @Test
    fun `uspesna povezava setup in zvok`() {
        var receiveCount = 0
        odjemalec.nastaviIzhod { 
            receiveCount++
        }
        
        // vKlic vzpostavi povezavo in poslje prvi chunk
        odjemalec.vKlic(ByteArray(640))
        Thread.sleep(500)
        
        // strezhnik vrne setupComplete
        strezhnik.poslji("""{"setupComplete":{}}""")
        Thread.sleep(200)

        // Lastnik 22. 11. 2026 (klic ob 10.39, dva pozdrava): po setupComplete gre modelu SAMO uvod; zvok klicatelja sele po pozdravu.
        val uvod = strezhnik.zadnjeSporocilo!!
        assertTrue(uvod.contains("realtimeInput"))
        assertTrue(uvod.contains("Lina se predstavi."))
        odjemalec.vKlic(ByteArray(640))
        Thread.sleep(100)
        assertTrue(strezhnik.zadnjeSporocilo!!.contains("Lina se predstavi."), "med pozdravom zvok klicatelja ne gre modelu")
        strezhnik.poslji("""{"serverContent":{"turnComplete":true}}""")
        Thread.sleep(200)
        odjemalec.vKlic(ByteArray(640))
        Thread.sleep(200)
        val zadnje = strezhnik.zadnjeSporocilo!!
        assertTrue(zadnje.contains("realtimeInput"))
        assertTrue(zadnje.contains("audio/pcm"))

        // test izhod: strezhnik poslje base64 audio
        val audioBytes = ByteArray(1200) // 24kHz = 1200, resampled to 16kHz = 800
        val b64 = Base64.getEncoder().encodeToString(audioBytes)
        strezhnik.poslji("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"data":"$b64"}}]}}}""")
        Thread.sleep(200)
        
        assertTrue(receiveCount > 0)
        assertTrue(dnevnik.seznam().none { it.povzetek.contains("test-kljuc-ne-kazi") })
    }

    @Test
    fun `prekinitev ob interrupted`() {
        var interrupted = false
        odjemalec.naPrekinitev = { interrupted = true }
        odjemalec.vKlic(ByteArray(640))
        Thread.sleep(200)
        
        strezhnik.poslji("""{"serverContent":{"interrupted":true}}""")
        Thread.sleep(200)
        
        assertTrue(interrupted)
    }

    @Test
    fun `pocisti ne poslje sporocila modelu`() {
        odjemalec.vKlic(ByteArray(640))
        Thread.sleep(200)
        val initialPrejetih = strezhnik.prejetih.get()
        
        odjemalec.pocisti()
        Thread.sleep(200)
        
        assertEquals(initialPrejetih, strezhnik.prejetih.get())
    }

    @Test
    fun `pravilna sestava url glav in setup sporocila`() {
        var prejetUrl = ""
        val prejeteGlave = mutableMapOf<String, String>()
        var poslanoBesedilo = ""
        
        val fabrika = object : WsFabrika {
            override fun odpri(url: String, glave: Map<String, String>, poslusalec: WsPoslusalec): WsPovezava {
                prejetUrl = url
                prejeteGlave.putAll(glave)
                val pov = object : WsPovezava {
                    override fun posiljiBesedilo(besedilo: String) { 
                        if (besedilo.contains("\"setup\":") || besedilo.contains("\"config\":")) {
                            poslanoBesedilo = besedilo 
                        }
                    }
                    override fun zapri(koda: Int, razlog: String) {
                        poslusalec.onClose(koda, razlog)
                    }
                }
                poslusalec.onOpen(pov)
                // sprozi izjemo, da preverimo skrivanje v dnevniku
                poslusalec.onError(RuntimeException("Connection failed: wss://test?key=skrivni-kljuc&other=1"))
                
                // test onClose call
                poslusalec.onClose(1000, "Normal closure key=skrivni-kljuc-zaprto")
                
                return pov
            }
        }
        
        val shramba = object : ShranjevalnikKljuca {
            override fun shrani(kljuc: KljucGemini) {}
            override fun preberi(): KljucGemini = KljucGemini("skrivni-kljuc-api")
            override fun izbrisi() {}
        }
        val dnevnik = DnevnikKlicev(si.safeer.lina.samostojna.PomnilniskaShramba())
        val odj = GeminiLiveOdjemalec(
            apiKljuc = shramba,
            googleZeton = GoogleZeton { "skrivni-zeton-vertex" },
            projekt = { "moj-projekt" },
            dnevnik = dnevnik,
            izbiraPoti = IzbiraPotiLive(naVoljo = { it == PotLive.VERTEX }), // Testiramo vertex
            wsFabrika = fabrika
        )
        
        odj.vKlic(ByteArray(0))
        
        // 1. Preverimo Vertex URL in glave
        assertTrue(prejetUrl.contains("us-central1-aiplatform.googleapis.com"))
        assertEquals("Bearer skrivni-zeton-vertex", prejeteGlave["Authorization"])
        
        // 2. Preverimo Setup
        assertTrue(poslanoBesedilo.contains("\"setup\":"))
        assertTrue(poslanoBesedilo.contains("publishers/google/models/gemini-3.8-live"))
        assertTrue(poslanoBesedilo.contains("projects/moj-projekt/locations/us-central1/publishers/google/models/gemini-3.8-live"))
        
        // 3. Noben niz nima \$ (dobesedni znak $ v izhodnem JSON/URL)
        assertTrue(!prejetUrl.contains("$") && !prejetUrl.contains("\\$"), prejetUrl)
        assertTrue(!poslanoBesedilo.contains("$") && !poslanoBesedilo.contains("\\$"), poslanoBesedilo)
        
        // 4. Preverimo skrivanje v dnevniku
        val vnosi = dnevnik.seznam()
        val zadnji = vnosi.lastOrNull()?.povzetek ?: "prazno"
        assertTrue(vnosi.any { it.povzetek.contains("SKRITO") }, "Ne vsebuje SKRITO, zadnji povzetek: $zadnji")
        assertTrue(vnosi.none { it.povzetek.contains("skrivni-zeton") || it.povzetek.contains("skrivni-kljuc") })
        
        // 5. Preverimo da je onClose zapisal kodo in razlog in maskiral
        assertTrue(vnosi.any { it.povzetek.contains("Zaprto (koda 1000)") && it.povzetek.contains("SKRITO") })
    }

    @Test
    fun `pravilna sestava url za api kljuc`() {
        var prejetUrl = ""
        val fabrika = object : WsFabrika {
            override fun odpri(url: String, glave: Map<String, String>, poslusalec: WsPoslusalec): WsPovezava {
                prejetUrl = url
                return object : WsPovezava {
                    override fun posiljiBesedilo(besedilo: String) {}
                    override fun zapri(koda: Int, razlog: String) {}
                }
            }
        }
        val shramba = object : ShranjevalnikKljuca {
            override fun shrani(kljuc: KljucGemini) {}
            override fun preberi(): KljucGemini = KljucGemini("moj-kljuc")
            override fun izbrisi() {}
        }
        val odj = GeminiLiveOdjemalec(
            osnovniUrlApi = "wss://generativelanguage.googleapis.com",
            apiKljuc = shramba,
            googleZeton = GoogleZeton { "z" },
            projekt = { "p" },
            dnevnik = dnevnik,
            izbiraPoti = IzbiraPotiLive(naVoljo = { it == PotLive.API_KLJUC }),
            wsFabrika = fabrika
        )
        odj.vKlic(ByteArray(0))
        assertEquals("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=moj-kljuc", prejetUrl)
    }

    @Test
    fun `obdelaj vec avdio delov v enem sporocilu`() {
        var receiveCount = 0
        odjemalec.nastaviIzhod { 
            receiveCount++
        }
        odjemalec.vKlic(ByteArray(640))
        Thread.sleep(200)
        strezhnik.poslji("""{"setupComplete":{}}""")
        Thread.sleep(200)

        // Dva avdio dela
        val audioBytes = ByteArray(1200) // 24kHz = 1200, resampled to 16kHz = 800 (1 okvir 640, 1 padded)
        val b64 = Base64.getEncoder().encodeToString(audioBytes)
        strezhnik.poslji("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"data":"$b64"}}, {"inlineData":{"data":"$b64"}}]}}}""")
        Thread.sleep(200)
        
        // 2 dela po 800 B (16 kHz) = 1600 B -> 2 polna okvira, 320 B ostane v medpomnilniku do turnComplete
        assertEquals(2, receiveCount)
    }

    @Test
    fun `zdruzitev nepopolnih okvirjev`() {
        val rezultati = mutableListOf<ByteArray>()
        odjemalec.nastaviIzhod { chunk ->
            rezultati.add(chunk)
        }
        odjemalec.vKlic(ByteArray(640))
        Thread.sleep(200)
        strezhnik.poslji("""{"setupComplete":{}}""")
        Thread.sleep(200)
        
        // 480 B (24 kHz) -> 320 B (16 kHz).
        // 2 taksna okvirja dasta skupaj 640 B, kar pomeni en celoten okvir 16 kHz brez paddinga.
        val audioBytes = ByteArray(480) 
        val b64 = Base64.getEncoder().encodeToString(audioBytes)
        
        strezhnik.poslji("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"data":"$b64"}}]}}}""")
        Thread.sleep(100)
        assertEquals(0, rezultati.size, "Prvi del ne sme sproziti izhoda, ker je premajhen (320 B)")
        
        strezhnik.poslji("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"data":"$b64"}}]}}}""")
        Thread.sleep(100)
        assertEquals(1, rezultati.size, "Po drugem delu moramo dobiti tocno en poln okvir")
        assertEquals(640, rezultati[0].size)
    }

    /** Lazna povezava: belezi poslano, test sam sprozi sporocila streznika. */
    private class LaznaFabrika : WsFabrika {
        val poslano = java.util.concurrent.CopyOnWriteArrayList<String>()
        @Volatile var poslusalec: WsPoslusalec? = null
        var odprtij = 0
        override fun odpri(url: String, glave: Map<String, String>, poslusalec: WsPoslusalec): WsPovezava {
            odprtij++
            val pov = object : WsPovezava {
                override fun posiljiBesedilo(besedilo: String) { poslano.add(besedilo) }
                override fun zapri(koda: Int, razlog: String) {}
            }
            this.poslusalec = poslusalec
            poslusalec.onOpen(pov)
            return pov
        }
    }

    private fun odjemalecZ(fabrika: WsFabrika) = GeminiLiveOdjemalec(
        apiKljuc = object : ShranjevalnikKljuca {
            override fun shrani(k: KljucGemini) {}
            override fun preberi() = KljucGemini("k")
            override fun izbrisi() {}
        },
        googleZeton = GoogleZeton { "z" },
        projekt = { "p" },
        dnevnik = dnevnik,
        izbiraPoti = IzbiraPotiLive(naVoljo = { it == PotLive.VERTEX }),
        wsFabrika = fabrika
    )

    // Lastnik 22. 11. 2026: »ko se telefon oglasi, se mora Lina takoj oglasiti«.
    @Test
    fun `predpriprava ob dvigu - seja nared pred zvokom, uvod sele z zvocno potjo in samo enkrat`() {
        val f = LaznaFabrika()
        val odj = odjemalecZ(f)
        odj.pripraviKlic()
        Thread.sleep(300)
        assertEquals(1, f.odprtij)
        f.poslusalec!!.onText("""{"setupComplete":{}}""")
        assertTrue(f.poslano.none { it.contains("Lina se predstavi.") }, "uvod ne sme iti, dokler zvocna pot ni nared")
        odj.nastaviIzhod { }
        assertEquals(1, f.odprtij, "nastaviIzhod ohrani predpripravljeno sejo")
        assertEquals(1, f.poslano.count { it.contains("Lina se predstavi.") })
        // Med pozdravom zvok klicatelja ne gre modelu; po turnComplete gre.
        repeat(5) { odj.vKlic(ByteArray(640)) }
        assertEquals(0, f.poslano.count { it.contains("audio/pcm") })
        f.poslusalec!!.onText("""{"serverContent":{"turnComplete":true}}""")
        odj.vKlic(ByteArray(640))
        assertEquals(1, f.poslano.count { it.contains("audio/pcm") })
        // Ponovni setupComplete ali nov okvir ne sprozi drugega pozdrava.
        f.poslusalec!!.onText("""{"setupComplete":{}}""")
        assertEquals(1, f.poslano.count { it.contains("Lina se predstavi.") })
        odj.konecKlica()
    }

    @Test
    fun `brez predpriprave - nastaviIzhod zacne znova in uvod pride ob setupComplete`() {
        val f = LaznaFabrika()
        val odj = odjemalecZ(f)
        odj.nastaviIzhod { }
        odj.vKlic(ByteArray(640))
        assertEquals(1, f.odprtij)
        f.poslusalec!!.onText("""{"setupComplete":{}}""")
        assertEquals(1, f.poslano.count { it.contains("Lina se predstavi.") })
        // Nov klic brez predpriprave: stara seja se ne uporabi.
        odj.nastaviIzhod { }
        odj.vKlic(ByteArray(640))
        assertEquals(2, f.odprtij)
        odj.konecKlica()
    }

    @Test
    fun `vrsta okvirjev pred setupComplete in max velikost`() {
        val ujetaSporocila = mutableListOf<String>()
        val fabrika = object : WsFabrika {
            override fun odpri(url: String, glave: Map<String, String>, poslusalec: WsPoslusalec): WsPovezava {
                val pov = object : WsPovezava {
                    override fun posiljiBesedilo(besedilo: String) { 
                        ujetaSporocila.add(besedilo)
                    }
                    override fun zapri(koda: Int, razlog: String) {}
                }
                poslusalec.onOpen(pov)
                // simuliramo, da je model prejel okvirje po tem, ko poslusalec vrne pov
                thread {
                    Thread.sleep(500)
                    poslusalec.onText("""{"setupComplete":{}}""")
                }
                return pov
            }
        }
        val odj = GeminiLiveOdjemalec(
            apiKljuc = object : ShranjevalnikKljuca {
                override fun shrani(k: KljucGemini) {}
                override fun preberi() = KljucGemini("k")
                override fun izbrisi() {}
            },
            googleZeton = GoogleZeton { "z" },
            projekt = { "p" },
            dnevnik = dnevnik,
            izbiraPoti = IzbiraPotiLive(naVoljo = { it == PotLive.VERTEX }),
            wsFabrika = fabrika
        )
        
        for (i in 1..150) {
            odj.vKlic(ByteArray(640))
        }
        
        // pred setupComplete ni bilo poslano se nobeno avdio sporocilo
        assertTrue(ujetaSporocila.none { it.contains("audio/pcm") || it.contains("clientContent") })
        
        Thread.sleep(1000) // cakamo da nit klice setupComplete
        
        // Lastnik 22. 11. 2026: okvirji, zbrani pred pripravljeno sejo (sum pred pozdravom), se zavrzejo (prej: poslanih do 100).
        val poslanihAudio = ujetaSporocila.count { it.contains("audio/pcm") }
        assertEquals(0, poslanihAudio)
        
        // prav tako ne sme biti clientContent
        assertTrue(ujetaSporocila.none { it.contains("clientContent") })
    }
}
