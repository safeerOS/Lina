package si.safeer.lina.telecom

import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService
import android.telephony.TelephonyManager
import android.util.Log
import si.safeer.lina.InCallActivity
import si.safeer.lina.audio.CallAudioBridge
import si.safeer.lina.config.LinaSettingsStore
import si.safeer.lina.protocol.ScamBurstPolicy
import si.safeer.lina.transport.GatewayRuntime
import si.safeer.lina.shell.ShellClient
import si.safeer.lina.protocol.EmergencyLock
import si.safeer.lina.protocol.IncomingCallAlert
import si.safeer.lina.protocol.EmergencyNote
import si.safeer.lina.protocol.LineCall
import si.safeer.lina.protocol.LineRecheck
import si.safeer.lina.protocol.SecondCallPolicy
import si.safeer.lina.protocol.CallAudioAction
import si.safeer.lina.protocol.CallAudioPolicy
import si.safeer.lina.protocol.CallLifecycle
import si.safeer.lina.protocol.RingTimeoutGate
import si.safeer.lina.protocol.TakeoverDirection
import si.safeer.lina.protocol.TakeoverFacts
import si.safeer.lina.protocol.TakeoverPhase
import si.safeer.lina.protocol.TakeoverPolicy
import si.safeer.lina.protocol.TakeoverVerdict
import si.safeer.lina.protocol.TelecomPhase
import org.lsposed.hiddenapibypass.HiddenApiBypass

/**
 * Klic najprej zvoni na telefonu. Lina ga prevzame samo, ce je dohoden, se neodgovorjen,
 * potece nastavljeni cas in je stevilka na seznamu. Sicer ni dogodka na streznik
 * in zvok ostane na slusalki (brez enterBackgroundAudioProcessing).
 */
class GatewayInCallService : InCallService() {
    private companion object {
        const val TAG = "GatewayInCallService"
    }

    private val callbacks = mutableMapOf<Call, Call.Callback>()
    private val ringStartedAt = mutableMapOf<String, Long>()
    private val handler = Handler(Looper.getMainLooper())
    private val timers = mutableMapOf<String, Runnable>()

    /** Klici, zavrnjeni z zasedenim znakom, dokler jih Telecom ne odstrani. Samo glavna nit. */
    private val busyRejected = mutableSetOf<String>()

    /**
     * Lastnik 18. 11. 2026: val prevar (3 razlicne neznane stevilke v 15 s) se tiho zavrne in zapomni; stevilke
     * ostanejo samo na telefonu (SharedPreferences), nikoli v dnevniku ali repozitoriju.
     */
    private val scamChecked = mutableSetOf<String>()
    private val scamPolicy by lazy {
        val prefs = getSharedPreferences("lina_scam", MODE_PRIVATE)
        ScamBurstPolicy(initialBlocked = prefs.getString("blocked", "").orEmpty().split('\n').filter { it.isNotBlank() })
    }
    private val contactLookup by lazy { si.safeer.lina.ContactSearch(this) }

    /** Wangiri: neodgovorjen klic iz tuje neznane stevilke, ki je zvonil < 5 s, se zapomni (naslednjic tiho zavrnjen). */
    private fun learnWangiri(callId: String, call: Call) {
        val started = ringStartedAt[callId] ?: return
        if (callId in busyRejected || directionOf(call) != TakeoverDirection.INCOMING) return
        if (call.details.connectTimeMillis != 0L) return
        val number = numberOf(call)
        val settings = LinaSettingsStore(this).load()
        val exempt = TakeoverPolicy.onAllowlist(number, settings.allowlist) || contactLookup.isKnown(number)
        if (scamPolicy.onUnansweredShortRing(number, SystemClock.elapsedRealtime() - started, exempt)) {
            getSharedPreferences("lina_scam", MODE_PRIVATE).edit().putString("blocked", scamPolicy.blockedNumbers().joinToString("\n")).apply()
        }
    }

