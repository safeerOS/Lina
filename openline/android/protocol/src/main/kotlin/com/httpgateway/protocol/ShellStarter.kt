package com.httpgateway.protocol

import java.util.Base64

/**
 * Zagon lupine. Meritev na Androidu 14: setsid in selitev cgroup ne preživita
 * zaprtja seje adbd (cgroup.procs je system:system, uid 2000 ne pise, $$ v
 * podlupini ni otrok). Zato racunamo na Held. Samostojni poskus se izvede
 * enkrat in se shrani, da se 10 s ne ponavlja ob vsakem zagonu.
 * printf ni vgrajen in bi zeton za hip dal v argv. Uporabi se print -r.
 * Seja je RAW, ne pty, zato stty ni potreben.
 */
object ShellStarter {
    fun detachedScript(apk: String, mainClass: String, version: Long, processName: String): String =
        script(apk, mainClass, version, processName, detach = true)

    fun heldScript(apk: String, mainClass: String, version: Long, processName: String): String =
        script(apk, mainClass, version, processName, detach = false)

    /**
     * Vzorec za pkill -f, ki se ne ujema z lastno ukazno vrstico.
     * `pkill -f httpgateway_shell` ubije sh -c, ker je vzorec v njej.
     */
    fun killPattern(processName: String): String {
        require(processName.isNotEmpty())
        return "[${processName.first()}]${processName.substring(1)}"
    }

    fun killCommand(processName: String): String =
        "pkill -f '${killPattern(processName)}' >/dev/null 2>&1; echo KONEC"

    /**
     * Ukaz za adb shell. Skripta je v base64, da vecvrsticnost ne poreze ukaza.
     * Standardni vhod ostane za 6 vrstic konfiguracije, ne za skripto.
     */
    fun adbShellCommand(script: String, processName: String): String {
        val b64 = Base64.getEncoder().encodeToString(script.toByteArray(Charsets.UTF_8))
        require(!b64.contains('\n')) { "base64 skripte ne sme imeti preloma" }
        return "pkill -f '${killPattern(processName)}' >/dev/null 2>&1; sleep 0.3; " +
            "echo $b64 | base64 -d > /data/local/tmp/openline-starter.sh && " +
            "sh /data/local/tmp/openline-starter.sh; status=\$?; rm -f /data/local/tmp/openline-starter.sh; exit \$status"
    }

    private fun script(
        apk: String,
        mainClass: String,
        version: Long,
        processName: String,
        detach: Boolean,
    ): String {
        val apkQ = shellQuote(apk)
        val mainQ = shellQuote(mainClass)
        val nameQ = shellQuote(processName)
        val body = if (detach) detachedBody(apkQ, mainQ, nameQ, version) else heldBody(apkQ, mainQ, nameQ, version)
        return """
            #!/system/bin/sh
            trap '' HUP
            IFS= read -r OL_A || exit 1
            IFS= read -r OL_B || exit 1
            IFS= read -r OL_C || exit 1
            IFS= read -r OL_D || exit 1
            IFS= read -r OL_E || exit 1
            IFS= read -r OL_F || exit 1
            $body
        """.trimIndent() + "\n"
    }

    private fun feed(nameQ: String, mainQ: String, version: Long, redirect: String): String = """
        {
          print -r -- "${'$'}OL_A"
          print -r -- "${'$'}OL_B"
          print -r -- "${'$'}OL_C"
          print -r -- "${'$'}OL_D"
          print -r -- "${'$'}OL_E"
          print -r -- "${'$'}OL_F"
        } | $redirect app_process /system/bin --nice-name=$nameQ $mainQ $version
    """.trimIndent()

    private fun detachedBody(apkQ: String, mainQ: String, nameQ: String, version: Long): String = """
        fifo="/data/local/tmp/openline.port.${'$'}${'$'}"
        rm -f "${'$'}fifo"
        mkfifo "${'$'}fifo" 2>/dev/null || exit 1
        chmod 600 "${'$'}fifo" 2>/dev/null || true
        (
          trap '' HUP
          export CLASSPATH=$apkQ
          ${feed(nameQ, mainQ, version, "setsid")} >"${'$'}fifo" 2>/dev/null &
          exit 0
        ) &
        IFS= read -r portline < "${'$'}fifo" || exit 1
        rm -f "${'$'}fifo"
        case "${'$'}portline" in
          PORT\ [0-9]*) print -r -- "${'$'}portline" ;;
          *) exit 1 ;;
        esac
        exit 0
    """.trimIndent()

