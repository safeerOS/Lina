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
import si.safeer.lina.podpis.IzidOddaje
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
) : PovezavaZLino, java.io.Closeable {
    private val osnova = naslov.osnova()
    private val client: OkHttpClient = osnovni.newBuilder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS) // dolgo poizvedovanje: Lina caka najvec 25 s
        .writeTimeout(10, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val json = "application/json".toMediaType()

    /**
     * T1 (pregled 0213): [spreminja] = zahteva, ki jo Lina izvede (naloga, gradnja, agent, odobritev). Ce je bila glava zahteve ze
     * zapisana v vzpostavljeno povezavo (TLS z Lino uspel, OkHttp requestHeadersStart) in odgovora ni, je izid NEZNAN
     * (IzidOddaje.poNapaki): IzbirnaPovezava je ne ponovi po releju z istim enkratnim nizom.
     */
    private fun klientZa(spreminja: Boolean, oddano: java.util.concurrent.atomic.AtomicBoolean): OkHttpClient =
        if (!spreminja) client else client.newBuilder().eventListener(object : okhttp3.EventListener() {
            override fun requestHeadersStart(call: okhttp3.Call) { oddano.set(true) }
        }).build()

    private fun izvedi(r: Request, najvec: Int = AsistentProtokol.NAJVEC_ODGOVORA, spreminja: Boolean = false): OdgovorLine {
        val oddano = java.util.concurrent.atomic.AtomicBoolean(false)
        val odg = try {
            klientZa(spreminja, oddano).newCall(r).execute().use { o ->
                val src = o.body?.source()
                src?.request(najvec.toLong() + 1)
                when {
                    src != null && src.buffer.size > najvec -> OdgovorLine.Nedosegljiva
                    o.isRedirect -> OdgovorLine.Nedosegljiva
                    else -> {
                        val telo = src?.buffer?.readUtf8().orEmpty()
                        if (o.isSuccessful) OdgovorLine.Ok(telo) else OdgovorLine.Napaka(o.code, kodaNapake(telo))
                    }
                }
            }
        } catch (_: Exception) {
            OdgovorLine.Nedosegljiva
        }
        return if (odg is OdgovorLine.Nedosegljiva) IzidOddaje.poNapaki(oddano.get(), spreminja) else odg
    }

    private fun kodaNapake(telo: String): String? =
        Regex("\"napaka\"\\s*:\\s*\"([a-z0-9_-]{1,40})\"").find(telo.take(2048))?.groupValues?.get(1)

    private fun post(pot: String, telo: String, spreminja: Boolean = false) =
        izvedi(Request.Builder().url("$osnova/$pot").post(telo.toRequestBody(json)).build(), spreminja = spreminja)

    override fun naloga(telo: String) = post("naloga", telo, spreminja = true)
    override fun odobritev(telo: String) = post("odobritev", telo, spreminja = true)
    override fun ustavi(telo: String) = post("ustavi", telo, spreminja = true)
    override fun nadaljuj(telo: String) = post("nadaljuj", telo, spreminja = true)

    override fun seznani(telo: String) = post("seznani", telo)
    override fun klici(telo: String) = post("seznani/klici", telo)
    override fun sinhron(telo: String) = post("sinhron", telo)
    override fun dodatek(telo: String) = post("dodatek", telo, spreminja = true)

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

    // Gradnje na GitHubu (24. 11. 2026): doma ali prek Global Linka (POTI_ODDALJENO, lastnik 25. 11. 2026).
    override fun stanjeGradenj(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        get("gradnje", GradnjeLine.NAJVEC_ODGOVORA, podpisanaPoizvedba(posiljatelj, cas, enkratni, podpis))
    override fun predlogGradnje(telo: String) = post("gradnja/predlog", telo, spreminja = true)
    override fun potrditevGradnje(telo: String) = post("gradnja/potrdi", telo, spreminja = true)

    // Agenti in naloge (24. 11. 2026): doma ali prek Global Linka (POTI_ODDALJENO, 25. 11. 2026); vrsta do 30 nalog po 8000 znakov.
    override fun stanjeAgentNalog(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        get("agent-naloge", AgentiLine.NAJVEC_ODGOVORA, podpisanaPoizvedba(posiljatelj, cas, enkratni, podpis))
    override fun dodeliAgentNalogo(telo: String) = post("agent-naloga/dodeli", telo, spreminja = true)
    override fun prekliciAgentNalogo(telo: String) = post("agent-naloga/preklici", telo, spreminja = true)

    /**
     * GET /gradnja/apk v [mapa] (cacheDir): pretok z lastnim stetjem bajtov in rokom (ne prek izvedi, ki omeji velikost in bere
     * UTF-8). Vse preverbe glav, velikosti in sha256 so v NamestitevApk.shrani. Napaka HTTP vrne OdgovorLine (404 ni, 409 vsota).
     */
    fun prenesiApk(posiljatelj: String, cas: Long, enkratni: String, podpis: String, mapa: java.io.File): Pair<IzidPrenosa?, OdgovorLine?> {
        val oddano = java.util.concurrent.atomic.AtomicBoolean(false)
        return try { prenesiApkNotranje(posiljatelj, cas, enkratni, podpis, mapa, oddano) }
        // T1: zahteva z enkratnim nizom je bila oddana - rele je ne ponovi (Lina bi ponovljen niz zavrnila)
        catch (_: Exception) { null to IzidOddaje.poNapaki(oddano.get(), spreminja = true) }
    }

    private fun prenesiApkNotranje(posiljatelj: String, cas: Long, enkratni: String, podpis: String, mapa: java.io.File,
                                   oddano: java.util.concurrent.atomic.AtomicBoolean): Pair<IzidPrenosa?, OdgovorLine?> {
        val prenosni = klientZa(true, oddano).newBuilder().readTimeout(30, TimeUnit.SECONDS).callTimeout(10, TimeUnit.MINUTES).build()
        return prenosni.newCall(Request.Builder().url(url("gradnja/apk", podpisanaPoizvedba(posiljatelj, cas, enkratni, podpis))).get().build()).execute().use { odg ->
            when {
                odg.isRedirect -> null to OdgovorLine.Nedosegljiva
                !odg.isSuccessful -> null to OdgovorLine.Napaka(odg.code, kodaNapake(odg.body?.source()?.let { s -> s.request(2048); s.buffer.readUtf8() }.orEmpty()))
                else -> {
                    val g = GlaveApk(odg.header("x-lina-sha256"), odg.header("content-length")?.toLongOrNull(), odg.header("x-lina-paket"),
                        odg.header("x-lina-gradnja"), odg.header("content-type"))
                    val telo = odg.body ?: return@use (IzidPrenosa.Zavrnjeno(ZavrnitevApk.GLAVE) to null)
                    NamestitevApk.shrani(telo.byteStream(), g, mapa, enkratni) to null
                }
            }
        }
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

    override fun close() = zapri()
}
