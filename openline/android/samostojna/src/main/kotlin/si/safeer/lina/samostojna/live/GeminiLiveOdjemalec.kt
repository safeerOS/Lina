package si.safeer.lina.samostojna.live

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import si.safeer.lina.samostojna.DnevnikKlicev
import si.safeer.lina.samostojna.GoogleZeton
import si.safeer.lina.samostojna.ShranjevalnikKljuca
import si.safeer.lina.samostojna.SistemskoNavodilo
import si.safeer.lina.samostojna.prehod.ZvocniMost
import java.nio.ByteBuffer
import java.time.ZonedDateTime
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean

class GeminiLiveOdjemalec(
    val osnovniUrlApi: String = "wss://generativelanguage.googleapis.com",
    val osnovniUrlVertex: String = "wss://us-central1-aiplatform.googleapis.com",
    private val apiKljuc: ShranjevalnikKljuca,
    private val googleZeton: GoogleZeton,
    private val projekt: () -> String?,
    private val dnevnik: DnevnikKlicev,
    private val izbiraPoti: IzbiraPotiLive = IzbiraPotiLive(naVoljo = { true }),
    private val model: String = "gemini-3.8-live",
    private val wsFabrika: WsFabrika
) : ZvocniMost {

    companion object {
        const val UPORABI_CONFIG_NAMESTO_SETUP = false // uradna dokumentacija (get-started-websocket, 19. 11. 2026): vsi primeri uporabljajo "setup"
    }

    private enum class StanjePovezave {
        ZAPRT, POVEZUJE, SETUP_POSLAN, PRIPRAVLJEN
    }

    var naPrekinitev: (() -> Unit)? = null
    private var izhodniCallback: ((ByteArray) -> Unit)? = null
    
    private var ws: WsPovezava? = null
    private val isClosed = AtomicBoolean(false)
    private var startTimeMs = 0L

    private var stanje = StanjePovezave.ZAPRT
    private val vhodniMutex = Any()
    private val vhodnaVrsta = ArrayDeque<ByteArray>()
    private val MAKS_OKVIRJEV_V_VRSTI = 100 // max ~2 s pri 20ms

    private fun poskusiPovezavo(zacasnaNapaka: Boolean = false) {
        if (isClosed.get()) return
        val pot = izbiraPoti.izberi()
        if (pot == null) {
            dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                id = "sys-${System.currentTimeMillis()}",
                casZacetka = System.currentTimeMillis(),
                stevilka = "Sistem",
                trajanjeS = 0,
                povzetek = "Ni na voljo nobena pot za povezavo.",
                prepis = ""
            ))
            synchronized(vhodniMutex) {
                stanje = StanjePovezave.ZAPRT
            }
            return
        }

        val url: String
        val modelPath: String
        var jeApiKljuc = false
        val glave = mutableMapOf<String, String>()

        when (pot) {
            PotLive.API_KLJUC -> {
                val kljuc = apiKljuc.preberi()?.izpostavi()
                if (kljuc == null) {
                    izbiraPoti.neuspeh(pot)
                    return poskusiPovezavo(zacasnaNapaka)
                }
                url = "${osnovniUrlApi}/ws/google.ai.generativelanguage.v1alpha.BidiService/BidiGenerateContent?key=$kljuc"
                modelPath = "models/$model"
                jeApiKljuc = true
            }
            PotLive.VERTEX -> {
                val zeton = try { googleZeton.zeton() } catch (e: Exception) { null }
                val p = projekt()
                if (zeton == null || p == null) {
                    izbiraPoti.neuspeh(pot)
                    return poskusiPovezavo(zacasnaNapaka)
                }
                val location = "us-central1"
                url = "wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent"
                glave["Authorization"] = "Bearer $zeton"
                modelPath = "projects/$p/locations/$location/publishers/google/models/$model"
            }
        }

        val cleanUrl = if (jeApiKljuc) "wss://generativelanguage.googleapis.com/...key=SKRITO" else url

        val listener = object : WsPoslusalec {
            override fun onOpen(povezava: WsPovezava) {
                synchronized(vhodniMutex) {
                    ws = povezava
                    stanje = StanjePovezave.SETUP_POSLAN
                }
                izbiraPoti.uspeh(pot)
                val sysNav = SistemskoNavodilo.zgradi(ZonedDateTime.now())
                
                val keySetupStr = if (UPORABI_CONFIG_NAMESTO_SETUP && jeApiKljuc) "config" else "setup"
                val setup = """
                {
                    "$keySetupStr": {
                        "model": "$modelPath",
                        "systemInstruction": { "parts": [{"text": "${sysNav.replace("\"", "\\\"")}"}] },
                        "generationConfig": { "responseModalities": ["AUDIO"] }
                    }
                }
                """.trimIndent()
                povezava.posiljiBesedilo(setup)
            }

            override fun onText(besedilo: String) {
                obdelajSporocilo(besedilo)
            }

            override fun onError(napaka: Throwable) {
                izbiraPoti.neuspeh(pot)
                val msg = napaka.message ?: napaka.javaClass.simpleName
                val varnoSporocilo = msg.replace(Regex("key=[^&\\s]+"), "key=SKRITO").replace(Regex("Bearer\\s+[^&\\s]+"), "Bearer SKRITO")
                dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                    id = "sys-${System.currentTimeMillis()}",
                    casZacetka = System.currentTimeMillis(),
                    stevilka = "Sistem",
                    trajanjeS = 0,
                    povzetek = "Napaka povezave: $varnoSporocilo",
                    prepis = ""
                ))
                synchronized(vhodniMutex) {
                    stanje = StanjePovezave.ZAPRT
                }
                // TODO: retry once
            }

            override fun onClose(koda: Int, razlog: String) {
                val maskiran = razlog.replace(Regex("key=[^&\\s]+"), "key=SKRITO").replace(Regex("Bearer\\s+[^&\\s]+"), "Bearer SKRITO")
                val textRazlog = if (maskiran.isBlank()) "brez razloga" else maskiran
                dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                    id = "sys-${System.currentTimeMillis()}",
                    casZacetka = System.currentTimeMillis(),
                    stevilka = "Sistem",
                    trajanjeS = 0,
                    povzetek = "Zaprto (koda $koda): $textRazlog",
                    prepis = ""
                ))
                izbiraPoti.neuspeh(pot)
                synchronized(vhodniMutex) {
                    stanje = StanjePovezave.ZAPRT
                }
                if (!isClosed.get()) {
                    poskusiPovezavo(true)
                }
            }
        }

        try {
            val novaWs = wsFabrika.odpri(url, glave, listener)
            synchronized(vhodniMutex) {
                ws = novaWs
            }
            startTimeMs = System.currentTimeMillis()
        } catch (e: Exception) {
            izbiraPoti.neuspeh(pot)
            val msg = e.message ?: e.javaClass.simpleName
            val varnoSporocilo = msg.replace(Regex("key=[^&\\s]+"), "key=SKRITO").replace(Regex("Bearer\\s+[^&\\s]+"), "Bearer SKRITO")
            dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                id = "sys-${System.currentTimeMillis()}",
                casZacetka = System.currentTimeMillis(),
                stevilka = "Sistem",
                trajanjeS = 0,
                povzetek = "Napaka pri vzpostavitvi: $varnoSporocilo",
                prepis = ""
            ))
            synchronized(vhodniMutex) {
                stanje = StanjePovezave.ZAPRT
            }
            if (!zacasnaNapaka) poskusiPovezavo(true) // ponovitev enkrat
            else dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                id = "sys-${System.currentTimeMillis()}",
                casZacetka = System.currentTimeMillis(),
                stevilka = "Sistem",
                trajanjeS = 0,
                povzetek = "Povezava z modelom je padla",
                prepis = ""
            ))
        }
    }

    private fun obdelajSporocilo(msg: String) {
        if (msg.contains("\"setupComplete\"")) {
            val zaPosiljanje = mutableListOf<ByteArray>()
            synchronized(vhodniMutex) {
                stanje = StanjePovezave.PRIPRAVLJEN
                zaPosiljanje.addAll(vhodnaVrsta)
                vhodnaVrsta.clear()
            }
            for (okvir in zaPosiljanje) {
                posljiOkvirModelu(okvir)
            }
        }
        if (msg.contains("\"interrupted\"")) {
            naPrekinitev?.invoke()
        }
        val dataStr = izlusciBase64Audio(msg)
        if (dataStr != null) {
            val decoded = Base64.getDecoder().decode(dataStr)
            val resampled = resample24to16(decoded)
            var offset = 0
            while (offset < resampled.size) {
                val chunkSize = minOf(640, resampled.size - offset)
                val chunk = resampled.copyOfRange(offset, offset + chunkSize)
                if (chunk.size == 640) {
                    izhodniCallback?.invoke(chunk)
                } else {
                    val padded = ByteArray(640)
                    System.arraycopy(chunk, 0, padded, 0, chunk.size)
                    izhodniCallback?.invoke(padded)
                }
                offset += chunkSize
            }
        }
    }

    private fun izlusciBase64Audio(msg: String): String? {
        try {
            val elem = Json.parseToJsonElement(msg)
            val serverContent = elem.jsonObject["serverContent"]?.jsonObject ?: return null
            val modelTurn = serverContent["modelTurn"]?.jsonObject ?: return null
            val parts = modelTurn["parts"]?.jsonArray ?: return null
            for (p in parts) {
                val inlineData = p.jsonObject["inlineData"]?.jsonObject ?: continue
                return inlineData["data"]?.jsonPrimitive?.content
            }
        } catch (e: Exception) { }
        return null
    }

    override fun vKlic(okvir: ByteArray) {
        var needsConnect = false
        var isReady = false
        synchronized(vhodniMutex) {
            if (stanje == StanjePovezave.ZAPRT) {
                stanje = StanjePovezave.POVEZUJE
                needsConnect = true
            }
            if (stanje == StanjePovezave.PRIPRAVLJEN) {
                isReady = true
            } else {
                if (vhodnaVrsta.size >= MAKS_OKVIRJEV_V_VRSTI) {
                    vhodnaVrsta.removeFirst()
                }
                vhodnaVrsta.addLast(okvir)
            }
        }
        
        if (needsConnect) {
            poskusiPovezavo()
        }
        
        if (isReady) {
            posljiOkvirModelu(okvir)
        }
        
        // Timeout 10 min
        if (startTimeMs > 0 && System.currentTimeMillis() - startTimeMs > 600000) {
            konecKlica()
        }
    }

    private fun posljiOkvirModelu(okvir: ByteArray) {
        val encoded = Base64.getEncoder().encodeToString(okvir)
        val json = """
        {
            "realtimeInput": {
                "audio": {
                    "mimeType": "audio/pcm;rate=16000",
                    "data": "$encoded"
                }
            }
        }
        """.trimIndent()
        ws?.posiljiBesedilo(json)
    }

    override fun nastaviIzhod(posljiOkvir: (ByteArray) -> Unit) {
        izhodniCallback = posljiOkvir
    }

    override fun pocisti() {
        // Pusti pocisti() samo za izhodno vrsto, nobenega sporocila modelu.
    }

    override fun konecKlica() {
        if (!isClosed.getAndSet(true)) {
            ws?.zapri(1000, "Konec klica")
            ws = null
        }
    }

    private fun resample24to16(input: ByteArray): ByteArray {
        val numInputSamples = input.size / 2
        
        val inShorts = ShortArray(numInputSamples)
        for (i in 0 until numInputSamples) {
            val low = input[i * 2].toInt() and 0xFF
            val high = input[i * 2 + 1].toInt() shl 8
            inShorts[i] = (low or high).toShort()
        }
        
        // 15-tap FIR lowpass filter, fc = 5500 Hz at fs = 24000 Hz
        val firTaps = floatArrayOf(
            -0.0022f, 0.0047f, 0.0128f, -0.0174f, -0.0631f, 0.0341f, 0.3016f, 0.4589f,
            0.3016f, 0.0341f, -0.0631f, -0.0174f, 0.0128f, 0.0047f, -0.0022f
        )
        val filtered = FloatArray(numInputSamples)
        for (i in 0 until numInputSamples) {
            var sum = 0f
            for (j in 0 until 15) {
                val idx = i - j + 7 // center tap is at 7
                if (idx in 0 until numInputSamples) {
                    sum += inShorts[idx] * firTaps[j]
                }
            }
            filtered[i] = sum
        }
        
        val numOutputSamples = numInputSamples * 2 / 3
        val output = ByteArray(numOutputSamples * 2)
        
        for (i in 0 until numOutputSamples) {
            val inIdx = i * 1.5f
            val idx1 = inIdx.toInt()
            val idx2 = (idx1 + 1).coerceAtMost(numInputSamples - 1)
            val frac = inIdx - idx1
            
            val s1 = filtered[idx1]
            val s2 = filtered[idx2]
            val outS = (s1 * (1.0f - frac) + s2 * frac).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
            
            val s = outS.toInt()
            output[i * 2] = (s and 0xFF).toByte()
            output[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
        }
        
        return output
    }
}
