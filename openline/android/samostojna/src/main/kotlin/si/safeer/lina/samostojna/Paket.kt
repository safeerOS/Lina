package si.safeer.lina.samostojna

import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Osebna tajnica na telefonu: dostava paketa (lastnik 23. 11. 2026, pojasnilo 24. 11. 2026). Ista pravila kot racunalnik (src/lib/lina/paket.ts):
 * ko se klicatelj predstavi kot dostava (Pošta Slovenije, DPD, GLS, DHL, UPS, Express One, InPost, kurir, »imam paket za vas«), Lina rece
 * »Paket pričakujemo. Prosim, pustite ga pred hišo.« (ali na mestu, ki ga je izbral uporabnik). Brez imena lastnika (to slisi vsak, ki
 * rece »tukaj DPD«), najvec enkrat na klic, nikoli v pozdravu ali sistemskem navodilu. Cista koda (brez Androida, omrezja in datotek).
 * Kljuci nastavitev so isti kot na racunalniku: paketVklop, paketMesto (pred_hiso | drugo), paketNavodilo, paketDo.
 */
object Paket {
    const val NAJVEC_ZNAKOV = 160
    const val MESTO_PRED_HISO = "pred_hiso"
    const val MESTO_DRUGO = "drugo"
    private const val PRED_HISO_BESEDILO = "pred hišo"
    private val PAS: ZoneId = ZoneId.of("Europe/Ljubljana")

    /** [mesto] = MESTO_PRED_HISO ali MESTO_DRUGO; [navodilo] = lastno mesto (samo pri MESTO_DRUGO); [doDne] = LLLL-MM-DD ali prazno. */
    data class Nastavitve(val vklop: Boolean = false, val mesto: String = MESTO_PRED_HISO, val navodilo: String = "", val doDne: String = "")

    enum class Razlog { DOLZINA, KODA, DENAR }

    /** fold iz guards.ts: NFD, brez naglasnih znamenj, male crke. */
    internal fun fold(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).replace(ZNAMENJA, "").lowercase().trim()

    /** nfkcVrstica iz odsotnost.ts (JS \s z zastavico u je Unicode; v Javi ga nastejemo). */
    internal fun nfkcVrstica(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFKC).replace(PRESLEDKI, " ").trim()

    /** Navodilo v eni vrstici, najvec NAJVEC_ZNAKOV (z zakljucnim locilom samo, ce je prostor). */
    fun normiraj(surovo: String?): String {
        if (surovo == null) return ""
        val v = nfkcVrstica(surovo).take(NAJVEC_ZNAKOV)
        return if (v.isNotEmpty() && v.last() !in ".!?" && v.length < NAJVEC_ZNAKOV) "$v." else v
    }

    fun jeDatum(s: String): Boolean {
        val m = DATUM.matchEntire(s) ?: return false
        val (l, me, d) = m.destructured
        if (l.toInt() !in 2000..2099) return false
        return runCatching { LocalDate.of(l.toInt(), me.toInt(), d.toInt()) }.isSuccess
    }

    fun normirajDo(surovo: String?): String = surovo?.trim()?.takeIf { jeDatum(it) }.orEmpty()

    fun doNeveljaven(surovo: String?): Boolean = surovo != null && surovo.trim().isNotEmpty() && normirajDo(surovo).isEmpty()

    /** Najdaljsi niz zaporednih »stevk«: skupina stevk steje svoje stevke, beseda stevila eno. */
    private fun najvecStevk(f: String): Int {
        var naj = 0
        var zdaj = 0
        for (kos in f.split(LOCILA_KOSOV).map { it.replace(ROBNA_LOCILA, "") }) {
            val n = when {
                kos.isNotEmpty() && kos.all { it in '0'..'9' } -> kos.length
                BESEDA_STEVILA.matches(kos) -> 1
                else -> 0
            }
            zdaj = if (n > 0) zdaj + n else 0
            naj = maxOf(naj, zdaj)
        }
        return naj
    }

