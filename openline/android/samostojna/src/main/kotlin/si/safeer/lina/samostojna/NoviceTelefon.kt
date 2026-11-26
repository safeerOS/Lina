package si.safeer.lina.samostojna

import java.net.URI
import java.text.Normalizer

/**
 * Naloga 32 (lastnik 26. 11. 2026, »Zakaj ne zna novice dneva«): novice v pogovoru na telefonu brez nastavljanja. Namero razbere
 * KODA (isti vzorec kot racunalnik, novice-pogovor.ts), odgovor sestavi KODA iz javnih virov RSS (stalni naslovi https, brez kljuca);
 * model naslovov ne dobi kot navodilo. Za »novice o X« brez zadetka in s kljucem Brave odgovori model z obstojecim orodjem [[iskanje:]].
 */
object NoviceTelefon {
    /** Privzeti javni viri (enaki kot racunalnik). NEPREVERJENO z omrezjem 26. 11. 2026: preveri na testnem PC / napravi. */
    val PRIVZETI_VIRI: List<Pair<String, String>> = listOf(
        "RTV SLO" to "https://img.rtvslo.si/feeds/00.xml",
        "STA" to "https://www.sta.si/rss-0",
    )
    const val NOVIC_V_ODGOVORU = 6
    private const val MEJA_VPRASANJA = 160
    private const val MEJA_NA_VIR = 25

    data class Namera(val tema: String?)
    data class Novica(val naslov: String, val povezava: String, val vir: String)

    private fun normaliziraj(s: String): String =
        Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").replace(Regex("\\s+"), " ").trim()

    // slepi pregled S4 (enako kot racunalnik): tema samo z »o«, »o temi«, »na temo«
    private const val UVOD = "(?:(?:lina|prosim|hej|zivjo)[,!]? )?(?:(?:kaj|katere|kaksne) so (?:danes )?|povej(?: mi)? |preberi(?: mi)? |pokazi(?: mi)? |daj(?: mi)? |imas |zanimajo me |kje so )?"
    private const val PRIDEVNIK = "(?:(?:danasnje|dnevne|zadnje|najnovejse|glavne|sveze|aktualne|jutranje|vecerne|pomembne) )?"
    private const val OKVIR = "(?: (?:dneva|danes|za danes|iz slovenije|v sloveniji|iz sveta|po svetu|doma))?"
    private const val TEMA = "(?: (?:o temi|na temo|o) (.{2,80}))?"
    private val RE_NOVICE = Regex("^$UVOD$PRIDEVNIK(?:novice|novic|novica|novosti)$OKVIR$TEMA$")
    private val RE_NOVEGA = Regex("^${UVOD}kaj je (?:danes )?novega(?: (?:v svetu|po svetu|doma|v sloveniji|danes))?(?: o (.{2,80}))?$")
    private val KONEC = Regex("[?!.…]+$")

    /** Ali uporabnik sprasuje po novicah (celo sporocilo, brez povezave); tema iz »novice o X«. */
    fun namera(besedilo: String): Namera? {
        if (besedilo.length > MEJA_VPRASANJA || Regex("https?:|www\\.", RegexOption.IGNORE_CASE).containsMatchIn(besedilo)) return null
        val s = normaliziraj(besedilo).replace(KONEC, "").trim()
        val m = RE_NOVICE.matchEntire(s) ?: RE_NOVEGA.matchEntire(s) ?: return null
        val tema = m.groupValues.getOrNull(1)?.trim().orEmpty()
        if (tema.isEmpty()) return Namera(null)
        val izvirno = besedilo.replace(Regex("\\s+"), " ").trim().replace(KONEC, "").trim()
        return Namera(izvirno.takeLast(tema.length).trim().ifEmpty { tema })
    }

    private fun koreni(tema: String): List<String> =
        normaliziraj(tema).split(Regex("[^\\p{L}\\p{N}]+")).filter { it.length >= 3 }
            .map { if (it.length > 5) it.dropLast(2) else it.take(maxOf(3, it.length - 1)) }

    fun poTemi(novice: List<Novica>, tema: String): List<Novica> {
        val k = koreni(tema)
        if (k.isEmpty()) return novice
        return novice.filter { n -> val b = normaliziraj(n.naslov); k.any { b.contains(it) } }
    }

    fun izmenicno(novice: List<Novica>, najvec: Int = NOVIC_V_ODGOVORU): List<Novica> {
        val skupine = novice.groupBy { it.vir }.values.toList()
        val ven = mutableListOf<Novica>()
        var i = 0
        while (ven.size < najvec) {
            var dodano = false
            for (s in skupine) if (i < s.size && ven.size < najvec) { ven.add(s[i]); dodano = true }
            if (!dodano) break
            i++
        }
        return ven
    }

