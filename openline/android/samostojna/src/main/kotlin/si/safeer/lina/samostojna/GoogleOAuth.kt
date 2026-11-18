package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.io.IOException
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Prijava z Google racunom po OAuth 2.0 + PKCE (RFC 7636, RFC 8252) brez knjiznic Play storitev: dela tudi na telefonu brez
 * Googlovih storitev. Odjemalec Android nima skrivnosti; ID odjemalca je javen. Naslovi so vgrajeni; vrnjena povezava mora
 * imeti nasa shemo in ujemajoc »state«, sicer je zavrnjena (napadalska aplikacija ne more podtakniti kode).
 */
object GoogleOAuth {
    const val ID_ODJEMALCA = "292650165087-vqd78tu81h2o55i9vfa3uobs64m58hv4.apps.googleusercontent.com"
    val SHEMA = "com.googleusercontent.apps." + ID_ODJEMALCA.removeSuffix(".apps.googleusercontent.com")
    const val PRESMERITEV = "com.googleusercontent.apps.292650165087-vqd78tu81h2o55i9vfa3uobs64m58hv4:/oauth2redirect"
    const val OBSEG = "https://www.googleapis.com/auth/cloud-platform"
    const val NASLOV_PRIJAVE = "https://accounts.google.com/o/oauth2/v2/auth"
    const val NASLOV_ZETONA = "https://oauth2.googleapis.com/token"

    class Zacetek(val naslov: String, val preverjalnik: String, val stanje: String)

    private fun b64(b: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    fun izzivIzPreverjalnika(preverjalnik: String): String =
        b64(MessageDigest.getInstance("SHA-256").digest(preverjalnik.toByteArray(Charsets.US_ASCII)))

    fun zacni(nakljucje: SecureRandom = SecureRandom()): Zacetek {
        fun nakljucno(n: Int) = b64(ByteArray(n).also { nakljucje.nextBytes(it) })
        val preverjalnik = nakljucno(48) // 64 znakov, v mejah 43-128
        val stanje = nakljucno(24)
        val naslov = NASLOV_PRIJAVE + "?client_id=" + enc(ID_ODJEMALCA) +
            "&redirect_uri=" + enc(PRESMERITEV) + "&response_type=code&scope=" + enc(OBSEG) +
            "&code_challenge=" + izzivIzPreverjalnika(preverjalnik) + "&code_challenge_method=S256" +
            "&state=" + stanje + "&access_type=offline&prompt=consent"
        return Zacetek(naslov, preverjalnik, stanje)
    }

    /** Koda iz vrnjene povezave; null, ce shema/pot/state ne ustrezajo ali je Google vrnil napako. */
    fun kodaIzPovezave(povezava: String, stanje: String): String? {
        if (!povezava.startsWith("$SHEMA:")) return null
        val iz = povezava.indexOf('?')
        if (iz < 0) return null
        val pot = povezava.substring(SHEMA.length + 1, iz)
        if (pot != "/oauth2redirect") return null
        val parametri = povezava.substring(iz + 1).substringBefore('#').split('&').mapNotNull {
            val i = it.indexOf('=')
            if (i <= 0) null else URLDecoder.decode(it.substring(0, i), "UTF-8") to URLDecoder.decode(it.substring(i + 1), "UTF-8")
        }.toMap()
        if (parametri["error"] != null) return null
        val vracano = parametri["state"] ?: return null
        // Stalen cas: state nikoli ni skrivnost kljuca, a je dokaz, da odgovor pripada nasi zahtevi.
        if (!MessageDigest.isEqual(vracano.toByteArray(), stanje.toByteArray())) return null
        return parametri["code"]?.takeIf { it.isNotEmpty() }
    }

    class Zetona(val dostop: String, val osvezitveni: String?, val potecePoS: Long)

    private val json = Json { ignoreUnknownKeys = true }
    private val obrazec = mapOf("Content-Type" to "application/x-www-form-urlencoded")

    private fun razberi(telo: String): Zetona? {
        val o = try { json.parseToJsonElement(telo) as? JsonObject } catch (e: Exception) { null } ?: return null
        val dostop = (o["access_token"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: return null
        return Zetona(dostop, (o["refresh_token"] as? JsonPrimitive)?.contentOrNull, (o["expires_in"] as? JsonPrimitive)?.longOrNull ?: 3600L)
    }

    fun zamenjajKodo(prenos: Prenos, koda: String, preverjalnik: String): Zetona? = try {
        val telo = "client_id=${enc(ID_ODJEMALCA)}&code=${enc(koda)}&code_verifier=${enc(preverjalnik)}&grant_type=authorization_code&redirect_uri=${enc(PRESMERITEV)}"
        prenos.post(NASLOV_ZETONA, obrazec, telo, 20000L).takeIf { it.koda == 200 }?.let { razberi(it.telo) }
    } catch (e: IOException) { null }

    /**
     * Osvezitev po izteku (okoli ure). null = Google je zavrnil (preklic, potek): potrebna je nova prijava.
     * IOException (brez povezave) se NE ujame: brez omrezja uporabnik ne sme biti odjavljen.
     */
    fun osvezi(prenos: Prenos, osvezitveni: String): Zetona? {
        val telo = "client_id=${enc(ID_ODJEMALCA)}&refresh_token=${enc(osvezitveni)}&grant_type=refresh_token"
        return prenos.post(NASLOV_ZETONA, obrazec, telo, 20000L).takeIf { it.koda == 200 }?.let { razberi(it.telo) }
    }
}

/** Dostopni zeton v pomnilniku, osvezitveni v shrambi (Keystore); pred iztekom (60 s) ga osvezi. */
class GoogleZetonOsvezevalnik(
    private val shramba: ShranjevalnikKljuca,
    private val prenos: Prenos,
    private val zdaj: () -> Long = { System.currentTimeMillis() },
) : GoogleZeton {
    private var dostop: String? = null
    private var pretece = 0L

    @Synchronized fun nastavi(z: GoogleOAuth.Zetona) {
        dostop = z.dostop; pretece = zdaj() + z.potecePoS * 1000
        z.osvezitveni?.let { shramba.shrani(KljucGemini(it)) }
    }

    @Synchronized fun odjava() { dostop = null; pretece = 0; shramba.izbrisi() }

    fun prijavljen(): Boolean = shramba.preberi() != null

    @Synchronized override fun zeton(): String? {
        dostop?.takeIf { zdaj() < pretece - 60_000 }?.let { return it }
        val os = shramba.preberi()?.izpostavi() ?: return null
        val nov = GoogleOAuth.osvezi(prenos, os) ?: return null // IOException gre naprej: brez povezave
        // Nov osvezitveni zeton (redko) zamenja starega; sicer ostane star.
        nastavi(nov)
        return dostop
    }
}
