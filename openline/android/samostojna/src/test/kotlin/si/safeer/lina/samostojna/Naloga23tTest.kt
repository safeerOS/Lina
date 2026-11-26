package si.safeer.lina.samostojna

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Naloga 23t: besedilo izida predaje po razlogu zagona seje Claude Code (503 claude-code-ni, stanje.zagon). */
class Naloga23tTest {
    @Test fun `prva oddaja - odpira je vmesni izid, ostali razlogi takoj svoje besedilo`() {
        assertEquals(IzidPredaje.ODPIRA, PredajaNaloge.izidPrve(false, false, 503, "odpira"))
        assertEquals(IzidPredaje.ZAGON_IZKLOPLJENO, PredajaNaloge.izidPrve(false, false, 503, "izklopljeno"))
        assertEquals(IzidPredaje.ZAGON_NI_TERMINALA, PredajaNaloge.izidPrve(false, false, 503, "ni-terminala"))
        assertEquals(IzidPredaje.ZAGON_NI_CLAUDE, PredajaNaloge.izidPrve(false, false, 503, "ni-claude"))
        assertEquals(IzidPredaje.ZAGON_OPOZORILO, PredajaNaloge.izidPrve(false, false, 503, "opozorilo"))
        assertEquals(IzidPredaje.ZAGON_OMEJITEV, PredajaNaloge.izidPrve(false, false, 503, "omejitev"))
        assertEquals(IzidPredaje.ZAGON_NAPAKA, PredajaNaloge.izidPrve(false, false, 503, "napaka"))
        // starejsa Lina (brez zagon) ali neznan razlog: kot prej
        assertEquals(IzidPredaje.CLAUDE_CODE_NI, PredajaNaloge.izidPrve(false, false, 503, null))
        assertEquals(IzidPredaje.CLAUDE_CODE_NI, PredajaNaloge.izidPrve(false, false, 503, "novo"))
        // zagon velja samo ob 503
        assertEquals(IzidPredaje.ZAVRNJENA, PredajaNaloge.izidPrve(false, false, 403, "odpira"))
        assertEquals(IzidPredaje.SPREJETA, PredajaNaloge.izidPrve(true, false, null, null))
        assertEquals(IzidPredaje.NEDOSEGLJIV, PredajaNaloge.izidPrve(false, true, null, "odpira"))
    }

    @Test fun `ponovna oddaja in rok nikoli ne vrneta vmesnega izida (ni drugega kroga cakanja)`() {
        assertEquals(IzidPredaje.ZAGON_ROK, PredajaNaloge.izidPonovne(false, false, 503, "odpira"))
        assertEquals(IzidPredaje.ZAGON_OMEJITEV, PredajaNaloge.izidPonovne(false, false, 503, "omejitev"))
        assertEquals(IzidPredaje.SPREJETA, PredajaNaloge.izidPonovne(true, false, null, null))
        assertEquals(IzidPredaje.ZAVRNJENA, PredajaNaloge.izidPonovne(false, false, 403, null))
        assertEquals(IzidPredaje.ZAGON_ROK, PredajaNaloge.izidRoka(null))
        assertEquals(IzidPredaje.ZAGON_ROK, PredajaNaloge.izidRoka("odpira"))
        assertEquals(IzidPredaje.ZAGON_NI_CLAUDE, PredajaNaloge.izidRoka("ni-claude"))
        for (z in listOf(null, "odpira", "ni-terminala", "ni-claude", "izklopljeno", "opozorilo", "omejitev", "napaka", "x")) {
            assertTrue(PredajaNaloge.izidPonovne(false, false, 503, z) != IzidPredaje.ODPIRA, "$z")
            assertTrue(PredajaNaloge.izidRoka(z) != IzidPredaje.ODPIRA, "$z")
        }
    }

    @Test fun `besedila - odpira pove, da Lina odpira Claude Code, rok in razlogi povedo, da je naloga shranjena`() {
        val res = File("../app/src/main/res")
        for (jezik in listOf("values", "values-sl", "values-de", "values-es", "values-fr", "values-it")) {
            val x = File(res, "$jezik/strings.xml").readText()
            for (k in listOf("local_task_odpiranje_preklicano", "local_task_preklic_prepozno")) assertTrue(x.contains("name=\"$k\""), "$jezik $k")
        }
        val sl = File(res, "values-sl/strings.xml").readText()
        fun sl(k: IzidPredaje) = Regex("name=\"${PredajaNaloge.kljuc(k)}\">([^<]*)<").find(sl)!!.groupValues[1]
        assertTrue(sl(IzidPredaje.ODPIRA).contains("odpira Claude Code"), sl(IzidPredaje.ODPIRA))
        assertTrue(sl(IzidPredaje.ZAGON_ROK).contains("shranjen"), sl(IzidPredaje.ZAGON_ROK))
        assertTrue(sl(IzidPredaje.ZAGON_NI_TERMINALA).contains("terminal"), sl(IzidPredaje.ZAGON_NI_TERMINALA))
    }

