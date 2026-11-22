package si.safeer.lina.telecom

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
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
import si.safeer.lina.samostojna.GoogleZetonOsvezevalnik
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.live.GeminiLiveOdjemalec
import si.safeer.lina.samostojna.prehod.LokalniPrehod
import java.security.cert.X509Certificate

object LokalniPrehodUpravljalnik {
    var prehod: LokalniPrehod? = null
    var most: si.safeer.lina.samostojna.prehod.ZvocniMost? = null
    @Volatile var gemini: GeminiLiveOdjemalec? = null

    fun tece(): Boolean = prehod?.getPort()?.let { it > 0 } ?: false

    @Synchronized
    fun start(context: Context) {
        if (prehod != null) return

        // TLS kljuc lokalnega prehoda je PROGRAMSKI (lastnik 22. 11. 2026, klica brez zvoka na Samsungu ob 9.51 in 10.09): Conscrypt
        // podpisuje surov povzetek (NONEwithECDSA), KeyMint na Samsungu pa ga za kljuc v AndroidKeyStore zavrne (»Incompatible digest«),
        // tudi pri kljucu z DIGEST_NONE. Zasebni kljuc je na disku samo ovit z AES-GCM kljucem iz AndroidKeyStore (isti vzorec kot ADB).
        val material = kljucPrehoda(context)
        odtis = material.odtis
        val geslo = CharArray(0)
        val ks = KeyStore.getInstance("PKCS12").apply {
            load(null, null)
            setKeyEntry("prehod", material.zasebni, geslo, arrayOf(material.cert))
        }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, geslo)
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(kmf.keyManagers, null, SecureRandom())
        // Star kljuc v AndroidKeyStore ni vec v rabi.
        runCatching {
            val star = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (star.containsAlias("LokalniPrehodCert")) star.deleteEntry("LokalniPrehodCert")
        }

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
        val dnevnik = si.safeer.lina.asistent.DnevnikKlicevSkupni.dobi(context)

        val zvocniMost = GeminiLiveOdjemalec(
            apiKljuc = apiKljuc,
            googleZeton = googleZeton,
            projekt = projekt,
            dnevnik = dnevnik,
            wsFabrika = OkHttpWsFabrika(),
            imeUporabnika = { si.safeer.lina.asistent.ImeUporabnika.preberi(context) },
            casovniZapis = { android.util.Log.i("LinaPozdrav", "${System.currentTimeMillis() % 100000} ms: $it") },
            zajemIzhoda = ZajemIzhodaLine(context.filesDir)::zapisi,
            obdelavaZvoka = context.getSharedPreferences("lina_zvok", Context.MODE_PRIVATE).getBoolean("obdelava_zvoka", true)
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
        gemini = zvocniMost
        // Zapis klica: ob koncu klica gre v datoteko v mapi uporabnika (z ozadne niti; neuspeh zapisa ne izgubi zapisa v dnevniku).
        zvocniMost.naKlicZakljucen = { zapis ->
            Thread({
                runCatching { ObvestiloKlicaLine.pokazi(context, zapis) }
                runCatching { si.safeer.lina.asistent.KlicIzvoz(context).zapisi(zapis) }
                si.safeer.lina.asistent.SinhronizacijaZLino.zazeni(context, takoj = true)
            }, "klic-izvoz").start()
        }

        val novPrehod = LokalniPrehod(sslContext, zeton, zvocniMost)
        novPrehod.start()
        prehod = novPrehod
    }

    @Synchronized
    fun ustavi() {
        prehod?.stop()
        prehod = null
    }

    @Volatile private var odtis: String = ""

    /** SHA-256 odtis certifikata lokalnega prehoda (lupina ga pripne); prazno, dokler prehod ni zagnan. */
    fun getCertFingerprint(): String = odtis

    private class MaterialPrehoda(val zasebni: java.security.PrivateKey, val cert: X509Certificate, val odtis: String)

    private const val OVOJ_ALIAS = "LokalniPrehodOvoj"

    /** Kljuc in certifikat prehoda: prebere ovitega z diska ali ustvari novega (EC P-256, samopodpisan, 30 let). */
    private fun kljucPrehoda(context: Context): MaterialPrehoda {
        val mapa = java.io.File(context.noBackupFilesDir, "prehod").apply { mkdirs() }
        val kljucDat = java.io.File(mapa, "kljuc.enc")
        val certDat = java.io.File(mapa, "cert.der")
        val ovoj = ovojniKljuc()
        if (kljucDat.isFile && certDat.isFile) {
            runCatching {
                val pkcs8 = si.safeer.lina.protocol.AdbKeyBlob.open(ovoj, kljucDat.readBytes())
                val zasebni = java.security.KeyFactory.getInstance("EC").generatePrivate(java.security.spec.PKCS8EncodedKeySpec(pkcs8))
                pkcs8.fill(0)
                val cert = java.security.cert.CertificateFactory.getInstance("X.509")
                    .generateCertificate(certDat.inputStream().use { it.readBytes() }.inputStream()) as X509Certificate
                return MaterialPrehoda(zasebni, cert, odtisCert(cert))
            }
        }
        val par = KeyPairGenerator.getInstance("EC").apply { initialize(java.security.spec.ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val ime = org.bouncycastle.asn1.x500.X500Name("CN=LokalniPrehod")
        val zdaj = System.currentTimeMillis()
        val holder = org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder(
            ime,
            java.math.BigInteger.valueOf(zdaj),
            java.util.Date(zdaj - 86_400_000L),
            java.util.Date(zdaj + 86_400_000L * 365L * 30L),
            ime,
            par.public,
        ).build(org.bouncycastle.operator.jcajce.JcaContentSignerBuilder("SHA256withECDSA").build(par.private))
        val cert = org.bouncycastle.cert.jcajce.JcaX509CertificateConverter().getCertificate(holder)
        kljucDat.writeBytes(si.safeer.lina.protocol.AdbKeyBlob.seal(ovoj, par.private.encoded))
        certDat.writeBytes(cert.encoded)
        return MaterialPrehoda(par.private, cert, odtisCert(cert))
    }

    private fun odtisCert(cert: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }

    private fun ovojniKljuc(): javax.crypto.SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(OVOJ_ALIAS, null) as? javax.crypto.SecretKey)?.let { return it }
        val gen = javax.crypto.KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(OVOJ_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }
}
