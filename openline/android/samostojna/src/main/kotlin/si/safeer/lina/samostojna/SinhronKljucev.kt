package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Kljuc v uporabi za ponudnika na tem telefonu (obstojeca shramba v Keystore, ShranjevalnikKljuca na ponudnika). */
interface SlotiKljucev {
    fun preberi(): Map<String, String>
    /** null = odstrani */
    fun zapisi(ponudnik: String, vrednost: String?)
}

@Serializable
private data class ZapisNaDisku(
    val id: String, val ponudnik: String, val oznaka: String, val cas: Long, val naprava: String, val izbrisan: Boolean, val prej: String, val vrednost: String,
)

@Serializable
private data class ShranjenoNaDisku(
    val v: Int = 1,
    val zasebni: String,
    val javni: String,
    val javniRacunalnika: String? = null,
    val zapisi: List<ZapisNaDisku> = emptyList(),
    val aktivni: Map<String, String> = emptyMap(),
    val uvozeno: Boolean = false,
    val neposlani: List<String> = emptyList(),
    val odstranjeni: List<String> = emptyList(),
)

/** Stanje uskladitve kljucev (z vrednostmi in zasebnim kljucem para) kot EN sifriran zapis v [shramba] (Keystore na telefonu). */
class ShrambaUskladitve(private val shramba: ShranjevalnikKljuca) {
    data class Vse(val stanje: StanjeKljucev, val par: KljuciMozganov.Par, val javniRacunalnika: String?, val odstranjeni: List<String>)

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** Ob prvem branju ustvari par; pokvarjen zapis = null (uskladitev se ne izvede, nic ne prepise). */
    @Synchronized fun preberi(): Vse? {
        val surovo = try { shramba.preberi()?.izpostavi() } catch (_: Exception) { return null }
        if (surovo == null) return KljuciMozganov.noviPar().let { Vse(StanjeKljucev(), it, null, emptyList()) }
        val d = try { json.decodeFromString<ShranjenoNaDisku>(surovo) } catch (_: Exception) { return null }
        val zapisi = d.zapisi.map { ZapisKljuca(it.id, it.ponudnik, it.oznaka, it.cas, it.naprava, it.izbrisan, it.prej, it.vrednost) }
        return Vse(StanjeKljucev(zapisi, d.aktivni, d.uvozeno, d.neposlani), KljuciMozganov.Par(d.zasebni, d.javni), d.javniRacunalnika, d.odstranjeni)
    }

    @Synchronized fun shrani(v: Vse) {
        val d = ShranjenoNaDisku(
            zasebni = v.par.zasebni, javni = v.par.javni, javniRacunalnika = v.javniRacunalnika,
            zapisi = v.stanje.zapisi.map { ZapisNaDisku(it.id, it.ponudnik, it.oznaka, it.cas, it.naprava, it.izbrisan, it.prej, it.vrednost) },
            aktivni = v.stanje.aktivni, uvozeno = v.stanje.uvozeno, neposlani = v.stanje.neposlani, odstranjeni = v.odstranjeni,
        )
        shramba.shrani(KljucGemini(json.encodeToString(d)))
    }
}

/**
 * Izmenjava kljucev za mozgane z racunalnikom (POST /kljuci, NALOGA-35). [poslji] dobi vsebino (JSON) in vrne telo odgovora ali null
 * (podpis naprave in prenos naredi aplikacija). Stanje se shrani SAMO po veljavnem odgovoru in uspelem zapisu slotov (brez izgube).
 */
object SinhronKljucev {
    private const val NAJVEC_KROGOV = 3

    fun privzetaOznaka(p: String): String = when (p) {
        "gemini" -> "Gemini"; "openai" -> "OpenAI"; "claude" -> "Claude"; "grok" -> "Grok"; "openrouter" -> "OpenRouter"; else -> p
    }