    /** Besedilo vira je podatek: brez kontrolnih in nevidnih znakov in brez oznak [[ ]] (ne smejo postati vrstica orodja). */
    fun cistNaslov(s: String): String =
        s.replace(Regex("[\\p{Cc}\\p{Cf}\\u2028\\u2029]"), " ").replace(Regex("\\[\\[|]]|<<<|>>>"), " ")
            .replace(Regex("\\s+"), " ").trim().take(200)

    fun cistaPovezava(s: String): String? = try {
        val u = URI(s.trim())
        if (u.scheme != "https" || u.host.isNullOrEmpty() || u.rawUserInfo != null || s.length > 500) null
        else u.toString().replace("[", "%5B").replace("]", "%5D")
    } catch (e: Exception) {
        null
    }

    /** Odgovor z novicami po glavi (enako kot racunalnik jeOdgovorNovic): sinhronizacija nese samo besedilo, ne oznake. */
    fun jeOdgovorNovic(besedilo: String): Boolean = Regex("^(?:Novice dneva \\(|Novice o temi »|O temi »[^\\n]{1,200}« v virih \\()").containsMatchIn(besedilo)

    /** Zapis namesto naslovov (spomin, uvoz s racunalnika): naslovi so podatek tretjih, ne Linina beseda. */
    const val ZAPIS_NOVIC = "[program: uporabniku so bili prikazani naslovi novic iz javnih virov]"

    private fun entitete(s: String): String =
        s.replace(Regex("&#x([0-9a-fA-F]{1,6});")) { m -> m.groupValues[1].toInt(16).let { if (it in 1..0x10FFFF) String(Character.toChars(it)) else "" } }
            .replace(Regex("&#(\\d{1,7});")) { m -> m.groupValues[1].toInt().let { if (it in 1..0x10FFFF) String(Character.toChars(it)) else "" } }
            .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&nbsp;", " ").replace("&amp;", "&")

    /** Zacetek znacke <ime (za njo presledek, > ali /); vsako iskanje je linearno (slepi pregled S2: lenivi regex je bil kvadraten). */
    private fun zacetekZnacke(s: String, ime: String, od: Int): Int {
        var i = od
        while (true) {
            val z = s.indexOf("<$ime", i, ignoreCase = true)
            if (z < 0) return -1
            val c = s.getOrNull(z + ime.length + 1)
            if (c == null || c == '>' || c == '/' || c.isWhitespace()) return z
            i = z + 1
        }
    }

    private fun besediloZnacke(blok: String, ime: String): String? {
        val z = zacetekZnacke(blok, ime, 0)
        if (z < 0) return null
        val gt = blok.indexOf('>', z)
        if (gt < 0 || blok[gt - 1] == '/') return null
        val k = blok.indexOf("</$ime>", gt + 1, ignoreCase = true)
        if (k < 0) return null
        val v = blok.substring(gt + 1, k).take(8000).trim().removePrefix("<![CDATA[").removeSuffix("]]>")
        return entitete(v.replace(Regex("<[^<>]*>"), " ")).trim()
    }

    /** Bloki <ime>...</ime> v linearnem casu; brez zakljucne znacke se iskanje konca. */
    private fun bloki(xml: String, ime: String): List<String> {
        val ven = mutableListOf<String>()
        var i = 0
        while (ven.size < 200) {
            val z = zacetekZnacke(xml, ime, i)
            if (z < 0) break
            val k = xml.indexOf("</$ime>", z, ignoreCase = true)
            if (k < 0) break
            ven.add(xml.substring(z, k))
            i = k + ime.length + 3
        }
        return ven
    }

    /** RSS (item) ali Atom (entry): naslov in povezava; neveljavne postavke izpusti. */
    fun razberi(xml: String, vir: String): List<Novica> {
        val bloki = bloki(xml, "item").ifEmpty { bloki(xml, "entry") }
        return bloki.mapNotNull { b ->
            val naslov = cistNaslov(besediloZnacke(b, "title") ?: return@mapNotNull null)
            val povezava = besediloZnacke(b, "link")?.takeIf { it.isNotEmpty() }
                ?: Regex("<link[^<>]*href=\"([^\"<>]+)\"", RegexOption.IGNORE_CASE).find(b)?.groupValues?.get(1)?.let(::entitete)
            val p = povezava?.let(::cistaPovezava)
            if (naslov.isEmpty() || p == null) null else Novica(naslov, p, vir)
        }.take(MEJA_NA_VIR)
    }

    private fun vrstice(n: List<Novica>): List<String> = n.map { "- ${cistNaslov(it.naslov)} (${cistNaslov(it.vir).take(40)}): ${it.povezava}" }

