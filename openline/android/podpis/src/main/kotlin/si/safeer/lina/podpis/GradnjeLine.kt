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
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class TokGradnje(val tok: String, val vrsta: String, val paket: String)
/** Opozorilo GitHuba (NEZAUPANO besedilo): samo za prikaz kot golo besedilo. */
data class AnotacijaGradnje(val raven: String, val sporocilo: String, val pot: String)
data class DatotekaGradnje(val pot: String, val sha256: String, val velikost: Long)

/** Ena gradnja iz GET /gradnje (gradnje-github.server.ts JavnaGradnja); casi so ISO nizi racunalnika. */
data class Gradnja(
    val id: String, val izvor: String, val tok: String, val veja: String, val commit: String?, val zgostitev: String, val stanje: String,
    val ustvarjeno: String, val potrjeno: String?, val tekId: Long?, val zacetekTeka: String?, val konec: String?,
    val zakljucek: String?, val anotacije: List<AnotacijaGradnje>, val mapa: String?, val datoteke: List<DatotekaGradnje>,
    val paket: DatotekaGradnje?, val podpis: String?, val razlog: String?, val ocenaKonca: String?, val lahkoNamesti: Boolean,
)

data class StanjeGradenj(
    val vklopljeno: Boolean, val geslo: Boolean, val gh: Boolean, val tokovi: List<TokGradnje>, val veje: List<String>, val gradnje: List<Gradnja>,
)

/** Kaj uporabnik izve ob neuspehu. RACUNALNIK = 409 z razlogom (tok-zaseden, izklopljeno, geslo ...); NI_POTRDITVE = brez »Razumem«. */
enum class NapakaGradenj { NEDOSEGLJIV, ZAVRNJENO, PREVEC, STARA_LINA, RACUNALNIK, NI_POTRDITVE, NAPAKA }

sealed class IzidGradenj {
    data class Stanje(val stanje: StanjeGradenj) : IzidGradenj()
    data class Predlog(val id: String, val zgostitev: String) : IzidGradenj()
    data class Potrjeno(val id: String) : IzidGradenj()
    data class Napaka(val vrsta: NapakaGradenj, val razlog: String? = null) : IzidGradenj()
}

/**
 * Gradnje na GitHubu s telefona (lastnik 24. 11. 2026; pogodba v Lininem AGENTS.md in gradnje-telefon.test.ts): podpisano GET /gradnje,
 * POST /gradnja/predlog in /gradnja/potrdi. Odgovor racunalnika je nezaupljiv: samo znane vrednosti, sicer se zavrze ves; besedila
 * brez nevidnih znakov. Zgostitev za potrditev telefon izracuna SAM iz prikazanega toka, veje in commita
 * (gradnje-github.ts zgostitevGradnje). Lastnik podpise samo to, kar vidi; streznikove zgostitve telefon ne prevzame.
 */
object GradnjeLine {
    /** Repozitorij in tokovi so stalni (gradnje-github.ts REPOZITORIJ, TOKOVI). */
    const val REPOZITORIJ = "safeerOS/Lina"
    val TOKOVI = setOf("gradnja.yml", "racunalnik.yml")
    val STANJA = setOf("caka", "odklonjeno", "poteklo", "zaganja", "tece", "prenasa", "koncano", "neuspesno", "napaka")
    val AKTIVNA = setOf("zaganja", "tece", "prenasa")
    private val IZVORI = setOf("lastnik", "lina", "telefon")
    private val PODPISI = setOf("ujema", "ne-ujema", "ni-preverjen")
    private val RAVNI = setOf("notice", "warning", "failure")
    /** Do 30 gradenj z do 50 anotacijami po 700 znakov: vec kot splosna meja 64 KB. */
    const val NAJVEC_ODGOVORA = 2 * 1024 * 1024
    private const val NAJVEC_GRADENJ = 50
    private const val NAJVEC_VEJ = 500
    private const val NAJVEC_ANOTACIJ = 50
    private const val NAJVEC_DATOTEK = 50
    private const val NAJVEC_POTI = 1000

