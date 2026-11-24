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
    /** Izrek klicatelja v tem obratu (od zadnjega konca obrata Line); za zaznavo dostave paketa. */
    private val obratKlicatelja = StringBuilder()
    private var paketPovedan = false

    @Synchronized fun dodajVhod(besedilo: String) {
        if (besedilo.isEmpty()) return
        zvokSlisan = true
        dodajLocenoZaNovStavek(vhod, besedilo)
        if (obratKlicatelja.length < MEJA_OBRATA) obratKlicatelja.append(besedilo)
    }

    @Synchronized fun izrekObrata(): String = obratKlicatelja.toString()

    /** Navodilo za paket najvec enkrat na klic: true samo ob prvem klicu. */
    @Synchronized fun oznaciPaket(): Boolean = if (paketPovedan) false else { paketPovedan = true; true }

    @Synchronized fun jePaketPovedan(): Boolean = paketPovedan

    @Synchronized fun dodajIzhod(besedilo: String) {
        if (besedilo.isEmpty()) return
        dodajLocenoZaNovStavek(izhod, besedilo)
    }

    /**
     * Odlomki prepisa pridejo brez locila med obrati (v dnevniku: "slovensko.Pa ni", "Ana NovakPravilno").
     * Ce nov odlomek zacne z veliko crko takoj za crko ali koncnim locilom (brez presledka), gre v novo vrstico.
     * Odlomek z malo crko ali s presledkom (nadaljevanje besede ali stavka) ostane nespremenjen.
     */
    private fun dodajLocenoZaNovStavek(cilj: StringBuilder, besedilo: String) {
        if (cilj.isNotEmpty() && besedilo.first().isUpperCase() &&
            (cilj.last().isLetter() || cilj.last() in ".!?")) cilj.append('\n')
        cilj.append(besedilo)
    }

    /** Konec obrata (model je koncal): naslednji govor klicatelja gre v nov odstavek. */
    @Synchronized fun konecObrata() {
        obratKlicatelja.setLength(0)
        if (vhod.isNotEmpty() && vhod.last() != '\n') vhod.append('\n')
        if (izhod.isNotEmpty() && izhod.last() != '\n') izhod.append('\n')
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
        val linaDobesedno = izhod.toString().lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n").take(MEJA_DOBESEDNO)
        val razlog = when {
            sporocilo.isNotEmpty() -> ""
            paketPovedan -> "Klicala je dostava paketa; Lina je povedala, kje naj pusti paket."
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
            linaDobesedno = linaDobesedno,
            brezSporocilaRazlog = razlog,
        )
    }

    companion object {
        private val stevec = AtomicLong(0)
        const val MEJA_IMENA = 120
        const val MEJA_SPOROCILA = 2000
        const val MEJA_DOBESEDNO = 6000
        const val MEJA_OBRATA = 600
    }
}

private val ZNAKI_PREPOVEDANI = Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]")

private fun cistoIme(besedilo: String): String =
    besedilo.replace(ZNAKI_PREPOVEDANI, " ").replace(Regex("\\s+"), " ").trim()

private fun primerjalnoIme(s: String) = s.trim().replace(Regex("\\s+"), " ").lowercase()

/**
 * Ime klicatelja za prikaz (lastnik 23. 11. 2026: »Lina ne shranjuje klicev po imenu, katere imam v imeniku«): povedano ime in ime iz
 * imenika telefona. Samo imenik: »Ana Novak (imenik)«; povedal drugo ime: »Miha (v imeniku: Ana Novak)«; prazno = ni ne enega ne drugega.
 */
fun imeZaPrikaz(povedano: String, imenik: String): String {
    val p = povedano.trim()
    val i = imenik.trim()
    return when {
        i.isEmpty() -> p
        p.isEmpty() || primerjalnoIme(p) == primerjalnoIme(i) -> "$i (imenik)"
        else -> "$p (v imeniku: $i)"
    }
}

fun imeZaPrikaz(zapis: ZapisKlica): String = imeZaPrikaz(zapis.klicatelj, zapis.imeImenik)

/** Ime datoteke klica: cas, ime in priimek (povedano, sicer iz imenika, sicer Neznan) in stevilka vedno poleg imena. Primer: 2026-11-20 14-35 Miha Horvat 041123456.txt */
fun imeDatotekeKlica(zapis: ZapisKlica, zona: ZoneId = ZoneId.systemDefault()): String {
    val cas = DateTimeFormatter.ofPattern("yyyy-MM-dd HH-mm").format(Instant.ofEpochMilli(zapis.casZacetka).atZone(zona))
    var ime = cistoIme(zapis.klicatelj).ifEmpty { cistoIme(zapis.imeImenik) }.ifEmpty { "Neznan" }
    val stevilka = cistoIme(zapis.stevilka).ifEmpty { "skrita številka" }
    // Skrajsamo samo ime: cas in celotna stevilka ostaneta v imenu (meja 150 znakov).
    val prostor = 150 - cas.length - stevilka.length - 2
    if (ime.length > prostor) ime = ime.take(prostor.coerceAtLeast(1)).trim().ifEmpty { "Neznan" }
    return "$cas $ime $stevilka".trim() + ".txt"
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
        appendLine("Klicatelj: ${imeZaPrikaz(zapis).ifBlank { "ni povedal imena" }}")
        appendLine("Številka: ${zapis.stevilka}")
        appendLine("Podjetje: ${zapis.podjetje.ifBlank { "ni povedal" }}")
        appendLine("Čas klica: $cas, trajanje $trajanje")
        appendLine()
        if (zapis.sporocilo.isNotBlank()) {
            appendLine("Sporočilo (povzetek):")
            appendLine(zapis.sporocilo)
        } else {
            if (zapis.brezSporocilaRazlog.isBlank() && zapis.povzetek.isNotBlank()) {
                // Zapis, prejet z racunalnika, lahko nosi samo povzetek.
                appendLine("Sporočilo (povzetek):")
                appendLine(zapis.povzetek)
            } else {
                appendLine("Sporočila ni bilo.")
                if (zapis.brezSporocilaRazlog.isNotBlank()) appendLine("Razlog: ${zapis.brezSporocilaRazlog}")
            }
        }
        if (zapis.sporociloDobesedno.isNotBlank()) {
            appendLine()
            appendLine("Dobesedno, kar je povedal klicatelj:")
            appendLine(zapis.sporociloDobesedno)
        }
        if (zapis.linaDobesedno.isNotBlank()) {
            appendLine()
            appendLine("Dobesedno, kar je rekla Lina:")
            appendLine(zapis.linaDobesedno)
            val moske = moskeOblikeLine(zapis.linaDobesedno)
            if (moske.isNotEmpty()) appendLine("Opozorilo: Lina je o sebi uporabila moško obliko (${moske.joinToString(", ")}).")
            val ponovitve = stevilePonovitev(zapis.linaDobesedno)
            if (ponovitve > 0) appendLine("Opozorilo: Lina je ponovila skoraj enak stavek ($ponovitve-krat).")
        }
    }
}
