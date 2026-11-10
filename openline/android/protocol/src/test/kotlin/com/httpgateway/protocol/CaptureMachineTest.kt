package com.httpgateway.protocol

import com.httpgateway.protocol.CaptureMachine.Effect
import com.httpgateway.protocol.CaptureMachine.Event
import com.httpgateway.protocol.CaptureMachine.Phase
import com.httpgateway.protocol.CaptureMachine.State
import com.httpgateway.protocol.CaptureMachine.StopDebt
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Krog 12. Avtomat zajema je cista funkcija, zato se da preiskati v celoti:
 * vsa zaporedja dogodkov do dolzine DEPTH, brez niti, brez spanja, brez verjetnosti.
 */
class CaptureMachineTest {
    private companion object {
        const val X = "klic-x"
        const val Y = "klic-y"
        const val W = "klic-w"
        const val DEPTH = 10
    }

    private fun run(vararg events: Event, from: State = State()): Pair<State, List<List<Effect>>> {
        var state = from
        val effects = mutableListOf<List<Effect>>()
        for (event in events) {
            val step = CaptureMachine.reduce(state, event)
            state = step.state
            effects += step.effects
        }
        return state to effects
    }

    private fun capturing(callId: String = X): State {
        val (prepared, _) = run(Event.CallActive(callId))
        val (state, _) = run(
            Event.Prepared(callId, prepared.generation, ok = true),
            Event.StartResult(callId, prepared.generation, started = true, permitted = true),
            from = prepared,
        )
        assertEquals(Phase.CAPTURING, state.phase)
        return state
    }

    private fun starting(callId: String = X): State {
        val (prepared, _) = run(Event.CallActive(callId))
        return run(Event.Prepared(callId, prepared.generation, ok = true), from = prepared).first
    }

    private fun List<Effect>.stops(): List<Effect.StopCapture> = filterIsInstance<Effect.StopCapture>()

    private fun pinged(s: State, pingOk: Boolean, reported: String?, view: CaptureOrder.Armed = s.view) =
        Event.LeasePinged(view, s.generation, s.stopSeq, pingOk, reported, paired = true, wifi = true)

    // ---- Izcrpni preizkus ----------------------------------------------------------------

    /** Abeceda: zunanji dogodki in izidi ucinkov, tudi zastareli (prejsnja generacija). */
    private fun alphabet(s: State): List<Event> {
        val g = s.generation
        val out = mutableListOf<Event>(
            Event.CallActive(X), Event.CallActive(Y), Event.CallSuspended(X), Event.CallSuspended(Y),
            Event.CallEnded(X), Event.CallEnded(Y), Event.CallEnded(W), Event.UnsafeDownlink,
            Event.StopResult(s.stopSeq, ok = true), Event.StopResult(s.stopSeq, ok = false),
            Event.StopResult(s.stopSeq - 1, ok = false),
            pinged(s, pingOk = true, reported = s.callId), pinged(s, pingOk = true, reported = null),
            pinged(s, pingOk = true, reported = "tuj"), pinged(s, pingOk = false, reported = null),
            pinged(s, pingOk = true, reported = X, view = CaptureOrder.Armed(X, false)),
            Event.LeasePinged(CaptureOrder.Armed(X, false), g - 1, s.stopSeq - 1, true, X, paired = true, wifi = true),
        )
        for (id in setOf(X, s.callId ?: X)) {
            out += Event.Prepared(id, g, ok = true)
            out += Event.Prepared(id, g, ok = false)
            out += Event.Prepared(id, g, ok = true, permitted = false)
            out += Event.Prepared(id, g - 1, ok = true)
            for (started in listOf(true, false)) for (permitted in listOf(true, false)) {
                out += Event.StartResult(id, g, started, permitted)
            }
            out += Event.StartResult(id, g - 1, started = true, permitted = true)
            out += Event.StartResult(id, g - 1, started = false, permitted = true)
            out += Event.RetryDue(id, g)
            out += Event.RetryDue(id, g - 1)
        }
        return out
    }

