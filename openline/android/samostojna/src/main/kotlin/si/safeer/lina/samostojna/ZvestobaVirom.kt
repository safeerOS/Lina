package si.safeer.lina.samostojna

/**
 * Naloga 11 (lastnik 25. 11. 2026): Lina o sebi, povezavi in pošiljanju nalog trdi samo, kar potrdi program.
 * Posnetek 06:49 (5G): »Da, povezana sem« in »Pošiljam nalogo računalniku«, računalnik pa ni bil dosegljiv; različico je ugibala.
 */

/** Stanje računalnika ob vprašanju: seznanitev iz shrambe, dosegljivost iz izmerjenega odgovora Line (ne iz seznanitve). */
enum class StanjeRacunalnika {
    NI_SEZNANJEN, NEDOSEGLJIV, DOSEGLJIV;

    companion object {
        fun iz(seznanjen: Boolean, dosegljiv: Boolean) = when {
            dosegljiv -> DOSEGLJIV
            seznanjen -> NEDOSEGLJIV
            else -> NI_SEZNANJEN
        }
    }
}

/** Lina o sebi: različica iz nameščene aplikacije (BuildConfig.VERSION_NAME, poda jo aplikacija) in seznam funkcij v tej gradnji. */
object OSebi {
    /** Funkcije telefonske Line v tej gradnji (seznam gre v aplikacijo ob gradnji; ob novi funkciji ga dopolni skupaj s preizkusom). */
    val FUNKCIJE = listOf(
        "pogovor (besedilo in glas)", "zapiski", "opomniki z alarmom", "budilke in dogodki v koledarju (po potrditvi)",
        "iskanje in branje spleta (s ključem Brave/TinyFish)", "spomin pogovorov na telefonu", "priponke (slike, PDF, besedilo)",
        "naloge za računalnik (Claude Code), ko je računalnik dosegljiv", "sprejem klicev (tajnica)",
        "branje koledarja telefona", "lokalni dokumenti", "način ne moti in svetlost zaslona (po potrditvi, če je vklopljen sistemski nadzor)",
    )

    /**
     * Vprasanje o Linini razlicici: »si/imaš (nameščeno)/teče/are you« takoj za besedo razlicica na koncu vprasanja ali »tvoja/Lina« ob njej.
     * Golo »si« ni dovolj (»Zapiši si, da je nova verzija pogodbe …«); zgresena oblika ni draga, ker model razlicico dobi v O SEBI.
     */
    private val VPRASANJE_RAZLICICE = Regex(
        "(različic|razlicic|verzij|version)\\w*\\s+(si|ima[sš](\\s+name[sš][cč]en\\w*)?|te[cč]e[sš]?|are you)\\s*[?.!]*\\s*$|" +
            "\\b(tvoj\\w*|your)\\s+(različic|razlicic|verzij|version)|(različic|razlicic|verzij|version)\\w*\\s+(lin[ae]|tvoj\\w*|of lina)\\b",
        RegexOption.IGNORE_CASE,
    )

    fun jeVprasanjeORazlicici(vnos: String): Boolean = vnos.length <= 120 && VPRASANJE_RAZLICICE.containsMatchIn(vnos.trim())

    fun odgovorORazlicici(razlicica: String): String =
        if (razlicica.isBlank()) "Različice ne vem: aplikacija mi je ni sporočila. Piše v Nastavitvah telefona pod Aplikacije > Lina."
        else "Nameščena je Lina $razlicica (vir: nameščena aplikacija na tem telefonu)."

    fun navodilo(razlicica: String): String =
        " O SEBI (iz nameščene aplikacije, ne ugibaj): " +
            (if (razlicica.isBlank()) "različice ne poznaš; če te vprašajo, povej, da je ne veš. " else "nameščena različica je $razlicica. ") +
            "Glavne funkcije v tej gradnji: ${FUNKCIJE.joinToString("; ")}. Seznam ni popoln: veljajo tudi sposobnosti, ki jih opisujejo ta navodila. " +
            "O funkciji, ki je ni ne tu ne v navodilih, ne trdi, da jo znaš, in ne, da je »samo v izvorni kodi«: povej, da tega ne veš zagotovo."
}

