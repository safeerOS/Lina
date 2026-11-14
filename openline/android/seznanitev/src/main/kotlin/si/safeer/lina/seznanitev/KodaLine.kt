package si.safeer.lina.seznanitev

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Seznanitev s 6-mestno kodo v1 (lina-asistent2 AGENTS.md @fdd787b; koda-seznanitev.ts, spake2.ts). Lina je stran A
 * (identiteta "lina-asistent"), telefon stran B (id naprave). Sol w je pair_id, AAD je odtis TLS, ki ga telefon VIDI v
 * povezavi: posrednik z drugim potrdilom ne dobi veljavne potrditve cA. Naslov najde DNS-SD (_safeer-lina._tcp) ali rocni vnos.
 */
object KodaLine {
    const val ID_LINE = "lina-asistent"
    const val NIZ_MAC = "safeer-lina-koda-v1"
    const val STORITEV = "_safeer-lina._tcp"
    const val PRIVZETA_VRATA = 8446
    const val ISCI_MS = 5_000L
    private val KODA = Regex("^\\d{6}$")
    val PAIR_ID = Regex("^[A-Za-z0-9_-]{22}$")
    private val ODTIS = Regex("^[0-9a-f]{64}$")
    private val HEX = Regex("^(?:[0-9a-f]{2})+$")
    private val nakljucno = SecureRandom()

    /** Koda nacina B (telefon jo pokaze, lastnik jo vtipka v Lini): 100000-999999 kot novaKoda v TS. */
    fun novaKoda(): String = (100000 + nakljucno.nextInt(900000)).toString()

    /** Vnos uporabnika brez presledkov; null, ce ni natanko 6 stevk. */
    fun koda(vnos: String): String? = vnos.filterNot { it.isWhitespace() }.takeIf { KODA.matches(it) }

    /** »482 913« - tako jo kaze tudi Lina. */
    fun prikaz(koda: String): String = if (koda.length == 6) koda.substring(0, 3) + " " + koda.substring(3) else koda

    /** MAC = HMAC-SHA256(Ke, "safeer-lina-koda-v1\n" + pair_id + "\n" + id + "\n" + kljuc): veze kljuc naprave na Ke. */
    fun macKljuca(ke: ByteArray, pairId: String, id: String, kljuc: String): ByteArray {
        val m = Mac.getInstance("HmacSHA256")
        m.init(SecretKeySpec(ke, "HmacSHA256"))
        return m.doFinal("$NIZ_MAC\n$pairId\n$id\n$kljuc".toByteArray(Charsets.UTF_8))
    }

    /** Odgovor /koda/zacni velja samo, ce je fp isti kot odtis, ki ga telefon vidi v povezavi (sicer posrednik). */
    fun veljavenZacetek(pairId: String, nacin: String, hubId: String, fp: String, vidniOdtis: String): Boolean =
        PAIR_ID.matches(pairId) && nacin == "spake2" && hubId == ID_LINE && ODTIS.matches(vidniOdtis) &&
            MessageDigest.isEqual(fp.toByteArray(), vidniOdtis.toByteArray())

    /** Oglas DNS-SD: TXT v=1, naslov iz odgovora samo zaseben (kot QR), vrata 1-65535. */
    fun sprejmiOglas(naslov: String?, vrata: Int, txtV: String?): Pair<String, Int>? {
        val n = naslov?.substringBefore('%') ?: return null
        if (txtV != "1" || vrata !in 1..65535 || !AsistentQr.jeZasebniNaslov(n)) return null
        return n to vrata
    }

    /** Rezerva, ce DNS-SD ne najde Line: IPv4, IPv4:vrata, IPv6 ali [IPv6]:vrata; privzeta vrata 8446; samo zasebni naslovi. */
    fun rocniNaslov(vnos: String): Pair<String, Int>? {
        val t = vnos.trim()
        if (t.length > 60) return null
        val gostitelj: String
        val vrata: String?
        if (t.startsWith("[")) {
            val i = t.indexOf(']')
            if (i < 0) return null
            gostitelj = t.substring(1, i)
            val ostanek = t.substring(i + 1)
            vrata = when { ostanek.isEmpty() -> null; ostanek.startsWith(":") -> ostanek.drop(1); else -> return null }
        } else if (t.count { it == ':' } == 1) {
            gostitelj = t.substringBefore(':'); vrata = t.substringAfter(':')
        } else {
            gostitelj = t; vrata = null
        }
        val v = if (vrata == null) PRIVZETA_VRATA else vrata.takeIf { it.length in 1..5 && it.all(Char::isDigit) }?.toInt() ?: return null
        if (v !in 1..65535 || !AsistentQr.jeZasebniNaslov(gostitelj)) return null
        return gostitelj to v
    }

    internal fun jeHex(s: String, bajtov: Int? = null) = HEX.matches(s) && (bajtov == null || s.length == bajtov * 2)
}

/**
 * Telefonska stran enega kroga: pB, nato (pA, cA) -> cB. cA se preveri, PREDEN telefon poslje karkoli naprej (pogodba);
 * neveljavna cA pomeni napacno kodo ali drugo potrdilo TLS. Ke ostane v objektu samo za MAC kljuca.
 */
class KodaOdjemalec private constructor(private val s: Spake2, val pairId: String, val id: String) {
    val pb: String = Spake2.hex(s.sporocilo())
    private var ke: ByteArray? = null

    /** cB v hex ali null (cA ne velja ali neveljavna tocka): takrat se nic vec ne poslje. */
    fun potrdi(pa: String, ca: String): String? {
        if (ke != null || !(KodaLine.jeHex(pa, 65) || KodaLine.jeHex(pa, 33)) || !KodaLine.jeHex(ca, 32)) return null
        val cb = try { s.zakljuci(Spake2.hex(pa)) } catch (_: Exception) { return null }
        if (!s.preveri(Spake2.hex(ca))) return null
        ke = s.ke
        return Spake2.hex(cb)
    }

    /** MAC kljuca naprave (hex) - samo po veljavni cA. */
    fun mac(kljuc: String): String? = ke?.let { Spake2.hex(KodaLine.macKljuca(it, pairId, id, kljuc)) }

    companion object {
        fun zacni(koda: String, id: String, pairId: String, vidniOdtis: String): KodaOdjemalec? {
            val k = KodaLine.koda(koda) ?: return null
            if (!KodaLine.PAIR_ID.matches(pairId) || !KodaLine.jeHex(vidniOdtis, 32)) return null
            return KodaOdjemalec(Spake2.odjemalec(k, id, KodaLine.ID_LINE, vidniOdtis.toByteArray(), pairId.toByteArray()), pairId, id)
        }

        internal fun zaTest(koda: String, id: String, pairId: String, odtis: String, y: java.math.BigInteger) = KodaOdjemalec(
            Spake2.zaTest(Spake2.wIzKode(koda, pairId.toByteArray()), id, KodaLine.ID_LINE, false, y, odtis.toByteArray()), pairId, id,
        )
    }
}
