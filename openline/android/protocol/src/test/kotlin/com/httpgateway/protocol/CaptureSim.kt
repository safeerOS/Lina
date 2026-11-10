package com.httpgateway.protocol

import com.httpgateway.protocol.CaptureMachine.Effect
import com.httpgateway.protocol.CaptureMachine.Event
import com.httpgateway.protocol.CaptureMachine.Phase
import com.httpgateway.protocol.CaptureMachine.State
import com.httpgateway.protocol.CaptureMachine.StopDebt
import java.util.concurrent.Executor

/** Vrsta, ki jo preizkus izvaja po korakih: vrstni red niti doloci preizkus, ne razporejevalnik. */
internal class ManualExecutor : Executor {
    val tasks = ArrayDeque<Runnable>()

    override fun execute(command: Runnable) {
        tasks.addLast(command)
    }

    fun runNext(): Boolean {
        val task = tasks.removeFirstOrNull() ?: return false
        task.run()
        return true
    }

    fun runAll() {
        while (runNext()) Unit
    }
}

/**
 * Zaprt model: pravi CaptureDriver in CaptureMachine, lazna lupina, lazen Telecom in
 * model storitve klicev (kateri dogodek poslje ob kateri spremembi). Brez niti in brez ure.
 */
internal class CaptureSim(private val api29: Boolean = false) {
    companion object {
        const val X = "klic-x"
        const val W = "klic-w"
        const val ACTIVE = TelecomPhase.STATE_ACTIVE
        const val PROCESSING = TelecomPhase.STATE_AUDIO_PROCESSING
    }

    // Svet: lupina in Telecom.
    var session: String? = null
    var xPresent = false
    var xOwned = false
    var xHeld = false
    var xState = 0
    var wLive = false
    var gaveBack = false
    val notices = mutableListOf<ReturnNotice>()
    var lastExit: CapturePorts.ExitFacts? = null
    var lastDisconnect: Boolean? = null

    // Izidi naslednjih klicev vrat.
    var prepOk = true
    var startOk = true
    var stopOk = true
    var exitOk = true
    var disconnectOk = true
    var disconnectThrows = false
    var pingOk = true
    var duringStart: (() -> Unit)? = null
    var duringPing: (() -> Unit)? = null

    /** Stevilo izzvanih napak (priprava, lupina, ping). Brez napake se klic ne sme vrniti. */
    var faults = 0

    val calls = mutableListOf<String>()
    val violations = mutableListOf<String>()
    private var clock = 0L

    val queue = ManualExecutor()
    val ops = ManualExecutor()
    val prep = ManualExecutor()
    val lease = ManualExecutor()
    val timers = ArrayDeque<Pair<Long, Runnable>>()

    // Oznake cakajocih opravil. Preizkus z njimi ve, kaj je na vrsti, in preveri ozicenje.
    val opsLabels = ArrayDeque<Effect>()
    val prepLabels = ArrayDeque<Effect>()
    val leaseLabels = ArrayDeque<Effect>()
    val timerLabels = ArrayDeque<Effect>()

    var state = State()
        private set
    val trace = mutableListOf<Triple<State, Event, CaptureMachine.Step>>()

