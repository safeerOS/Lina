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

    @Test
    fun `sistemski zapisi niso klici in se ne stejejo ne kazejo`() {
        val z = listOf(
            klic("a", cas(22, 8, 5)),
            klic("sys-1", cas(22, 9, 0)).copy(stevilka = "Sistem"),
            klic("sys-2", cas(22, 9, 5)),
        )
        assertEquals(1, steviloDanes(z, cas(22, 12, 0), cona))
        assertEquals(listOf("a"), obvestilaDanes(z, cas(22, 12, 0), cona).map { it.id })
    }

    /** Lastnik 23. 11. 2026: klici, ki jih je prevzela Lina, na Domovu brez drsenja - zadnji klici, ne samo danasnji. */
    @Test
    fun `zadnji klici tudi iz prejsnjih dni, brez sistemskih, najnovejsi prvi, najvec N`() {
        val z = listOf(
            klic("star", cas(19, 10, 0)), klic("vceraj", cas(21, 23, 50)), klic("sys-1", cas(22, 11, 0)),
            klic("a", cas(22, 8, 5)), klic("n", cas(22, 7, 0), nujno = true), klic("s", cas(22, 9, 0)).copy(stevilka = "Sistem"),
        )
        assertEquals(listOf("a", "n", "vceraj"), zadnjiKlici(z, najvec = 3).map { it.id })
        assertEquals(listOf("a", "n", "vceraj", "star"), zadnjiKlici(z, najvec = 5).map { it.id })
    }

    @Test
    fun `brez klicev prazen seznam`() {
        assertTrue(zadnjiKlici(emptyList(), najvec = 4).isEmpty())
        assertTrue(zadnjiKlici(listOf(klic("sys-1", cas(22, 9, 0))), najvec = 4).isEmpty())
    }

    @Test
    fun `vrstica zadnjega klica - ura danes, datum za starejse, povzetek skrajsan`() {
        val zdaj = cas(22, 12, 0)
        assertEquals("08:05", vrsticaZadnjegaKlica(klic("a", cas(22, 8, 5)), zdaj, cona).ura)
        assertEquals("21. 11. 23:50", vrsticaZadnjegaKlica(klic("b", cas(21, 23, 50)), zdaj, cona).ura)
        val v = vrsticaZadnjegaKlica(klic("c", cas(22, 9, 0), sp = "beseda ".repeat(40)), zdaj, cona, najvecZnakov = 20)
        assertTrue(v.sporocilo.length <= 20 && v.sporocilo.endsWith("…"), v.sporocilo)
        assertEquals("povzetek", vrsticaZadnjegaKlica(klic("d", cas(22, 9, 0), sp = ""), zdaj, cona).sporocilo)
    }

    @Test
    fun `ime iz imenika, povedano ime, stevilka, skrita stevilka`() {
        val zdaj = cas(22, 12, 0)
        val k = klic("a", cas(22, 9, 0))
        assertEquals("Ana Novak (imenik)", vrsticaZadnjegaKlica(k.copy(imeImenik = "Ana Novak"), zdaj, cona).kdo)
        assertEquals("Miha (v imeniku: Ana Novak)", vrsticaZadnjegaKlica(k.copy(klicatelj = "Miha", imeImenik = "Ana Novak"), zdaj, cona).kdo)
        assertEquals("+38640111222", vrsticaZadnjegaKlica(k, zdaj, cona).kdo)
        assertEquals("", vrsticaZadnjegaKlica(k.copy(stevilka = " "), zdaj, cona).kdo)
    }

    @Test
    fun `stevilo vrstic po visini zaslona 3 do 5, vecja pisava manj`() {
        assertEquals(3, vrsticZadnjihKlicev(640))
        assertEquals(3, vrsticZadnjihKlicev(720))
        assertEquals(4, vrsticZadnjihKlicev(760))
        assertEquals(5, vrsticZadnjihKlicev(820))
        assertEquals(5, vrsticZadnjihKlicev(2000))
        assertEquals(3, vrsticZadnjihKlicev(820, pisava = 1.3f))
    }
}
