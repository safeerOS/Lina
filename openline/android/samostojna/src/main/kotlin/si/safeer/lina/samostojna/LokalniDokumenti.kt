package si.safeer.lina.samostojna

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.text.Normalizer
import java.util.Locale
import java.util.zip.ZipInputStream

/**
 * Lokalno iskanje po dokumentih (lastnik 23. 11. 2026): cista logika brez Androida. Indeks in OCR sta v modulu app
 * (FTS4 in ML Kit); tu so prepoznava ukaza v pogovoru, branje TXT/DOCX, normalizacija in varna poizvedba MATCH.
 * Besedilo dokumentov se ne poslje v oblak: rezultat iskanja vidi samo uporabnik, dokler ga sam ne poslje v pogovor.
 */
enum class VrstaDokumenta { BESEDILO, PDF, DOCX, SLIKA }

/** Najvec bajtov ene datoteke za branje (vecje se preskocijo). */
const val NAJVEC_BAJTOV_DOKUMENTA = 25 * 1024 * 1024
/** Meja razpakiranega word/document.xml (varovalo pred zip bombo). */
const val NAJVEC_BAJTOV_DOCX_XML = 40 * 1024 * 1024

fun vrstaDokumenta(ime: String, mime: String?): VrstaDokumenta? {
    val m = mime.orEmpty().lowercase(Locale.ROOT)
    val koncnica = ime.substringAfterLast('.', "").lowercase(Locale.ROOT)
    return when {
        m == "application/pdf" || koncnica == "pdf" -> VrstaDokumenta.PDF
        m == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || koncnica == "docx" -> VrstaDokumenta.DOCX
        m.startsWith("image/") && koncnica != "svg" && m != "image/svg+xml" -> VrstaDokumenta.SLIKA
        koncnica in setOf("jpg", "jpeg", "png", "webp", "heic", "heif", "bmp") -> VrstaDokumenta.SLIKA
        m.startsWith("text/") || koncnica in setOf("txt", "md", "csv", "log") -> VrstaDokumenta.BESEDILO
        else -> null
    }
}

/** Besedilo iz bajtov: UTF-8 (brez BOM); neveljaven UTF-8 se prebere kot windows-1250 (starejse slovenske datoteke). */
// shortcut: zelo kratko besedilo samih sumnikov v windows-1250 je lahko slucajno veljaven UTF-8 (npr. »čšž«); ce bo to tezava, dodaj zaznavo po pogostosti znakov.
fun besediloIzBajtov(b: ByteArray): String {
    val brezBom = if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte()) b.copyOfRange(3, b.size) else b
    return try {
        Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(brezBom)).toString()
    } catch (_: CharacterCodingException) {
        String(brezBom, Charset.forName("windows-1250"))
    }
}

/**
 * Besedilo iz DOCX (zip z word/document.xml): <w:t> je besedilo, </w:p> nova vrstica, <w:tab/> tabulator, <w:br/> prelom.
 * Brez razclenjevalnika XML (ni DTD, ni zunanjih entitet); null, ce datoteka ni DOCX ali je razpakirana vsebina prevelika.
 */
fun besediloDocx(b: ByteArray, najvec: Int = NAJVEC_BAJTOV_DOCX_XML): String? {
    val xml = runCatching { ZipInputStream(ByteArrayInputStream(b)).use { preberiVnos(it, "word/document.xml", najvec) } }.getOrNull() ?: return null
    val sb = StringBuilder()
    val oznaka = Regex("<(/?)w:(t|p|tab|br|cr)(?=[\\s>/])[^>]*?(/?)>")
    var vBesedilu = false
    var zadnji = 0
    for (m in oznaka.findAll(xml)) {
        if (vBesedilu) sb.append(odkodirajXml(xml.substring(zadnji, m.range.first)))
        val zapiranje = m.groupValues[1] == "/"
        val samozaprt = m.groupValues[3] == "/"
        when (m.groupValues[2]) {
            "t" -> vBesedilu = !zapiranje && !samozaprt
            "p" -> if (zapiranje) sb.append('\n')
            "tab" -> sb.append('\t')
            "br", "cr" -> sb.append('\n')
        }
        zadnji = m.range.last + 1
    }
    return sb.toString().trim()
}

private fun preberiVnos(zip: ZipInputStream, ime: String, najvec: Int): String? {
    var vnos = zip.nextEntry
    while (vnos != null && vnos.name != ime) vnos = zip.nextEntry
    if (vnos == null) return null
    val izhod = java.io.ByteArrayOutputStream()
    val med = ByteArray(64 * 1024)
    var n = zip.read(med)
    while (n >= 0) {
        if (izhod.size() + n > najvec) return null
        izhod.write(med, 0, n)
        n = zip.read(med)
    }
    return izhod.toString("UTF-8")
}

private fun odkodirajXml(s: String): String {
    if ('&' !in s) return s
    return Regex("&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);").replace(s) { m ->
        val e = m.groupValues[1]
        when {
            e == "amp" -> "&"; e == "lt" -> "<"; e == "gt" -> ">"; e == "quot" -> "\""; e == "apos" -> "'"
            e.startsWith("#x") -> e.drop(2).toIntOrNull(16)?.takeIf { Character.isValidCodePoint(it) }?.let { String(Character.toChars(it)) } ?: ""
            else -> e.drop(1).toIntOrNull()?.takeIf { Character.isValidCodePoint(it) }?.let { String(Character.toChars(it)) } ?: ""
        }
    }
}

/**
 * Oblika za indeks in poizvedbo: male crke, brez stresic (c = c, s = s, z = z), samo crke in stevke, presledki med njimi.
 * Indeks hrani to obliko (FTS4 s privzetim razclenjevalnikom), zato iskanje ni odvisno od gradnje SQLite na telefonu.
 */