    private val VEJA = Regex("^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$")
    private val HEX64 = Regex("^[0-9a-f]{64}$")
    /** Polni SHA commita, male crke (gradnje-github.ts oblikaCommita). */
    private val COMMIT = Regex("^[0-9a-f]{40}$")
    private val CAS = Regex("^[0-9TZ:.+-]{10,40}$")
    private val RAZLOG = Regex("^[a-z-]{1,30}$")
    private val ZAKLJUCEK = Regex("^[a-z_]{1,30}$")
    private val PAKET = Regex("^[A-Za-z0-9._-]{1,100}$")
    /** Nadzorni, smerni in nevidni znaki (gradnje-github.ts NEVIDNI). */
    private val NEVIDNI = Regex("[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]")
    private val json = Json { ignoreUnknownKeys = true }
    private val URA = DateTimeFormatter.ofPattern("HH:mm")
    private val LJUBLJANA = ZoneId.of("Europe/Ljubljana")

    /** Ime veje kot gradnje-github.ts oblikaVeje (git check-ref-format, ozje; brez »-« na zacetku). */
    fun oblikaVeje(v: String): Boolean =
        VEJA.matches(v) && ".." !in v && "//" !in v && "/." !in v && !v.endsWith("/") && !v.endsWith(".") && !v.endsWith(".lock")

    fun oblikaCommita(c: String): Boolean = COMMIT.matches(c)

    /** Prvih 12 znakov commita za okno pred podpisom; null, ce oblika ni prava. */
    fun prikazCommita(c: String?): String? = c?.takeIf(::oblikaCommita)?.take(12)

