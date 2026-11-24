package si.safeer.lina.podpis

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Agent na racunalniku (claude-naloge.server.ts StanjeAgenta, okrnjen za telefon). */
data class AgentRacunalnika(val id: String, val ime: String, val stanje: String, val vklopljen: Boolean, val zacetniPoziv: Boolean, val kanal: Boolean) {
    /** Samo pripravljen, vklopljen agent z zacetnim pozivom je v izbiri (racunalnik enako: »ne ponujamo, kar ne deluje«). */
    val zaIzbiro: Boolean get() = stanje == "pripravljen" && vklopljen && zacetniPoziv
}

/** Pogoj zagona: zdaj | ura (ISO) | po (id prve naloge). */
data class PogojNaloge(val vrsta: String, val cas: String? = null, val id: String? = null)
data class OpomnikNaloge(val cas: String, val razlog: String?, val krog: Long)

/** Ena naloga iz GET /agent-naloge (JavnaNaloga brez porocila in zgostitve). Besedilo in mapa sta NEZAUPANA (samo prikaz). */
data class NalogaAgenta(
    val id: String, val izvor: String, val agent: String, val mapa: String, val besedilo: String, val stanje: String,
    val ustvarjeno: String, val potrjeno: String?, val razlog: String?, val pogoj: PogojNaloge?, val ocenaKonca: String?,
    val ocenaGroba: Boolean, val opomnik: OpomnikNaloge?, val koncano: String?,
)

/**
 * [mape] = dovoljene mape za izbiro. [mapeRacunalnika] = racunalnik jih je poslal sam (polje »mape«); sicer so to mape, ki so ze
 * v vrsti (racunalnik jih je ob dodelitvi sprejel) - telefon prostega vnosa poti ne ponuja.
 */
data class StanjeAgentov(val agenti: List<AgentRacunalnika>, val naloge: List<NalogaAgenta>, val mape: List<String>, val mapeRacunalnika: Boolean)

sealed class IzidAgentov {
    data class Stanje(val stanje: StanjeAgentov) : IzidAgentov()
    data class Dodeljeno(val id: String) : IzidAgentov()
    data class Preklicano(val id: String) : IzidAgentov()
    data class Napaka(val vrsta: NapakaGradenj, val razlog: String? = null) : IzidAgentov()
}

/**
 * Agenti in naloge s telefona (lastnik 24. 11. 2026 »Bo gumb na telefonu?« - DA; pogodba agenti-telefon.test.ts v Lini):
 * podpisano GET /agent-naloge, POST /agent-naloga/dodeli in /agent-naloga/preklici; samo domace omrezje. Podpis dodelitve veze
 * zgostitev (agent, mapa, besedilo, pogoj), ki jo telefon izracuna SAM iz tega, kar je lastnik potrdil. Odgovor racunalnika je
 * nezaupljiv: neznane vrednosti = zavrzen ves odgovor.
 */
object AgentiLine {
    val AGENTI = setOf("claude", "agy", "opencode", "kimi", "pi", "grok")
    val STANJA = setOf("caka", "zaganja", "tece", "koncano", "odklonjeno", "poteklo", "napaka", "dodeljeno", "zamujeno", "preklicano")
    /** Naloge, na katere lahko caka »ko konca«: se niso koncne. */
    val NEKONCNA = setOf("caka", "zaganja", "tece", "dodeljeno", "zamujeno")
    /** Preklic sprejme racunalnik samo za ti stanji (claude-naloge.server.ts preklici). */
    val PREKLICLJIVA = setOf("dodeljeno", "zamujeno")
    private val IZVORI = setOf("lastnik", "lina", "telefon")
    private val STANJA_AGENTA = setOf("pripravljen", "ni-najden", "ne-deluje", "prijava")
    private val RAZLOGI_OPOMNIKA = setOf("se-tece", "terminal-zaprt", "brez-porocila")
    val ID = Regex("^[a-f0-9]{16}$")
    private val CAS = Regex("^[0-9TZ:.+-]{10,40}$")
    private val RAZLOG = Regex("^[a-z-]{1,30}$")
    /** Meje racunalnika (asistent-streznik.server.ts dodeliAgentNalogo, NAJVEC_TELO). */
    const val NAJVEC_AGENT = 20
    const val NAJVEC_MAPA = 512
    const val NAJVEC_BESEDILO = 8000
    const val NAJVEC_POGOJ = 40
    const val NAJVEC_TELO = 16 * 1024
    const val NAJVEC_ODGOVORA = 2 * 1024 * 1024
    private const val NAJVEC_NALOG = 30
    private const val NAJVEC_MAP = 200
    private val LJUBLJANA = ZoneId.of("Europe/Ljubljana")
    private val json = Json { ignoreUnknownKeys = true }

