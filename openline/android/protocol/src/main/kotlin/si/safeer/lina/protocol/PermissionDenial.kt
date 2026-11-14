package si.safeer.lina.protocol

/**
 * Kdaj je dovoljenje TRAJNO zavrnjeno (gumb odpre nastavitve aplikacije namesto prosnje). Napaka na WP28 S (14. 11. 2026):
 * ze ob prvi prosnji, ki je sistem ni pokazal (prazen izid = preklic), je aplikacija javila »Android ne bo vec vprasal«,
 * ker je stela samo »smo vprasali« in rationale == false (pred prvo zavrnitvijo je rationale vedno false).
 * Pravilno: trajno samo, ce je uporabnik prosnjo RES zavrnil (zabelezen izid DENIED) in sistem po tem ne kaze vec razlage.
 */
object PermissionDenial {
    const val GRANTED = 0  // PackageManager.PERMISSION_GRANTED

    /**
     * Novo stanje zapisa »uporabnik je zavrnil« po izidu prosnje. Prazen izid (preklic, okno se ni pokazalo) zapisa ne
     * spremeni; podeljeno ga pobrise.
     */
    fun afterResult(recordedDenial: Boolean, grantResults: IntArray): Boolean = when {
        grantResults.isEmpty() -> recordedDenial
        grantResults[0] == GRANTED -> false
        else -> true
    }

    fun deniedForever(granted: Boolean, recordedDenial: Boolean, showRationale: Boolean): Boolean =
        !granted && recordedDenial && !showRationale
}
