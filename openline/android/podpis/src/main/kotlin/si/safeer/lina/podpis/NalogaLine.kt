package si.safeer.lina.podpis

import java.security.SecureRandom

/** Naloga za Claude Code, kot jo telefon podpise in poslje Lini na racunalniku (polja kot Naloga v asistent.server.ts). */
data class PodpisanaNaloga(
    val id: String,
    val posiljatelj: String,
    val besedilo: String,
    val cas: Long,
    val enkratni: String,
    val podpis: String,
)

/**
 * Priprava in podpis naloge. Meje so iste kot v Lini (lina-asistent2 @f871fc2: asistent.server.ts dovoljenaNaloga,
 * kanal-claude.ts ENKRATNI, ID_NAPRAVE): telefon ne podpise nicesar, kar bi Lina zavrnila.
 */
object NalogaLine {
    const val NAJVEC_ZNAKOV = 4000
    const val NAJKRAJSI_ID = 22
    private const val ABECEDA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"

    /** Besedilo, ki ga uporabnik vpise: obrezano; null, ce je prazno, predolgo ali ima osamljene nadomestne znake. */
    fun besedilo(vnos: String): String? {
        val b = vnos.trim()
        if (b.isEmpty() || b.length > NAJVEC_ZNAKOV || !NiziLine.praviUnicode(b)) return null
        return b
    }

    /** Nakljucen niz iz 64 dovoljenih znakov (za id naloge in enkratni niz). */
    fun nakljucno(dolzina: Int = 32, rnd: SecureRandom = SecureRandom()): String =
        buildString { repeat(dolzina) { append(ABECEDA[rnd.nextInt(ABECEDA.length)]) } }

    /** Podpisana naloga ali null, ce kateri koli del ni veljaven (podpis se ne naredi). */
    fun podpisi(
        id: String, posiljatelj: String, vnos: String, cas: Long, enkratni: String, podpisnik: (ByteArray) -> String,
    ): PodpisanaNaloga? {
        val b = besedilo(vnos) ?: return null
        // Lina (asistent-streznik @e815ed0): id naloge 22-64 znakov - je hkrati kljuc za branje dogodkov (vsaj 128 bitov).
        if (id.length < NAJKRAJSI_ID) return null
        val niz = NiziLine.nizNaloge(id, posiljatelj, b, cas, enkratni) ?: return null
        return PodpisanaNaloga(id, posiljatelj, b, cas, enkratni, podpisnik(niz.toByteArray(Charsets.UTF_8)))
    }

    /** Podpisan odgovor v obstojeco nalogo [id] (POST /nadaljuj); iste meje besedila kot naloga. */
    fun podpisiNadaljevanje(
        id: String, posiljatelj: String, vnos: String, cas: Long, enkratni: String, podpisnik: (ByteArray) -> String,
    ): PodpisanaNaloga? {
        val b = besedilo(vnos) ?: return null
        if (id.length < NAJKRAJSI_ID) return null
        val niz = NiziLine.nizNadaljevanja(id, posiljatelj, b, cas, enkratni) ?: return null
        return PodpisanaNaloga(id, posiljatelj, b, cas, enkratni, podpisnik(niz.toByteArray(Charsets.UTF_8)))
    }
}
