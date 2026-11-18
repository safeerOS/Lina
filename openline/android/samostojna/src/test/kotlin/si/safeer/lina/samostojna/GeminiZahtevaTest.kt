package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GeminiZahtevaTest {

    @Test
    fun `gradiTelo - prazen vhod in brez navodila`() {
        val rezultat = gradiTelo(emptyList(), "")
        assertEquals("""{"contents":[]}""", rezultat)
    }

    @Test
    fun `gradiTelo - samo navodilo`() {
        val rezultat = gradiTelo(emptyList(), "Bodi pameten")
        assertEquals("""{"systemInstruction":{"parts":[{"text":"Bodi pameten"}]},"contents":[]}""", rezultat)
    }

    @Test
    fun `gradiTelo - eno sporocilo brez navodila`() {
        val rezultat = gradiTelo(listOf(Sporocilo("user", "Zivjo")), "")
        assertEquals("""{"contents":[{"role":"user","parts":[{"text":"Zivjo"}]}]}""", rezultat)
    }

    @Test
    fun `gradiTelo - navodilo in zgodovina`() {
        val rezultat = gradiTelo(
            listOf(Sporocilo("user", "A"), Sporocilo("model", "B")),
            "Navodilo"
        )
        val pricakovano = """{"systemInstruction":{"parts":[{"text":"Navodilo"}]},"contents":[{"role":"user","parts":[{"text":"A"}]},{"role":"model","parts":[{"text":"B"}]}]}"""
        assertEquals(pricakovano, rezultat)
    }

    @Test
    fun `razberiOdgovor - neveljaven JSON ne vrze izjeme`() {
        val rezultat = razberiOdgovor("{ to ni json }")
        assertTrue(rezultat is Rezultat.Napaka)
        assertEquals("Neveljaven JSON", (rezultat as Rezultat.Napaka).sporocilo)
    }

    @Test
    fun `razberiOdgovor - napaka v odgovoru`() {
        val json = """{"error":{"code":400,"message":"Bad request"}}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Napaka)
        assertEquals(400, (rezultat as Rezultat.Napaka).koda)
        assertEquals("Bad request", rezultat.sporocilo)
    }

    @Test
    fun `razberiOdgovor - prazni candidates`() {
        val json = """{"candidates":[]}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Napaka)
        assertEquals("Prazen odgovor", (rezultat as Rezultat.Napaka).sporocilo)
    }

    @Test
    fun `razberiOdgovor - zavrnjeno zaradi varnosti`() {
        val json = """{"candidates":[{"finishReason":"SAFETY"}]}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Zavrnjeno)
        assertEquals("SAFETY", (rezultat as Rezultat.Zavrnjeno).razlog)
    }

    @Test
    fun `razberiOdgovor - zavrnjeno zaradi blokade (BLOCKLIST in PROHIBITED_CONTENT)`() {
        val json1 = """{"candidates":[{"finishReason":"BLOCKLIST"}]}"""
        val rezultat1 = razberiOdgovor(json1)
        assertTrue(rezultat1 is Rezultat.Zavrnjeno)
        assertEquals("BLOCKLIST", (rezultat1 as Rezultat.Zavrnjeno).razlog)

        val json2 = """{"candidates":[{"finishReason":"PROHIBITED_CONTENT"}]}"""
        val rezultat2 = razberiOdgovor(json2)
        assertTrue(rezultat2 is Rezultat.Zavrnjeno)
        assertEquals("PROHIBITED_CONTENT", (rezultat2 as Rezultat.Zavrnjeno).razlog)
        
        val json3 = """{"candidates":[{"finishReason":"SPII"}]}"""
        val rezultat3 = razberiOdgovor(json3)
        assertTrue(rezultat3 is Rezultat.Zavrnjeno)
        assertEquals("SPII", (rezultat3 as Rezultat.Zavrnjeno).razlog)

        val json4 = """{"candidates":[{"finishReason":"IMAGE_SAFETY"}]}"""
        val rezultat4 = razberiOdgovor(json4)
        assertTrue(rezultat4 is Rezultat.Zavrnjeno)
        assertEquals("IMAGE_SAFETY", (rezultat4 as Rezultat.Zavrnjeno).razlog)
    }

    @Test
    fun `razberiOdgovor - manjka besedilo`() {
        val json = """{"candidates":[{"finishReason":"STOP","content":{"parts":[]}}]}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Napaka)
        assertEquals("Manjka besedilo", (rezultat as Rezultat.Napaka).sporocilo)
    }

    @Test
    fun `razberiOdgovor - veljaven odgovor`() {
        val json = """{"candidates":[{"content":{"parts":[{"text":"Pozdravljen"}]}}]}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Besedilo)
        assertEquals("Pozdravljen", (rezultat as Rezultat.Besedilo).besedilo)
    }

    @Test
    fun `razberiOdgovor - zavrnjeno iz promptFeedback`() {
        val json = """{"promptFeedback":{"blockReason":"SAFETY"}}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Zavrnjeno)
        assertEquals("SAFETY", (rezultat as Rezultat.Zavrnjeno).razlog)
    }

    @Test
    fun `razberiOdgovor - MAX_TOKENS z delnim besedilom`() {
        val json = """{"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[{"text":"Delno"}]}}]}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Besedilo)
        assertEquals("Delno", (rezultat as Rezultat.Besedilo).besedilo)
    }

    @Test
    fun `razberiOdgovor - zdruzi vse dele besedila`() {
        val json = """{"candidates":[{"content":{"parts":[{"text":"Prvi del. "},{"text":"Drugi del."}]}}]}"""
        val rezultat = razberiOdgovor(json)
        assertTrue(rezultat is Rezultat.Besedilo)
        assertEquals("Prvi del. Drugi del.", (rezultat as Rezultat.Besedilo).besedilo)
    }

    @Test
    fun `KljucGemini - skrit v toString`() {
        val kljuc = KljucGemini("skrivnost123")
        assertEquals("KljucGemini(***)", kljuc.toString())
    }

    @Test
    fun `KljucGemini - izpostavi vrne pravo vrednost`() {
        val kljuc = KljucGemini("skrivnost123")
        assertEquals("skrivnost123", kljuc.izpostavi())
    }

    @Test
    fun `KljucGemini - sporocilo ne vsebuje kljuca`() {
        val kljuc = KljucGemini("skrivnost123")
        assertTrue(!kljuc.toString().contains("skrivnost123"))
    }

    @Test
    fun `KljucGemini - mejni prazen`() {
        val kljuc = KljucGemini("")
        assertEquals("KljucGemini(***)", kljuc.toString())
        assertEquals("", kljuc.izpostavi())
    }
}
