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
    fun disconnect(callId: String): Boolean
    fun ping(): PingFacts
    fun confirm(callId: String)
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
 */
class CaptureDriver(
    private val ports: CapturePorts,
    private val queue: Executor,
    private val shellOps: Executor,
    private val prep: Executor,
    private val lease: Executor,
    private val later: (delayMs: Long, task: Runnable) -> Unit,
    initial: CaptureMachine.State = CaptureMachine.State(),
    private val observer: ((CaptureMachine.State, CaptureMachine.Event, CaptureMachine.Step) -> Unit)? = null,
) {
    /** Bere in pise samo nit vrste. */
    private var state = initial

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
            is CaptureMachine.Effect.StopCapture -> shellOps.execute {
                val ok = stopUntil(effect.callId, effect.budgetMs)
                if (effect.seq != 0L) post(CaptureMachine.Event.StopResult(effect.seq, ok))
            }
            // Takoj, na niti vrste: dokler klic ni oznacen, ga storitev se steje za Lininega
            // in oddaljeni ukaz ga se doseze. Oba klica samo zapiseta in ne cakata.
            is CaptureMachine.Effect.MarkManual -> quiet { ports.markManual(effect.callId) }
            is CaptureMachine.Effect.NotifyServerEnded -> quiet { ports.notifyServerEnded(effect.callId) }
            is CaptureMachine.Effect.ExitBackgroundAudio -> shellOps.execute {
                val facts = runCatching { ports.exitBackgroundAudio(effect.callId, effect.attemptExit) }
                    .getOrDefault(CapturePorts.ExitFacts(callPresent = false, exitOk = false, callState = 0))
                post(
                    CaptureMachine.Event.ExitResult(effect.callId, facts.callPresent, facts.exitOk, facts.callState),
                )
            }
            is CaptureMachine.Effect.Disconnect -> shellOps.execute {
                val ok = attempt { ports.disconnect(effect.callId) }
                post(CaptureMachine.Event.DisconnectResult(effect.callId, ok))
            }
            is CaptureMachine.Effect.ShowNotice -> shellOps.execute { quiet { ports.showNotice(effect.notice) } }
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
        val started = before && attempt { ports.start(effect.callId) }
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
    }
}