    private fun heldBody(apkQ: String, mainQ: String, nameQ: String, version: Long): String = """
        export CLASSPATH=$apkQ
        ${feed(nameQ, mainQ, version, "")}
    """.trimIndent()

    fun shellQuote(value: String): String = "'" + value.replace("'", "'\\''") + "'"
}

/**
 * Running steje samo, ce pingi drzijo skozi okno po odklopu in se enkrat kasneje.
 * En ping takoj po odklopu ne steje. Izid samostojnega poskusa se shrani.
 */
object ShellLaunchVerdict {
    enum class Kind { DETACHED, HOLD }

    const val EARLY_WINDOW_MS = 4_000L
    const val PING_GAP_MS = 1_000L
    const val LATE_AFTER_MS = 10_000L
    const val MIN_EARLY_PINGS = 3

    fun afterDisconnect(earlyOk: Int, earlyTried: Int, lateOk: Boolean): Kind {
        if (earlyTried < MIN_EARLY_PINGS || earlyOk != earlyTried) return Kind.HOLD
        if (!lateOk) return Kind.HOLD
        return Kind.DETACHED
    }

    /** Prazen spomin: izmeri enkrat. Znani izid se ne meri znova po 10 s. */
    fun shouldMeasure(stored: String?): Boolean = stored.isNullOrBlank()

    /** Znani HOLD preskoci 10–15 s samostojnega poskusa. */
    fun skipDetachedAttempt(stored: String?): Boolean =
        !shouldMeasure(stored) && stored == Kind.HOLD.name
}

/**
 * OCCUPIED ni slepa ulica: vrata se pozabijo in zazene se nova lupina.
 * OURS ostane. STALE (stara razlicica ali nastavitve) se znova zazene.
 */
object ShellProbe {
    enum class Next { USE, RESTART }

    fun classify(handshakeOk: Boolean, connected: Boolean, versionMatches: Boolean, configMatches: Boolean): ShellHandshake.Probe {
        if (!connected) return ShellHandshake.Probe.ABSENT
        if (!handshakeOk) return ShellHandshake.Probe.OCCUPIED
        if (!versionMatches || !configMatches) return ShellHandshake.Probe.STALE
        return ShellHandshake.Probe.OURS
    }

    fun next(probe: ShellHandshake.Probe): Next = when (probe) {
        ShellHandshake.Probe.OURS,
        ShellHandshake.Probe.BUSY,
        -> Next.USE
        ShellHandshake.Probe.OCCUPIED,
        ShellHandshake.Probe.ABSENT,
        ShellHandshake.Probe.STALE,
        -> Next.RESTART
    }

    /** Prvi BUSY se enkrat ponovi. Drugi BUSY se ne steje za tujega zasednika. */
    fun afterRetry(first: ShellHandshake.Probe, second: ShellHandshake.Probe): ShellHandshake.Probe =
        if (first == ShellHandshake.Probe.BUSY) second else first

    fun fromTrip(
        trip: ShellClientProtocol.RoundTrip,
        versionMatches: Boolean,
        configMatches: Boolean,
    ): ShellHandshake.Probe = when (trip) {
        is ShellClientProtocol.RoundTrip.Absent -> ShellHandshake.Probe.ABSENT
        is ShellClientProtocol.RoundTrip.Busy -> ShellHandshake.Probe.BUSY
        is ShellClientProtocol.RoundTrip.Rejected -> ShellHandshake.Probe.OCCUPIED
        is ShellClientProtocol.RoundTrip.Ok -> classify(
            handshakeOk = true,
            connected = true,
            versionMatches = versionMatches,
            configMatches = configMatches,
        )
    }
}

/**
 * Trije zaporedni BUSY brez pozdrava OL2 niso vec »nasa lupina«.
 * Tihi poslusalec na zapomnjenih vratih bi sicer trajno vrnil USE.
 */
