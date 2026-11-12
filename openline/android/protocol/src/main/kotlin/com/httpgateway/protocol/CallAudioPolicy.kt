package com.httpgateway.protocol

/**
 * Kdaj sme lupina zajemati VOICE_DOWNLINK.
 * Zajem slisi tisti klic, ki je trenutno na liniji, ne klica, ki ga je Lina
 * odprla. Zato se ob cakanju in ob tujem aktivnem klicu ustavi.
 */
enum class AudioCallState {
    ACTIVE,
    HOLDING,
    AUDIO_PROCESSING,
    ENDING,
    OTHER,
}

enum class CallAudioAction { START, STOP, LEAVE }

object CallAudioPolicy {
    fun action(
        ownedByLina: Boolean,
        state: AudioCallState,
        otherLiveNotLina: Boolean = false,
    ): CallAudioAction = when {
        // START samo, ce ni drugega zivega klica, ki ni Linin.
        otherLiveNotLina && ownedByLina &&
            (state == AudioCallState.ACTIVE || state == AudioCallState.AUDIO_PROCESSING) ->
            CallAudioAction.STOP
        !ownedByLina && (state == AudioCallState.ACTIVE || state == AudioCallState.AUDIO_PROCESSING) ->
            CallAudioAction.STOP
        !ownedByLina -> CallAudioAction.LEAVE
        state == AudioCallState.HOLDING || state == AudioCallState.ENDING -> CallAudioAction.STOP
        state == AudioCallState.ACTIVE || state == AudioCallState.AUDIO_PROCESSING -> CallAudioAction.START
        else -> CallAudioAction.LEAVE
    }
}

/** Klic, kot ga vidi Telecom, brez razredov Android: id, ali ga ima Lina, stanje android.telecom.Call. */
data class LineCall(
    val callId: String,
    val ownedByLina: Boolean,
    val androidState: Int,
    /** Storitev je ta dohodni klic zavrnila z zasedenim znakom; Telecom ga se odstranjuje (N13-2). */
    val rejectedBusy: Boolean = false,
)

/**
 * Dejstva o liniji iz posnetka klicev. Cista funkcija, da jo preizkus zazene: v modulu app je
 * ostalo samo branje registra (krog 13, ozicenje brez preizkusov).
 */
object CallLineFacts {
    fun audioState(androidState: Int): AudioCallState = when (androidState) {
        TelecomPhase.STATE_ACTIVE -> AudioCallState.ACTIVE
        TelecomPhase.STATE_HOLDING -> AudioCallState.HOLDING
        TelecomPhase.STATE_AUDIO_PROCESSING -> AudioCallState.AUDIO_PROCESSING
        TelecomPhase.STATE_DISCONNECTING, TelecomPhase.STATE_DISCONNECTED -> AudioCallState.ENDING
        else -> AudioCallState.OTHER
    }

    /** Drug klic, ki ni Linin in ni koncan, tudi ce se se klica ali zvoni. */
    fun otherLiveNotLina(calls: List<LineCall>, exceptCallId: String): Boolean =
        calls.any {
            it.callId != exceptCallId &&
                CallCommandPolicy.countsAsOtherUserCall(it.ownedByLina, TelecomPhase.phase(it.androidState))
        }

    /**
     * Klic, ki Lininemu klicu zasede linijo. Dohodni klic, ki ga je storitev ze zavrnila (zaseden znak),
     * je ne zasede, dokler ga Telecom odstranjuje: sicer bi klicatelj poslusal tisino (N12-2, odlocitev
     * lastnika 10. 11. 2026). Klic, ki zvoni in ga NI zavrnila (klic v sili, neuspela zavrnitev, klic, ki je
     * zazvonil pred Lininim ACTIVE), linijo zasede: zasebnost pred tisino (N13-2, predlog pregleda 13;
     * odlocitev lastnika se caka). Uporabnik ga lahko dvigne in zvok bi sel na streznik.
     */
    fun blocksCapture(calls: List<LineCall>, exceptCallId: String): Boolean =
        calls.any {
            val phase = TelecomPhase.phase(it.androidState)
            it.callId != exceptCallId && !(phase == TakeoverPhase.RINGING && it.rejectedBusy) &&
                CallCommandPolicy.countsAsOtherUserCall(it.ownedByLina, phase)
        }

