package com.httpgateway.protocol

/**
 * Vrstni red iz aplikacije, izvlecen sem, da ga preizkus zazene.
 * Brez tega modul app nima preizkusov in mutacija v njem ne pade.
 */

/** Pred start mora najem ze videti id. Sicer tick(null, id) ustavi pravkar zagnan zajem. */
object CaptureOrder {
    data class Armed(val expected: String?, val startInFlight: Boolean)

    fun beforeStart(callId: String): Armed = Armed(callId, startInFlight = true)

    fun afterStart(callId: String, keep: Boolean): Armed =
        if (keep) Armed(callId, startInFlight = false) else Armed(null, startInFlight = false)

    fun lease(expected: String?, reported: String?, startInFlight: Boolean): AudioPing.Tick {
        // Med startom se polja ne smejo raziti: tudi ce je expected se null, ne ustavljamo.
        if (startInFlight) {
    return AudioPing.Tick(
        confirmCallId = null,
        stop = false,
        clearExpected = false,
        notifyDropped = false,
    )
        }
        return AudioPing.tick(expected, reported)
    }
}

/**
 * Ena atomarna slika najema. Branje dveh polj posebej vidi expected=null in startInFlight=true.
 */
class ArmSlot {
    private val ref = java.util.concurrent.atomic.AtomicReference(CaptureOrder.Armed(null, false))

    fun set(next: CaptureOrder.Armed) {
        ref.set(next)
    }

    fun get(): CaptureOrder.Armed = ref.get()
}

/**
 * Ping, ki ni uspel, ni tuja seja. giveBack sele po dveh zaporednih neuspehih
 * (najem lupine je 8 s, krog je 3 s). Tuja seja, ki jo lupina res javi, pade takoj.
 */
object LeaseRound {
    const val MISSES_BEFORE_GIVE_BACK = 2

    data class Result(
        val misses: Int,
        val giveBackSilence: Boolean,
        val plan: AudioPing.Tick,
    )

    fun evaluate(viewBefore: CaptureOrder.Armed, viewAfter: CaptureOrder.Armed, pingOk: Boolean, reported: String?, misses: Int): Result {
        if (viewBefore != viewAfter) {
            return Result(misses, false, quiet())
        }
        val view = viewAfter
        if (view.startInFlight) {
            return Result(misses = if (pingOk) 0 else misses, giveBackSilence = false, plan = quiet())
        }
        if (!pingOk) {
            if (view.expected.isNullOrEmpty()) return Result(0, false, quiet())
            val next = misses + 1
            return if (next >= MISSES_BEFORE_GIVE_BACK) {
                Result(0, true, quiet())
            } else {
                Result(next, false, quiet())
            }
        }
        return Result(0, false, CaptureOrder.lease(view.expected, reported, startInFlight = false))
    }

    private fun quiet(): AudioPing.Tick = AudioPing.Tick(
        confirmCallId = null,
        stop = false,
        clearExpected = false,
        notifyDropped = false,
    )
}

/** Start sme zaceti in ostati samo, ce je klic Linin pred klicem in po njem. */
object CapturePermit {
    fun keep(ownedBefore: Boolean, startOk: Boolean, ownedAfter: Boolean): Boolean =
        ownedBefore && startOk && ownedAfter

    fun begin(owned: Boolean): Boolean = owned

    fun startLoop(
        callId: String,
        isOwned: (String) -> Boolean,
        onRetry: () -> Unit = {},
        start: (String) -> Boolean
    ): Boolean {
        for (i in 1..2) {
            if (!isOwned(callId)) return false
            if (i > 1) onRetry()
            if (start(callId)) return isOwned(callId)
        }
        return false
    }
}

/**
 * Odlocitev N6: ob padcu zvoka se klic vrne na slusalko in uporabnik dobi obvestilo.
 * exitBackgroundAudioProcessing(true) bi sredi pogovora zavrtel simulirano zvonjenje.
 * Tega ne naredimo. Zajem se ustavi, da klicatelj ne poslusa tisine.
 */
object AudioDrop {
    data class Plan(val stopCapture: Boolean, val returnToHandset: Boolean, val warn: Boolean)

    fun plan(dropped: Boolean): Plan = if (!dropped) {
        Plan(stopCapture = false, returnToHandset = false, warn = false)
    } else {
        Plan(stopCapture = true, returnToHandset = true, warn = true)
    }