/** Izid predaje naloge računalniku: besedilo uporabniku izbere aplikacija po tem izidu (strings.xml), nikoli pred njim. */
enum class IzidPredaje {
    SPREJETA, NEDOSEGLJIV, CLAUDE_CODE_NI, ZAVRNJENA, PREVEC, ZASEDENO, NAPAKA, NEZNAN,
    /** Naloga 23t: vmesni izid - Lina na racunalniku odpira Claude Code, telefon caka in nalogo poslje sam (koncni izid pride za njim). */
    ODPIRA,
    /** Razlogi zagona seje (stanje.zagon v 503) in rok cakanja; naloga ostane shranjena za rocno ponovitev. */
    ZAGON_NI_TERMINALA, ZAGON_NI_CLAUDE, ZAGON_IZKLOPLJENO, ZAGON_OPOZORILO, ZAGON_OMEJITEV, ZAGON_NAPAKA, ZAGON_ROK,
}

object PredajaNaloge {
    /** Enako kot NapakaLine.sporocilo (podpis): 503 claude-code-ni, 403 zavrnjeno, 429 prevec; drugo je napaka, ne »ni dosegljiv«. */
    fun izid(ok: Boolean, nedosegljiva: Boolean, status: Int?): IzidPredaje = when {
        ok -> IzidPredaje.SPREJETA
        nedosegljiva -> IzidPredaje.NEDOSEGLJIV
        status == 503 -> IzidPredaje.CLAUDE_CODE_NI
        status == 403 -> IzidPredaje.ZAVRNJENA
        status == 429 -> IzidPredaje.PREVEC
        // T1 (pregled 0213): zahteva oddana, odgovora ni (IzidOddaje, status 0) - racunalnik jo je morda prejel
        status == 0 -> IzidPredaje.NEZNAN
        else -> IzidPredaje.NAPAKA
    }

    private fun izZagona(zagon: String?): IzidPredaje = when (zagon) {
        "odpira" -> IzidPredaje.ODPIRA
        "ni-terminala" -> IzidPredaje.ZAGON_NI_TERMINALA
        "ni-claude" -> IzidPredaje.ZAGON_NI_CLAUDE
        "izklopljeno" -> IzidPredaje.ZAGON_IZKLOPLJENO
        "opozorilo" -> IzidPredaje.ZAGON_OPOZORILO
        "omejitev" -> IzidPredaje.ZAGON_OMEJITEV
        "napaka" -> IzidPredaje.ZAGON_NAPAKA
        else -> IzidPredaje.CLAUDE_CODE_NI // starejsa Lina brez razloga: kot prej
    }

    /** Naloga 23t: prva oddaja; 503 z razlogom zagona da razlog (ODPIRA = telefon caka na sejo). */
    fun izidPrve(ok: Boolean, nedosegljiva: Boolean, status: Int?, zagon: String?): IzidPredaje =
        izid(ok, nedosegljiva, status).let { if (it == IzidPredaje.CLAUDE_CODE_NI) izZagona(zagon) else it }

    /** Ponovna oddaja po odprti seji: nikoli ODPIRA (drugega kroga cakanja ni) - spet »odpira« pomeni, da se seja ni odprla. */
    fun izidPonovne(ok: Boolean, nedosegljiva: Boolean, status: Int?, zagon: String?): IzidPredaje =
        izidPrve(ok, nedosegljiva, status, zagon).let { if (it == IzidPredaje.ODPIRA) IzidPredaje.ZAGON_ROK else it }

