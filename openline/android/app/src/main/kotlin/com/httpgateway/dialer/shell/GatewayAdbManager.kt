package com.httpgateway.dialer.shell

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.httpgateway.protocol.AdbKeyBlob
import io.github.muntashirakon.adb.AbsAdbConnectionManager
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.io.File
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Date
import java.util.concurrent.TimeUnit
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Identiteta ADB za to aplikacijo. Zasebni kljuc je na disku samo kot
 * sifrogram, ovit s kljucem iz Android Keystore. Goli PKCS#8 se ne pise.
 */
class GatewayAdbManager private constructor(context: Context) : AbsAdbConnectionManager() {
    private val dir = File(context.filesDir, "adb").apply { mkdirs() }
    private val keyFile = File(dir, "adbkey.pk8")
    private val encFile = File(dir, "adbkey.pk8.enc")
    private val certFile = File(dir, "adbkey.crt")
    private val privateKey: PrivateKey
    private val certificate: Certificate

    init {
        api = Build.VERSION.SDK_INT
        if (!certFile.exists() || (!encFile.exists() && !keyFile.exists())) generate()
        privateKey = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(readPkcs8()))
        certificate = certFile.inputStream().use { CertificateFactory.getInstance("X.509").generateCertificate(it) }
    }

    override fun getPrivateKey(): PrivateKey = privateKey

    override fun getCertificate(): Certificate = certificate

    /** Javni kljuc v obliki vrstice iz adb_keys. Brisanje te datoteke iz lupine ne deluje. */
    fun adbPublicKeyLine(): String {
        val publicKey = certificate.publicKey
        check(publicKey is java.security.interfaces.RSAPublicKey)
        return AndroidAdbPublicKey.encodeLine(publicKey)
    }

    override fun getDeviceName(): String = "httpgateway"

    private fun generate() {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val name = X500Name("CN=httpgateway")
        val now = System.currentTimeMillis()
        val holder = JcaX509v3CertificateBuilder(
            name,
            BigInteger.valueOf(now),
            Date(now - TimeUnit.DAYS.toMillis(1)),
            Date(now + TimeUnit.DAYS.toMillis(365L * 30)),
            name,
            pair.public,
        ).build(JcaContentSignerBuilder("SHA256withRSA").build(pair.private))
        val cert = JcaX509CertificateConverter().getCertificate(holder)
        encFile.writeBytes(AdbKeyBlob.seal(wrappingKey(), pair.private.encoded))
        certFile.writeBytes(cert.encoded)
        if (keyFile.exists()) keyFile.delete()
    }

    /** Prebere oviti kljuc. Stari goli pk8 se ob prvem zagonu ovije in zbrise. */
    private fun readPkcs8(): ByteArray {
        val wrap = wrappingKey()
        if (encFile.exists()) return AdbKeyBlob.open(wrap, encFile.readBytes())
        val raw = keyFile.readBytes()
        encFile.writeBytes(AdbKeyBlob.seal(wrap, raw))
        keyFile.writeBytes(ByteArray(raw.size))
        keyFile.delete()
        return raw
    }

    private fun wrappingKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(WRAP_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                WRAP_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        private const val WRAP_ALIAS = "httpgateway_adb_wrap"

        @Volatile
        private var instance: GatewayAdbManager? = null

        fun get(context: Context): GatewayAdbManager =
            instance ?: synchronized(this) {
                instance ?: GatewayAdbManager(context.applicationContext).also { instance = it }
            }

        /** Pozabi kljuc v pomnilniku, na disku in v Keystore. Naslednji get() ustvari nov par. */
        fun forget(context: Context) {
            synchronized(this) { instance = null }
            File(context.applicationContext.filesDir, "adb").deleteRecursively()
            runCatching {
                val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                if (store.containsAlias(WRAP_ALIAS)) store.deleteEntry(WRAP_ALIAS)
            }
        }
    }
}
