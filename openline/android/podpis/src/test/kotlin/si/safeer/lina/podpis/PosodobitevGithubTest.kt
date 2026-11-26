package si.safeer.lina.podpis

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Naloga 28 (lastnik 26. 11. 2026): Lina na telefonu sama preveri izdajo na GitHubu, prenese APK + SHA256SUMS + SHA256SUMS.sig,
 * preveri podpis Ed25519 z ISTIM kljucem kot racunalnik, vsoto APK in sele nato preda paket namestitvi. Brez omrezja: lazen Http.
 */
class PosodobitevGithubTest {
    private val sha = { b: ByteArray -> MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) } }

    /** Preizkusni kljuc (JDK Ed25519); pravi zasebni kljuc je samo v okolju GitHub. */
    private val par = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val javni = par.public.encoded
    private fun podpisi(b: ByteArray): ByteArray = Signature.getInstance("Ed25519").run { initSign(par.private); update(b); sign() }

    private val apk = ByteArray(5000) { (it * 7).toByte() }
    private val ime = "lina-android_0.2.15_215.apk"
    private val vsote = "${sha(apk)}  $ime\n${"1".repeat(64)}  lina-lupina_0.2.15_amd64.deb\n".toByteArray()

    private fun izdajaJson(tag: String = "v0.2.15", sredstva: List<String> = listOf(ime, "SHA256SUMS", "SHA256SUMS.sig", "lina-lupina_0.2.15_amd64.deb"), body: String = "Novo") =
        """{"tag_name":"$tag","body":${Json.encodeToString(kotlinx.serialization.json.JsonPrimitive.serializer(), kotlinx.serialization.json.JsonPrimitive(body))},"assets":[${sredstva.joinToString(",") { "{\"name\":\"$it\"}" }}]}"""

    /** Lazen GitHub: naslov -> (status, glave, telo). Zapise vsak klic. */
    private class LaznHttp(val odgovori: MutableMap<String, MutableList<Triple<Int, Map<String, String>, ByteArray?>>>) : PosodobitevGithub.Http {
        val klici = mutableListOf<Pair<String, Map<String, String>>>()
        override fun get(url: String, glave: Map<String, String>): PosodobitevGithub.OdgovorHttp {
            klici += url to glave
            val vrsta = odgovori[url] ?: error("nepricakovan naslov $url")
            val (s, g, t) = if (vrsta.size > 1) vrsta.removeAt(0) else vrsta[0]
            return PosodobitevGithub.OdgovorHttp(s, g, t?.let { ByteArrayInputStream(it) })
        }
    }

    private val osnova = "https://github.com/safeerOS/Lina/releases/download/v0.2.15/"
    private fun github(podpis: ByteArray = podpisi(vsote), apkTelo: ByteArray = apk, vsoteTelo: ByteArray = vsote) = LaznHttp(
        mutableMapOf(
            PosodobitevGithub.API to mutableListOf(Triple(200, mapOf("etag" to "\"e1\""), izdajaJson().toByteArray())),
            osnova + "SHA256SUMS" to mutableListOf(Triple(302, mapOf("location" to "https://release-assets.githubusercontent.com/a/vsote"), null)),
            "https://release-assets.githubusercontent.com/a/vsote" to mutableListOf(Triple(200, emptyMap(), vsoteTelo)),
            osnova + "SHA256SUMS.sig" to mutableListOf(Triple(200, emptyMap(), podpis)),
            osnova + ime to mutableListOf(Triple(302, mapOf("location" to "https://release-assets.githubusercontent.com/a/apk"), null)),
            "https://release-assets.githubusercontent.com/a/apk" to mutableListOf(Triple(200, mapOf("content-length" to apkTelo.size.toString()), apkTelo)),
        ),
    )

    @Test fun `vgrajeni kljuc je isti kot na racunalniku (odtis DER)`() {
        assertEquals("a3ae3bcb5b6de559199ee5212bf04d9b25c9e45ea499b635f7869821971a0b56", sha(PosodobitevGithub.javniKljuc()))
    }

    @Test fun `skupni vektor podpisa velja (isti kot v preizkusu racunalnika), spremenjen bajt ne`() {
        val v = Json.parseToJsonElement(File("../skupni-vektorji/vektorji-posodobitev-v1.json").readText()).jsonObject
        val b = { k: String -> Base64.getDecoder().decode(v[k]!!.jsonPrimitive.content) }
        assertTrue(PosodobitevGithub.podpisVeljaven(b("vsebinaB64"), b("podpisB64"), b("javniSpkiB64")))
        val spremenjeno = b("vsebinaB64").also { it[3] = (it[3] + 1).toByte() }
        assertFalse(PosodobitevGithub.podpisVeljaven(spremenjeno, b("podpisB64"), b("javniSpkiB64")))
        assertFalse(PosodobitevGithub.podpisVeljaven(b("vsebinaB64"), b("podpisB64"), PosodobitevGithub.javniKljuc()), "tuj kljuc")
        assertFalse(PosodobitevGithub.podpisVeljaven(b("vsebinaB64"), b("podpisB64").copyOf(63), b("javniSpkiB64")), "kratek podpis")
    }

    @Test fun `izdaja z APK, vsotami in podpisom je kandidat, brez katerega koli ni`() {
        val i = assertNotNull(PosodobitevGithub.razcleniIzdajo(izdajaJson(body = "Kaj je novega\r\n\u202Eskrito")))
        assertEquals("0.2.15", i.razlicica)
        assertEquals(215L, i.versionCode)
        assertEquals(osnova + ime, i.urlApk)
        assertEquals(osnova + "SHA256SUMS.sig", i.urlPodpisa)
        assertEquals("Kaj je novega\nskrito", i.opombe)
        assertNull(PosodobitevGithub.razcleniIzdajo(izdajaJson(sredstva = listOf(ime, "SHA256SUMS"))), "brez podpisa")
        assertNull(PosodobitevGithub.razcleniIzdajo(izdajaJson(sredstva = listOf("SHA256SUMS", "SHA256SUMS.sig", "lina-lupina_0.2.15_amd64.deb"))), "samo racunalnik")
        assertNull(PosodobitevGithub.razcleniIzdajo(izdajaJson(tag = "v0.2.15/../../x")), "oznaka s potjo")
        assertNull(PosodobitevGithub.razcleniIzdajo(izdajaJson(sredstva = listOf("lina-android_0.2.15_215.apk.exe", "SHA256SUMS", "SHA256SUMS.sig"))))
        assertNull(PosodobitevGithub.razcleniIzdajo("ni json"))
        assertNull(PosodobitevGithub.razcleniIzdajo("[]"))
    }

    @Test fun `opombe so golo besedilo brez nevidnih znakov in omejene`() {
        assertEquals("abcd", PosodobitevGithub.ocistiOpombe("a\u200Bb\u0007c\uFEFFd"))
        assertEquals("a\n\nb", PosodobitevGithub.ocistiOpombe("a\n\n\n\nb"))
        val d = PosodobitevGithub.ocistiOpombe("x".repeat(10_000))
        assertTrue(d.length <= PosodobitevGithub.NAJVEC_OPOMB && d.endsWith("…"))
        assertEquals("", PosodobitevGithub.ocistiOpombe(null))
    }

    @Test fun `dovoljeni so samo https gostitelji GitHuba brez uporabnika in vrat`() {
        assertTrue(PosodobitevGithub.dovoljenNaslov("https://api.github.com/repos/safeerOS/Lina/releases/latest"))
        assertTrue(PosodobitevGithub.dovoljenNaslov("https://release-assets.githubusercontent.com/x"))
        assertTrue(PosodobitevGithub.dovoljenNaslov("https://objects.githubusercontent.com/x"))
        assertFalse(PosodobitevGithub.dovoljenNaslov("http://github.com/x"))
        assertFalse(PosodobitevGithub.dovoljenNaslov("https://evil.example/x"))
        assertFalse(PosodobitevGithub.dovoljenNaslov("https://github.com.evil.example/x"))
        assertFalse(PosodobitevGithub.dovoljenNaslov("https://u:p@github.com/x"))
        assertFalse(PosodobitevGithub.dovoljenNaslov("https://github.com:8443/x"))
        assertFalse(PosodobitevGithub.dovoljenNaslov("ni naslov"))
    }

    @Test fun `preverba - novejsa izdaja, ETag, 304, odmik po napakah`() {
        val h = LaznHttp(
            mutableMapOf(
                PosodobitevGithub.API to mutableListOf(
                    Triple(200, mapOf("etag" to "W/\"abc\""), izdajaJson().toByteArray()),
                    Triple(304, emptyMap(), null),
                    Triple(403, emptyMap(), "rate".toByteArray()),
                    Triple(429, emptyMap(), null),
                    Triple(200, emptyMap(), izdajaJson().toByteArray()),
                ),
            ),
        )
        var s = PosodobitevGithub.StanjePreverbe()
        s = PosodobitevGithub.preveri(h, s, namesceniCode = 214, zdaj = 1000)
        assertEquals("0.2.15", s.izdaja?.razlicica)
        assertEquals(0, s.napak)
        assertEquals(1000 + PosodobitevGithub.OBDOBJE_MS, s.naslednjaMs)
        assertNull(h.klici[0].second["If-None-Match"])
        s = PosodobitevGithub.preveri(h, s, 214, 2000)
        assertEquals("W/\"abc\"", h.klici[1].second["If-None-Match"])
        assertEquals("0.2.15", s.izdaja?.razlicica, "304 obdrzi znano izdajo")
        s = PosodobitevGithub.preveri(h, s, 214, 3000)
        assertEquals(1, s.napak)
        assertEquals(3000 + 2 * PosodobitevGithub.OBDOBJE_MS, s.naslednjaMs, "po napaki ne prej kot odmik")
        assertEquals("0.2.15", s.izdaja?.razlicica, "napaka ne pozabi najdene izdaje")
        s = PosodobitevGithub.preveri(h, s, 214, 4000)
        assertEquals(2, s.napak)
        assertEquals(4000 + 4 * PosodobitevGithub.OBDOBJE_MS, s.naslednjaMs)
        s = PosodobitevGithub.preveri(h, s, 215, 5000)
        assertEquals(0, s.napak)
        assertNull(s.izdaja, "enaka versionCode ni posodobitev")
    }

    @Test fun `stanje preverbe prezivi zapis in branje (SharedPreferences), pokvarjen zapis da privzeto`() {
        val s = PosodobitevGithub.preveri(github(), PosodobitevGithub.StanjePreverbe(), 214, 7).copy(obvescenaCode = 215)
        assertEquals(s, PosodobitevGithub.StanjePreverbe.izNiza(s.vNiz()))
        assertEquals(PosodobitevGithub.StanjePreverbe(), PosodobitevGithub.StanjePreverbe.izNiza("{pokvarjeno"))
        assertEquals(PosodobitevGithub.StanjePreverbe(), PosodobitevGithub.StanjePreverbe.izNiza(null))
    }

    @Test fun `priprava - podpis, vsota in prenos prek dovoljene preusmeritve da preverjen APK`() {
        val mapa = Files.createTempDirectory("lina-pos").toFile()
        val i = assertNotNull(PosodobitevGithub.razcleniIzdajo(izdajaJson()))
        val izid = PosodobitevGithub.pripravi(github(), i, mapa, "a".repeat(16), javni)
        val ok = izid as PosodobitevGithub.IzidPriprave.Ok
        assertTrue(ok.datoteka.readBytes().contentEquals(apk))
        assertEquals(215L, ok.versionCode)
        assertEquals(mapa.canonicalPath, ok.datoteka.parentFile.canonicalPath)
    }

    @Test fun `priprava - tuj podpis zavrne PRED prenosom APK`() {
        val mapa = Files.createTempDirectory("lina-pos").toFile()
        val h = github(podpis = ByteArray(64))
        val izid = PosodobitevGithub.pripravi(h, PosodobitevGithub.razcleniIzdajo(izdajaJson())!!, mapa, "a".repeat(16), javni)
        assertEquals(PosodobitevGithub.RazlogPosodobitve.PODPIS, (izid as PosodobitevGithub.IzidPriprave.Zavrnjeno).razlog)
        assertTrue(h.klici.none { it.first.endsWith(".apk") || it.first.endsWith("/apk") }, "APK se ne prenese")
        assertEquals(0, mapa.listFiles()!!.size)
    }

    @Test fun `priprava - druga vsota ali APK ni v SHA256SUMS - zavrnjeno in datoteka pobrisana`() {
        val mapa = Files.createTempDirectory("lina-pos").toFile()
        val i = PosodobitevGithub.razcleniIzdajo(izdajaJson())!!
        val drug = apk.copyOf().also { it[0] = 99 }
        val z1 = PosodobitevGithub.pripravi(github(apkTelo = drug), i, mapa, "a".repeat(16), javni)
        assertEquals(PosodobitevGithub.RazlogPosodobitve.VSOTA, (z1 as PosodobitevGithub.IzidPriprave.Zavrnjeno).razlog)
        val brez = "${"2".repeat(64)}  drugo.apk\n".toByteArray()
        val z2 = PosodobitevGithub.pripravi(github(vsoteTelo = brez, podpis = podpisi(brez)), i, mapa, "b".repeat(16), javni)
        assertEquals(PosodobitevGithub.RazlogPosodobitve.VSOTA, (z2 as PosodobitevGithub.IzidPriprave.Zavrnjeno).razlog)
        assertEquals(0, mapa.listFiles()!!.size, "zavrnjena kopija ne ostane")
    }

    @Test fun `prenos - preusmeritev na tujega gostitelja ali http je zavrnjena, prevelik APK tudi`() {
        val mapa = Files.createTempDirectory("lina-pos").toFile()
        val i = PosodobitevGithub.razcleniIzdajo(izdajaJson())!!
        val h = github()
        h.odgovori[osnova + ime] = mutableListOf(Triple(302, mapOf("location" to "https://evil.example/apk"), null))
        val z = PosodobitevGithub.pripravi(h, i, mapa, "a".repeat(16), javni)
        assertEquals(PosodobitevGithub.RazlogPosodobitve.PRENOS, (z as PosodobitevGithub.IzidPriprave.Zavrnjeno).razlog)
        assertTrue(h.klici.none { it.first.startsWith("https://evil.example") }, "tuj gostitelj ni bil nikoli poklican")
        val h2 = github()
        h2.odgovori[osnova + "SHA256SUMS"] = mutableListOf(Triple(302, mapOf("location" to "http://release-assets.githubusercontent.com/a/vsote"), null))
        assertEquals(PosodobitevGithub.RazlogPosodobitve.PRENOS, (PosodobitevGithub.pripravi(h2, i, mapa, "a".repeat(16), javni) as PosodobitevGithub.IzidPriprave.Zavrnjeno).razlog)
        assertNull(runCatching { PosodobitevGithub.prenesi(github(), osnova + ime, File(mapa, "x.apk"), 100) }.getOrNull(), "vec kot meja")
        assertFalse(File(mapa, "x.apk").exists(), "prevelik prenos ne ostane")
    }

    @Test fun `arhiv mora imeti versionCode izdaje in vecjo od namescene`() {
        assertNull(PosodobitevGithub.preveriRazlicico(arhiv = 215, izdaja = 215, namescena = 214))
        assertEquals(PosodobitevGithub.RazlogPosodobitve.RAZLICICA, PosodobitevGithub.preveriRazlicico(arhiv = 214, izdaja = 215, namescena = 214))
        assertEquals(PosodobitevGithub.RazlogPosodobitve.RAZLICICA, PosodobitevGithub.preveriRazlicico(arhiv = 216, izdaja = 215, namescena = 214))
        assertEquals(PosodobitevGithub.RazlogPosodobitve.RAZLICICA, PosodobitevGithub.preveriRazlicico(arhiv = 214, izdaja = 214, namescena = 214))
        assertEquals(PosodobitevGithub.RazlogPosodobitve.RAZLICICA, PosodobitevGithub.preveriRazlicico(arhiv = null, izdaja = 215, namescena = 214))
    }
}