    /** Rok cakanja: razlog, ce ga je racunalnik poslal, sicer ZAGON_ROK. */
    fun izidRoka(razlog: String?): IzidPredaje = izZagona(razlog).let { if (it == IzidPredaje.ODPIRA || it == IzidPredaje.CLAUDE_CODE_NI) IzidPredaje.ZAGON_ROK else it }

    /** Ime niza v res/values-xx/strings.xml za izid. */
    fun kljuc(izid: IzidPredaje): String = "local_task_" + izid.name.lowercase()

    /** Kratka številka naloge, ki jo je računalnik sprejel (prvih 8 znakov id-ja). */
    fun stevilka(id: String): String = id.take(8)

    private val TRDI_POSILJANJE = Regex("po[sš]iljam|poslala|predala|predajam", RegexOption.IGNORE_CASE)
    // \\b: »Nisem povezana« ni trditev povezave
    private val TRDI_POVEZAVO = Regex("\\b(sem povezana|povezana sem)\\b", RegexOption.IGNORE_CASE)
    private val O_RACUNALNIKU = Regex("nalog|računalnik|racunalnik|claude|global link|povezan", RegexOption.IGNORE_CASE)

    /** Ali besedilo govori o racunalniku, nalogi ali povezavi (takrat program pred oceno trditev izmeri dosegljivost, T4). */
    fun omenjaRacunalnik(besedilo: String): Boolean = O_RACUNALNIKU.containsMatchIn(besedilo)

    /** Oznaka v trajni zgodovini seje: racunalnik je nalogo sprejel (iz nje se ob ponovnem zagonu obnovi »zadnja naloga«). */
    const val OZNAKA_SPREJETA = "[program: računalnik je sprejel nalogo: "

    /**
     * Zadnja varovalka: stavek modela, ki trdi, kar program ni potrdil, zamenja dejstvo programa. Trditev o posiljanju velja samo,
     * ce je racunalnik v tej seji kako nalogo sprejel ([sprejeta]); trditev o povezavi samo, ce je racunalnik zdaj dosegljiv.
     * shortcut: prepozna samo slovenske oblike; ob novem jeziku ali obliki dodaj primer v ZvestobaVirom11Test.
     */
    fun brezLazneTrditve(besedilo: String, stanje: StanjeRacunalnika, sprejeta: Boolean = false): String {
        fun lazna(st: String) = O_RACUNALNIKU.containsMatchIn(st) &&
            ((!sprejeta && TRDI_POSILJANJE.containsMatchIn(st)) || (stanje != StanjeRacunalnika.DOSEGLJIV && TRDI_POVEZAVO.containsMatchIn(st)))
        // po vrsticah: vrstice z ukazi ([[zapisek: …]], [[opomnik: …]]) ostanejo cele in na svojem mestu
        var odstranjeno = false
        val vrstice = besedilo.lines().mapNotNull { v ->
            if (v.trim().startsWith("[[")) return@mapNotNull v
            val stavki = v.split(Regex("(?<=[.!?])\\s+"))
            val ostanek = stavki.filterNot(::lazna)
            if (ostanek.size == stavki.size) v else { odstranjeno = true; ostanek.joinToString(" ").ifBlank { null } }
        }
        if (!odstranjeno) return besedilo
        val ostalo = vrstice.joinToString("\n").trim()
        val dejstvo = when (stanje) {
            StanjeRacunalnika.NI_SEZNANJEN -> "Naloge nisem mogla poslati, ker telefon ni povezan z Lino na računalniku (Nastavitve > Računalnik)."
            StanjeRacunalnika.NEDOSEGLJIV -> "Naloge nisem mogla poslati, ker računalnik ni dosegljiv."
            StanjeRacunalnika.DOSEGLJIV -> "Naloga ni bila predana programu; povej, kaj naj pripravim, pa jo predlagam znova."
        }
        return if (ostalo.isEmpty()) dejstvo else "$dejstvo\n$ostalo"
    }
}
