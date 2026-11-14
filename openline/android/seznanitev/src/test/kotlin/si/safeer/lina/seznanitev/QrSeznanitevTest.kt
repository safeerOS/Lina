package si.safeer.lina.seznanitev

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** En gumb »Skeniraj QR«: stari QR OpenLine ostane veljaven, QR asistentke nastavi samo asistentko. */
class QrSeznanitevTest {
    private val odtis = "ab".repeat(32)

    @Test
    fun `stari QR OpenLine nastavi samo pot klicev`() {
        val s = assertNotNull(QrSeznanitev.razberi("httpgateway://pair?url=https%3A%2F%2Fgw.example.ts.net%2F&code=K7QM4TZP&fp=$odtis"))
        assertEquals(KlicnoVabilo("https://gw.example.ts.net", "K7QM4TZP", odtis), s.klici)
        assertNull(s.asistent)
    }

    @Test
    fun `stari QR brez https ali odtisa se zavrne kot doslej`() {
        assertNull(QrSeznanitev.razberi("httpgateway://pair?url=http%3A%2F%2Fgw&code=K&fp=$odtis"))
        assertNull(QrSeznanitev.razberi("httpgateway://pair?url=https%3A%2F%2Fgw&code=K&fp="))
        assertNull(QrSeznanitev.razberi("httpgateway://pair?url=https%3A%2F%2Fgw&fp=$odtis"))
        assertNull(QrSeznanitev.razberi("httpgateway://drugo?url=https%3A%2F%2Fgw&code=K&fp=$odtis"))
    }

    @Test
    fun `QR asistentke nastavi samo asistentko`() {
        val s = assertNotNull(QrSeznanitev.razberi("safeer-lina://asistent?v=1&naslov=10.0.0.7&vrata=8443&odtis=$odtis"))
        assertNull(s.klici)
        assertEquals(AsistentNaslov("10.0.0.7", 8443, odtis), s.asistent)
    }

    @Test
    fun `neznan zapis (tudi zdruzeni pred objavo pogodbe) se ne ugiba`() {
        assertNull(QrSeznanitev.razberi("safeer-lina://seznani?v=1&klic=x&asistent=y"))
        assertNull(QrSeznanitev.razberi("https://lina.example/seznani"))
        assertNull(QrSeznanitev.razberi(""))
    }
}
