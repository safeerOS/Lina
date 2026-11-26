package si.safeer.lina.podpis

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.Base64
import javax.net.ssl.HttpsURLConnection

/**
 * Posodobitev Line na telefonu neposredno z GitHuba (naloga 28, lastnik 26. 11. 2026: »ko objavimo update za Lino, da obvestilo
 * uporabniku in da uporabnik klikne le Posodobi ... nastavitve in kljuci pa ostanejo«). Deluje brez racunalnika.
 * Cista logika (preizkusi v PosodobitevGithubTest); app samo nacrtuje preverbo, pokaze obvestilo in odpre sejo PackageInstallerja.
 * Vse z GitHuba je NEZAUPANO. Vrstni red: SHA256SUMS + SHA256SUMS.sig -> podpis Ed25519 z ISTIM kljucem kot racunalnik
 * (JAVNI_KLJUC_IZDAJ v posodobitev.server.ts) -> vrstica vsote za ime APK -> sele nato prenos APK z mejo velikosti in primerjava vsote.
 * Paket, podpisni certifikat (= namescena Lina) in versionCode preveri app na preverjeni datoteki (NamestitevPaketa.preveriArhiv,
 * preveriRazlicico). Ime sredstva: lina-android_<versionName>_<versionCode>.apk (predlog toka CI v POROCILO-28.md).
 * Ed25519 prek BouncyCastle (lahka API): java.security »Ed25519« je na Androidu sele od API 33, Lina pa tece od API 29.
 */
object PosodobitevGithub {
    const val REPO = "safeerOS/Lina"
    const val API = "https://api.github.com/repos/$REPO/releases/latest"
    /** Obdobje samodejne preverbe (WorkManager/JobScheduler naloge 28: vsakih 12 h, samo na omrezju). */
    const val OBDOBJE_MS = 12L * 3600_000
    const val NAJVEC_OPOMB = 1500
    private const val NAJVEC_API = 1_000_000L
    private const val NAJVEC_VSOT = 64L * 1024
    private const val NAJVEC_SKOKOV = 4
    private const val NAJVEC_ODMIKA = 2
    /** Isti javni kljuc izdaj Safeer kot na racunalniku (SPKI DER, base64); odtis SHA-256 a3ae3bcb... preveri preizkus. */
    private const val JAVNI_SPKI_B64 = "MCowBQYDK2VwAyEAFcFUbdyiO8cO0+32opSFwKaIslAPdVK5rt5tYNiH328="
    private val SPKI_GLAVA = byteArrayOf(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00)
    /** api.github.com (podatki izdaje), github.com (zacetek prenosa) in gostitelja sredstev, kamor github.com preusmeri (izmerjeno 26. 11.). */
    val GOSTITELJI = setOf("api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")
    private val IME_APK = Regex("^lina-android_([0-9]{1,6}(?:\\.[0-9]{1,6}){0,3})_([0-9]{1,9})\\.apk$")
    private val OZNAKA = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
    private val VRSTICA_VSOTE = Regex("^([0-9a-fA-F]{64}) [ *](.+?)\\s*$")
    private val ENKRATNI = Regex("^[A-Za-z0-9_-]{16,64}$")
    private val OSTANEK = Regex("^lina-(posodobitev-[0-9]{1,9}-[A-Za-z0-9_-]{16,64}\\.apk|vsote-[A-Za-z0-9_-]{16,64}\\.(txt|sig))$")
    /** Skupni rok enega prenosa (readTimeout velja samo za posamezno branje: kapljanje bi zadrzalo zaklep za vedno). */
    const val ROK_APK_MS = 30L * 60_000
    private const val ROK_MALO_MS = 60_000L
    private const val IME_OPOMB = "OPOMBE.txt"
    private const val NAJVEC_OPOMB_BAJTOV = 16L * 1024

    /** Brez sledenja preusmeritvam: vsak skok preveri prenesi() (gostitelj s seznama, https). */
    interface Http { fun get(url: String, glave: Map<String, String>): OdgovorHttp }

    /** glave: imena z malimi crkami. */
    class OdgovorHttp(val status: Int, val glave: Map<String, String>, val telo: InputStream?, private val zapri: () -> Unit = {}) : Closeable {
        override fun close() {
            runCatching { telo?.close() }
            zapri()
        }
    }

    data class Izdaja(val razlicica: String, val versionCode: Long, val imeApk: String, val urlApk: String, val urlVsot: String, val urlPodpisa: String, val opombe: String)

