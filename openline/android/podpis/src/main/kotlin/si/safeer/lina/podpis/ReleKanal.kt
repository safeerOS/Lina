package si.safeer.lina.podpis

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * En kanal releja do Line (protokol: ReleProtokol). [odpri] vrne vticnico do releja - privzeto TLS do link.safeer.si:443 s
 * sistemskimi korenskimi potrdili IN preverbo imena (HTTPS); [kljuc] in [podpisi] sta kljuc naprave (KeyStore), [podpisi]
 * dobi samo pot /v1/connect in cas. Vrne tokova kanala po »ready« ali null (zavrnitev, rok, napacno rokovanje).
 * Klici so blokirajoci - samo zunaj glavne niti.
 */
class ReleKanal(
    private val odpri: () -> Socket = ::tlsDoReleja,
    private val kljuc: () -> String?,
    private val podpisi: (pot: String, casS: Long) -> String?,
    private val rokMs: Int = 20_000,
) {
    fun odpri(cilj: String): Pair<InputStream, OutputStream>? {
        val pot = ReleProtokol.potPovezave(cilj) ?: return null
        val k = kljuc() ?: return null
        val cas = System.currentTimeMillis() / 1000
        val podpis = podpisi(pot, cas) ?: return null
        val s = try { odpri() } catch (_: Exception) { return null }
        // skupni rok do »ready« (pregled 4): rele s pingi ali pocasno glavo ne sme drzati niti; po roku se vticnica zapre
        val pripravljen = java.util.concurrent.atomic.AtomicBoolean(false)
        val cuvaj = Thread { try { Thread.sleep(rokMs.toLong()); if (!pripravljen.get()) s.close() } catch (_: Exception) {} }.apply { isDaemon = true; start() }
        return try {
            s.soTimeout = rokMs
            val wsKljuc = ReleProtokol.kljucWs()
            val zahteva = listOf("GET $pot HTTP/1.1", "Host: ${ReleProtokol.GOSTITELJ}", "User-Agent: SafeerLink/1.0", "Upgrade: websocket",
                "Connection: Upgrade", "Sec-WebSocket-Key: $wsKljuc", "Sec-WebSocket-Version: 13",
                "X-Safeer-Key: $k", "X-Safeer-Time: $cas", "X-Safeer-Signature: $podpis").joinToString("\r\n") + "\r\n\r\n"
            val izhod = s.getOutputStream()
            izhod.write(zahteva.toByteArray(Charsets.US_ASCII)); izhod.flush()
            val vhod = s.getInputStream()
            val (prva, glave) = glavaOdgovora(vhod) ?: throw IOException("rele: ni glave")
            if (!prva.startsWith("HTTP/1.1 101 ") || glave["sec-websocket-accept"] != ReleProtokol.pricakovanAccept(wsKljuc) ||
                glave["upgrade"]?.lowercase() != "websocket") throw IOException("rele: zavrnjeno")
            val tok = WsTok(s, vhod, izhod)
            if (!tok.cakajReady()) throw IOException("rele: ni ready")
            if (!pripravljen.compareAndSet(false, true)) throw IOException("rele: rok")
            cuvaj.interrupt()
            s.soTimeout = 0
            tok.vhod to tok.izhod
        } catch (_: Exception) {
            try { s.close() } catch (_: Exception) {}
            null
        }
    }

    /** Glava HTTP do 16 KiB, bajt za bajtom (ostanek ostane v toku za okvirje). */
    private fun glavaOdgovora(i: InputStream): Pair<String, Map<String, String>>? {
        val b = java.io.ByteArrayOutputStream()
        while (b.size() < 16 * 1024) {
            val c = i.read()
            if (c < 0) return null
            b.write(c)
            val a = b.toByteArray()
            if (a.size >= 4 && a[a.size - 4] == '\r'.code.toByte() && a[a.size - 3] == '\n'.code.toByte() && a[a.size - 2] == '\r'.code.toByte() && a[a.size - 1] == '\n'.code.toByte()) {
                val vrstice = String(a, Charsets.ISO_8859_1).split("\r\n").filter { it.isNotEmpty() }
                val g = vrstice.drop(1).mapNotNull { v -> v.indexOf(':').takeIf { it > 0 }?.let { v.substring(0, it).trim().lowercase() to v.substring(it + 1).trim() } }.toMap()
                return vrstice.firstOrNull().orEmpty() to g
            }
        }
        return null
    }

    /** Kanal kot tokova: vhod vrne binarna sporocila releja, izhod jih poslje maskirano; ping dobi pong, close = konec toka. */
    private class WsTok(private val s: Socket, private val surovi: InputStream, private val surovIzhod: OutputStream) {
        private val r = ReleProtokol.Razclenjevalec()
        private val cakajo = ArrayDeque<ReleProtokol.Sporocilo>()
        private var trenutno = ByteArray(0)
        private var pozicija = 0
        private var konec = false
        private val zaklepPisanja = Any()

        private fun poslji(op: Int, p: ByteArray) = synchronized(zaklepPisanja) { surovIzhod.write(ReleProtokol.okvir(op, p)); surovIzhod.flush() }

        /** Naslednje podatkovno sporocilo ali null ob koncu. */
        private fun naslednje(): ReleProtokol.Sporocilo? {
            val buf = ByteArray(16 * 1024)
            while (true) {
                cakajo.removeFirstOrNull()?.let { m ->
                    when (m.op) {
                        9 -> poslji(10, m.podatki)
                        8 -> { konec = true; return null }
                        1, 2 -> return m
                    }
                } ?: run {
                    if (konec) return null
                    val n = surovi.read(buf)
                    if (n < 0) { konec = true; return null }
                    cakajo.addAll(r.dodaj(buf.copyOf(n)))
                }
            }
        }

        fun cakajReady(): Boolean {
            val m = naslednje() ?: return false
            return m.op == 1 && String(m.podatki, Charsets.UTF_8) == "ready"
        }

        val vhod = object : InputStream() {
            override fun read(): Int { val b = ByteArray(1); return if (read(b, 0, 1) < 0) -1 else b[0].toInt() and 0xff }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (len == 0) return 0
                while (pozicija >= trenutno.size) {
                    val m = naslednje() ?: return -1
                    if (m.op != 2) continue // besedilna sporocila releja niso del toka
                    trenutno = m.podatki; pozicija = 0
                }
                val n = minOf(len, trenutno.size - pozicija)
                System.arraycopy(trenutno, pozicija, b, off, n)
                pozicija += n
                return n
            }
            override fun close() = s.close()
        }

        val izhod = object : OutputStream() {
            override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
            override fun write(b: ByteArray, off: Int, len: Int) {
                var i = 0
                while (i < len) { val n = minOf(16 * 1024, len - i); poslji(2, b.copyOfRange(off + i, off + i + n)); i += n }
            }
            override fun close() {
                try { poslji(8, ByteArray(0)) } catch (_: Exception) {}
                s.close()
            }
        }
    }

    companion object {
        /** TLS do releja: sistemska korenska potrdila in preverba imena gostitelja (endpointIdentification HTTPS). */
        fun tlsDoReleja(): Socket {
            val s = SSLSocketFactory.getDefault().createSocket() as SSLSocket
            s.sslParameters = s.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS"; serverNames = listOf(javax.net.ssl.SNIHostName(ReleProtokol.GOSTITELJ)) }
            s.connect(InetSocketAddress(ReleProtokol.GOSTITELJ, 443), 10_000)
            s.startHandshake()
            return s
        }
    }
}
