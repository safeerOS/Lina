package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Kljuci za mozgane na vseh seznanjenih napravah (lastnik 26. 11. 2026, NALOGA-35). Dvojnik racunalniskega kljuci-mozganov.ts
 * (ista pravila, isti niz AAD in HKDF; skupni vektor v KljuciMozganovTest). Velja novejsi po (cas, naprava, izbrisan); izbris je grob.
 * Racunalnik je zvezdisce: telefon poslje samo NEPOSLANE spremembe in sprejme celoten nabor racunalnika; kopijo spora naredi racunalnik.
 */
data class ZapisKljuca(
    val id: String,
    val ponudnik: String,
    val oznaka: String,
    val cas: Long,
    val naprava: String,
    val izbrisan: Boolean,
    val prej: String,
    /** "" pri grobu */
    val vrednost: String,
) {
    val razlicica: String get() = "$cas/$naprava"
    override fun toString(): String = "ZapisKljuca($id, $ponudnik, $oznaka, $cas, $naprava, izbrisan=$izbrisan)" // nikoli vrednost
}

/** Stanje na telefonu; [aktivni] = ponudnik -> id zapisa, ki ga ta telefon uporablja (izbira je lokalna). */
data class StanjeKljucev(
    val zapisi: List<ZapisKljuca> = emptyList(),
    val aktivni: Map<String, String> = emptyMap(),
    val uvozeno: Boolean = false,
    val neposlani: List<String> = emptyList(),
)

/** Kaj gre v slote telefona: vrednost = vpisi, null = odstrani (oddaljen izbris kljuca v uporabi). */
data class UporabaKljucev(val sloti: Map<String, String?>, val aktivni: Map<String, String>, val odstranjeni: List<String>) {
    override fun toString(): String = "UporabaKljucev(sloti=${sloti.keys}, odstranjeni=$odstranjeni)" // nikoli vrednost
}

@Serializable
data class Ovojnica(val v: Int, val iv: String, val ct: String, val tag: String)

object KljuciMozganov {
    val PONUDNIKI = listOf("gemini", "openai", "claude", "grok", "openrouter")
    const val CAS_UVOZA = 1L
    const val NAJVEC_NAPREJ_MS = 10 * 60 * 1000L
    const val NAJVEC_ZIVIH = 40
    const val NAJVEC_GROBOV = 100
    const val NAJVEC_OZNAKA = 40
    const val NAMEN = "lina-kljuci-mozganov-v1"
    private const val NAMEN_OVOJNICE = "lina-kljuci-v1"
    const val SMER_TR = "telefon-racunalnik"
    const val SMER_RT = "racunalnik-telefon"
    /** aktivni[p] = BREZ: kljuc v uporabi je bil odstranjen; prazno mesto se ne zapolni samo (kot BREZ v TS). */
    const val BREZ = "-"
    private val ID = Regex("^[0-9a-f]{16}$")
    private val NAPRAVA = Regex("^[A-Za-z0-9._-]{1,80}$")
    private val PREJ = Regex("^$|^[0-9]{1,16}/[A-Za-z0-9._-]{1,80}$")
    private val NEDOVOLJENI_OZNAKA = Regex("[\\x00-\\x1F\\x7F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]")
    // kljuc API: samo natisljiv ASCII brez presledka, enako kot kljuci-mozganov.ts (\\s se med JS in Androidom/ICU razlikuje)
    private val VREDNOST = Regex("^[\\x21-\\x7E]{8,400}$")
    private val POLJA = setOf("id", "ponudnik", "oznaka", "cas", "naprava", "izbrisan", "prej", "vrednost")
    private val nakljucje = SecureRandom()
    private val json = Json { ignoreUnknownKeys = false }

    fun jePonudnik(p: String): Boolean = p in PONUDNIKI
    fun veljavnaOznaka(o: String): Boolean = o.trim { it.isWhitespace() || it == '\uFEFF' }.isNotEmpty() && o.length <= NAJVEC_OZNAKA && !NEDOVOLJENI_OZNAKA.containsMatchIn(o)
    fun veljavnaVrednost(v: String): Boolean = VREDNOST.matches(v)

    fun novejsi(a: ZapisKljuca, b: ZapisKljuca): Boolean = when {
        a.cas != b.cas -> a.cas > b.cas
        a.naprava != b.naprava -> a.naprava > b.naprava // primerjava po kodnih enotah kot JS (id naprav so ASCII)
        else -> a.izbrisan && !b.izbrisan
    }