fun normalizirajZaIskanje(s: String): String {
    val brez = Normalizer.normalize(s.lowercase(Locale.ROOT), Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "")
        .replace('đ', 'd').replace('ł', 'l').replace('ø', 'o').replace("ß", "ss")
    return brez.replace(Regex("[^\\p{L}\\p{Nd}]+"), " ").trim()
}

private val MASILA = setOf(
    "in", "ali", "je", "so", "sem", "si", "da", "ki", "na", "za", "od", "do", "po", "pri", "iz", "se", "ne", "to", "ta", "kaj", "kje",
    "kdo", "kako", "moj", "moja", "moje", "mojih", "mi", "me", "o", "v", "z", "s", "k", "a", "the", "and", "or", "of", "for", "in", "my", "to",
    "der", "die", "das", "und", "el", "la", "los", "las", "y", "de", "le", "les", "et", "il", "lo", "e", "di",
)

/**
 * Poizvedba MATCH za FTS4 iz besedila uporabnika: samo crke in stevke (nobenih operatorjev, narekovajev ali stolpcev),
 * do 8 besed, vse morajo biti v zadetku (AND), vsaka kot predpona; daljsim besedam se odreze koncni samoglasnik
 * (pogodbo -> pogodb* najde tudi pogodba). null, ce ne ostane nobena beseda.
 */
fun poizvedbaFts(vprasanje: String): String? {
    val besede = normalizirajZaIskanje(vprasanje).split(' ')
        .filter { it.length >= 2 && it !in MASILA }
        .distinct().take(8)
        .map { if (it.length >= 5 && it.last() in "aeiou") it.dropLast(1) else it }
        .map { "$it*" }
    return besede.takeIf { it.isNotEmpty() }?.joinToString(" ")
}

private val UKAZ_ISKANJA = Regex(
    "^(?:lina\\s+)?(?:" +
        "(?:poisci|najdi|isci|preisci)\\s+(?:mi\\s+)?(?:v|po)\\s+(?:mojih\\s+|svojih\\s+)?dokumentih|" +
        "(?:v|po)\\s+(?:mojih\\s+|svojih\\s+)?dokumentih\\s+(?:poisci|najdi|isci)|" +
        "(?:search|find|look)\\s+(?:in|through)?\\s*my\\s+(?:documents|docs|files)(?:\\s+for)?|" +
        "(?:suche|finde|durchsuche)\\s+(?:in\\s+)?meine[n]?\\s+dokumente[n]?(?:\\s+nach)?|" +
        "(?:busca|encuentra)\\s+en\\s+mis\\s+documentos|" +
        "(?:cherche|trouve)\\s+dans\\s+mes\\s+documents|" +
        "(?:cerca|trova)\\s+nei\\s+miei\\s+documenti" +
        ")(?:\\s+(.*))?$",
)

/**
 * Ukaz »poisci v mojih dokumentih ...« (tudi brez sumnikov in v en, de, es, fr, it): vrne iskani niz (normaliziran) ali
 * null, ce besedilo ni tak ukaz ali iskani niz manjka. Sprozilec je strog: zahteva besedo »dokumentih« (documents ...),
 * da obicajno vprasanje ne konca v lokalnem iskanju namesto pri Lini.
 */
fun zahtevaIskanjaVDokumentih(vnos: String): String? {
    val n = normalizirajZaIskanje(vnos)
    val m = UKAZ_ISKANJA.matchEntire(n) ?: return null
    return m.groupValues[1].trim().takeIf { it.isNotEmpty() && poizvedbaFts(it) != null }
}

/**
 * Razrez besedila na kose za vrstice indeksa (kratki izrezki, hitrejse iskanje): kos do [velikost] znakov, rez na
 * presledku, ce je v zadnji cetrtini kosa. Prazni kosi se izpustijo.
 */
fun razreziZaIndeks(besedilo: String, velikost: Int = 2000): List<String> {
    require(velikost >= 100)
    val kosi = mutableListOf<String>()
    var i = 0
    while (i < besedilo.length) {
        var konec = minOf(besedilo.length, i + velikost)
        if (konec < besedilo.length) {
            val presledek = besedilo.lastIndexOf(' ', konec)
            if (presledek > i + velikost * 3 / 4) konec = presledek
        }
        besedilo.substring(i, konec).trim().takeIf { it.isNotEmpty() }?.let { kosi += it }
        i = konec
    }
    return kosi
}

/** Izrezek okoli prvega zadetka v izvirnem besedilu (za prikaz): ujemanje po normalizirani obliki, okno [okno] znakov. */
fun izrezekZadetka(izvirnik: String, poizvedba: String, okno: Int = 160): String {
    val predpone = poizvedba.split(' ').map { it.removeSuffix("*") }.filter { it.isNotEmpty() }
    // normalizacija ohrani dolzino crk (stresice se odstranijo kot locen znak NFD), zato iscemo po besedah izvirnika
    val besede = Regex("[\\p{L}\\p{Nd}]+").findAll(izvirnik)
    val zadetek = besede.firstOrNull { b -> val nb = normalizirajZaIskanje(b.value); predpone.any { nb.startsWith(it) } }
    val sredina = zadetek?.range?.first ?: 0
    val od = maxOf(0, sredina - okno / 3)
    val doo = minOf(izvirnik.length, od + okno)
    val jedro = izvirnik.substring(od, doo).replace(Regex("\\s+"), " ").trim()
    return (if (od > 0) "…" else "") + jedro + (if (doo < izvirnik.length) "…" else "")
}
