package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.util.Base64

/** Izid orodja ali preverbe: besedilo ali razlog napake (kljuc, omrezje, oblika, meja, racun, prazno). */
sealed class IzidOrodja {
    class Besedilo(val besedilo: String) : IzidOrodja()
    class Napaka(val razlog: String) : IzidOrodja()
}

/**
 * Spletna orodja asistentke na telefonu (lastnik 18. 11. 2026: na telefonu manjkajo kljuci TinyFish, Brave in Twilio).
 * Isto kot v racunalniski Lini: Brave LLM Context isce po spletu, TinyFish Fetch prebere javno stran. Vsak uporabnik ima SVOJ
 * kljuc; naslovi so vgrajeni in nespremenljivi, kljuc ne gre nikamor drugam in ni nikoli v sporocilu napake.
 * Odgovori orodij so besedilo s spleta, torej nezaupano: Asistent jih modelu poda kot podatek, ne kot navodilo.
 */
class SpletnaOrodja(
    private val prenos: Prenos,
    private val kljucBrave: () -> String?,
    private val kljucTinyFish: () -> String?,
) {
    val iskanjeNaVoljo: Boolean get() = kljucBrave() != null
    val branjeNaVoljo: Boolean get() = kljucTinyFish() != null

    fun isci(vprasanje: String): IzidOrodja {
        val k = kljucBrave() ?: return IzidOrodja.Napaka("kljuc")
        val q = pripraviVprasanje(vprasanje) ?: return IzidOrodja.Napaka("prazno")
        return braveIsci(prenos, k, q, MEJA_ZNAKOV)
    }

    fun beri(naslov: String): IzidOrodja {
        val k = kljucTinyFish() ?: return IzidOrodja.Napaka("kljuc")
        val url = javniNaslov(naslov) ?: return IzidOrodja.Napaka("oblika")
        val telo = """{"urls":[${JsonPrimitive(url)}],"format":"markdown","links":false,"image_links":false}"""
        val odg = try {
            prenos.post(TINYFISH_NASLOV, glaveTinyFish(k), telo, 60_000L)
        } catch (e: IOException) {
            return IzidOrodja.Napaka("omrezje")
        } catch (e: InterruptedException) {
            return IzidOrodja.Napaka("omrezje")
        }
        if (odg.koda == 401 || odg.koda == 403) return IzidOrodja.Napaka("kljuc")
        if (odg.koda == 429) return IzidOrodja.Napaka("meja")
        if (odg.koda != 200) return IzidOrodja.Napaka("omrezje")
        val besedilo = try {
            Json.parseToJsonElement(odg.telo).jsonObject["results"]?.jsonArray?.firstOrNull()?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull
        } catch (e: Exception) {
            null
        }
        if (besedilo.isNullOrBlank()) return IzidOrodja.Napaka("prazno")
        val ocisceno = ocistiStran(besedilo)
        if (ocisceno.isBlank()) return IzidOrodja.Napaka("prazno")
        return IzidOrodja.Besedilo(ocisceno.take(MEJA_ZNAKOV))
    }

    companion object {
        const val MEJA_ZNAKOV = 12_000

        private val SLIKA = Regex("!\\[[^\\]]*]\\([^)]*\\)")
        private val POVEZAVA = Regex("\\[([^\\]]*)]\\(([^)]*)\\)")
        private val PISKOTKI = Regex("(?i)(we use cookies|accept all cookies|cookie settings|cookie policy|manage cookies|uporablja pi[sš]kotke|sprejmi vse pi[sš]kotke|nastavitve pi[sš]kotkov)")

        /**
         * Strani s spleta prihranijo prostor v meji [MEJA_ZNAKOV]: odstrani slike, menije (vrstice, ki so skoraj samo povezave),
         * obvestila o piskotkih, podvojene vrstice in odvecne prazne vrstice; povezave ostanejo kot besedilo brez naslova.
         * Besedilo ostane nezaupan podatek (nevtraliziraj ga skrbi pri vracanju modelu).
         */
        internal fun ocistiStran(vhod: String): String {
            val videno = HashSet<String>()
            val izhod = ArrayList<String>()
            for (surova in vhod.lines()) {
                var v = SLIKA.replace(surova, "").trimEnd()
                val povezave = POVEZAVA.findAll(v).toList()
                if (povezave.size >= 3) {
                    val zunaj = POVEZAVA.replace(v, "").replace(Regex("[\\s*\\-|•>·]+"), "")
                    if (zunaj.length * 5 <= v.length) continue   // meni ali seznam povezav
                }
                v = POVEZAVA.replace(v) { it.groupValues[1] }
                if (PISKOTKI.containsMatchIn(v)) continue
                if (v.isBlank()) {
                    if (izhod.isNotEmpty() && izhod.last().isNotEmpty()) izhod.add("")
                    continue
                }
                if (v.length > 3 && !v.trimStart().startsWith("#") && !videno.add(v.trim())) continue
                izhod.add(v)
            }
            return izhod.joinToString("\n").trim()
        }
        const val NAJVEC_ZNAKOV_VPRASANJA = 600
        const val NAJVEC_BESED_VPRASANJA = 75
        private const val BRAVE_NASLOV = "https://api.search.brave.com/res/v1/llm/context"
        private const val TINYFISH_NASLOV = "https://api.fetch.tinyfish.ai"

        /** Kljuc: vidni znaki ASCII brez presledkov, 16-200 znakov (enako kot v racunalniski Lini). */
        fun veljavenKljuc(k: String): Boolean = k.length in 16..200 && k.all { it.code in 0x21..0x7e }

        /** Vprasanje za iskanje: brez kontrolnih znakov, najvec 600 znakov in 75 besed; prazno = null. */
        fun pripraviVprasanje(v: String): String? {
            val besede = v.map { if (it.code < 0x20 || it.code == 0x7f) ' ' else it }.joinToString("").trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
            if (besede.isEmpty()) return null
            var q = besede.take(NAJVEC_BESED_VPRASANJA).joinToString(" ")
            if (q.length > NAJVEC_ZNAKOV_VPRASANJA) q = q.take(NAJVEC_ZNAKOV_VPRASANJA).replace(Regex("\\s+\\S*$"), "")
            return q.ifEmpty { null }
        }

        /**
         * Samo javni https naslov z imenom strani (s piko, brez IP, vrat in uporabnika): zasebna omrezja in naprave domace mreze
         * se zunanji storitvi nikoli ne posljejo (varovalo pred zlorabo prek modela ali strani).
         */
        fun javniNaslov(vnos: String): String? {
            val s = vnos.trim()
            if (s.length > 2000 || !s.startsWith("https://", ignoreCase = true)) return null
            val uri = try { URI(s) } catch (e: Exception) { return null }
            if (uri.userInfo != null || uri.port != -1) return null
            val g = uri.host?.lowercase() ?: return null
            if (!g.contains('.') || g.endsWith(".local") || g.endsWith(".internal") || g.endsWith(".localhost")) return null
            if (g.all { it.isDigit() || it == '.' } || g.contains(':')) return null
            return uri.toASCIIString()
        }

        private fun glaveBrave(k: String) = mapOf("X-Subscription-Token" to k, "Accept" to "application/json")
        private fun glaveTinyFish(k: String) = mapOf("X-API-Key" to k, "Content-Type" to "application/json", "Accept" to "application/json")

        /** Brave LLM Context; 400/422 s slovenskimi parametri se ponovi brez njih (podpora ni zapisana). */
        internal fun braveIsci(prenos: Prenos, kljuc: String, q: String, meja: Int, zZnacilkami: Boolean = true): IzidOrodja {
            val p = StringBuilder("q=").append(URLEncoder.encode(q, "UTF-8")).append("&maximum_number_of_tokens=4096")
            if (zZnacilkami) p.append("&country=SI&search_lang=sl")
            val odg = try {
                prenos.get("$BRAVE_NASLOV?$p", glaveBrave(kljuc), 20_000L)
            } catch (e: IOException) {
                return IzidOrodja.Napaka("omrezje")
            } catch (e: InterruptedException) {
                return IzidOrodja.Napaka("omrezje")
            }
            if (odg.koda == 401 || odg.koda == 403) return IzidOrodja.Napaka("kljuc")
            if (odg.koda == 429) return IzidOrodja.Napaka("meja")
            if ((odg.koda == 400 || odg.koda == 422) && zZnacilkami) return braveIsci(prenos, kljuc, q, meja, false)
            if (odg.koda != 200) return IzidOrodja.Napaka("omrezje")
            val viri = razcleniBrave(odg.telo, meja)
            return if (viri.isBlank()) IzidOrodja.Napaka("prazno") else IzidOrodja.Besedilo(viri)
        }

        /** Iz odgovora izlusci naslov, naslov strani in izvlecke; neveljavne vnose izpusti, skupno besedilo omeji na [meja]. */
        internal fun razcleniBrave(telo: String, meja: Int): String {
            val generic = try {
                Json.parseToJsonElement(telo).jsonObject["grounding"]?.jsonObject?.get("generic")?.jsonArray
            } catch (e: Exception) {
                null
            } ?: return ""
            val izhod = StringBuilder()
            var n = 0
            for (g in generic) {
                if (izhod.length >= meja) break
                val o = g as? JsonObject ?: continue
                val url = (o["url"] as? JsonPrimitive)?.contentOrNull ?: continue
                if (!url.startsWith("https://") && !url.startsWith("http://")) continue
                val naslov = (o["title"] as? JsonPrimitive)?.contentOrNull?.take(300) ?: url
                val izvlecki = (o["snippets"] as? kotlinx.serialization.json.JsonArray)
                    ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { s -> s.isNotEmpty() } }
                    ?: continue
                if (izvlecki.isEmpty()) continue
                n++
                izhod.append(n).append(". ").append(naslov).append(" (").append(url).append(")\n")
                for (s in izvlecki) {
                    if (izhod.length >= meja) break
                    izhod.append(s.take(meja - izhod.length)).append('\n')
                }
                izhod.append('\n')
            }
            return izhod.toString().trim().take(meja)
        }

        /** Preverba kljuca Brave: ena poizvedba; kljuc se shrani sele, ko jo storitev sprejme. */
        fun preveriBrave(prenos: Prenos, kljuc: String): IzidOrodja {
            if (!veljavenKljuc(kljuc)) return IzidOrodja.Napaka("oblika")
            val izid = braveIsci(prenos, kljuc, "Slovenija", 1_000)
            // Prazen izid pomeni, da je storitev odgovorila 200, torej je kljuc veljaven.
            return if (izid is IzidOrodja.Napaka && izid.razlog == "prazno") IzidOrodja.Besedilo("") else izid
        }

        /** Preverba kljuca TinyFish z brezplacnim branjem porabe. */
        fun preveriTinyFish(prenos: Prenos, kljuc: String): IzidOrodja {
            if (!veljavenKljuc(kljuc)) return IzidOrodja.Napaka("oblika")
            val odg = try {
                prenos.get("$TINYFISH_NASLOV/usage?limit=1", glaveTinyFish(kljuc), 20_000L)
            } catch (e: IOException) {
                return IzidOrodja.Napaka("omrezje")
            } catch (e: InterruptedException) {
                return IzidOrodja.Napaka("omrezje")
            }
            return when (odg.koda) {
                200 -> IzidOrodja.Besedilo("")
                401, 403 -> IzidOrodja.Napaka("kljuc")
                else -> IzidOrodja.Napaka("omrezje")
            }
        }

        /**
         * Preverba racuna Twilio: branje lastnega racuna (Basic). Vrne ime racuna. Telefon Twilio za zdaj SAMO preveri
         * (klici in SMS prek Twilio niso vkljuceni): kar ni narejeno, se ne obljubi.
         */
        fun preveriTwilio(prenos: Prenos, sid: String, zeton: String): IzidOrodja {
            if (!Regex("AC[0-9a-fA-F]{32}").matches(sid) || !Regex("[0-9A-Za-z]{32}").matches(zeton)) return IzidOrodja.Napaka("oblika")
            val povezava = Base64.getEncoder().encodeToString("$sid:$zeton".toByteArray(Charsets.UTF_8))
            val odg = try {
                prenos.get("https://api.twilio.com/2010-04-01/Accounts/$sid.json", mapOf("Authorization" to "Basic $povezava", "Accept" to "application/json"), 20_000L)
            } catch (e: IOException) {
                return IzidOrodja.Napaka("omrezje")
            } catch (e: InterruptedException) {
                return IzidOrodja.Napaka("omrezje")
            }
            if (odg.koda == 401 || odg.koda == 403) return IzidOrodja.Napaka("kljuc")
            if (odg.koda != 200) return IzidOrodja.Napaka("omrezje")
            val o = try { Json.parseToJsonElement(odg.telo).jsonObject } catch (e: Exception) { return IzidOrodja.Napaka("omrezje") }
            if ((o["status"] as? JsonPrimitive)?.contentOrNull != "active") return IzidOrodja.Napaka("racun")
            return IzidOrodja.Besedilo((o["friendly_name"] as? JsonPrimitive)?.contentOrNull?.take(80) ?: "")
        }
    }
}