    fun veljaven(z: ZapisKljuca, zdaj: Long): Boolean =
        ID.matches(z.id) && jePonudnik(z.ponudnik) && veljavnaOznaka(z.oznaka) && z.cas >= CAS_UVOZA && z.cas <= zdaj + NAJVEC_NAPREJ_MS &&
            NAPRAVA.matches(z.naprava) && PREJ.matches(z.prej) && (if (z.izbrisan) z.vrednost.isEmpty() else veljavnaVrednost(z.vrednost))

    fun idSpora(z: ZapisKljuca): String = sha256Hex("lina-kljuci-spor-v1|${z.id}|${z.cas}|${z.naprava}").substring(0, 16)

    fun oznakaSpora(o: String): String {
        val pripona = " (spor)"
        return if (o.endsWith(pripona)) o else o.take(NAJVEC_OZNAKA - pripona.length).trimEnd() + pripona
    }

    private fun izgubljenaVrednost(zm: ZapisKljuca, po: ZapisKljuca): Boolean {
        if (po.izbrisan) return false
        if (!zm.izbrisan && zm.vrednost == po.vrednost) return false
        return zm.prej != po.razlicica
    }

    /** Kot zdruzi v kljuci-mozganov.ts; [kopije] samo na racunalniku (telefon jih ne dela). Rezultat urejen po id. */
    fun zdruzi(lokalni: List<ZapisKljuca>, prejeti: List<ZapisKljuca>, zdaj: Long, kopije: Boolean = false): List<ZapisKljuca> {
        val m = LinkedHashMap<String, ZapisKljuca>()
        for (z in lokalni) m[z.id] = z
        fun zivih() = m.values.count { !it.izbrisan }
        fun dodaj(z: ZapisKljuca): Boolean {
            if (m.containsKey(z.id)) return false
            if (!z.izbrisan && zivih() >= NAJVEC_ZIVIH) return false
            m[z.id] = z
            return true
        }
        for (z in prejeti.take(NAJVEC_ZIVIH + NAJVEC_GROBOV)) {
            if (!veljaven(z, zdaj)) continue
            val l = m[z.id]
            if (l == null) { dodaj(z); continue }
            if (l.ponudnik != z.ponudnik) continue
            if (l.razlicica == z.razlicica && l.izbrisan == z.izbrisan) continue
            val zmaga = novejsi(z, l)
            val (zm, po) = if (zmaga) z to l else l to z
            if (kopije && izgubljenaVrednost(zm, po)) dodaj(po.copy(id = idSpora(po), oznaka = oznakaSpora(po.oznaka), prej = ""))
            if (zmaga) m[z.id] = z
        }
        val grobovi = m.values.filter { it.izbrisan }.sortedWith(compareByDescending<ZapisKljuca> { it.cas }.thenBy { it.id })
        for (g in grobovi.drop(NAJVEC_GROBOV)) m.remove(g.id)
        return m.values.sortedBy { it.id }
    }

    fun novCas(zdaj: Long, prejsnji: Long): Long = maxOf(zdaj, prejsnji + 1)
    fun novId(): String = ByteArray(8).also { nakljucje.nextBytes(it) }.joinToString("") { "%02x".format(it) }

    data class Lokalne(val zapisi: List<ZapisKljuca>, val aktivni: Map<String, String>, val spremenjeni: List<String>)

