package com.httpgateway.protocol

/**
 * Avtomat stanj zajema zvoka klica.
 * Vse odlocitve o zajemu so tukaj in ne v razredu Android: tam jih preizkus ni
 * dosegel in je vsak popravek uvedel novo tekmo med nitmi (pregledi 10 in 11).
 * Prehod je cista funkcija (stanje, dogodek) -> (novo stanje, ucinki). Ucinki so
 * podatki; izvede jih CaptureDriver, izid pa se vrne kot dogodek z generacijo.
 */
object CaptureMachine {
    const val MAX_START_ATTEMPTS = 2
    const val RETRY_DELAY_MS = 200L

    /** Rok ponavljanja stop. Lupina odgovori v nekaj ms; dlje pomeni, da je zasedena. */
    const val STOP_BUDGET_MS = 1_000

    /** Pred vrnitvijo na slusalko cakamo malo: klicatelj medtem poslusa tisino. */
    const val QUICK_STOP_BUDGET_MS = 300

    /** En sam poskus: krog najema ne sme viseti na lupini, ki ne odgovarja. */
    const val SINGLE_STOP_MS = 0

    /**
     * Rok od CallActive do potrjenega zajema (N12-6). Brez njega lupina, ki visi ob startu,
     * pomeni 5 + 0,2 + 5 s tisine, priprava z zagonom lupine pa nima meje. Obicajen start
     * traja pod sekundo; po 6 s klic vrnemo uporabniku. Vrednost potrdi meritev na telefonu.
     */
    const val START_DEADLINE_MS = 6_000L

    /**
     * N13-1: najvec zaporednih neuspelih odprtij povezave (UplinkResult opened=false) za isti klic.
     * Vsak neuspeh zamenja generacijo, zato rok starta (ki velja za eno generacijo) nikoli ne potece in
     * bi klicatelj ob vztrajno neuspelem open poslusal tisino do konca klica. Pri drugem neuspehu klic
     * vrnemo uporabniku. Stevec se NE ponastavi ob novi generaciji istega klica, samo ob novem klicu,
     * uspehu ali koncu klica.
     */
    const val MAX_OPEN_FAILURES = 2

    enum class Phase {
        /** Nobenega Lininega klica. */
        IDLE,

        /** Priprava (nastavitve, odtis, zagon lupine) tece; seje se ne pricakujemo. */
        PREPARING,

        /** start je pri lupini. */
        STARTING,

        /** Prvi start ni uspel; caka se na drugi poskus. */
        RETRY_WAIT,

        /** Zajem potrjen; samo tu najem potrjuje sejo. */
        CAPTURING,

        /** Klic je se Linin, a linija ni varna (cakanje, uporabnikov klic). Zajema ni. */
        SUSPENDED,
    }

    /** Ali je zadnji izdani stop ze potrjen. OWED se poravna v krogu najema. */
    enum class StopDebt { SETTLED, QUICK_IN_FLIGHT, IN_FLIGHT, OWED }

    data class ShellHealth(
        val notice: ShellNotice.State = ShellNotice.State(false, 0),
        val seenWifi: Boolean = false,
        val wifiWasUp: Boolean = false,
    )

    /**
     * En nespremenljiv objekt (K22): branje nikoli ne vidi pol starega in pol
     * novega stanja, ker ni dveh polj, ki bi se pisali posebej.
     */
    data class State(
        val phase: Phase = Phase.IDLE,
        val callId: String? = null,
        /** Epoha. Poveca jo vsak preklic in vsak nov zacetek; izid s staro se zavrze. */
        val generation: Long = 0,
        val attempt: Int = 0,
        val misses: Int = 0,
        val stop: StopDebt = StopDebt.SETTLED,
        val stopSeq: Long = 0,
        val shell: ShellHealth = ShellHealth(),
        /** Zaporedni neuspeli open za isti klic (N13-1). Preziveti mora preklic med poskusi. */
        val openFailures: Int = 0,
    ) {
        /** Pogled najema: katero sejo pricakujemo in ali start se tece. */
        val view: CaptureOrder.Armed
            get() = when {
                callId == null -> CaptureOrder.Armed(null, startInFlight = false)
                phase == Phase.STARTING || phase == Phase.RETRY_WAIT -> CaptureOrder.beforeStart(callId)
                phase == Phase.CAPTURING -> CaptureOrder.afterStart(callId, keep = true)
                else -> CaptureOrder.afterStart(callId, keep = false)
            }

        /** V teh fazah lupina sme imeti sejo; stop(null) bi ustavil zeleni zajem. */
        val sessionWanted: Boolean
            get() = phase == Phase.STARTING || phase == Phase.RETRY_WAIT || phase == Phase.CAPTURING
    }