    fun izmenjaj(shramba: ShrambaUskladitve, sloti: SlotiKljucev, jaz: String, zdaj: () -> Long, poslji: (String) -> String?): Boolean {
        repeat(NAJVEC_KROGOV) {
            val vse = shramba.preberi() ?: return false
            val slotiPrej = try { sloti.preberi() } catch (_: Exception) { return false }
            val (st, poslani) = KljuciMozganov.pripravi(vse.stanje, slotiPrej, jaz, zdaj(), ::privzetaOznaka)
            val kljuc = vse.javniRacunalnika?.let { KljuciMozganov.javniKljuc(it) }?.let { KljuciMozganov.kljucPara(vse.par.zasebni, it, jaz) }
            // brez znanega kljuca racunalnika (prva izmenjava) gre samo javni kljuc para; zapisi sledijo v naslednjem krogu
            val naZici = if (kljuc == null) emptyList() else poslani.map { KljuciMozganov.zaZico(it, kljuc, KljuciMozganov.SMER_TR) }
            val telo = poslji(KljuciMozganov.vsebina(vse.par.javni, naZici)) ?: return false
            val odg = KljuciMozganov.odgovor(telo) ?: return false
            val javniR = KljuciMozganov.javniKljuc(odg.javni) ?: return false
            val k = KljuciMozganov.kljucPara(vse.par.zasebni, javniR, jaz)
            val prejeti = odg.zapisi.mapNotNull { KljuciMozganov.zZice(it, k, KljuciMozganov.SMER_RT) }
            val slotiZdaj = try { sloti.preberi() } catch (_: Exception) { return false }
            val po = KljuciMozganov.poOdgovoru(st, if (kljuc == null) emptyList() else poslani, prejeti, slotiPrej, slotiZdaj, jaz, zdaj(), ::privzetaOznaka)
            try {
                for ((p, v) in po.uporaba.sloti) sloti.zapisi(p, v)
            } catch (_: Exception) { return false }
            shramba.shrani(ShrambaUskladitve.Vse(po.stanje, vse.par, odg.javni, (vse.odstranjeni + po.uporaba.odstranjeni).distinct()))
            if (!po.znova) return true
        }
        return true
    }

    // ---- Vmesnik na telefonu (Nastavitve > Kljuci): seznam brez vrednosti, dodaj z oznako, uporabi, odstrani -------------------

    data class Prikaz(val id: String, val ponudnik: String, val oznaka: String, val namig: String, val vUporabi: Boolean, val izTegaTelefona: Boolean)

    fun seznam(shramba: ShrambaUskladitve, jaz: String): List<Prikaz> {
        val v = shramba.preberi() ?: return emptyList()
        return v.stanje.zapisi.filter { !it.izbrisan }.sortedWith(compareBy<ZapisKljuca> { it.ponudnik }.thenByDescending { it.cas }).map {
            Prikaz(it.id, it.ponudnik, it.oznaka, KljuciMozganov.namig(it.vrednost), v.stanje.aktivni[it.ponudnik] == it.id, it.naprava == jaz)
        }
    }

    /**
     * Lokalno dejanje: najprej zajame lastne spremembe slotov (da gumb ne izgubi pravkar vpisanega kljuca), nato [f] spremeni nabor.
     * Vrne null ob uspehu ali razlog (kljuc besedila).
     */
    private fun dejanje(
        shramba: ShrambaUskladitve, sloti: SlotiKljucev, jaz: String, zdaj: Long,
        f: (StanjeKljucev, Map<String, String>) -> Pair<StanjeKljucev, Map<String, String?>>?,
    ): String? {
        val v = shramba.preberi() ?: return "napaka"
        val zdajSloti = sloti.preberi()
        // pred prvo izmenjavo ni uvoza (prvi odgovor racunalnika pove, kateri kljuci ze obstajajo - brez dvojnikov)
        val st0 = if (v.stanje.uvozeno) KljuciMozganov.pripravi(v.stanje, zdajSloti, jaz, zdaj, ::privzetaOznaka).first else v.stanje
        val (st, pisi) = f(st0, zdajSloti) ?: return "ni"
        for ((p, vr) in pisi) sloti.zapisi(p, vr)
        shramba.shrani(v.copy(stanje = st))
        return null
    }