    /** Niz kot JSON.stringify (ECMAScript): ubezni samo " \ in znaki pod U+0020; vse drugo (tudi U+2028, U+007F, č) ostane. */
    private fun jsonNiz(s: String): String = buildString {
        append('"')
        for (c in s) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            '\b' -> append("\\b")
            '\u000c' -> append("\\f")
            else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
        }
        append('"')
    }

    /** kanal-claude.ts zgostitevDodelitve: SHA-256 (UTF-8) niza JSON.stringify([agent, mapa, besedilo, pogoj]). */
    fun zgostitevDodelitve(agent: String, mapa: String, besedilo: String, pogoj: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(listOf(agent, mapa, besedilo, pogoj).joinToString(",", "[", "]", transform = ::jsonNiz).toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    const val ZDAJ = "zdaj"

    /** »Ob uri« HH:mm po ljubljanskem casu: naslednja taka ura po [zdaj] (danes ali jutri), kot »ura:<ISO UTC>«. */
    fun pogojUra(ura: Int, minuta: Int, zdaj: Instant): String {
        val danes = ZonedDateTime.of(zdaj.atZone(LJUBLJANA).toLocalDate(), LocalTime.of(ura, minuta), LJUBLJANA)
        val t = if (danes.toInstant().isAfter(zdaj)) danes else ZonedDateTime.of(danes.toLocalDate().plusDays(1), LocalTime.of(ura, minuta), LJUBLJANA)
        return "ura:${t.toInstant()}"
    }

    fun pogojPo(id: String): String? = if (ID.matches(id)) "po:$id" else null

    /** Ura zagona za prikaz (lastnik podpise dan in uro, ki ju vidi): dni od danes po ljubljanskem casu, ura HH:mm in datum d. M. */
    data class DanZagona(val dni: Long, val ura: String, val datum: String)

    fun danZagona(iso: String?, zdaj: Instant): DanZagona? = iso?.let {
        runCatching {
            val t = java.time.OffsetDateTime.parse(it).atZoneSameInstant(LJUBLJANA)
            val dni = java.time.temporal.ChronoUnit.DAYS.between(zdaj.atZone(LJUBLJANA).toLocalDate(), t.toLocalDate())
            DanZagona(dni, "%02d:%02d".format(t.hour, t.minute), "${t.dayOfMonth}. ${t.monthValue}.")
        }.getOrNull()
    }

    private class Slabo : RuntimeException()
    private fun slabo(): Nothing = throw Slabo()
    private fun JsonObject.niz(k: String): String = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: slabo()
    private fun JsonObject.nizAliNull(k: String): String? = when (val v = this[k]) {
        null, JsonNull -> null
        else -> (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: slabo()
    }
    private fun JsonObject.bool(k: String): Boolean = (this[k] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: slabo()
    private fun JsonObject.objAliNull(k: String): JsonObject? = when (val v = this[k]) { null, JsonNull -> null; else -> v as? JsonObject ?: slabo() }
    private fun JsonObject.seznam(k: String, najvec: Int): List<JsonElement> = ((this[k] as? JsonArray) ?: slabo()).also { if (it.size > najvec) slabo() }
    private fun JsonElement.obj(): JsonObject = this as? JsonObject ?: slabo()
    private fun String.ujema(r: Regex): String = also { if (!r.matches(it)) slabo() }
    private fun String?.ujemaAliNull(r: Regex): String? = this?.ujema(r)
    private fun String.vNaboru(s: Set<String>): String = also { if (it !in s) slabo() }
    /** Pot se ne popravlja: nevidni znaki, prelom ali predolga = neveljaven odgovor. */
    private fun String.pot(): String = also { if (it.isEmpty() || it.length > NAJVEC_MAPA || NEVIDNI_POT.containsMatchIn(it)) slabo() }
    /** Nadzorni (vkljucno s prelomom in tabulatorjem), smerni in nevidni znaki (gradnje-github.ts NEVIDNI + \t \n). */
    private val NEVIDNI_POT = Regex("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]")

    private fun pogoj(o: JsonObject?): PogojNaloge? = o?.let {
        when (it.niz("vrsta")) {
            "zdaj" -> PogojNaloge("zdaj")
            "ura" -> PogojNaloge("ura", cas = it.niz("cas").ujema(CAS))
            "po" -> PogojNaloge("po", id = it.niz("id").ujema(ID))
            else -> slabo()
        }
    }

    private fun naloga(e: JsonElement): NalogaAgenta {
        val o = e.obj()
        val ocena = o.objAliNull("ocena")
        val opomnik = o.objAliNull("opomnik")?.let { p ->
            OpomnikNaloge(p.niz("cas").ujema(CAS), p.nizAliNull("razlog")?.vNaboru(RAZLOGI_OPOMNIKA),
                ((p["krog"] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull ?: slabo()).also { if (it < 0) slabo() })
        }
        return NalogaAgenta(
            id = o.niz("id").ujema(ID),
            izvor = o.niz("izvor").vNaboru(IZVORI),
            agent = o.niz("agent").vNaboru(AGENTI),
            mapa = o.niz("mapa").pot(),
            besedilo = GradnjeLine.cisto(o.niz("besedilo"), 400),
            stanje = o.niz("stanje").vNaboru(STANJA),
            ustvarjeno = o.niz("ustvarjeno").ujema(CAS),
            potrjeno = o.nizAliNull("potrjeno").ujemaAliNull(CAS),
            razlog = o.nizAliNull("razlog").ujemaAliNull(RAZLOG),
            pogoj = pogoj(o.objAliNull("pogoj")),
            ocenaKonca = ocena?.niz("konec")?.ujema(CAS),
            ocenaGroba = ocena?.bool("groba") ?: false,
            opomnik = opomnik,
            koncano = o.nizAliNull("koncano").ujemaAliNull(CAS),
        )
    }

    /** Odgovor GET /agent-naloge; null = neveljaven (zavrze se ves). */
    fun razcleni(telo: String): StanjeAgentov? {
        if (telo.length > NAJVEC_ODGOVORA) return null
        return try {
            val o = json.parseToJsonElement(telo).jsonObject
            val agenti = o.seznam("agenti", AGENTI.size).map {
                val a = it.obj()
                AgentRacunalnika(a.niz("id").vNaboru(AGENTI), GradnjeLine.cisto(a.niz("ime"), 40), a.niz("stanje").vNaboru(STANJA_AGENTA),
                    a.bool("vklopljen"), a.bool("zacetniPoziv"), a.bool("kanal"))
            }
            if (agenti.map { it.id }.toSet().size != agenti.size) return null
            val naloge = o.seznam("naloge", NAJVEC_NALOG).map(::naloga)
            if (naloge.map { it.id }.toSet().size != naloge.size) return null
            // shortcut: racunalnik (claude-naloge.server.ts telefonStanjeNalog) polja »mape« se ne poslje; dokler ga ni, so izbira mape v vrsti.
            val mapeRac = o["mape"]?.let { _ -> o.seznam("mape", NAJVEC_MAP).map { ((it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: slabo()).pot() } }
            StanjeAgentov(agenti, naloge, (mapeRac ?: naloge.map { it.mapa }).distinct(), mapeRac != null)
        } catch (_: Exception) {
            null
        }
    }

    private fun napaka(o: OdgovorLine): IzidAgentov.Napaka = GradnjeLine.napaka(o).let { IzidAgentov.Napaka(it.vrsta, it.razlog) }

    /** Podpisana poizvedba; [podpisi] = Podpisnik.podpisiStanjeAgentNalog. */
    fun stanje(pov: PovezavaZLino, posiljatelj: String, cas: Long, enkratni: String, podpisi: (Long, String) -> String?): IzidAgentov {
        val podpis = podpisi(cas, enkratni) ?: return IzidAgentov.Napaka(NapakaGradenj.NAPAKA)
        val o = pov.stanjeAgentNalog(posiljatelj, cas, enkratni, podpis)
        return (o as? OdgovorLine.Ok)?.let { razcleni(it.telo) }?.let { IzidAgentov.Stanje(it) } ?: napaka(o)
    }

    /** Ali je pogoj veljaven za to stanje: zdaj, ura:<ISO> ali po:<id naloge, ki je v vrsti in se ni koncna>. */
    fun veljavenPogoj(pogoj: String, s: StanjeAgentov): Boolean = when {
        pogoj == ZDAJ -> true
        pogoj.startsWith("ura:") -> pogoj.length <= NAJVEC_POGOJ && CAS.matches(pogoj.removePrefix("ura:"))
        pogoj.startsWith("po:") -> pogoj.removePrefix("po:").let { id -> ID.matches(id) && s.naloge.any { it.id == id && it.stanje in NEKONCNA } }
        else -> false
    }

    /**
     * Dodelitev, ki jo je lastnik potrdil v oknu (agent, mapa, besedilo, kdaj). Agent mora biti v izbiri, mapa s seznama, pogoj veljaven;
     * telo mora prestati mejo racunalnika (sicer 413). [podpisi] = Podpisnik.podpisiDodelitevAgentNaloge(zgostitev, ...) - null brez »Razumem«.
     */
    fun dodeli(
        pov: PovezavaZLino, posiljatelj: String, s: StanjeAgentov, agent: String, mapa: String, besedilo: String, pogoj: String,
        cas: Long, enkratni: String, podpisi: (String, Long, String) -> String?,
    ): IzidAgentov {
        val nap = IzidAgentov.Napaka(NapakaGradenj.NAPAKA)
        if (s.agenti.none { it.id == agent && it.zaIzbiro } || agent.length > NAJVEC_AGENT) return nap
        if (mapa !in s.mape || mapa.length > NAJVEC_MAPA) return nap
        if (besedilo.isBlank() || besedilo.length > NAJVEC_BESEDILO || !NiziLine.praviUnicode(besedilo)) return nap
        if (!veljavenPogoj(pogoj, s)) return nap
        val zg = zgostitevDodelitve(agent, mapa, besedilo, pogoj)
        val podpis = podpisi(zg, cas, enkratni) ?: return IzidAgentov.Napaka(NapakaGradenj.NI_POTRDITVE)
        val telo = buildJsonObject {
            put("posiljatelj", posiljatelj); put("agent", agent); put("mapa", mapa); put("besedilo", besedilo); put("pogoj", pogoj)
            put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
        }.toString()
        if (telo.toByteArray(Charsets.UTF_8).size > NAJVEC_TELO) return IzidAgentov.Napaka(NapakaGradenj.RACUNALNIK, "predolgo")
        val o = pov.dodeliAgentNalogo(telo)
        val ok = (o as? OdgovorLine.Ok) ?: return napaka(o)
        return runCatching { IzidAgentov.Dodeljeno(json.parseToJsonElement(ok.telo).jsonObject.niz("id").ujema(ID)) }.getOrElse { nap }
    }

    /** Ali bi bilo telo dodelitve pod mejo racunalnika (za opozorilo v oknu, preden lastnik podpise). */
    fun dolzinaVRedu(besedilo: String, mapa: String): Boolean =
        besedilo.length <= NAJVEC_BESEDILO && (jsonNiz(besedilo) + jsonNiz(mapa)).toByteArray(Charsets.UTF_8).size + 400 <= NAJVEC_TELO

    /** Preklic dodeljene ali zamujene naloge; [podpisi] = Podpisnik.podpisiPreklicAgentNaloge. */
    fun preklici(pov: PovezavaZLino, posiljatelj: String, n: NalogaAgenta, cas: Long, enkratni: String, podpisi: (String, Long, String) -> String?): IzidAgentov {
        if (n.stanje !in PREKLICLJIVA || !ID.matches(n.id)) return IzidAgentov.Napaka(NapakaGradenj.NAPAKA)
        val podpis = podpisi(n.id, cas, enkratni) ?: return IzidAgentov.Napaka(NapakaGradenj.NAPAKA)
        val telo = buildJsonObject { put("posiljatelj", posiljatelj); put("id", n.id); put("cas", cas); put("enkratni", enkratni); put("podpis", podpis) }.toString()
        val o = pov.prekliciAgentNalogo(telo)
        val ok = (o as? OdgovorLine.Ok) ?: return napaka(o)
        return runCatching {
            val id = json.parseToJsonElement(ok.telo).jsonObject.niz("id")
            if (id != n.id) slabo()
            IzidAgentov.Preklicano(id)
        }.getOrElse { IzidAgentov.Napaka(NapakaGradenj.NAPAKA) }
    }
}
