package si.safeer.lina.samostojna

import java.text.Normalizer

/**
 * Denarni signal v besedilu uporabnika (prenos signalDenarja iz racunalnika, src/lib/lina/plast.ts) za navodilo za dostavo paketa.
 * shortcut: besede stevil brez valute (»petdeset«, stevilke.ts/stevniki, ~400 vrstic) niso prenesene - valuta, cena, »stane«, stevke in
 * decimalke so; prenesi stevniki, ce se signal uporabi za druga besedila telefona.
 */
internal object Denar {
    private const val MEJA = 2000

    private fun ocisti(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFKC)
        .replace(Regex("[\\u00AD\\u200B\\u200C\\u200D\\u2060\\uFEFF]"), "")
        .replace(Regex("&nbsp;", RegexOption.IGNORE_CASE), " ")
        .replace(' ', ' ')
        .take(MEJA)

    private fun zlozi(s: String): String = Paket.fold(ocisti(s))

    private val I = RegexOption.IGNORE_CASE
    private val CENA_KORENI = Regex("\\b(?:cen(?!ter)\\w*|kosta\\w*|costs?|znes\\w*|plac(?:a|e|il\\w*|at\\w*|an\\w*|uj\\w*)|racun(?!aln)\\w*|ddv|neto|bruto|polog\\w*|avans\\w*|popust\\w*|akcij\\w*|cenej\\w*|ugodn\\w*)\\b", I)
    private val VALUTA = Regex(
        "(?:€|\\$|£|\\beur\\b|\\beuro(?!park\\b)(?!palet)(?!\\s+[1-7]\\b)(?:s|v)?\\b|\\bevr(?!op)(?!o\\s+[1-7]\\b)(?:o\\b|i\\b|e\\b|a\\b|ov\\w*|om\\b|u\\b|ck\\w*)|" +
            "\\busd\\b|\\bchf\\b|\\bdin(?:ar\\w*)?\\b|\\bkun(?:a|e|o|i)?\\b|\\bcent(?:i|ov|a|e|u)?\\b)",
        I,
    )
    private val BREZPLACNO = Regex(
        "\\b(?:brezplac\\w*|zastonj\\w*|gratis|free)\\b|\\bno\\s+charge\\b|\\bbrez\\s+doplacil\\w*|\\bbrez\\s+strosk\\w*|\\bpodar(?:i|j)\\w*|\\bne\\s+zaracun\\w*|" +
            "\\bna\\s+nas\\s+racun\\w*|\\bvkljuc\\w*(?:\\s+\\w+){0,3}\\s+cen\\w*|\\bpolovicn\\w*\\s+cen\\w*",
        I,
    )
    private val SLENG = Regex("\\b(?:jur\\w*|stotak\\w*|stotk\\w*|tisocak\\w*|tisock\\w*|tavzent\\w*|kovac\\w*|cuk(?:a|i|e|ov|u)?)\\b", I)

    private val URA_RAZ = Regex("\\b\\d{1,2}[.:]\\d{2}\\s*[-–—]\\s*\\d{1,2}[.:]\\d{2}\\b")
    private val URA_KONTEKST = Regex("\\b(?:ob|od|do)\\s+\\d{1,2}[.:]\\d{2}\\b", I)
    private val DIMENZIJA = Regex("\\b\\d+(?:[.,]\\d+)?\\s*[x×]\\s*\\d+(?:[.,]\\d+)?(?:\\s*[x×]\\s*\\d+(?:[.,]\\d+)?)?(?:\\s*(?:cm|mm|m|kg))?", I)
    private val TELEFON = Regex("(?:\\+\\d[\\d\\s()./-]{6,16}\\d|\\b0\\d(?:[\\s./-]?\\d){6,12}\\b)")
    private val VARNA_NAPREJ = Regex(
        "(?:oseb\\w*|vrat\\w*|barv\\w*|teden\\w*|tedn\\w*|km|kg|nadstrop\\w*|dni|dneh|dne|dan\\w*|let\\w*|ur\\w*|minut\\w*|cm|mm|m|kuhinj\\w*|stol\\w*|miz\\w*|" +
            "omar\\w*|stopnic\\w*|izdelk\\w*|material\\w*|leto|leti|letih|leta)",
    )
    private val SPORNE_NAPREJ = Regex("(?:kos\\w*|evr\\w*|eur\\w*|cent\\w*)")
    private val PROZILNIK = setOf("je", "so", "pride", "prides", "stane", "stanejo", "po", "za")
    private val ULICA = Regex("(?:ulica|cesta|pot|trg|naselje|ova|eva|ska|cka|ina)$")