    sealed interface Event {
        /** Linin klic je aktiven in linija je prosta (CallAudioPolicy START). */
        data class CallActive(val callId: String) : Event

        /** Linin klic obstaja, a zajem ni dovoljen (CallAudioPolicy STOP za Linin klic). */
        data class CallSuspended(val callId: String) : Event

        /** Klic je odstranjen ali ga je prevzel uporabnik. Pride za VSAK klic, ne le Linin. */
        data class CallEnded(val callId: String) : Event

        /** Na liniji je aktiven klic, ki ga Lina nima. */
        data object UnsafeDownlink : Event

        /** permitted: po pripravi je klic se Linin in linija prosta. */
        data class Prepared(
            val callId: String,
            val generation: Long,
            val ok: Boolean,
            val permitted: Boolean = true,
        ) : Event

        /** permitted: klic je bil Linin in linija prosta pred startom IN po njem. */
        data class StartResult(
            val callId: String,
            val generation: Long,
            val started: Boolean,
            val permitted: Boolean,
        ) : Event

        data class RetryDue(val callId: String, val generation: Long) : Event

        /** opened false: linija tik pred odprtjem ni bila prosta ali lupina ukaza ni potrdila. */
        data class UplinkResult(val callId: String, val generation: Long, val opened: Boolean) : Event

        /** Rok starta je potekel. Velja samo, ce zajem te generacije se ni potrjen. */
        data class StartDue(val callId: String, val generation: Long, val permitted: Boolean = true) : Event
        data class StopResult(val seq: Long, val ok: Boolean) : Event
        data class ExitResult(
            val callId: String,
            val callPresent: Boolean,
            val exitOk: Boolean,
            val callState: Int,
        ) : Event

        data class DisconnectResult(val callId: String, val ok: Boolean) : Event
        data object LeaseDue : Event
        data class LeasePinged(
            val view: CaptureOrder.Armed,
            val generation: Long,
            val stopSeq: Long,
            val pingOk: Boolean,
            val reported: String?,
            val paired: Boolean,
            val wifi: Boolean,
        ) : Event
    }

    sealed interface Effect {
        data class Prepare(val callId: String, val generation: Long) : Effect
        data class StartCapture(val callId: String, val generation: Long, val attempt: Int) : Effect
        data class ScheduleRetry(val callId: String, val generation: Long, val delayMs: Long) : Effect
        data class ScheduleStartDeadline(val callId: String, val generation: Long, val delayMs: Long) : Effect

        /**
         * Takojsen stop na loceni niti (N12-1). Urejeni stop caka za startom, ki je ze pri lupini;
         * ta ga prehiti. Izvajalec ga poslje samo, ce je pri lupini start, izdan PRED to generacijo.
         */
        data class UrgentStop(val callId: String?, val generation: Long, val force: Boolean = false) : Effect

        /** Lupina do tega ukaza ne odpre povezave na streznik: brez njega ni nobenega okvirja (N12-1). */
        data class OpenUplink(val callId: String, val generation: Long) : Effect

        /** callId null ustavi vsako sejo. seq 0: izid se ne vrne (ciljan stop tujega klica). */
        data class StopCapture(val callId: String?, val budgetMs: Int, val seq: Long) : Effect
        data class MarkManual(val callId: String) : Effect
        data class NotifyServerEnded(val callId: String) : Effect
        /** urgent: na loceni niti, ker urejena nit se caka na start, ki visi (N12-6). */
        data class ExitBackgroundAudio(
            val callId: String,
            val attemptExit: Boolean,
            val urgent: Boolean = false,
        ) : Effect
        data class Disconnect(val callId: String) : Effect
        data class ShowNotice(val notice: ReturnNotice) : Effect
        data class PingShell(val view: CaptureOrder.Armed, val generation: Long, val stopSeq: Long) : Effect

        /** Podaljsanje najema lupine (confirm). Brez njega se zajem po 8 s ustavi sam. */
        data class ConfirmLease(val callId: String) : Effect
        data object PublishShellLost : Effect
        data object CancelShellLost : Effect
        data object RelaunchShell : Effect

