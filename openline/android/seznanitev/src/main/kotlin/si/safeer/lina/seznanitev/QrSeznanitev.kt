package si.safeer.lina.seznanitev

import java.net.URI
import java.net.URLDecoder

/** Vabilo poti klicev (strezik OpenLine): isti podatki kot stari QR httpgateway://pair. */
data class KlicnoVabilo(val serverUrl: String, val code: String, val certSha256: String)

/** Vabilo asistentke iz zdruzenega QR v1: naslov Line, enkratna koda (22-64) in rok v ms od 1970. */
data class AsistentVabilo(val naslov: AsistentNaslov, val koda: String, val doMs: Long)

/** Kar en QR nastavi: pot klicev, asistentko ali obe. Vsaj eno ni null. */
data class Seznanitev(val klici: KlicnoVabilo?, val asistent: AsistentVabilo?)

/**
 * En gumb »Skeniraj QR« za obe poti (lastnik 14. 11. 2026), pogodba v1: lina-asistent2 AGENTS.md @7a065fb
 *   httpgateway://pair?v=1[&url=&code=&fp=]&lina=<https://naslov:vrata/api/asistent/v1>&linafp=<64 hex>&linakoda=<22-64>&do=<ms>
 *  - brez v: stari QR OpenLine (samo pot klicev), ista pravila kot doslej GatewayPairing.parse;
 *  - v=1: razdelek klicev (url, code, fp: vsi trije ali nobeden) + razdelek asistentke (obvezen). Neznani ali podvojeni
 *    parametri, potekel rok, javni naslov ali ime gostitelja: zavrnjeno (null) - nic se ne nastavi napol.
 */
object QrSeznanitev {
    private val ODTIS = Regex("^[0-9a-fA-F]{64}$")
    private val KODA_LINE = Regex("^[A-Za-z0-9_-]{22,64}$")
    private val KODA_OPENLINE = Regex("^[A-Za-z0-9]{8}$")
    private val V1_POLJA = setOf("v", "url", "code", "fp", "lina", "linafp", "linakoda", "do")
    const val POT_ASISTENTKE = "/api/asistent/v1"

    fun razberi(besedilo: String, zdajMs: Long): Seznanitev? {
        val t = besedilo.trim()
        if (t.length > 2048) return null
        val uri = try { URI(t) } catch (_: Exception) { return null }
        if (uri.scheme != "httpgateway" || uri.rawAuthority != "pair") return null
        val pari = (uri.rawQuery ?: return null).split('&').map { it.split('=', limit = 2) }
        if (pari.any { it.size != 2 }) return null
        val imena = pari.map { it[0] }
        if ("v" !in imena) return stariOpenLine(t)?.let { Seznanitev(it, null) }
        if (imena.size != imena.toSet().size || !V1_POLJA.containsAll(imena)) return null
        val p = try { pari.associate { it[0] to URLDecoder.decode(it[1], "UTF-8") } } catch (_: Exception) { return null }
        if (p["v"] != "1") return null
        val klici = when {
            listOf("url", "code", "fp").none { it in p } -> null
            listOf("url", "code", "fp").all { it in p } -> klicniDel(p.getValue("url"), p.getValue("code"), p.getValue("fp")) ?: return null
            else -> return null
        }
        val doMs = p["do"]?.takeIf { it.length in 1..15 && it.all(Char::isDigit) }?.toLong() ?: return null
        if (doMs <= zdajMs) return null
        val koda = p["linakoda"]?.takeIf { KODA_LINE.matches(it) } ?: return null
        val odtis = p["linafp"]?.takeIf { ODTIS.matches(it) } ?: return null
        val naslov = naslovLine(p["lina"] ?: return null, odtis) ?: return null
        return Seznanitev(klici, AsistentVabilo(naslov, koda, doMs))
    }

    /** https://<zasebni IP>:<vrata>/api/asistent/v1 brez uporabnika, poizvedbe in drobca. */
    private fun naslovLine(url: String, odtis: String): AsistentNaslov? {
        val u = try { URI(url) } catch (_: Exception) { return null }
        if (u.scheme != "https" || u.rawUserInfo != null || u.rawQuery != null || u.rawFragment != null) return null
        if (u.rawPath != POT_ASISTENTKE || u.port !in 1..65535) return null
        val host = (u.host ?: return null).removePrefix("[").removeSuffix("]")
        return AsistentQr.naslov(host, u.port, odtis)
    }

    /** Razdelek klicev v v1: https na zasebnem naslovu, koda OpenLine 8 znakov, odtis 64 hex. */
    fun klicnoVabilo(url: String, code: String, fp: String): KlicnoVabilo? = klicniDel(url, code, fp)

    private fun klicniDel(url: String, code: String, fp: String): KlicnoVabilo? {
        val u = try { URI(url) } catch (_: Exception) { return null }
        if (u.scheme != "https" || u.rawUserInfo != null) return null
        val host = (u.host ?: return null).removePrefix("[").removeSuffix("]")
        if (!AsistentQr.jeZasebniNaslov(host) || !KODA_OPENLINE.matches(code) || !ODTIS.matches(fp)) return null
        return KlicnoVabilo(url.trimEnd('/'), code, fp.lowercase())
    }

    /** Pravila starega GatewayPairing.parse brez Androida (Uri.getQueryParameter dekodira tudi + v presledek). */
    fun stariOpenLine(t: String): KlicnoVabilo? {
        val uri = try { URI(t) } catch (_: Exception) { return null }
        if (uri.scheme != "httpgateway" || uri.host != "pair") return null
        val q = uri.rawQuery ?: return null
        fun polje(ime: String): String? = q.split('&').firstNotNullOfOrNull { del ->
            val p = del.split('=', limit = 2)
            if (p.size == 2 && p[0] == ime) try { URLDecoder.decode(p[1], "UTF-8") } catch (_: Exception) { null } else null
        }
        if (polje("v") != null) return null
        val server = polje("url")?.trimEnd('/') ?: return null
        val code = polje("code") ?: return null
        val fp = polje("fp")?.trim().orEmpty()
        if (!server.startsWith("https://") || fp.isEmpty()) return null
        return KlicnoVabilo(server, code, fp)
    }
}
