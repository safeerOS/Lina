package si.safeer.lina.podpis

import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Semaphore
import javax.net.SocketFactory
import kotlin.concurrent.thread

/**
 * Lokalna vrata do Line prek releja (kot link_rele »lokalna vrata do oddaljenega huba«): HttpPovezavaZLino se poveze na
 * 127.0.0.1:[vrata] z navadno vticnico, ReleVrata odpre kanal releja in prenasa bajte. TLS s pripetim odtisom Line opravi
 * OkHttp skozi kanal kot doma - rele in ta razred vidita samo sifrirane bajte.
 *
 * Tuja aplikacija na istem telefonu lahko doseze vrata na 127.0.0.1; zato kanal dobi samo vticnica, ki takoj poslje 32-bajtno
 * skrivnost tega procesa (vticnice iz [tovarna]); brez nje se vticnica zapre in kanal se ne odpre (podpis naprave za rele se ne
 * porabi). Najvec [NAJVEC] hkratnih kanalov.
 */
class ReleVrata(private val cilj: String, private val kanal: ReleKanal) : Closeable {
    private val skrivnost = ByteArray(32).also { SecureRandom().nextBytes(it) }
    // izrecno 127.0.0.1: PovezavaLine se poveze na ta naslov (pregled 7: getLoopbackAddress je lahko ::1)
    private val streznik = ServerSocket(0, 16, InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
    private val mesta = Semaphore(NAJVEC)
    val vrata: Int = streznik.localPort

    init {
        thread(isDaemon = true, name = "lina-rele-vrata") {
            while (!streznik.isClosed) {
                val s = try { streznik.accept() } catch (_: Exception) { break }
                if (!mesta.tryAcquire()) { zapri(s); continue }
                thread(isDaemon = true, name = "lina-rele-kanal") { try { povezi(s) } finally { mesta.release() } }
            }
        }
    }

    private fun povezi(s: Socket) {
        try {
            // skupni rok 5 s za celo skrivnost (pregled 4: rok na posamezno branje bi tuji aplikaciji dovolil drzati mesta)
            val rok = System.currentTimeMillis() + 5_000
            val prejeto = ByteArray(32)
            var k = 0
            while (k < 32) {
                val ostane = rok - System.currentTimeMillis()
                if (ostane <= 0) break
                s.soTimeout = ostane.toInt()
                val n = s.getInputStream().read(prejeto, k, 32 - k); if (n < 0) break; k += n
            }
            if (k != 32 || !MessageDigest.isEqual(prejeto, skrivnost)) { zapri(s); return }
            s.soTimeout = 0
            val (vhod, izhod) = kanal.odpri(cilj) ?: run { zapri(s); return }
            // lokalna stran konca prva: zapri tudi kanal releja, sicer bi bralna nit cakala, dokler ga ne zapre rele (pregled 4)
            val t = thread(isDaemon = true) { prenesi(s.getInputStream(), izhod); zapri(s); try { izhod.close() } catch (_: Exception) {} }
            prenesi(vhod, s.getOutputStream())
            zapri(s)
            try { izhod.close() } catch (_: Exception) {}
            t.join(1_000)
        } catch (_: Exception) {
            zapri(s)
        }
    }

    private fun prenesi(i: InputStream, o: OutputStream) {
        val b = ByteArray(16 * 1024)
        try {
            while (true) { val n = i.read(b); if (n < 0) break; o.write(b, 0, n); o.flush() }
        } catch (_: Exception) {}
    }

    private fun zapri(s: Socket) = try { s.close() } catch (_: Exception) {}

    /** Tovarna vticnic za OkHttp: vsaka vticnica po connect najprej poslje skrivnost (ista navadna vticnica, TLS gre cez njo). */
    fun tovarna(): SocketFactory = object : SocketFactory() {
        private fun nova(): Socket = object : Socket() {
            override fun connect(endpoint: SocketAddress?, timeout: Int) {
                super.connect(endpoint, timeout)
                getOutputStream().write(skrivnost)
                getOutputStream().flush()
            }
        }
        override fun createSocket(): Socket = nova()
        override fun createSocket(host: String?, port: Int): Socket = nova().apply { connect(InetSocketAddress(host, port), 10_000) }
        override fun createSocket(host: String?, port: Int, la: InetAddress?, lp: Int): Socket = createSocket(host, port)
        override fun createSocket(host: InetAddress?, port: Int): Socket = nova().apply { connect(InetSocketAddress(host, port), 10_000) }
        override fun createSocket(a: InetAddress?, port: Int, la: InetAddress?, lp: Int): Socket = createSocket(a, port)
    }

    override fun close() = try { streznik.close() } catch (_: Exception) {}

    companion object { const val NAJVEC = 8 }
}
