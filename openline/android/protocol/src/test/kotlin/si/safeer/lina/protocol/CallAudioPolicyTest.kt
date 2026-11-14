package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals

class CallAudioPolicyTest {
    @Test
    fun `cakanje ustavi zvok`() {
        assertEquals(CallAudioAction.STOP, CallAudioPolicy.action(ownedByLina = true, AudioCallState.HOLDING))
    }

    @Test
    fun `tuj aktiven klic ustavi zajem`() {
        assertEquals(CallAudioAction.STOP, CallAudioPolicy.action(ownedByLina = false, AudioCallState.ACTIVE))
        assertEquals(CallAudioAction.STOP, CallAudioPolicy.action(ownedByLina = false, AudioCallState.AUDIO_PROCESSING))
    }

    @Test
    fun `vrnitev lastnega aktivnega klica zvok znova zazene`() {
        assertEquals(CallAudioAction.START, CallAudioPolicy.action(ownedByLina = true, AudioCallState.ACTIVE))
        assertEquals(CallAudioAction.START, CallAudioPolicy.action(ownedByLina = true, AudioCallState.AUDIO_PROCESSING))
    }
}