    /** Dovoljenje storitve: velja od CallActive do preklica. Zgodovina, ki je stanje ne nosi. */
    private fun grants(before: Set<String>, event: Event, effects: List<Effect>): Set<String> {
        var granted = when (event) {
            is Event.CallActive -> before + event.callId
            is Event.CallSuspended -> before - event.callId
            is Event.CallEnded -> before - event.callId
            Event.UnsafeDownlink -> emptySet()
            else -> before
        }
        effects.filterIsInstance<Effect.MarkManual>().forEach { granted = granted - it.callId }
        return granted
    }

    private fun check(s: State, granted: Set<String>, event: Event, step: CaptureMachine.Step, grantedAfter: Set<String>) {
        val n = step.state
        val fx = step.effects
        fun broken(what: String): Nothing = fail("$what\n stanje=$s\n dogodek=$event\n novo=$n\n ucinki=$fx")

        // Oblika stanja (K22): pogled je vedno ena od treh veljavnih kombinacij.
        if (n.view.expected == null && n.view.startInFlight) broken("razbit pogled")
        if ((n.view.expected != null) != n.sessionWanted) broken("pogled ne ustreza fazi")
        if ((n.phase == Phase.IDLE) != (n.callId == null)) broken("IDLE in cilj se ne ujemata")
        if (n.generation < s.generation) broken("generacija je padla")
        if (n.stop != StopDebt.SETTLED && n.sessionWanted) broken("dolg stop med zelenim zajemom")
        if (n.attempt > CaptureMachine.MAX_START_ATTEMPTS) broken("prevec poskusov")

        // (a) Brez veljavnega dovoljenja ni zajema, starta, priprave ali potrditve.
        if ((n.sessionWanted || n.phase == Phase.PREPARING) && n.callId !in grantedAfter) broken("(a) zajem brez dovoljenja")
        for (e in fx) {
            val id = when (e) {
                is Effect.Prepare -> e.callId
                is Effect.StartCapture -> e.callId
                is Effect.ScheduleRetry -> e.callId
                is Effect.ConfirmLease -> e.callId
                else -> null
            }
            if (id != null && id !in grantedAfter) broken("(a) ucinek zajema brez dovoljenja")
            if (e is Effect.StartCapture && (n.phase != Phase.STARTING || e.generation != n.generation || e.callId != n.callId)) {
                broken("(a) start brez faze STARTING ali s tujo generacijo")
            }
        }
        val target = s.callId
        val revokes = event == Event.UnsafeDownlink ||
            (event is Event.CallEnded && event.callId == target) ||
            (event is Event.CallSuspended && event.callId == target)
        if (revokes) {
            if (n.generation <= s.generation) broken("(a) preklic ni povecal generacije")
            if (n.view.expected != null) broken("(a) po preklicu se pricakuje seja")
            if (fx.stops().none { it.seq != 0L && (it.callId == null || it.callId == target) }) broken("(a) preklic brez StopCapture")
        }
        // V CAPTURING vodi samo svez, uspesen in dovoljen izid starta.
        if (s.phase != Phase.CAPTURING && n.phase == Phase.CAPTURING) {
            val ok = event is Event.StartResult && event.started && event.permitted &&
                event.generation == s.generation && s.phase == Phase.STARTING && event.callId == s.callId
            if (!ok) broken("(a) CAPTURING brez svezega izida starta")
        }
        if (event is Event.StartResult) {
            val fresh = event.generation == s.generation && s.phase == Phase.STARTING && event.callId == s.callId
            val wantedAnyway = s.callId == event.callId && s.sessionWanted
            if (!fresh && !wantedAnyway && fx.stops().none { it.callId == event.callId || it.callId == null }) {
                broken("(a) zastarel izid starta brez StopCapture")
            }
            if (fresh && !event.permitted && fx.stops().none { it.callId == event.callId }) broken("(a) nedovoljen start brez stop")
        }

        // (b) Konec tujega klica ne spremeni Lininega.
        if (event is Event.CallEnded && event.callId != target) {
            if (n != s) broken("(b) tuj klic je spremenil stanje")
            if (fx.stops().any { it.callId != event.callId }) broken("(b) tuj klic je ustavil drug zajem")
            val recheck = fx.filterIsInstance<Effect.RecheckLine>()
            if (s.phase == Phase.SUSPENDED && recheck != listOf(Effect.RecheckLine(target!!))) broken("(b) zadrzan klic brez ponovne ocene")
            if (s.phase != Phase.SUSPENDED && recheck.isNotEmpty()) broken("(b) ponovna ocena brez zadrzanega klica")
        }

        // (b) Tudi zadrzanje DRUGEGA Lininega klica ne sme vzeti cilja klicu, ki se zajema.
        if (event is Event.CallSuspended && target != null && event.callId != target) {
            if (n != s) broken("(b) zadrzanje drugega klica je spremenilo stanje")
            if (fx != listOf(Effect.StopCapture(event.callId, CaptureMachine.SINGLE_STOP_MS, 0))) {
                broken("(b) zadrzanje drugega klica je ustavilo ali zagnalo kaj drugega")
            }
        }

        // (c) Stop se ne izgubi.
        for (e in fx.stops()) {
            if (e.seq != 0L && (e.seq != n.stopSeq || n.stop == StopDebt.SETTLED || n.stop == StopDebt.OWED)) {
                broken("(c) spremljan stop brez vpisa")
            }
            if (e.seq == 0L && !n.sessionWanted && !(event is Event.CallEnded && event.callId != target) &&
                !(event is Event.CallSuspended && event.callId != target)
            ) {
                broken("(c) nespremljan stop, ceprav seje ne pricakujemo")
            }
            if (e.callId == null && n.sessionWanted) broken("(c) stop(null) med zelenim zajemom")
        }
        if (event is Event.StopResult && !event.ok && event.seq == s.stopSeq && event.seq != 0L &&
            (s.stop == StopDebt.IN_FLIGHT || s.stop == StopDebt.QUICK_IN_FLIGHT)
        ) {
            if (fx.stops().isEmpty() && n.stop != StopDebt.OWED) broken("(c) neuspel stop pozabljen")
        }
        if (event is Event.LeasePinged && s.stop == StopDebt.OWED) {
            val clean = event.pingOk && event.reported == null && event.generation == s.generation && event.stopSeq == s.stopSeq
            if (n.stop == StopDebt.SETTLED && !clean) broken("(c) dolg poravnan brez cistega pinga")
            if (!clean && fx.stops().none { it.callId == null }) broken("(c) dolg brez ponovitve v krogu najema")
        }
        if (s.stop == StopDebt.OWED && n.stop == StopDebt.SETTLED) {
            val settled = event is Event.LeasePinged || (event is Event.Prepared && n.phase == Phase.STARTING)
            if (!settled) broken("(c) dolg izginil brez razloga")
        }

        // (e) Najem potrdi samo sejo, ki jo avtomat pricakuje.
        for (e in fx.filterIsInstance<Effect.ConfirmLease>()) {
            val ok = event is Event.LeasePinged && s.phase == Phase.CAPTURING && s.callId == e.callId &&
                event.pingOk && event.reported == e.callId && event.generation == s.generation && event.view == s.view
            if (!ok) broken("(e) potrditev nepricakovane seje")
        }
        // Ping, ki opisuje drug pogled ali drugo generacijo, o zajemu ne odloca (K19, N10-3).
        if (event is Event.LeasePinged && (event.view != s.view || event.generation != s.generation)) {
            if (fx.any { it is Effect.MarkManual || it is Effect.ConfirmLease }) broken("(e) odlocitev iz zastarelega pinga")
            if (n.misses != s.misses || n.phase != s.phase) broken("(e) zastarel ping je spremenil zajem")
            if (fx.stops().isNotEmpty() && s.stop != StopDebt.OWED) broken("(e) stop iz zastarelega pinga")
        }
        if (event is Event.LeasePinged && (s.phase == Phase.STARTING || s.phase == Phase.RETRY_WAIT)) {
            if (n.misses > s.misses) broken("(e) zgresen ping med startom")
            if (fx.any { it is Effect.MarkManual }) broken("(e) vrnitev klica med startom")
        }
        if (fx.any { it is Effect.MarkManual } && n.phase != Phase.IDLE) broken("vrnitev klica brez IDLE")
    }

