package si.safeer.lina.samostojna

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.atomic.AtomicLong

/**
 * Zbira potek enega klica: prepis klicatelja, prepis Line in sporocilo, ki ga Lina zapise z orodjem shrani_sporocilo.
 * Ob koncu iz tega nastane ZapisKlica (ime, stevilka, podjetje, cas, sporocilo povzeto in dobesedno ali razlog, zakaj ga ni).
 * Cista logika brez Androida, zato preizkusljiva.
 */
class SejaKlica(val casZacetka: Long, val stevilka: String) {
    private val vhod = StringBuilder()
    private val izhod = StringBuilder()
    private var ime = ""
    private var priimek = ""
    private var podjetje = ""
    private var sporocilo = ""
    private var zvokSlisan = false

    @Synchronized fun dodajVhod(besedilo: String) {
        if (besedilo.isEmpty()) return
        zvokSlisan = true
        vhod.append(besedilo)
    }

    @Synchronized fun dodajIzhod(besedilo: String) {
        izhod.append(besedilo)
    }

    /** Konec obrata (model je koncal): naslednji govor klicatelja gre v nov odstavek. */
    @Synchronized fun konecObrata() {
        if (vhod.isNotEmpty() && vhod.last() != '\n') vhod.append('\n')
    }

    /** Orodje shrani_sporocilo; poznejsi klic dopolni prejsnjega (prazno polje ne izbrise ze zapisanega). */
    @Synchronized fun shraniSporocilo(ime: String?, priimek: String?, podjetje: String?, sporocilo: String?) {
        ime?.trim()?.takeIf { it.isNotEmpty() }?.let { this.ime = it.take(MEJA_IMENA) }
        priimek?.trim()?.takeIf { it.isNotEmpty() }?.let { this.priimek = it.take(MEJA_IMENA) }
        podjetje?.trim()?.takeIf { it.isNotEmpty() }?.let { this.podjetje = it.take(MEJA_IMENA) }
        sporocilo?.trim()?.takeIf { it.isNotEmpty() }?.let { this.sporocilo = it.take(MEJA_SPOROCILA) }
    }

    @Synchronized fun imaSporocilo(): Boolean = sporocilo.isNotEmpty()

    @Synchronized
    fun zakljuci(konec: Long): ZapisKlica {
        val klicatelj = listOf(ime, priimek).filter { it.isNotEmpty() }.joinToString(" ")
        val dobesedno = vhod.toString().lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n").take(MEJA_DOBESEDNO)
        val razlog = when {
            sporocilo.isNotEmpty() -> ""
            !zvokSlisan -> "Zvoka klicatelja ni bilo mogoče zapisati (prepis je prazen): klicatelj ni nič povedal ali zvok klica ni deloval."
            else -> "Lina sporočila ni zapisala. Spodaj je dobesedno, kar je povedal klicatelj."
        }
        val trajanje = ((konec - casZacetka) / 1000L).coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
        return ZapisKlica(
            id = "klic-$casZacetka-${stevec.incrementAndGet()}",
            casZacetka = casZacetka,
            stevilka = stevilka.ifBlank { "skrita številka" },
            trajanjeS = trajanje,
            nujno = false,
            povzetek = if (sporocilo.isNotEmpty()) sporocilo else razlog,
            prepis = "",
            nacin = NacinKlica.OSEBNA,
            klicatelj = klicatelj,
            podjetje = podjetje,
            sporocilo = sporocilo,
            sporociloDobesedno = dobesedno,
            brezSporocilaRazlog = razlog,
        )
    }

    companion object {
        private val stevec = AtomicLong(0)
        const val MEJA_IMENA = 120
        const val MEJA_SPOROCILA = 2000
        const val MEJA_DOBESEDNO = 6000
    }
}

private val ZNAKI_PREPOVEDANI = Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]")

private fun cistoIme(besedilo: String): String =
    besedilo.replace(ZNAKI_PREPOVEDANI, " ").replace(Regex("\\s+"), " ").trim()

/** Ime datoteke klica: cas, ime in priimek (ali Neznan) in stevilka vedno poleg imena. Primer: 2026-11-20 14-35 Miha Horvat 041123456.txt */
fun imeDatotekeKlica(zapis: ZapisKlica, zona: ZoneId = ZoneId.systemDefault()): String {
    val cas = DateTimeFormatter.ofPattern("yyyy-MM-dd HH-mm").format(Instant.ofEpochMilli(zapis.casZacetka).atZone(zona))
    val ime = cistoIme(zapis.klicatelj).ifEmpty { "Neznan" }
    val stevilka = cistoIme(zapis.stevilka).ifEmpty { "skrita številka" }
    return "$cas $ime $stevilka".take(150).trim() + ".txt"
}

/** Besedilo datoteke klica (UTF-8). */
fun besediloDatotekeKlica(zapis: ZapisKlica, zona: ZoneId = ZoneId.systemDefault()): String {
    val cas = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").format(Instant.ofEpochMilli(zapis.casZacetka).atZone(zona))
    val min = zapis.trajanjeS / 60
    val sek = zapis.trajanjeS % 60
    val trajanje = if (min > 0) "$min min $sek s" else "$sek s"
    return buildString {
        appendLine("Klic, ki ga je sprejela Lina")
        appendLine()
        appendLine("Klicatelj: ${zapis.klicatelj.ifBlank { "ni povedal imena" }}")
        appendLine("Številka: ${zapis.stevilka}")
        appendLine("Podjetje: ${zapis.podjetje.ifBlank { "ni povedal" }}")
        appendLine("Čas klica: $cas, trajanje $trajanje")
        appendLine()
        if (zapis.sporocilo.isNotBlank()) {
            appendLine("Sporočilo (povzetek):")
            appendLine(zapis.sporocilo)
        } else {
            appendLine("Sporočila ni bilo.")
            if (zapis.brezSporocilaRazlog.isNotBlank()) appendLine("Razlog: ${zapis.brezSporocilaRazlog}")
        }
        if (zapis.sporociloDobesedno.isNotBlank()) {
            appendLine()
            appendLine("Dobesedno, kar je povedal klicatelj:")
            appendLine(zapis.sporociloDobesedno)
        }
    }
}
