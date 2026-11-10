package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AudioWatchdogTest {
    @Test
    fun `po treh napakah se zajem pocisti in se ne zaganza znova`() {
        assertEquals(AudioWatchdog.Action.RETRY, AudioWatchdog.afterFailure(1))
        assertEquals(AudioWatchdog.Action.RETRY, AudioWatchdog.afterFailure(2))
        assertEquals(AudioWatchdog.Action.STOP, AudioWatchdog.afterFailure(3))
        assertEquals(AudioWatchdog.Action.STOP, AudioWatchdog.afterFailure(4))
        assertEquals(AudioWatchdog.Action.STOP, AudioWatchdog.afterFailure(0))
        assertTrue(AudioWatchdog.releasesSession(AudioWatchdog.Action.STOP))
        assertFalse(AudioWatchdog.releasesSession(AudioWatchdog.Action.RETRY))
    }
}
