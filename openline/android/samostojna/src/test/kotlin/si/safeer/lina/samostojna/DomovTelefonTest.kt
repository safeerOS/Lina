package si.safeer.lina.samostojna

import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DomovTelefonTest {
    private val cona = ZoneId.of("Europe/Ljubljana")
    private fun cas(d: Int, h: Int, m: Int) = LocalDateTime.of(2026, 11, d, h, m).atZone(cona).toInstant().toEpochMilli()
    private fun klic(id: String, t: Long, nujno: Boolean = false, kdo: String = "", sp: String = "Prosim za povratni klic.") =
        ZapisKlica(id = id, casZacetka = t, stevilka = "+38640111222", trajanjeS = 30, nujno = nujno, povzetek = "povzetek", klicatelj = kdo, sporocilo = sp)

    @Test
    fun `samo danasnji klici, nujni na vrhu, nato najnovejsi, najvec tri`() {
        val z = listOf(
            klic("vceraj", cas(21, 23, 50)),
            klic("a", cas(22, 8, 5)), klic("b", cas(22, 9, 30)), klic("n", cas(22, 7, 0), nujno = true), klic("c", cas(22, 10, 0)),
        )
        val v = obvestilaDanes(z, cas(22, 12, 0), cona)
        assertEquals(listOf("n", "c", "b"), v.map { it.id })
        assertEquals("07:00", v[0].ura)
        assertEquals(4, steviloDanes(z, cas(22, 12, 0), cona))
    }

    @Test
    fun `brez imena pokaze stevilko, dolgo sporocilo skrajsa`() {
        val v = obvestilaDanes(listOf(klic("x", cas(22, 9, 0), sp = "beseda ".repeat(40))), cas(22, 9, 1), cona, najvecZnakov = 20)
        assertEquals("+38640111222", v[0].kdo)
        assertTrue(v[0].sporocilo.length <= 20 && v[0].sporocilo.endsWith("…"), v[0].sporocilo)
        assertEquals("Ana Novak", obvestilaDanes(listOf(klic("y", cas(22, 9, 0), kdo = " Ana Novak ")), cas(22, 9, 1), cona)[0].kdo)
    }

    @Test
    fun `del dneva za pozdrav`() {
        assertEquals(DelDneva.VECER, delDneva(4)); assertEquals(DelDneva.JUTRO, delDneva(5)); assertEquals(DelDneva.JUTRO, delDneva(9))
        assertEquals(DelDneva.DAN, delDneva(10)); assertEquals(DelDneva.DAN, delDneva(17)); assertEquals(DelDneva.VECER, delDneva(18))
    }
}
