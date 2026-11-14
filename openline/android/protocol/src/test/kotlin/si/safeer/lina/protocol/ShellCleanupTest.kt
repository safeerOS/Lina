package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ShellCleanupTest {
    @Test
    fun `pkill brez KONEC ni potrditev in preverba pocaka`() {
        assertFalse(ShellCleanup.killAcknowledged(""))
        assertFalse(ShellCleanup.killAcknowledged("PORT 1"))
        assertTrue(ShellCleanup.killAcknowledged("KONEC\n"))
        assertEquals(300L, ShellCleanup.settleBeforeRecheck(acknowledged = false))
        assertEquals(0L, ShellCleanup.settleBeforeRecheck(acknowledged = true))
        assertFalse(ShellCleanup.wipeStopped(stillAnswersPing = true))
        assertTrue(ShellCleanup.wipeStopped(stillAnswersPing = false))
    }
}
