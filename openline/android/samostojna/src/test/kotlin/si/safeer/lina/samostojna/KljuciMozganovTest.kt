package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** NALOGA-35 na telefonu: skupni vektor z racunalnikom (kljuci-mozganov.ts), ovojnica, izmenjava treh naprav, dejanja vmesnika. */
class KljuciMozganovTest {
    // Vektor 26. 11. 2026: ustvaril ga je racunalnik (kljuci-mozganov.ts: noviParKljucev, kljucPara, zaZico, idSpora); preizkusni kljuci.
    private val vTelZasebni = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgQZBHtJTK8o0VWzpVsIQgg9AggR8QDECjZyMolK1sN1yhRANCAASjahLV4XS4DmsWpALN9zw94oLFTkMsph2yVsho/FxyMZnlK1nlYQxxOcAl4Bx6z+MX4MZozvUa/OfMhUcY5+x+"
    private val vRacJavni = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdw/S/xlzUnznvzdpI3NeF53dXoAwawYn/YNQ3aC5XB35xgzkQjdD0s0yQdzxQGzKjKy4sxQu6JTi3y/YmzMNnA=="
    private val vId = "n-0123456789abcdef"
    private val vKljuc = "5d641b1c783a6b4d1aa9662f1fd37b5fd617feb16eedb77cb3d356c7771f2a5a"
    private val vZapis = """{"id":"00112233445566aa","ponudnik":"gemini","oznaka":"Gemini dom","cas":1764100000000,"naprava":"r-aabbccddeeff0011","izbrisan":false,"prej":"1/n-0123456789abcdef","ovoj":{"v":1,"iv":"47DFSGkbhQrcqfVo","ct":"h13ezut98jOmOC5SxbSLWJDNbJpV","tag":"6fDp/jxBQltL7QtD/k7XzQ=="}}"""
    private val vVrednost = "AIzaVEKTOR-kljuc-1234"
    private val vIdSpora = "25f0c0143ef4dc89"

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test
    fun skupniVektorZRacunalnikom() {
        val k = KljuciMozganov.kljucPara(vTelZasebni, KljuciMozganov.javniKljuc(vRacJavni)!!, vId)
        assertEquals(vKljuc, hex(k))
        val z = KljuciMozganov.zZice(Json.parseToJsonElement(vZapis), k, KljuciMozganov.SMER_RT)
        assertEquals(vVrednost, z?.vrednost)
        assertEquals(vIdSpora, KljuciMozganov.idSpora(z!!))
        assertNull(KljuciMozganov.zZice(Json.parseToJsonElement(vZapis), k, KljuciMozganov.SMER_TR), "odboj v drugo smer")
        val spremenjen = Json.parseToJsonElement(vZapis.replace("\"cas\":1764100000000", "\"cas\":1764100000001"))
        assertNull(KljuciMozganov.zZice(spremenjen, k, KljuciMozganov.SMER_RT), "AAD veze cas")
    }

    @Test
    fun cistaVrednostAliDodatnoPoljeSeNeSprejme() {
        val k = ByteArray(32) { 7 }
        val z = ZapisKljuca("0123456789abcdef", "gemini", "x", 5, "n-a", false, "", vVrednost)
        val ovit = KljuciMozganov.zaZico(z, k, KljuciMozganov.SMER_TR)
        assertFalse(ovit.toString().contains(vVrednost))
        assertEquals(vVrednost, KljuciMozganov.zZice(ovit, k, KljuciMozganov.SMER_TR)?.vrednost)
        val cista = JsonObject(ovit + ("vrednost" to JsonPrimitive(vVrednost)))
        assertNull(KljuciMozganov.zZice(cista, k, KljuciMozganov.SMER_TR))
        val dodatno = JsonObject(ovit + ("naslov" to JsonPrimitive("https://x.invalid")))
        assertNull(KljuciMozganov.zZice(dodatno, k, KljuciMozganov.SMER_TR))
        assertNull(KljuciMozganov.zZice(ovit, ByteArray(32) { 8 }, KljuciMozganov.SMER_TR), "tuj par")
        assertFalse(z.toString().contains(vVrednost), "toString nikoli ne pokaze kljuca")
    }

