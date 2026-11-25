package si.safeer.lina.samostojna

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Slepi pregled 17t (slepi-17t/NAJDBE.md): prepis klica v sinhronizaciji telefon -> racunalnik. Preizkusi uporabljajo samo API,
 * ki je obstajal pred popravki, zato pred popravkom padejo na trditvi (ne pri prevajanju).
 */
class NajdbeSlepi17tTest {
    private val json = Json { encodeDefaults = true }
    private val ODGOVOR_STAR = """{"rev":1,"klici":[]}"""
    private val ODGOVOR_NOV = """{"rev":2,"klici":[],"zmoznosti":["prepis-v1","izbris-v1"]}"""

    private fun zapisSPrepisom(id: String = "klic-1-1", cas: Long = 1_700_000_000_000L, nacin: NacinKlica = NacinKlica.OSEBNA) = ZapisKlica(
        id = id, casZacetka = cas, stevilka = "+99955501001", trajanjeS = 30, povzetek = "Povratni klic", nacin = nacin,
        prepisPogovora = listOf(IzmenjavaKlica("klicatelj", cas, "Tukaj Miha Horvat."), IzmenjavaKlica("lina", cas + 1, "Zapisala sem.")),
    )

    // N1: racunalnik 0.2.13 polje prepisPogovora tiho zavrze; telefon zapisa s prepisom ne sme za vedno potrditi.
    @Test
    fun `N1 - star racunalnik brez zmoznosti prepisa - zapis s prepisom gre po posodobitvi racunalnika znova, tudi po ponovnem zagonu`() {
        val shramba = PomnilniskaShramba()
        val z = zapisSPrepisom()
        assertTrue(DnevnikKlicev(shramba).dodaj(z))
        val reviziji = PomnilniskaShramba()
        val poslano = mutableListOf<String>()
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_STAR }))
        assertEquals(1, poslano.size, "star racunalnik: en krog, brez ponavljanja istega zapisa")
        // Ponovni zagon aplikacije, nato racunalnik po posodobitvi (javi zmoznost prepis-v1).
        val d2 = DnevnikKlicev(shramba)
        poslano.clear()
        assertTrue(SinhronLine.izmenjaj(d2, reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertTrue(poslano.any { it.contains("\"${z.id}\"") && it.contains("Tukaj Miha Horvat.") }, "zapis s prepisom ni bil poslan znova: $poslano")
        // Ko racunalnik prepis sprejme, se ne poslje vec.
        poslano.clear()
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertFalse(poslano.any { it.contains("\"${z.id}\"") }, "sprejet prepis se je poslal se enkrat")
    }

    @Test
    fun `N1 - nov racunalnik z zmoznostjo prepisa - zapis se potrdi takoj in se ne poslje znova`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba)
        assertTrue(d.dodaj(zapisSPrepisom()))
        val reviziji = PomnilniskaShramba()
        assertTrue(SinhronLine.izmenjaj(d, reviziji, poslji = { ODGOVOR_NOV }))
        val poslano = mutableListOf<String>()
        assertTrue(SinhronLine.izmenjaj(DnevnikKlicev(shramba), reviziji, poslji = { poslano.add(it); ODGOVOR_NOV }))
        assertFalse(poslano.any { it.contains("klic-1-1") })
    }

}