        /** Storitev naj znova oceni CallAudioPolicy za ta klic (po koncu tujega klica). */
        data class RecheckLine(val callId: String) : Effect
    }

    data class Step(val state: State, val effects: List<Effect> = emptyList())

    fun reduce(state: State, event: Event): Step = when (event) {
        is Event.CallActive -> onCallActive(state, event.callId)
        is Event.CallSuspended -> onCallSuspended(state, event.callId)
        is Event.CallEnded -> onCallEnded(state, event.callId)
        Event.UnsafeDownlink -> onUnsafeDownlink(state)
        is Event.Prepared -> onPrepared(state, event)
        is Event.StartResult -> onStartResult(state, event)
        is Event.RetryDue -> onRetryDue(state, event)
        is Event.StartDue -> onStartDue(state, event)
        is Event.UplinkResult -> onUplinkResult(state, event)
        is Event.StopResult -> onStopResult(state, event)
        is Event.ExitResult -> onExitResult(state, event)
        is Event.DisconnectResult -> onDisconnectResult(state, event)
        Event.LeaseDue -> Step(state, listOf(Effect.PingShell(state.view, state.generation, state.stopSeq)))
        is Event.LeasePinged -> onLeasePinged(state, event)
    }

    private fun onCallActive(s: State, callId: String): Step {
        // Storitev poslje START ob vsaki spremembi klica. Ponovitev ne sme zaceti znova.
        if (s.callId == callId && (s.phase == Phase.PREPARING || s.sessionWanted)) return Step(s)
        val previous = s.callId?.takeIf { it != callId && s.sessionWanted }
        // Generacija se doloci tukaj, ob dogodku, ne po pripravi, ki traja sekunde (N11-2).
        val next = s.copy(
            phase = Phase.PREPARING,
            callId = callId,
            generation = s.generation + 1,
            attempt = 0,
            misses = 0,
            // Isti klic po neuspelem open: stevec ostane (N13-1). Nov klic zacne z 0.
            openFailures = if (s.callId == callId) s.openFailures else 0,
        )
        val begin = listOf(
            Effect.Prepare(callId, next.generation),
            Effect.ScheduleStartDeadline(callId, next.generation, START_DEADLINE_MS),
        )
        if (previous == null) return Step(next, begin)
        val stopped = stop(next, previous, STOP_BUDGET_MS)
        return Step(stopped.state, stopped.effects + begin)
    }

    private fun onCallSuspended(s: State, callId: String): Step {
        if (s.callId != null && s.callId != callId) {
            // Drug Linin klic. Cilja ne spreminjamo, sicer bi utihnil (N11-1).
            return Step(s, listOf(Effect.StopCapture(callId, SINGLE_STOP_MS, 0)))
        }
        // Ponovna ocena v vsakem krogu najema vrne isti odgovor; ta ne sme vsakic izdati stopa.
        if (s.phase == Phase.SUSPENDED && s.callId == callId) return Step(s)
        return revoke(cancelled(s, Phase.SUSPENDED, callId), callId)
    }

    private fun onCallEnded(s: State, callId: String): Step {
        if (s.callId == callId) return revoke(cancelled(s, Phase.IDLE, null), callId)
        // Tuj klic W: stanje in generacija Lininega klica X ostaneta (N11-1).
        // Ciljan stop ne more ustaviti seje X; lupina ga za drug id prezre.
        val effects = mutableListOf<Effect>(Effect.StopCapture(callId, SINGLE_STOP_MS, 0))
        // Zajem je ustavil uporabnikov klic. Ko ta mine, storitev znova oceni linijo.
        if (s.phase == Phase.SUSPENDED && s.callId != null) effects += Effect.RecheckLine(s.callId)
        return Step(s, effects)
    }

    private fun onUnsafeDownlink(s: State): Step {
        val phase = if (s.callId == null) Phase.IDLE else Phase.SUSPENDED
        return revoke(cancelled(s, phase, s.callId), null)
    }

    /** Preklic z dogodkom storitve: urejen spremljan stop in nujni stop mimo starta, ki se tece. */
    private fun revoke(next: State, callId: String?): Step {
        val stopped = stop(next, callId, STOP_BUDGET_MS)
        return Step(stopped.state, stopped.effects + Effect.UrgentStop(callId, next.generation))
    }

