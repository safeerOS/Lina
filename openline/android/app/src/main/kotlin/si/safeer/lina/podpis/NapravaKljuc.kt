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
 * zapusti KeyStore. AndroidKeyStore je vezan na paket: Lina ima SVOJ kljuc, tudi ce je na telefonu Safeer OS
 * (seznanitev prek Safeer OS, AGENTS.md). Kljuc uporablja samo asistentka, nikoli pot klicev.
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

    /** Podpis s kljucem te naprave (SHA256withECDSA, DER), base64. */
    fun podpisi(podatki: ByteArray): String {
        val s = Signature.getInstance("SHA256withECDSA")
        s.initSign(par().first)
        s.update(podatki)
        return java.util.Base64.getEncoder().encodeToString(s.sign())
    }
}
