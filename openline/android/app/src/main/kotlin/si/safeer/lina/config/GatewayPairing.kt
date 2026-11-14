package si.safeer.lina.config

import android.content.Context
import android.net.Uri
import android.os.Build
import si.safeer.lina.transport.TlsPin
import si.safeer.lina.protocol.GatewayDeviceId
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * QR seznanitev: konzola pokaze `httpgateway://pair?url=<https>&code=<koda>&fp=<odtis>`.
 * Aplikacija kodo zamenja za poverilnice. Povezava je samo https/wss, certifikat pa je pripet po odtisu.
 */
object GatewayPairing {
    data class Invite(val serverUrl: String, val code: String, val certSha256: String)

    /** Zavrnitev z imenom niza. Zaslon pokaze niz, ne besedila izjeme (N11-7). */
    class Refused(val resource: String) : IllegalStateException(resource)

    /** Ista pravila kot QrSeznanitev.stariOpenLine (cisti JVM, preizkusi v modulu seznanitev). */
    fun parse(text: String): Invite? =
        si.safeer.lina.seznanitev.QrSeznanitev.stariOpenLine(text.trim())?.let { Invite(it.serverUrl, it.code, it.certSha256) }

    /** Blokirajoc klic. Klient zaupa samo pripetemu odtisu. */
    fun pair(context: Context, invite: Invite): GatewayConfig {
        val body = JSONObject()
            .put("code", invite.code)
            .put("name", "${Build.MANUFACTURER.replaceFirstChar(Char::uppercase)} ${Build.MODEL}")
            .toString()
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url("${invite.serverUrl}/v1/pair").post(body).build()
        val client = TlsPin.client(invite.certSha256, pingSeconds = 0)
            .newBuilder()
            .callTimeout(20, TimeUnit.SECONDS)
            .build()
        val json = client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val parsed = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (!response.isSuccessful) {
                val message = parsed.optJSONObject("error")?.optString("message")
                throw IllegalStateException(message?.takeIf { it.isNotBlank() } ?: "server answered HTTP ${response.code}")
            }
            parsed
        }
        val wsUrl = "wss://" + invite.serverUrl.removePrefix("https://") +
            json.optString("deviceChannelPath", "/v1/device-channel")
        val deviceId = json.getJSONObject("device").getString("id")
        GatewayDeviceId.resourceName(GatewayDeviceId.check(deviceId))?.let { throw Refused(it) }
        val config = GatewayConfig(
            wsUrl = wsUrl,
            deviceId = deviceId,
            deviceToken = json.getString("deviceToken"),
            certSha256 = invite.certSha256,
        )
        GatewayConfigStore(context).save(config)
        return config
    }
}
