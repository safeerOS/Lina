package si.safeer.lina.transport

import si.safeer.lina.protocol.PinnedHttp
import si.safeer.lina.protocol.TlsPin as LeafPin
import okhttp3.OkHttpClient

/**
 * Zaupa samo strezniku, katerega listni certifikat ima pritrjen odtis SHA-256.
 * Izvedba (in preizkus, N3: brez preusmeritev) je v protocol/PinnedHttp.
 */
object TlsPin {
    fun client(fingerprint: String, pingSeconds: Long = 20): OkHttpClient = PinnedHttp.client(fingerprint, pingSeconds)

    fun normalize(fingerprint: String): String = LeafPin.normalize(fingerprint)

    fun pretty(fingerprint: String): String =
        normalize(fingerprint).chunked(2).joinToString(":").uppercase()
}