    private val ports = object : CapturePorts {
        override fun prepare(callId: String): Boolean {
            calls += "prepare:$callId"
            return prepOk
        }

        override fun linePermits(callId: String): Boolean = permits(callId)

        override fun start(callId: String): Boolean {
            calls += "start:$callId"
            if (!permits(callId)) violations += "start brez dovoljenja linije"
            if (!startOk) return false
            session = callId
            duringStart?.let {
                duringStart = null
                it()
            }
            return true
        }

        override fun stop(callId: String?, timeoutMs: Int): Boolean {
            calls += "stop:${callId ?: "*"}"
            if (!stopOk) return false
            if (callId == null || session == callId) session = null
            return true
        }

        override fun markManual(callId: String) {
            calls += "markManual:$callId"
            if (callId == X) {
                xOwned = false
                gaveBack = true
            }
        }

        override fun notifyServerEnded(callId: String) {
            calls += "notifyServer:$callId"
            if (!gaveBack) violations += "streznik obvescen pred markManual"
        }

        override fun exitBackgroundAudio(callId: String, attemptExit: Boolean): CapturePorts.ExitFacts {
            calls += "exit:$callId"
            if (!gaveBack) violations += "izhod iz ozadja pred markManual"
            // Vrstni red A1: pred izhodom mora biti vsaj en poskus stop (uspesen ali ne).
            if (!calls.dropLast(1).takeLastWhile { !it.startsWith("markManual") }.any { it.startsWith("stop:") }) {
                violations += "izhod iz ozadja brez poskusa stop"
            }
            val facts = if (!xPresent) {
                CapturePorts.ExitFacts(callPresent = false, exitOk = false, callState = 0)
            } else {
                val ok = attemptExit && exitOk && !api29 && xState == PROCESSING
                if (ok) xState = ACTIVE
                CapturePorts.ExitFacts(callPresent = true, exitOk = ok, callState = xState)
            }
            lastExit = facts
            lastDisconnect = null
            return facts
        }

        override fun disconnect(callId: String): Boolean {
            calls += "disconnect:$callId"
            val exit = lastExit
            if (exit == null || !exit.callPresent || exit.exitOk || exit.callState != PROCESSING) {
                violations += "prekinitev klica, ki ni tih v AUDIO_PROCESSING"
            }
            if (disconnectThrows) {
                lastDisconnect = false
                throw IllegalStateException("telecom")
            }
            val ok = disconnectOk && xPresent
            if (ok) xPresent = false
            lastDisconnect = ok
            return ok
        }

        override fun ping(): CapturePorts.PingFacts {
            calls += "ping"
            val facts = CapturePorts.PingFacts(ok = pingOk, reported = if (pingOk) session else null, paired = true, wifi = true)
            duringPing?.let {
                duringPing = null
                it()
            }
            return facts
        }

        override fun confirm(callId: String) {
            calls += "confirm:$callId"
        }

        override fun showNotice(notice: ReturnNotice) {
            calls += "notice:${notice.key}"
            notices += notice
            val expected = expectedNotice()
            if (notice != expected) violations += "obvestilo ${notice.key}, dejanski izid ${expected?.key}"
        }

        override fun publishShellLost() {
            calls += "shellLost"
        }

        override fun cancelShellLost() {
            calls += "shellFound"
        }

        override fun relaunchShell() {
            calls += "relaunch"
        }

        override fun recheckLine(callId: String) {
            calls += "recheck:$callId"
            // Model storitve: syncCallAudio za ta klic.
            if (callId == X && xPresent && xOwned) postPolicy()
        }

        override fun nowMs(): Long = clock

        override fun sleep(ms: Long) {
            clock += ms
        }
    }

    val driver = CaptureDriver(
        ports = ports,
        queue = queue,
        shellOps = ops,
        prep = prep,
        lease = lease,
        later = { delay, task -> timers.addLast(delay to task) },
        observer = { before, event, step ->
            state = step.state
            trace += Triple(before, event, step)
            step.effects.forEach(::label)
        },
    )

    private fun label(effect: Effect) {
        when (effect) {
            is Effect.Prepare, Effect.RelaunchShell -> prepLabels.addLast(effect)
            is Effect.StartCapture, is Effect.StopCapture,
            is Effect.ExitBackgroundAudio, is Effect.Disconnect, is Effect.ShowNotice,
            -> opsLabels.addLast(effect)
            is Effect.PingShell, is Effect.ConfirmLease, Effect.PublishShellLost, Effect.CancelShellLost,
            -> leaseLabels.addLast(effect)
            is Effect.ScheduleRetry -> timerLabels.addLast(effect)
            is Effect.MarkManual, is Effect.NotifyServerEnded, is Effect.RecheckLine -> Unit
        }
    }

    /** Dejanski izid vrnitve klica, kot ga vidi uporabnik. Neodvisno od avtomata. */
    private fun expectedNotice(): ReturnNotice? {
        val exit = lastExit ?: return null
        return when {
            lastDisconnect == true -> ReturnNotice.DISCONNECTED
            !exit.callPresent -> ReturnNotice.DISCONNECTED
            exit.exitOk || exit.callState == ACTIVE -> ReturnNotice.RETURNED
            else -> ReturnNotice.NOT_RETURNED
        }
    }