    /** Kar lastnik vidi in potrdi (gradnje-github.ts zgostitevGradnje): repozitorij, tok, veja, commit. */
    fun zgostitev(tok: String, veja: String, commit: String): String =
        MessageDigest.getInstance("SHA-256").digest("$REPOZITORIJ\u0000$tok\u0000$veja\u0000$commit".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** ISO cas racunalnika -> ura po ljubljanskem casu (HH:mm); null, ce casa ni ali ni berljiv. */
    fun uraLjubljana(iso: String?): String? = iso?.let { runCatching { OffsetDateTime.parse(it).atZoneSameInstant(LJUBLJANA).format(URA) }.getOrNull() }

    /** Nezaupano besedilo za prikaz: brez nevidnih znakov, zgosceni presledki, meja dolzine. */
    fun cisto(s: String, meja: Int): String = s.replace(NEVIDNI, "").replace(Regex("\\s{2,}"), " ").trim().take(meja)

    private class Slabo : RuntimeException()
    private fun slabo(): Nothing = throw Slabo()
    private fun JsonObject.niz(k: String): String = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: slabo()
    private fun JsonObject.nizAliNull(k: String): String? = when (val v = this[k]) {
        null, JsonNull -> null
        else -> (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: slabo()
    }
    private fun JsonObject.bool(k: String): Boolean = (this[k] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull ?: slabo()
    private fun JsonObject.seznam(k: String, najvec: Int): List<JsonElement> = ((this[k] as? JsonArray) ?: slabo()).also { if (it.size > najvec) slabo() }
    private fun JsonElement.obj(): JsonObject = this as? JsonObject ?: slabo()
    private fun String.ujema(r: Regex): String = also { if (!r.matches(it)) slabo() }
    private fun String?.ujemaAliNull(r: Regex): String? = this?.ujema(r)
    private fun String.vNaboru(s: Set<String>): String = also { if (it !in s) slabo() }
    /** Pot na racunalniku se ne popravlja: z nevidnimi znaki ali predolga = neveljaven odgovor. */
    private fun String.pot(): String = also { if (it.length > NAJVEC_POTI || NEVIDNI.containsMatchIn(it)) slabo() }
    private fun JsonObject.stevilo(k: String, nullable: Boolean): Long? {
        val v = this[k]
        if (v == null || v is JsonNull) return if (nullable) null else slabo()
        val p = (v as? JsonPrimitive)?.takeUnless { it.isString } ?: slabo()
        return p.longOrNull?.takeIf { it >= 0 } ?: slabo()
    }

    private fun datoteka(e: JsonElement): DatotekaGradnje {
        val o = e.obj()
        return DatotekaGradnje(o.niz("pot").pot(), o.niz("sha256").ujema(HEX64), o.stevilo("velikost", false)!!)
    }

    private fun gradnja(e: JsonElement): Gradnja {
        val o = e.obj()
        val anotacije = o.seznam("anotacije", NAJVEC_ANOTACIJ).map {
            val a = it.obj()
            AnotacijaGradnje(a.niz("raven").vNaboru(RAVNI), cisto(a.niz("sporocilo"), 500), cisto(a.niz("pot"), 200))
        }
        return Gradnja(
            id = o.niz("id").ujema(NiziLine.ID_GRADNJE),
            izvor = o.niz("izvor").vNaboru(IZVORI),
            tok = o.niz("tok").vNaboru(TOKOVI),
            veja = o.niz("veja").also { if (!oblikaVeje(it)) slabo() },
            commit = o.nizAliNull("commit").ujemaAliNull(COMMIT),
            zgostitev = o.niz("zgostitev").ujema(HEX64),
            stanje = o.niz("stanje").vNaboru(STANJA),
            ustvarjeno = o.niz("ustvarjeno").ujema(CAS),
            potrjeno = o.nizAliNull("potrjeno").ujemaAliNull(CAS),
            tekId = o.stevilo("tekId", true),
            zacetekTeka = o.nizAliNull("zacetekTeka").ujemaAliNull(CAS),
            konec = o.nizAliNull("konec").ujemaAliNull(CAS),
            zakljucek = o.nizAliNull("zakljucek").ujemaAliNull(ZAKLJUCEK),
            anotacije = anotacije,
            mapa = o.nizAliNull("mapa")?.pot(),
            datoteke = o.seznam("datoteke", NAJVEC_DATOTEK).map(::datoteka),
            paket = when (val p = o["paket"]) { null, JsonNull -> null; else -> datoteka(p) },
            podpis = o.nizAliNull("podpis")?.vNaboru(PODPISI),
            razlog = o.nizAliNull("razlog").ujemaAliNull(RAZLOG),
            ocenaKonca = o.nizAliNull("ocenaKonca").ujemaAliNull(CAS),
            lahkoNamesti = o.bool("lahkoNamesti"),
        )
    }

    /** Odgovor GET /gradnje; null = neveljaven (zavrze se ves). */
    fun razcleni(telo: String): StanjeGradenj? {
        if (telo.length > NAJVEC_ODGOVORA) return null
        return try {
            val o = json.parseToJsonElement(telo).jsonObject
            val tokovi = o.seznam("tokovi", 10).map {
                val t = it.obj()
                TokGradnje(t.niz("tok").vNaboru(TOKOVI), t.niz("vrsta").vNaboru(setOf("apk", "deb")), t.niz("paket").ujema(PAKET))
            }
            val veje = o.seznam("veje", NAJVEC_VEJ).map { ((it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: slabo()).also { v -> if (!oblikaVeje(v)) slabo() } }
            val gradnje = o.seznam("gradnje", NAJVEC_GRADENJ).map(::gradnja)
            if (gradnje.map { it.id }.toSet().size != gradnje.size) return null
            StanjeGradenj(o.bool("vklopljeno"), o.bool("geslo"), o.bool("gh"), tokovi, veje, gradnje)
        } catch (_: Exception) {
            null
        }
    }

    fun napaka(o: OdgovorLine): IzidGradenj.Napaka = when (o) {
        is OdgovorLine.Ok -> IzidGradenj.Napaka(NapakaGradenj.NAPAKA) // neveljavno telo
        OdgovorLine.Nedosegljiva -> IzidGradenj.Napaka(NapakaGradenj.NEDOSEGLJIV)
        is OdgovorLine.Napaka -> when (o.status) {
            403 -> IzidGradenj.Napaka(NapakaGradenj.ZAVRNJENO)
            404 -> IzidGradenj.Napaka(NapakaGradenj.STARA_LINA)
            429 -> IzidGradenj.Napaka(NapakaGradenj.PREVEC)
            409 -> o.koda?.takeIf { RAZLOG.matches(it) }?.let { IzidGradenj.Napaka(NapakaGradenj.RACUNALNIK, it) } ?: IzidGradenj.Napaka(NapakaGradenj.NAPAKA)
            else -> IzidGradenj.Napaka(NapakaGradenj.NAPAKA)
        }
    }

    /** Podpisana poizvedba; [podpisi] = Podpisnik.podpisiStanjeGradenj. */
    fun stanje(pov: PovezavaZLino, posiljatelj: String, cas: Long, enkratni: String, podpisi: (Long, String) -> String?): IzidGradenj {
        val podpis = podpisi(cas, enkratni) ?: return IzidGradenj.Napaka(NapakaGradenj.NAPAKA)
        val o = pov.stanjeGradenj(posiljatelj, cas, enkratni, podpis)
        return (o as? OdgovorLine.Ok)?.let { razcleni(it.telo) }?.let { IzidGradenj.Stanje(it) } ?: napaka(o)
    }

    /**
     * Predlog: tok s stalnega seznama, veja TOCNO s seznama, ki ga je poslal racunalnik (in prave oblike). Podpis veze tok in vejo.
     * Ce odgovor nosi commit, mora zgostitev ustrezati izracunu telefona; brez commita zgostitve ne prevzamemo in je ne podpisemo.
     * [podpisi] = Podpisnik.podpisiPredlogGradnje (null brez »Razumem«).
     */
    fun predlagaj(
        pov: PovezavaZLino, posiljatelj: String, tok: String, veja: String, veje: List<String>, cas: Long, enkratni: String,
        podpisi: (String, String, Long, String) -> String?,
    ): IzidGradenj {
        if (tok !in TOKOVI || !oblikaVeje(veja) || veja !in veje) return IzidGradenj.Napaka(NapakaGradenj.NAPAKA)
        val podpis = podpisi(tok, veja, cas, enkratni) ?: return IzidGradenj.Napaka(NapakaGradenj.NI_POTRDITVE)
        val telo = buildJsonObject {
            put("posiljatelj", posiljatelj); put("tok", tok); put("veja", veja); put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
        }.toString()
        val o = pov.predlogGradnje(telo)
        val ok = (o as? OdgovorLine.Ok) ?: return napaka(o)
        return runCatching {
            val j = json.parseToJsonElement(ok.telo).jsonObject
            val id = j.niz("id").ujema(NiziLine.ID_GRADNJE)
            val z = j.niz("zgostitev").ujema(HEX64)
            val commit = j.nizAliNull("commit")
            if (commit != null) {
                if (!oblikaCommita(commit) || z != zgostitev(tok, veja, commit)) slabo()
                IzidGradenj.Predlog(id, zgostitev(tok, veja, commit))
            } else {
                IzidGradenj.Predlog(id, "")
            }
        }.getOrElse { IzidGradenj.Napaka(NapakaGradenj.NAPAKA) }
    }

    /**
     * Potrditev cakajoce gradnje, ki jo lastnik vidi (tok, veja, commit). Podpise se zgostitev, ki jo telefon izracuna iz teh
     * polj; ce racunalnik pokaze drugo ali commita ni, se nic ne podpise. [podpisi] = Podpisnik.podpisiPotrditevGradnje (null brez »Razumem«).
     */
    fun potrdi(pov: PovezavaZLino, posiljatelj: String, g: Gradnja, cas: Long, enkratni: String, podpisi: (String, String, Long, String) -> String?): IzidGradenj {
        val commit = g.commit
        if (commit == null || !oblikaCommita(commit)) return IzidGradenj.Napaka(NapakaGradenj.NAPAKA)
        val z = zgostitev(g.tok, g.veja, commit)
        if (g.stanje != "caka" || g.zgostitev != z || g.tok !in TOKOVI || !oblikaVeje(g.veja)) return IzidGradenj.Napaka(NapakaGradenj.NAPAKA)
        val podpis = podpisi(g.id, z, cas, enkratni) ?: return IzidGradenj.Napaka(NapakaGradenj.NI_POTRDITVE)
        val telo = buildJsonObject {
            put("posiljatelj", posiljatelj); put("id", g.id); put("zgostitev", z); put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
        }.toString()
        val o = pov.potrditevGradnje(telo)
        val ok = (o as? OdgovorLine.Ok) ?: return napaka(o)
        return runCatching {
            val id = json.parseToJsonElement(ok.telo).jsonObject.niz("id")
            if (id != g.id) slabo()
            IzidGradenj.Potrjeno(id)
        }.getOrElse { IzidGradenj.Napaka(NapakaGradenj.NAPAKA) }
    }
}
