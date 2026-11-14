package si.safeer.lina.seznanitev

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** QR asistentke (vmesni zapis do zdruzene pogodbe v1): samo zasebni naslov, stroga oblika. */
class AsistentQrTest {
    private val odtis = "ab".repeat(32)

    @Test
    fun `QR z zasebnim naslovom se sprejme`() {
        val a = assertNotNull(AsistentQr.razberi("safeer-lina://asistent?v=1&naslov=192.168.1.20&vrata=8443&odtis=${odtis.uppercase()}"))
        assertEquals(AsistentNaslov("192.168.1.20", 8443, odtis), a)
        assertEquals("https://192.168.1.20:8443/api/asistent/v1", a.osnova())
        assertNotNull(AsistentQr.razberi("safeer-lina://asistent?odtis=$odtis&vrata=1&naslov=127.0.0.1&v=1"))
        assertEquals("https://[fd00::5]:9/api/asistent/v1", AsistentQr.razberi("safeer-lina://asistent?v=1&naslov=fd00::5&vrata=9&odtis=$odtis")!!.osnova())
    }

    @Test
    fun `QR z javnim naslovom, imenom ali napako se zavrne`() {
        val slabi = listOf(
            "safeer-lina://asistent?v=1&naslov=203.0.113.5&vrata=8443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=0.0.0.0&vrata=8443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=lina.local&vrata=8443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=172.32.0.1&vrata=8443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=192.168.01.2&vrata=8443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=2001:db8::1&vrata=8443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=192.168.1.2&vrata=0&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=192.168.1.2&vrata=08443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=192.168.1.2&vrata=8443&odtis=abc",
            "safeer-lina://asistent?v=2&naslov=192.168.1.2&vrata=8443&odtis=$odtis",
            "safeer-lina://asistent?v=1&naslov=192.168.1.2&vrata=8443&odtis=$odtis&zeton=x",
            "safeer-lina://asistent?v=1&naslov=192.168.1.2&naslov=10.0.0.1&vrata=8443&odtis=$odtis",
            "safeer-lina://u@asistent?v=1&naslov=192.168.1.2&vrata=8443&odtis=$odtis",
            "httpgateway://pair?url=https%3A%2F%2Fx&code=K7QM4TZP",
            "safeer-lina://asistent/pot?v=1&naslov=192.168.1.2&vrata=8443&odtis=$odtis",
        )
        for (s in slabi) assertNull(AsistentQr.razberi(s), s)
    }

}
