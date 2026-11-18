package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class Sporocilo(val vloga: String, val besedilo: String)

sealed class Rezultat {
    data class Besedilo(val besedilo: String) : Rezultat()
    data class Zavrnjeno(val razlog: String) : Rezultat()
    data class Napaka(val koda: Int?, val sporocilo: String) : Rezultat()
}

class KljucGemini(private val vrednost: String) {
    fun izpostavi(): String = vrednost
    override fun toString(): String = "KljucGemini(***)"
}

@Serializable
private data class Part(val text: String)

@Serializable
private data class Content(val role: String? = null, val parts: List<Part>)

@Serializable
private data class SystemInstruction(val parts: List<Part>)

@Serializable
private data class GeminiRequest(
    val systemInstruction: SystemInstruction? = null,
    val contents: List<Content>
)

private val jsonFormat = Json { ignoreUnknownKeys = true }

fun gradiTelo(zgodovina: List<Sporocilo>, sistemskoNavodilo: String): String {
    val systemInstruction = if (sistemskoNavodilo.isNotEmpty()) {
        SystemInstruction(listOf(Part(sistemskoNavodilo)))
    } else {
        null
    }
    
    val contents = zgodovina.map {
        Content(role = it.vloga, parts = listOf(Part(it.besedilo)))
    }
    
    val request = GeminiRequest(systemInstruction = systemInstruction, contents = contents)
    return jsonFormat.encodeToString(request)
}

@Serializable
private data class PromptFeedback(val blockReason: String? = null)

@Serializable
private data class GeminiResponse(
    val candidates: List<Candidate>? = null,
    val promptFeedback: PromptFeedback? = null,
    val error: GeminiError? = null
)

@Serializable
private data class Candidate(
    val content: Content? = null,
    val finishReason: String? = null
)

@Serializable
private data class GeminiError(
    val code: Int? = null,
    val message: String? = null
)

fun razberiOdgovor(json: String): Rezultat {
    val response = try {
        jsonFormat.decodeFromString<GeminiResponse>(json)
    } catch (e: Exception) {
        return Rezultat.Napaka(null, "Neveljaven JSON")
    }

    if (response.error != null) {
        return Rezultat.Napaka(response.error.code, response.error.message ?: "Neznana napaka")
    }

    if (response.promptFeedback?.blockReason != null) {
        return Rezultat.Zavrnjeno(response.promptFeedback.blockReason)
    }

    val candidates = response.candidates
    if (candidates.isNullOrEmpty()) {
        return Rezultat.Napaka(null, "Prazen odgovor")
    }

    val candidate = candidates.first()
    
    val zavrnjenoRazlogi = setOf("SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY")
    if (candidate.finishReason in zavrnjenoRazlogi) {
        return Rezultat.Zavrnjeno(candidate.finishReason!!)
    }

    val parts = candidate.content?.parts
    if (parts.isNullOrEmpty()) {
        return Rezultat.Napaka(null, "Manjka besedilo")
    }
    
    val text = parts.joinToString("") { it.text }
    if (text.isEmpty()) {
        return Rezultat.Napaka(null, "Manjka besedilo")
    }

    return Rezultat.Besedilo(text)
}