    private fun onPrepared(s: State, e: Event.Prepared): Step {
        if (s.phase != Phase.PREPARING || s.generation != e.generation || s.callId != e.callId) return Step(s)
        // Klic med pripravo ni vec Linin ali linija ni prosta: uporabnik ga ze ima, zato ga ne vracamo.
        if (!e.permitted) return stop(cancelled(s, Phase.SUSPENDED, e.callId), e.callId, STOP_BUDGET_MS)
        if (!e.ok) return giveBack(s, e.callId)
        // Nov start nadomesti vsak stari dolg: stop v vrsti stece pred njim, kasnejsi ga ne sme ustaviti.
        val next = s.copy(phase = Phase.STARTING, attempt = 1, stop = StopDebt.SETTLED, stopSeq = s.stopSeq + 1)
        return Step(next, listOf(Effect.StartCapture(e.callId, e.generation, next.attempt)))
    }

    private fun onStartResult(s: State, e: Event.StartResult): Step {
        val fresh = !CaptureOrder.evaluateStart(e.generation, s.generation).immediateStop &&
            s.phase == Phase.STARTING && s.callId == e.callId
        if (!fresh) {
            // Zastarel izid (N10-1). Isti klic z novejso generacijo sejo se zeli, sicer jo ustavimo.
            if (s.callId == e.callId && s.sessionWanted) return Step(s)
            return stop(s, e.callId, STOP_BUDGET_MS)
        }
        if (!e.permitted) {
            // Klic ni vec Linin ali je na liniji uporabnikov klic. Ne vracamo ga: uporabnik ga ze ima.
            return stop(cancelled(s, Phase.SUSPENDED, e.callId), e.callId, STOP_BUDGET_MS)
        }
        // Sele zdaj sme lupina odpreti povezavo: start je svez, uspesen in linija prosta.
        if (e.started) return Step(s.copy(phase = Phase.CAPTURING, misses = 0), listOf(Effect.OpenUplink(e.callId, e.generation)))
        if (s.attempt < MAX_START_ATTEMPTS) {
            return Step(
                s.copy(phase = Phase.RETRY_WAIT),
                listOf(Effect.ScheduleRetry(e.callId, e.generation, RETRY_DELAY_MS)),
            )
        }
        return giveBack(s, e.callId)
    }

    private fun onRetryDue(s: State, e: Event.RetryDue): Step {
        // Preklic med cakanjem poveca generacijo, zato drugi poskus ne stece (N11-4).
        if (s.phase != Phase.RETRY_WAIT || s.generation != e.generation || s.callId != e.callId) return Step(s)
        val next = s.copy(phase = Phase.STARTING, attempt = s.attempt + 1)
        return Step(next, listOf(Effect.StartCapture(e.callId, e.generation, next.attempt)))
    }

    private fun onUplinkResult(s: State, e: Event.UplinkResult): Step {
        if (s.phase != Phase.CAPTURING || s.generation != e.generation || s.callId != e.callId) return Step(s)
        if (e.opened) return Step(if (s.openFailures == 0) s else s.copy(openFailures = 0))
        // N13-1: vztrajen neuspeh open bi sicer klic zadrzal za vedno (vsak neuspeh = nova generacija = nov rok).
        val failures = s.openFailures + 1
        // Ukaz open je ze koncan (izid je prisel), urejena nit lupine je prosta: stop pred izhodom ostane v vrstnem redu.
        if (failures >= MAX_OPEN_FAILURES) return giveBack(s.copy(openFailures = failures), e.callId)
        // Seja brez povezave bi bila potrjen zajem, ki ga Lina ne slisi. Zadrzimo; krog najema oceni znova.
        return stop(cancelled(s.copy(openFailures = failures), Phase.SUSPENDED, e.callId), e.callId, STOP_BUDGET_MS)
    }

    private fun onStartDue(s: State, e: Event.StartDue): Step {
        val pending = s.phase == Phase.PREPARING || s.phase == Phase.STARTING || s.phase == Phase.RETRY_WAIT
        if (!pending || s.generation != e.generation || s.callId != e.callId) return Step(s)
        // Klic ni vec Linin ali linija ni prosta: uporabnik ga ze ima, zato ga ne vracamo (kot pri pripravi).
        if (!e.permitted) return stop(cancelled(s, Phase.SUSPENDED, e.callId), e.callId, STOP_BUDGET_MS)
        return giveBack(s, e.callId, urgent = true)
    }

