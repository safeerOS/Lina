package si.safeer.lina.samostojna

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Zaslon Domov na telefonu po skici Lina 2.0 (lastnik 22. 11. 2026). Samo ploscice za funkcije, ki na telefonu
 * res delujejo (pravilo »samo delujoce funkcije«); besedila so v virih aplikacije v sestih jezikih.
 */
enum class PloscaDomov { POGOVOR, KLICI, POVZETEK, ZAPISKI, PRIPRAVA, RACUNALNIK, NASTAVITVE }

/** Del dneva za pozdrav: jutro 5–9, dan 10–17, vecer sicer. */
enum class DelDneva { JUTRO, DAN, VECER }

fun delDneva(ura: Int): DelDneva = when (ura) {
    in 5..9 -> DelDneva.JUTRO
    in 10..17 -> DelDneva.DAN
    else -> DelDneva.VECER
}

/** Sistemski zapisi (napake, »Sistem«) niso klici: 22. 11. 2026 je Domov stel 21 »danes«, od tega 8 sistemskih zapisov. */
fun jeKlicZapis(z: ZapisKlica) = !z.id.startsWith("sys-") && z.stevilka != "Sistem"

/** Ena vrstica kartice »Danasnja obvestila«: ura klica, kdo in kratko sporocilo. */
data class VrsticaObvestila(val id: String, val ura: String, val kdo: String, val sporocilo: String, val nujno: Boolean)

private val URA = DateTimeFormatter.ofPattern("HH:mm")

/** Klici z danasnjim lokalnim datumom; nujni na vrhu, nato najnovejsi. Sporocilo je skrajsano na [najvecZnakov]. */
fun obvestilaDanes(
    zapisi: List<ZapisKlica>, zdaj: Long, cona: ZoneId, najvec: Int = 3, najvecZnakov: Int = 70,
): List<VrsticaObvestila> {
    val danes = Instant.ofEpochMilli(zdaj).atZone(cona).toLocalDate()
    return zapisi
        .filter { jeKlicZapis(it) && Instant.ofEpochMilli(it.casZacetka).atZone(cona).toLocalDate() == danes }
        .sortedWith(compareByDescending<ZapisKlica> { it.nujno }.thenByDescending { it.casZacetka })
        .take(najvec)
        .map { z ->
            VrsticaObvestila(
                id = z.id,
                ura = Instant.ofEpochMilli(z.casZacetka).atZone(cona).format(URA),
                kdo = z.klicatelj.trim().ifBlank { z.stevilka },
                sporocilo = kratkoSporocilo(z, najvecZnakov),
                nujno = z.nujno,
            )
        }
}

/** Kratek povzetek klica v eni vrstici: sporocilo (Lina ga povzame), sicer povzetek; skrajsano na [najvecZnakov]. */
private fun kratkoSporocilo(z: ZapisKlica, najvecZnakov: Int): String {
    val besedilo = z.sporocilo.ifBlank { z.povzetek }.replace(Regex("\\s+"), " ").trim()
    return if (besedilo.length > najvecZnakov) besedilo.take(najvecZnakov - 1).trimEnd() + "…" else besedilo
}

private val DATUM_URA = DateTimeFormatter.ofPattern("d. M. HH:mm")

/**
 * Zadnji klici, ki jih je prevzela Lina (lastnik 23. 11. 2026: »dosegljivi brez scrolling dol«): vsi dnevi, brez sistemskih zapisov,
 * najnovejsi prvi. Vrne izvirne zapise, da jim aplikacija pred prikazom doda ime iz imenika samo za te vrstice.
 */
fun zadnjiKlici(zapisi: List<ZapisKlica>, najvec: Int): List<ZapisKlica> =
    zapisi.filter(::jeKlicZapis).sortedByDescending { it.casZacetka }.take(najvec)

/** Vrstica kartice zadnjih klicev: danes samo ura, sicer datum in ura; ime iz imenika (imeZaPrikaz), sicer stevilka; prazno = skrita. */
fun vrsticaZadnjegaKlica(z: ZapisKlica, zdaj: Long, cona: ZoneId, najvecZnakov: Int = 60): VrsticaObvestila {
    val cas = Instant.ofEpochMilli(z.casZacetka).atZone(cona)
    val danes = cas.toLocalDate() == Instant.ofEpochMilli(zdaj).atZone(cona).toLocalDate()
    return VrsticaObvestila(
        id = z.id,
        ura = cas.format(if (danes) URA else DATUM_URA),
        kdo = imeZaPrikaz(z).ifBlank { z.stevilka.trim() },
        sporocilo = kratkoSporocilo(z, najvecZnakov),
        nujno = z.nujno,
    )
}

/**
 * Koliko zadnjih klicev (3–5) gre na Domov brez drsenja. Ocena: ~640 dp zasedejo sistemske vrstice (targetSdk 35: screenHeightDp
 * jih vsebuje), zgornja vrstica, zavihki in ostala vsebina Domova; ena vrstica klica ~44 dp; vecja pisava zmanjsa visino.
 * shortcut: ocena iz visine zaslona, ne meritev postavitve; ce se na napravi spodnji gumb odreze, izmeri pogled po postavitvi.
 */
fun vrsticZadnjihKlicev(visinaDp: Int, pisava: Float = 1f): Int =
    ((visinaDp / maxOf(1f, pisava) - 640f) / 44f).toInt().coerceIn(3, 5)

/** Stevilo danasnjih klicev (znacka na ploscici Klici); 0 = brez znacke. */
fun steviloDanes(zapisi: List<ZapisKlica>, zdaj: Long, cona: ZoneId): Int {
    val danes = Instant.ofEpochMilli(zdaj).atZone(cona).toLocalDate()
    return zapisi.count { jeKlicZapis(it) && Instant.ofEpochMilli(it.casZacetka).atZone(cona).toLocalDate() == danes }
}
