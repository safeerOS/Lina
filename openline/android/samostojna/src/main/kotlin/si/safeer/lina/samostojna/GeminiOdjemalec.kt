package si.safeer.lina.samostojna

import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.time.Duration

class OdgovorHttp(val koda: Int, val telo: String)

interface Prenos {
    fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp

    /** GET za branje (seznam projektov); privzeto ni podprt, da stari preizkusni prenosi ostanejo veljavni. */
    fun get(url: String, glave: Map<String, String>, casMs: Long): OdgovorHttp = throw UnsupportedOperationException("get")
}

class JavaHttpPrenos : Prenos {
    private val odjemalec = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
        val zahtevaGraditelj = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(30))
            .POST(HttpRequest.BodyPublishers.ofString(telo))
        // Glava iz klicatelja (npr. obrazec pri zetonu Google) ima prednost pred privzetim JSON.
        if (glave.keys.none { it.equals("Content-Type", ignoreCase = true) }) zahtevaGraditelj.header("Content-Type", "application/json")
        glave.forEach { (k, v) -> zahtevaGraditelj.header(k, v) }

        val zahteva = zahtevaGraditelj.build()
        val odgovor = odjemalec.send(zahteva, HttpResponse.BodyHandlers.ofString())
        return OdgovorHttp(odgovor.statusCode(), odgovor.body())
    }

    override fun get(url: String, glave: Map<String, String>, casMs: Long): OdgovorHttp {
        val g = HttpRequest.newBuilder().uri(URI.create(url)).timeout(Duration.ofMillis(casMs)).GET()
        glave.forEach { (k, v) -> g.header(k, v) }
        val odgovor = odjemalec.send(g.build(), HttpResponse.BodyHandlers.ofString())
        return OdgovorHttp(odgovor.statusCode(), odgovor.body())
    }
}

/** Skupni vmesnik ponudnikov (Gemini, OpenAI, Claude, Grok): asistentka ne ve, kdo odgovarja. */
interface PonudnikOdjemalec {
    fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat
}

class GeminiOdjemalec(
    private val shramba: ShranjevalnikKljuca,
    private val osnovniNaslov: String = "https://generativelanguage.googleapis.com",
    private val model: String = "gemini-2.5-flash",
    private val prenos: Prenos = JavaHttpPrenos()
) : PonudnikOdjemalec {
    var spanje: (Long) -> Unit = { Thread.sleep(it) }

    override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
        val kljuc = shramba.preberi() ?: return Rezultat.Napaka(null, "Manjka kljuc")
        
        val url = "${osnovniNaslov.trimEnd('/')}/v1beta/models/$model:generateContent"
        val glave = mapOf("x-goog-api-key" to kljuc.izpostavi())
        val telo = gradiTelo(zgodovina, sistemsko)

        var poskusi = 0
        val maxPoskusov = 3
        var odlogMs = 500L

        while (poskusi < maxPoskusov) {
            val odgovor = try {
                prenos.post(url, glave, telo, 30000L)
            } catch (e: IOException) {
                return Rezultat.Napaka(null, "Brez povezave")
            } catch (e: InterruptedException) {
                return Rezultat.Napaka(null, "Brez povezave")
            } catch (e: HttpTimeoutException) {
                return Rezultat.Napaka(null, "Brez povezave")
            }

            if (odgovor.telo.length > 1024 * 1024) {
                return Rezultat.Napaka(null, "Odgovor prevelik")
            }

            if (odgovor.koda == 200) {
                return razberiOdgovor(odgovor.telo)
            } else if (odgovor.koda == 429 || odgovor.koda >= 500) {
                poskusi++
                if (poskusi >= maxPoskusov) {
                    return razberiOdgovor(odgovor.telo)
                }
                spanje(odlogMs)
                odlogMs += 1000L // 500 -> 1500
            } else {
                return razberiOdgovor(odgovor.telo)
            }
        }
        
        return Rezultat.Napaka(null, "Neznana napaka")
    }
}