    /** Kot lokalneSpremembe v TS: slot (kljuc v uporabi) proti aktivnemu zapisu; prazen slot ob zivem zapisu = lokalna odstranitev. */
    fun lokalneSpremembe(
        zapisi: List<ZapisKljuca>, aktivni: Map<String, String>, sloti: Map<String, String>, jaz: String, zdaj: Long, uvoz: Boolean,
        privzetaOznaka: (String) -> String, neznani: Set<String> = emptySet(),
    ): Lokalne {
        val m = LinkedHashMap<String, ZapisKljuca>()
        for (z in zapisi) m[z.id] = z
        val akt = aktivni.toMutableMap()
        val spremenjeni = ArrayList<String>()
        for (p in PONUDNIKI) {
            if (p in neznani) continue // neberljiv slot (Keystore) ni ne sprememba ne izbris
            val v = sloti[p].orEmpty()
            val a = akt[p]?.let { m[it] }
            if (v.isNotEmpty()) {
                if (!veljavnaVrednost(v)) continue
                if (a != null && !a.izbrisan && a.vrednost == v) continue
                val enak = m.values.firstOrNull { it.ponudnik == p && !it.izbrisan && it.vrednost == v }
                if (enak != null) { akt[p] = enak.id; continue }
                if (a != null && !a.izbrisan) {
                    m[a.id] = a.copy(cas = novCas(zdaj, a.cas), naprava = jaz, prej = a.razlicica, vrednost = v)
                    spremenjeni.add(a.id)
                    continue
                }
                if (m.values.count { !it.izbrisan } >= NAJVEC_ZIVIH) continue
                val n = ZapisKljuca(novId(), p, privzetaOznaka(p), if (uvoz) CAS_UVOZA else zdaj, jaz, false, "", v)
                m[n.id] = n
                akt[p] = n.id
                spremenjeni.add(n.id)
            } else if (a != null && !a.izbrisan) {
                m[a.id] = a.copy(cas = novCas(zdaj, a.cas), naprava = jaz, izbrisan = true, prej = a.razlicica, vrednost = "")
                spremenjeni.add(a.id)
            }
        }
        return Lokalne(m.values.toList(), akt, spremenjeni)
    }

    /** Kot zaUporabo v TS: prejet zapis nikoli ne izbere ponudnika (B9); spremeni kljuc aktivnega, ga odstrani ali zapolni PRAZNO mesto. */
    fun zaUporabo(zapisi: List<ZapisKljuca>, aktivni: Map<String, String>, sloti: Map<String, String>, neznani: Set<String> = emptySet()): UporabaKljucev {
        val m = zapisi.associateBy { it.id }
        val akt = aktivni.toMutableMap()
        val izhod = LinkedHashMap<String, String?>()
        val odstranjeni = ArrayList<String>()
        for (p in PONUDNIKI) {
            if (p in neznani) continue
            val a = akt[p]?.let { m[it] }
            val v = sloti[p].orEmpty()
            // lastnikov vnos, ki ga uskladitev ne sprejme, ostane - ne prepise se s staro vrednostjo
            if (v.isNotEmpty() && !veljavnaVrednost(v)) continue
            if (a != null && a.izbrisan) {
                akt[p] = BREZ
                if (v.isNotEmpty()) { izhod[p] = null; odstranjeni.add(p) }
                continue
            }
            if (a != null) {
                if (a.vrednost != v) izhod[p] = a.vrednost
                continue
            }
            if (v.isNotEmpty()) continue
            if (akt[p] == BREZ) continue // po odstranitvi kljuca v uporabi lastnik izbere sam (slepi S1)
            val kandidat = m.values.filter { it.ponudnik == p && !it.izbrisan }.reduceOrNull { a, b -> if (novejsi(b, a)) b else a }
            if (kandidat != null) { akt[p] = kandidat.id; izhod[p] = kandidat.vrednost }
        }
        return UporabaKljucev(izhod, akt, odstranjeni)
    }

    /** Pred zahtevo (pripraviTelefon v TS). Pred prvo izmenjavo nic ne uvaza in nic ne poslje. */
    fun pripravi(
        st: StanjeKljucev, sloti: Map<String, String>, jaz: String, zdaj: Long, privzetaOznaka: (String) -> String, neznani: Set<String> = emptySet(),
    ): Pair<StanjeKljucev, List<ZapisKljuca>> {
        if (!st.uvozeno) return st to emptyList()
        val l = lokalneSpremembe(st.zapisi, st.aktivni, sloti, jaz, zdaj, false, privzetaOznaka, neznani)
        val neposlani = (st.neposlani + l.spremenjeni).distinct()
        val m = l.zapisi.associateBy { it.id }
        return st.copy(zapisi = l.zapisi, aktivni = l.aktivni, neposlani = neposlani) to neposlani.mapNotNull { m[it] }
    }

    data class PoOdgovoru(val stanje: StanjeKljucev, val uporaba: UporabaKljucev, val znova: Boolean)