    fun permits(callId: String?): Boolean = callId == X && xPresent && xOwned && !xHeld && !wLive

    fun post(event: Event) {
        driver.post(event)
        queue.runAll()
    }

    /** Isto kot GatewayInCallService.syncCallAudio za Linin klic. */
    private fun postPolicy() {
        driver.post(if (permits(X)) Event.CallActive(X) else Event.CallSuspended(X))
    }

    // Zunanji dogodki, kot jih poslje storitev klicev.

    /** Nov Linin klic z istim id ni mogoc, dokler se vrnitev prejsnjega se izvaja. */
    fun canActivate(): Boolean = (xPresent && xOwned) || opsLabels.none {
        it is Effect.ExitBackgroundAudio || it is Effect.Disconnect || it is Effect.ShowNotice
    }

    /** START storitve, ki je bil v vrsti, se preden je klic prevzel uporabnik. */
    fun staleActive() = post(Event.CallActive(X))

    /** Lina prevzame klic X in ta je aktiven (ali se vrne s cakanja). */
    fun activate() {
        if (!(xPresent && xOwned)) {
            xPresent = true
            xOwned = true
            xState = if (api29) ACTIVE else PROCESSING
            gaveBack = false
            notices.clear()
            lastExit = null
            lastDisconnect = null
        }
        xHeld = false
        postPolicy()
        queue.runAll()
    }

    /** Uporabnik dvigne ali zacne svoj klic W. */
    fun userCallLive() {
        wLive = true
        post(Event.UnsafeDownlink)
    }

    /** Tuj klic W je odstranjen (tudi cakajoci klic, ki ni bil nikoli aktiven). */
    fun foreignCallRemoved() {
        wLive = false
        post(Event.CallEnded(W))
    }

    fun xRemoved() {
        xPresent = false
        xOwned = false
        post(Event.CallEnded(X))
    }

    /** Uporabnik prevzame Linin klic (markManual v storitvi, klic gre na slusalko). */
    fun userTakesX() {
        xOwned = false
        xState = ACTIVE
        post(Event.CallEnded(X))
    }

    /** Linin klic gre na cakanje: politika vrne STOP za Linin klic. */
    fun xHeld() {
        xHeld = true
        post(Event.CallSuspended(X))
    }

    fun tick() = post(Event.LeaseDue)

    /** Lupina izgubi sejo sama (padec procesa zvoka). To je napaka, po kateri se klic sme vrniti. */
    fun shellLosesSession() {
        session = null
        faults++
    }

    // Koraki niti.

    fun runPrep(ok: Boolean = true): Boolean {
        if (prep.tasks.isEmpty()) return false
        prepLabels.removeFirst()
        if (!ok) faults++
        prepOk = ok
        prep.runNext()
        prepOk = true
        queue.runAll()
        return true
    }

    fun runOps(ok: Boolean = true, during: (() -> Unit)? = null): Boolean {
        if (ops.tasks.isEmpty()) return false
        opsLabels.removeFirst()
        if (!ok) faults++
        startOk = ok
        stopOk = ok
        exitOk = ok
        disconnectOk = ok
        duringStart = during
        clock = 0
        ops.runNext()
        duringStart = null
        startOk = true
        stopOk = true
        exitOk = true
        disconnectOk = true
        queue.runAll()
        return true
    }

    fun runLease(ok: Boolean = true, during: (() -> Unit)? = null): Boolean {
        if (lease.tasks.isEmpty()) return false
        leaseLabels.removeFirst()
        if (!ok) faults++
        pingOk = ok
        duringPing = during
        lease.runNext()
        duringPing = null
        pingOk = true
        queue.runAll()
        return true
    }

    fun fireTimer(): Boolean {
        val (_, task) = timers.removeFirstOrNull() ?: return false
        timerLabels.removeFirst()
        task.run()
        queue.runAll()
        return true
    }

    /** Vse niti do konca z uspesnimi izidi, nato trije krogi najema. False: sistem se ne umiri. */
    fun settle(maxSteps: Int = 400): Boolean {
        var steps = 0
        fun drain(): Boolean {
            while (true) {
                if (++steps > maxSteps) return false
                if (runPrep() || runOps() || runLease() || fireTimer()) continue
                return true
            }
        }
        if (!drain()) return false
        repeat(3) {
            tick()
            if (!drain()) return false
        }
        return true
    }