    @Test
    fun `vsa zaporedja dogodkov do dolzine 10 ohranijo invariante a b c e`() {
        data class Node(val state: State, val granted: Set<String>)
        var frontier = setOf(Node(State(), emptySet()))
        val seen = HashSet(frontier)
        var transitions = 0L
        val phases = HashSet<Phase>()
        repeat(DEPTH) {
            val next = HashSet<Node>()
            for (node in frontier) {
                for (event in alphabet(node.state)) {
                    val step = CaptureMachine.reduce(node.state, event)
                    val granted = grants(node.granted, event, step.effects)
                    check(node.state, node.granted, event, step, granted)
                    transitions++
                    phases += step.state.phase
                    // Zdravje lupine je neodvisno od zajema (svoj preizkus); brez njega je stanj manj.
                    val reached = Node(step.state.copy(shell = CaptureMachine.ShellHealth()), granted)
                    if (seen.add(reached)) next += reached
                }
            }
            frontier = next
        }
        println("avtomat globina=$DEPTH: stanj=${seen.size} prehodov=$transitions")
        // Preiskava ne sme biti prazna: vse faze dosezene, stanj in prehodov je veliko.
        assertEquals(Phase.entries.toSet(), phases)
        assertTrue(seen.size > 1_000, "stanj: ${seen.size}")
        assertTrue(transitions > 30_000, "prehodov: $transitions")
    }

