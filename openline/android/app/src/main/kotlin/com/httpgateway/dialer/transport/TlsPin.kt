package com.httpgateway.dialer.transport

import com.httpgateway.protocol.TlsPin as LeafPin
import okhttp3.OkHttpClient
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Zaupa samo strezniku, katerega listni certifikat ima pritrjen odtis SHA-256.
 * Sistemski korenski certifikati se ne uposteva: streznik je samopodpisan.
 * Vmesni certifikati se ne primerjajo (glej [LeafPin.assertLeaf]).
 */
object TlsPin {
    fun client(fingerprint: String, pingSeconds: Long = 20): OkHttpClient {
        val trust = FingerprintTrustManager(fingerprint)
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf(trust), SecureRandom())
        return OkHttpClient.Builder()
            .sslSocketFactory(context.socketFactory, trust)
            // Istovetnost je odtis lista. Potrdilo je za localhost, ne za naslov DHCP.
            .hostnameVerifier { _, _ -> true }
            .pingInterval(pingSeconds, TimeUnit.SECONDS)
            .build()
    }

    fun normalize(fingerprint: String): String = LeafPin.normalize(fingerprint)

    fun pretty(fingerprint: String): String =
        normalize(fingerprint).chunked(2).joinToString(":").uppercase()

    private class FingerprintTrustManager(fingerprint: String) : X509TrustManager {
        private val expected = LeafPin.normalize(fingerprint)

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            throw CertificateException("odjemalec se ne overja")
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            try {
                // Samo chain[0]. Ujemanje kasnejsega certifikata je zavrnitev.
                LeafPin.assertLeaf(chain?.map { it.encoded }.orEmpty(), expected)
            } catch (error: LeafPin.Rejected) {
                throw CertificateException(error.message)
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
