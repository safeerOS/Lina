package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.http.HttpTimeoutException

/**
 * Ponudniki, ki jih uporabnik izbere s svojim kljucem (lastnik 18. 11. 2026: na telefonu manjkajo kljuci drugih agentov).
 * Naslovi so vgrajeni in nespremenljivi: kljuc nikoli ne gre na naslov, ki bi ga vnesel uporabnik ali napadalec.
 */
enum class Ponudnik(val id: String, val oznaka: String, val model: String) {
    GEMINI("gemini", "Gemini", "gemini-2.5-flash"),
    OPENAI("openai", "OpenAI", "gpt-4.1-mini"),
    CLAUDE("claude", "Claude", "claude-sonnet-4-5"),
    GROK("grok", "Grok", "grok-4"),
    /** Lastnik 22. 11. 2026: tudi kljuc OpenRouter (kot na racunalniku; ID modela s predpono ponudnika). */
    OPENROUTER("openrouter", "OpenRouter", "openai/gpt-4o"),
    /** Prijava z Google racunom (Vertex AI); namesto kljuca zeton Google. */
    /** Isti model kot racunalniska Lina (types.ts DEFAULT_BRAIN_MODELS.vertex); 22. 11. 2026 gemini-2.5-flash na lastnikovem projektu vrne 404. */
    VERTEX("vertex", "Google Cloud", "gemini-3-flash-preview");

    companion object {
        fun izId(id: String?): Ponudnik = entries.firstOrNull { it.id == id } ?: GEMINI
    }
}

private val json = Json { ignoreUnknownKeys = true }

/** Skupna zanka: privzeto do 3 poskusov pri 429 in 5xx, drugace takoj; odgovor nad 1 MB je zavrnjen. Kljuca nikoli ne vstavi v sporocilo napake. */
internal fun posljiZPonovitvami(
    prenos: Prenos, url: String, glave: Map<String, String>, telo: String, spanje: (Long) -> Unit,
    razberi: (String) -> Rezultat,
    najvecPoskusov: Int = 3,
): Rezultat {
    var poskusi = 0
    var odlogMs = 500L
    while (true) {
        val odgovor = try {
            prenos.post(url, glave, telo, 30000L)
        } catch (e: IOException) {
            return Rezultat.Napaka(null, "Brez povezave")
        } catch (e: InterruptedException) {
            return Rezultat.Napaka(null, "Brez povezave")
        } catch (e: HttpTimeoutException) {
            return Rezultat.Napaka(null, "Brez povezave")
        }
        if (odgovor.telo.length > 1024 * 1024) return Rezultat.Napaka(null, "Odgovor prevelik")
        val ponovi = odgovor.koda == 429 || odgovor.koda >= 500
        if (odgovor.koda == 200 || !ponovi) {
            val r = razberi(odgovor.telo)
            return if (odgovor.koda != 200 && r is Rezultat.Besedilo) Rezultat.Napaka(odgovor.koda, "Napaka ${odgovor.koda}") else r
        }
        poskusi++
        if (poskusi >= najvecPoskusov) return razberi(odgovor.telo).let { if (it is Rezultat.Besedilo) Rezultat.Napaka(odgovor.koda, "Napaka ${odgovor.koda}") else it }
        spanje(odlogMs)
        odlogMs += 1000L
    }
}

private fun napakaIzTelesa(o: JsonObject): Rezultat.Napaka? {
    val e = o["error"] ?: return null
    val sporocilo = when (e) {
        is JsonObject -> (e["message"] as? JsonPrimitive)?.contentOrNull
        is JsonPrimitive -> e.contentOrNull
        else -> null
    }
    return Rezultat.Napaka(null, sporocilo?.take(300) ?: "Neznana napaka")
}

/** OpenAI in Grok (xAI) govorita isti protokol chat/completions. */
class OpenAiOdjemalec(
    private val shramba: ShranjevalnikKljuca,
    private val osnovniNaslov: String = "https://api.openai.com",
    private val model: String = Ponudnik.OPENAI.model,
    private val prenos: Prenos = JavaHttpPrenos(),
    /** OpenRouter: ponudnikom prepove hrambo podatkov (data_collection deny), kot racunalniska Lina. */
    private val openRouter: Boolean = false,
) : PonudnikOdjemalec {
    var spanje: (Long) -> Unit = { Thread.sleep(it) }

    fun gradiTelo(zgodovina: List<Sporocilo>, sistemsko: String): String = buildJsonObject {
        put("model", model)
        if (openRouter) put("provider", buildJsonObject { put("data_collection", "deny") })
        put("messages", buildJsonArray {
            if (sistemsko.isNotEmpty()) add(buildJsonObject { put("role", "system"); put("content", sistemsko) })
            for (s in zgodovina) add(buildJsonObject {
                put("role", if (s.vloga == "model") "assistant" else "user")
                if (s.priponke.isEmpty()) put("content", s.besedilo)
                // Slike kot data URL, PDF kot »file« (OpenAI, OpenRouter); ostale vrste zavrne ze pripraviPriponko.
                else put("content", buildJsonArray {
                    add(buildJsonObject { put("type", "text"); put("text", s.besedilo) })
                    for (p in s.priponke) add(
                        if (p.vrsta == VrstaPriponke.PDF) buildJsonObject {
                            put("type", "file")
                            put("file", buildJsonObject { put("filename", p.ime); put("file_data", "data:${p.mime};base64,${p.base64}") })
                        } else buildJsonObject {
                            put("type", "image_url")
                            put("image_url", buildJsonObject { put("url", "data:${p.mime};base64,${p.base64}") })
                        },
                    )
                })
            })
        })
    }.toString()

    override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
        val kljuc = shramba.preberi() ?: return Rezultat.Napaka(null, "Manjka kljuc")
        val url = "${osnovniNaslov.trimEnd('/')}/v1/chat/completions"
        val glave = buildMap {
            put("Authorization", "Bearer ${kljuc.izpostavi()}")
            if (openRouter) put("X-Title", "Lina")
        }
        return posljiZPonovitvami(prenos, url, glave, gradiTelo(zgodovina, sistemsko), spanje, ::razberi)
    }

    fun razberi(telo: String): Rezultat {
        val o = try { json.parseToJsonElement(telo).jsonObject } catch (e: Exception) { return Rezultat.Napaka(null, "Neveljaven JSON") }
        napakaIzTelesa(o)?.let { return it }
        val izbira = ((o["choices"] as? JsonArray)?.firstOrNull() as? JsonObject) ?: return Rezultat.Napaka(null, "Prazen odgovor")
        if ((izbira["finish_reason"] as? JsonPrimitive)?.contentOrNull == "content_filter") return Rezultat.Zavrnjeno("content_filter")
        val besedilo = ((izbira["message"] as? JsonObject)?.get("content") as? JsonPrimitive)?.contentOrNull
        return if (besedilo.isNullOrEmpty()) Rezultat.Napaka(null, "Manjka besedilo") else Rezultat.Besedilo(besedilo)
    }
}

