package si.safeer.lina.samostojna.n8n

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import si.safeer.lina.samostojna.OdgovorHttp
import si.safeer.lina.samostojna.Prenos
import java.io.IOException

class N8nOdjemalecTest {

    class LazenPrenos : Prenos {
        var klici = 0
        var zadnjiUrl = ""
        var zadnjeGlave = mapOf<String, String>()
        var zadnjeTelo = ""
        var izjema: Exception? = null
        var odgovori = mutableListOf<OdgovorHttp>()

        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
            klici++
            zadnjiUrl = url
            zadnjeGlave = glave
            zadnjeTelo = telo
            if (izjema != null) throw izjema!!
            if (odgovori.isNotEmpty()) {
                val odg = odgovori.removeAt(0)
                if (odgovori.isEmpty()) odgovori.add(odg) // obdrži zadnjega
                return odg
            }
            return OdgovorHttp(200, "ok")
        }
    }

    @Test
    fun `uspesen klic in skrivnost v glavi`() {
        val prenos = LazenPrenos()
        val nastavitve = N8nNastavitve("https://moj.n8n.com/webhook", "super-skrivnost")
        val odjemalec = N8nOdjemalec(prenos, nastavitve).apply { spanje = {} }
        
        val izid = odjemalec.sprozi("test", mapOf("a" to "1"), true)
        
        assertTrue(izid is IzidN8n.Uspeh)
        assertEquals("ok", (izid as IzidN8n.Uspeh).odgovorKratek)
        assertEquals(1, prenos.klici)
        assertEquals("https://moj.n8n.com/webhook", prenos.zadnjiUrl)
        assertEquals("Bearer super-skrivnost", prenos.zadnjeGlave["Authorization"])
        assertTrue(prenos.zadnjeTelo.contains("test"))
        assertTrue(prenos.zadnjeTelo.contains("\"a\":\"1\""))
    }

    @Test
    fun `klic zavrnjen brez soglasja`() {
        val prenos = LazenPrenos()
        val nastavitve = N8nNastavitve("https://moj.n8n.com/webhook", "super-skrivnost")
        val odjemalec = N8nOdjemalec(prenos, nastavitve)
        
        val izid = odjemalec.sprozi("test", emptyMap(), false)
        
        assertTrue(izid is IzidN8n.Napaka)
        assertTrue((izid as IzidN8n.Napaka).razlog.contains("soglasje ni potrjeno"))
        assertEquals(0, prenos.klici)
    }

    @Test
    fun `sheme zavrnjene razen https in lokalnih`() {
        val prenos = LazenPrenos()
        
        val odjemalecFtp = N8nOdjemalec(prenos, N8nNastavitve("ftp://moj.n8n.com", null))
        val izidFtp = odjemalecFtp.sprozi("test", emptyMap(), true)
        assertTrue(izidFtp is IzidN8n.Napaka)
        assertTrue((izidFtp as IzidN8n.Napaka).razlog.contains("HTTPS ali HTTP v domačem"))
        
        val odjemalecHttpInternet = N8nOdjemalec(prenos, N8nNastavitve("http://moj.n8n.com", null))
        val izidHttp = odjemalecHttpInternet.sprozi("test", emptyMap(), true)
        assertTrue(izidHttp is IzidN8n.Napaka)
        assertTrue((izidHttp as IzidN8n.Napaka).razlog.contains("dovoljen samo v domačem omrežju"))
        
        // Lokalni naslovi
        val lokalniNaslovi = listOf(
            "http://localhost:5678",
            "http://127.0.0.1:5678",
            "http://192.168.1.10",
            "http://10.0.0.5",
            "http://172.16.0.1",
            "http://172.31.255.255",
            "http://moj-streznik.local"
        )
        
        lokalniNaslovi.forEach { naslov ->
            val p = LazenPrenos()
            val o = N8nOdjemalec(p, N8nNastavitve(naslov, null)).apply { spanje = {} }
            val izid = o.sprozi("test", emptyMap(), true)
            assertTrue(izid is IzidN8n.Uspeh, "Naslov naj bo dovoljen: $naslov")
            assertEquals(1, p.klici)
        }
    }

    @Test
    fun `imena, ki le zacnejo kot zasebni naslov, niso domace omrezje`() {
        listOf("http://192.168.evil.com", "http://10.evil.com", "http://172.16.evil.org", "http://172.32.0.1", "http://192.168.1", "http://127.0.0.1.evil.com").forEach { naslov ->
            val p = LazenPrenos()
            val izid = N8nOdjemalec(p, N8nNastavitve(naslov, "skrivnost")).sprozi("test", emptyMap(), true)
            assertTrue(izid is IzidN8n.Napaka, "Naslov mora biti zavrnjen: $naslov")
            assertEquals(0, p.klici, "Nic se ne sme poslati: $naslov")
        }
    }

    @Test
    fun `ob 503 ni samodejne ponovitve, ker dejanje ni idempotentno`() {
        val prenos = LazenPrenos().apply {
            odgovori.add(OdgovorHttp(503, "Napaka"))
            odgovori.add(OdgovorHttp(200, "Uspelo"))
        }
        val odjemalec = N8nOdjemalec(prenos, N8nNastavitve("https://moj.n8n.com", null)).apply { spanje = {} }

        val izid = odjemalec.sprozi("test", emptyMap(), true)

        assertTrue(izid is IzidN8n.Napaka)
        assertEquals(1, prenos.klici)
    }

    @Test
    fun `skrivnost ni v sporocilu napake`() {
        val prenos = LazenPrenos().apply {
            izjema = IOException("Povezava z moj.n8n.com z mojim-skrivnim-geslom je padla")
        }
        val nastavitve = N8nNastavitve("https://moj.n8n.com", "mojim-skrivnim-geslom")
        val odjemalec = N8nOdjemalec(prenos, nastavitve).apply { spanje = {} }
        
        val izid = odjemalec.sprozi("test", emptyMap(), true)
        
        assertTrue(izid is IzidN8n.Napaka)
        val razlog = (izid as IzidN8n.Napaka).razlog
        assertFalse(razlog.contains("mojim-skrivnim-geslom"))
        // Opomba: Zaradi preslikave napak v posljiZPonovitvami (vrne se "Brez povezave")
        // skrivnost itak ni vidna.
    }
}
