package si.safeer.lina.seznanitev

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Zdruzeni QR v1 (lina-asistent2 AGENTS.md @7a065fb) in zdruzljivost s starim QR OpenLine. */
class QrSeznanitevTest {
    private val fp = "ab".repeat(32)
    private val lfp = "cd".repeat(32)
    private val koda = "K".repeat(22)
    private val zdaj = 1_763_120_000_000L
    private val rok = zdaj + 600_000
    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
    private val lina = enc("https://192.168.1.20:8446/api/asistent/v1")
    private val klici = "&url=${enc("https://192.168.1.20:8787")}&code=K7QM4TZP&fp=$fp"

    @Test
    fun `v1 z obema razdelkoma`() {
        val s = assertNotNull(QrSeznanitev.razberi("httpgateway://pair?v=1$klici&lina=$lina&linafp=$lfp&linakoda=$koda&do=$rok", zdaj))
        assertEquals(KlicnoVabilo("https://192.168.1.20:8787", "K7QM4TZP", fp), s.klici)
        assertEquals(AsistentVabilo(AsistentNaslov("192.168.1.20", 8446, lfp), koda, rok), s.asistent)
        assertEquals("https://192.168.1.20:8446/api/asistent/v1", s.asistent!!.naslov.osnova())
    }

    @Test
    fun `v1 samo asistentka in IPv6`() {
        val s = assertNotNull(QrSeznanitev.razberi("httpgateway://pair?v=1&lina=$lina&linafp=$lfp&linakoda=$koda&do=$rok", zdaj))
        assertNull(s.klici)
        val l6 = enc("https://[fd00::5]:8446/api/asistent/v1")
        assertEquals("fd00::5", QrSeznanitev.razberi("httpgateway://pair?v=1&lina=$l6&linafp=$lfp&linakoda=$koda&do=$rok", zdaj)!!.asistent!!.naslov.naslov)
    }

    @Test
    fun `v1 se zavrne v celoti ob kateri koli napaki`() {
        val dobro = "&lina=$lina&linafp=$lfp&linakoda=$koda&do=$rok"
        val slabi = listOf(
            "httpgateway://pair?v=1&lina=$lina&linafp=$lfp&linakoda=$koda&do=$zdaj", // potekel rok
            "httpgateway://pair?v=2$dobro",
            "httpgateway://pair?v=1&url=${enc("https://192.168.1.20:8787")}&code=K7QM4TZP$dobro", // klici brez fp
            "httpgateway://pair?v=1&url=${enc("https://203.0.113.5:8787")}&code=K7QM4TZP&fp=$fp$dobro", // javni naslov klicev
            "httpgateway://pair?v=1&lina=${enc("https://203.0.113.5:8446/api/asistent/v1")}&linafp=$lfp&linakoda=$koda&do=$rok",
            "httpgateway://pair?v=1&lina=${enc("https://lina.local:8446/api/asistent/v1")}&linafp=$lfp&linakoda=$koda&do=$rok",
            "httpgateway://pair?v=1&lina=${enc("http://192.168.1.20:8446/api/asistent/v1")}&linafp=$lfp&linakoda=$koda&do=$rok",
            "httpgateway://pair?v=1&lina=${enc("https://192.168.1.20:8446/drugo")}&linafp=$lfp&linakoda=$koda&do=$rok",
            "httpgateway://pair?v=1&lina=${enc("https://u@192.168.1.20:8446/api/asistent/v1")}&linafp=$lfp&linakoda=$koda&do=$rok",
            "httpgateway://pair?v=1&lina=$lina&linafp=abc&linakoda=$koda&do=$rok",
            "httpgateway://pair?v=1&lina=$lina&linafp=$lfp&linakoda=kratka&do=$rok",
            "httpgateway://pair?v=1&lina=$lina&linafp=$lfp&linakoda=$koda&do=$rok&zeton=x", // neznan parameter
            "httpgateway://pair?v=1&v=1$dobro", // podvojen
            "httpgateway://pair?v=1$klici", // brez razdelka asistentke
        )
        for (q in slabi) assertNull(QrSeznanitev.razberi(q, zdaj), q.take(90))
    }

    @Test
    fun `stari QR OpenLine brez v ostane veljaven samo za klice`() {
        val s = assertNotNull(QrSeznanitev.razberi("httpgateway://pair?url=https%3A%2F%2Fgw.example.ts.net%2F&code=K7QM4TZP&fp=$fp", zdaj))
        assertEquals(KlicnoVabilo("https://gw.example.ts.net", "K7QM4TZP", fp), s.klici)
        assertNull(s.asistent)
        assertNull(QrSeznanitev.razberi("httpgateway://pair?url=http%3A%2F%2Fgw&code=K&fp=$fp", zdaj))
        assertNull(QrSeznanitev.razberi("httpgateway://pair?url=https%3A%2F%2Fgw&code=K&fp=", zdaj))
    }

    @Test
    fun `vmesni zapis safeer-lina ni vec veljaven`() {
        assertNull(QrSeznanitev.razberi("safeer-lina://asistent?v=1&naslov=10.0.0.7&vrata=8443&odtis=$lfp", zdaj))
    }

    @Test
    fun `QR z v ne gre mimo pravil v1 po stari poti (intent v GatewayPairing parse)`() {
        // Potekel v1 z javnim naslovom: stara pot ga ne sme sprejeti, sicer bi intent obsel preverbo do in zasebnega naslova.
        assertNull(QrSeznanitev.stariOpenLine("httpgateway://pair?v=1&url=${enc("https://203.0.113.5:8443")}&code=ABCD2345&fp=$fp&do=1"))
        assertNotNull(QrSeznanitev.stariOpenLine("httpgateway://pair?url=${enc("https://10.0.0.2:8443")}&code=ABCD2345&fp=$fp"))
    }
}
