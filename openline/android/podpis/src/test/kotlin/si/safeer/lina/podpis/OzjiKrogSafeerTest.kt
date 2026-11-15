package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Potrditev v ozji krog prek Safeer Phone/OS (T4, 15. 11. 2026): izbira cilja, zahteva, izid. */
class OzjiKrogSafeerTest {
    private val kljuc = java.util.Base64.getEncoder().encodeToString(ByteArray(91) { (it * 7 + 3).toByte() })
    private val id = KrogKljuc.idIzKljuca(kljuc)

    @Test
    fun `cilj je samo dovoljen paket z istim podpisom`() {
        // Tuja aplikacija, ki napove isto dejanje, nikoli ni cilj - tudi ce je edina.
        assertNull(OzjiKrogSafeer.izberiCilj(listOf(OzjiKrogSafeer.Kandidat("com.napadalec", true))))
        // Pravo ime paketa, a drug podpis (lazni si.safeer.phone): ne.
        assertNull(OzjiKrogSafeer.izberiCilj(listOf(OzjiKrogSafeer.Kandidat("si.safeer.phone", false))))
        assertNull(OzjiKrogSafeer.izberiCilj(emptyList()))
        // Prednost: telefon, nato Safeer OS, nato tablica; podpis odloca.
        val vsi = listOf(
            OzjiKrogSafeer.Kandidat("si.safeer.tablet", true), OzjiKrogSafeer.Kandidat("si.safeer.os", true),
            OzjiKrogSafeer.Kandidat("si.safeer.phone", true))
        assertEquals("si.safeer.phone", OzjiKrogSafeer.izberiCilj(vsi))
        assertEquals("si.safeer.os", OzjiKrogSafeer.izberiCilj(vsi.filter { it.paket != "si.safeer.phone" }))
        assertEquals("si.safeer.os", OzjiKrogSafeer.izberiCilj(listOf(
            OzjiKrogSafeer.Kandidat("si.safeer.phone", false), OzjiKrogSafeer.Kandidat("si.safeer.os", true))))
    }

    @Test
    fun `zahteva nosi samo id in javni kljuc ter zavrne neujemanje`() {
        val z = assertNotNull(OzjiKrogSafeer.zahteva(id, kljuc))
        assertEquals(setOf("id", "kljuc"), z.keys, "nobenega imena ali skrivnosti")
        assertNull(OzjiKrogSafeer.zahteva("n-0000000000000000", kljuc), "id ni iz kljuca")
        assertNull(OzjiKrogSafeer.zahteva("$id-os", kljuc), "pripona ni dovoljena")
        assertNull(OzjiKrogSafeer.zahteva(id, ""), "prazen kljuc")
        assertNull(OzjiKrogSafeer.zahteva(id, "!!!"), "nedekodljiv kljuc")
        val dolg = java.util.Base64.getEncoder().encodeToString(ByteArray(300) { it.toByte() })
        assertNull(OzjiKrogSafeer.zahteva(KrogKljuc.idIzKljuca(dolg), dolg), "predolg kljuc")
    }

    @Test
    fun `uspeh samo ob RESULT_OK z znanim izidom`() {
        assertEquals(OzjiKrogSafeer.Izid.V_KROGU, OzjiKrogSafeer.izid(true, "dodano"))
        assertEquals(OzjiKrogSafeer.Izid.ZE_V_KROGU, OzjiKrogSafeer.izid(true, "ze_v_krogu"))
        assertEquals(OzjiKrogSafeer.Izid.ZAVRNJENO, OzjiKrogSafeer.izid(false, "zavrnjeno"))
        // Ne domnevamo uspeha: prazno, neznano, RESULT_OK brez izida, preklic z izidom »dodano« (nenavadno) = napaka.
        for ((ok, s) in listOf(true to null, true to "", true to "DODANO", true to "da", false to "dodano", false to null, true to "zavrnjeno")) {
            assertEquals(OzjiKrogSafeer.Izid.NAPAKA, OzjiKrogSafeer.izid(ok, s), "ok=$ok izid=$s")
        }
    }

    @Test
    fun `gumb samo ko ima ucinek in shrani samo uspeh`() {
        assertTrue(OzjiKrogSafeer.pokaziGumb(ciljNaVoljo = true, vKrogu = false))
        assertFalse(OzjiKrogSafeer.pokaziGumb(ciljNaVoljo = false, vKrogu = false), "brez Safeerja ni gumba")
        assertFalse(OzjiKrogSafeer.pokaziGumb(ciljNaVoljo = true, vKrogu = true), "ze v krogu: brez ponovne potrditve")
        assertTrue(OzjiKrogSafeer.jeUspeh(OzjiKrogSafeer.Izid.V_KROGU) && OzjiKrogSafeer.jeUspeh(OzjiKrogSafeer.Izid.ZE_V_KROGU))
        assertFalse(OzjiKrogSafeer.jeUspeh(OzjiKrogSafeer.Izid.ZAVRNJENO) || OzjiKrogSafeer.jeUspeh(OzjiKrogSafeer.Izid.NAPAKA))
    }

    @Test
    fun `dejanje in polja so enaka kot na strani Safeer`() {
        assertEquals("si.safeer.tv.OZJI_KROG_POTRDI", OzjiKrogSafeer.DEJANJE)
        assertEquals("id", OzjiKrogSafeer.POLJE_ID); assertEquals("kljuc", OzjiKrogSafeer.POLJE_KLJUC)
        assertEquals("izid", OzjiKrogSafeer.POLJE_IZID)
    }
}
