package si.safeer.lina.seznanitev

import java.net.URI
import java.net.URLDecoder

/** Vabilo poti klicev (strezik OpenLine): isti podatki kot stari QR httpgateway://pair. */
data class KlicnoVabilo(val serverUrl: String, val code: String, val certSha256: String)

/** Kar en QR nastavi: pot klicev, pot asistentke ali (po zdruzeni pogodbi) obe. Vsaj eno ni null. */
data class Seznanitev(val klici: KlicnoVabilo?, val asistent: AsistentNaslov?)

/**
 * En gumb »Skeniraj QR« za obe poti (lastnik 14. 11. 2026). Danes znani zapisi:
 *  - stari QR OpenLine `httpgateway://pair?url=<https>&code=<koda>&fp=<odtis>` -> samo pot klicev (zdruzljivost, ista pravila
 *    kot doslej GatewayPairing.parse: samo https, odtis obvezen);
 *  - vmesni QR asistentke `safeer-lina://asistent?...` (AsistentQr) -> samo pot asistentke.
 * ZDRUZENI QR (en QR, dva razdelka, rok veljavnosti, enkratna koda) bo dolocila pogodba v1 v lina-asistent2 AGENTS.md;
 * dokler ni objavljena, se tak zapis NE ugiba in vrne null.
 */
object QrSeznanitev {
    fun razberi(besedilo: String): Seznanitev? {
        val t = besedilo.trim()
        if (t.length > 2048) return null
        stariOpenLine(t)?.let { return Seznanitev(it, null) }
        AsistentQr.razberi(t)?.let { return Seznanitev(null, it) }
        return null
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
        val server = polje("url")?.trimEnd('/') ?: return null
        val code = polje("code") ?: return null
        val fp = polje("fp")?.trim().orEmpty()
        if (!server.startsWith("https://") || fp.isEmpty()) return null
        return KlicnoVabilo(server, code, fp)
    }
}