    // ---- Ciljani scenariji ---------------------------------------------------------------

    @Test
    fun `N11-1 konec tujega klica med startom ne utisa Lininega klica`() {
        val before = starting()
        val (after, fx) = run(Event.CallEnded(W), from = before)
        assertEquals(before, after)
        assertEquals(listOf<Effect>(Effect.StopCapture(W, CaptureMachine.SINGLE_STOP_MS, 0)), fx.single())
        val (done, _) = run(Event.StartResult(X, before.generation, started = true, permitted = true), from = after)
        assertEquals(Phase.CAPTURING, done.phase)
        assertEquals(X, done.view.expected)
    }

    @Test
    fun `N11-1 zadrzanje drugega Lininega klica ne utisa klica ki se zajema`() {
        val before = capturing()
        val (after, fx) = run(Event.CallSuspended(Y), from = before)
        assertEquals(before, after)
        assertEquals(listOf<Effect>(Effect.StopCapture(Y, CaptureMachine.SINGLE_STOP_MS, 0)), fx.single())
        // Brez cilja si avtomat zadrzani klic zapomni, da ga po koncu tujega klica znova oceni.
        val (suspended, _) = run(Event.CallSuspended(Y))
        assertEquals(Phase.SUSPENDED, suspended.phase)
        assertEquals(Y, suspended.callId)
    }

    @Test
    fun `N11-1 zadrzan Linin klic se po koncu tujega klica znova oceni`() {
        val (suspended, _) = run(Event.UnsafeDownlink, from = capturing())
        assertEquals(Phase.SUSPENDED, suspended.phase)
        val (after, fx) = run(Event.CallEnded(W), from = suspended)
        assertEquals(suspended, after)
        assertTrue(Effect.RecheckLine(X) in fx.single())
        val (restarted, again) = run(Event.CallActive(X), from = after)
        assertEquals(Phase.PREPARING, restarted.phase)
        assertEquals(listOf<Effect>(Effect.Prepare(X, restarted.generation)), again.single())
    }

    @Test
    fun `N11-2 uporabnikov klic pred zacetkom starta zavrze pripravo`() {
        val (preparing, fx) = run(Event.CallActive(X))
        val granted = (fx.single().single() as Effect.Prepare).generation
        val (cancelled, stop) = run(Event.UnsafeDownlink, from = preparing)
        assertEquals(1, stop.single().stops().size)
        // Priprava se konca sele zdaj. Start se ne sme izdati.
        val (after, late) = run(Event.Prepared(X, granted, ok = true), from = cancelled)
        assertEquals(cancelled, after)
        assertTrue(late.single().isEmpty())
        assertNull(after.view.expected)
    }

