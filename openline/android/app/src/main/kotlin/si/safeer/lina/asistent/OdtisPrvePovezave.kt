package si.safeer.lina.asistent

import okhttp3.OkHttpClient
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Samo za POST /koda/zacni (seznanitev s kodo, pogodba @fdd787b): prva povezava brez pripetega odtisa si zapomni odtis
 * SHA-256 lista, ki ga telefon VIDI. Istovetnost dokaze sele SPAKE2 z AAD = ta odtis (posrednik z drugim potrdilom ne da
 * veljavne cA); vse naslednje zahteve so pripete nanj (PinnedHttp). Po tej poti gre samo id, ime in javni podatek.
 */
class OdtisPrvePovezave {
    @Volatile var odtis: String? = null
        private set

    fun client(): OkHttpClient {
        val trust = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
                throw CertificateException("odjemalec se ne overja")

            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                val list = chain?.firstOrNull() ?: throw CertificateException("ni potrdila")
                odtis = MessageDigest.getInstance("SHA-256").digest(list.encoded).joinToString("") { "%02x".format(it) }
            }

            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        }
        val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), SecureRandom()) }
        return OkHttpClient.Builder()
            .sslSocketFactory(ctx.socketFactory, trust)
            .hostnameVerifier { _, _ -> true }
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}
