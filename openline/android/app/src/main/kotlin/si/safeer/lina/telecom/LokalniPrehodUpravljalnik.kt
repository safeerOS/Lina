package si.safeer.lina.telecom

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import java.security.KeyPairGenerator
import si.safeer.lina.OkHttpWsFabrika
import si.safeer.lina.asistent.AndroidPrenos
import si.safeer.lina.asistent.GoogleShramba
import si.safeer.lina.asistent.SkupniKljuci
import si.safeer.lina.samostojna.DnevnikKlicev
import si.safeer.lina.samostojna.DatotecnaShramba
import si.safeer.lina.samostojna.GoogleZetonOsvezevalnik
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.live.GeminiLiveOdjemalec
import si.safeer.lina.samostojna.prehod.LokalniPrehod
import java.security.cert.X509Certificate

object LokalniPrehodUpravljalnik {
    var prehod: LokalniPrehod? = null
    var most: si.safeer.lina.samostojna.prehod.ZvocniMost? = null

    fun tece(): Boolean = prehod?.getPort()?.let { it > 0 } ?: false

    @Synchronized
    fun start(context: Context) {
        if (prehod != null) return

        val alias = "LokalniPrehodCert"
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!ks.containsAlias(alias)) {
            val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            kpg.initialize(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setCertificateSubject(javax.security.auth.x500.X500Principal("CN=LokalniPrehod"))
                    .setKeySize(256)
                    .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
                    .build()
            )
            kpg.generateKeyPair()
        }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, null)
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(kmf.keyManagers, null, SecureRandom())

        val prefs = context.getSharedPreferences("lokalni_prehod", Context.MODE_PRIVATE)
        var zeton = prefs.getString("zeton", null)
        if (zeton == null) {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            zeton = Base64.getEncoder().encodeToString(bytes)
            prefs.edit().putString("zeton", zeton).apply()
        }

        val aktivni = SkupniKljuci.aktivniPonudnik(context)
        val apiKljuc = SkupniKljuci.shrambaZaPonudnika(context, aktivni)
        val googleZeton = GoogleZetonOsvezevalnik(SkupniKljuci.shrambaZaPonudnika(context, Ponudnik.VERTEX), AndroidPrenos())
        val shramba = GoogleShramba(context)
        val projekt = { shramba.projekt() }
        val dnevnik = DnevnikKlicev(DatotecnaShramba(File(context.filesDir, "dnevnik_klicev.json")))

        val zvocniMost = GeminiLiveOdjemalec(
            apiKljuc = apiKljuc,
            googleZeton = googleZeton,
            projekt = projekt,
            dnevnik = dnevnik,
            wsFabrika = OkHttpWsFabrika()
        ).apply {
            naNapako = { razlog ->
                val manager = context.getSystemService(android.app.NotificationManager::class.java)
                val channel = android.app.NotificationChannel(
                    "lina_errors",
                    "Lina napake",
                    android.app.NotificationManager.IMPORTANCE_LOW
                )
                manager.createNotificationChannel(channel)
                val notification = android.app.Notification.Builder(context, "lina_errors")
                    .setSmallIcon(si.safeer.lina.R.drawable.ic_stat_lina)
                    .setContentTitle("Lina")
                    .setContentText(razlog)
                    .build()
                manager.notify(7005, notification)
            }
        }
        most = zvocniMost

        val novPrehod = LokalniPrehod(sslContext, zeton, zvocniMost)
        novPrehod.start()
        prehod = novPrehod
    }

    @Synchronized
    fun ustavi() {
        prehod?.stop()
        prehod = null
    }

    fun getCertFingerprint(): String {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val cert = ks.getCertificate("LokalniPrehodCert") as? X509Certificate ?: return ""
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(cert.encoded)
        return digest.joinToString("") { "%02x".format(it) }
    }
}