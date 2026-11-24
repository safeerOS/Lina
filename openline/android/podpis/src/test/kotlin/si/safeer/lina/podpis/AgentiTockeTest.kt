package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tocke naloge s preverbo (lastnik 24. 11. 2026: Lina je poslala 5 tock, narejena 1, nihce ni opazil). Racunalnik (claude-naloge.server.ts
 * JavnaNaloga.tocke = tocke-naloge.ts PovzetekTock, predlogTock, stanje »nepopolno«) poslje »3/5 narejeno« in manjkajoce; telefon jih
 * razcleni strogo (slabo = zavrzen ves odgovor) in pokaze.
 */
class AgentiTockeTest {
    private fun naloga(stanje: String = "nepopolno", dodatno: String = "") =
        """{"id":"0123456789abcdef","izvor":"lina","agent":"claude","mapa":"/dom/projekt","besedilo":"Naloga","stanje":"$stanje",
        "ustvarjeno":"2026-11-24T09:00:00.000Z","potrjeno":"2026-11-24T09:00:00.000Z","razlog":null,"pogoj":null,"ocena":null,
        "opomnik":null,"koncano":"2026-11-24T10:00:00.000Z"$dodatno}"""
    private fun odgovor(n: String) = """{"agenti":[],"naloge":[$n]}"""
    private val tri = ""","tocke":{"skupaj":5,"narejeno":3,"popolno":false,"manjkajoce":[
        {"st":2,"besedilo":"Poženi‮ preizkuse.","razlog":"brez-dokaza"},{"st":5,"besedilo":"Napiši poročilo.","razlog":"manjka"}]},
        "predlogTock":"fedcba9876543210""""

    @Test
    fun `nepopolna naloga s tockami - 3 od 5, manjkajoce z razlogom, besedilo brez nevidnih znakov, predlog`() {
        val n = AgentiLine.razcleni(odgovor(naloga(dodatno = tri)))!!.naloge.single()
        assertEquals("nepopolno", n.stanje)
        val t = assertNotNull(n.tocke)
        assertEquals(5, t.skupaj)
        assertEquals(3, t.narejeno)
        assertEquals(listOf(TockaAgenta(2, "Poženi preizkuse.", "brez-dokaza"), TockaAgenta(5, "Napiši poročilo.", "manjka")), t.manjkajoce)
        assertEquals("fedcba9876543210", n.predlogTock)
    }

    @Test
    fun `stari racunalnik brez polj ali null - brez tock, popolna naloga, predlog napaka`() {
        val brez = AgentiLine.razcleni(odgovor(naloga(stanje = "koncano")))!!.naloge.single()
        assertNull(brez.tocke)
        assertNull(brez.predlogTock)
        assertNull(AgentiLine.razcleni(odgovor(naloga(stanje = "koncano", dodatno = ""","tocke":null,"predlogTock":null""")))!!.naloge.single().tocke)
        val polno = AgentiLine.razcleni(odgovor(naloga(stanje = "koncano",
            dodatno = ""","tocke":{"skupaj":2,"narejeno":2,"popolno":true,"manjkajoce":[]},"predlogTock":"napaka"""")))!!.naloge.single()
        assertEquals(TockeAgenta(2, 2, emptyList()), polno.tocke)
        assertEquals("napaka", polno.predlogTock)
    }

    @Test
    fun `nepopolno ni koncno za cakanje in ni preklicljivo`() {
        assertTrue("nepopolno" in AgentiLine.STANJA)
        assertTrue("nepopolno" !in AgentiLine.NEKONCNA)
        assertTrue("nepopolno" !in AgentiLine.PREKLICLJIVA)
    }

    @Test
    fun `slabe tocke zavrzejo ves odgovor`() {
        val dobro = naloga(dodatno = tri)
        for (slabo in listOf(
            dobro.replace("\"skupaj\":5", "\"skupaj\":31"),
            dobro.replace("\"skupaj\":5", "\"skupaj\":0"),
            dobro.replace("\"skupaj\":5", "\"skupaj\":\"5\""),
            dobro.replace("\"narejeno\":3", "\"narejeno\":4"),
            dobro.replace("\"narejeno\":3", "\"narejeno\":-1"),
            dobro.replace("\"popolno\":false", "\"popolno\":true"),
            dobro.replace("\"st\":5", "\"st\":2"),
            dobro.replace("\"st\":5", "\"st\":6"),
            dobro.replace("\"st\":5", "\"st\":0"),
            dobro.replace("\"razlog\":\"manjka\"", "\"razlog\":\"karkoli\""),
            dobro.replace("\"besedilo\":\"Napiši poročilo.\"", "\"besedilo\":7"),
            dobro.replace("\"predlogTock\":\"fedcba9876543210\"", "\"predlogTock\":\"../x\""),
            dobro.replace("\"tocke\":{", "\"tocke\":[{").replace("]},\n", "]}],\n"),
        )) assertNull(AgentiLine.razcleni(odgovor(slabo)), slabo.takeLast(300))
    }

    @Test
    fun `dolgo besedilo tocke je skrajsano`() {
        val dolgo = naloga(dodatno = tri.replace("Napiši poročilo.", "x".repeat(5000)))
        val t = AgentiLine.razcleni(odgovor(dolgo))!!.naloge.single().tocke!!
        assertTrue(t.manjkajoce[1].besedilo.length <= AgentiLine.NAJVEC_BESEDILO_TOCKE)
    }
}
