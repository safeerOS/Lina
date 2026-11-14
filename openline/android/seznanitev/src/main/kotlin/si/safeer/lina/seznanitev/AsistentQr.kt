package si.safeer.lina.seznanitev

import java.net.URI

/** Naslov Line na racunalniku za asistentko: zasebni IP, vrata in odtis SHA-256 lista potrdila (64 hex, male crke). */
data class AsistentNaslov(val naslov: String, val vrata: Int, val odtis: String) {
    /** Osnova poti po pogodbi (lina-asistent2 AGENTS.md »Koncna tocka asistentke za telefon«). */
    fun osnova(): String {
        val gostitelj = if (naslov.contains(':')) "[$naslov]" else naslov
        return "https://$gostitelj:$vrata/api/asistent/v1"
    }
}

/**
 * QR za seznanitev telefona z Lino na racunalniku (PREDLOG v1, 14. 11. 2026 - na strani racunalnika se ni dogovorjen):
 *   safeer-lina://asistent?v=1&naslov=<IPv4 ali IPv6 brez oklepajev>&vrata=<1-65535>&odtis=<64 hex>
 * Samo zanka ali zasebni naslov domacega omrezja (kot streznik: 0.0.0.0 in javni naslov se zavrneta), brez imena gostitelja
 * (ime lahko razresi kamorkoli), brez uporabniskega imena, brez dodatnih ali podvojenih parametrov.
 */
object AsistentQr {
    const val SHEMA = "safeer-lina"
    private val ODTIS = Regex("^[0-9a-fA-F]{64}$")
    private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")
    private val IPV6 = Regex("^[0-9a-fA-F:]{2,39}$")

    fun razberi(besedilo: String): AsistentNaslov? {
        if (besedilo.length > 512) return null
        val uri = try { URI(besedilo.trim()) } catch (_: Exception) { return null }
        if (uri.scheme != SHEMA || uri.rawAuthority != "asistent" || uri.rawFragment != null) return null
        if (!uri.rawPath.isNullOrEmpty()) return null
        val q = uri.rawQuery ?: return null
        val pari = q.split('&').map { del -> del.split('=', limit = 2) }
        if (pari.any { it.size != 2 }) return null
        val polja = pari.associate { it[0] to it[1] }
        if (polja.size != pari.size || polja.keys != setOf("v", "naslov", "vrata", "odtis")) return null
        if (polja["v"] != "1") return null
        val naslov = polja.getValue("naslov")
        if (!jeZasebniNaslov(naslov)) return null
        val vrata = polja.getValue("vrata").toIntOrNull()?.takeIf { it in 1..65535 && polja.getValue("vrata") == it.toString() } ?: return null
        val odtis = polja.getValue("odtis").takeIf { ODTIS.matches(it) }?.lowercase() ?: return null
        return AsistentNaslov(naslov, vrata, odtis)
    }

    /** Zanka, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7 (brez DNS: samo zapis naslova). */
    fun jeZasebniNaslov(naslov: String): Boolean {
        IPV4.matchEntire(naslov)?.let { m ->
            val b = m.groupValues.drop(1).map { it.toIntOrNull() ?: return false }
            if (b.any { it > 255 } || m.groupValues.drop(1).any { it.length > 1 && it.startsWith("0") }) return false
            return b[0] == 127 || b[0] == 10 || (b[0] == 172 && b[1] in 16..31) || (b[0] == 192 && b[1] == 168)
        }
        if (!IPV6.matches(naslov) || !naslov.contains(':')) return false
        val bajti = try { java.net.InetAddress.getByName(naslov).address } catch (_: Exception) { return false }
        if (bajti.size != 16) return false
        if (bajti.take(15).all { it.toInt() == 0 } && bajti[15].toInt() == 1) return true
        return (bajti[0].toInt() and 0xfe) == 0xfc
    }
}