    /**
     * Razlog zavrnitve navodila (null = v redu), enako kot razlogPaketa: dolzina, DOSTOP (stiri zaporedne stevke, tudi z besedami; koda,
     * geslo, PIN, sifra, kljuc, odklenjen, odprt) in denarni signal. Postna stevilka pred krajem (»1000 Ljubljana«) je dovoljena.
     */
    fun razlog(surovo: String?): Razlog? {
        if (surovo == null) return null
        val v = nfkcVrstica(surovo)
        if (v.isEmpty()) return null
        if (v.length > NAJVEC_ZNAKOV) return Razlog.DOLZINA
        val brezPostne = if (BESEDA_VHODA.containsMatchIn(fold(v))) v else POSTNA.replace(v) { m -> m.value.replace(Regex("\\d"), "#") }
        val f = fold(brezPostne)
        if (STIRI_STEVKE.containsMatchIn(brezPostne.replace(PRESLEDEK_ALI_VEZAJ, "")) || najvecStevk(f) >= 4 || BESEDA_DOSTOPA.containsMatchIn(f)) return Razlog.KODA
        return if (Denar.signal(brezPostne.replace("####", "")) != null) Razlog.DENAR else null
    }

    private fun danes(zdaj: Instant): String = zdaj.atZone(PAS).toLocalDate().toString()

    /** Mesto za stavek (»pred hišo«, »pri sosedu na št. 5«) ali "", ce dostava ta trenutek ni vklopljena ali nastavitev ni veljavna. */
    fun aktivnoMesto(n: Nastavitve, zdaj: Instant): String {
        if (!n.vklop) return ""
        if (doNeveljaven(n.doDne)) return ""
        val doDne = normirajDo(n.doDne)
        if (doDne.isNotEmpty() && danes(zdaj) > doDne) return ""
        if (n.mesto != MESTO_DRUGO) return PRED_HISO_BESEDILO
        if (normiraj(n.navodilo).isEmpty() || razlog(n.navodilo) != null) return ""
        return mestoVStavku(n.navodilo)
    }

    /**
     * Lastno mesto kot del stavka »… pustite ga <mesto>.«: brez koncnega locila in brez ponovljenega »Pustite ga«; prva crka mala, razen ce je
     * beseda kratica (»DPD«) - »Pri sosedu« postane »pri sosedu«.
     */
    internal fun mestoVStavku(surovo: String): String {
        var m = normiraj(surovo).trimEnd('.', '!', '?', ' ')
        m = m.replace(PONOVLJEN_UVOD, "").trim()
        if (m.length > 1 && m[0].isUpperCase() && !m[1].isUpperCase()) m = m[0].lowercase() + m.substring(1)
        return m
    }

    /** Stavek, ki ga Lina pove dostavljalcu (pojasnilo lastnika 24. 11. 2026). */
    fun odgovor(mesto: String): String = "Paket pričakujemo. Prosim, pustite ga $mesto."

    /** Stavek za ta klic ali "" (izklopljeno, poteklo ali neveljavno). */
    fun odgovorZaKlic(n: Nastavitve, zdaj: Instant): String = aktivnoMesto(n, zdaj).let { if (it.isEmpty()) "" else odgovor(it) }

    /**
     * Klicatelj se predstavi kot dostava (seznam DOVOLJENEGA kot jeDostava v paket.ts). [celIzrek] = false: izrek se se nadaljuje (odlomek
     * prepisa), zato velja samo vzorec, ki ga nadaljevanje ne more spremeniti v nedostavo - »Dostava« sama je dostava samo kot cel izrek
     * (»Dostava paketa zamuja« ni).
     */
    fun jeDostava(izrek: String, celIzrek: Boolean = true): Boolean {
        val k = fold(izrek).replace(NE_CRKA, " ").replace(Regex("\\s+"), " ").trim()
        if (k.isEmpty()) return false
        if (ZANIKANJE.containsMatchIn(k)) return false
        return VZORCI_DOSTAVE.withIndex().any { (i, v) -> (celIzrek || i !in SAMO_CEL_IZREK) && v.containsMatchIn(k) }
    }

