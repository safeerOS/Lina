package si.safeer.lina.protocol

/** Tipka tipkovnice za klicanje: znak in crke pod njim (kot v standardnem telefonu). */
data class DialKey(val digit: String, val letters: String)

/**
 * Lastnik 18. 11. 2026: tipkovnica klicalnika naj bo podobna aplikaciji Telefon. Razpored in crke so na enem mestu,
 * da jih preizkus preveri brez Androida (brez crk bi bila tipkovnica samo mreza stevilk).
 */
object DialKeys {
    val ALL: List<DialKey> = listOf(
        DialKey("1", ""), DialKey("2", "ABC"), DialKey("3", "DEF"),
        DialKey("4", "GHI"), DialKey("5", "JKL"), DialKey("6", "MNO"),
        DialKey("7", "PQRS"), DialKey("8", "TUV"), DialKey("9", "WXYZ"),
        DialKey("*", ""), DialKey("0", "+"), DialKey("#", ""),
    )

    /** Ali je vnos iskanje po imenu (vsebuje crko), ne stevilka. */
    fun isNameQuery(q: String): Boolean = q.any { it.isLetter() }
}