    private fun spremeni(st: StanjeKljucev, z: ZapisKljuca, nov: ZapisKljuca, jaz: String, zdaj: Long): StanjeKljucev {
        val n = nov.copy(cas = KljuciMozganov.novCas(zdaj, z.cas), naprava = jaz, prej = z.razlicica)
        return st.copy(zapisi = st.zapisi.map { if (it.id == z.id) n else it }, neposlani = (st.neposlani + z.id).distinct())
    }

    fun dodaj(shramba: ShrambaUskladitve, sloti: SlotiKljucev, jaz: String, zdaj: Long, ponudnik: String, oznaka: String, kljuc: String): String? {
        val o = oznaka.trim(); val k = kljuc.trim()
        if (!KljuciMozganov.jePonudnik(ponudnik)) return "ponudnik"
        if (!KljuciMozganov.veljavnaVrednost(k)) return "kljuc"
        if (!KljuciMozganov.veljavnaOznaka(o)) return "oznaka"
        return dejanje(shramba, sloti, jaz, zdaj) { st, zdajSloti ->
            if (st.zapisi.any { it.ponudnik == ponudnik && !it.izbrisan && it.vrednost == k }) return@dejanje null
            if (st.zapisi.count { !it.izbrisan } >= KljuciMozganov.NAJVEC_ZIVIH) return@dejanje null
            val z = ZapisKljuca(KljuciMozganov.novId(), ponudnik, o, zdaj, jaz, false, "", k)
            // v uporabo samo na praznem mestu (obstojec kljuc v Keystore ostane, tudi ce se ni v naboru)
            val prazen = st.aktivni[ponudnik] == null && zdajSloti[ponudnik].isNullOrEmpty()
            st.copy(zapisi = st.zapisi + z, neposlani = st.neposlani + z.id, aktivni = if (prazen) st.aktivni + (ponudnik to z.id) else st.aktivni) to
                (if (prazen) mapOf(ponudnik to k) else emptyMap())
        }
    }

    fun uporabi(shramba: ShrambaUskladitve, sloti: SlotiKljucev, jaz: String, zdaj: Long, id: String): String? =
        dejanje(shramba, sloti, jaz, zdaj) { st, _ ->
            val z = st.zapisi.firstOrNull { it.id == id && !it.izbrisan } ?: return@dejanje null
            st.copy(aktivni = st.aktivni + (z.ponudnik to z.id)) to mapOf(z.ponudnik to z.vrednost)
        }

    /** Odstrani na vseh napravah (grob); ce je bil v uporabi, ponudnik na telefonu ostane brez kljuca (brez samodejnega preklopa). */
    fun odstrani(shramba: ShrambaUskladitve, sloti: SlotiKljucev, jaz: String, zdaj: Long, id: String): String? =
        dejanje(shramba, sloti, jaz, zdaj) { st, _ ->
            val z = st.zapisi.firstOrNull { it.id == id && !it.izbrisan } ?: return@dejanje null
            val s1 = spremeni(st, z, z.copy(izbrisan = true, vrednost = ""), jaz, zdaj)
            if (st.aktivni[z.ponudnik] != z.id) s1 to emptyMap()
            else s1.copy(aktivni = s1.aktivni - z.ponudnik) to mapOf(z.ponudnik to null)
        }

    fun preimenuj(shramba: ShrambaUskladitve, sloti: SlotiKljucev, jaz: String, zdaj: Long, id: String, oznaka: String): String? {
        val o = oznaka.trim()
        if (!KljuciMozganov.veljavnaOznaka(o)) return "oznaka"
        return dejanje(shramba, sloti, jaz, zdaj) { st, _ ->
            val z = st.zapisi.firstOrNull { it.id == id && !it.izbrisan } ?: return@dejanje null
            spremeni(st, z, z.copy(oznaka = o), jaz, zdaj) to emptyMap()
        }
    }

    /** Ponudniki, katerih kljuc v uporabi je bil odstranjen na drugi napravi (obvestilo), in potrditev obvestila. */
    fun odstranjeni(shramba: ShrambaUskladitve): List<String> = shramba.preberi()?.odstranjeni.orEmpty()
    fun potrdiObvestilo(shramba: ShrambaUskladitve) { shramba.preberi()?.let { shramba.shrani(it.copy(odstranjeni = emptyList())) } }
}
