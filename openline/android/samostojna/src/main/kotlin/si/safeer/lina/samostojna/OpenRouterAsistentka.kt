package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Kljuc OpenRouter SAMO za asistentko na telefonu (lastnik 24. 11. 2026, NALOGA-LINA-MODELI-KLICI-IN-ASISTENTKA.md A4, A6, C1-C9).
 * Kljuc je v svojem mestu shrambe (ne v mestu ponudnika za klice), klici (Gemini Live) ga ne vidijo. Brez tega kljuca asistentka
 * uporablja istega ponudnika kot klici (A6). Komentarji so brez sumnikov.
 */
object IzbiraAsistentke {
    const val OSNOVA_OPENROUTER = "https://openrouter.ai/api"

    /** Odjemalec asistentke s kljucem samo za asistentko; null = ni kljuca, asistentka je »isti kot klici«. */
    fun odjemalec(kljucAsistentke: ShranjevalnikKljuca, model: String?, brezplacni: Boolean, prenos: Prenos): PonudnikOdjemalec? {
        if (kljucAsistentke.preberi() == null) return null
        val m = model?.trim()?.takeIf { it.isNotEmpty() } ?: PRIVZETI_BREZPLACNI
        return OpenAiOdjemalec(
            kljucAsistentke, OSNOVA_OPENROUTER, m, prenos, openRouter = true,
            dovoliBrezplacne = brezplacni, rezervniBrezplacni = if (brezplacni) PRIVZETI_BREZPLACNI else null,
        )
    }

    /**
     * C4: razlog zavrnitve shranjevanja ali null. Prazen kljuc je dovoljen samo, ce je kljuc ze shranjen (menjava modela).
     * Brezplacen model brez potrditve (ali prej dane) ni sprejet; placljiv deluje tudi brez nje (z deny).
     */
    fun razlogZavrnitve(kljuc: String, imaKljuc: Boolean, model: String, soglasje: Boolean, zePotrjeno: Boolean): String? {
        val k = kljuc.trim()
        if (k.isEmpty() && !imaKljuc) return "Vpišite ključ OpenRouter."
        if (k.isNotEmpty() && (k.length !in 8..400 || k.any { it.isWhitespace() })) return "Ključ mora imeti med 8 in 400 znakov."
        if (!Regex("^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$").matches(model.trim())) return "Ime modela ni veljavno."
        if (jeBrezplacenModel(model) && !soglasje && !zePotrjeno) return SOGLASJE_BREZPLACNI
        return null
    }
}

/** Stanje racuna (GET /api/v1/key); polja po dokumentaciji OpenRouter iz lastnikove naloge, oblika (ovoj »data«) ni preverjena. */
data class StanjeOpenRouter(val brezplacniRacun: Boolean?, val preostaloKreditov: Double?, val dnevnoPreostalo: Int?, val dnevnoMeja: Int?)

object OpenRouterRacun {
    private val json = Json { ignoreUnknownKeys = true }
    private val VELJAVEN_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$")

    private fun predmet(e: JsonElement?): JsonObject? = e as? JsonObject

    fun razberiStanje(telo: String): StanjeOpenRouter {
        val zunanji = try { predmet(json.parseToJsonElement(telo)) } catch (e: Exception) { null } ?: JsonObject(emptyMap())
        val d = predmet(zunanji["data"]) ?: zunanji
        val dn = predmet(d["free_model_daily_requests"])
        return StanjeOpenRouter(
            brezplacniRacun = (d["is_free_tier"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull,
            preostaloKreditov = (d["limit_remaining"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull,
            dnevnoPreostalo = (dn?.get("remaining") as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull,
            dnevnoMeja = (dn?.get("limit") as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull,
        )
    }

    private fun jeNic(e: JsonElement?): Boolean = (e as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull() == 0.0

    /** Seznam /api/v1/models: samoBrezplacni = cena 0, "tools" v supported_parameters in tocen ID :free (C3, C7). */
    fun razberiModele(telo: String, samoBrezplacni: Boolean): List<String> {
        val seznam = try { predmet(json.parseToJsonElement(telo))?.get("data") as? JsonArray } catch (e: Exception) { null } ?: return emptyList()
        val izid = LinkedHashSet<String>()
        for (el in seznam) {
            val o = predmet(el) ?: continue
            val id = (o["id"] as? JsonPrimitive)?.contentOrNull ?: continue
            if (!VELJAVEN_ID.matches(id)) continue
            if (samoBrezplacni) {
                val cena = predmet(o["pricing"])
                val parametri = (o["supported_parameters"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
                if (!jeTocnoBrezplacen(id) || cena == null || !jeNic(cena["prompt"]) || !jeNic(cena["completion"]) || "tools" !in parametri) continue
            }
            izid.add(id)
            if (izid.size >= 400) break
        }
        return izid.toList()
    }

    /** GET /api/v1/key s kljucem asistentke (samo v glavi). null = napaka ali brez kljuca. */
    fun stanje(prenos: Prenos, kljuc: ShranjevalnikKljuca): StanjeOpenRouter? {
        val k = kljuc.preberi() ?: return null
        return try {
            val odg = prenos.get("${IzbiraAsistentke.OSNOVA_OPENROUTER}/v1/key", mapOf("Authorization" to "Bearer ${k.izpostavi()}"), 8000L)
            if (odg.koda == 200) razberiStanje(odg.telo) else null
        } catch (e: Exception) { null }
    }

    /** Javni seznam modelov (brez kljuca). Napaka = prazen seznam; rocni vnos ostane. */
    fun modeli(prenos: Prenos, samoBrezplacni: Boolean): List<String> = try {
        val odg = prenos.get("${IzbiraAsistentke.OSNOVA_OPENROUTER}/v1/models", emptyMap(), 8000L)
        if (odg.koda == 200) razberiModele(odg.telo, samoBrezplacni) else emptyList()
    } catch (e: Exception) { emptyList() }
}
