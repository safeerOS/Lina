package si.safeer.lina.podpis

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Kljuc te naprave za ozji krog Safeer Linka: EC P-256 v AndroidKeyStore, podpis SHA256withECDSA (DER, base64), javni
 * kljuc base64 SPKI, id n-<16 hex> (KrogKljuc.idIzKljuca). Prirejeno po Android-tv src/main/kotlin/si/safeer/tv/cast/HubTls.kt
 * @707ff60 (potrdilo(), javniKljucB64(), podpisi()) - brez TLS huba, zato samo SHA-256 in svoj alias. Zasebni kljuc ne
 * zapusti KeyStore. AndroidKeyStore je vezan na paket: Lina ima SVOJ kljuc (seznanitev prek Safeer OS, AGENTS.md).
 *
 * Pregled 17 (A2): poljubnih bajtov kljuc NE podpise. Javne so samo funkcije, ki niz sestavijo same iz preverjenih polj
 * (NiziLine, predpone safeer-lina-...), zato kljuc nikoli ne podpise vnosa v krog (safeer-krog-clan-v1) ali umika.
 * Vse klice delaj zunaj glavne niti (KeyStore je pocasen, B6). Kljuc uporablja samo asistentka, nikoli pot klicev.
 */
object NapravaKljuc {
    private const val SHRAMBA = "AndroidKeyStore"
    private const val ALIAS = "safeer_lina_naprava_v1"

    @Synchronized
    private fun par(): Pair<PrivateKey, java.security.PublicKey> {
        val ks = KeyStore.getInstance(SHRAMBA).apply { load(null) }
        if (!ks.containsAlias(ALIAS)) {
            val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build()
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, SHRAMBA).apply { initialize(spec) }.generateKeyPair()
        }
        val zasebni = ks.getKey(ALIAS, null) as PrivateKey
        val javni = ks.getCertificate(ALIAS).publicKey
        return zasebni to javni
    }

    /** Javni kljuc (base64 SubjectPublicKeyInfo DER), vnos v krog zaupanja. */
    fun javniKljucB64(): String = java.util.Base64.getEncoder().encodeToString(par().second.encoded)

    /** Id naprave iz kljuca (n-<16 hex>), enako kot core/link_krog.py in KrogZaupanja.kt. */
    fun id(): String = KrogKljuc.idIzKljuca(javniKljucB64())

    private fun podpisi(podatki: ByteArray): String {
        val s = Signature.getInstance("SHA256withECDSA")
        s.initSign(par().first)
        s.update(podatki)
        return java.util.Base64.getEncoder().encodeToString(s.sign())
    }

    private val podpisnik = Podpisnik(::podpisi, ::id, ::javniKljucB64)

    /** Seznanitev s kodo iz QR v1 (pogodba @7a065fb); null, ce polja niso veljavna. */
    fun podpisiSeznanitev(koda: String, ime: String, cas: Long, enkratni: String): PodpisSeznanitve? =
        podpisnik.podpisiSeznanitev(koda, ime, cas, enkratni)

    /** Poizvedba o stanju seje Claude Code. */
    fun podpisiStanje(cas: Long, enkratni: String): String? = podpisnik.podpisiStanje(cas, enkratni)

    /** Branje dogodkov naloge (podpisano od T1-N3). */
    fun podpisiDogodke(id: String, cas: Long, enkratni: String): String? = podpisnik.podpisiDogodke(id, cas, enkratni)

    /** Prevzem poti klicev po lastnikovem »Dodaj« (T1-S1). */
    fun podpisiKlice(koda: String, cas: Long, enkratni: String): String? = podpisnik.podpisiKlice(koda, cas, enkratni)

    /** Sinhronizacija klicev, pogovora in navodil (podpis zgostitve vsebine). */
    fun podpisiSinhron(vsebina: String, cas: Long, enkratni: String): String? = podpisnik.podpisiSinhron(vsebina, cas, enkratni)

    /** Naloga za Claude Code; null, ce vnos ni veljaven. */
    fun podpisiNalogo(id: String, vnos: String, cas: Long, enkratni: String): PodpisanaNaloga? =
        podpisnik.podpisiNalogo(id, vnos, cas, enkratni)

    /** Odobritev ene zahteve; zgostitev iz polj, ki jih je lastnik videl. Vrne podpis ali null. */
    fun podpisiOdobritev(
        zahtevaId: String, dovoli: Boolean, cas: Long, enkratni: String, chatId: String, orodje: String, predogled: String, opis: String,
    ): String? = podpisnik.podpisiOdobritev(zahtevaId, dovoli, cas, enkratni, chatId, orodje, predogled, opis)

    /** Ustavitev naloge, ki jo je dala ta naprava. Vrne podpis ali null. */
    fun podpisiUstavitev(id: String, cas: Long, enkratni: String): String? = podpisnik.podpisiUstavitev(id, cas, enkratni)

    /** Dodatki na racunalniku (23. 11. 2026): branje stanja in preklop enega dodatka. */
    fun podpisiStanjeDodatkov(cas: Long, enkratni: String): String? = podpisnik.podpisiStanjeDodatkov(cas, enkratni)
    fun podpisiDodatek(dodatek: String, vklop: Boolean, cas: Long, enkratni: String): String? = podpisnik.podpisiDodatek(dodatek, vklop, cas, enkratni)
}