    @Test fun `po zasuku ali ponovnem zagonu aplikacije - cakanje se nadaljuje samo za isti racunalnik in v roku`() {
        val rok = 180_000L
        val t = 10_000_000L
        assertEquals(NalogaCakaSejo.Ob.OBNOVI, NalogaCakaSejo.obZagonu(true, "id-1", "odtis-a", "odtis-a", t, t + 5_000, rok))
        assertEquals(NalogaCakaSejo.Ob.ROK, NalogaCakaSejo.obZagonu(true, "id-1", "odtis-a", "odtis-a", t, t + rok + 1, rok))
        assertEquals(NalogaCakaSejo.Ob.NIC, NalogaCakaSejo.obZagonu(true, "id-1", "odtis-a", "odtis-b", t, t + 5_000, rok), "drug racunalnik")
        assertEquals(NalogaCakaSejo.Ob.NIC, NalogaCakaSejo.obZagonu(true, "id-1", "odtis-a", null, t, t + 5_000, rok), "pozabljen racunalnik")
        assertEquals(NalogaCakaSejo.Ob.NIC, NalogaCakaSejo.obZagonu(false, "id-1", "odtis-a", "odtis-a", t, t + 5_000, rok), "koncana: samo rocno")
        assertEquals(NalogaCakaSejo.Ob.NIC, NalogaCakaSejo.obZagonu(true, null, "odtis-a", "odtis-a", t, t + 5_000, rok))
        assertEquals(NalogaCakaSejo.Ob.NIC, NalogaCakaSejo.obZagonu(true, "id-1", "odtis-a", "odtis-a", t, t - 1, rok), "ura nazaj")
        // slepi pregled krog 2 N1: aplikacija zaprta MED ponovno oddajo, odprta po roku - izid neznan (ne »nisem oddala«, brez ponovitve)
        assertEquals(NalogaCakaSejo.Ob.NEZNAN, NalogaCakaSejo.obZagonu(true, "id-1", "odtis-a", "odtis-a", t, t + rok + 1, rok, oddano = true))
        // v roku: nadaljuj z istim id (racunalnik ga ze ima -> 409 obstaja, ne dvakrat)
        assertEquals(NalogaCakaSejo.Ob.OBNOVI, NalogaCakaSejo.obZagonu(true, "id-1", "odtis-a", "odtis-a", t, t + 5_000, rok, oddano = true))
    }

    @Test fun `kontroler - cakajoca naloga se ne poslje sama, nova naloga in Ustavi preklicata cakanje`() {
        val k = listOf("../app/src/main/kotlin/si/safeer/lina/asistent/AsistentKontroler.kt", "app/src/main/kotlin/si/safeer/lina/asistent/AsistentKontroler.kt")
            .map(::File).first { it.isFile }.readText()
        // med cakanjem posljiShranjeno ne poslje nicesar (bi preklicalo cakajoco); cakanje po zasuku nadaljuje, preden vzame shranjeno
        assertTrue(Regex("""private fun posljiShranjeno\(\) \{\s+if \(cakaSejo != null\) return[^\n]*\n\s+if \(obnoviCakanje\(\)\) return""").containsMatchIn(k), "posljiShranjeno")
        // »shrani za pozneje« in cakanje na sejo imata loceni mesti: posljiShranjeno ne zbrise cakajoce (N3, N4 slepega pregleda)
        assertFalse(Regex("""private fun posljiShranjeno\(\)[\s\S]{0,2000}shrambaCakajoce\.edit\(\)\.clear\(\)""").containsMatchIn(k), "posljiShranjeno brise vse")
        assertTrue(k.contains("const val Z_BESEDILO = \"z_besedilo\""))
        assertTrue(k.contains("val id = nalogaId ?: run { prekliciCakanje(); return }"), "Ustavi preklice cakanje")
        assertTrue(Regex("""fun poslji\(vnos: String[^\n]*\n(.*\n){0,4}\s+prekliciCakanje\(\)""").containsMatchIn(k), "nova naloga preklice staro")
        // vmesni izid ne porabi enkratnega klica klepeta za shranjeno nalogo
        assertTrue(k.contains("if (izid != IzidPredaje.NEDOSEGLJIV && izid != IzidPredaje.ODPIRA) obIzidShranjene"), "posljiShranjeno ODPIRA")
    }
}
