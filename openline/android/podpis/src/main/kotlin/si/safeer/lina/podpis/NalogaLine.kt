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
        val niz = NiziLine.nizNaloge(id, posiljatelj, b, cas, enkratni) ?: return null
        return PodpisanaNaloga(id, posiljatelj, b, cas, enkratni, podpisnik(niz.toByteArray(Charsets.UTF_8)))
    }
}

/** Povezava telefona z Lino na racunalniku. Koncna tocka v Lini se ne obstaja (14. 11. 2026): edina izvedba je NiPovezave. */
interface PovezavaZLino {
    fun povezana(): Boolean
    /** true, ce je Lina nalogo sprejela. */
    fun poslji(naloga: PodpisanaNaloga): Boolean
}

object NiPovezave : PovezavaZLino {
    override fun povezana() = false
    override fun poslji(naloga: PodpisanaNaloga) = false
}
