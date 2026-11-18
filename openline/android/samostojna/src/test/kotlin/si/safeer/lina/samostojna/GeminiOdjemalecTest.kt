package si.safeer.lina.samostojna

import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.IOException
import java.net.InetSocketAddress

class GeminiOdjemalecTest {
    class LazenPrenos : Prenos {
        var klici = 0
        var zadnjiUrl = ""
        var zadnjeGlave = mapOf<String, String>()
        
        var odgovori = mutableListOf<OdgovorHttp>()
        var izjema: Exception? = null

        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
            klici++
            zadnjiUrl = url
            zadnjeGlave = glave
            if (izjema != null) throw izjema!!
            if (odgovori.isNotEmpty()) {
                val odg = odgovori.removeAt(0)
                if (odgovori.isEmpty()) odgovori.add(odg) // obdrzi zadnjega
                return odg
            }
            return OdgovorHttp(200, """{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}""")
        }
    }

    @Test
    fun `uspesna zahteva`() {
        val shramba = PomnilniskiShranjevalnik()
        shramba.shrani(KljucGemini("moj-kljuc"))
        val prenos = LazenPrenos()
        val odjemalec = GeminiOdjemalec(shramba, prenos = prenos)

        val rez = odjemalec.poslji(listOf(Sporocilo("user", "hej")), "")
        assertTrue(rez is Rezultat.Besedilo)
        assertEquals("ok", (rez as Rezultat.Besedilo).besedilo)
        assertEquals(1, prenos.klici)
    }

    @Test
    fun `429 potem uspeh`() {
        val shramba = PomnilniskiShranjevalnik()
        shramba.shrani(KljucGemini("moj-kljuc"))
        val prenos = LazenPrenos()
        prenos.odgovori.add(OdgovorHttp(429, ""))
        prenos.odgovori.add(OdgovorHttp(200, """{"candidates":[{"content":{"parts":[{"text":"ok2"}]}}]}"""))
        
        var spanjeKlicano = 0
        val odjemalec = GeminiOdjemalec(shramba, prenos = prenos)
        odjemalec.spanje = { spanjeKlicano++ }

        val rez = odjemalec.poslji(emptyList(), "")
        assertTrue(rez is Rezultat.Besedilo)
        assertEquals(2, prenos.klici)
        assertEquals(1, spanjeKlicano)
    }

    @Test
    fun `429 trikrat - napaka`() {
        val shramba = PomnilniskiShranjevalnik()
        shramba.shrani(KljucGemini("moj-kljuc"))
        val prenos = LazenPrenos()
        prenos.odgovori.add(OdgovorHttp(429, ""))
        
        val odjemalec = GeminiOdjemalec(shramba, prenos = prenos)
        odjemalec.spanje = { }

        val rez = odjemalec.poslji(emptyList(), "")
        assertTrue(rez is Rezultat.Napaka)
        assertEquals(3, prenos.klici)
    }

    @Test
    fun `401 - brez ponovitve`() {
        val shramba = PomnilniskiShranjevalnik()
        shramba.shrani(KljucGemini("moj-kljuc"))
        val prenos = LazenPrenos()
        prenos.odgovori.add(OdgovorHttp(401, """{"error":{"code":401,"message":"Unauthorized"}}"""))
        
        val odjemalec = GeminiOdjemalec(shramba, prenos = prenos)
        
        val rez = odjemalec.poslji(emptyList(), "")
        assertTrue(rez is Rezultat.Napaka)
        assertEquals(401, (rez as Rezultat.Napaka).koda)
        assertEquals(1, prenos.klici)
    }

    @Test
    fun `timeout - brez povezave`() {
        val shramba = PomnilniskiShranjevalnik()
        shramba.shrani(KljucGemini("moj-kljuc"))
        val prenos = LazenPrenos()
        prenos.izjema = IOException("timeout")
        
        val odjemalec = GeminiOdjemalec(shramba, prenos = prenos)
        val rez = odjemalec.poslji(emptyList(), "")
        assertTrue(rez is Rezultat.Napaka)
        assertEquals("Brez povezave", (rez as Rezultat.Napaka).sporocilo)
        assertNull(rez.koda)
        assertFalse(rez.sporocilo.contains("moj-kljuc"))
    }

    @Test
    fun `brez kljuca`() {
        val shramba = PomnilniskiShranjevalnik()
        val prenos = LazenPrenos()
        val odjemalec = GeminiOdjemalec(shramba, prenos = prenos)
        
        val rez = odjemalec.poslji(emptyList(), "")
        assertTrue(rez is Rezultat.Napaka)
        assertEquals("Manjka kljuc", (rez as Rezultat.Napaka).sporocilo)
        assertEquals(0, prenos.klici)
    }

    @Test
    fun `glava x-goog-api-key prisotna in kljuc ni v URL`() {
        val shramba = PomnilniskiShranjevalnik()
        shramba.shrani(KljucGemini("tajni-kljuc-123"))
        val prenos = LazenPrenos()
        val odjemalec = GeminiOdjemalec(shramba, prenos = prenos)
        
        odjemalec.poslji(emptyList(), "")
        assertEquals("tajni-kljuc-123", prenos.zadnjeGlave["x-goog-api-key"])
        assertFalse(prenos.zadnjiUrl.contains("tajni-kljuc-123"))
    }
    
    @Test
    fun `prenos preko httpServer - uspeh in prevelik odgovor`() {
        val streznik = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var prejetaGlava = ""
        var urlPrejet = ""
        streznik.createContext("/") { exchange ->
            prejetaGlava = exchange.requestHeaders.getFirst("x-goog-api-key") ?: ""
            urlPrejet = exchange.requestURI.toString()
            
            val pot = exchange.requestURI.path
            val telo = if (pot.contains("veliko")) {
                "A".repeat(1024 * 1024 + 10)
            } else {
                """{"candidates":[{"content":{"parts":[{"text":"resnicno"}]}}]}"""
            }
            
            exchange.sendResponseHeaders(200, telo.toByteArray().size.toLong())
            exchange.responseBody.use { it.write(telo.toByteArray()) }
        }
        streznik.start()
        
        try {
            val vrata = streznik.address.port
            val osnNaslov = "http://127.0.0.1:$vrata"
            
            val shramba = PomnilniskiShranjevalnik()
            shramba.shrani(KljucGemini("pravi-kljuc"))
            val odjemalec = GeminiOdjemalec(shramba, osnovniNaslov = osnNaslov)
            
            val rez1 = odjemalec.poslji(emptyList(), "")
            assertTrue(rez1 is Rezultat.Besedilo)
            assertEquals("resnicno", (rez1 as Rezultat.Besedilo).besedilo)
            assertEquals("pravi-kljuc", prejetaGlava)
            assertFalse(urlPrejet.contains("pravi-kljuc"))
            
            val odjemalecVelik = GeminiOdjemalec(shramba, osnovniNaslov = "$osnNaslov/veliko")
            val rez2 = odjemalecVelik.poslji(emptyList(), "")
            assertTrue(rez2 is Rezultat.Napaka)
            assertEquals("Odgovor prevelik", (rez2 as Rezultat.Napaka).sporocilo)
        } finally {
            streznik.stop(0)
        }
    }
}
