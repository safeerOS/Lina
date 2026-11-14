package si.safeer.lina.seznanitev

/** Naslov Line na racunalniku za asistentko: zasebni IP, vrata in odtis SHA-256 lista potrdila (64 hex, male crke). */
data class AsistentNaslov(val naslov: String, val vrata: Int, val odtis: String) {
    /** Osnova poti po pogodbi (lina-asistent2 AGENTS.md »Koncna tocka asistentke za telefon«). */
    fun osnova(): String {
        val gostitelj = if (naslov.contains(':')) "[$naslov]" else naslov
        return "https://$gostitelj:$vrata/api/asistent/v1"
    }
}

/** Pravila naslova asistentke: samo zanka ali zasebni naslov domacega omrezja, brez imena gostitelja (DNS). */
object AsistentQr {
    private val ODTIS = Regex("^[0-9a-fA-F]{64}$")
    private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")
    private val IPV6 = Regex("^[0-9a-fA-F:]{2,39}$")

    /** Preverjen naslov ali null (shramba ga preveri ob vsakem branju). */
    fun naslov(naslov: String, vrata: Int, odtis: String): AsistentNaslov? {
        if (!jeZasebniNaslov(naslov) || vrata !in 1..65535 || !ODTIS.matches(odtis)) return null
        return AsistentNaslov(naslov, vrata, odtis.lowercase())
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
