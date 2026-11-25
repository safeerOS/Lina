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
class SejaKlica(val casZacetka: Long, val stevilka: String, private val ura: () -> Long = System::currentTimeMillis) {
    private val vhod = StringBuilder()
    private val izhod = StringBuilder()
    /** Prepis po vrsti (govorec, cas prvega odlomka, besedilo); omejen ze med klicem, da dolg klic ne raste v pomnilniku. */
    private val izmenjave = ArrayList<Triple<String, Long, StringBuilder>>()
    /** Bajti prepisa v JSON UTF-8 (z [] in ovojem izmenjav), kot jih steje projekcija za racunalnik (N8). */
    private var bajtiPrepisa = 2
    /** Prva izmenjava trenutnega obrata (N11: v obratu gre odlomek k zadnji izmenjavi istega govorca, tudi ce je vmes govoril drugi). */
    private var zacetekObrata = 0
    private var prepisOkrnjen = false
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
        dodajVPrepis(GOVOREC_KLICATELJ, besedilo)
        if (obratKlicatelja.length < MEJA_OBRATA) obratKlicatelja.append(besedilo)
    }

    @Synchronized fun izrekObrata(): String = obratKlicatelja.toString()

    /** Navodilo za paket najvec enkrat na klic: true samo ob prvem klicu. */
    @Synchronized fun oznaciPaket(): Boolean = if (paketPovedan) false else { paketPovedan = true; true }

    @Synchronized fun jePaketPovedan(): Boolean = paketPovedan

    @Synchronized fun dodajIzhod(besedilo: String) {
        if (besedilo.isEmpty()) return
        dodajLocenoZaNovStavek(izhod, besedilo)
        dodajVPrepis(GOVOREC_LINA, besedilo)
    }

    /**
     * Odlomek gre k zadnji izmenjavi istega govorca v istem obratu, sicer v novo; cez mejo se prepis oznaci kot okrnjen.
     * Gemini Live poslje prepis klicatelja in Line v locenih, prepletenih sporocilih (zakasnjen vhod med Lininim odgovorom): brez tega bi
     * vsak preklop odprl novo izmenjavo (slepi pregled 17t, N11).
     */
    private fun dodajVPrepis(govorec: String, besedilo: String) {
        if (prepisOkrnjen) return
        var ostanek = besedilo
        var vsiliNovo = false
        while (ostanek.isNotEmpty()) {
            val zadnja = if (vsiliNovo) null else izmenjave.subList(zacetekObrata, izmenjave.size).lastOrNull { it.first == govorec }
            val nadaljuj = zadnja != null && zadnja.third.length < MEJA_IZMENJAVE_ZNAKOV
            if (!nadaljuj && (izmenjave.size >= MEJA_IZMENJAV || bajtiPrepisa + OVOJ_IZMENJAVE >= MEJA_PREPISA_B)) { prepisOkrnjen = true; return }
            val cilj = if (nadaljuj) zadnja!!.third else StringBuilder().also { izmenjave.add(Triple(govorec, ura(), it)); bajtiPrepisa += OVOJ_IZMENJAVE }
            vsiliNovo = false
            // Odlomka brez presledka med stavkoma (»slovensko.Pa ni«) locimo s presledkom, kot dodajLocenoZaNovStavek z vrstico.
            if (cilj.isNotEmpty() && ostanek.first().isUpperCase() && (cilj.last().isLetter() || cilj.last() in ".!?")) {
                if (bajtiPrepisa + 1 > MEJA_PREPISA_B) { prepisOkrnjen = true; return }
                cilj.append(' '); bajtiPrepisa++
                continue
            }
            // Kos v mejah znakov izmenjave in bajtov prepisa; reze samo med celimi znaki (nadomestni par ostane cel, slepi pregled N4).
            val kos = kosVMejah(ostanek, MEJA_IZMENJAVE_ZNAKOV - cilj.length, MEJA_PREPISA_B - bajtiPrepisa)
            if (kos.isEmpty()) {
                if (cilj.isNotEmpty()) { vsiliNovo = true; continue } // znak ne gre vec v to izmenjavo: v novo
                prepisOkrnjen = true; return // ni prostora niti za en cel znak
            }
            cilj.append(kos); bajtiPrepisa += jsonBajti(kos)
            ostanek = ostanek.substring(kos.length)
        }
    }

    /**
     * Odlomki prepisa pridejo brez locila med obrati (v dnevniku: "slovensko.Pa ni", "Ana NovakPravilno").
     * Ce nov odlomek zacne z veliko crko takoj za crko ali koncnim locilom (brez presledka), gre v novo vrstico.
     * Odlomek z malo crko ali s presledkom (nadaljevanje besede ali stavka) ostane nespremenjen.
     */
    private fun dodajLocenoZaNovStavek(cilj: StringBuilder, besedilo: String) {
        // N9: dobesedno je v zakljuci omejeno na MEJA_DOBESEDNO; surovi medpomnilnik ne raste med klicem cez MEJA_SUROVO (rezerva za presledke).
        val prostor = MEJA_SUROVO - cilj.length
        if (prostor <= 1) return
        if (cilj.isNotEmpty() && besedilo.first().isUpperCase() &&
            (cilj.last().isLetter() || cilj.last() in ".!?")) cilj.append('\n')
        cilj.append(kosVMejah(besedilo, MEJA_SUROVO - cilj.length, Int.MAX_VALUE))
    }

    /** Konec obrata (model je koncal): naslednji govor klicatelja gre v nov odstavek. */
    @Synchronized fun konecObrata() {
        obratKlicatelja.setLength(0)
        zacetekObrata = izmenjave.size
        if (vhod.isNotEmpty() && vhod.last() != '\n') vhod.append('\n')
        if (izhod.isNotEmpty() && izhod.last() != '\n') izhod.append('\n')
    }

    /** Model je prekinil Linin govor (interrupted): za prepis se zacne nov obrat, da se nov odgovor ne pripne k prekinjenemu (N11). */
    @Synchronized fun prekinjenObrat() {
        zacetekObrata = izmenjave.size
    }

    /** Orodje shrani_sporocilo; poznejsi klic dopolni prejsnjega (prazno polje ne izbrise ze zapisanega). */
    @Synchronized fun shraniSporocilo(ime: String?, priimek: String?, podjetje: String?, sporocilo: String?) {
        // Meje rezejo samo med celimi znaki (N7: osamljen nadomestni znak bi se v datoteki zapisal kot »?«).
        ime?.trim()?.takeIf { it.isNotEmpty() }?.let { this.ime = kosVMejah(it, MEJA_IMENA, Int.MAX_VALUE) }
        priimek?.trim()?.takeIf { it.isNotEmpty() }?.let { this.priimek = kosVMejah(it, MEJA_IMENA, Int.MAX_VALUE) }
        podjetje?.trim()?.takeIf { it.isNotEmpty() }?.let { this.podjetje = kosVMejah(it, MEJA_IMENA, Int.MAX_VALUE) }
        sporocilo?.trim()?.takeIf { it.isNotEmpty() }?.let { this.sporocilo = kosVMejah(it, MEJA_SPOROCILA, Int.MAX_VALUE) }
    }

    @Synchronized fun imaSporocilo(): Boolean = sporocilo.isNotEmpty()

    @Synchronized
    fun zakljuci(konec: Long): ZapisKlica {
        val klicatelj = listOf(ime, priimek).filter { it.isNotEmpty() }.joinToString(" ")
        val dobesedno = kosVMejah(vhod.toString().lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n"), MEJA_DOBESEDNO, Int.MAX_VALUE)
        val linaDobesedno = kosVMejah(izhod.toString().lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n"), MEJA_DOBESEDNO, Int.MAX_VALUE)
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
            prepisPogovora = izmenjave.mapNotNull { (g, c, b) -> b.toString().trim().takeIf { it.isNotEmpty() }?.let { IzmenjavaKlica(g, c, it) } },
            prepisOkrnjen = prepisOkrnjen,
        )
    }

    companion object {
        private val stevec = AtomicLong(0)
        const val MEJA_IMENA = 120
        const val MEJA_SPOROCILA = 2000
        const val MEJA_DOBESEDNO = 6000
        const val MEJA_OBRATA = 600
        const val MEJA_SUROVO = 2 * MEJA_DOBESEDNO
        /**
         * Meje prepisa pogovora: izmenjava do 2000 znakov (kot sporocilo), najvec 400 izmenjav in MEJA_PREPISA_B bajtov JSON UTF-8 (N8: bajti,
         * ne znaki - c/s/z in narekovaji so 2 B), kjer vsaka izmenjava steje se OVOJ_IZMENJAVE za kljuce in vejico
         * ({"govorec":"klicatelj","cas":1700000000000,"besedilo":""}, = 60 B). Tako prepis, ki ga seja ne okrni, projekcija za racunalnik
         * ne skrajsa (preizkus), dokler ostala polja zapisa pustijo prostor (MEJA_ZAPISA_SINHRON_B).
         */
        const val MEJA_IZMENJAVE_ZNAKOV = 2000
        const val MEJA_IZMENJAV = 400
        const val MEJA_PREPISA_B = MEJA_PREPISA_SINHRON_B
        const val OVOJ_IZMENJAVE = 60
    }
}

