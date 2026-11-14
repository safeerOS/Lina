package si.safeer.lina.podpis

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** Odgovor POST /koda/zacni (pogodba @fdd787b). */
data class ZacetekKode(val pairId: String, val nacin: String, val hubId: String, val fp: String, val poteceS: Long)

/** Razdelek klicev iz /koda/potrdi (isti kot v QR); preveri ga QrSeznanitev.klicnoVabilo. */
data class KliciIzKode(val url: String, val code: String, val fp: String)

/** Napake poti /koda/zacni, /koda/spake in /koda/potrdi po polju "napaka". */
enum class NapakaKode {
    CAKA_KODO, NAPACNA_KODA, PREVEC, ZAPRTO, NI_ODPRTO, ID_ZASEDEN, NI_PRIJAVE, MANJKA_KORAK, ZAVRNJENO, NAPAKA,
    NEDOSEGLJIVA, POTEKLO, PREKINJENO,
}

object KodaProtokol {
    private val json = Json { ignoreUnknownKeys = true }

    private fun koren(t: String): JsonObject? =
        if (t.length > 4096) null else try { json.parseToJsonElement(t).jsonObject } catch (_: Exception) { null }

    private fun niz(o: JsonObject, k: String, najvec: Int): String? =
        (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.length <= najvec }

    fun teloZacni(id: String, ime: String, kodaNaTelefonu: Boolean): String = buildJsonObject {
        put("id", id); put("ime", ime)
        if (kodaNaTelefonu) put("kodaNaTelefonu", true)
    }.toString()

    fun razberiZacetek(t: String): ZacetekKode? {
        val o = koren(t) ?: return null
        val s = (o["expires_in_seconds"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: return null
        return ZacetekKode(niz(o, "pair_id", 22) ?: return null, niz(o, "nacin", 16) ?: return null,
            niz(o, "hub_id", 32) ?: return null, niz(o, "fp", 64) ?: return null, s.coerceIn(0, 600))
    }

    fun teloSpake(pairId: String, id: String, pb: String): String =
        buildJsonObject { put("pair_id", pairId); put("id", id); put("pb", pb) }.toString()

    /** (pa, ca) v hex ali null. */
    fun razberiSpake(t: String): Pair<String, String>? {
        val o = koren(t) ?: return null
        return (niz(o, "pa", 130) ?: return null) to (niz(o, "ca", 64) ?: return null)
    }

    /** POST /koda/odpovej (@abc0bd3): cA ni veljal, potrditve ne bo. */
    fun teloOdpovej(pairId: String, id: String): String = buildJsonObject { put("pair_id", pairId); put("id", id) }.toString()

    fun odpovedano(t: String): Boolean = koren(t)?.let { niz(it, "stanje", 16) } == "odpovedano"

    fun teloPotrdi(
        pairId: String, id: String, kljuc: String, ime: String, cas: Long, enkratni: String, podpis: String, cb: String, mac: String,
    ): String = buildJsonObject {
        put("pair_id", pairId); put("id", id); put("kljuc", kljuc); put("ime", ime); put("cas", cas)
        put("enkratni", enkratni); put("podpis", podpis); put("cb", cb); put("mac", mac)
    }.toString()

    /** 202 {"stanje":"caka","klici"?}: null, ce stanje ni "caka"; klici samo, ce so vsa tri polja nizi. */
    fun razberiPotrdi(t: String): Pair<Boolean, KliciIzKode?>? {
        val o = koren(t) ?: return null
        if (niz(o, "stanje", 16) != "caka") return null
        val k = o["klici"] as? JsonObject
        val klici = k?.let { KliciIzKode(niz(it, "url", 300) ?: return null, niz(it, "code", 16) ?: return null, niz(it, "fp", 64) ?: return null) }
        return true to klici
    }

    fun napaka(status: Int, koda: String?): NapakaKode = when (koda) {
        "caka_kodo" -> NapakaKode.CAKA_KODO
        "napacna_koda" -> NapakaKode.NAPACNA_KODA
        "prevec_poskusov", "prevec_cakajocih" -> NapakaKode.PREVEC
        "seznanitev_zaprta" -> NapakaKode.ZAPRTO
        "ni_odprto" -> NapakaKode.NI_ODPRTO
        "id_zaseden" -> NapakaKode.ID_ZASEDEN
        "prijava_ne_obstaja" -> NapakaKode.NI_PRIJAVE
        "manjka_korak" -> NapakaKode.MANJKA_KORAK
        "zavrnjeno" -> NapakaKode.ZAVRNJENO
        else -> if (status == 403) NapakaKode.ZAVRNJENO else NapakaKode.NAPAKA
    }
}
