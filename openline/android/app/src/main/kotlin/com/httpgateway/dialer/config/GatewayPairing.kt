package com.httpgateway.dialer.config

import android.content.Context
import android.net.Uri
import android.os.Build
import com.httpgateway.dialer.transport.TlsPin
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

    fun parse(text: String): Invite? {
        val uri = runCatching { Uri.parse(text.trim()) }.getOrNull() ?: return null
        if (uri.scheme != "httpgateway" || uri.host != "pair") return null
        val server = uri.getQueryParameter("url")?.trimEnd('/') ?: return null
        val code = uri.getQueryParameter("code") ?: return null
        val fingerprint = uri.getQueryParameter("fp")?.trim().orEmpty()
        // Golo http:// ni dovoljeno. Brez odtisa se ne povezemo.
        if (!server.startsWith("https://")) return null
        if (fingerprint.isEmpty()) return null
        return Invite(server, code, fingerprint)
    }

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
        val idCheck = com.httpgateway.protocol.GatewayDeviceId.check(deviceId)
        if (idCheck == com.httpgateway.protocol.GatewayDeviceId.Problem.EMPTY) {
            throw IllegalStateException(context.getString(com.httpgateway.dialer.R.string.empty_device_id))
        }
        if (idCheck == com.httpgateway.protocol.GatewayDeviceId.Problem.NOT_ASCII) {
            throw IllegalStateException(context.getString(com.httpgateway.dialer.R.string.need_ascii_device_id))
        }
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
