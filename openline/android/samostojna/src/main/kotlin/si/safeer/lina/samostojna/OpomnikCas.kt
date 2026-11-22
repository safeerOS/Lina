package si.safeer.lina.samostojna

import java.time.ZonedDateTime
import java.time.format.DateTimeParseException

/**
 * Opomniki ob dolocenem casu (nacrt 22. 11. 2026, 2j). Cista logika brez Androida: razclemba casa iz odgovora modela
 * in zapis cakajocih opomnikov (za ponovni vklop alarmov po ponovnem zagonu telefona).
 */
object OpomnikCas {
    /** Najvec ur v prihodnost; model se lahko zmoti v letu, takega opomnika ne nastavimo tiho. */
    const val NAJVEC_NAPREJ_MS = 366L * 24 * 3600 * 1000

    /** Cas v ms od 1970 ali null, ce je neveljaven, ze mimo (z 5 s milosti) ali predaleč v prihodnosti. */
    fun izracunaj(cas: String, zdajMs: Long): Long? {
        val ms = try {
            ZonedDateTime.parse(cas.trim()).toInstant().toEpochMilli()
        } catch (e: DateTimeParseException) {
            return null
        }
        if (ms < zdajMs - 5_000L) return null
        if (ms > zdajMs + NAJVEC_NAPREJ_MS) return null
        return ms
    }
}

/** Cakajoci opomnik: id, cas sprozitve (ms), besedilo. */
data class CakajociOpomnik(val id: String, val casMs: Long, val besedilo: String)

object OpomnikZapis {
    /** Eden zapis na vrstico: id, cas in besedilo, locena z znakom TAB; besedilo brez znakov za novo vrstico in TAB. */
    fun kodiraj(o: CakajociOpomnik): String {
        val b = o.besedilo.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ').trim()
        return "${o.id.replace('\t', '_').replace('\n', '_')}\t${o.casMs}\t$b"
    }

    fun razclenji(vrstica: String): CakajociOpomnik? {
        val d = vrstica.split('\t', limit = 3)
        if (d.size != 3 || d[0].isEmpty() || d[2].isEmpty()) return null
        val ms = d[1].toLongOrNull() ?: return null
        return CakajociOpomnik(d[0], ms, d[2])
    }

    /** Opomniki, ki jih je treba ponovno vklopiti: veljavni zapisi, urejeni po casu. */
    fun razclenjeniVsi(vrstice: Collection<String>): List<CakajociOpomnik> =
        vrstice.mapNotNull { razclenji(it) }.sortedBy { it.casMs }
}