    @Test
    fun samoDovoljeniPonudnikiInUraNajvec10MinNaprej() {
        val z = ZapisKljuca("0123456789abcdef", "gemini", "Moj", 5000, "n-a", false, "", vVrednost)
        assertTrue(KljuciMozganov.veljaven(z, 5000))
        for (p in listOf("vertex", "omniroute", "custom")) assertFalse(KljuciMozganov.veljaven(z.copy(ponudnik = p), 5000), p)
        assertFalse(KljuciMozganov.veljaven(z.copy(cas = 5000 + KljuciMozganov.NAJVEC_NAPREJ_MS + 1), 5000))
        assertFalse(KljuciMozganov.veljaven(z.copy(oznaka = "a\u202Eb"), 5000))
        assertFalse(KljuciMozganov.veljaven(z.copy(izbrisan = true), 5000), "grob brez vrednosti")
    }

    // ---- izmenjava: navidezen racunalnik (isti koraki kot korakRacunalnika v TS) in dva telefona ----

    private val K1 = "AIzaTESTkljuc-ena-1111"
    private val K2 = "AIzaTESTkljuc-dva-2222"
    private val K3 = "sk-TESTkljuc-tri-3333"

    private class Racunalnik {
        var par = KljuciMozganov.noviPar()
        var zapisi = listOf<ZapisKljuca>(); var aktivni = mapOf<String, String>(); var uvozeno = false
        val sloti = mutableMapOf<String, String>()
        val rele = ArrayList<String>()
        val jaz = "r-racunalnik"
        var zdaj = 1000L

        fun korak(prejeti: List<ZapisKljuca>) {
            val l = KljuciMozganov.lokalneSpremembe(zapisi, aktivni, sloti, jaz, zdaj, !uvozeno, SinhronKljucev::privzetaOznaka)
            val z = KljuciMozganov.zdruzi(l.zapisi, prejeti, zdaj, kopije = true)
            val u = KljuciMozganov.zaUporabo(z, l.aktivni, sloti)
            for ((p, v) in u.sloti) if (v == null) sloti.remove(p) else sloti[p] = v
            zapisi = z; aktivni = u.aktivni; uvozeno = true
        }

        fun zahteva(idTel: String, vsebina: String): String {
            rele.add(vsebina)
            val o = Json.parseToJsonElement(vsebina).jsonObject
            val javni = KljuciMozganov.javniKljuc((o["javni"] as JsonPrimitive).content)!!
            val k = KljuciMozganov.kljucPara(par.zasebni, javni, idTel)
            // isto pravilo kot odTelefona v kljuci-mozganov.ts: tuja naprava samo za id, ki ga racunalnik se nima
            val znani = zapisi.map { it.id }.toSet()
            korak((o["zapisi"] as JsonArray).mapNotNull { KljuciMozganov.zZice(it, k, KljuciMozganov.SMER_TR) }.filter { it.naprava == idTel || it.id !in znani })
            val odg = buildJsonObject {
                put("v", 1); put("naprava", jaz); put("javni", par.javni)
                put("zapisi", JsonArray(zapisi.map { KljuciMozganov.zaZico(it, k, KljuciMozganov.SMER_RT) }))
            }.toString()
            rele.add(odg)
            return odg
        }
    }

    private class Sloti : SlotiKljucev {
        val m = mutableMapOf<String, String>()
        private var obBranju: (() -> Unit)? = null
        private var branj = 0
        /** [f] se izvede tik pred drugim branjem slotov od zdaj (= po odgovoru racunalnika, med izmenjavo). */
        fun medIzmenjavo(f: () -> Unit) { obBranju = f; branj = 0 }
        override fun preberi(): Map<String, String> { if (++branj == 2) obBranju?.invoke()?.also { obBranju = null }; return m.toMap() }
        override fun zapisi(ponudnik: String, vrednost: String?) { if (vrednost == null) m.remove(ponudnik) else m[ponudnik] = vrednost }
    }

    private class Telefon(val id: String) {
        val shramba = ShrambaUskladitve(PomnilniskiShranjevalnik())
        val sloti = Sloti()
        fun sinhroniziraj(r: Racunalnik, zdaj: Long = r.zdaj) = SinhronKljucev.izmenjaj(shramba, sloti, id, { zdaj }) { r.zahteva(id, it) }
        fun nabor(): String = shramba.preberi()!!.stanje.zapisi.joinToString("\n") { "${it.id}|${it.ponudnik}|${it.oznaka}|${it.izbrisan}|${it.vrednost}" }
    }

    private fun Racunalnik.nabor() = zapisi.sortedBy { it.id }.joinToString("\n") { "${it.id}|${it.ponudnik}|${it.oznaka}|${it.izbrisan}|${it.vrednost}" }

