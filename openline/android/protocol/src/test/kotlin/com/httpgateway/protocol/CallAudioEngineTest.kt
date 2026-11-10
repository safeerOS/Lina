package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Pogodba CallAudioEngine: najem, ping seje in odtis ob zagonu. */
class CallAudioEngineTest {
    @Test
    fun `brez potrditve se zajem sam ustavi`() {
        val start = 1_000L
        assertFalse(ShellLease.expired(start, start + ShellLease.MAX_SILENCE_MS - 1))
        assertTrue(ShellLease.expired(start, start + ShellLease.MAX_SILENCE_MS))
    }

    @Test
    fun `ping javi padec seje`() {
        assertTrue(AudioPing.dropped("klic", null))
        assertTrue(AudioPing.dropped("klic", ""))
        assertTrue(AudioPing.dropped("klic", "drug"))
        assertFalse(AudioPing.dropped("klic", "klic"))
        assertFalse(AudioPing.dropped(null, null))
        assertFalse(AudioPing.shouldConfirm(null))
        assertFalse(AudioPing.shouldConfirm(""))
        assertTrue(AudioPing.shouldConfirm("klic"))
        assertTrue(AudioPing.dropped("", "klic"))
        assertTrue(AudioPing.dropped(null, "klic"))
        assertFalse(AudioPing.stopSettled(false))
        assertTrue(AudioPing.stopSettled(true))
    }

    @Test
    fun `tuj odtis in zeton iz start se zavrneta`() {
        val armedCert = "ab".repeat(32)
        val armedToken = "zeton-ob-zagonu"
        assertTrue(AudioArm.accepts(armedCert, armedToken, "naprava", armedCert, armedToken, "naprava"))
        assertFalse(AudioArm.accepts(armedCert, armedToken, "naprava", "cd".repeat(32), armedToken, "naprava"))
        assertFalse(AudioArm.accepts(armedCert, armedToken, "naprava", armedCert, "drug-zeton", "naprava"))
        assertFalse(AudioArm.accepts(armedCert, armedToken, "naprava", armedCert, armedToken, "tuj"))
    }

    @Test
    fun `zajetje ob drugem zivem klicu ostane ustavljeno`() {
        assertEquals(
            CallAudioAction.STOP,
            CallAudioPolicy.action(true, AudioCallState.AUDIO_PROCESSING, otherLiveNotLina = true),
        )
    }
}
