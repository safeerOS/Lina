package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Seznanitev s QR, dogodki naloge, prikaz zavihka Asistent in napake (pogodba lina-asistent2 @e815ed0). */
class AsistentTest {
    @Test
    fun `dogodki se razclenijo strogo in loceno`() {
        val z = "c".repeat(64)
        val telo = """{"dogodki":[{"st":3,"vrsta":"stanje","besedilo":"Delam"},
            {"st":4,"vrsta":"odobritev","zahtevaId":"abcde","orodje":"Bash","predogled":"git status","opis":"Model pravi: varno","zgostitev":"$z"},
            {"st":5,"vrsta":"novo","x":1},{"st":6,"vrsta":"izid","ok":true,"besedilo":"Koncano"}],"koncano":true}"""
        val d = assertNotNull(AsistentProtokol.razberiDogodke(telo, od = 2))
        assertTrue(d.koncano)
        assertEquals(3, d.dogodki.size, "neznana vrsta se preskoci")
        val o = d.dogodki[1] as DogodekLine.Odobritev
        assertEquals("Bash", o.orodje); assertEquals("git status", o.predogled); assertEquals("Model pravi: varno", o.opis)
        assertEquals(6, AsistentProtokol.zadnjaSt(telo, 2))
    }

    @Test
    fun `stanje nosi tip odgovora Claude Code (vprasanje, vmesno), sistemsko stanje ga nima`() {
        val telo = """{"dogodki":[{"st":1,"vrsta":"stanje","besedilo":"Katero vejo?","tip":"vprasanje"},
            {"st":2,"vrsta":"stanje","besedilo":"Delam","tip":"vmesno"},{"st":3,"vrsta":"stanje","besedilo":"Povezava izgubljena"},
            {"st":4,"vrsta":"stanje","besedilo":"x","tip":"novo"}],"koncano":false}"""
        val d = assertNotNull(AsistentProtokol.razberiDogodke(telo, od = 0)).dogodki.map { it as DogodekLine.Stanje }
        assertEquals(listOf(true to true, false to true, false to false, false to false), d.map { it.vprasanje to it.odgovor })
    }

    @Test
    fun `med nalogo z vprasanjem je vnos odgovor, brez vprasanja ga ni`() {
        val brez = AsistentPrikaz.izracunaj(StanjeAsistenta(seznanjen = true, nalogaTece = true, odprtaOdobritev = null))
        assertFalse(brez.vnos); assertFalse(brez.odgovor)
        val z = AsistentPrikaz.izracunaj(StanjeAsistenta(seznanjen = true, nalogaTece = true, odprtaOdobritev = null, cakaOdgovor = true))
        assertTrue(z.vnos && z.poslji && z.odgovor && z.ustavi)
        val prosto = AsistentPrikaz.izracunaj(StanjeAsistenta(seznanjen = true, nalogaTece = false, odprtaOdobritev = null))
        assertTrue(prosto.vnos); assertFalse(prosto.odgovor)
    }

    @Test
    fun `neveljaven odgovor dogodkov se zavrze ves`() {
        for (s in listOf(
            """{"dogodki":[{"st":1,"vrsta":"stanje","besedilo":"x"}],"koncano":false}""", // st ni nad od=1
            """{"dogodki":[{"st":3,"vrsta":"stanje","besedilo":"x"},{"st":2,"vrsta":"stanje","besedilo":"y"}],"koncano":false}""",
            """{"dogodki":[{"st":2,"vrsta":"odobritev","zahtevaId":"ABCDE","orodje":"x","predogled":"p","opis":"o"}],"koncano":false}""",
            """{"dogodki":[{"st":2,"vrsta":"izid","ok":"true","besedilo":"x"}],"koncano":false}""",
            """{"dogodki":[{"st":"2","vrsta":"stanje","besedilo":"x"}],"koncano":false}""",
            """{"dogodki":[],"koncano":"ne"}""",
            """{"dogodki":[{"st":2,"vrsta":"stanje","besedilo":"${"a".repeat(8001)}"}],"koncano":false}""",
            "ni json",
        )) assertNull(AsistentProtokol.razberiDogodke(s, od = 1), s.take(60))
        assertNull(AsistentProtokol.razberiDogodke("x".repeat(AsistentProtokol.NAJVEC_ODGOVORA + 1), 0))
    }

    @Test
    fun `prikaz brez praznih gumbov`() {
        val o = DogodekLine.Odobritev(1, "abcde", "Bash", "ls", "opis")
        val nes = AsistentPrikaz.izracunaj(StanjeAsistenta(seznanjen = false, nalogaTece = false, odprtaOdobritev = null))
        assertEquals(PrikazAsistenta(seznani = true, pozabi = false, vnos = false, poslji = false, ustavi = false, odobritev = false), nes)
        val prost = AsistentPrikaz.izracunaj(StanjeAsistenta(true, false, null))
        assertTrue(prost.vnos && prost.poslji && prost.pozabi); assertFalse(prost.ustavi || prost.odobritev || prost.seznani)
        val tece = AsistentPrikaz.izracunaj(StanjeAsistenta(true, true, null))
        assertTrue(tece.ustavi); assertFalse(tece.poslji || tece.vnos || tece.odobritev || tece.pozabi)
        assertTrue(AsistentPrikaz.izracunaj(StanjeAsistenta(true, true, o)).odobritev)
        assertFalse(AsistentPrikaz.izracunaj(StanjeAsistenta(true, false, o)).odobritev, "odobritev po koncu naloge ne velja")
        assertFalse(AsistentPrikaz.izracunaj(StanjeAsistenta(true, false, null, posiljam = true)).poslji, "brez dvojnega posiljanja")
    }

    @Test
    fun `telesa zahtev po pogodbi in napake`() {
        val t = AsistentProtokol.teloOdobritve("n".repeat(22), "abcde", true, "n-5ef0fcb562008e97", 1, "enkratni-vektor-0002", "p")
        assertEquals("""{"nalogaId":"${"n".repeat(22)}","zahtevaId":"abcde","dovoli":true,"posiljatelj":"n-5ef0fcb562008e97","cas":1,"enkratni":"enkratni-vektor-0002","podpis":"p"}""", t)
        assertTrue(AsistentProtokol.teloNaloge(PodpisanaNaloga("i", "n-5ef0fcb562008e97", "a\"b\nc", 1, "e", "p")).contains("\"besedilo\":\"a\\\"b\\nc\""))
        assertEquals(SporociloNapake.CLAUDE_CODE_NI, NapakaLine.sporocilo(OdgovorLine.Napaka(503, "claude-code-ni")))
        assertEquals(SporociloNapake.ZAVRNJENO, NapakaLine.sporocilo(OdgovorLine.Napaka(403, null)))
        assertEquals(SporociloNapake.NEDOSEGLJIVA, NapakaLine.sporocilo(OdgovorLine.Nedosegljiva))
        assertNull(NapakaLine.sporocilo(OdgovorLine.Ok("{}")))
    }
}
