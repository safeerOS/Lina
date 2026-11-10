package com.httpgateway.dialer.config

import android.content.Context
import com.httpgateway.dialer.BuildConfig
import com.httpgateway.protocol.ConfigPrivacy
import java.util.UUID

data class GatewayConfig(
    val wsUrl: String,
    val deviceId: String,
    val deviceToken: String,
    /** SHA-256 odtis samopodpisanega certifikata streznika. Brez njega ni povezave. */
    val certSha256: String = "",
) {
    override fun toString(): String = ConfigPrivacy.gateway(deviceId)
}

class GatewayConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("gateway_config", Context.MODE_PRIVATE)

    fun load(): GatewayConfig {
        var deviceId = prefs.getString(KEY_DEVICE_ID, null).orEmpty()
        if (deviceId.isBlank()) {
            deviceId = "device_${UUID.randomUUID()}"
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
        }

        return GatewayConfig(
            wsUrl = prefs.getString(KEY_WS_URL, BuildConfig.DEFAULT_GATEWAY_WS_URL)
                ?.takeIf { it.isNotBlank() }
                ?: BuildConfig.DEFAULT_GATEWAY_WS_URL,
            deviceId = deviceId,
            deviceToken = prefs.getString(KEY_DEVICE_TOKEN, "").orEmpty(),
            certSha256 = prefs.getString(KEY_CERT, "").orEmpty(),
        )
    }

    fun save(config: GatewayConfig) {
        prefs.edit()
            .putString(KEY_WS_URL, config.wsUrl.trim())
            .putString(KEY_DEVICE_ID, config.deviceId.trim())
            .putString(KEY_DEVICE_TOKEN, config.deviceToken.trim())
            .putString(KEY_CERT, config.certSha256.trim())
            .commit() // synchronous: the runtime reconnects with this config right after
    }

    private companion object {
        const val KEY_WS_URL = "ws_url"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_TOKEN = "device_token"
        const val KEY_CERT = "cert_sha256"
    }
}