class ClaudeOdjemalec(
    private val shramba: ShranjevalnikKljuca,
    private val osnovniNaslov: String = "https://api.anthropic.com",
    private val model: String = Ponudnik.CLAUDE.model,
    private val prenos: Prenos = JavaHttpPrenos(),
) : PonudnikOdjemalec {
    var spanje: (Long) -> Unit = { Thread.sleep(it) }

    fun gradiTelo(zgodovina: List<Sporocilo>, sistemsko: String): String = buildJsonObject {
        put("model", model)
        put("max_tokens", 1024)
        if (sistemsko.isNotEmpty()) put("system", sistemsko)
        put("messages", buildJsonArray {
            for (s in zgodovina) add(buildJsonObject {
                put("role", if (s.vloga == "model") "assistant" else "user")
                if (s.priponke.isEmpty()) put("content", s.besedilo)
                else put("content", buildJsonArray {
                    for (p in s.priponke) add(buildJsonObject {
                        put("type", if (p.vrsta == VrstaPriponke.PDF) "document" else "image")
                        put("source", buildJsonObject { put("type", "base64"); put("media_type", p.mime); put("data", p.base64) })
                    })
                    add(buildJsonObject { put("type", "text"); put("text", s.besedilo) })
                })
            })
        })
    }.toString()

    override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
        val kljuc = shramba.preberi() ?: return Rezultat.Napaka(null, "Manjka kljuc")
        val url = "${osnovniNaslov.trimEnd('/')}/v1/messages"
        val glave = mapOf("x-api-key" to kljuc.izpostavi(), "anthropic-version" to "2023-06-01")
        return posljiZPonovitvami(prenos, url, glave, gradiTelo(zgodovina, sistemsko), spanje, ::razberi)
    }

    fun razberi(telo: String): Rezultat {
        val o = try { json.parseToJsonElement(telo).jsonObject } catch (e: Exception) { return Rezultat.Napaka(null, "Neveljaven JSON") }
        napakaIzTelesa(o)?.let { return it }
        if ((o["stop_reason"] as? JsonPrimitive)?.contentOrNull == "refusal") return Rezultat.Zavrnjeno("refusal")
        val besedilo = (o["content"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.takeIf { b -> (b["type"] as? JsonPrimitive)?.contentOrNull == "text" }?.get("text")?.jsonPrimitive?.contentOrNull }?.joinToString("")
        return if (besedilo.isNullOrEmpty()) Rezultat.Napaka(null, "Manjka besedilo") else Rezultat.Besedilo(besedilo)
    }
}

/** Odjemalec za izbranega ponudnika; naslovi so vgrajeni (Grok: xAI). */
fun ustvariOdjemalca(p: Ponudnik, shramba: ShranjevalnikKljuca, prenos: Prenos): PonudnikOdjemalec = when (p) {
    Ponudnik.GEMINI -> GeminiOdjemalec(shramba, prenos = prenos)
    Ponudnik.OPENAI -> OpenAiOdjemalec(shramba, "https://api.openai.com", Ponudnik.OPENAI.model, prenos)
    Ponudnik.CLAUDE -> ClaudeOdjemalec(shramba, prenos = prenos)
    Ponudnik.GROK -> OpenAiOdjemalec(shramba, "https://api.x.ai", Ponudnik.GROK.model, prenos)
    Ponudnik.OPENROUTER -> OpenAiOdjemalec(shramba, "https://openrouter.ai/api", Ponudnik.OPENROUTER.model, prenos, openRouter = true)
    // Vertex ne uporablja kljuca: odjemalca gradi aplikacija z zetonom Google (glej VertexOdjemalec).
    Ponudnik.VERTEX -> throw IllegalArgumentException("Vertex: uporabi VertexOdjemalec")
}