    /**
     * Odtis stanja za preiskavo. Avtomat stevce samo primerja na enakost, zato je dovolj,
     * ali je stevec v cakajocem opravilu tekoc (0) ali zastarel (-1): zastarel ostane zastarel.
     * Zdravje lupine na zajem ne vpliva. Tako je razlicnih stanj koncno mnogo.
     */
    fun fingerprint(): List<Any?> {
        fun gen(value: Long) = if (value == state.generation) 0L else -1L
        fun seq(value: Long) = if (value == state.stopSeq) 0L else -1L
        fun norm(effect: Effect): Effect = when (effect) {
            is Effect.Prepare -> effect.copy(generation = gen(effect.generation))
            is Effect.StartCapture -> effect.copy(generation = gen(effect.generation))
            is Effect.ScheduleRetry -> effect.copy(generation = gen(effect.generation))
            is Effect.StopCapture -> effect.copy(seq = if (effect.seq == 0L) 1L else seq(effect.seq))
            is Effect.PingShell -> effect.copy(generation = gen(effect.generation), stopSeq = seq(effect.stopSeq))
            else -> effect
        }
        return listOf(
            state.copy(generation = 0, stopSeq = 0, shell = CaptureMachine.ShellHealth()),
            session, xPresent, xOwned, xHeld, xState, wLive, gaveBack, notices.toSet(), lastExit, lastDisconnect,
            faults > 0, opsLabels.map(::norm), prepLabels.map(::norm), leaseLabels.map(::norm), timerLabels.map(::norm),
        )
    }

    /** Invariante, ki morajo veljati po vsakem koraku (vrsta dogodkov je prazna). */
    fun stableViolations(): List<String> {
        val found = violations.toMutableList()
        if (queue.tasks.isNotEmpty()) found += "vrsta dogodkov ni prazna"
        if (opsLabels.size != ops.tasks.size || prepLabels.size != prep.tasks.size ||
            leaseLabels.size != lease.tasks.size || timerLabels.size != timers.size
        ) {
            found += "ucinek ni sel na pricakovano nit"
        }
        if (state.view.expected == null && state.view.startInFlight) found += "razbit pogled najema"
        if (state.phase == Phase.CAPTURING && !permits(state.callId)) found += "potrjen zajem, ki ga linija ne dovoli"
        val running = session
        if (running != null && !permits(running)) {
            val stopOnWay = opsLabels.any { it is Effect.StopCapture && (it.callId == null || it.callId == running) }
            if (!stopOnWay && state.stop != StopDebt.OWED) found += "zajem tece brez dovoljenja in brez izdanega stop"
        }
        if (state.stop != StopDebt.SETTLED && state.sessionWanted) found += "dolg stop med zelenim zajemom"
        // Samo prepletanje niti, brez ene same napake lupine, ne sme vzeti klica Lini (K19, N10-3).
        if (gaveBack && faults == 0) found += "klic vrnjen uporabniku brez napake"
        return found
    }

    /** Invariante po umiritvi (klici settle prej). */
    fun settledViolations(): List<String> {
        val found = stableViolations().toMutableList()
        val running = session
        if (running != null && !(permits(running) && state.phase == Phase.CAPTURING && state.callId == running)) {
            found += "po umiritvi tece zajem, ki ga avtomat ne pricakuje ali linija ne dovoli"
        }
        if (permits(X) && running != X) found += "Linin klic je tih: zajema ni in klic ni vrnjen"
        if (state.phase == Phase.PREPARING || state.phase == Phase.STARTING || state.phase == Phase.RETRY_WAIT) {
            found += "avtomat je obtical v ${state.phase}"
        }
        if (state.stop != StopDebt.SETTLED) found += "stop ni poravnan"
        if (gaveBack && notices.isEmpty()) found += "klic vrnjen brez obvestila"
        if (gaveBack && xPresent && xState == PROCESSING && ReturnNotice.NOT_RETURNED !in notices) {
            found += "klic je tih v AUDIO_PROCESSING brez opozorila"
        }
        return found
    }
}