    private val ZNAMENJA = Regex("\\p{M}")
    private val PRESLEDKI = Regex("[\\s\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
    private val DATUM = Regex("(\\d{4})-(\\d{2})-(\\d{2})")
    private val LOCILA_KOSOV = Regex("[\\s,;-]+")
    private val ROBNA_LOCILA = Regex("^[^\\p{L}\\d]+|[^\\p{L}\\d]+$")
    private val STIRI_STEVKE = Regex("\\d{4,}")
    private val PRESLEDEK_ALI_VEZAJ = Regex("[\\s-]")
    private val NE_CRKA = Regex("[^\\p{L}\\d ]+")
    private val PONOVLJEN_UVOD = Regex("^(?:prosim,?\\s+)?pustite\\s+(?:ga|paket)(?:,?\\s+prosim)?,?\\s+", RegexOption.IGNORE_CASE)

    private val BESEDA_STEVILA = Regex(
        "(?:nic|nula|ena|en|eno|dva|dve|tri|stiri|pet|sest|sedem|osem|devet|deset|enajst|dvanajst|trinajst|stirinajst|petnajst|sestnajst|" +
            "sedemnajst|osemnajst|devetnajst|dvajset|trideset|stirideset|petdeset|sestdeset|sedemdeset|osemdeset|devetdeset|sto|tisoc)",
    )
    /** Postna stevilka pred krajem NA KONCU navodila ali pred locilom (»1000 Ljubljana«, »2000 Maribor,«). */
    private val POSTNA = Regex("(?<!\\d)[1-9]\\d{3}\\s+\\p{Lu}\\p{Ll}+(?:\\s+(?:ob\\s+|na\\s+|pri\\s+)?\\p{Lu}\\p{Ll}+)?(?=\\s*(?:[,.;!]|$))")
    private val BESEDA_VHODA = Regex("(?<![a-z])(?:vrat|vhod|tipkovnic|kombinacij|domofon|vpis|vtipka)")
    private val BESEDA_DOSTOPA = Regex(
        "(?<![a-z])(?:kod[aeio]|kodam\\w*|geslo|gesla|geslom|gesli|pin|pina|pinom|sifr[aeio]|sifrant\\w*|kljuc(?:a|u|em|i|e|ev|ema|ih|ka|ki|ek)?|" +
            "odklenjen\\w*|odklepa\\w*|odklenil\\w*|odprt[aeiou]?|odprti\\w*)(?![a-z])",
    )

    private const val SLUZBE = "(?:post[ae] slovenije|post[ae]|dpd|gls|dhl|ups|express one|expressone|inpost|in post)"
    private const val SLUZBE_ZACETEK = "(?:post[ae] slovenije|dpd|gls|dhl|express one|expressone|inpost|in post)"
    private const val SLUZBE_SAME = "(?:posta slovenije|dpd|gls|dhl|express one|expressone|inpost)"
    private const val VLOGA = "(?:dostavlja(?:lec|lka|lci|lca|vec|vka|vci|vca)|kurir(?:ka|ji|ja|ju)?|dostavn\\w* sluzb\\w*|kurirsk\\w* sluzb\\w*)"
    private const val DOSTAVNO = "(?:dostava|$VLOGA|paket (?:imam|za)|posiljk\\w* (?:imam|za))"
    private const val POZDRAV = "(?:(?:dober dan|dobro jutro|pozdravljeni|zdravo|halo) )?"
    private val ZANIKANJE = Regex("(?<![a-z])(?:nisem|nismo|ne klicem)(?: [a-z]+)? (?:$VLOGA|(?:iz|od|z|s) $SLUZBE)(?![a-z])")
    private val VZORCI_DOSTAVE = listOf(
        Regex("(?<![a-z])(?:(?:tukaj|tu je)(?: [a-z]+)?|jaz sem|klicem|klice vas|vas klice|sem|smo) (?:iz|od|z|s) $SLUZBE(?![a-z])"),
        Regex("(?<![a-z])(?:(?:tukaj|tu je) (?:$SLUZBE|dostava|(?:[a-z]+ )?$VLOGA)|jaz sem (?:$SLUZBE|dostava|$VLOGA)|(?:sem|smo) $VLOGA)(?![a-z])"),
        Regex("^$POZDRAV(?:$SLUZBE_ZACETEK|$VLOGA|dostava) (?:tukaj|dober dan|pozdravljeni|halo|za vas|imam|$DOSTAVNO)(?![a-z])"),
        Regex("^$POZDRAV(?:ups|post[ae]) $DOSTAVNO(?![a-z])"),
        Regex("^$POZDRAV$VLOGA (?:(?:iz|od|z|s) )?$SLUZBE(?![a-z])"),
        Regex("^$POZDRAV(?:$SLUZBE_SAME|$VLOGA|dostava)$"),
        Regex("(?<![a-z])(?:(?:imam|nosim|pripeljal\\w*|prinesel\\w*|prinesla)(?: (?:en|eno|neki|nek))? (?:paket|posiljk\\w*) za|dostavljam(?: (?:en|eno|neki|nek|vam))? (?:paket|posiljk\\w*))(?![a-z])"),
        Regex("(?<![a-z])(?:paket|posiljka|posiljko) (?:je )?za vas(?![a-z])"),
    )
    /** Vzorci, zasidrani na konec izreka (»DPD.« ali »Dostava!« sama): veljajo sele, ko je izrek koncan. */
    private val SAMO_CEL_IZREK = setOf(5)
}
