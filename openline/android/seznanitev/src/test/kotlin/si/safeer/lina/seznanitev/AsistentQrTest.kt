package si.safeer.lina.seznanitev

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Naslov asistentke: samo zanka ali zasebni naslov, brez imena gostitelja. */
class AsistentQrTest {
    @Test
    fun `zasebni naslovi`() {
        for (a in listOf("127.0.0.1", "10.0.0.7", "172.16.0.1", "172.31.255.1", "192.168.1.20", "::1", "fd00::5")) assertTrue(AsistentQr.jeZasebniNaslov(a), a)
        for (a in listOf("0.0.0.0", "203.0.113.5", "172.32.0.1", "192.168.01.2", "2001:db8::1", "lina.local", "")) assertFalse(AsistentQr.jeZasebniNaslov(a), a)
    }

    @Test
    fun `naslov s preverbo`() {
        assertEquals(AsistentNaslov("10.0.0.7", 8446, "ab".repeat(32)), AsistentQr.naslov("10.0.0.7", 8446, "AB".repeat(32)))
        assertNull(AsistentQr.naslov("10.0.0.7", 0, "ab".repeat(32)))
        assertNull(AsistentQr.naslov("10.0.0.7", 8446, "ab"))
    }
}
