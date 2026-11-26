package si.safeer.lina.asistent

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.ModelShramba
import si.safeer.lina.samostojna.OdgovorHttp
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.Prenos
import si.safeer.lina.samostojna.ShranjevalnikKljuca
import si.safeer.lina.samostojna.Zapisek
import si.safeer.lina.samostojna.zapiskiIzJsona
import si.safeer.lina.samostojna.zapiskiVJson
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Prenos za samostojno asistentko: samo https, brez preusmeritev (kljuc je v glavi zahteve), odgovor omejen na 1 MB + 1 bajt. */
class AndroidPrenos : Prenos {
    override fun get(url: String, glave: Map<String, String>, casMs: Long): OdgovorHttp = zahteva("GET", url, glave, null, casMs)

    override fun post(url: String, glave: Map<String, String>, telo: String, casMs: Long): OdgovorHttp = zahteva("POST", url, glave, telo, casMs)

    private fun zahteva(metoda: String, url: String, glave: Map<String, String>, telo: String?, casMs: Long): OdgovorHttp {
        if (!url.startsWith("https://")) throw IOException("samo https")
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = metoda
            c.instanceFollowRedirects = false
            c.connectTimeout = 10_000
            c.readTimeout = casMs.toInt()
            if (telo != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
            }
            glave.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (telo != null) c.outputStream.use { it.write(telo.toByteArray(Charsets.UTF_8)) }
            val koda = c.responseCode
            val tok = if (koda in 200..299) c.inputStream else c.errorStream
            val bajti = tok?.use { omejenoBranje(it, MEJA_ODGOVORA + 1) } ?: ByteArray(0)
            return OdgovorHttp(koda, String(bajti, Charsets.UTF_8))
        } finally {
            c.disconnect()
        }
    }

    private fun omejenoBranje(vhod: java.io.InputStream, meja: Int): ByteArray {
        val izhod = java.io.ByteArrayOutputStream()
        val medpomnilnik = ByteArray(8192)
        while (izhod.size() < meja) {
            val n = vhod.read(medpomnilnik, 0, minOf(medpomnilnik.size, meja - izhod.size()))
            if (n < 0) break
            izhod.write(medpomnilnik, 0, n)
        }
        return izhod.toByteArray()
    }

    private companion object { const val MEJA_ODGOVORA = 1024 * 1024 }
}

private const val SHRAMBA = "lina_asistent"

/** Kljuc Gemini je v shrambi samo kot AES-GCM tajnopis; AES kljuc ne zapusti AndroidKeyStore. Kljuca ne zapisemo nikamor drugam. */
class KeystoreShranjevalnik private constructor(
    private val context: Context,
    private val ALIAS: String,
    private val KLJUC: String,
) : ShranjevalnikKljuca {
    // Gemini ohrani stara imena, da ze shranjen kljuc ostane veljaven po nadgradnji; vsak drug ponudnik ima svoj AES kljuc in zapis.
    constructor(context: Context, ponudnik: Ponudnik = Ponudnik.GEMINI) : this(
        context,
        if (ponudnik == Ponudnik.GEMINI) "lina_asistent_gemini" else "lina_asistent_${ponudnik.id}",
        if (ponudnik == Ponudnik.GEMINI) "gemini_kljuc" else "${ponudnik.id}_kljuc",
    )

    /** Spletna orodja in Twilio (lastnik 18. 11. 2026): vsak svoj AES kljuc in zapis, loceno od kljucev ponudnikov. */
    constructor(context: Context, orodje: VrstaOrodja) : this(context, "lina_orodje_${orodje.id}", "orodje_${orodje.id}_kljuc")

    private fun prefs() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)

    companion object {
        /** NALOGA-35: stanje uskladitve kljucev za mozgane (z vrednostmi in kljucem para) - svoj AES kljuc in zapis. */
        fun zaKljuceMozganov(context: Context) = KeystoreShranjevalnik(context, "lina_kljuci_mozganov", "kljuci_mozganov_stanje")
    }

    private fun kljucAes(ustvari: Boolean): SecretKey? {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        if (!ustvari) return null
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return g.generateKey()
    }

    override fun preberi(): KljucGemini? = try {
        val zapis = prefs().getString(KLJUC, null) ?: return null
        val vse = Base64.decode(zapis, Base64.NO_WRAP)
        if (vse.size <= 12) return null
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, kljucAes(false) ?: return null, GCMParameterSpec(128, vse, 0, 12))
        KljucGemini(String(c.doFinal(vse, 12, vse.size - 12), Charsets.UTF_8))
    } catch (_: Exception) { null }

    override fun shrani(k: KljucGemini) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, kljucAes(true)!!)
        val tajnopis = c.doFinal(k.izpostavi().toByteArray(Charsets.UTF_8))
        prefs().edit().putString(KLJUC, Base64.encodeToString(c.iv + tajnopis, Base64.NO_WRAP)).apply()
    }

    override fun izbrisi() {
        prefs().edit().remove(KLJUC).apply()
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) } catch (_: Exception) {}
    }

}

/**
 * Google Cloud: izbran projekt (ni skrivnost) in zacetek prijave (PKCE preverjalnik + state, veljata 10 min, po uporabi se
 * pobriseta). Osvezitveni zeton NI tu, ampak v KeystoreShranjevalnik(Ponudnik.VERTEX).
 */
