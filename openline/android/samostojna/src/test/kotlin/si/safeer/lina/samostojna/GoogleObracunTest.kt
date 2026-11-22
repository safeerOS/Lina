package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Lastnik 22. 11. 2026: telefon je izbral projekt AI Studio brez obracuna. Podatki izmisljeni. */
class GoogleObracunTest {
    class PoNaslovu(private val odg: (String) -> OdgovorHttp) : Prenos {
        val naslovi = mutableListOf<String>()
        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long) = odg(url).also { naslovi += url }
        override fun get(url: String, glave: Map<String, String>, casMs: Long) = odg(url).also { naslovi += url }
    }

    private val dva = """{"projects":[{"projectId":"gen-lang-client-0000000001","name":"Gemini API","lifecycleState":"ACTIVE"},{"projectId":"moj-projekt-12345","name":"Moj","lifecycleState":"ACTIVE"}]}"""
    private fun prenos(obracun: Map<String, String>) = PoNaslovu { url ->
        when {
            url == NASLOV_PROJEKTOV -> OdgovorHttp(200, dva)
            url.startsWith("https://cloudbilling.googleapis.com/") -> obracun.entries.firstOrNull { url.contains(it.key) }?.let { OdgovorHttp(200, it.value) } ?: OdgovorHttp(403, "{}")
            url.contains(":enable") -> OdgovorHttp(200, "{}")
            else -> OdgovorHttp(404, "{}")
        }
    }

    @Test
    fun `edini projekt z obracunom se izbere sam`() {
        val p = prenos(mapOf("gen-lang" to """{"billingEnabled":false}""", "moj-projekt" to """{"billingEnabled":true}"""))
        val r = poPrijaviGoogle("t", p, null)
        assertEquals("moj-projekt-12345", (r as PrijavaGoogle.Pripravljeno).projekt.id)
        assertTrue(p.naslovi.last().contains("moj-projekt-12345") && p.naslovi.last().endsWith(":enable"))
    }

    @Test
    fun `prej izbran projekt brez obracuna znova ponudi izbiro, z obracunom prvi`() {
        val p = prenos(mapOf("gen-lang" to """{"billingEnabled":false}""", "moj-projekt" to """{"billingEnabled":true}"""))
        val r = poPrijaviGoogle("t", p, "gen-lang-client-0000000001") as PrijavaGoogle.Izbira
        assertEquals(listOf("moj-projekt-12345" to true, "gen-lang-client-0000000001" to false), r.projekti.map { it.id to it.obracun })
        assertFalse(p.naslovi.any { it.endsWith(":enable") })
    }

    @Test
    fun `nedosegljiv Cloud Billing ne ustavi prijave`() {
        val r = poPrijaviGoogle("t", prenos(emptyMap()), null) as PrijavaGoogle.Izbira
        assertTrue(r.projekti.all { it.obracun == null })
        assertEquals("moj-projekt-12345", (poPrijaviGoogle("t", prenos(emptyMap()), "moj-projekt-12345") as PrijavaGoogle.Pripravljeno).projekt.id)
    }

    @Test
    fun `Vertex napako obracuna pove slovensko, brez dolgega naslova konzole`() {
        val telo = """{"error":{"code":403,"message":"This API method requires billing to be enabled. Please enable billing on project #gen-lang-client-0000000001 by visiting https://console.developers.google.com/billing/enable?project=gen-lang-client-0000000001 then retry.","status":"PERMISSION_DENIED"}}"""
        val o = VertexOdjemalec({ "tok" }, { "gen-lang-client-0000000001" }, prenos = PoNaslovu { OdgovorHttp(403, telo) }).apply { spanje = {} }
        val r = o.poslji(listOf(Sporocilo("user", "vreme")), "") as Rezultat.Napaka
        assertTrue(r.sporocilo.contains("obračunavanja") && !r.sporocilo.contains("https://"), r.sporocilo)
        assertThrows(IllegalArgumentException::class.java) { naslovObracuna("x/../evil") }
    }

    @Test
    fun `privzeti Vertex model je kot na racunalniku, ob 404 poskusi rezervnega`() {
        assertEquals("gemini-3-flash-preview", Ponudnik.VERTEX.model)
        val p = PoNaslovu { url ->
            if (url.contains("gemini-3-flash-preview")) OdgovorHttp(404, """{"error":{"code":404,"message":"Publisher model was not found or your project does not have access to it."}}""")
            else OdgovorHttp(200, """{"candidates":[{"content":{"parts":[{"text":"Dober dan"}]}}]}""")
        }
        val r = VertexOdjemalec({ "tok" }, { "moj-projekt-12345" }, prenos = p).apply { spanje = {} }.poslji(listOf(Sporocilo("user", "zivjo")), "")
        assertEquals("Dober dan", (r as Rezultat.Besedilo).besedilo)
        assertTrue(p.naslovi.last().contains("/models/gemini-2.5-flash:generateContent"))
    }
}
