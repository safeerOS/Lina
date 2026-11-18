package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class GoogleCloudTest {
    class Lazen(private val odg: List<OdgovorHttp>) : Prenos {
        val naslovi = mutableListOf<String>()
        var glave = mapOf<String, String>()
        var telo = ""
        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
            naslovi += url; this.glave = glave; this.telo = telo
            return odg[minOf(naslovi.size - 1, odg.size - 1)]
        }
        override fun get(url: String, glave: Map<String, String>, casMs: Long): OdgovorHttp {
            naslovi += url; this.glave = glave
            return odg[minOf(naslovi.size - 1, odg.size - 1)]
        }
    }

    private val en = """{"projects":[{"projectId":"my-first-project-12345","name":"My First Project","lifecycleState":"ACTIVE"}]}"""
    private val dva = """{"projects":[{"projectId":"b-projekt-2222","name":"B","lifecycleState":"ACTIVE"},{"projectId":"a-projekt-1111","name":"A","lifecycleState":"ACTIVE"}]}"""

    @Test
    fun `en sam projekt se izbere sam in Vertex se vklopi brez vprasanja`() {
        val p = Lazen(listOf(OdgovorHttp(200, en), OdgovorHttp(200, "{}")))
        val r = poPrijaviGoogle("tok", p, null)
        assertEquals("my-first-project-12345", (r as PrijavaGoogle.Pripravljeno).projekt.id)
        assertEquals("https://serviceusage.googleapis.com/v1/projects/my-first-project-12345/services/aiplatform.googleapis.com:enable", p.naslovi[1])
        assertEquals("Bearer tok", p.glave["Authorization"])
    }

    @Test
    fun `vec projektov - uporabnik izbere, seznam je po imenu, aplikacija ne ugiba`() {
        val r = poPrijaviGoogle("tok", Lazen(listOf(OdgovorHttp(200, dva))), null)
        assertEquals(listOf("a-projekt-1111", "b-projekt-2222"), (r as PrijavaGoogle.Izbira).projekti.map { it.id })
    }

    @Test
    fun `ze izbran projekt se ob novi prijavi ohrani`() {
        val p = Lazen(listOf(OdgovorHttp(200, dva), OdgovorHttp(200, "{}")))
        val r = poPrijaviGoogle("tok", p, "b-projekt-2222")
        assertEquals("b-projekt-2222", (r as PrijavaGoogle.Pripravljeno).projekt.id)
    }

    @Test
    fun `projekt z ID, ki bi spremenil pot, se izpusti, naslov za vklop ga zavrne`() {
        val napad = """{"projects":[{"projectId":"x/../../evil","name":"x","lifecycleState":"ACTIVE"},{"projectId":"dober-projekt-1","name":"d","lifecycleState":"ACTIVE"},{"projectId":"izbrisan-proj-1","name":"i","lifecycleState":"DELETE_REQUESTED"}]}"""
        assertEquals(listOf("dober-projekt-1"), projektiIzOdgovora(napad).map { it.id })
        assertThrows(IllegalArgumentException::class.java) { naslovOmogociVertex("x/../../evil") }
    }

    @Test
    fun `brez projekta in brez obracuna je napaka v besedah, ne tihi neuspeh`() {
        assertTrue(poPrijaviGoogle("t", Lazen(listOf(OdgovorHttp(200, "{}"))), null) is PrijavaGoogle.Napaka)
        val r = poPrijaviGoogle("t", Lazen(listOf(OdgovorHttp(200, en), OdgovorHttp(403, "{}"))), null)
        assertTrue((r as PrijavaGoogle.Napaka).sporocilo.contains("obracuna"))
    }

    @Test
    fun `Vertex poslje zeton samo v glavi na aiplatform in ne v telo`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"candidates":[{"content":{"parts":[{"text":"zivjo"}]}}]}""")))
        val r = VertexOdjemalec({ "ya29.tajni" }, { "my-first-project-12345" }, prenos = p).poslji(listOf(Sporocilo("user", "a")), "nav")
        assertEquals("zivjo", (r as Rezultat.Besedilo).besedilo)
        assertEquals("https://aiplatform.googleapis.com/v1/projects/my-first-project-12345/locations/global/publishers/google/models/gemini-2.5-flash:generateContent", p.naslovi[0])
        assertEquals("Bearer ya29.tajni", p.glave["Authorization"])
        assertFalse(p.telo.contains("ya29.tajni"))
    }

    @Test
    fun `Vertex brez zetona ali z neveljavnim projektom ne poslje nicesar`() {
        val p = Lazen(listOf(OdgovorHttp(200, "{}")))
        assertTrue(VertexOdjemalec({ null }, { "my-first-project-12345" }, prenos = p).poslji(emptyList(), "") is Rezultat.Napaka)
        assertTrue(VertexOdjemalec({ "t" }, { "../evil" }, prenos = p).poslji(emptyList(), "") is Rezultat.Napaka)
        assertTrue(VertexOdjemalec({ "t" }, { null }, prenos = p).poslji(emptyList(), "") is Rezultat.Napaka)
        assertEquals(0, p.naslovi.size)
    }
}