    @Test
    fun `N10-1 uporabnikov klic med startom ustavi zajem ob preklicu in ob izidu`() {
        val before = starting()
        val (cancelled, fx) = run(Event.UnsafeDownlink, from = before)
        val first = fx.single().stops().single()
        assertNull(first.callId)
        assertTrue(first.seq != 0L)
        val (after, late) = run(Event.StartResult(X, before.generation, started = true, permitted = true), from = cancelled)
        assertEquals(Phase.SUSPENDED, after.phase)
        assertNull(after.view.expected)
        assertEquals(X, late.single().stops().single().callId)
        // Najem zdaj ne potrdi seje, ki jo lupina se javlja, ampak jo ustavi.
        val (_, lease) = run(pinged(after, pingOk = true, reported = X), from = after.copy(stop = StopDebt.SETTLED))
        assertTrue(lease.single().none { it is Effect.ConfirmLease })
        assertEquals(1, lease.single().stops().size)
    }

    @Test
    fun `N11-4 preklic med cakanjem na drugi poskus ne zazene drugega starta`() {
        val first = starting()
        val (waiting, fx) = run(Event.StartResult(X, first.generation, started = false, permitted = true), from = first)
        assertEquals(Phase.RETRY_WAIT, waiting.phase)
        assertEquals(
            listOf<Effect>(Effect.ScheduleRetry(X, first.generation, CaptureMachine.RETRY_DELAY_MS)),
            fx.single(),
        )
        val (cancelled, _) = run(Event.CallEnded(X), from = waiting)
        val (after, retry) = run(Event.RetryDue(X, first.generation), from = cancelled)
        assertEquals(cancelled, after)
        assertTrue(retry.single().isEmpty())
        // Casovnik prejsnje generacije ne sme sproziti poskusa nove, ki tudi caka.
        val (stale, none) = run(Event.RetryDue(X, first.generation - 1), from = waiting)
        assertEquals(waiting, stale)
        assertTrue(none.single().isEmpty())
        val (due, start) = run(Event.RetryDue(X, first.generation), from = waiting)
        assertEquals(Phase.STARTING, due.phase)
        assertEquals(listOf<Effect>(Effect.StartCapture(X, first.generation, 2)), start.single())
    }

    @Test
    fun `zastarel izid priprave se zavrze tudi ko nova priprava ze tece`() {
        val (first, _) = run(Event.CallActive(X))
        val (again, _) = run(Event.CallSuspended(X), Event.CallActive(X), from = first)
        assertEquals(Phase.PREPARING, again.phase)
        assertTrue(again.generation > first.generation)
        val (after, fx) = run(Event.Prepared(X, first.generation, ok = true), from = again)
        assertEquals(again, after)
        assertTrue(fx.single().isEmpty())
        // Neuspeh stare priprave ne vrne klica, ki ga nova se pripravlja.
        val (kept, quiet) = run(Event.Prepared(X, first.generation, ok = false), from = again)
        assertEquals(again, kept)
        assertTrue(quiet.single().isEmpty())
    }

    @Test
    fun `konec Lininega klica po startu ustavi zajem in ga ne vraca`() {
        val (after, fx) = run(Event.CallEnded(X), from = capturing())
        assertEquals(Phase.IDLE, after.phase)
        assertEquals(X, fx.single().stops().single().callId)
        assertTrue(fx.single().none { it is Effect.MarkManual || it is Effect.ExitBackgroundAudio })
    }