    private fun rejectIfScam(callId: String, call: Call): Boolean {
        if (callId in busyRejected) return true
        if (callId in scamChecked) return false
        if (directionOf(call) != TakeoverDirection.INCOMING || phaseOf(call) != TakeoverPhase.RINGING) return false
        scamChecked += callId
        val number = numberOf(call)
        val settings = LinaSettingsStore(this).load()
        val emergency = emergencyCallback(call) || carrierEmergency(number) || TakeoverPolicy.isEmergency(number) ||
            TakeoverPolicy.inEmergencyCooldown(emergencyAt(), System.currentTimeMillis())
        val exempt = emergency || TakeoverPolicy.onAllowlist(number, settings.allowlist) || contactLookup.isKnown(number)
        val malformed = scamPolicy.onMalformed(number, exempt) == ScamBurstPolicy.Verdict.BLOCK
        if (!malformed && scamPolicy.onIncoming(number, System.currentTimeMillis(), exempt) != ScamBurstPolicy.Verdict.BLOCK) return false
        run {
            getSharedPreferences("lina_scam", MODE_PRIVATE).edit().putString("blocked", scamPolicy.blockedNumbers().joinToString("\n")).apply()
        }
        LinaCallGate.markManual(callId)
        if (runCatching { call.reject(false, null) }.isFailure) {
            Log.w(TAG, "zavrnitev prevare za $callId ni uspela")
            return false
        }
        busyRejected += callId
        CallRegistry.markBusyRejected(callId)
        // Prejsnji klici istega vala, ki se zvonijo, gredo za njim (stevilke so ze zapomnjene).
        for (entry in CallRegistry.snapshot()) {
            if (entry.callId == callId || entry.callId in busyRejected) continue
            if (phaseOf(entry.call) == TakeoverPhase.RINGING && directionOf(entry.call) == TakeoverDirection.INCOMING &&
                scamPolicy.isBlocked(numberOf(entry.call)) && !TakeoverPolicy.isEmergency(numberOf(entry.call))
            ) {
                LinaCallGate.markManual(entry.callId)
                if (runCatching { entry.call.reject(false, null) }.isSuccess) {
                    busyRejected += entry.callId
                    CallRegistry.markBusyRejected(entry.callId)
                }
            }
        }
        return true
    }

    /**
     * Zajem zadrzanega Lininega klica oceni ista politika na glavni niti (po koncu tujega klica in
     * v vsakem krogu najema). Klica, ki ni vec Linin, ne ocenjujemo: zanj bi politika vsakic
     * poslala onUnsafeDownlink, ceprav se ni nic spremenilo.
     */
    private val lineRecheck: (String) -> Unit = { callId ->
        handler.post {
            val call = CallRegistry.get(callId)
            if (call != null && LineRecheck.shouldSync(LinaCallGate.isOwned(callId))) syncCallAudio(callId, call)
        }
    }

    init {
        // Po uspesnem answer je klic ze lahko ACTIVE. Zvok se sprozi sele, ko je owned.
        LinaCallGate.setOwnedListener { callId ->
            // Glavna nit: najprej zavrni klice, ki ze zvonijo (N13-2), sele nato oceni linijo.
            handler.post {
                rejectRingingOthers(callId)
                CallRegistry.get(callId)?.let { syncCallAudio(callId, it) }
            }
        }
        CallAudioBridge.setLineRecheck(lineRecheck)
    }