    /** Po odgovoru (poOdgovoruTelefona v TS): nabor racunalnika + lastne neposlane; kljuc, spremenjen MED izmenjavo, ostane lastnikov. */
    fun poOdgovoru(
        st: StanjeKljucev, poslani: List<ZapisKljuca>, odgovor: List<ZapisKljuca>, slotiPrej: Map<String, String>, slotiZdaj: Map<String, String>,
        jaz: String, zdaj: Long, privzetaOznaka: (String) -> String, neznani: Set<String> = emptySet(),
    ): PoOdgovoru {
        val nabor = zdruzi(emptyList(), odgovor, zdaj)
        val potrjeni = poslani.filter { p -> nabor.any { it.id == p.id && it.razlicica == p.razlicica && it.izbrisan == p.izbrisan } }.map { it.id }.toSet()
        val vNaboru = nabor.map { it.id }.toSet()
        // zivi zapis telefona, ki ga racunalnik nima (nov ali obnovljen racunalnik): ne zavrzi ga, poslji ga znova
        val svoji = st.zapisi.filter { (it.id in st.neposlani && it.id !in potrjeni) || (!it.izbrisan && it.id !in vNaboru) }
        var zapisi = zdruzi(nabor, svoji, zdaj)
        var neposlani = svoji.filter { s -> zapisi.any { it.id == s.id && it.razlicica == s.razlicica && it.izbrisan == s.izbrisan } }.map { it.id }
        val u = zaUporabo(zapisi, st.aktivni, slotiPrej, neznani)
        val sloti = u.sloti.toMutableMap()
        var odstranjeni = u.odstranjeni
        var aktivni = u.aktivni
        var znova = neposlani.isNotEmpty()
        for (p in PONUDNIKI) {
            if (slotiZdaj[p].orEmpty() == slotiPrej[p].orEmpty()) continue
            sloti.remove(p)
            odstranjeni = odstranjeni.filter { it != p }
            znova = true
        }
        if (!st.uvozeno) {
            val efektivni = slotiPrej.toMutableMap()
            for ((p, v) in sloti) if (v == null) efektivni.remove(p) else efektivni[p] = v
            val l = lokalneSpremembe(zapisi, aktivni, efektivni, jaz, zdaj, true, privzetaOznaka, neznani)
            zapisi = l.zapisi
            aktivni = l.aktivni
            neposlani = (neposlani + l.spremenjeni).distinct()
            znova = znova || l.spremenjeni.isNotEmpty()
        }
        // ob neberljivem slotu uvoz se ni koncan (kot korakRacunalnika v TS)
        return PoOdgovoru(StanjeKljucev(zapisi, aktivni, st.uvozeno || neznani.isEmpty(), neposlani), UporabaKljucev(sloti, aktivni, odstranjeni), znova)
    }

    // ---- Ovoj para (ECDH P-256 + HKDF-SHA256 + AES-256-GCM), enako kot kljuci-sinhron.ts / kljuci-mozganov.ts ----------------

    data class Par(val zasebni: String, val javni: String) {
        override fun toString(): String = "Par(javni=$javni)" // nikoli zasebni kljuc
    }

    fun noviPar(): Par {
        val g = KeyPairGenerator.getInstance("EC")
        g.initialize(ECGenParameterSpec("secp256r1"))
        val p = g.generateKeyPair()
        return Par(Base64.getEncoder().encodeToString(p.private.encoded), Base64.getEncoder().encodeToString(p.public.encoded))
    }

