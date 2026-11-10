package com.httpgateway.protocol

import java.util.concurrent.Executor

/**
 * Kar izvajalec potrebuje od Androida. Klici blokirajo in tecejo zunaj vrste dogodkov.
 * Izjema pomeni neuspeh, ne izgubljenega izida.
 */
interface CapturePorts {
    data class ExitFacts(val callPresent: Boolean, val exitOk: Boolean, val callState: Int)
    data class PingFacts(val ok: Boolean, val reported: String?, val paired: Boolean, val wifi: Boolean)

    /** Nastavitve, odtis in zagon lupine. Lahko traja sekunde. */
    fun prepare(callId: String): Boolean

    /** Klic je Linin, je ACTIVE ali AUDIO_PROCESSING in ni drugega zivega klica, ki ni Linin. */
    fun linePermits(callId: String): Boolean
    fun start(callId: String): Boolean
    fun stop(callId: String?, timeoutMs: Int): Boolean

    /** Ne sme blokirati: tece na niti vrste dogodkov. */
    fun markManual(callId: String)

    /** Ne sme blokirati: tece na niti vrste dogodkov. */
    fun notifyServerEnded(callId: String)
    fun exitBackgroundAudio(callId: String, attemptExit: Boolean): ExitFacts

    /** True: klic je prekinjen ali ga ni vec. False: klic je se tu (in tih). */
    fun disconnect(callId: String): Boolean
    fun ping(): PingFacts

    /** Podaljsa najem seje. Povezave na streznik NE odpre. */
    fun confirm(callId: String)

    /** Lupini dovoli odpreti povezavo na streznik za to sejo. Do tega ukaza ne gre noben okvir. */
    fun openUplink(callId: String): Boolean
    fun showNotice(notice: ReturnNotice)
    fun publishShellLost()
    fun cancelShellLost()
    fun relaunchShell()

    /** Ne sme blokirati: samo preda delo glavni niti. */
    fun recheckLine(callId: String)
    fun nowMs(): Long
    fun sleep(ms: Long)
}

/**
 * Izvajalec avtomata. Vsi dogodki in vsi izidi ucinkov gredo skozi ISTO enonitno
 * vrsto [queue], zato je prehod vedno zaporeden in stanja ne bere nobena druga nit.
 * Vrstni red klicev [post] doloci generacijo: vrsta nikoli ne caka na lupino.
 *
 * start, stop in izhod iz ozadja tecejo na [shellOps] v vrstnem redu izdaje. Stop,
 * izdan po startu, zato pride do lupine za njim in ne pred njim, kjer ne bi ustavil nicesar.
 *
 * [urgent] je locena nit za tisto, kar ne sme cakati na start, ki visi pri lupini (do 5 s):
 * nujni stop ob preklicu (N12-1), izhod iz ozadja po roku starta (N12-6), prekinitev in obvestilo.
 */
