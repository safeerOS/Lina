package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class GoogleOAuthTest {
    class Lazen(private val odg: List<OdgovorHttp>) : Prenos {
        val telesa = mutableListOf<String>()
        val glave = mutableListOf<Map<String, String>>()
        val naslovi = mutableListOf<String>()
        override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp {
            naslovi += url; this.glave += glave; telesa += telo
            return odg[minOf(telesa.size - 1, odg.size - 1)]
        }
    }

    @Test
    fun `izziv S256 ustreza vzorcu iz RFC 7636`() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", GoogleOAuth.izzivIzPreverjalnika("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test
    fun `naslov prijave je vgrajen Googlov, z izzivom in stanjem, brez preverjalnika`() {
        val z = GoogleOAuth.zacni()
        assertTrue(z.naslov.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"))
        assertTrue(z.naslov.contains("code_challenge=" + GoogleOAuth.izzivIzPreverjalnika(z.preverjalnik)))
        assertTrue(z.naslov.contains("state=" + z.stanje) && z.naslov.contains("code_challenge_method=S256"))
        assertFalse(z.naslov.contains(z.preverjalnik), "preverjalnik ne sme v naslov")
        assertTrue(z.preverjalnik.length in 43..128)
        assertNotEquals(z.preverjalnik, GoogleOAuth.zacni().preverjalnik)
    }

    private val shema = GoogleOAuth.SHEMA

    @Test
    fun `koda se sprejme samo z nasim stanjem, shemo in potjo`() {
        assertEquals("4/abc", GoogleOAuth.kodaIzPovezave("$shema:/oauth2redirect?state=S1&code=4%2Fabc&scope=x", "S1"))
        assertNull(GoogleOAuth.kodaIzPovezave("$shema:/oauth2redirect?state=TUJ&code=4%2Fabc", "S1"), "tuje stanje")
        assertNull(GoogleOAuth.kodaIzPovezave("$shema:/oauth2redirect?code=4%2Fabc", "S1"), "brez stanja")
        assertNull(GoogleOAuth.kodaIzPovezave("tuja.shema:/oauth2redirect?state=S1&code=c", "S1"), "tuja shema")
        assertNull(GoogleOAuth.kodaIzPovezave("$shema:/drugo?state=S1&code=c", "S1"), "druga pot")
        assertNull(GoogleOAuth.kodaIzPovezave("$shema:/oauth2redirect?state=S1&error=access_denied", "S1"), "napaka Googla")
    }

    @Test
    fun `zamenjava kode poslje obrazec brez skrivnosti in razbere zetona`() {
        val p = Lazen(listOf(OdgovorHttp(200, """{"access_token":"ya29.a","refresh_token":"1//r","expires_in":3599}""")))
        val z = GoogleOAuth.zamenjajKodo(p, "4/abc", "prev")!!
        assertEquals("ya29.a", z.dostop); assertEquals("1//r", z.osvezitveni); assertEquals(3599, z.potecePoS)
        assertEquals("https://oauth2.googleapis.com/token", p.naslovi[0])
        assertEquals("application/x-www-form-urlencoded", p.glave[0]["Content-Type"])
        assertTrue(p.telesa[0].contains("code_verifier=prev") && p.telesa[0].contains("grant_type=authorization_code"))
        assertFalse(p.telesa[0].contains("client_secret"))
    }

    @Test
    fun `zavrnjena zamenjava ali neveljaven odgovor da null`() {
        assertNull(GoogleOAuth.zamenjajKodo(Lazen(listOf(OdgovorHttp(400, """{"error":"invalid_grant"}"""))), "c", "p"))
        assertNull(GoogleOAuth.zamenjajKodo(Lazen(listOf(OdgovorHttp(200, "ni json"))), "c", "p"))
        assertNull(GoogleOAuth.zamenjajKodo(Lazen(listOf(OdgovorHttp(200, """{"expires_in":5}"""))), "c", "p"))
    }

    @Test
    fun `osvezevalnik hrani zeton, osvezi pred iztekom in po preklicu zahteva novo prijavo`() {
        var cas = 1_000_000L
        val shramba = PomnilniskiShranjevalnik()
        val p = Lazen(listOf(OdgovorHttp(200, """{"access_token":"ya29.nov","expires_in":3600}"""), OdgovorHttp(400, """{"error":"invalid_grant"}""")))
        val o = GoogleZetonOsvezevalnik(shramba, p) { cas }
        assertNull(o.zeton(), "brez prijave ni zetona")
        assertFalse(o.prijavljen())
        o.nastavi(GoogleOAuth.Zetona("ya29.star", "1//r", 3600))
        assertTrue(o.prijavljen())
        assertEquals("ya29.star", o.zeton()); assertEquals(0, p.telesa.size, "veljaven zeton se ne osvezuje")
        cas += 3_600_000L - 30_000L // manj kot 60 s do izteka
        assertEquals("ya29.nov", o.zeton()); assertTrue(p.telesa[0].contains("refresh_token=1%2F%2Fr"))
        assertEquals("1//r", shramba.preberi()!!.izpostavi(), "osvezitveni ostane, ce ga Google ne zamenja")
        cas += 4_000_000L
        assertNull(o.zeton(), "preklican osvezitveni: nova prijava")
    }

    @Test
    fun `odjava izbrise osvezitveni zeton`() {
        val shramba = PomnilniskiShranjevalnik()
        val o = GoogleZetonOsvezevalnik(shramba, Lazen(listOf(OdgovorHttp(200, "{}"))))
        o.nastavi(GoogleOAuth.Zetona("a", "r", 60)); o.odjava()
        assertNull(shramba.preberi()); assertNull(o.zeton())
    }

    @Test
    fun `brez povezave osvezevalnik ne odjavi uporabnika`() {
        val shramba = PomnilniskiShranjevalnik()
        val p = object : Prenos {
            override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp = throw java.io.IOException("brez omrezja")
        }
        var cas = 0L
        val o = GoogleZetonOsvezevalnik(shramba, p) { cas }
        o.nastavi(GoogleOAuth.Zetona("a", "r", 60))
        cas += 10_000_000L
        assertThrows(java.io.IOException::class.java) { o.zeton() }
        assertTrue(o.prijavljen(), "osvezitveni zeton ostane")
        val v = VertexOdjemalec(o, { "my-first-project-12345" }, prenos = p).poslji(emptyList(), "")
        assertEquals("Brez povezave", (v as Rezultat.Napaka).sporocilo)
    }
}
