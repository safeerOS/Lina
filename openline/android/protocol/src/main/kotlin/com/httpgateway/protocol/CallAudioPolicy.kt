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