/** Bajti znaka v JSON UTF-8, kot ga zapise kotlinx.serialization (pobeg ", \\ in kontrolnih znakov). */
internal fun jsonBajti(cp: Int): Int = when {
    cp == '"'.code || cp == '\\'.code -> 2
    cp == '\n'.code || cp == '\r'.code || cp == '\t'.code || cp == '\b'.code || cp == 0x0C -> 2
    cp < 0x20 -> 6
    cp < 0x80 -> 1
    cp < 0x800 -> 2
    cp < 0x10000 -> 3
    else -> 4
}

internal fun jsonBajti(s: String): Int { var b = 0; var i = 0; while (i < s.length) { val cp = s.codePointAt(i); b += jsonBajti(cp); i += Character.charCount(cp) }; return b }

/** Najdaljsi zacetek [s] z najvec [znakov] enotami UTF-16 in [bajtov] bajti JSON; reze samo med celimi znaki (nikoli sredi para). */
internal fun kosVMejah(s: String, znakov: Int, bajtov: Int): String {
    var i = 0
    var b = 0
    while (i < s.length) {
        val cp = s.codePointAt(i)
        val n = Character.charCount(cp)
        val bb = jsonBajti(cp)
        if (i + n > znakov || b + bb > bajtov) break
        i += n; b += bb
    }
    return s.substring(0, i)
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