    private fun onStopResult(s: State, e: Event.StopResult): Step {
        if (e.seq == 0L || e.seq != s.stopSeq) return Step(s)
        return when (s.stop) {
            StopDebt.QUICK_IN_FLIGHT ->
                if (e.ok) Step(s.copy(stop = StopDebt.SETTLED))
                // Kratek stop pred vrnitvijo ni uspel: takoj se enkrat s polnim rokom (N10-5).
                else stop(s, null, STOP_BUDGET_MS)
            StopDebt.IN_FLIGHT -> Step(s.copy(stop = if (e.ok) StopDebt.SETTLED else StopDebt.OWED))
            StopDebt.SETTLED, StopDebt.OWED -> Step(s)
        }
    }

    private fun onExitResult(s: State, e: Event.ExitResult): Step {
        val plan = AudioDrop.plan(dropped = true)
        // Prekinitev samo, ko je klic v AUDIO_PROCESSING in izhod ni uspel (N10-2).
        if (e.callPresent &&
            AudioDrop.shouldDisconnect(e.callState, e.exitOk) == AudioDrop.DisconnectDecision.DISCONNECT
        ) {
            return Step(s, listOf(Effect.Disconnect(e.callId)))
        }
        // API 29: exit vedno vrne false, klic pa je ACTIVE in slisen na slusalki (N11-5).
        val audible = e.callPresent && e.callState == TelecomPhase.STATE_ACTIVE
        val outcome = AudioDrop.outcome(e.callPresent, e.exitOk, disconnected = false, audible = audible)
        return Step(s, notice(plan, outcome))
    }

    private fun onDisconnectResult(s: State, e: Event.DisconnectResult): Step {
        // Obvestilo sledi izidu: ce disconnect vrze, klic ni prekinjen, ampak tih (N11-5).
        val outcome = AudioDrop.outcome(callPresent = true, exitOk = false, disconnected = e.ok)
        return Step(s, notice(AudioDrop.plan(dropped = true), outcome))
    }

    private fun notice(plan: AudioDrop.Plan, outcome: AudioDrop.Outcome): List<Effect> =
        if (plan.warn && outcome.warn) listOf(Effect.ShowNotice(ReturnNotice.of(outcome.message))) else emptyList()

    private fun onLeasePinged(s: State, e: Event.LeasePinged): Step {
        val effects = mutableListOf<Effect>()
        val posted = ShellNotice.next(e.paired, e.pingOk, s.shell.notice)
        if (posted.publish) effects += Effect.PublishShellLost
        if (posted.cancel) effects += Effect.CancelShellLost
        val wifi = ShellLoss.nextWifi(e.paired, e.pingOk, e.wifi, s.shell.seenWifi, s.shell.wifiWasUp)
        if (wifi.shouldRetry) effects += Effect.RelaunchShell
        var next = s.copy(shell = ShellHealth(posted.state, wifi.seen, wifi.wifiWasUp))
        // Zadrzan klic nima drugega izhoda kot ponovno oceno. Dovoljenje se bere na drugi niti in
        // lahko zastara, preden izid pride v vrsto; brez tega bi klic ostal tih (N12-4).
        if (s.phase == Phase.SUSPENDED && s.callId != null) effects += Effect.RecheckLine(s.callId)
        val reported = e.reported?.takeIf { e.pingOk && it.isNotEmpty() }

        // Ping iz prejsnje generacije opisuje sejo, ki je ni vec. Odlocitev iz njega bi vrnila zdrav klic.
        if (e.generation != s.generation) return settleDebt(next, effects, cleanPing = false)

        val round = LeaseRound.evaluate(e.view, s.view, e.pingOk, reported, s.misses)
        next = next.copy(misses = round.misses)
        val expected = s.view.expected
        round.plan.confirmCallId?.let { effects += Effect.ConfirmLease(it) }
        if ((round.giveBackSilence || round.plan.notifyDropped) && !expected.isNullOrEmpty()) {
            val back = giveBack(next, expected)
            return Step(back.state, effects + back.effects)
        }
        if (round.plan.stop && !next.sessionWanted) {
            if (next.stop == StopDebt.IN_FLIGHT || next.stop == StopDebt.QUICK_IN_FLIGHT) return Step(next, effects)
            val stopped = stop(next, null, STOP_BUDGET_MS)
            return Step(stopped.state, effects + stopped.effects)
        }
        // Dolg poravna samo ping, narocen po zadnjem stopu: starejsi ne ve za sejo, ki je nastala vmes.
        val clean = e.pingOk && reported == null && e.stopSeq == s.stopSeq
        return settleDebt(next, effects, clean)
    }