    enum class Step { MARK_MANUAL, NOTIFY_SERVER, EXIT_BACKGROUND_AUDIO, STOP_CAPTURE }

    fun giveBackOrder(): List<Step> = listOf(
        Step.MARK_MANUAL,
        Step.NOTIFY_SERVER,
        Step.STOP_CAPTURE,
        Step.EXIT_BACKGROUND_AUDIO
    )

    fun simulatedRinging(): Boolean = false

    data class Outcome(val warn: Boolean, val message: String)

    fun outcome(callPresent: Boolean, exitOk: Boolean): Outcome = when {
        callPresent && exitOk -> Outcome(warn = true, message = "audio_returned")
        callPresent && !exitOk -> Outcome(warn = true, message = "audio_not_returned")
        else -> Outcome(warn = true, message = "audio_not_returned")
    }
}

/** Ob poteku casa se TAKE ponovi s svezim pingom in s se vedno zvonecim klicem. */
object RingTimeoutGate {
    fun admit(
        evaluated: TakeoverVerdict,
        freshPing: Boolean,
        gatewayConnected: Boolean,
        still: TakeoverVerdict,
    ): Boolean {
        if (evaluated != TakeoverVerdict.TAKE || still != TakeoverVerdict.TAKE) return false
        return TakeoverPolicy.allowTake(TakeoverVerdict.TAKE, freshPing, gatewayConnected) == TakeoverVerdict.TAKE
    }
}

/** Naslov prehoda. Predpona wss:// ni dovolj: prazen, presledek ali odprt oklepaj sesuje OkHttp. */
object GatewayUrl {
    fun accept(raw: String, token: String): Boolean {
        val url = raw.trim()
        if (!url.startsWith("wss://")) return false
        if (url.any { it.isWhitespace() }) return false
        if (token.any { it.code !in 32..126 }) return false
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        if (uri.scheme != "wss") return false
        val host = uri.host ?: return false
        if (host.isBlank()) return false
        val port = uri.port
        if (port != -1 && port !in 1..65535) return false
        val authority = uri.authority ?: return false
        return true
    }
}

/**
 * Obvestilo »lupina ne dela« se objavi samo ob prehodu v to stanje.
 * Sto krogov molka je ena objava, ne sto piskov.
 */
object ShellNotice {
    data class State(val armed: Boolean, val misses: Int)
    data class Post(val publish: Boolean, val cancel: Boolean, val state: State)

    fun next(paired: Boolean, up: Boolean, state: State): Post {
        val show = ShellLoss.showWhileDown(paired, up)
        if (!show) {
            return Post(publish = false, cancel = state.armed, state = State(false, 0))
        }
        val nextMisses = state.misses + 1
        if (nextMisses >= 2 && !state.armed) {
            return Post(publish = true, cancel = false, state = State(true, nextMisses))
        }
        return Post(publish = false, cancel = false, state = State(state.armed, nextMisses))
    }
}
object ConfigPrivacy {
    fun gateway(deviceId: String): String = "GatewayConfig(deviceId=$deviceId)"
}

/** Obvestilo uporabniku je koda vira, ne besedilo izjeme. */
object ShownError {
    fun resource(name: String, exceptionMessage: String?): String = name
}

/**
 * Vrstni red v ShellLauncher.launch.
 * BUSY in OURS ne ubijeta lupine. Zasedeno in zastarelo jo ubijeta, preden tece nova.
 * Samostojni poskus brez vrat si zapomni HOLD in posebej pobrise cevi.
 */
object LaunchSteps {
    enum class Step { PROBE, USE, EXIT_AND_FORGET, DETACHED, REMEMBER_HOLD, CLEAN_FIFOS, HELD }

    fun sequence(probe: ShellHandshake.Probe, paired: Boolean, detachedPort: Int?, busySeen: Int = 0): List<Step> {
        val decision = BusyStreak.decide(busySeen, probe)
        val out = mutableListOf(Step.PROBE)
        if (decision.action == ShellProbe.Next.USE) {
            out += Step.USE
            return out
        }
        if (probe == ShellHandshake.Probe.OCCUPIED ||
            probe == ShellHandshake.Probe.STALE ||
            probe == ShellHandshake.Probe.BUSY
        ) {
            out += Step.EXIT_AND_FORGET
        }
        if (!paired) return out
        out += Step.DETACHED
        if (detachedPort == null) {
            out += Step.REMEMBER_HOLD
            out += Step.CLEAN_FIFOS
        }
        out += Step.HELD
        return out
    }
}