class GoogleShramba(private val context: Context) {
    private fun prefs() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)
    fun projekt(): String? = prefs().getString("google_projekt", null)
    fun shraniProjekt(id: String?) { prefs().edit().apply { if (id == null) remove("google_projekt") else putString("google_projekt", id) }.apply() }

    fun shraniZacetek(preverjalnik: String, stanje: String, doMs: Long) {
        prefs().edit().putString("google_preverjalnik", preverjalnik).putString("google_stanje", stanje).putLong("google_do", doMs).apply()
    }

    /** Vrne (preverjalnik, stanje) samo enkrat in samo, dokler ne poteče; nato ga pobrise. */
    fun vzemiZacetek(zdaj: Long): Pair<String, String>? {
        val p = prefs()
        val prev = p.getString("google_preverjalnik", null); val st = p.getString("google_stanje", null); val doMs = p.getLong("google_do", 0)
        p.edit().remove("google_preverjalnik").remove("google_stanje").remove("google_do").apply()
        return if (prev != null && st != null && zdaj < doMs) prev to st else null
    }
}

/** Orodja s kljucem, ki niso ponudniki AI. */
enum class VrstaOrodja(val id: String) {
    BRAVE("brave"), TINYFISH("tinyfish"), TWILIO_ZETON("twilio_zeton"),
    /** Kljuc OpenRouter SAMO za asistentko (lastnik 24. 11. 2026): svoj AES kljuc in zapis, nikoli mesto ponudnika za klice. */
    OPENROUTER_ASISTENTKA("openrouter_asistentka"),
}

/** Model asistentke in stikalo brezplacnih modelov (ni skrivnost). Brez kljuca asistentke se ne uporabi (A6: isti kot klici). */
class AsistentkaShramba(private val context: Context) {
    private fun prefs() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)
    fun model(): String? = prefs().getString("asistentka_model", null)
    fun shraniModel(m: String) { prefs().edit().putString("asistentka_model", m).apply() }
    fun brezplacni(): Boolean = prefs().getBoolean("asistentka_brezplacni", false)
    fun nastaviBrezplacne(v: Boolean) { prefs().edit().putBoolean("asistentka_brezplacni", v).apply() }
}

/** Twilio Account SID ni skrivnost (zeton je v Keystore), zato navadne nastavitve. */
class TwilioShramba(private val context: Context) {
    private fun prefs() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)
    fun sid(): String? = prefs().getString("twilio_sid", null)
    fun ime(): String? = prefs().getString("twilio_ime", null)
    fun shrani(sid: String, ime: String) { prefs().edit().putString("twilio_sid", sid).putString("twilio_ime", ime).apply() }
    fun izbrisi() { prefs().edit().remove("twilio_sid").remove("twilio_ime").apply() }
}

/** Samodejno izbran model za ponudnika (lastnik 24. 11. 2026); ni skrivnost, zato navadne nastavitve. */
class ModelShrambaAndroid(private val context: Context) : ModelShramba {
    private fun prefs() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)
    override fun beri(p: Ponudnik): String? = prefs().getString("model_${p.id}", null)
    override fun shrani(p: Ponudnik, model: String) { prefs().edit().putString("model_${p.id}", model).apply() }
}

/** Izbran ponudnik (ni skrivnost, zato navadne nastavitve). */
class PonudnikShramba(private val context: Context) {
    private fun prefs() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)
    fun beri(): Ponudnik = Ponudnik.izId(prefs().getString("ponudnik", null))
    fun shrani(p: Ponudnik) { prefs().edit().putString("ponudnik", p.id).apply() }
}

object SkupniKljuci {
    var aktivniPonudnikTest: Ponudnik? = null
    var shrambaZaPonudnikaTest: ((Ponudnik) -> ShranjevalnikKljuca)? = null

    fun aktivniPonudnik(context: Context): Ponudnik = aktivniPonudnikTest ?: PonudnikShramba(context).beri()
    fun nastaviAktivnegaPonudnika(context: Context, p: Ponudnik) {
        if (aktivniPonudnikTest != null) aktivniPonudnikTest = p
        else PonudnikShramba(context).shrani(p)
    }

    fun shrambaZaPonudnika(context: Context, p: Ponudnik): ShranjevalnikKljuca = 
        shrambaZaPonudnikaTest?.invoke(p) ?: KeystoreShranjevalnik(context, p)
    
    fun shrambaZaOrodje(context: Context, o: VrstaOrodja): ShranjevalnikKljuca = KeystoreShranjevalnik(context, o)

    var shrambaAsistentkeTest: ShranjevalnikKljuca? = null
    /** Kljuc samo za asistentko; klici (aktivniPonudnik, Gemini Live) tega mesta nikoli ne berejo. */
    fun shrambaAsistentke(context: Context): ShranjevalnikKljuca = shrambaAsistentkeTest ?: KeystoreShranjevalnik(context, VrstaOrodja.OPENROUTER_ASISTENTKA)
    
    fun preberiKljucAktivnegaPonudnika(context: Context): KljucGemini? {
        return shrambaZaPonudnika(context, aktivniPonudnik(context)).preberi()
    }
}

/** Zapiski na telefonu. Poskodovan zapis se pred prvim novim zapisom shrani kot varnostna kopija, nikoli ne izgine tiho. */
class ZapiskiShramba(private val context: Context) {
    private fun prefs() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)

    @Synchronized fun beri(): List<Zapisek> {
        val surovo = prefs().getString(ZAPISKI, null) ?: return emptyList()
        zapiskiIzJsona(surovo)?.let { return it }
        if (!prefs().contains(ZAPISKI_POSKODOVANI)) prefs().edit().putString(ZAPISKI_POSKODOVANI, surovo).apply()
        return emptyList()
    }

    @Synchronized fun shrani(zapiski: List<Zapisek>) {
        prefs().edit().putString(ZAPISKI, zapiskiVJson(zapiski)).apply()
    }

    private companion object { const val ZAPISKI = "zapiski"; const val ZAPISKI_POSKODOVANI = "zapiski_poskodovani" }
}
