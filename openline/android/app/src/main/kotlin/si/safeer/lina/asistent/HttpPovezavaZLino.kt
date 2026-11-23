package si.safeer.lina.asistent

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import si.safeer.lina.seznanitev.AsistentNaslov
import si.safeer.lina.podpis.AsistentProtokol
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

    private fun izvedi(r: Request): OdgovorLine = try {
        client.newCall(r).execute().use { odg ->
            val telo = odg.body?.let { b ->
                val src = b.source()
                src.request(AsistentProtokol.NAJVEC_ODGOVORA.toLong() + 1)
                if (src.buffer.size > AsistentProtokol.NAJVEC_ODGOVORA) return OdgovorLine.Nedosegljiva
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

    private fun get(pot: String, vec: okhttp3.HttpUrl.Builder.() -> Unit): OdgovorLine {
        val url = okhttp3.HttpUrl.Builder().scheme("https").host(naslov.naslov).port(naslov.vrata)
            .addPathSegments("api/asistent/v1/$pot").apply(vec).build()
        return izvedi(Request.Builder().url(url).get().build())
    }

    override fun stanjeSeznanitve(koda: String) = get("seznani") { addQueryParameter("koda", koda) }

    override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = get("stanje") {
        addQueryParameter("posiljatelj", posiljatelj); addQueryParameter("cas", cas.toString())
        addQueryParameter("enkratni", enkratni); addQueryParameter("podpis", podpis)
    }

    override fun stanjeDodatkov(posiljatelj: String, cas: Long, enkratni: String, podpis: String) = get("dodatki") {
        addQueryParameter("posiljatelj", posiljatelj); addQueryParameter("cas", cas.toString())
        addQueryParameter("enkratni", enkratni); addQueryParameter("podpis", podpis)
    }

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