    /** Stop, ki ni bil potrjen, se ponovi v vsakem krogu najema, dokler lupina ne potrdi (N10-5, N11-3). */
    private fun settleDebt(s: State, effects: List<Effect>, cleanPing: Boolean): Step {
        if (s.stop != StopDebt.OWED) return Step(s, effects)
        if (cleanPing) return Step(s.copy(stop = StopDebt.SETTLED), effects)
        val stopped = stop(s, null, SINGLE_STOP_MS)
        return Step(stopped.state, effects + stopped.effects)
    }

    /** Preklic: nova generacija, zato se izid starta ali priprave v teku zavrze. */
    private fun cancelled(s: State, phase: Phase, callId: String?): State = s.copy(
        phase = phase,
        callId = callId,
        generation = s.generation + 1,
        attempt = 0,
        misses = 0,
        // Stevec neuspelih open velja za en klic: konec ali vrnitev klica ga pobrise (N13-1).
        openFailures = if (callId != null && callId == s.callId) s.openFailures else 0,
    )

    /**
     * Izda stop. Dokler seje ne pricakujemo, se izid spremlja (dolg); med zajemom
     * drugega klica ne, ker bi ponovitev s stop(null) ustavila zeleni zajem.
     */
    private fun stop(s: State, callId: String?, budgetMs: Int): Step {
        if (s.sessionWanted) return Step(s, listOf(Effect.StopCapture(callId, budgetMs, 0)))
        val seq = s.stopSeq + 1
        val debt = if (budgetMs == QUICK_STOP_BUDGET_MS) StopDebt.QUICK_IN_FLIGHT else StopDebt.IN_FLIGHT
        return Step(s.copy(stop = debt, stopSeq = seq), listOf(Effect.StopCapture(callId, budgetMs, seq)))
    }

    /**
     * Klic vrne uporabniku. Vrstni red doloca AudioDrop.giveBackOrder: stop pred izhodom iz ozadja.
     * urgent (rok starta): urejena nit morda se caka na start, zato gresta nujni stop in izhod na
     * loceno nit. Povezava na streznik v tej generaciji se ni bila odprta, zato izhod ne caka stopa.
     */
    private fun giveBack(s: State, callId: String, urgent: Boolean = false): Step {
        val plan = AudioDrop.plan(dropped = true)
        var next = cancelled(s, Phase.IDLE, null)
        val effects = mutableListOf<Effect>()
        for (step in AudioDrop.giveBackOrder()) {
            when (step) {
                AudioDrop.Step.MARK_MANUAL -> effects += Effect.MarkManual(callId)
                AudioDrop.Step.NOTIFY_SERVER -> effects += Effect.NotifyServerEnded(callId)
                AudioDrop.Step.STOP_CAPTURE -> if (plan.stopCapture) {
                    val stopped = stop(next, null, QUICK_STOP_BUDGET_MS)
                    next = stopped.state
                    effects += stopped.effects
                    // force: pred izhodom mora biti poskus stopa, tudi ce start ni vec pri lupini.
                    if (urgent) effects += Effect.UrgentStop(null, next.generation, force = true)
                }
                AudioDrop.Step.EXIT_BACKGROUND_AUDIO -> if (plan.returnToHandset) {
                    effects += Effect.ExitBackgroundAudio(callId, attemptExit = !AudioDrop.simulatedRinging(), urgent = urgent)
                }
            }
        }
        return Step(next, effects)
    }
}

/** Obvestilo po vrnitvi klica. Kljuc je ime niza v values in values-sl. */
enum class ReturnNotice(val key: String) {
    RETURNED("audio_returned"),
    NOT_RETURNED("audio_not_returned"),
    DISCONNECTED("call_disconnected"),
    ;

    companion object {
        fun of(key: String): ReturnNotice = entries.firstOrNull { it.key == key } ?: NOT_RETURNED
    }
}
