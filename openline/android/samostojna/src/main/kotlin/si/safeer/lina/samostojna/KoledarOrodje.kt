package si.safeer.lina.samostojna

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Branje koledarja telefona za Linin pogovor (lastnik 22. 11. 2026, naloga 5 iz Linine predloge: »funkcijsko klicanje za koledar«).
 * SAMO BRANJE: orodje [[koledar: danes|jutri|teden|YYYY-MM-DD]] vrne dogodke v obsegu; pisanja v koledar ni.
 * Naslovi dogodkov so nezaupano besedilo (vabila drugih ljudi): gredo modelu kot podatek v <<< >>> (nevtraliziraj).
 */
data class DogodekKoledarja(val naslov: String, val zacetekMs: Long, val konecMs: Long, val cezDan: Boolean, val kraj: String = "")

/** Vir dogodkov (Android: CalendarContract). Vrne SecurityException, ce dovoljenja ni. */
interface KoledarOrodje {
    fun dogodki(odMs: Long, doMs: Long): List<DogodekKoledarja>
}

/** Najvec dogodkov v enem odgovoru orodja. */
const val NAJVEC_DOGODKOV_KOLEDARJA = 30

/** Obseg [od, do) v milisekundah: danes, jutri, teden (7 dni od danes) ali datum YYYY-MM-DD; sicer null. */
fun obsegKoledarja(vsebina: String, zdaj: ZonedDateTime): Pair<Long, Long>? {
    val v = vsebina.trim().lowercase()
    val danes = zdaj.toLocalDate()
    val od: LocalDate
    val dod: LocalDate
    when (v) {
        "danes" -> { od = danes; dod = danes.plusDays(1) }
        "jutri" -> { od = danes.plusDays(1); dod = danes.plusDays(2) }
        "teden" -> { od = danes; dod = danes.plusDays(7) }
        else -> {
            od = try { LocalDate.parse(v) } catch (e: DateTimeParseException) { return null }
            dod = od.plusDays(1)
        }
    }
    return od.atStartOfDay(zdaj.zone).toInstant().toEpochMilli() to dod.atStartOfDay(zdaj.zone).toInstant().toEpochMilli()
}

private val DAN = DateTimeFormatter.ofPattern("d. M.")
private val URA = DateTimeFormatter.ofPattern("HH:mm")

private fun enaVrstica(s: String, najvec: Int) = s.replace(Regex("\\s+"), " ").trim().take(najvec)

class KoledarIzvajalec(
    private val vir: KoledarOrodje,
    private val zdaj: () -> ZonedDateTime = { ZonedDateTime.now() },
) {
    /** Besedilo za model. Neveljaven obseg in manjkajoce dovoljenje sta navadno besedilo (model to pove uporabniku). */
    fun izvedi(vsebina: String): String {
        val cas = zdaj()
        val obseg = obsegKoledarja(vsebina, cas) ?: return "Neveljaven obseg koledarja. Uporabi: danes, jutri, teden ali datum v obliki 2026-11-23."
        val dogodki = try {
            vir.dogodki(obseg.first, obseg.second)
        } catch (e: SecurityException) {
            return "Lina nima dovoljenja za branje koledarja. Uporabnik ga lahko dovoli v nastavitvah telefona (Aplikacije, Lina, Dovoljenja)."
        }
        // Dogodki za cel dan so v koledarju v UTC (polnoc), poizvedba pa v lokalnem casu: izberi jih po KOLEDARSKIH datumih,
        // sicer bi v zahodnem casovnem pasu vkljucili jutrisnji dogodek (CodeRabbit 22. 11. 2026).
        val odDatum = Instant.ofEpochMilli(obseg.first).atZone(cas.zone).toLocalDate()
        val doDatum = Instant.ofEpochMilli(obseg.second).atZone(cas.zone).toLocalDate()
        val ustrezni = dogodki.filter { d ->
            if (!d.cezDan) true else {
                val zd = Instant.ofEpochMilli(d.zacetekMs).atZone(ZoneOffset.UTC).toLocalDate()
                val kd = Instant.ofEpochMilli(d.konecMs).atZone(ZoneOffset.UTC).toLocalDate()
                zd < doDatum && maxOf(kd, zd.plusDays(1)) > odDatum
            }
        }
        if (ustrezni.isEmpty()) return "V koledarju ni dogodkov v tem obsegu."
        val uredljivi = ustrezni.sortedWith(compareBy({ it.zacetekMs }, { it.naslov }))
        return buildString {
            for (d in uredljivi.take(NAJVEC_DOGODKOV_KOLEDARJA)) {
                val naslov = enaVrstica(d.naslov, 120).ifEmpty { "(brez naslova)" }
                val kraj = enaVrstica(d.kraj, 80).let { if (it.isEmpty()) "" else " ($it)" }
                if (d.cezDan) {
                    // Dogodki za cel dan so v koledarju shranjeni v UTC.
                    val dan = Instant.ofEpochMilli(d.zacetekMs).atZone(ZoneOffset.UTC).toLocalDate()
                    // Konec je izkljucujoc (polnoc po zadnjem dnevu): zadnji dan = konec - 1.
                    val zadnji = Instant.ofEpochMilli(d.konecMs).atZone(ZoneOffset.UTC).toLocalDate().minusDays(1)
                    val obdobje = if (zadnji > dan) "${dan.format(DAN)}–${zadnji.format(DAN)}" else dan.format(DAN)
                    appendLine("• $obdobje ves dan: $naslov$kraj")
                } else {
                    val z = Instant.ofEpochMilli(d.zacetekMs).atZone(cas.zone)
                    val k = Instant.ofEpochMilli(d.konecMs).atZone(cas.zone)
                    val konec = if (k.toLocalDate() != z.toLocalDate()) "${k.format(DAN)} ${k.format(URA)}" else k.format(URA)
                    appendLine("• ${z.format(DAN)} ${z.format(URA)}–$konec: $naslov$kraj")
                }
            }
            if (uredljivi.size > NAJVEC_DOGODKOV_KOLEDARJA) appendLine("(dogodkov je še ${uredljivi.size - NAJVEC_DOGODKOV_KOLEDARJA}, prikazani so prvi ${NAJVEC_DOGODKOV_KOLEDARJA})")
        }.trim()
    }
}