    private fun jeUraVKontekstu(text: String, raw: String): Boolean {
        val min = raw.split(Regex("[.:]")).getOrNull(1)?.toIntOrNull() ?: 0
        if (min > 59) return false
        val r = Regex.escape(raw)
        return Regex("(?:\\b(?:ob|od|do)\\s+$r|$r\\s*[-–—]|[-–—]\\s*$r)").containsMatchIn(text)
    }

    private data class Stevilo(val value: Long, val start: Int, val end: Int, val raw: String)

    private fun golaStevila(norm: String): String? {
        val folded = zlozi(norm)
        val skrito = listOf(URA_RAZ, URA_KONTEKST, DIMENZIJA, TELEFON).flatMap { re -> re.findAll(folded).map { it.range }.toList() }
        val stevila = Regex("\\d+").findAll(folded)
            .filter { m -> skrito.none { m.range.first in it } }
            .map { Stevilo(it.value.toLongOrNull() ?: Long.MAX_VALUE, it.range.first, it.range.last + 1, it.value) }
            .filter { it.value >= 10 }
        for (stev in stevila) {
            val prej = Regex("(\\p{L}+)\\s*[:,]?\\s*$").find(folded.substring(0, stev.start))?.groupValues?.get(1).orEmpty()
            val naprej = Regex("^\\s*[,.]?\\s*(\\p{L}+)").find(folded.substring(stev.end))?.groupValues?.get(1).orEmpty()
            val varnoNaprej = naprej.isNotEmpty() && VARNA_NAPREJ.matches(naprej) && !SPORNE_NAPREJ.matches(naprej)
            if (varnoNaprej) continue
            if (prej in PROZILNIK) return stev.raw
            val ulica = ULICA.containsMatchIn(prej)
            if (naprej.isEmpty()) {
                if (ulica && stev.value < 10000) continue
                return stev.raw
            }
            val izvirniPred = norm.substring(maxOf(0, stev.start - prej.length - 2).coerceAtMost(norm.length), stev.start.coerceAtMost(norm.length))
            val ime = prej.isNotEmpty() && Regex("\\p{Lu}").containsMatchIn(izvirniPred) && !ulica && prej !in PROZILNIK
            if (ime && stev.value >= 100) return stev.raw
            if (ime && SPORNE_NAPREJ.matches(naprej)) return stev.raw
        }
        return null
    }

    /** Sporni izsek ali null, ce besedilo nima denarnega signala. */
    fun signal(text: String): String? {
        if (text.isBlank()) return null
        val norm = ocisti(text)
        val folded = zlozi(norm)
        for (re in listOf(VALUTA, CENA_KORENI, BREZPLACNO, SLENG)) re.find(folded)?.let { return it.value }
        if (Regex("(?<!\\p{L})stane(?!\\p{L})").containsMatchIn(norm)) {
            val ime = Regex("\\bstane\\s+\\p{L}+(?:\\s+\\p{L}+)?\\s+pri\\s+telefonu\\b", I).containsMatchIn(norm) && !Regex("\\d|[€\$£]").containsMatchIn(norm)
            if (!ime) return "stane"
        }
        Regex("(?<![\\d.])\\d+e\\d+\\b", I).find(folded)?.let { return it.value }
        Regex("(?<!\\d)\\d(?:\\s+\\d){2,}(?!\\d)").find(folded)?.let { return it.value }
        if ('%' in folded) return "%"
        Regex("\\d{1,8}\\s*,\\s*-").find(folded)?.let { return it.value }
        Regex("(?<![\\p{L}\\p{N}])\\d{1,6}\\s+e\\b").find(folded)?.let { return it.value }
        Regex("(?<![\\d.,])\\d{1,3}\\s*k(?![\\p{L}\\p{N}])", I).find(folded)?.let { return it.value }
        for (dec in Regex("(?<!\\d)(\\d{1,6})[.,](\\d{2})(?!\\d)").findAll(folded)) {
            if (jeUraVKontekstu(folded, dec.value)) continue
            return dec.value
        }
        return golaStevila(norm)
    }
}
