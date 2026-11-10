package com.httpgateway.protocol

/**
 * Izhod iz obdelave zvoka v ozadju.
 * API 29 metode nima. API 30 do 35 je exitBackgroundAudioProcessing(boolean).
 * false: klic ostane aktiven in zvok gre nazaj na slusalko, ne v simulirano zvonjenje.
 */
object BackgroundAudioSignatures {
    const val EXIT_METHOD = "exitBackgroundAudioProcessing"
    const val SHOULD_RING_WHEN_RETURNING_AUDIO = false

    fun exitParameterTypes(sdkInt: Int): List<String>? = when {
        sdkInt < 30 -> null
        else -> listOf("boolean")
    }
}

/**
 * Cas zadnjega klica v sili je epoha, ne ura od zagona.
 * Polje v storitvi se ob ponovnem zagonu izgubi, shranjena epoha ne.
 */
object EmergencyLock {
    const val PREFS = "lina_safety"
    const val KEY_EPOCH_MS = "emergency_at_epoch_ms"

    fun read(stored: Long): Long? = stored.takeIf { it > 0L }
}

/** Odhodni klic v sili, tudi ce ga prepozna samo operater, se zapise. */
object EmergencyNote {
    fun record(outgoing: Boolean, listedEmergency: Boolean, carrierEmergency: Boolean): Boolean =
        outgoing && (listedEmergency || carrierEmergency)
}

/** Cakajoci dogodki klica. markManual jih odstrani, da stevilka ne odide kasneje. */
class PendingCallEvents {
    private val items = ArrayDeque<Pair<String, String>>()

    fun add(callId: String, encoded: String) {
        items.addLast(callId to encoded)
    }

    fun drop(callId: String) {
        items.removeAll { it.first == callId }
    }

    fun isEmpty(): Boolean = items.isEmpty()

    fun peek(): String? = items.firstOrNull()?.second

    fun removeFirst() {
        items.removeFirst()
    }

    fun encoded(): List<String> = items.map { it.second }
}

/** Kode napak, ki jih zaslon prevede. Surova koda ali angleški stavek ne sme v toast. */
object FailureMessages {
    private val known = setOf(
        "telecom_action_failed",
        "telecom_permission_denied",
        "call_phone_permission_missing",
        "call_controlled_locally",
        "call_not_found",
        "call_not_taken_over",
        "call_answered_manually",
        "call_not_ringing",
        "user_call",
        "would_hold_user_call",
        "external_pickup",
        "dial_disabled",
        "wireless_unreachable",
        "secret_in_argv",
        "shell_did_not_start",
        "shell_lost",
        "shell_still_running",
        "audio_not_returned",
    )

    fun resourceName(code: String?): String = if (code != null && code in known) code else "didnt_work"
}

/**
 * Izhod iz ozadja ni uspel: uporabnik mora to videti. Razen ko je klic ACTIVE in slisen
 * na slusalki (API 29 izhoda nima): »klic je ostal tih« bi bilo takrat napacno (N11-5).
 */
object AudioReturn {
    fun shouldWarn(exitFailed: Boolean, audible: Boolean = false): Boolean = exitFailed && !audible
}

/** Obvestilo povezave sledi stanju. Nikoli ni vedno »Povezan«. */
object ConnectionNotice {
    fun resourceName(connected: Boolean): String =
        if (connected) "connection_connected" else "connection_offline"
}