    @Test
    fun `N11-3 neuspel stop se ponovi takoj in nato v vsakem krogu najema`() {
        val (cancelled, fx) = run(Event.UnsafeDownlink, from = capturing())
        val stop = fx.single().stops().single()
        assertEquals(CaptureMachine.STOP_BUDGET_MS, stop.budgetMs)
        val (owed, none) = run(Event.StopResult(stop.seq, ok = false), from = cancelled)
        assertEquals(StopDebt.OWED, owed.stop)
        assertTrue(none.single().isEmpty())
        // Ping ne uspe: lupina morda se zajema. Ponovi.
        val (again, retry) = run(pinged(owed, pingOk = false, reported = null), from = owed)
        val second = retry.single().stops().single()
        assertNull(second.callId)
        assertEquals(StopDebt.IN_FLIGHT, again.stop)
        // Tudi drugi ne uspe: dolg ostane.
        val (stillOwed, _) = run(Event.StopResult(second.seq, ok = false), from = again)
        assertEquals(StopDebt.OWED, stillOwed.stop)
        // Lupina odgovori in ne javlja seje: dolg je poravnan brez novega stopa.
        val (settled, quiet) = run(pinged(stillOwed, pingOk = true, reported = null), from = stillOwed)
        assertEquals(StopDebt.SETTLED, settled.stop)
        assertTrue(quiet.single().stops().isEmpty())
    }

    @Test
    fun `star ping ne poravna dolga`() {
        val (cancelled, fx) = run(Event.UnsafeDownlink, from = capturing())
        val seq = fx.single().stops().single().seq
        val (owed, _) = run(Event.StopResult(seq, ok = false), from = cancelled)
        // Ping, narocen pred zadnjim stopom, ne ve za sejo, ki je nastala vmes.
        val old = Event.LeasePinged(owed.view, owed.generation, seq - 1, true, null, paired = true, wifi = true)
        val (after, retry) = run(old, from = owed)
        assertTrue(after.stop != StopDebt.SETTLED)
        assertEquals(1, retry.single().stops().size)
    }

    @Test
    fun `N10-5 vrnitev klica stop pred izhodom in ponovitev po neuspehu`() {
        val state = capturing()
        val (back, fx) = run(pinged(state, pingOk = true, reported = null), from = state)
        val effects = fx.single()
        val stop = effects.stops().single()
        assertEquals(
            listOf(
                Effect.MarkManual(X),
                Effect.NotifyServerEnded(X),
                Effect.StopCapture(null, CaptureMachine.QUICK_STOP_BUDGET_MS, stop.seq),
                Effect.ExitBackgroundAudio(X, attemptExit = true),
            ),
            effects,
        )
        assertEquals(Phase.IDLE, back.phase)
        assertEquals(StopDebt.QUICK_IN_FLIGHT, back.stop)
        val (retrying, retry) = run(Event.StopResult(stop.seq, ok = false), from = back)
        val full = retry.single().stops().single()
        assertEquals(CaptureMachine.STOP_BUDGET_MS, full.budgetMs)
        assertEquals(StopDebt.IN_FLIGHT, retrying.stop)
        assertEquals(StopDebt.OWED, run(Event.StopResult(full.seq, ok = false), from = retrying).first.stop)
        assertEquals(StopDebt.SETTLED, run(Event.StopResult(full.seq, ok = true), from = retrying).first.stop)
    }

    @Test
    fun `priprava ki ne uspe vrne klic uporabniku`() {
        val (preparing, _) = run(Event.CallActive(X))
        val (after, fx) = run(Event.Prepared(X, preparing.generation, ok = false), from = preparing)
        assertEquals(Phase.IDLE, after.phase)
        assertTrue(Effect.MarkManual(X) in fx.single())
        assertTrue(fx.single().any { it is Effect.ExitBackgroundAudio })
    }

    @Test
    fun `N11-2 klic ki med pripravo ni vec Linin se ne zacne in se ne vraca`() {
        val (preparing, _) = run(Event.CallActive(X))
        val (after, fx) = run(Event.Prepared(X, preparing.generation, ok = false, permitted = false), from = preparing)
        assertEquals(Phase.SUSPENDED, after.phase)
        assertEquals(X, fx.single().stops().single().callId)
        assertTrue(fx.single().none { it is Effect.MarkManual || it is Effect.StartCapture || it is Effect.ExitBackgroundAudio })
    }

    @Test
    fun `ponovljen CallActive med zajemom ne zacne znova`() {
        for (state in listOf(run(Event.CallActive(X)).first, starting(), capturing())) {
            val (after, fx) = run(Event.CallActive(X), from = state)
            assertEquals(state, after)
            assertTrue(fx.single().isEmpty())
        }
    }

