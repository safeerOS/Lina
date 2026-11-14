package com.httpgateway.protocol

import okhttp3.OkHttpClient
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Odjemalec OkHttp, ki zaupa samo strezniku, katerega listni certifikat ima pripet odtis SHA-256 (TlsPin.assertLeaf).
 * Sistemski korenski certifikati se ne upostevajo: streznik je samopodpisan. Krog 17: v modulu protocol, da ima preizkus.
 * Pregled 16 (N3): zahteve nosijo zeton naprave v glavi, zato NE sledijo preusmeritvam (AGENTS: zahteve s kljucem ne
 * sledijo preusmeritvam) - preusmeritev bi zeton odnesla na drug naslov.
 */
object PinnedHttp {
    fun client(fingerprint: String, pingSeconds: Long = 20): OkHttpClient {
        val trust = FingerprintTrustManager(fingerprint)
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf(trust), SecureRandom())
        return OkHttpClient.Builder()
            .sslSocketFactory(context.socketFactory, trust)
            // Istovetnost je odtis lista. Potrdilo je za localhost, ne za naslov DHCP.
            .hostnameVerifier { _, _ -> true }
            .followRedirects(false)
            .followSslRedirects(false)
            .pingInterval(pingSeconds, TimeUnit.SECONDS)
            .build()
    }

    private class FingerprintTrustManager(fingerprint: String) : X509TrustManager {
        private val expected = TlsPin.normalize(fingerprint)

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            throw CertificateException("odjemalec se ne overja")
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            try {
                // Samo chain[0]. Ujemanje kasnejsega certifikata je zavrnitev.
                TlsPin.assertLeaf(chain?.map { it.encoded }.orEmpty(), expected)
            } catch (error: TlsPin.Rejected) {
                throw CertificateException(error.message)
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