    fun javniKljuc(b64: String): PublicKey? = try {
        if (b64.length > 200) null
        else (KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(b64))) as? ECPublicKey)
            ?.takeIf { it.params.curve.field.fieldSize == 256 }
    } catch (_: Exception) { null }

    private fun zasebniKljuc(b64: String): PrivateKey = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(b64)))

    fun solPara(idTelefona: String): ByteArray = MessageDigest.getInstance("SHA-256").digest("$NAMEN|$idTelefona".toByteArray(Charsets.UTF_8))

    private fun hmac(kljuc: ByteArray, podatki: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(kljuc, "HmacSHA256")); doFinal(podatki) }

    /** HKDF-SHA256 (RFC 5869) na 32 bajtov, kot node hkdfSync("sha256", skrivnost, sol, NAMEN_OVOJNICE, 32). */
    fun hkdf(skrivnost: ByteArray, sol: ByteArray): ByteArray {
        require(skrivnost.size >= 16 && sol.size >= 16)
        val prk = hmac(sol, skrivnost)
        return hmac(prk, NAMEN_OVOJNICE.toByteArray(Charsets.UTF_8) + byteArrayOf(1)).copyOf(32)
    }

    fun kljucPara(zasebniB64: String, javniDrugega: PublicKey, idTelefona: String): ByteArray {
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(zasebniKljuc(zasebniB64))
        ka.doPhase(javniDrugega, true)
        return hkdf(ka.generateSecret(), solPara(idTelefona))
    }

    fun aad(z: ZapisKljuca, smer: String): ByteArray = "$NAMEN|${z.id}|${z.ponudnik}|${z.cas}|${z.naprava}|$smer".toByteArray(Charsets.UTF_8)

    fun zapakiraj(kljuc: ByteArray, vrednost: String, aad: ByteArray): Ovojnica {
        val iv = ByteArray(12).also { nakljucje.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(kljuc, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(aad)
        val izhod = c.doFinal(vrednost.toByteArray(Charsets.UTF_8))
        val b = Base64.getEncoder()
        return Ovojnica(1, b.encodeToString(iv), b.encodeToString(izhod.copyOf(izhod.size - 16)), b.encodeToString(izhod.copyOfRange(izhod.size - 16, izhod.size)))
    }

    fun odpakiraj(kljuc: ByteArray, o: Ovojnica, aad: ByteArray): String? = try {
        val d = Base64.getDecoder()
        val iv = d.decode(o.iv); val tag = d.decode(o.tag)
        if (o.v != 1 || iv.size != 12 || tag.size != 16) null
        else {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(kljuc, "AES"), GCMParameterSpec(128, iv))
            c.updateAAD(aad)
            String(c.doFinal(d.decode(o.ct) + tag), Charsets.UTF_8)
        }
    } catch (_: Exception) { null }

    fun zaZico(z: ZapisKljuca, kljuc: ByteArray, smer: String): JsonObject = buildJsonObject {
        put("id", z.id); put("ponudnik", z.ponudnik); put("oznaka", z.oznaka); put("cas", z.cas); put("naprava", z.naprava)
        put("izbrisan", z.izbrisan); put("prej", z.prej)
        if (!z.izbrisan) put("ovoj", json.encodeToJsonElement(Ovojnica.serializer(), zapakiraj(kljuc, z.vrednost, aad(z, smer))))
    }

    private fun niz(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Prejet zapis z zice; null = neveljaven, vrednost v cistem besedilu ali ovojnica se ne odpre (zapis se prezre). */
    fun zZice(e: JsonElement, kljuc: ByteArray, smer: String): ZapisKljuca? {
        val o = e as? JsonObject ?: return null
        if ("vrednost" in o || o.keys.any { it != "ovoj" && it !in POLJA }) return null
        val id = niz(o, "id") ?: return null
        val ponudnik = niz(o, "ponudnik") ?: return null
        val oznaka = niz(o, "oznaka") ?: return null
        val naprava = niz(o, "naprava") ?: return null
        val prej = niz(o, "prej") ?: return null
        val cas = (o["cas"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: return null
        val izbrisan = (o["izbrisan"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: return null
        val brez = ZapisKljuca(id, ponudnik, oznaka, cas, naprava, izbrisan, prej, "")
        val ovoj = o["ovoj"]
        if (izbrisan) return if (ovoj == null || ovoj is JsonNull) brez else null
        val ov = try { json.decodeFromJsonElement(Ovojnica.serializer(), ovoj ?: return null) } catch (_: Exception) { return null }
        val v = odpakiraj(kljuc, ov, aad(brez, smer)) ?: return null
        return brez.copy(vrednost = v)
    }

    fun vsebina(javni: String, zapisi: List<JsonObject>): String = buildJsonObject {
        put("v", 1); put("javni", javni); put("zapisi", JsonArray(zapisi))
    }.toString()

    data class Odgovor(val naprava: String, val javni: String, val zapisi: List<JsonElement>)

    fun odgovor(telo: String): Odgovor? = try {
        val o = Json.parseToJsonElement(telo).jsonObject
        val naprava = niz(o, "naprava"); val javni = niz(o, "javni"); val zapisi = o["zapisi"] as? JsonArray
        if ((o["v"] as? JsonPrimitive)?.longOrNull != 1L || naprava == null || javni == null || zapisi == null) null else Odgovor(naprava, javni, zapisi)
    } catch (_: Exception) { null }

    fun namig(v: String): String = if (v.length >= 8) "…" + v.takeLast(4) else ""

    private fun sha256Hex(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