object BusyStreak {
    const val LIMIT = 3

    data class Decision(val count: Int, val action: ShellProbe.Next)

    fun decide(seen: Int, probe: ShellHandshake.Probe): Decision {
        if (probe != ShellHandshake.Probe.BUSY) return Decision(0, ShellProbe.next(probe))
        val count = seen + 1
        return if (count >= LIMIT) {
            Decision(0, ShellProbe.Next.RESTART)
        } else {
            Decision(count, ShellProbe.Next.USE)
        }
    }

    /**
     * USE samo za OURS. BUSY pod mejo se ponovi (RETRY), tretji BUSY pozabi vrata.
     * ABSENT zazene novo lupino, ne ubija. OCCUPIED in STALE pozabita vrata.
     */
    enum class StepAction { USE, RETRY, FORGET, START }

    fun action(seen: Int, probe: ShellHandshake.Probe): Pair<Int, StepAction> {
        val decision = decide(seen, probe)
        val step = when {
            probe == ShellHandshake.Probe.OURS -> StepAction.USE
            probe == ShellHandshake.Probe.BUSY && decision.action == ShellProbe.Next.USE -> StepAction.RETRY
            probe == ShellHandshake.Probe.BUSY -> StepAction.FORGET
            probe == ShellHandshake.Probe.ABSENT -> StepAction.START
            else -> StepAction.FORGET
        }
        return decision.count to step
    }
}

/**
 * Zeton in vrata se ne smeta raziti. Pred novim zetonom vrata izginejo.
 * Koncni par se zapise v enem kosu. HMAC ze veze stevilko vrat.
 */
object ShellSessionWrite {
    data class Record(val token: String, val port: Int) {
        override fun toString(): String = "Record(port=$port)"
    }

    fun beginRotation(newToken: String): Record {
        require(newToken.length >= 16) { "zeton je prekratek" }
        return Record(token = newToken, port = -1)
    }

    fun commit(token: String, port: Int): Record {
        require(token.length >= 16) { "zeton je prekratek" }
        require(port in 1..65535) { "vrata niso stevilka TCP" }
        return Record(token = token, port = port)
    }
}

/** Lupina je se pravkar odgovarjala, zdaj pa ne. Dokler je seznanjena in molci, obvestilo ostane. */
object ShellLoss {
    fun shouldNotify(wasServing: Boolean, servesNow: Boolean): Boolean = wasServing && !servesNow

    fun showWhileDown(paired: Boolean, up: Boolean): Boolean = paired && !up

    data class WifiRetry(val shouldRetry: Boolean, val seen: Boolean, val wifiWasUp: Boolean)

    /** Prvi vzorec ne steje kot vrnitev. Ponovni poskus je samo ob prehodu iz brez Wi-Fi na Wi-Fi. */
    fun nextWifi(
        paired: Boolean,
        shellUp: Boolean,
        wifi: Boolean,
        seen: Boolean,
        wifiWasUp: Boolean,
    ): WifiRetry {
        val retry = seen && paired && !shellUp && wifi && !wifiWasUp
        return WifiRetry(shouldRetry = retry, seen = true, wifiWasUp = wifi)
    }
}

/** Ostanki cevi po neuspeli samostojni lupini. Ni del zagonske skripte. */
object FifoCleanup {
    const val WAIT_MS = 2_000L

    fun command(): String = "rm -f /data/local/tmp/openline.port.*"

    /**
     * Ne zapre toka, dokler ukaz ne vrne EOF (n < 0) ali ne potece rok.
     * Takoj zaprt tok ubije rm, preden pobrise cevi.
     */
    fun awaitExit(poll: () -> Int, sleep: (Long) -> Unit, now: () -> Long, deadlineMs: Long = WAIT_MS): Boolean {
        val start = now()
        while (true) {
            val n = poll()
            if (n < 0) return true
            val elapsed = now() - start
            if (elapsed >= deadlineMs) return poll() < 0
            val left = deadlineMs - elapsed
            sleep(minOf(50L, left.coerceAtLeast(1)))
        }
    }
}
