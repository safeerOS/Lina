package si.safeer.lina.podpis

import java.security.MessageDigest

/**
 * Nizi, ki jih telefon podpise za Lino na racunalniku. Prepis iz lina-asistent2 src/lib/lina/kanal-claude.ts @f871fc2
 * (nizNaloge v1, nizOdobritve v2, nizUstavitve v1, zgostitevPrikaza). Ujemanje bajt za bajtom drzi NiziLineTest
 * (vektor, izracunan s TS kodo 14. 11. 2026). ODVISNOST: nizOdobritve v Lini spreminja drug agent - ob spremembi tam
 * najprej nov vektor iz TS, nato ta datoteka.
 *
 * Pregled 17 (A3): vsak niz se sestavi SAMO iz preverjenih polj (vzorci iz kanal-claude.ts in asistent.server.ts); polje z
 * napacno obliko ali prelomom vrstice da null in se ne podpise - tako polje ne more premakniti meje med polji niza.
 * Vsak niz se zacne s predpono svojega namena (safeer-lina-...), nikoli s safeer-krog-clan-v1 (A2).
 */
object NiziLine {
    /** Okno veljavnosti podpisa v Lini (OKNO_PODPISA_MS). */
    const val OKNO_PODPISA_MS = 2 * 60_000L
    /** Enkratni niz (ENKRATNI v kanal-claude.ts). */
    val ENKRATNI = Regex("^[A-Za-z0-9_-]{16,64}$")
    /** Id naloge in pogovora (asistent.server.ts dovoljenaNaloga). */
    val ID_NALOGE = Regex("^[A-Za-z0-9_-]{8,64}$")
    /** Id naprave (ID_NAPRAVE v kanal-claude.ts). */
    val ID_NAPRAVE = Regex("^n-[0-9a-f]{16}(-[A-Za-z0-9._-]{1,100})?$")
    /** Id zahteve za odobritev (ID_ODOBRITVE v kanal-claude.ts). */
    val ID_ODOBRITVE = Regex("^[a-km-z]{5}$")
    private val ZGOSTITEV = Regex("^[0-9a-f]{64}$")

    const val PREDPONA_NALOGE = "safeer-lina-naloga-v1"
    const val PREDPONA_ODOBRITVE = "safeer-lina-odobritev-v2"
    const val PREDPONA_USTAVITVE = "safeer-lina-ustavi-v1"
    const val PREDPONA_SEZNANITVE = "safeer-lina-seznani-v1"
    const val PREDPONA_STANJA = "safeer-lina-stanje-v1"
    /** Enkratna koda asistentke iz zdruzenega QR v1 (linakoda). */
    val KODA_SEZNANITVE = Regex("^[A-Za-z0-9_-]{22,64}$")
    private val B64 = Regex("^[A-Za-z0-9+/]{40,200}={0,2}$")

    /** Ime telefona: 1-60 znakov, brez nadzornih in oblikovnih znakov (pogodba seznanitve @7a065fb). */
    fun veljavnoIme(ime: String): Boolean =
        ime.length in 1..60 && praviUnicode(ime) && ime.none { Character.isISOControl(it) || Character.getType(it) == Character.FORMAT.toInt() }

    /** Pogodba seznanitve @7a065fb (kanal-claude.ts nizSeznanitve); id mora biti izpeljan iz [kljuc]. */
    fun nizSeznanitve(koda: String, id: String, kljuc: String, ime: String, cas: Long, enkratni: String): String? {
        if (!KODA_SEZNANITVE.matches(koda) || !skupno(id, cas, enkratni) || !B64.matches(kljuc) || !veljavnoIme(ime)) return null
        if (runCatching { KrogKljuc.idIzKljuca(kljuc) }.getOrNull() != id) return null
        return "$PREDPONA_SEZNANITVE\n$koda\n$id\n$kljuc\n$cas\n$enkratni\n$ime"
    }

    /** Poizvedba o stanju seje Claude Code (kanal-claude.ts nizStanja @7a065fb). */
    fun nizStanja(posiljatelj: String, cas: Long, enkratni: String): String? {
        if (!skupno(posiljatelj, cas, enkratni)) return null
        return "$PREDPONA_STANJA\n$posiljatelj\n$cas\n$enkratni"
    }

    private fun skupno(posiljatelj: String, cas: Long, enkratni: String): Boolean =
        ID_NAPRAVE.matches(posiljatelj) && cas > 0 && ENKRATNI.matches(enkratni)

    /** Besedilo je zadnje polje: sme imeti prelome, ne sme pa osamljenih nadomestnih znakov. */
    fun nizNaloge(id: String, posiljatelj: String, besedilo: String, cas: Long, enkratni: String): String? {
        if (!ID_NALOGE.matches(id) || !skupno(posiljatelj, cas, enkratni) || !praviUnicode(besedilo)) return null
        return "$PREDPONA_NALOGE\n$id\n$posiljatelj\n$cas\n$enkratni\n$besedilo"
    }

    /** Podpis je vezan na nalogo (chatId) in na prikazano (zgostitev): odobritev ni prenosljiva na drugo vsebino. */
    fun nizOdobritve(
        zahtevaId: String, dovoli: Boolean, posiljatelj: String, cas: Long, enkratni: String, chatId: String, zgostitev: String,
    ): String? {
        if (!ID_ODOBRITVE.matches(zahtevaId) || !skupno(posiljatelj, cas, enkratni)) return null
        if (!ID_NALOGE.matches(chatId) || !ZGOSTITEV.matches(zgostitev)) return null
        return "$PREDPONA_ODOBRITVE\n$zahtevaId\n${if (dovoli) "allow" else "deny"}\n$posiljatelj\n$cas\n$enkratni\n$chatId\n$zgostitev"
    }

    /** SHA-256 (hex) TEGA, kar telefon pokaze: orodje, predogled, opis. */
    fun zgostitevPrikaza(orodje: String, predogled: String, opis: String): String =
        MessageDigest.getInstance("SHA-256").digest("$orodje\n$predogled\n$opis".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun nizUstavitve(id: String, posiljatelj: String, cas: Long, enkratni: String): String? {
        if (!ID_NALOGE.matches(id) || !skupno(posiljatelj, cas, enkratni)) return null
        return "$PREDPONA_USTAVITVE\n$id\n$posiljatelj\n$cas\n$enkratni"
    }

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
