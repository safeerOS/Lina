package si.safeer.lina.asistent

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import si.safeer.lina.seznanitev.AsistentNaslov
import si.safeer.lina.podpis.AgentiLine
import si.safeer.lina.podpis.AsistentProtokol
import si.safeer.lina.podpis.GlaveApk
import si.safeer.lina.podpis.GradnjeLine
import si.safeer.lina.podpis.IzidPrenosa
import si.safeer.lina.podpis.NamestitevApk
import si.safeer.lina.podpis.ZavrnitevApk
import si.safeer.lina.podpis.OdgovorLine
import si.safeer.lina.podpis.PovezavaZLino
import si.safeer.lina.protocol.PinnedHttp
import java.util.concurrent.TimeUnit

/**
 * Pogodba lina-asistent2 @e815ed0: HTTPS s pripetim odtisom SHA-256 lista (PinnedHttp: ime gostitelja se ne gleda, brez
 * preusmeritev), samo zasebni naslov (AsistentQr). Telo odgovora najvec AsistentProtokol.NAJVEC_ODGOVORA; vse drugo je
 * OdgovorLine.Nedosegljiva. Klici so blokirajoci - samo zunaj glavne niti.
 */
class HttpPovezavaZLino(
    private val naslov: AsistentNaslov,
    osnovni: OkHttpClient = PinnedHttp.client(naslov.odtis, pingSeconds = 0),
) : PovezavaZLino {
    private val osnova = naslov.osnova()
    private val client: OkHttpClient = osnovni.newBuilder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS) // dolgo poizvedovanje: Lina caka najvec 25 s
        .writeTimeout(10, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val json = "application/json".toMediaType()

    private fun izvedi(r: Request, najvec: Int = AsistentProtokol.NAJVEC_ODGOVORA): OdgovorLine = try {
        client.newCall(r).execute().use { odg ->
            val telo = odg.body?.let { b ->
                val src = b.source()
                src.request(najvec.toLong() + 1)
                if (src.buffer.size > najvec) return OdgovorLine.Nedosegljiva
                src.buffer.readUtf8()
            }.orEmpty()
            when {
                odg.isRedirect -> OdgovorLine.Nedosegljiva
                odg.isSuccessful -> OdgovorLine.Ok(telo)
                else -> OdgovorLine.Napaka(odg.code, kodaNapake(telo))
            }
        }
    } catch (_: Exception) {
        OdgovorLine.Nedosegljiva
    }

    private fun kodaNapake(telo: String): String? =
        Regex("\"napaka\"\\s*:\\s*\"([a-z0-9_-]{1,40})\"").find(telo.take(2048))?.groupValues?.get(1)

    private fun post(pot: String, telo: String) =
        izvedi(Request.Builder().url("$osnova/$pot").post(telo.toRequestBody(json)).build())

    override fun naloga(telo: String) = post("naloga", telo)
    override fun odobritev(telo: String) = post("odobritev", telo)
    override fun ustavi(telo: String) = post("ustavi", telo)
    override fun nadaljuj(telo: String) = post("nadaljuj", telo)

    override fun seznani(telo: String) = post("seznani", telo)
    override fun klici(telo: String) = post("seznani/klici", telo)
    override fun sinhron(telo: String) = post("sinhron", telo)
    override fun dodatek(telo: String) = post("dodatek", telo)

    // Seznanitev s kodo (pogodba @fdd787b); /koda/zacni gre prek OdtisPrvePovezave, drugo pripeto na videni odtis.
    fun kodaZacni(telo: String) = post("koda/zacni", telo)
    fun kodaSpake(telo: String) = post("koda/spake", telo)
    fun kodaPotrdi(telo: String) = post("koda/potrdi", telo)
    fun kodaOdpovej(telo: String) = post("koda/odpovej", telo)

    private fun url(pot: String, vec: okhttp3.HttpUrl.Builder.() -> Unit) = okhttp3.HttpUrl.Builder().scheme("https").host(naslov.naslov)
        .port(naslov.vrata).addPathSegments("api/asistent/v1/$pot").apply(vec).build()

    private fun get(pot: String, najvec: Int = AsistentProtokol.NAJVEC_ODGOVORA, vec: okhttp3.HttpUrl.Builder.() -> Unit): OdgovorLine =
        izvedi(Request.Builder().url(url(pot, vec)).get().build(), najvec)

    private fun podpisanaPoizvedba(posiljatelj: String, cas: Long, enkratni: String, podpis: String): okhttp3.HttpUrl.Builder.() -> Unit = {
        addQueryParameter("posiljatelj", posiljatelj); addQueryParameter("cas", cas.toString())
        addQueryParameter("enkratni", enkratni); addQueryParameter("podpis", podpis)
    }

    // Gradnje na GitHubu (24. 11. 2026): samo domace omrezje (racunalnik od zunaj odgovori 403).
    override fun stanjeGradenj(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        get("gradnje", GradnjeLine.NAJVEC_ODGOVORA, podpisanaPoizvedba(posiljatelj, cas, enkratni, podpis))
    override fun predlogGradnje(telo: String) = post("gradnja/predlog", telo)
    override fun potrditevGradnje(telo: String) = post("gradnja/potrdi", telo)

    // Agenti in naloge (24. 11. 2026): samo domace omrezje (poti niso v POTI_ODDALJENO); vrsta do 30 nalog po 8000 znakov.
    override fun stanjeAgentNalog(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        get("agent-naloge", AgentiLine.NAJVEC_ODGOVORA, podpisanaPoizvedba(posiljatelj, cas, enkratni, podpis))
    override fun dodeliAgentNalogo(telo: String) = post("agent-naloga/dodeli", telo)
    override fun prekliciAgentNalogo(telo: String) = post("agent-naloga/preklici", telo)

    /**
     * GET /gradnja/apk v [mapa] (cacheDir): pretok z lastnim stetjem bajtov in rokom (ne prek izvedi, ki omeji velikost in bere
     * UTF-8). Vse preverbe glav, velikosti in sha256 so v NamestitevApk.shrani. Napaka HTTP vrne OdgovorLine (404 ni, 409 vsota).
     */
    fun prenesiApk(posiljatelj: String, cas: Long, enkratni: String, podpis: String, mapa: java.io.File): Pair<IzidPrenosa?, OdgovorLine?> = try {
        val prenosni = client.newBuilder().readTimeout(30, TimeUnit.SECONDS).callTimeout(10, TimeUnit.MINUTES).build()
        prenosni.newCall(Request.Builder().url(url("gradnja/apk", podpisanaPoizvedba(posiljatelj, cas, enkratni, podpis))).get().build()).execute().use { odg ->
            when {
                odg.isRedirect -> null to OdgovorLine.Nedosegljiva
                !odg.isSuccessful -> null to OdgovorLine.Napaka(odg.code, kodaNapake(odg.body?.source()?.let { s -> s.request(2048); s.buffer.readUtf8() }.orEmpty()))
                else -> {
                    val g = GlaveApk(odg.header("x-lina-sha256"), odg.header("content-length")?.toLongOrNull(), odg.header("x-lina-paket"),
                        odg.header("x-lina-gradnja"), odg.header("content-type"))
                    val telo = odg.body ?: return@use (IzidPrenosa.Zavrnjeno(ZavrnitevApk.GLAVE) to null)
                    NamestitevApk.shrani(telo.byteStream(), g, mapa) to null
                }
            }
        }
    } catch (_: Exception) {
        NamestitevApk.pobrisi(mapa)
        null to OdgovorLine.Nedosegljiva
    }

    override fun stanjeSeznanitve(koda: String) = get("seznani") { addQueryParameter("koda", koda) }

    override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = get("stanje") {
        addQueryParameter("posiljatelj", posiljatelj); addQueryParameter("cas", cas.toString())
        addQueryParameter("enkratni", enkratni); addQueryParameter("podpis", podpis)
    }

    override fun stanjeDodatkov(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        get("dodatki", vec = podpisanaPoizvedba(posiljatelj, cas, enkratni, podpis))

    override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int): OdgovorLine {
        val url = okhttp3.HttpUrl.Builder().scheme("https").host(naslov.naslov).port(naslov.vrata)
            .addPathSegments("api/asistent/v1/dogodki")
            .addQueryParameter("id", id).addQueryParameter("posiljatelj", posiljatelj).addQueryParameter("cas", cas.toString())
            .addQueryParameter("enkratni", enkratni).addQueryParameter("podpis", podpis).addQueryParameter("od", od.toString()).addQueryParameter("caka", cakaS.coerceIn(0, 25).toString())
            .build()
        return izvedi(Request.Builder().url(url).get().build())
    }

    fun zapri() {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }
}