    /** Stanje samodejne preverbe (SharedPreferences): izdaja je samo NOVEJSA od namescene; obvescenaCode = ze obvesceno. */
    data class StanjePreverbe(val etag: String? = null, val izdaja: Izdaja? = null, val napak: Int = 0, val naslednjaMs: Long = 0, val obvescenaCode: Long = 0) {
        fun vNiz(): String = buildJsonObject {
            put("v", 1)
            etag?.let { put("etag", it) }
            put("napak", napak)
            put("naslednjaMs", naslednjaMs)
            put("obvescenaCode", obvescenaCode)
            izdaja?.let { i ->
                put("izdaja", buildJsonObject {
                    put("razlicica", i.razlicica); put("versionCode", i.versionCode); put("imeApk", i.imeApk)
                    put("urlApk", i.urlApk); put("urlVsot", i.urlVsot); put("urlPodpisa", i.urlPodpisa); put("opombe", i.opombe)
                })
            }
        }.toString()

        companion object {
            private fun JsonObject.niz(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
            private fun JsonObject.stevilo(k: String): Long? = (this[k] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toLongOrNull()

            /** Pokvarjen ali tuj zapis = privzeto stanje (nova preverba), nikoli izjema. */
            fun izNiza(s: String?): StanjePreverbe = try {
                val o = Json.parseToJsonElement(s ?: "").jsonObject
                val i = o["izdaja"] as? JsonObject
                val izdaja = i?.let {
                    Izdaja(
                        it.niz("razlicica")!!, it.stevilo("versionCode")!!, it.niz("imeApk")!!, it.niz("urlApk")!!,
                        it.niz("urlVsot")!!, it.niz("urlPodpisa")!!, it.niz("opombe") ?: "",
                    )
                }
                StanjePreverbe(o.niz("etag"), izdaja, (o.stevilo("napak") ?: 0).toInt(), o.stevilo("naslednjaMs") ?: 0, o.stevilo("obvescenaCode") ?: 0)
            } catch (_: Exception) {
                StanjePreverbe()
            }
        }
    }

    enum class RazlogPosodobitve { PODPIS, VSOTA, PRENOS, RAZLICICA }

    sealed class IzidPriprave {
        data class Ok(val datoteka: File, val versionCode: Long) : IzidPriprave()
        data class Zavrnjeno(val razlog: RazlogPosodobitve) : IzidPriprave()
    }

    fun javniKljuc(): ByteArray = Base64.getDecoder().decode(JAVNI_SPKI_B64)

    /** Surov 64-bajtni podpis Ed25519 cez tocne bajte (oblika podpis-izdaje.yml). Nikoli ne vrze. */
    fun podpisVeljaven(vsebina: ByteArray, podpis: ByteArray, javniSpki: ByteArray = javniKljuc()): Boolean {
        if (podpis.size != 64 || javniSpki.size != 44 || !javniSpki.copyOfRange(0, 12).contentEquals(SPKI_GLAVA)) return false
        return try {
            val s = Ed25519Signer()
            s.init(false, Ed25519PublicKeyParameters(javniSpki, 12))
            s.update(vsebina, 0, vsebina.size)
            s.verifySignature(podpis)
        } catch (_: Exception) {
            false
        }
    }

    /** Nadzorni (razen nove vrstice), smerni, nevidni znaki in osamljeni nadomestki: v opombah se izpustijo (enako kot racunalnik). */
    private fun nevidni(k: Int): Boolean =
        (k < 0x20 && k != 0x0a) || k in 0x7f..0x9f || k == 0xad || k == 0x34f || k == 0x61c || k == 0x180e ||
            k == 0x115f || k == 0x1160 || k == 0x3164 || k == 0xffa0 || k in 0xfe00..0xfe0f ||
            k in 0x180b..0x180d || k == 0x2800 || k == 0xfffc || k in 0x1bca0..0x1bca3 ||
            k in 0x200b..0x200f || k in 0x202a..0x202e || k in 0x2060..0x206f || k == 0xfeff || k in 0xfff9..0xfffb ||
            k in 0xe0000..0xe0fff || k in 0xd800..0xdfff

    /** Golo besedilo za prikaz (TextView, nikoli HTML ali povezave): CRLF/LS/PS -> \n, tab -> presledek, omejena dolzina. */
    fun ocistiOpombe(v: String?): String {
        if (v == null) return ""
        val s = v.take(NAJVEC_OPOMB * 4)
        val sb = StringBuilder()
        var i = 0
        while (i < s.length) {
            val k = s.codePointAt(i)
            i += Character.charCount(k)
            when {
                k == 0x2028 || k == 0x2029 -> sb.append('\n')
                k == 0x09 -> sb.append(' ')
                !nevidni(k) -> sb.appendCodePoint(k)
            }
        }
        val t = sb.toString().replace(Regex("\n{3,}"), "\n\n").trim()
        if (t.length <= NAJVEC_OPOMB) return t
        var konec = NAJVEC_OPOMB - 1
        if (Character.isHighSurrogate(t[konec - 1])) konec--
        return t.substring(0, konec).trimEnd() + "…"
    }

    fun dovoljenNaslov(url: String): Boolean = try {
        val u = URI(url)
        u.scheme == "https" && u.rawUserInfo == null && u.port == -1 && u.host in GOSTITELJI
    } catch (_: Exception) {
        false
    }

    /** Kandidat iz odgovora releases/latest: oznaka, APK z najvisjo versionCode, SHA256SUMS in SHA256SUMS.sig; sicer null. */
    fun razcleniIzdajo(json: String): Izdaja? {
        if (json.length > NAJVEC_API) return null
        return try {
            val o = Json.parseToJsonElement(json) as? JsonObject ?: return null
            val tag = (o["tag_name"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            if (!OZNAKA.matches(tag)) return null
            val imena = (o["assets"] as? JsonArray)?.mapNotNull { ((it as? JsonObject)?.get("name") as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: return null
            if ("SHA256SUMS" !in imena || "SHA256SUMS.sig" !in imena) return null
            val apk = imena.mapNotNull { n -> IME_APK.matchEntire(n)?.let { m -> Triple(n, m.groupValues[1], m.groupValues[2].toLong()) } }
                .maxByOrNull { it.third } ?: return null
            val osnova = "https://github.com/$REPO/releases/download/$tag/"
            // opombe: telo izdaje (body) NI podpisano (krog 2 slepega pregleda) - besedilo samo iz podpisanega OPOMBE.txt (preveri)
            Izdaja(apk.second, apk.third, apk.first, osnova + apk.first, osnova + "SHA256SUMS", osnova + "SHA256SUMS.sig", "")
        } catch (_: Exception) {
            null
        }
    }

    /** 12 h, po n zaporednih napakah 12 h * 2^min(n, 2): po napaki omrezja ni hitrega ponavljanja. */
    fun zamikPoNapakah(napak: Int): Long = OBDOBJE_MS shl minOf(maxOf(napak, 0), NAJVEC_ODMIKA)

    private fun napaka(s: StanjePreverbe, zdaj: Long): StanjePreverbe = (s.napak + 1).let { n -> s.copy(napak = n, naslednjaMs = zdaj + zamikPoNapakah(n)) }

    /** Ena preverba releases/latest z If-None-Match. 304 obdrzi znano izdajo; 403/429/5xx/omrezje = napaka z odmikom. */
    fun preveri(http: Http, s: StanjePreverbe, namesceniCode: Long, zdaj: Long, javniSpki: ByteArray = javniKljuc()): StanjePreverbe {
        val glave = mutableMapOf("Accept" to "application/vnd.github+json", "User-Agent" to "Lina")
        s.etag?.let { glave["If-None-Match"] = it }
        return try {
            http.get(API, glave).use { o ->
                when {
                    o.status == 304 && s.etag != null ->
                        s.copy(izdaja = s.izdaja?.takeIf { it.versionCode > namesceniCode }, napak = 0, naslednjaMs = zdaj + OBDOBJE_MS)
                    o.status == 200 -> {
                        val telo = beri(o.telo, NAJVEC_API, ROK_MALO_MS) ?: return napaka(s, zdaj)
                        val i = razcleniIzdajo(String(telo, Charsets.UTF_8))
                        // slepi pregled S1: samo natisljiv ASCII (ne-ASCII glava bi ob naslednji zahtevi vrgla izjemo za vedno)
                        val etag = o.glave["etag"]?.takeIf { e -> e.length in 1..200 && e.all { it in ' '..'~' } }
                        // slepi pregled S2: izdaja (razlicica in opombe v obvestilu) samo, ce je SHA256SUMS podpisan in nasteje ta APK
                        val nova = i?.takeIf { it.versionCode > namesceniCode }?.let { iz ->
                            val seznam = podpisanSeznam(http, iz, javniSpki)?.let { String(it, Charsets.UTF_8) }
                            if (seznam == null || vsotaIzSeznama(seznam, iz.imeApk) == null) null else iz.copy(opombe = podpisaneOpombe(http, iz, seznam))
                        }
                        s.copy(etag = etag, izdaja = nova, napak = 0, naslednjaMs = zdaj + OBDOBJE_MS)
                    }
                    else -> napaka(s, zdaj)
                }
            }
        } catch (_: Exception) {
            napaka(s, zdaj)
        }
    }

    private fun beri(vhod: InputStream?, najvec: Long, rokMs: Long): ByteArray? {
        vhod ?: return null
        val konec = System.nanoTime() + rokMs * 1_000_000
        val izid = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = vhod.read(buf)
            if (n < 0) return izid.toByteArray()
            if (izid.size() + n > najvec || System.nanoTime() > konec) return null
            izid.write(buf, 0, n)
        }
    }

    /** SHA256SUMS izdaje, ce je podpis veljaven (oba z majhno mejo); null = nepodpisan. Napaka prenosa vrze IOException. */
    private fun podpisanSeznam(http: Http, i: Izdaja, javniSpki: ByteArray): ByteArray? {
        val vsote = prenesiBajte(http, i.urlVsot, NAJVEC_VSOT)
        val podpis = prenesiBajte(http, i.urlPodpisa, 64)
        return vsote.takeIf { podpisVeljaven(it, podpis, javniSpki) }
    }

    /** OPOMBE.txt izdaje, samo ce ga nasteje podpisan seznam in se vsota ujema (najvec 16 KB); sicer "" (izdaja ostane). */
    private fun podpisaneOpombe(http: Http, i: Izdaja, seznam: String): String {
        val pricakovana = vsotaIzSeznama(seznam, IME_OPOMB) ?: return ""
        return try {
            val b = prenesiBajte(http, i.urlVsot.removeSuffix("SHA256SUMS") + IME_OPOMB, NAJVEC_OPOMB_BAJTOV)
            if (hex(MessageDigest.getInstance("SHA-256").digest(b)) == pricakovana) ocistiOpombe(String(b, Charsets.UTF_8)) else ""
        } catch (_: Exception) {
            ""
        }
    }

    private fun prenesiBajte(http: Http, url: String, najvec: Long): ByteArray =
        java.io.ByteArrayOutputStream().also { prenesiV(http, url, najvec, ROK_MALO_MS, it) }.toByteArray()

    /** Ostanki prekinjenih prenosov v mapi posodobitve (samo nasa imena); true, ce ni ostalo nobenega. */
    fun pobrisiOstanke(mapa: File): Boolean {
        val datoteke = mapa.listFiles() ?: return !mapa.exists()
        var vse = true
        for (f in datoteke) if (f.isFile && OSTANEK.matches(f.name) && !f.delete() && f.exists()) vse = false
        return vse
    }

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    /**
     * Prenos z rocnimi preusmeritvami (najvec 4): zacetek samo github.com, vsak skok https na gostitelja s seznama, telo najvec
     * `najvec` bajtov. Vrne sha256 zapisane datoteke; ob napaki datoteka ne ostane in izjema gre klicatelju.
     */
    fun prenesi(http: Http, url: String, cilj: File, najvec: Long, rokMs: Long = ROK_APK_MS): String = try {
        cilj.outputStream().use { izhod -> prenesiV(http, url, najvec, rokMs, izhod).also { izhod.fd.sync() } }
    } catch (e: Exception) {
        cilj.delete()
        throw e
    }

    private fun prenesiV(http: Http, url: String, najvec: Long, rokMs: Long, izhod: java.io.OutputStream): String {
        if (!dovoljenNaslov(url) || URI(url).host != "github.com") throw IOException("Nedovoljen naslov prenosa.")
        val konec = System.nanoTime() + rokMs * 1_000_000
        var u = url
        repeat(NAJVEC_SKOKOV + 1) {
            if (!dovoljenNaslov(u)) throw IOException("Nedovoljen naslov prenosa.")
            var naprej: String? = null
            http.get(u, mapOf("User-Agent" to "Lina")).use { o ->
                if (o.status in 300..399) {
                    naprej = URI(u).resolve(o.glave["location"] ?: throw IOException("Prenos ni uspel.")).toString()
                } else {
                    if (o.status != 200) throw IOException("Prenos ni uspel.")
                    o.glave["content-length"]?.toLongOrNull()?.let { if (it > najvec) throw IOException("Datoteka je prevelika.") }
                    val vhod = o.telo ?: throw IOException("Prenos ni uspel.")
                    val md = MessageDigest.getInstance("SHA-256")
                    val buf = ByteArray(64 * 1024)
                    var skupaj = 0L
                    while (true) {
                        val n = vhod.read(buf)
                        if (n < 0) break
                        skupaj += n
                        if (skupaj > najvec) throw IOException("Datoteka je prevelika.")
                        if (System.nanoTime() > konec) throw IOException("Prenos je trajal predolgo.")
                        md.update(buf, 0, n)
                        izhod.write(buf, 0, n)
                    }
                    return hex(md.digest())
                }
            }
            u = naprej!!
        }
        throw IOException("Prevec preusmeritev.")
    }

    fun vsotaIzSeznama(besedilo: String, ime: String): String? =
        besedilo.split('\n').firstNotNullOfOrNull { v -> VRSTICA_VSOTE.matchEntire(v.removeSuffix("\r"))?.takeIf { it.groupValues[2] == ime }?.groupValues?.get(1)?.lowercase() }

    /**
     * Prenese in preveri APK izdaje v `mapa` (cacheDir aplikacije). Podpis seznama vsot se preveri PRED prenosom APK; zavrnjena
     * kopija in pomozne datoteke se pobrisejo. Ok = datoteka z vsoto iz podpisanega seznama (paket in certifikat preveri app).
     */
    fun pripravi(http: Http, izdaja: Izdaja, mapa: File, enkratni: String, javniSpki: ByteArray = javniKljuc()): IzidPriprave {
        if (!ENKRATNI.matches(enkratni)) return IzidPriprave.Zavrnjeno(RazlogPosodobitve.PRENOS)
        mapa.mkdirs()
        val apkF = File(mapa, "lina-posodobitev-${izdaja.versionCode}-$enkratni.apk")
        val vsote = try {
            podpisanSeznam(http, izdaja, javniSpki) ?: return IzidPriprave.Zavrnjeno(RazlogPosodobitve.PODPIS)
        } catch (_: Exception) {
            return IzidPriprave.Zavrnjeno(RazlogPosodobitve.PRENOS)
        }
        val pricakovana = vsotaIzSeznama(String(vsote, Charsets.UTF_8), izdaja.imeApk) ?: return IzidPriprave.Zavrnjeno(RazlogPosodobitve.VSOTA)
        val dobljena = try {
            prenesi(http, izdaja.urlApk, apkF, NamestitevApk.NAJVEC_BAJTOV)
        } catch (_: Exception) {
            apkF.delete()
            return IzidPriprave.Zavrnjeno(RazlogPosodobitve.PRENOS)
        }
        if (dobljena != pricakovana) {
            apkF.delete()
            return IzidPriprave.Zavrnjeno(RazlogPosodobitve.VSOTA)
        }
        return IzidPriprave.Ok(apkF, izdaja.versionCode)
    }

    /** Arhiv mora nositi versionCode iz podpisanega imena izdaje in biti novejsi od namescene Line. */
    fun preveriRazlicico(arhiv: Long?, izdaja: Long, namescena: Long): RazlogPosodobitve? =
        if (arhiv == null || arhiv != izdaja || arhiv <= namescena) RazlogPosodobitve.RAZLICICA else null

    /** Pravi odjemalec: HttpsURLConnection brez sledenja preusmeritvam, samo naslovi s seznama. */
    class HttpsHttp(private val rokBranjaMs: Int = 60_000) : Http {
        override fun get(url: String, glave: Map<String, String>): OdgovorHttp {
            if (!dovoljenNaslov(url)) throw IOException("Nedovoljen naslov.")
            val c = URL(url).openConnection() as HttpsURLConnection
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.connectTimeout = 15_000
            c.readTimeout = rokBranjaMs
            glave.forEach { (k, v) -> c.setRequestProperty(k, v) }
            return try {
                val status = c.responseCode
                val g = c.headerFields.entries.filter { it.key != null }.associate { it.key.lowercase() to (it.value.firstOrNull() ?: "") }
                val telo = if (status == 200) c.inputStream else runCatching { c.errorStream }.getOrNull()
                OdgovorHttp(status, g, telo) { c.disconnect() }
            } catch (e: Exception) {
                c.disconnect()
                throw e
            }
        }
    }
}
