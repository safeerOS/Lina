package si.safeer.lina.podpis

import java.io.IOException
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Protokol releja Safeer Global Link (link.safeer.si), kot core/link_rele.py na racunalniku in rele-lina.server.ts v Lini:
 * telefon odpre WebSocket GET /v1/connect?to=<id Line>&kanal=<32 hex>, podpisan z glavami X-Safeer-Key/Time/Signature
 * (SHA256withECDSA nad »GET\nPOT\nCAS\nhex(sha256(prazno))«), pocaka besedilo »ready«, nato tecejo binarni okvirji.
 * Skozi kanal gre TLS Line s pripetim odtisom (HttpPovezavaZLino), zato rele vidi samo sifrirane bajte.
 */
object ReleProtokol {
    const val GOSTITELJ = "link.safeer.si"
    const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    const val NAJVEC_SPOROCILO = 4 * 1024 * 1024
    private val ID = Regex("^n-[0-9a-f]{16}$")
    private val POT_POVEZAVE = Regex("^/v1/connect\\?to=n-[0-9a-f]{16}&kanal=[0-9a-f]{32}$")
    private val nakljucno = SecureRandom()

    fun jeIdReleja(id: String): Boolean = ID.matches(id)

    /** Podpis releja sme veljati SAMO za to pot (kljuc naprave ne podpise poljubnih bajtov za rele). */
    fun jePotPovezave(pot: String): Boolean = POT_POVEZAVE.matches(pot)

    fun potPovezave(cilj: String): String? {
        if (!jeIdReleja(cilj)) return null
        val kanal = ByteArray(16).also { nakljucno.nextBytes(it) }.joinToString("") { "%02x".format(it) }
        return "/v1/connect?to=$cilj&kanal=$kanal"
    }

    fun sporociloPodpisa(pot: String, casS: Long): ByteArray {
        val prazno = MessageDigest.getInstance("SHA-256").digest(ByteArray(0)).joinToString("") { "%02x".format(it) }
        return "GET\n$pot\n$casS\n$prazno".toByteArray(Charsets.UTF_8)
    }

    fun kljucWs(): String = java.util.Base64.getEncoder().encodeToString(ByteArray(16).also { nakljucno.nextBytes(it) })

    fun pricakovanAccept(kljucWs: String): String =
        java.util.Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((kljucWs + GUID).toByteArray(Charsets.US_ASCII)))

    /** Okvir s FIN=1; [maska] null = nemaskiran (stran releja), sicer 4 bajti (odjemalec mora maskirati, RFC 6455 5.3). */
    fun okvir(op: Int, podatki: ByteArray, maska: ByteArray? = ByteArray(4).also { nakljucno.nextBytes(it) }): ByteArray {
        val n = podatki.size
        val m = if (maska != null) 0x80 else 0
        val glava = when {
            n < 126 -> byteArrayOf((m or n).toByte())
            n < 65536 -> byteArrayOf((m or 126).toByte(), (n shr 8).toByte(), n.toByte())
            else -> ByteBuffer.allocate(9).put((m or 127).toByte()).putLong(n.toLong()).array()
        }
        val telo = if (maska == null) podatki else ByteArray(n) { (podatki[it].toInt() xor maska[it and 3].toInt()).toByte() }
        return byteArrayOf((0x80 or (op and 0x0f)).toByte()) + glava + (maska ?: ByteArray(0)) + telo
    }

    class Sporocilo(val op: Int, val podatki: ByteArray)

    /**
     * Razclenjevalec okvirjev; [maskirano] = kaj pricakujemo (od releja nemaskirano). Zdruzi razdeljena sporocila, vsako najvec
     * NAJVEC_SPOROCILO; nadaljevanje brez zacetka, rezervirani biti ali napacno maskiranje = IOException.
     */
    class Razclenjevalec(private val maskirano: Boolean = false) {
        private var buf = ByteArray(0)
        private val deli = java.io.ByteArrayOutputStream()
        private var opDela = -1

        fun dodaj(b: ByteArray): List<Sporocilo> {
            buf += b
            val izhod = mutableListOf<Sporocilo>()
            while (true) {
                if (buf.size < 2) return izhod
                val b0 = buf[0].toInt() and 0xff
                val b1 = buf[1].toInt() and 0xff
                val fin = b0 and 0x80 != 0
                val op = b0 and 0x0f
                if (b0 and 0x70 != 0) throw IOException("ws: rezervirani biti")
                val m = b1 and 0x80 != 0
                if (m != maskirano) throw IOException("ws: napacno maskiranje")
                var n = (b1 and 0x7f).toLong()
                var i = 2
                if (n == 126L) { if (buf.size < 4) return izhod; n = (((buf[2].toInt() and 0xff) shl 8) or (buf[3].toInt() and 0xff)).toLong(); i = 4 }
                else if (n == 127L) { if (buf.size < 10) return izhod; n = ByteBuffer.wrap(buf, 2, 8).long; i = 10 }
                if (n < 0 || n > NAJVEC_SPOROCILO) throw IOException("ws: prevelik okvir")
                val maska = if (m) { if (buf.size < i + 4) return izhod; buf.copyOfRange(i, i + 4).also { i += 4 } } else null
                if (buf.size < i + n) return izhod
                var p = buf.copyOfRange(i, i + n.toInt())
                if (maska != null) p = ByteArray(p.size) { (p[it].toInt() xor maska[it and 3].toInt()).toByte() }
                buf = buf.copyOfRange(i + n.toInt(), buf.size)
                if (op >= 8) {
                    if (!fin || n > 125) throw IOException("ws: nadzorni okvir")
                    izhod += Sporocilo(op, p)
                    continue
                }
                if (op == 0) { if (opDela < 0) throw IOException("ws: nadaljevanje brez zacetka") }
                else if (opDela >= 0) throw IOException("ws: novo sporocilo med delnim")
                else opDela = op
                if (deli.size() + p.size > NAJVEC_SPOROCILO) throw IOException("ws: prevelik okvir")
                deli.write(p)
                if (fin) { izhod += Sporocilo(opDela, deli.toByteArray()); deli.reset(); opDela = -1 }
            }
        }
    }
}