    // ---- (d) izid vrnitve klica ----------------------------------------------------------

    @Test
    fun `d prekinitev samo v AUDIO_PROCESSING ob neuspelem izhodu in obvestilo po izidu`() {
        val states = listOf(
            TelecomPhase.STATE_ACTIVE, TelecomPhase.STATE_HOLDING, TelecomPhase.STATE_AUDIO_PROCESSING,
            TelecomPhase.STATE_DISCONNECTED, TelecomPhase.STATE_RINGING, 0,
        )
        for (present in listOf(true, false)) for (exitOk in listOf(true, false)) for (callState in states) {
            val (state, fx) = run(Event.ExitResult(X, present, exitOk, callState), from = capturing())
            assertEquals(capturing(), state)
            val effects = fx.single()
            val silent = present && !exitOk && callState == TelecomPhase.STATE_AUDIO_PROCESSING
            if (silent) {
                assertEquals(listOf<Effect>(Effect.Disconnect(X)), effects, "present=$present exitOk=$exitOk state=$callState")
                continue
            }
            val expected = when {
                !present -> ReturnNotice.DISCONNECTED
                exitOk -> ReturnNotice.RETURNED
                callState == TelecomPhase.STATE_ACTIVE -> ReturnNotice.RETURNED
                else -> ReturnNotice.NOT_RETURNED
            }
            assertEquals(listOf<Effect>(Effect.ShowNotice(expected)), effects, "present=$present exitOk=$exitOk state=$callState")
        }
    }

    @Test
    fun `d API 29 exit vrne false klic je ACTIVE obvestilo pravi da je na slusalki`() {
        val (_, fx) = run(Event.ExitResult(X, callPresent = true, exitOk = false, callState = TelecomPhase.STATE_ACTIVE))
        assertEquals(listOf<Effect>(Effect.ShowNotice(ReturnNotice.RETURNED)), fx.single())
        assertEquals("audio_returned", ReturnNotice.RETURNED.key)
    }

    @Test
    fun `d obvestilo po prekinitvi sledi izidu disconnect`() {
        val (_, ok) = run(Event.DisconnectResult(X, ok = true))
        assertEquals(listOf<Effect>(Effect.ShowNotice(ReturnNotice.DISCONNECTED)), ok.single())
        val (_, thrown) = run(Event.DisconnectResult(X, ok = false))
        assertEquals(listOf<Effect>(Effect.ShowNotice(ReturnNotice.NOT_RETURNED)), thrown.single())
        assertEquals(
            setOf("audio_returned", "audio_not_returned", "call_disconnected"),
            ReturnNotice.entries.map { it.key }.toSet(),
        )
    }

    // ---- (e) najem -----------------------------------------------------------------------

    @Test
    fun `e najem potrdi samo pricakovano sejo v CAPTURING`() {
        val state = capturing()
        val (same, fx) = run(pinged(state, pingOk = true, reported = X), from = state)
        assertEquals(listOf<Effect>(Effect.ConfirmLease(X)), fx.single())
        assertEquals(state, same.copy(shell = state.shell))
        // Tuja seja: brez potrditve, klic se vrne.
        val (_, foreign) = run(pinged(state, pingOk = true, reported = "tuj"), from = state)
        assertTrue(foreign.single().none { it is Effect.ConfirmLease })
        assertTrue(Effect.MarkManual(X) in foreign.single())
        // Brez pricakovane seje se javljena seja ustavi, ne potrdi.
        for (idle in listOf(State(), run(Event.UnsafeDownlink, from = state).first.copy(stop = StopDebt.SETTLED))) {
            val (_, stray) = run(pinged(idle, pingOk = true, reported = X), from = idle)
            assertTrue(stray.single().none { it is Effect.ConfirmLease })
            assertNull(stray.single().stops().single().callId)
        }
    }