    /** Odgovor (nikoli »nimam dostopa«). */
    fun odgovor(tema: String?, izbrane: List<Novica>, splosne: List<Novica>, viri: List<String>, brave: Boolean): String {
        val v = viri.joinToString(", ")
        val opomba = "\n\nTo so javni viri (${PRIVZETI_VIRI.joinToString(", ") { it.first }})."
        if (izbrane.isNotEmpty()) {
            val glava = if (tema != null) "Novice o temi »${cistNaslov(tema)}« ($v):" else "Novice dneva ($v):"
            return glava + "\n" + vrstice(izbrane.take(NOVIC_V_ODGOVORU)).joinToString("\n") + opomba
        }
        if (tema != null && splosne.isNotEmpty()) {
            val namig = if (brave) "" else " Za iskanje po celem spletu dodajte ključ Brave v Nastavitvah."
            return "O temi »${cistNaslov(tema)}« v virih ($v) zdaj ni novic.$namig Najnovejše:\n" + vrstice(splosne.take(3)).joinToString("\n") + opomba
        }
        return "Virov novic (${PRIVZETI_VIRI.joinToString(", ") { it.first }}) trenutno ne morem doseči. Poskusite čez nekaj minut."
    }
}

/**
 * Bere privzete vire (predpomnilnik 10 min) in sestavi odgovor. Slepi pregled S3: vira vzporedno s skupnim rokom (pocasen streznik ne
 * zadrzi niti pogovora), zaklep samo za predpomnilnik, ne med omrezjem; napaka enega vira ne podre odgovora.
 */
class BralnikNovic(
    private val prenos: Prenos,
    private val zdaj: () -> Long = { System.currentTimeMillis() },
    private val rokMs: Long = ROK_MS_SKUPAJ,
) {
    private val zaklep = Any()
    private var predpomnilnik: Pair<Long, Pair<List<NoviceTelefon.Novica>, List<String>>>? = null

    // K2-6 (slepi pregled): nit vira ne sme pasti z izjemo (prenos ali razbiranje) - sesula bi aplikacijo
    private fun preberiVir(ime: String, url: String): Pair<String, List<NoviceTelefon.Novica>>? = try {
        val odg = prenos.get(url, mapOf("Accept" to "application/rss+xml, application/atom+xml, application/xml;q=0.9", "User-Agent" to "Lina/1.0 (bralnik novic)"), 8_000L)
        if (odg.koda != 200) null else NoviceTelefon.razberi(odg.telo, ime).takeIf { it.isNotEmpty() }?.let { ime to it }
    } catch (e: Exception) {
        null
    }

    private fun preberi(): Pair<List<NoviceTelefon.Novica>, List<String>> {
        synchronized(zaklep) { predpomnilnik?.let { (cas, v) -> if (zdaj() - cas in 0 until ROK_MS) return v } }
        val izidi = arrayOfNulls<Pair<String, List<NoviceTelefon.Novica>>>(NoviceTelefon.PRIVZETI_VIRI.size)
        // shortcut: nit, ki se ob roku ne konca (blokirno branje HttpURLConnection), tece do svojega roka branja v ozadju (daemon)
        val niti = NoviceTelefon.PRIVZETI_VIRI.mapIndexed { i, (ime, url) ->
            Thread { val r = preberiVir(ime, url); synchronized(izidi) { izidi[i] = r } }.apply { isDaemon = true; name = "lina-novice-$i"; start() }
        }
        val konec = System.nanoTime() + rokMs * 1_000_000
        for (t in niti) t.join(maxOf(1L, (konec - System.nanoTime()) / 1_000_000))
        val uspeli = synchronized(izidi) { izidi.filterNotNull() }
        val v = uspeli.flatMap { it.second } to uspeli.map { it.first }
        if (uspeli.isNotEmpty()) synchronized(zaklep) { predpomnilnik = zdaj() to v }
        return v
    }

    /** null = tema brez zadetka in iskanje Brave je na voljo: odgovori model z [[iskanje:]]. */
    fun odgovori(tema: String?, iskanjeNaVoljo: Boolean): String? {
        val (vse, viri) = preberi()
        val splosne = NoviceTelefon.izmenicno(vse)
        val izbrane = if (tema != null) NoviceTelefon.izmenicno(NoviceTelefon.poTemi(vse, tema)) else splosne
        if (tema != null && izbrane.isEmpty() && iskanjeNaVoljo) return null
        return NoviceTelefon.odgovor(tema, izbrane, splosne, viri.ifEmpty { NoviceTelefon.PRIVZETI_VIRI.map { it.first } }, iskanjeNaVoljo)
    }

    companion object {
        const val ROK_MS = 10 * 60_000L
        /** Skupni rok obeh virov (pogovor ne caka dlje). */
        const val ROK_MS_SKUPAJ = 10_000L
    }
}