class CaptureDriver(
    private val ports: CapturePorts,
    private val queue: Executor,
    private val shellOps: Executor,
    private val urgent: Executor,
    private val prep: Executor,
    private val lease: Executor,
    private val later: (delayMs: Long, task: Runnable) -> Unit,
    initial: CaptureMachine.State = CaptureMachine.State(),
    private val observer: ((CaptureMachine.State, CaptureMachine.Event, CaptureMachine.Step) -> Unit)? = null,
) {
    /** Bere in pise samo nit vrste. */
    private var state = initial

    /**
     * Generacija starta, ki je ta hip pri lupini, ali NO_START. Pise nit lupine, bere nujna nit.
     * Ni stanje zajema (o nicemer ne odloca avtomat): pove samo, ali ima nujni stop kaj prehiteti.
     */
    @Volatile
    private var startInFlight = NO_START

    fun post(event: CaptureMachine.Event) {
        queue.execute { step(event) }
    }

    private fun step(event: CaptureMachine.Event) {
        val before = state
        val step = CaptureMachine.reduce(before, event)
        state = step.state
        observer?.invoke(before, event, step)
        step.effects.forEach(::dispatch)
    }

    private fun dispatch(effect: CaptureMachine.Effect) {
        when (effect) {
            is CaptureMachine.Effect.Prepare -> prep.execute {
                val ok = attempt { ports.prepare(effect.callId) }
                // Priprava traja sekunde. Linijo preverimo po njej, ne pred njo.
                val permitted = attempt { ports.linePermits(effect.callId) }
                post(CaptureMachine.Event.Prepared(effect.callId, effect.generation, ok, permitted))
            }
            is CaptureMachine.Effect.StartCapture -> shellOps.execute { start(effect) }
            is CaptureMachine.Effect.ScheduleRetry -> later(effect.delayMs) {
                post(CaptureMachine.Event.RetryDue(effect.callId, effect.generation))
            }
            is CaptureMachine.Effect.ScheduleStartDeadline -> later(effect.delayMs) {
                // Branje registra ne blokira. Brez njega bi rok vrnil klic, ki ga uporabnik ze ima.
                val permitted = attempt { ports.linePermits(effect.callId) }
                post(CaptureMachine.Event.StartDue(effect.callId, effect.generation, permitted))
            }
            is CaptureMachine.Effect.UrgentStop -> urgent.execute {
                // Samo mimo starta, izdanega pred preklicem. Start novejse generacije je zeljen:
                // zakasnel nujni stop ga ne sme ustaviti. Brez starta v teku urejeni stop ne caka.
                val flying = startInFlight
                if (effect.force || (flying != NO_START && flying < effect.generation)) {
                    attempt { ports.stop(effect.callId, MIN_STOP_TIMEOUT_MS) }
                }
            }
            is CaptureMachine.Effect.OpenUplink -> shellOps.execute {
                // Linija se preveri se tik pred odprtjem: do sem ni sel noben okvir.
                val opened = attempt { ports.linePermits(effect.callId) } && attempt { ports.openUplink(effect.callId) }
                post(CaptureMachine.Event.UplinkResult(effect.callId, effect.generation, opened))
            }
            is CaptureMachine.Effect.StopCapture -> shellOps.execute {
                val ok = stopUntil(effect.callId, effect.budgetMs)
                if (effect.seq != 0L) post(CaptureMachine.Event.StopResult(effect.seq, ok))
            }
            // Takoj, na niti vrste: dokler klic ni oznacen, ga storitev se steje za Lininega
            // in oddaljeni ukaz ga se doseze. Oba klica samo zapiseta in ne cakata.
            is CaptureMachine.Effect.MarkManual -> quiet { ports.markManual(effect.callId) }
            is CaptureMachine.Effect.NotifyServerEnded -> quiet { ports.notifyServerEnded(effect.callId) }
            is CaptureMachine.Effect.ExitBackgroundAudio -> (if (effect.urgent) urgent else shellOps).execute {
                // Izjema ne pove, kje je klic. Varna domneva je najslabsa: klic je tu, izhod ni uspel
                // in klic je tih. Avtomat zato poskusi prekinitev, obvestilo pa sledi njenemu izidu (N12-5).
                val facts = runCatching { ports.exitBackgroundAudio(effect.callId, effect.attemptExit) }
                    .getOrDefault(
                        CapturePorts.ExitFacts(
                            callPresent = true,
                            exitOk = false,
                            callState = TelecomPhase.STATE_AUDIO_PROCESSING,
                        ),
                    )
                post(
                    CaptureMachine.Event.ExitResult(effect.callId, facts.callPresent, facts.exitOk, facts.callState),
                )
            }
            // Prekinitev in obvestilo sledita izidu izhoda kot dogodka; na urejeno nit ju ne veze nic.
            is CaptureMachine.Effect.Disconnect -> urgent.execute {
                val ok = attempt { ports.disconnect(effect.callId) }
                post(CaptureMachine.Event.DisconnectResult(effect.callId, ok))
            }
            is CaptureMachine.Effect.ShowNotice -> urgent.execute { quiet { ports.showNotice(effect.notice) } }
            is CaptureMachine.Effect.PingShell -> lease.execute {
                val facts = runCatching { ports.ping() }
                    .getOrDefault(CapturePorts.PingFacts(ok = false, reported = null, paired = false, wifi = false))
                post(
                    CaptureMachine.Event.LeasePinged(
                        view = effect.view,
                        generation = effect.generation,
                        stopSeq = effect.stopSeq,
                        pingOk = facts.ok,
                        reported = facts.reported,
                        paired = facts.paired,
                        wifi = facts.wifi,
                    ),
                )
            }
            is CaptureMachine.Effect.ConfirmLease -> lease.execute { quiet { ports.confirm(effect.callId) } }
            CaptureMachine.Effect.PublishShellLost -> lease.execute { quiet { ports.publishShellLost() } }
            CaptureMachine.Effect.CancelShellLost -> lease.execute { quiet { ports.cancelShellLost() } }
            CaptureMachine.Effect.RelaunchShell -> prep.execute { quiet { ports.relaunchShell() } }
            is CaptureMachine.Effect.RecheckLine -> quiet { ports.recheckLine(effect.callId) }
        }
    }

    /**
     * Linijo preverimo tik pred startom in po njem (N11-2): priprava traja sekunde,
     * medtem lahko uporabnik dvigne ali zacne svoj klic.
     */
    private fun start(effect: CaptureMachine.Effect.StartCapture) {
        val before = attempt { ports.linePermits(effect.callId) }
        startInFlight = effect.generation
        val started = try {
            before && attempt { ports.start(effect.callId) }
        } finally {
            startInFlight = NO_START
        }
        val permitted = before && attempt { ports.linePermits(effect.callId) }
        post(CaptureMachine.Event.StartResult(effect.callId, effect.generation, started, permitted))
    }

    /** Vsaj en poskus, nato ponavljanje do roka. Kaj sledi neuspehu, odloci avtomat. */
    private fun stopUntil(callId: String?, budgetMs: Int): Boolean {
        val begin = ports.nowMs()
        val timeout = maxOf(budgetMs, MIN_STOP_TIMEOUT_MS)
        while (true) {
            if (attempt { AudioPing.stopSettled(ports.stop(callId, timeout)) }) return true
            if (ports.nowMs() - begin >= budgetMs) return false
            ports.sleep(STOP_PAUSE_MS)
        }
    }

    private inline fun attempt(body: () -> Boolean): Boolean = runCatching(body).getOrDefault(false)

    private inline fun quiet(body: () -> Unit) {
        runCatching(body)
    }

    private companion object {
        const val STOP_PAUSE_MS = 50L
        const val MIN_STOP_TIMEOUT_MS = 300
        const val NO_START = -1L
    }
}
