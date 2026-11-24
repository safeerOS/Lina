package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Lina sama izbere delujoc model ponudnika (lastnik 24. 11. 2026, AGENTS.md »Model, ki ga ponudnik ne pozna«; enako kot racunalnik
 * samodejni-model.server.ts). Ob shranjevanju kljuca: seznam modelov (uradni naslov), priporoceni s seznama, preizkusni klic, shrani
 * samo model, ki je odgovoril. Med delovanjem: ob »model ne obstaja« zamenjava znotraj ISTEGA ponudnika (B9), ponovitev, shranitev,
 * ena vrstica lastniku. Brezplacni (:free) modeli se samodejno nikoli ne izberejo. Komentarji so brez sumnikov.
 */
enum class VzrokNapake { MODEL, KLJUC, DOBROIMETJE, OMEJITEV }

/** Shranjen model za ponudnika (null = privzeti iz Ponudnik). */
interface ModelShramba {
    fun beri(p: Ponudnik): String?
    fun shrani(p: Ponudnik, model: String)
}

class PomnilniskaModelShramba : ModelShramba {
    private val modeli = mutableMapOf<Ponudnik, String>()
    override fun beri(p: Ponudnik): String? = modeli[p]
    override fun shrani(p: Ponudnik, model: String) { modeli[p] = model }
}

/** Prenos, ki si zapomni zadnjo kodo in telo (odjemalci ob napaki v telesu kodo HTTP izgubijo). */
private class SlediPrenos(private val prenos: Prenos) : Prenos {
    var koda = 0
    var telo = ""
    override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp =
        prenos.post(url, glave, telo, casMs).also { koda = it.koda; this.telo = it.telo.take(4000) }
}

object SamodejniModel {
    const val NAJVEC_POSKUSOV = 3
    private val json = Json { ignoreUnknownKeys = true }
    private val VELJAVEN = Regex("^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$")
    private val MODEL_NI = Regex("not a valid model|invalid model|model\\b[^\\n]{0,80}\\b(does not exist|not found|no longer available|has been retired)|(does not exist|not found)[^\\n]{0,40}\\bmodel", RegexOption.IGNORE_CASE)
    private val NI_ZA_POGOVOR = Regex("(audio|realtime|transcribe|tts|image|imagine|search|embedding|live|voice|vision|instruct|codex|native)", RegexOption.IGNORE_CASE)

    /** Vrstni red priporocil (prvi je privzeti); imena iz javne dokumentacije 24. 11. 2026, OpenRouter samo privzeti + seznam. */
    val PRIPOROCENI: Map<Ponudnik, List<String>> = mapOf(
        Ponudnik.GEMINI to listOf(Ponudnik.GEMINI.model, "gemini-3.6-flash", "gemini-3.5-flash-lite"),
        Ponudnik.OPENAI to listOf(Ponudnik.OPENAI.model, "gpt-6.1-terra", "gpt-6.2-sol"),
        Ponudnik.CLAUDE to listOf(Ponudnik.CLAUDE.model, "claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5-5"),
        Ponudnik.GROK to listOf(Ponudnik.GROK.model, "grok-4.7", "grok-4.6"),
        Ponudnik.OPENROUTER to listOf(Ponudnik.OPENROUTER.model),
    )

    private val DRUZINA: Map<Ponudnik, Regex> = mapOf(
        Ponudnik.GEMINI to Regex("^gemini-\\d"),
        Ponudnik.OPENAI to Regex("^gpt-\\d"),
        Ponudnik.CLAUDE to Regex("^claude-(sonnet|haiku|opus)-"),
        Ponudnik.GROK to Regex("^grok-\\d"),
        Ponudnik.OPENROUTER to Regex("^(openai/gpt-|anthropic/claude-|google/gemini-)"),
    )

    /** Predpone OpenRouter, znotraj katerih sme samodejni preklop ostati. Druga predpona pogovora ne vidi. */
    val PREDPONE_OPENROUTER = listOf("openai/", "anthropic/", "google/")

    fun predponaModela(model: String): String? = PREDPONE_OPENROUTER.firstOrNull { model.startsWith(it) }