    override fun onDestroy() {
        CallAudioBridge.clearLineRecheck(lineRecheck)
        LinaCallGate.setOwnedListener(null)
        super.onDestroy()
    }

    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        val entry = CallRegistry.register(call)
        val callback = object : Call.Callback() {
            override fun onStateChanged(call: Call, state: Int) {
                onCallUpdated(entry.callId, call)
            }

            override fun onDetailsChanged(call: Call, details: Call.Details) {
                if (CallLifecycle.publishWhileAnnounced(LinaCallGate.isAnnounced(entry.callId))) {
                    GatewayRuntime.emitCallState(entry.callId, call)
                }
                CallRegistry.notifyChanged()
            }
        }
        callbacks[call] = callback
        call.registerCallback(callback)
        onCallUpdated(entry.callId, call)
        // Klic, zavrnjen z zasedenim znakom, se uporabniku ne pokaze kot dohodni klic.
        if (entry.callId !in busyRejected) showInCallUi()
    }

    override fun onCallRemoved(call: Call) {
        val callId = CallRegistry.callIdFor(call)
        callbacks.remove(call)?.let(call::unregisterCallback)
        if (callId != null) {
            learnWangiri(callId, call)
            busyRejected.remove(callId)
            scamChecked.remove(callId)
            IncomingCallNotice.cancel(this, callId)
            cancelTimer(callId)
            ringStartedAt.remove(callId)
            // Vedno, tudi ce je markManual owned ze pobrisal.
            if (CallLifecycle.stopCaptureOnRemoved(LinaCallGate.isOwned(callId), LinaCallGate.isManual(callId))) {
                CallAudioBridge.onCallEnded(callId)
            }
            val linaOwned = LinaCallGate.isOwned(callId)
            val linaAnnounced = LinaCallGate.isAnnounced(callId)
            if (CallLifecycle.emitRemoval(linaOwned, linaAnnounced)) {
                GatewayRuntime.emitCallRemoved(callId, call)
            }
            LinaCallGate.clear(callId)
        }
        CallRegistry.remove(call)
        super.onCallRemoved(call)
    }

    /**
     * Odlocitev lastnika (10. 11. 2026): telefon zmore en klic naenkrat. Dokler Lina govori, drug dohodni
     * klic dobi zaseden znak in ne zvoni. Uporabnik ga vidi v obvestilu kot zgresen klic.
     */
    private fun rejectIfLinaBusy(callId: String, call: Call): Boolean {
        if (callId in busyRejected) return true
        val number = numberOf(call)
        val emergency = emergencyCallback(call) || carrierEmergency(number) || TakeoverPolicy.isEmergency(number) ||
            TakeoverPolicy.inEmergencyCooldown(emergencyAt(), System.currentTimeMillis())
        val candidate = LineCall(callId, LinaCallGate.isOwned(callId), CallRegistry.androidState(call))
        val incoming = directionOf(call) == TakeoverDirection.INCOMING
        if (!SecondCallPolicy.rejectAsBusy(candidate, incoming, emergency, CallLine.snapshot())) return false
        // Oznaka pred Telecomom: Lina tega klica ne sme vec prevzeti, tudi ce zavrnitev ne uspe.
        LinaCallGate.markManual(callId)
        if (runCatching { call.reject(false, null) }.isFailure) {
            Log.w(TAG, "zaseden znak za $callId ni uspel; klic zvoni kot obicajno")
            return false
        }
        busyRejected += callId
        CallRegistry.markBusyRejected(callId)
        MissedCallNotice.show(this, callId, number)
        return true
    }

    /**
     * N13-2: klic, ki je zazvonil PRED Lininim ACTIVE, ob njegovem dogodku ni bil ocenjen. Ko Lina govori,
     * ga ocenimo zdaj (zaseden znak, razen klica v sili). Samo glavna nit.
     */
    private fun rejectRingingOthers(exceptCallId: String) {
        for (entry in CallRegistry.snapshot()) {
            if (entry.callId == exceptCallId || entry.callId in busyRejected) continue
            if (phaseOf(entry.call) == TakeoverPhase.RINGING) rejectIfLinaBusy(entry.callId, entry.call)
        }
    }

    /** Linijo ponovno oceni za vsak Linin klic (po dogodku tujega klica, ki ga politika sicer ne vidi). */
    private fun resyncOwnedCalls() {
        for (entry in CallRegistry.snapshot()) {
            if (LinaCallGate.isOwned(entry.callId)) syncCallAudio(entry.callId, entry.call)
        }
    }

    /** N14-4: obvestilo dohodnega klica z dvigni/zavrni; odlocitev je v protocol/IncomingCallAlert. */
    private fun refreshIncomingNotice(callId: String, call: Call) {
        val action = IncomingCallAlert.decide(
            phase = phaseOf(call),
            direction = directionOf(call),
            busyRejected = callId in busyRejected,
            ownedByLina = LinaCallGate.isOwned(callId),
            manual = LinaCallGate.isManual(callId),
            uiVisible = InCallActivity.visible,
        )
        runCatching {
            if (action == IncomingCallAlert.Action.SHOW) IncomingCallNotice.show(this, callId, numberOf(call))
            else IncomingCallNotice.cancel(this, callId)
        }.onFailure { Log.w(TAG, "obvestilo dohodnega klica ni uspelo") }
    }

    private fun onCallUpdated(callId: String, call: Call) {
        if (rejectIfScam(callId, call) || rejectIfLinaBusy(callId, call)) {
            refreshIncomingNotice(callId, call)
            CallRegistry.notifyChanged()
            return
        }
        val phase = phaseOf(call)
        // N13-2: Linin klic je aktiven, drugi klici pa ze zvonijo: oceni jih (ob napaki ostanejo na liniji).
        if (LinaCallGate.isOwned(callId) && phase == TakeoverPhase.ACTIVE) rejectRingingOthers(callId)
        if (EmergencyNote.record(
                outgoing = directionOf(call) == TakeoverDirection.OUTGOING,
                listedEmergency = TakeoverPolicy.isEmergency(numberOf(call)),
                carrierEmergency = carrierEmergency(numberOf(call)),
            )
        ) {
            noteEmergency(System.currentTimeMillis())
        }
        if (phase == TakeoverPhase.ACTIVE && !LinaCallGate.isOwned(callId)) {
            if (!LinaCallGate.confirmOwnedOnActive(callId)) {
                handler.post {
                    if (!LinaCallGate.isOwned(callId) && !LinaCallGate.isManual(callId)) {
                        if (LinaCallGate.markManual(callId)) {
                            CallAudioBridge.onCallEnded(callId)
                            GatewayRuntime.notifyCallEnded(callId)
                        }
                    }
                }
            }
            cancelTimer(callId)
        }
        if (phase == TakeoverPhase.ENDED) cancelTimer(callId)
        if (phase == TakeoverPhase.RINGING && !LinaCallGate.isManual(callId) && !LinaCallGate.isOwned(callId)) {
            armRingTimer(callId, call)
        }
        if (CallLifecycle.publishWhileAnnounced(LinaCallGate.isAnnounced(callId))) {
            GatewayRuntime.emitCallState(callId, call)
        }
        syncCallAudio(callId, call)
        // N13-2: tuj klic, ki zvoni in ni zavrnjen, zasede linijo Lininemu klicu (politika ga zanj ne vidi).
        if (phase == TakeoverPhase.RINGING && !LinaCallGate.isOwned(callId)) resyncOwnedCalls()
        refreshIncomingNotice(callId, call)
        CallRegistry.notifyChanged()
    }

    /** Ob poteku casa ponovno preveri seznam, smer in ali je klic se neodgovorjen. */
    private fun onRingTimeout(callId: String) {
        timers.remove(callId)
        val call = CallRegistry.get(callId) ?: return
        when (val verdict = evaluate(callId, call)) {
            TakeoverVerdict.TAKE -> Thread {
                val fresh = runCatching { ShellClient(this).ping() != null }.getOrDefault(false)
                
                val pot = when {
                    GatewayRuntime.isConnected() -> si.safeer.lina.protocol.PotPrevzema.RACUNALNIK
                    SamostojnaPripravljenost.jePripravljena(this) -> si.safeer.lina.protocol.PotPrevzema.SAMOSTOJNO
                    else -> si.safeer.lina.protocol.PotPrevzema.NI
                }
                
                handler.post {
                    val still = CallRegistry.get(callId) ?: return@post
                    if (!RingTimeoutGate.admit(verdict, fresh, pot, evaluate(callId, still))) {
                        return@post
                    }
                    LinaCallGate.announce(callId)
                    
                    if (pot == si.safeer.lina.protocol.PotPrevzema.SAMOSTOJNO) {
                        LokalniKrmilnik(this).emitCallAdded(callId, still)
                    } else {
                        GatewayRuntime.emitCallAdded(callId, still)
                    }
                }
            }.start()
            TakeoverVerdict.WAIT -> armRingTimer(callId, call, reschedule = true)
            TakeoverVerdict.REFUSE -> Unit
        }
    }

    private fun armRingTimer(callId: String, call: Call, reschedule: Boolean = false) {
        if (LinaCallGate.isAnnounced(callId) || LinaCallGate.isOwned(callId) || LinaCallGate.isManual(callId)) return
        if (!reschedule && timers.containsKey(callId)) return
        if (evaluate(callId, call) == TakeoverVerdict.REFUSE) return
        ringStartedAt.putIfAbsent(callId, SystemClock.elapsedRealtime())
        val elapsed = SystemClock.elapsedRealtime() - (ringStartedAt[callId] ?: SystemClock.elapsedRealtime())
        val timeoutMs = LinaSettingsStore(this).load().ringTimeoutSec * 1_000L
        val delay = (timeoutMs - elapsed).coerceAtLeast(250L)
        cancelTimer(callId)
        val runnable = Runnable { onRingTimeout(callId) }
        timers[callId] = runnable
        handler.postDelayed(runnable, delay)
    }

    private fun evaluate(callId: String, call: Call): TakeoverVerdict {
        val settings = LinaSettingsStore(this).load()
        val started = ringStartedAt[callId]
        val elapsed = if (started == null) 0L else SystemClock.elapsedRealtime() - started
        val number = call.details.handle?.schemeSpecificPart.orEmpty()
        return TakeoverPolicy.evaluate(
            TakeoverFacts(
                direction = directionOf(call),
                phase = phaseOf(call),
                manuallyAnswered = LinaCallGate.isManual(callId),
                ringingForMs = elapsed,
                ringTimeoutMs = settings.ringTimeoutSec * 1_000L,
                number = number,
                allowlist = settings.allowlist,
                allowlistEnabled = settings.allowlistEnabled,
                carrierEmergency = carrierEmergency(number),
                userCallActive = CallLine.userHasOtherLiveCall(callId),
                emergencyCallback = emergencyCallback(call),
                emergencyCooldown = TakeoverPolicy.inEmergencyCooldown(emergencyAt(), System.currentTimeMillis()),
                externalPickup = RouteGuard.externalPickup,
                lineAllowed = LinaLine.allowed(this, call),
            ),
        )
    }

    /**
     * Zvocno obdelavo v ozadju zazene samo prevzet klic. Ob HOLDING in ob tujem
     * aktivnem klicu se zajem ustavi, da zvok klica B ne gre na streznik.
     */
    private fun syncCallAudio(callId: String, call: Call) {
        val otherLive = CallLine.blocksCapture(callId)
        val akcija = CallAudioPolicy.action(LinaCallGate.isOwned(callId), CallLine.audioState(call), otherLive)
        // Diagnostika (22. 11. 2026: na Samsungu klic sprejet, zvoka Line ni bilo, brez zapisa v dnevniku): brez stevilke in vsebine.
        Log.i(TAG, "zvok $callId: lina=${LinaCallGate.isOwned(callId)} stanje=${CallRegistry.androidState(call)} drug=$otherLive -> $akcija")
        when (akcija) {
            CallAudioAction.START -> startOwnedAudio(callId, call)
            CallAudioAction.STOP -> {
                // Linin klic ostane Linin (cakanje, uporabnikov klic): zajem se zadrzi, ne konca.
                if (LinaCallGate.isOwned(callId)) CallAudioBridge.onCallSuspended(callId)
                else CallAudioBridge.onUnsafeDownlink()
            }
            CallAudioAction.LEAVE -> Unit
        }
    }

    private fun startOwnedAudio(callId: String, call: Call) {
        if (!LinaCallGate.isOwned(callId)) return
        when (CallRegistry.androidState(call)) {
            Call.STATE_ACTIVE -> {
                val routed = runCatching { enterBackgroundAudioProcessing(call) }
                    .onFailure { Log.w(TAG, "background audio processing refused for $callId", it) }
                    .isSuccess
                if (!routed) CallAudioBridge.onCallActive(callId)
                else {
                    Log.i(TAG, "zvok $callId: zahtevana obdelava v ozadju")
                    // Ce Telecom klica ne prestavi v AUDIO_PROCESSING (izmerjeno na Samsungu 22. 11. 2026: ANSWERED -> ACTIVE, nic vec),
                    // Lina sicer nikoli ne spregovori: po 1,5 s zacne zvok tudi v ACTIVE.
                    handler.postDelayed({
                        if (LinaCallGate.isOwned(callId) && CallRegistry.androidState(call) == Call.STATE_ACTIVE) {
                            Log.w(TAG, "zvok $callId: AUDIO_PROCESSING ni prisel v 1500 ms, zvok se zacne v ACTIVE")
                            CallAudioBridge.onCallActive(callId)
                        }
                    }, 1500)
                }
            }
            Call.STATE_AUDIO_PROCESSING -> CallAudioBridge.onCallActive(callId)
        }
    }

    /** `Call.enterBackgroundAudioProcessing()` je @SystemApi; Telecom zahteva privzeti klicnik. */
    private fun enterBackgroundAudioProcessing(call: Call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) HiddenApiBypass.addHiddenApiExemptions("Landroid/telecom/Call;")
        Call::class.java.getMethod("enterBackgroundAudioProcessing").invoke(call)
    }

    private fun noteEmergency(nowEpochMs: Long) {
        getSharedPreferences(EmergencyLock.PREFS, MODE_PRIVATE)
            .edit()
            .putLong(EmergencyLock.KEY_EPOCH_MS, nowEpochMs)
            .apply()
    }

    /** Preberi shranjeno epohu. Polje storitve se ob ponovnem zagonu izgubi. */
    private fun emergencyAt(): Long? =
        EmergencyLock.read(
            getSharedPreferences(EmergencyLock.PREFS, MODE_PRIVATE).getLong(EmergencyLock.KEY_EPOCH_MS, 0L),
        )

    private fun cancelTimer(callId: String) {
        timers.remove(callId)?.let(handler::removeCallbacks)
    }

    private fun showInCallUi() {
        startActivity(
            Intent(this, InCallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
    }

    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        super.onCallAudioStateChanged(audioState)
        val mask = audioState.supportedRouteMask
        val wiredOrBt = (mask and (CallAudioState.ROUTE_BLUETOOTH or CallAudioState.ROUTE_WIRED_HEADSET)) != 0
        val car = (resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_CAR
        RouteGuard.externalPickup = wiredOrBt || car
    }

    private fun numberOf(call: Call): String = call.details.handle?.schemeSpecificPart.orEmpty()

    private fun emergencyCallback(call: Call): Boolean = runCatching {
        val field = Call.Details::class.java.getField("PROPERTY_EMERGENCY_CALLBACK_MODE")
        call.details.hasProperty(field.getInt(null))
    }.getOrDefault(false)

    private fun phaseOf(call: Call): TakeoverPhase = TelecomPhase.phase(CallRegistry.androidState(call))

    private fun directionOf(call: Call): TakeoverDirection = when (call.details.callDirection) {
        Call.Details.DIRECTION_INCOMING -> TakeoverDirection.INCOMING
        Call.Details.DIRECTION_OUTGOING -> TakeoverDirection.OUTGOING
        else -> TakeoverDirection.UNKNOWN
    }

    private fun carrierEmergency(number: String): Boolean {
        if (number.isBlank()) return false
        val telephony = getSystemService(TelephonyManager::class.java) ?: return false
        return runCatching { telephony.isEmergencyNumber(number) }.getOrDefault(false)
    }
}