    @Test
    fun kljucSTelefonaAImataRacunalnikInTelefonB() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa"); val b = Telefon("n-bbbbbbbbbbbbbbbb")
        assertTrue(a.sinhroniziraj(r)); assertTrue(b.sinhroniziraj(r))
        a.sloti.m["gemini"] = K1
        r.zdaj = 2000; assertTrue(a.sinhroniziraj(r))
        r.zdaj = 3000; assertTrue(b.sinhroniziraj(r))
        assertEquals(K1, r.sloti["gemini"]); assertEquals(K1, b.sloti.m["gemini"])
        assertEquals(r.nabor(), a.nabor()); assertEquals(r.nabor(), b.nabor())
        val vse = r.rele.joinToString("\n")
        assertTrue(vse.contains("\"ovoj\"")); assertFalse(vse.contains(K1), "kljuc na releju v cistem besedilu")
    }

    @Test
    fun odstranitevSePrenese() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa"); val b = Telefon("n-bbbbbbbbbbbbbbbb")
        r.sloti["openai"] = K3; r.korak(emptyList())
        a.sinhroniziraj(r); b.sinhroniziraj(r)
        assertEquals(K3, b.sloti.m["openai"])
        a.sloti.m.remove("openai")
        r.zdaj = 2000; a.sinhroniziraj(r)
        r.zdaj = 2100; b.sinhroniziraj(r)
        assertNull(r.sloti["openai"]); assertNull(b.sloti.m["openai"])
        assertEquals(listOf("openai"), SinhronKljucev.odstranjeni(b.shramba))
        assertTrue(SinhronKljucev.odstranjeni(a.shramba).isEmpty(), "lastna odstranitev ni obvestilo")
    }

    @Test
    fun sporDvehHkratnihSprememb() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa"); val b = Telefon("n-bbbbbbbbbbbbbbbb")
        r.sloti["gemini"] = K1; r.korak(emptyList())
        a.sinhroniziraj(r); b.sinhroniziraj(r)
        a.sloti.m["gemini"] = K2; b.sloti.m["gemini"] = K3
        a.sinhroniziraj(r, 2000); b.sinhroniziraj(r, 3000); a.sinhroniziraj(r, 3100)
        r.zdaj = 3200; r.korak(emptyList())
        assertEquals(K3, r.sloti["gemini"]); assertEquals(K3, a.sloti.m["gemini"])
        assertTrue(r.zapisi.any { it.oznaka.endsWith("(spor)") && it.vrednost == K2 }, "vrednost A se ne izgubi")
        assertEquals(r.nabor(), a.nabor()); assertEquals(r.nabor(), b.nabor())
    }

    @Test
    fun prehodIstiKljucEnZapisInObstojeciOstanejo() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        r.sloti["gemini"] = K1; r.korak(emptyList())
        a.sloti.m["gemini"] = K1; a.sloti.m["openai"] = K3
        a.sinhroniziraj(r, 2000)
        assertEquals(K1, a.sloti.m["gemini"]); assertEquals(K3, a.sloti.m["openai"]); assertEquals(K3, r.sloti["openai"])
        assertEquals(1, r.zapisi.count { it.ponudnik == "gemini" })
    }

    @Test
    fun kljucSpremenjenMedIzmenjavoSeNePrepise() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        r.sloti["gemini"] = K1; r.korak(emptyList())
        a.sinhroniziraj(r)
        r.sloti["gemini"] = K2; r.zdaj = 2000; r.korak(emptyList())
        a.sloti.medIzmenjavo { a.sloti.m["gemini"] = K3 }
        r.zdaj = 2100; a.sinhroniziraj(r, 2100)
        assertEquals(K3, a.sloti.m["gemini"]); assertEquals(K3, r.sloti["gemini"], "lastnikova sprememba gre naprej v naslednjem krogu")
    }

    @Test
    fun vmesnikDodajUporabiOdstrani() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        a.sinhroniziraj(r)
        assertNull(SinhronKljucev.dodaj(a.shramba, a.sloti, a.id, 2000, "gemini", "Gemini sluzba", K2))
        assertEquals(K1, a.sloti.m["gemini"], "drugi kljuc istega ponudnika ne zamenja kljuca v uporabi")
        val sez = SinhronKljucev.seznam(a.shramba, a.id)
        assertEquals(2, sez.size); assertTrue(sez.none { it.namig.contains(K2) || it.namig.length > 5 })
        val drugi = sez.first { it.oznaka == "Gemini sluzba" }
        assertNull(SinhronKljucev.uporabi(a.shramba, a.sloti, a.id, 2100, drugi.id))
        assertEquals(K2, a.sloti.m["gemini"])
        assertNull(SinhronKljucev.odstrani(a.shramba, a.sloti, a.id, 2200, drugi.id))
        assertNull(a.sloti.m["gemini"], "odstranjen kljuc v uporabi: brez samodejnega preklopa")
        r.zdaj = 2300; a.sinhroniziraj(r)
        assertEquals(1, r.zapisi.count { !it.izbrisan }); assertTrue(r.zapisi.any { it.id == drugi.id && it.izbrisan })
    }

    @Test
    fun dodajPredPrvoIzmenjavoNePrepiseObstojecegaKljuca() {
        val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        assertNull(SinhronKljucev.dodaj(a.shramba, a.sloti, a.id, 1000, "gemini", "Drugi", K2))
        assertEquals(K1, a.sloti.m["gemini"])
    }

    @Test
    fun shrambaPrezivisPonovnoBranje() {
        val s = ShrambaUskladitve(PomnilniskiShranjevalnik())
        val v = s.preberi()!!
        s.shrani(v.copy(stanje = StanjeKljucev(listOf(ZapisKljuca("0123456789abcdef", "grok", "Grok", 9, "n-a", false, "", K3)), mapOf("grok" to "0123456789abcdef"), true)))
        val p = s.preberi()!!
        assertEquals(K3, p.stanje.zapisi.single().vrednost); assertEquals(v.par, p.par)
    }

    // ---- slepi pregled 1 ----

    @Test
    fun t1DejanjeMedIzmenjavoSeNeIzgubi() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        a.sinhroniziraj(r)
        var nit: Thread? = null
        r.zdaj = 2000
        // med cakanjem na omrezje lastnik doda drugi kljuc (druga nit); ta mora pocakati konec izmenjave, ne pa izgubiti zapisa
        SinhronKljucev.izmenjaj(a.shramba, a.sloti, a.id, { 2000 }) { vsebina ->
            nit = Thread { SinhronKljucev.dodaj(a.shramba, a.sloti, a.id, 2000, "gemini", "Drugi", K2) }.also { it.start(); it.join(300) }
            r.zahteva(a.id, vsebina)
        }
        nit!!.join(5000)
        assertTrue(SinhronKljucev.seznam(a.shramba, a.id).any { it.oznaka == "Drugi" }, "dodan kljuc ostane")
    }

    @Test
    fun s1PoOdstranitviNiSamodejnegaPreklopa() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        a.sinhroniziraj(r)
        assertNull(SinhronKljucev.dodaj(a.shramba, a.sloti, a.id, 2000, "gemini", "Drugi", K2))
        val vUporabi = SinhronKljucev.seznam(a.shramba, a.id).first { it.vUporabi }
        assertNull(SinhronKljucev.odstrani(a.shramba, a.sloti, a.id, 2100, vUporabi.id))
        r.zdaj = 2200; a.sinhroniziraj(r); a.sinhroniziraj(r, 2300)
        assertNull(a.sloti.m["gemini"], "drugi kljuc istega ponudnika ne pride sam v uporabo")
    }

    @Test
    fun s2CasSpremembeJeCasUrejanjaTudiBrezPovezave() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sinhroniziraj(r)
        a.sloti.m["openai"] = K3
        assertFalse(SinhronKljucev.izmenjaj(a.shramba, a.sloti, a.id, { 1500 }) { null }, "brez povezave")
        r.zdaj = 9000; a.sinhroniziraj(r, 9000)
        assertEquals(1500L, r.zapisi.single { it.ponudnik == "openai" }.cas)
    }

    @Test
    fun s4NeberljivaShrambaNiPrviZagon() {
        var pisal = false
        val pokvarjen = object : ShranjevalnikKljuca {
            override fun preberi(): KljucGemini? = null
            override fun shrani(k: KljucGemini) { pisal = true } // brez izjeme: zapis bi prepisal neberljiv pravi zapis
            override fun izbrisi() = error("ne sme brisati")
        }
        val s = ShrambaUskladitve(pokvarjen) { true }
        assertNull(s.preberi())
        assertFalse(pisal, "neberljiv zapis se ne prepise z novim praznim stanjem")
        val sloti = Sloti().also { it.m["gemini"] = K1 }
        assertFalse(SinhronKljucev.izmenjaj(s, sloti, "n-aaaaaaaaaaaaaaaa", { 1000 }) { error("ne sme poslati") })
        assertEquals("napaka", SinhronKljucev.dodaj(s, sloti, "n-aaaaaaaaaaaaaaaa", 1000, "gemini", "x", K2))
        assertFalse(pisal)
    }

    @Test
    fun s4NeberljivSlotNiIzbris() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        a.sinhroniziraj(r)
        val neberljiv = object : SlotiKljucev {
            override fun preberi(): Map<String, String> = emptyMap()
            override fun neznani(): Set<String> = setOf("gemini")
            override fun zapisi(ponudnik: String, vrednost: String?) = error("ne sme pisati v neberljiv slot")
        }
        r.zdaj = 2000
        assertTrue(SinhronKljucev.izmenjaj(a.shramba, neberljiv, a.id, { 2000 }) { r.zahteva(a.id, it) })
        assertTrue(r.zapisi.single().let { !it.izbrisan && it.vrednost == K1 })
    }

    @Test
    fun n3UnicodePresledekKotRacunalnik() {
        assertFalse(KljuciMozganov.veljavnaVrednost("AIzaTEST\u00A0kljuc-1111"))
        assertFalse(KljuciMozganov.veljavnaVrednost("\uFEFFAIzaTESTkljuc-1111"))
        assertFalse(KljuciMozganov.veljavnaOznaka("\uFEFF"))
        assertTrue(KljuciMozganov.veljavnaVrednost(K1))
        assertFalse(KljuciMozganov.Par("zasebni-skrivnost", "javni").toString().contains("zasebni-skrivnost"))
    }

    // ---- slepi pregled 2 ----

    @Test
    fun novRacunalnikDobiVseKljuceTelefona() {
        val r1 = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        a.sinhroniziraj(r1)
        assertNull(SinhronKljucev.dodaj(a.shramba, a.sloti, a.id, 2000, "gemini", "Drugi", K2))
        r1.zdaj = 2100; a.sinhroniziraj(r1)
        val r2 = Racunalnik() // nov ali obnovljen racunalnik: prazen nabor, nov kljuc para
        r2.zdaj = 3000; assertTrue(a.sinhroniziraj(r2))
        assertEquals(2, SinhronKljucev.seznam(a.shramba, a.id).size, "telefon ne zavrze kljucev, ki jih racunalnik nima")
        assertEquals(setOf(K1, K2), r2.zapisi.filter { !it.izbrisan }.map { it.vrednost }.toSet())
        assertEquals(1, r2.zapisi.count { it.vrednost == K1 }, "aktivni kljuc ne dobi novega id")
    }

    @Test
    fun zamenjanKljucRacunalnikaNeZavrzeSpremembe() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa"); val b = Telefon("n-bbbbbbbbbbbbbbbb")
        r.sloti["gemini"] = K1; r.korak(emptyList())
        a.sinhroniziraj(r); b.sinhroniziraj(r)
        a.sloti.m["gemini"] = K2
        r.par = KljuciMozganov.noviPar() // racunalnik dobi nov kljuc para, A tega se ne ve
        b.sloti.m["gemini"] = K3
        r.zdaj = 3000; b.sinhroniziraj(r, 3000) // B: novejsa sprememba istega zapisa
        r.zdaj = 3100; a.sinhroniziraj(r, 2000) // A: starejsa (2000), poslana s starim kljucem
        assertTrue(r.zapisi.any { it.oznaka.endsWith("(spor)") && it.vrednost == K2 }, "sprememba A ni izgubljena")
    }

    // ---- svetovalec ----

    @Test
    fun neveljavenKljucVSlotuSeNePrepise() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        a.sinhroniziraj(r)
        a.sloti.m["gemini"] = "AIza s presledkom-1111"
        r.zdaj = 2000; a.sinhroniziraj(r, 2000)
        assertEquals("AIza s presledkom-1111", a.sloti.m["gemini"])
    }

    @Test
    fun dodajPoOdstranitviGreVUporabo() {
        val r = Racunalnik(); val a = Telefon("n-aaaaaaaaaaaaaaaa")
        a.sloti.m["gemini"] = K1
        a.sinhroniziraj(r)
        val v = SinhronKljucev.seznam(a.shramba, a.id).single()
        assertNull(SinhronKljucev.odstrani(a.shramba, a.sloti, a.id, 2000, v.id))
        assertNull(SinhronKljucev.dodaj(a.shramba, a.sloti, a.id, 2100, "gemini", "Nov", K2))
        assertEquals(K2, a.sloti.m["gemini"])
    }
}
