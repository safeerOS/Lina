package si.safeer.lina.podpis

import java.security.MessageDigest

/**
 * Nizi, ki jih telefon podpise za Lino na racunalniku. Prepis iz lina-asistent2 src/lib/lina/kanal-claude.ts @f871fc2
 * (nizNaloge v1, nizOdobritve v2, nizUstavitve v1, zgostitevPrikaza). Ujemanje bajt za bajtom drzi NiziLineTest
 * (vektor, izracunan s TS kodo 14. 11. 2026). ODVISNOST: nizOdobritve v Lini spreminja drug agent - ob spremembi tam
 * najprej nov vektor iz TS, nato ta datoteka.
 */
object NiziLine {
    /** Okno veljavnosti podpisa v Lini (OKNO_PODPISA_MS). */
    const val OKNO_PODPISA_MS = 2 * 60_000L
    /** Enkratni niz (ENKRATNI v kanal-claude.ts). */
    val ENKRATNI = Regex("^[A-Za-z0-9_-]{16,64}$")

    fun nizNaloge(id: String, posiljatelj: String, besedilo: String, cas: Long, enkratni: String): String =
        "safeer-lina-naloga-v1\n$id\n$posiljatelj\n$cas\n$enkratni\n$besedilo"

    /** Podpis je vezan na nalogo (chatId) in na prikazano (zgostitev): odobritev ni prenosljiva na drugo vsebino. */
    fun nizOdobritve(
        zahtevaId: String, dovoli: Boolean, posiljatelj: String, cas: Long, enkratni: String, chatId: String, zgostitev: String,
    ): String =
        "safeer-lina-odobritev-v2\n$zahtevaId\n${if (dovoli) "allow" else "deny"}\n$posiljatelj\n$cas\n$enkratni\n$chatId\n$zgostitev"

    /** SHA-256 (hex) TEGA, kar telefon pokaze: orodje, predogled, opis. */
    fun zgostitevPrikaza(orodje: String, predogled: String, opis: String): String =
        MessageDigest.getInstance("SHA-256").digest("$orodje\n$predogled\n$opis".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun nizUstavitve(id: String, posiljatelj: String, cas: Long, enkratni: String): String =
        "safeer-lina-ustavi-v1\n$id\n$posiljatelj\n$cas\n$enkratni"

    /** Besedilo brez osamljenih nadomestnih znakov; tako besedilo se zavrne, ne popravi (praviUnicode v Lini). */
    fun praviUnicode(s: String): Boolean {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= s.length || !Character.isLowSurrogate(s[i + 1])) return false
                i += 2
                continue
            }
            if (Character.isLowSurrogate(c)) return false
            i++
        }
        return true
    }
}