    /** Isti pogoj kot CallAudioPolicy START. Klic, ki ga v posnetku ni, zajema ne dovoli. */
    fun permitsCapture(calls: List<LineCall>, callId: String): Boolean {
        val call = calls.firstOrNull { it.callId == callId }
        return CapturePermit.allowed(
            ownedByLina = call?.ownedByLina == true,
            state = call?.let { audioState(it.androidState) },
            otherLiveNotLina = blocksCapture(calls, callId),
        )
    }
}

/**
 * Odlocitev lastnika (10. 11. 2026): »Telefon zmore le en telefonski klic naenkrat.« Ko Lina ze govori
 * s klicateljem in pride drug dohodni klic, ta dobi zaseden znak: telefon ne zvoni, cakajocega klica ni.
 * Kadar govori uporabnik sam, ostane obicajno vedenje telefona. Klic v sili se ne zavrne nikoli.
 */
object SecondCallPolicy {
    fun rejectAsBusy(candidate: LineCall, incoming: Boolean, emergency: Boolean, calls: List<LineCall>): Boolean {
        if (emergency || !incoming || candidate.ownedByLina) return false
        if (TelecomPhase.phase(candidate.androidState) != TakeoverPhase.RINGING) return false
        val others = calls.filter { it.callId != candidate.callId }
        // Lina govori: njen klic je sprejet (ACTIVE, AUDIO_PROCESSING ali na cakanju).
        val linaTalks = others.any { it.ownedByLina && TelecomPhase.phase(it.androidState) == TakeoverPhase.ACTIVE }
        // Uporabnik ima svoj klic (govori ali klice): takrat odloca telefon, ne mi.
        val userBusy = others.any {
            !it.ownedByLina && TelecomPhase.phase(it.androidState).let { p -> p == TakeoverPhase.ACTIVE || p == TakeoverPhase.DIALING }
        }
        return linaTalks && !userBusy
    }
}

/** Ponovna ocena linije za zadrzan klic. Samo za klic, ki ga Lina se ima. */
object LineRecheck {
    fun shouldSync(ownedByLina: Boolean): Boolean = ownedByLina
}

/**
 * Vrata povezave na streznik v procesu lupine (N12-1). Seja zajema se sme pripraviti, na streznik
 * pa se poveze sele po ukazu aplikacije, ki ga avtomat izda ob potrjenem zajemu. Brez tega je lupina
 * posiljala okvirje, cim se je povezala, tudi ce je uporabnik medtem dvignil svoj klic.
 */
class UplinkGate {
    @Volatile
    var isOpen: Boolean = false
        private set

    /** True natanko ob prvem odprtju: takrat se lupina poveze. */
    @Synchronized
    fun open(): Boolean {
        if (isOpen) return false
        isOpen = true
        return true
    }
}

/**
 * Zajem sme uporabiti samo odtis in zetona, ki sta prisla ob zagonu lupine.
 * Tuj odtis iz zahteve start se zavrne.
 */
object AudioArm {
    fun accepts(
        armedCert: String,
        armedToken: String,
        armedDevice: String,
        certSha256: String,
        deviceToken: String,
        deviceId: String,
    ): Boolean {
        if (armedCert.isNotBlank() && !SecretCompare.equals(TlsPin.normalize(certSha256), TlsPin.normalize(armedCert))) {
            return false
        }
        if (armedToken.isNotBlank() && !SecretCompare.equals(deviceToken, armedToken)) return false
        if (armedDevice.isNotBlank() && deviceId != armedDevice) return false
        return true
    }
}

/** Odgovor start je ok samo, ce je zajem res sprejet. Vedno-true bi pustilo sejo brez zvoka. */
object StartReply {
    fun accepted(started: Boolean): Boolean = started
}