    /** Vzrok iz statusa IN telesa (nikoli samo iz 404); enako kot racunalnik vzrokNapake. */
    fun vzrok(koda: Int, telo: String): VzrokNapake? {
        val e: JsonObject? = try {
            when (val x = (json.parseToJsonElement(telo) as? JsonObject)?.get("error")) {
                is JsonObject -> x
                is JsonPrimitive -> JsonObject(mapOf("message" to x))
                else -> null
            }
        } catch (ex: Exception) { null }
        fun niz(k: String): String = (e?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: ""
        val tip = niz("type"); val oznaka = niz("code"); val sporocilo = niz("message").take(500)
        if (koda == 401 || koda == 403) return VzrokNapake.KLJUC
        if (koda == 402 || oznaka == "insufficient_quota" || Regex("credit balance|insufficient (credit|fund|balance)|billing", RegexOption.IGNORE_CASE).containsMatchIn(sporocilo)) return VzrokNapake.DOBROIMETJE
        if (koda == 429) return VzrokNapake.OMEJITEV
        if (koda != 400 && koda != 404) return null
        if (tip == "not_found_error" || oznaka == "model_not_found") return VzrokNapake.MODEL
        if (koda == 404 && niz("status") == "NOT_FOUND") return VzrokNapake.MODEL
        // Ozko: napaka parametra (»'max_tokens' is not supported with this model«) NI »model ne obstaja«.
        if (MODEL_NI.containsMatchIn(sporocilo)) return VzrokNapake.MODEL
        return null
    }

    fun razlog(p: Ponudnik, v: VzrokNapake): String = when (v) {
        VzrokNapake.KLJUC -> "${p.oznaka}: ključ ni veljaven ali nima dovoljenja."
        VzrokNapake.DOBROIMETJE -> "${p.oznaka}: na računu ni dobroimetja."
        VzrokNapake.OMEJITEV -> "${p.oznaka}: dosežena omejitev zahtevkov, poskusite čez trenutek."
        VzrokNapake.MODEL -> "${p.oznaka}: noben preizkušen model ni odgovoril; preverite račun pri ponudniku."
    }

    /** Uradni naslov in glave seznama modelov; null = ni seznama (Vertex ima svojo pot). OpenRouter: javni seznam brez kljuca. */
    fun zahtevaSeznama(p: Ponudnik, kljuc: String): Pair<String, Map<String, String>>? = when (p) {
        Ponudnik.CLAUDE -> "https://api.anthropic.com/v1/models?limit=100" to mapOf("x-api-key" to kljuc, "anthropic-version" to "2023-06-01")
        Ponudnik.OPENAI -> "https://api.openai.com/v1/models" to mapOf("Authorization" to "Bearer $kljuc")
        Ponudnik.GROK -> "https://api.x.ai/v1/models" to mapOf("Authorization" to "Bearer $kljuc")
        Ponudnik.OPENROUTER -> "https://openrouter.ai/api/v1/models" to emptyMap()
        Ponudnik.GEMINI -> "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000" to mapOf("x-goog-api-key" to kljuc)
        Ponudnik.VERTEX -> null
    }

    /** {data:[{id}]} (Anthropic, OpenAI, xAI, OpenRouter) ali {models:[{name:"models/x"}]} (Gemini); brez zgornje meje (OpenRouter > 500). */
    fun razberiSeznam(p: Ponudnik, telo: String): List<String> {
        val o = try { json.parseToJsonElement(telo) as? JsonObject } catch (e: Exception) { null } ?: return emptyList()
        val vrstice = (o[if (p == Ponudnik.GEMINI) "models" else "data"] as? JsonArray) ?: return emptyList()
        return vrstice.mapNotNull { v ->
            val m = v as? JsonObject ?: return@mapNotNull null
            val id = if (p == Ponudnik.GEMINI) (m["name"] as? JsonPrimitive)?.contentOrNull?.removePrefix("models/") else (m["id"] as? JsonPrimitive)?.contentOrNull
            id?.takeIf { VELJAVEN.matches(it) }
        }.distinct()
    }

    /** Seznam ali null (napaka, prenos brez GET v starih preizkusih, ni seznama) - takrat se preizkusijo priporoceni. */
    fun seznam(prenos: Prenos, p: Ponudnik, kljuc: String): List<String>? {
        val (url, glave) = zahtevaSeznama(p, kljuc) ?: return null
        return try {
            val o = prenos.get(url, glave, 8000L)
            if (o.koda != 200 || o.telo.length > 4 * 1024 * 1024) null else razberiSeznam(p, o.telo).ifEmpty { null }
        } catch (e: Exception) { null }
    }

    fun kandidati(p: Ponudnik, seznam: List<String>?, izkljuci: List<String> = emptyList(), samoPredpona: String? = null): List<String> {
        val priporoceni = PRIPOROCENI[p] ?: emptyList()
        val izSeznama = if (seznam == null) priporoceni else priporoceni.filter { it in seznam }
        val druzina = DRUZINA[p]
        val rezerva = if (seznam == null || druzina == null) emptyList() else seznam.filter { druzina.containsMatchIn(it) && !NI_ZA_POGOVOR.containsMatchIn(it) }
        return (izSeznama + rezerva).distinct()
            .filter { VELJAVEN.matches(it) && !jeBrezplacenModel(it) && it !in izkljuci }
            .filter { samoPredpona == null || it.startsWith(samoPredpona) }
            .take(NAJVEC_POSKUSOV)
    }

    sealed class Izbira {
        data class Model(val model: String) : Izbira()
        /** vzrok null = ponudnik ni dosegljiv (omrezje). */
        data class Napaka(val sporocilo: String, val vzrok: VzrokNapake?) : Izbira()
    }

    /** Izbere model, ki je na preizkusni klic odgovoril. Kljuc, dobroimetje ali omejitev ustavi iskanje s pravim vzrokom. */
    fun izberi(
        prenos: Prenos, p: Ponudnik, kljuc: ShranjevalnikKljuca, izkljuci: List<String> = emptyList(),
        spanje: (Long) -> Unit = { Thread.sleep(it) }, samoPredpona: String? = null,
    ): Izbira {
        if (p == Ponudnik.VERTEX) return Izbira.Napaka("Google Cloud: model izbere prijava Google.", null)
        val k = kljuc.preberi() ?: return Izbira.Napaka("Manjka ključ.", VzrokNapake.KLJUC)
        for (m in kandidati(p, seznam(prenos, p, k.izpostavi()), izkljuci, samoPredpona)) {
            val sledi = SlediPrenos(prenos)
            val r = ustvariOdjemalca(p, kljuc, sledi, m).also { nastaviSpanje(it, spanje) }
                .poslji(listOf(Sporocilo("user", "Odgovori samo z besedo: da.")), "")
            if (r is Rezultat.Besedilo || r is Rezultat.Zavrnjeno) return Izbira.Model(m)
            val v = if (sledi.koda == 0) return Izbira.Napaka("${p.oznaka}: ponudnik ni dosegljiv.", null) else vzrok(sledi.koda, sledi.telo)
            if (v == VzrokNapake.MODEL) continue
            return Izbira.Napaka(if (v != null) razlog(p, v) else "${p.oznaka}: ponudnik je zavrnil klic (${sledi.koda}).", v)
        }
        return Izbira.Napaka(razlog(p, VzrokNapake.MODEL), VzrokNapake.MODEL)
    }

    internal fun nastaviSpanje(o: PonudnikOdjemalec, spanje: (Long) -> Unit) {
        when (o) {
            is GeminiOdjemalec -> o.spanje = spanje
            is OpenAiOdjemalec -> o.spanje = spanje
            is ClaudeOdjemalec -> o.spanje = spanje
        }
    }
}

/**
 * Odjemalec, ki med delovanjem sam zamenja model, ki ga ponudnik ne pozna vec: isti ponudnik in kljuc, pri OpenRouter pa se
 * ista predpona (openai/, anthropic/ ali google/) kot trenutni model. Ponovitev zahteve, shranitev novega modela in ena vrstica
 * lastniku. Model bere ob vsakem klicu iz shrambe, zato tudi asistentka, ustvarjena za ves dan, dobi novega.
 */
class SamodejniOdjemalec(
    private val ponudnik: Ponudnik,
    private val shramba: ShranjevalnikKljuca,
    private val prenos: Prenos,
    private val modeli: ModelShramba,
) : PonudnikOdjemalec {
    var spanje: (Long) -> Unit = { Thread.sleep(it) }

    override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
        val model = modeli.beri(ponudnik) ?: ponudnik.model
        val sledi = SlediPrenos(prenos)
        val r = ustvariOdjemalca(ponudnik, shramba, sledi, model).also { SamodejniModel.nastaviSpanje(it, spanje) }.poslji(zgodovina, sistemsko)
        if (r !is Rezultat.Napaka || SamodejniModel.vzrok(sledi.koda, sledi.telo) != VzrokNapake.MODEL) return r
        // Brezplacni modeli OpenRouter imajo svoja sporocila (B6); zamenjava samo za placljive.
        if (ponudnik == Ponudnik.OPENROUTER && jeBrezplacenModel(model)) return r
        val predpona = if (ponudnik == Ponudnik.OPENROUTER) SamodejniModel.predponaModela(model) else null
        if (ponudnik == Ponudnik.OPENROUTER && predpona == null) return r
        return when (val izbira = SamodejniModel.izberi(prenos, ponudnik, shramba, listOf(model), spanje, predpona)) {
            is SamodejniModel.Izbira.Napaka -> Rezultat.Napaka(sledi.koda, izbira.sporocilo)
            is SamodejniModel.Izbira.Model -> {
                modeli.shrani(ponudnik, izbira.model)
                val r2 = ustvariOdjemalca(ponudnik, shramba, prenos, izbira.model).also { SamodejniModel.nastaviSpanje(it, spanje) }.poslji(zgodovina, sistemsko)
                if (r2 is Rezultat.Besedilo) Rezultat.Besedilo("${r2.besedilo}\n\n(Model $model pri ponudniku ${ponudnik.oznaka} ni več na voljo, zato je Lina preklopila na ${izbira.model}.)") else r2
            }
        }
    }
}
