package si.safeer.lina.podpis

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** Dogodek naloge iz GET /dogodki (pogodba lina-asistent2 @e815ed0). */
sealed class DogodekLine {
    abstract val st: Long
    data class Stanje(override val st: Long, val besedilo: String) : DogodekLine()
    /** [opis] je besedilo MODELA; telefon ga prikaze loceno od orodja in predogleda. */
    data class Odobritev(override val st: Long, val zahtevaId: String, val orodje: String, val predogled: String, val opis: String) : DogodekLine()
    data class Izid(override val st: Long, val ok: Boolean, val besedilo: String) : DogodekLine()
}

data class DogodkiLine(val dogodki: List<DogodekLine>, val koncano: Boolean)

/** GET /seznani?koda= (pogodba @7a065fb). */
enum class StanjeSeznanitve { CAKA, SPREJETO, ZAVRNJENO }

/**
 * Telesa zahtev in razclenitev odgovorov koncne tocke asistentke. Vse od racunalnika je nezaupljivo: najvec 64 KiB odgovora,
 * stroge vrste, st mora narascati nad [od], dolzine besedil omejene; zgostitve, ki jo poslje Lina, telefon ne uporabi -
 * izracuna svojo iz prikazanih polj (podpisiOdobritev).
 */
object AsistentProtokol {
    const val NAJVEC_ODGOVORA = 64 * 1024
    const val NAJVEC_BESEDILA = 8000
    const val NAJVEC_DOGODKOV = 200
    private val json = Json { ignoreUnknownKeys = true }

    fun teloNaloge(n: PodpisanaNaloga): String = buildJsonObject {
        put("id", n.id); put("posiljatelj", n.posiljatelj); put("besedilo", n.besedilo)
        put("cas", n.cas); put("enkratni", n.enkratni); put("podpis", n.podpis)
    }.toString()

    fun teloOdobritve(nalogaId: String, zahtevaId: String, dovoli: Boolean, posiljatelj: String, cas: Long, enkratni: String, podpis: String): String =
        buildJsonObject {
            put("nalogaId", nalogaId); put("zahtevaId", zahtevaId); put("dovoli", dovoli); put("posiljatelj", posiljatelj)
            put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
        }.toString()

    fun teloUstavitve(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String): String = buildJsonObject {
        put("id", id); put("posiljatelj", posiljatelj); put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
    }.toString()

    fun teloSeznanitve(koda: String, id: String, kljuc: String, ime: String, cas: Long, enkratni: String, podpis: String): String =
        buildJsonObject {
            put("koda", koda); put("id", id); put("kljuc", kljuc); put("ime", ime)
            put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
        }.toString()

    /** POST /seznani/klici (T1-S1); id = id naprave (posiljatelj). */
    fun teloKlici(koda: String, id: String, cas: Long, enkratni: String, podpis: String): String = buildJsonObject {
        put("koda", koda); put("id", id); put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
    }.toString()

    /** Odgovor 200 {"klici":{url,code,fp}|null}; null = neveljaven odgovor, Pair(false,null) = Lina poti klicev nima. */
    fun razberiKlice(besedilo: String): KliciIzKode? = (koren(besedilo)?.get("klici") as? JsonObject)?.let {
        KliciIzKode(niz(it, "url", 300) ?: return null, niz(it, "code", 16) ?: return null, niz(it, "fp", 64) ?: return null)
    }

    private fun koren(besedilo: String): JsonObject? =
        if (besedilo.length > 4096) null else try { json.parseToJsonElement(besedilo).jsonObject } catch (_: Exception) { null }

    fun razberiSeznanitev(besedilo: String): StanjeSeznanitve? = when (koren(besedilo)?.let { niz(it, "stanje", 16) }) {
        "caka" -> StanjeSeznanitve.CAKA
        "sprejeto" -> StanjeSeznanitve.SPREJETO
        "zavrnjeno" -> StanjeSeznanitve.ZAVRNJENO
        else -> null
    }

    /** true = seja Claude Code odprta; tudi iz telesa 503 {"napaka":"claude-code-ni","stanje":{...}}. */
    fun razberiSejo(besedilo: String): Boolean? {
        val k = koren(besedilo) ?: return null
        val o = (k["stanje"] as? JsonObject) ?: k
        return when (niz(o, "claudeCode", 16)) { "odprta" -> true; "zaprta" -> false; else -> null }
    }

    private fun niz(o: JsonObject, k: String, najvec: Int = NAJVEC_BESEDILA): String? =
        (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.length <= najvec && NiziLine.praviUnicode(it) }

    /** null, ce odgovor ni veljaven (takrat telefon ne prikaze nicesar od njega). */
    fun razberiDogodke(besedilo: String, od: Long): DogodkiLine? {
        if (besedilo.length > NAJVEC_ODGOVORA) return null
        val koren = try { json.parseToJsonElement(besedilo).jsonObject } catch (_: Exception) { return null }
        val koncano = (koren["koncano"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: return null
        val seznam = try { koren["dogodki"]?.jsonArray } catch (_: Exception) { null } ?: return null
        if (seznam.size > NAJVEC_DOGODKOV) return null
        var zadnji = od
        val izhod = ArrayList<DogodekLine>()
        for (e in seznam) {
            val o = e as? JsonObject ?: return null
            val st = (o["st"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: return null
            if (st <= zadnji) return null
            zadnji = st
            val d = when (niz(o, "vrsta", 32)) {
                "stanje" -> DogodekLine.Stanje(st, niz(o, "besedilo") ?: return null)
                "odobritev" -> {
                    val zid = niz(o, "zahtevaId", 5)?.takeIf { NiziLine.ID_ODOBRITVE.matches(it) } ?: return null
                    DogodekLine.Odobritev(st, zid, niz(o, "orodje", 100) ?: return null, niz(o, "predogled", 4000) ?: return null,
                        niz(o, "opis") ?: return null)
                }
                "izid" -> DogodekLine.Izid(st, (o["ok"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: return null,
                    niz(o, "besedilo") ?: return null)
                else -> null // neznana vrsta: preskoci (novejsa Lina), st se vseeno steje
            }
            if (d != null) izhod += d
        }
        return DogodkiLine(izhod, koncano)
    }

    /** Zadnja zaporedna st v odgovoru (tudi preskocenih vrst); za naslednji »od«. */
    fun zadnjaSt(besedilo: String, od: Long): Long = try {
        json.parseToJsonElement(besedilo).jsonObject["dogodki"]?.jsonArray
            ?.mapNotNull { ((it as? JsonObject)?.get("st") as? JsonPrimitive)?.longOrNull }?.maxOrNull()?.coerceAtLeast(od) ?: od
    } catch (_: Exception) { od }
}
