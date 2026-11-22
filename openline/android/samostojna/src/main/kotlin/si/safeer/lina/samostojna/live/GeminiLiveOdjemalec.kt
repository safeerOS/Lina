package si.safeer.lina.samostojna.live

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import si.safeer.lina.samostojna.DnevnikKlicev
import si.safeer.lina.samostojna.GoogleZeton
import si.safeer.lina.samostojna.SejaKlica
import si.safeer.lina.samostojna.ZapisKlica
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
    private val wsFabrika: WsFabrika,
    /** Ime uporabnika in rocni tozilnik za pozdrav osebne tajnice (lastnik 21. 11. 2026); prazno = »Dosegli ste glasovno tajnico.«. */
    private val imeUporabnika: () -> Pair<String, String> = { "" to "" },
    /** Casovni zapis poteka pozdrava (brez vsebine klica): »dvig«, »seja nared«, »uvod poslan«, »prvi zvok Line«, »konec obrata«. */
    private val casovniZapis: (String) -> Unit = {},
    // Diagnosticni zajem tistega, kar klicatelj sliši (glas Line, 16 kHz s16le mono). Samo izhod Line, nikoli glas klicatelja.
    private val zajemIzhoda: ((ByteArray) -> Unit)? = null
) : ZvocniMost {

    companion object {
        const val ORODJE_SPOROCILO = "shrani_sporocilo"
        const val ORODJE_KONEC = "koncaj_klic"
        /** Najdlje cakanje na konec Linega slovesa, preden se klic vseeno konca. */
        const val KONEC_VARNOSTNI_ROK_MS = 4000L
        /** Pocakamo, da se izgovor slovesa predvaja do konca (predvajalna vrsta), preden se klic prekine. */
        const val KONEC_PO_OBRATU_MS = 1500L
        const val UPORABI_CONFIG_NAMESTO_SETUP = false // uradna dokumentacija (get-started-websocket, 19. 11. 2026): vsi primeri uporabljajo "setup"
    }

    private enum class StanjePovezave {
        ZAPRT, POVEZUJE, SETUP_POSLAN, PRIPRAVLJEN
    }

    var naPrekinitev: (() -> Unit)? = null
    /** Lastnik 22. 11. 2026: ko se Lina poslovi, naj klic tudi prekine. Pokliče se po orodju koncaj_klic, ko je slovo izgovorjeno. */
    var naKonecPogovora: (() -> Unit)? = null
    private val koncajCaka = java.util.concurrent.atomic.AtomicBoolean(false)

    private fun sprozikKonec(cakaj: Long) {
        Thread({
            runCatching { Thread.sleep(cakaj) }
            if (koncajCaka.compareAndSet(true, false)) { casovniZapis("konec pogovora (Lina je klic prekinila)"); runCatching { naKonecPogovora?.invoke() } }
        }, "lina-konec-klica").start()
    }
    var naNapako: ((String) -> Unit)? = null
    /** Ob koncu klica: zapis (ime, stevilka, podjetje, sporocilo). Aplikacija ga zapise tudi v datoteko v mapi uporabnika. */
    var naKlicZakljucen: ((ZapisKlica) -> Unit)? = null
    /** Stevilka klicatelja za naslednji klic; nastavi jo aplikacija, preden se klic zacne. */
    @Volatile var stevilkaNaslednjegaKlica: String = ""
    @Volatile private var seja: SejaKlica? = null

    private var izhodniCallback: ((ByteArray) -> Unit)? = null
    
    private var ws: WsPovezava? = null
    private val isClosed = AtomicBoolean(false)
    private val stevecSistemskih = java.util.concurrent.atomic.AtomicLong(0)
    /** Enolicen id sistemskega zapisa (dva zapisa v isti milisekundi se sicer prepiseta). */
    private fun sistemskiId() = "sys-${System.currentTimeMillis()}-${stevecSistemskih.incrementAndGet()}"
    private var startTimeMs = 0L

    private var stanje = StanjePovezave.ZAPRT
    private val vhodniMutex = Any()
    private val vhodnaVrsta = ArrayDeque<ByteArray>()
    private val MAKS_OKVIRJEV_V_VRSTI = 100 // max ~2 s pri 20ms

    @Volatile private var nepopolnOkvir = ByteArray(0)
    // Prevzorcenje glasu Line 24->16 kHz s stanjem med kosi (brez klikanja na mejah kosov).
    private val prevzorcevalnik = Prevzorcevalnik24v16()

    // Hiter in neprekinjen pozdrav (lastnik 22. 11. 2026 po klicu ob 10.39: »ko se telefon oglasi, se mora Lina takoj oglasiti«,
    // »na zacetku se je dvakrat oglasila«):
    //  - predpriprava: seja z modelom se odpre ze ob dvigu klica (pripraviKlic), ne sele ob prvem zvocnem okvirju;
    //  - uvod (»Lina se predstavi.«) gre modelu sele, ko je zvocna pot nared (nastaviIzhod), in samo enkrat na klic;
    //  - med pozdravom zvok klicatelja ne gre modelu (sum, »halo« ali odmev bi pozdrav prekinil in model bi zacel znova).
    @Volatile private var predpripravaOd = 0L
    @Volatile private var uvodPoslan = false
    @Volatile private var prviZvokLine = false
    @Volatile private var uvodDo = 0L
    private val NAJDLJE_POZDRAV_MS = 15_000L
    private val PREDPRIPRAVA_VELJA_MS = 30_000L

    /** Ob dvigu klica: odpre sejo z modelom vnaprej, da je ob zacetku zvoka ze pripravljena. Napaka ni usodna (nastaviIzhod zacne znova). */
    fun pripraviKlic() {
        synchronized(vhodniMutex) {
            ws?.zapri(1000, "Nov klic")
            ws = null
            stanje = StanjePovezave.POVEZUJE
            vhodnaVrsta.clear()
            startTimeMs = 0L
            nepopolnOkvir = ByteArray(0)
            isClosed.set(false)
            izhodniCallback = null
            uvodPoslan = false
            prviZvokLine = false
            uvodDo = 0L
            predpripravaOd = System.currentTimeMillis()
        }
        casovniZapis("dvig klica, priprava seje")
        Thread({ runCatching { poskusiPovezavo() } }, "lina-live-priprava").start()
    }

    private fun posljiUvodCeNared() {
        val poslji = synchronized(vhodniMutex) {
            if (uvodPoslan || izhodniCallback == null || stanje != StanjePovezave.PRIPRAVLJEN || isClosed.get()) false
            else {
                uvodPoslan = true
                uvodDo = System.currentTimeMillis() + NAJDLJE_POZDRAV_MS
                true
            }
        }
        // gemini-3.8-live: besedilo gre prek realtimeInput.text (ai.google.dev, get-started-websocket)
        if (poslji) {
            casovniZapis("uvod poslan modelu")
            ws?.posiljiBesedilo("""{"realtimeInput":{"text":"Lina se predstavi."}}""")
        }
    }

    private fun maskirajSkrivnosti(besedilo: String): String {
        return besedilo.replace(Regex("key=[^&\\s]+"), "key=SKRITO").replace(Regex("Bearer\\s+[^&\\s]+"), "Bearer SKRITO")
    }

    private fun poskusiPovezavo(zacasnaNapaka: Boolean = false) {
        if (isClosed.get()) return
        val pot = izbiraPoti.izberi()
        if (pot == null) {
            dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                id = sistemskiId(),
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
                url = "${osnovniUrlApi}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=$kljuc"
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
                val sendSetup = synchronized(vhodniMutex) {
                    if (isClosed.get() || stanje == StanjePovezave.ZAPRT) {
                        povezava.zapri(1000, "Konec klica")
                        false
                    } else {
                        ws = povezava
                        stanje = StanjePovezave.SETUP_POSLAN
                        true
                    }
                }
                if (!sendSetup) return
                izbiraPoti.uspeh(pot)
                val (ime, tozilnik) = runCatching(imeUporabnika).getOrDefault("" to "")
                val sysNav = SistemskoNavodilo.zgradiZaKlic(ZonedDateTime.now(), ime, tozilnik)
                
                val keySetupStr = if (UPORABI_CONFIG_NAMESTO_SETUP && jeApiKljuc) "config" else "setup"
                val setup = buildJsonObject {
                    putJsonObject(keySetupStr) {
                        put("model", modelPath)
                        putJsonObject("systemInstruction") {
                            putJsonArray("parts") { add(buildJsonObject { put("text", sysNav) }) }
                        }
                        putJsonObject("generationConfig") {
                            putJsonArray("responseModalities") { add(JsonPrimitive("AUDIO")) }
                            // Izmerjeno 11. 11. 2026 (racunalniska pot, live/navodilo.ts): brez languageCode sl-SI model del izrekov razume kot hrvascino.
                            putJsonObject("speechConfig") {
                                put("languageCode", "sl-SI")
                                putJsonObject("voiceConfig") {
                                    putJsonObject("prebuiltVoiceConfig") { put("voiceName", "Kore") }
                                }
                            }
                        }
                        // Prepis govora klicatelja in Line: podlaga za dobesedni zapis klica.
                        putJsonObject("inputAudioTranscription") {}
                        putJsonObject("outputAudioTranscription") {}
                        putJsonArray("tools") {
                            add(buildJsonObject {
                                putJsonArray("functionDeclarations") {
                                    add(buildJsonObject {
                                        put("name", ORODJE_KONEC)
                                        put("description", "Konca klic. Poklici ga SAMO potem, ko si izrekla slovo in je klicatelj sporocilo zapisal ali ne zeli nic sporociti.")
                                        putJsonObject("parameters") { put("type", "OBJECT"); putJsonObject("properties") {} }
                                    })
                                    add(buildJsonObject {
                                        put("name", ORODJE_SPOROCILO)
                                        put("description", "Zapise sporocilo klicatelja. Poklici ga, ko klicatelj pove sporocilo, in ga pred koncem klica se enkrat dopolni z imenom, priimkom in podjetjem, ce so znani.")
                                        putJsonObject("parameters") {
                                            put("type", "OBJECT")
                                            putJsonObject("properties") {
                                                putJsonObject("ime") { put("type", "STRING"); put("description", "Ime klicatelja.") }
                                                putJsonObject("priimek") { put("type", "STRING"); put("description", "Priimek klicatelja.") }
                                                putJsonObject("podjetje") { put("type", "STRING"); put("description", "Podjetje klicatelja, samo ce ga je povedal.") }
                                                putJsonObject("sporocilo") { put("type", "STRING"); put("description", "Kratek povzetek sporocila, ki ga je klicatelj pustil.") }
                                            }
                                        }
                                    })
                                }
                            })
                        }
                    }
                }.toString()
                povezava.posiljiBesedilo(setup)
            }

            override fun onText(besedilo: String) {
                obdelajSporocilo(besedilo)
            }

            override fun onError(napaka: Throwable) {
                izbiraPoti.neuspeh(pot)
                val msg = napaka.message ?: napaka.javaClass.simpleName
                val varnoSporocilo = maskirajSkrivnosti(msg)
                dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                    id = sistemskiId(),
                    casZacetka = System.currentTimeMillis(),
                    stevilka = "Sistem",
                    trajanjeS = 0,
                    povzetek = "Napaka povezave: $varnoSporocilo",
                    prepis = ""
                ))
                synchronized(vhodniMutex) {
                    stanje = StanjePovezave.ZAPRT
                }
            }

            override fun onClose(koda: Int, razlog: String) {
                val maskiran = maskirajSkrivnosti(razlog)
                val textRazlog = if (maskiran.isBlank()) "brez razloga" else maskiran
                dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                    id = sistemskiId(),
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
                if (isClosed.get() || stanje == StanjePovezave.ZAPRT) {
                    novaWs.zapri(1000, "Konec klica")
                } else {
                    ws = novaWs
                }
            }
            startTimeMs = System.currentTimeMillis()
        } catch (e: Exception) {
            izbiraPoti.neuspeh(pot)
            val msg = e.message ?: e.javaClass.simpleName
            val varnoSporocilo = maskirajSkrivnosti(msg)
            dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                id = sistemskiId(),
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
                id = sistemskiId(),
                casZacetka = System.currentTimeMillis(),
                stevilka = "Sistem",
                trajanjeS = 0,
                povzetek = "Povezava z modelom je padla",
                prepis = ""
            ))
        }
    }

    /** Prepis govora (vhod = klicatelj, izhod = Lina) in klic orodja shrani_sporocilo; odgovor orodja gre modelu nazaj. */
    private fun obdelajPrepisInOrodje(msg: String) {
        if (!msg.contains("Transcription") && !msg.contains("toolCall")) return
        val s = seja ?: return
        try {
            val koren = Json.parseToJsonElement(msg).jsonObject
            koren["serverContent"]?.jsonObject?.let { sc ->
                sc["inputTranscription"]?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull?.let { s.dodajVhod(it) }
                sc["outputTranscription"]?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull?.let { s.dodajIzhod(it) }
            }
            if (msg.contains("\"turnComplete\"")) s.konecObrata()
            val klici = koren["toolCall"]?.jsonObject?.get("functionCalls")?.jsonArray ?: return
            val odgovori = klici.mapNotNull { k ->
                val f = k.jsonObject
                val ime = f["name"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                val id = f["id"]?.jsonPrimitive?.contentOrNull
                if (ime == ORODJE_KONEC && koncajCaka.compareAndSet(false, true)) {
                    // Slovo se izgovori do konca: klic se prekine po naslednjem koncu obrata, najpozneje po varnostnem roku.
                    sprozikKonec(KONEC_VARNOSTNI_ROK_MS)
                }
                if (ime == ORODJE_SPOROCILO) {
                    val a = f["args"]?.jsonObject
                    fun polje(n: String) = a?.get(n)?.jsonPrimitive?.contentOrNull
                    s.shraniSporocilo(polje("ime"), polje("priimek"), polje("podjetje"), polje("sporocilo"))
                }
                buildJsonObject {
                    if (id != null) put("id", id)
                    put("name", ime)
                    putJsonObject("response") { put("izid", when (ime) { ORODJE_SPOROCILO -> "zapisano"; ORODJE_KONEC -> "v redu"; else -> "neznano orodje" }) }
                }
            }
            if (odgovori.isNotEmpty()) {
                val odg = buildJsonObject {
                    putJsonObject("toolResponse") { putJsonArray("functionResponses") { odgovori.forEach { add(it) } } }
                }.toString()
                ws?.posiljiBesedilo(odg)
            }
        } catch (e: Exception) { }
    }

    /** Zapis klica ob koncu: vedno nastane, tudi ce zvok ni deloval (takrat z razlogom). */
    private fun zakljuciKlic() {
        val s = seja ?: return
        seja = null
        val zapis = s.zakljuci(System.currentTimeMillis())
        // Zapis ne sme izginiti zaradi enkratne napake shrambe: do trikrat poskusimo z istim zapisom.
        var shranjen = false
        for (poskus in 0 until 3) { if (dnevnik.dodaj(zapis)) { shranjen = true; break } }
        if (!shranjen) {
            naNapako?.invoke("Zapisa klica ni bilo mogoče shraniti")
            return
        }
        try { naKlicZakljucen?.invoke(zapis) } catch (e: Exception) { }
    }

    private fun obdelajSporocilo(msg: String) {
        obdelajPrepisInOrodje(msg)
        if (msg.contains("\"setupComplete\"")) {
            val zaPosiljanje = mutableListOf<ByteArray>()
            val doSend = synchronized(vhodniMutex) {
                if (isClosed.get() || stanje == StanjePovezave.ZAPRT) {
                    false
                } else {
                    stanje = StanjePovezave.PRIPRAVLJEN
                    zaPosiljanje.addAll(vhodnaVrsta)
                    vhodnaVrsta.clear()
                    true
                }
            }
            if (doSend) {
                // Uvod samo enkrat in sele z zvocno potjo. Okvirji, zbrani pred pripravljeno sejo (sum pred pozdravom), se zavrzejo:
                // model bi jih vzel kot govor klicatelja in pozdrav prekinil (klic 22. 11. 2026 ob 10.39: dva pozdrava).
                posljiUvodCeNared()
            }
        }
        if (msg.contains("\"interrupted\"")) {
            nepopolnOkvir = ByteArray(0)
            naPrekinitev?.invoke()
        }
        val dataStrs = izlusciBase64Audio(msg)
        for (dataStr in dataStrs) {
            val decoded = Base64.getDecoder().decode(dataStr)
            val skupaj = nepopolnOkvir + prevzorcevalnik.obdelaj(decoded)
            var offset = 0
            while (skupaj.size - offset >= 640) {
                if (!prviZvokLine) { prviZvokLine = true; casovniZapis("prvi zvok Line klicatelju") }
                val okvir = skupaj.copyOfRange(offset, offset + 640)
                zajemIzhoda?.invoke(okvir)
                izhodniCallback?.invoke(okvir)
                offset += 640
            }
            nepopolnOkvir = skupaj.copyOfRange(offset, skupaj.size)
        }
        // Ob koncu govora ostanek dopolnimo s tisino do polnega okvirja (20 ms = 640 B).
        if (msg.contains("\"turnComplete\"")) {
            izprazniOstanek()
            // Pozdrav je izrecen: od zdaj model poslusa klicatelja.
            uvodDo = 0L
            casovniZapis("konec obrata Line")
            if (koncajCaka.get()) { sprozikKonec(KONEC_PO_OBRATU_MS) }
        }
    }

    private fun izprazniOstanek() {
        if (nepopolnOkvir.isNotEmpty()) {
            val padded = ByteArray(640)
            System.arraycopy(nepopolnOkvir, 0, padded, 0, minOf(640, nepopolnOkvir.size))
            nepopolnOkvir = ByteArray(0)
            zajemIzhoda?.invoke(padded)
            izhodniCallback?.invoke(padded)
        }
    }

    private fun izlusciBase64Audio(msg: String): List<String> {
        val rezultati = mutableListOf<String>()
        try {
            val elem = Json.parseToJsonElement(msg)
            val serverContent = elem.jsonObject["serverContent"]?.jsonObject ?: return rezultati
            val modelTurn = serverContent["modelTurn"]?.jsonObject ?: return rezultati
            val parts = modelTurn["parts"]?.jsonArray ?: return rezultati
            for (p in parts) {
                val inlineData = p.jsonObject["inlineData"]?.jsonObject ?: continue
                val data = inlineData["data"]?.jsonPrimitive?.content
                if (data != null) rezultati.add(data)
            }
        } catch (e: Exception) { }
        return rezultati
    }

    override fun vKlic(okvir: ByteArray) {
        if (isClosed.get()) return
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
        
        // Med pozdravom (do prvega turnComplete, najvec 15 s) zvok klicatelja ne gre modelu.
        if (isReady && !(uvodDo > 0L && System.currentTimeMillis() < uvodDo)) {
            posljiOkvirModelu(okvir)
        }
        
        if (stanje != StanjePovezave.PRIPRAVLJEN && startTimeMs > 0 && System.currentTimeMillis() - startTimeMs > 5000) {
            dnevnik.dodaj(si.safeer.lina.samostojna.ZapisKlica(
                id = sistemskiId(),
                casZacetka = System.currentTimeMillis(),
                stevilka = "Sistem",
                trajanjeS = 0,
                povzetek = "Povezava z modelom ni bila vzpostavljena v 5 s",
                prepis = ""
            ))
            naNapako?.invoke("Model se ni odzval v 5 s")
            konecKlica()
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
        // Prehod to pokliče ob vsaki novi medijski povezavi = začetek novega klica:
        // odjemalec se zato vrne v izhodiščno stanje in ga je mogoče uporabiti znova.
        // Sveza predpripravljena seja (pripraviKlic ob dvigu) se ohrani; sicer izhodiscno stanje kot prej.
        val ohrani = synchronized(vhodniMutex) {
            val sveza = predpripravaOd > 0L && System.currentTimeMillis() - predpripravaOd < PREDPRIPRAVA_VELJA_MS &&
                stanje != StanjePovezave.ZAPRT && !isClosed.get()
            predpripravaOd = 0L
            if (!sveza) {
                ws?.zapri(1000, "Nov klic")
                ws = null
                stanje = StanjePovezave.ZAPRT
                vhodnaVrsta.clear()
                startTimeMs = 0L
                nepopolnOkvir = ByteArray(0)
                isClosed.set(false)
                uvodPoslan = false
            prviZvokLine = false
                uvodDo = 0L
            }
            sveza
        }
        // Klic, ki je ostal odprt (brez konecKlica), se zapise, preden se zacne nov.
        zakljuciKlic()
        seja = SejaKlica(System.currentTimeMillis(), stevilkaNaslednjegaKlica)
        izhodniCallback = posljiOkvir
        if (ohrani) posljiUvodCeNared()
    }

    override fun pocisti() {
        // Pusti pocisti() samo za izhodno vrsto, nobenega sporocila modelu.
    }

    override fun konecKlica() {
        if (!isClosed.getAndSet(true)) {
            nepopolnOkvir = ByteArray(0)
            synchronized(vhodniMutex) {
                ws?.zapri(1000, "Konec klica")
                ws = null
                stanje = StanjePovezave.ZAPRT
            }
            zakljuciKlic()
        }
    }
}
