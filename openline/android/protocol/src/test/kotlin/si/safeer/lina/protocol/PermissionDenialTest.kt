package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Napaka B5 na WP28 S (14. 11. 2026): prva prosnja brez okna ne sme pomeniti »trajno zavrnjeno«. */
class PermissionDenialTest {
    private val denied = intArrayOf(-1)
    private val granted = intArrayOf(PermissionDenial.GRANTED)

    @Test
    fun `prva prosnja brez okna (prazen izid) ni trajna zavrnitev`() {
        val zapis = PermissionDenial.afterResult(recordedDenial = false, grantResults = IntArray(0))
        assertFalse(zapis)
        // Pred prvo zavrnitvijo sistem vrne rationale = false: to NE sme pomeniti trajno.
        assertFalse(PermissionDenial.deniedForever(granted = false, recordedDenial = zapis, showRationale = false))
    }

    @Test
    fun `prva zavrnitev z razlago ni trajna, druga brez razlage je`() {
        val po1 = PermissionDenial.afterResult(false, denied)
        assertTrue(po1)
        assertFalse(PermissionDenial.deniedForever(false, po1, showRationale = true))
        val po2 = PermissionDenial.afterResult(po1, denied)
        assertTrue(PermissionDenial.deniedForever(false, po2, showRationale = false))
    }

    @Test
    fun `preklic po zavrnitvi zapisa ne pobrise, podeljeno ga pobrise`() {
        assertTrue(PermissionDenial.afterResult(true, IntArray(0)))
        assertFalse(PermissionDenial.afterResult(true, granted))
        assertFalse(PermissionDenial.deniedForever(granted = true, recordedDenial = true, showRationale = false))
    }
}
