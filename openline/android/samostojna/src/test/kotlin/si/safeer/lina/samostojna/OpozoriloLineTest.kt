package si.safeer.lina.samostojna

import java.io.File
import java.security.MessageDigest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Opozorilo ob prvem zagonu (lastnik 24. 11. 2026, AGENTS.md »Objava Line na safeer.si in opozorilo uporabniku»): brez »Razumem«
 * nova namestitev ne sprejema klicev in nobena ne posilja nalog ali gradenj; ze namescena Lina sprejema klice kot prej, dokler
 * opozorila ne potrdi. Besedilo je pripeto na razlicico (sprememba besedila brez nove razlicice pade).
 */
class OpozoriloLineTest {
    private val N = OpozoriloLine.Namestitev.NOVA
    private val O = OpozoriloLine.Namestitev.OBSTOJECA
    private val R = OpozoriloLine.RAZLICICA

    @Test
    fun `nova namestitev ne sprejema klicev pred potrditvijo`() {
        assertFalse(OpozoriloLine.smeSprejematiKlice(null, N))
        assertTrue(OpozoriloLine.smeSprejematiKlice(R, N))
    }

    @Test
    fun `ze namescena Lina sprejema klice kot prej, tudi brez potrditve`() {
        assertTrue(OpozoriloLine.smeSprejematiKlice(null, O))
    }

    @Test
    fun `neznana namestitev je kot nova (fail closed)`() {
        assertFalse(OpozoriloLine.smeSprejematiKlice(null, null))
    }

    @Test
    fun `potrjena starejsa razlicica besedila - klici delujejo, opozorilo se pokaze znova, naloge pocakajo`() {
        // druga potrjena razlicica kot trenutna (po spremembi besedila); razlicica 1 je prva, zato tu R + 1 kot primer druge
        val druga = R + 1
        assertTrue(OpozoriloLine.smeSprejematiKlice(druga, N))
        assertTrue(OpozoriloLine.pokazi(druga))
        assertFalse(OpozoriloLine.smeDelati(druga))
        // 0 ali negativno ni potrditev
        assertFalse(OpozoriloLine.smeSprejematiKlice(0, N))
    }

    @Test
    fun `naloge in gradnje samo s potrditvijo trenutne razlicice, tudi na obstojeci namestitvi`() {
        assertFalse(OpozoriloLine.smeDelati(null))
        assertTrue(OpozoriloLine.smeDelati(R))
        assertTrue(OpozoriloLine.pokazi(null))
        assertFalse(OpozoriloLine.pokazi(R))
    }

    @Test
    fun `namestitev iz casov paketa - posodobitev je obstojeca, sveza namestitev nova`() {
        assertEquals(O, OpozoriloLine.namestitevIzCasov(1_000, 2_000, stariPodatki = true))
        assertEquals(N, OpozoriloLine.namestitevIzCasov(1_000, 1_000, stariPodatki = true))
        assertEquals(N, OpozoriloLine.namestitevIzCasov(2_000, 1_000, stariPodatki = true))
        // posodobljena, a brez starih nastavitev (»Pocisti podatke«): nova - brez potrditve ne sprejema klicev
        assertEquals(N, OpozoriloLine.namestitevIzCasov(1_000, 2_000, stariPodatki = false))
    }

    @Test
    fun `oznaka namestitve se zapise enkrat in se ne izracuna znova`() {
        var racunano = 0
        val prvic = OpozoriloLine.oznakaNamestitve(null) { racunano++; N }
        assertEquals(N to true, prvic)
        // kasnejsa posodobitev bi dala OBSTOJECA, a shranjena oznaka velja
        val drugic = OpozoriloLine.oznakaNamestitve(N) { racunano++; O }
        assertEquals(N to false, drugic)
        assertEquals(1, racunano)
    }

    private fun niz(mapa: String, ime: String): String? {
        val f = listOf("../app/src/main/res/$mapa/strings.xml", "app/src/main/res/$mapa/strings.xml").map(::File).first { it.isFile }
        return Regex("<string name=\"$ime\">(.*?)</string>", RegexOption.DOT_MATCHES_ALL).find(f.readText())?.groupValues?.get(1)
    }

    @Test
    fun `besedilo opozorila sl in en je pripeto na razlicico`() {
        val sl = niz("values-sl", "first_run_body")
        val en = niz("values", "first_run_body")
        assertNotNull(sl); assertNotNull(en)
        val vsota = MessageDigest.getInstance("SHA-256").digest("$sl\u0000$en".toByteArray()).joinToString("") { "%02x".format(it) }
        assertEquals(OpozoriloLine.ZGOSTITEV_BESEDILA, vsota, "besedilo opozorila se je spremenilo: povecaj RAZLICICA in posodobi ZGOSTITEV_BESEDILA")
        for (k in listOf("osebni rabi", "napake", "lastno odgovornost", "ne prevzema odgovornosti", "nadzirati", "omeji")) assertTrue(sl!!.contains(k), k)
        for (k in listOf("personal use", "mistakes", "own risk", "no liability", "supervising", "limit")) assertTrue(en!!.contains(k), k)
    }

    @Test
    fun `nova besedila imajo sl in en, brez neubezanih apostrofov`() {
        val kljuci = listOf(
            "first_run_title", "first_run_body", "first_run_ok", "first_run_later", "set_menu_about", "set_menu_about_desc",
            "builds_title", "builds_desc", "builds_propose", "builds_confirm", "builds_install", "builds_refresh",
            "install_perm_needed", "install_perm_open", "builds_need_warning",
        )
        for (mapa in listOf("values", "values-sl")) for (k in kljuci) {
            val v = niz(mapa, k)
            assertNotNull(v, "$mapa/$k")
            assertFalse(Regex("(?<!\\\\)'").containsMatchIn(v!!), "$mapa/$k ima neubezan apostrof")
        }
    }
}
