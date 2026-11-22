package si.safeer.lina.samostojna

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Zaslon Domov na telefonu po skici Lina 2.0 (lastnik 22. 11. 2026). Samo ploscice za funkcije, ki na telefonu
 * res delujejo (pravilo »samo delujoce funkcije«); besedila so v virih aplikacije v sestih jezikih.
 */
enum class PloscaDomov { POGOVOR, KLICI, ZAPISKI, PRIPRAVA, RACUNALNIK, NASTAVITVE }

/** Del dneva za pozdrav: jutro 5–9, dan 10–17, vecer sicer. */
enum class DelDneva { JUTRO, DAN, VECER }

fun delDneva(ura: Int): DelDneva = when (ura) {
    in 5..9 -> DelDneva.JUTRO
    in 10..17 -> DelDneva.DAN
    else -> DelDneva.VECER
}

/** Ena vrstica kartice »Danasnja obvestila«: ura klica, kdo in kratko sporocilo. */
data class VrsticaObvestila(val id: String, val ura: String, val kdo: String, val sporocilo: String, val nujno: Boolean)

private val URA = DateTimeFormatter.ofPattern("HH:mm")

/** Klici z danasnjim lokalnim datumom; nujni na vrhu, nato najnovejsi. Sporocilo je skrajsano na [najvecZnakov]. */
fun obvestilaDanes(
    zapisi: List<ZapisKlica>, zdaj: Long, cona: ZoneId, najvec: Int = 3, najvecZnakov: Int = 70,
): List<VrsticaObvestila> {
    val danes = Instant.ofEpochMilli(zdaj).atZone(cona).toLocalDate()
    return zapisi
        .filter { Instant.ofEpochMilli(it.casZacetka).atZone(cona).toLocalDate() == danes }
        .sortedWith(compareByDescending<ZapisKlica> { it.nujno }.thenByDescending { it.casZacetka })
        .take(najvec)
        .map { z ->
            val besedilo = z.sporocilo.ifBlank { z.povzetek }.replace(Regex("\\s+"), " ").trim()
            VrsticaObvestila(
                id = z.id,
                ura = Instant.ofEpochMilli(z.casZacetka).atZone(cona).format(URA),
                kdo = z.klicatelj.trim().ifBlank { z.stevilka },
                sporocilo = if (besedilo.length > najvecZnakov) besedilo.take(najvecZnakov - 1).trimEnd() + "…" else besedilo,
                nujno = z.nujno,
            )
        }
}

/** Stevilo danasnjih klicev (znacka na ploscici Klici); 0 = brez znacke. */
fun steviloDanes(zapisi: List<ZapisKlica>, zdaj: Long, cona: ZoneId): Int {
    val danes = Instant.ofEpochMilli(zdaj).atZone(cona).toLocalDate()
    return zapisi.count { Instant.ofEpochMilli(it.casZacetka).atZone(cona).toLocalDate() == danes }
}