    @Test
    fun `e ping iz prejsnje generacije ne potrdi in ne vrne klica`() {
        val old = capturing()
        val stale = pinged(old, pingOk = true, reported = null)
        val (suspended, _) = run(Event.CallSuspended(X), from = old)
        val (again, _) = run(Event.CallActive(X), from = suspended)
        val (now, _) = run(
            Event.Prepared(X, again.generation, ok = true),
            Event.StartResult(X, again.generation, started = true, permitted = true),
            from = again,
        )
        assertEquals(Phase.CAPTURING, now.phase)
        assertEquals(old.view, now.view)
        val (after, fx) = run(stale, from = now)
        assertEquals(now, after.copy(shell = now.shell))
        assertTrue(fx.single().isEmpty())
    }

    @Test
    fun `e K04 K07 start v teku ne steje zgresenih pingov in dva zgresena vrneta klic`() {
        val flying = starting().copy(misses = 1)
        val (missed, quiet) = run(pinged(flying, pingOk = false, reported = null), from = flying)
        assertEquals(1, missed.misses)
        assertTrue(quiet.single().none { it is Effect.MarkManual })
        assertEquals(0, run(pinged(flying, pingOk = true, reported = null), from = flying).first.misses)

        val state = capturing()
        val (one, first) = run(pinged(state, pingOk = false, reported = null), from = state)
        assertEquals(1, one.misses)
        assertTrue(first.single().isEmpty())
        val (two, second) = run(pinged(one, pingOk = false, reported = null), from = one)
        assertEquals(Phase.IDLE, two.phase)
        assertTrue(Effect.MarkManual(X) in second.single())
        // En uspesen ping vmes stevec ponastavi.
        assertEquals(0, run(pinged(one, pingOk = true, reported = X), from = one).first.misses)
    }

    @Test
    fun `krog najema narocilo pinga nosi pogled generacijo in stevec stopov`() {
        val state = capturing()
        val (same, fx) = run(Event.LeaseDue, from = state)
        assertEquals(state, same)
        assertEquals(listOf<Effect>(Effect.PingShell(state.view, state.generation, state.stopSeq)), fx.single())
    }

    @Test
    fun `obvestilo lupina ne dela in ponovni zagon ob vrnitvi Wi-Fi`() {
        fun ping(s: State, up: Boolean, wifi: Boolean) =
            Event.LeasePinged(s.view, s.generation, s.stopSeq, up, null, paired = true, wifi = wifi)
        var state = State()
        val seen = mutableListOf<Effect>()
        // Wi-Fi je, lupina dela; nato Wi-Fi in lupina padeta; nato se Wi-Fi vrne.
        for ((up, wifi) in listOf(true to true, false to false, false to false, false to false, false to true, true to true)) {
            val step = CaptureMachine.reduce(state, ping(state, up, wifi))
            state = step.state
            seen += step.effects
        }
        assertEquals(listOf(Effect.PublishShellLost, Effect.RelaunchShell, Effect.CancelShellLost), seen)
    }

    // ---- K22 -----------------------------------------------------------------------------

    @Test
    fun `K22 stanje je en nespremenljiv objekt`() {
        // Deterministicno namesto verjetnostnega preizkusa z nitmi: razred nima polja, ki bi se dalo pisati,
        // in pogled se izracuna iz enega objekta, zato dveh locenih pisanj ni.
        for (type in listOf(State::class.java, CaptureMachine.ShellHealth::class.java, CaptureOrder.Armed::class.java)) {
            for (field in type.declaredFields) {
                if (java.lang.reflect.Modifier.isStatic(field.modifiers)) continue
                assertTrue(java.lang.reflect.Modifier.isFinal(field.modifiers), "${type.simpleName}.${field.name} ni final")
            }
            assertTrue(type.declaredMethods.none { it.name.startsWith("set") }, "${type.simpleName} ima setter")
        }
        val valid = setOf(
            CaptureOrder.Armed(null, false), CaptureOrder.Armed(X, true), CaptureOrder.Armed(X, false),
        )
        for (phase in Phase.entries) for (callId in listOf(null, X)) {
            assertTrue(State(phase = phase, callId = callId).view in valid, "$phase $callId")
        }
        assertFalse(State(phase = Phase.STARTING, callId = null).view.startInFlight)
    }
}
