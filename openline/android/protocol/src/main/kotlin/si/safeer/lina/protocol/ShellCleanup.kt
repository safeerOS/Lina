package si.safeer.lina.protocol

/**
 * Ustavi in pocisti ne more izbrisati kljuca brezzicnega parjenja.
 * /data/misc/adb/adb_keys lupina obicajno ne sme pisati, kljuci parjenja
 * pa so v adb_temp_keys.xml. Uporabniku tega ne smemo prikazati kot uspeh.
 */
object ShellCleanup {
    /** Ce pkill ni potrdil KONEC, ping takoj se vidi umirajoco lupino. */
    const val WIPE_SETTLE_MS = 300L

    /** Kratki koraki, dokler proces ne utihne. Eno spanje 200 ali 300 ms je pretesno. */
    const val WIPE_POLL_MS = 50L

    /** Rok, do katerega cakamo, da ping res utihne. */
    const val WIPE_DEADLINE_MS = 2_000L

    fun settleBeforeRecheck(acknowledged: Boolean): Long = if (acknowledged) 0L else WIPE_SETTLE_MS

    /** Po pkill ping ne sme vec uspeti. Sicer ustavitev ni bila resnicna. */
    fun wipeStopped(stillAnswersPing: Boolean): Boolean = !stillAnswersPing

    /**
     * Caka, da proces neha odgovarjati, najvec do roka.
     * Eno spanje 300 ms je prekratko, ce izhod traja dlje kot to.
     * Vrne true, ko ping utihne.
     */
    fun waitUntilDown(
        answers: () -> Boolean,
        sleep: (Long) -> Unit,
        now: () -> Long,
        deadlineMs: Long = WIPE_DEADLINE_MS,
    ): Boolean {
        val start = now()
        while (true) {
            if (!answers()) return true
            val elapsed = now() - start
            if (elapsed >= deadlineMs) return !answers()
            val left = deadlineMs - elapsed
            sleep(minOf(WIPE_POLL_MS, left.coerceAtLeast(1)))
        }
    }

    /** pkill je odjeknil KONEC. Ce ga ni, je ukaz ubil lastno lupino ali visel. */
    fun killAcknowledged(output: String): Boolean = output.lineSequence().any { it.trim() == "KONEC" }
}
