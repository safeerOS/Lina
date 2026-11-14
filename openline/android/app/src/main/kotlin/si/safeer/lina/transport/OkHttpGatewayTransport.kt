package si.safeer.lina.transport

import si.safeer.lina.config.GatewayConfig
import si.safeer.lina.protocol.GatewayUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * Povezava je samo wss in samo s pripetim odtisom. Golo ws:// se zavrne, preden gre na omrezje.
 */
class OkHttpGatewayTransport(
    private val config: GatewayConfig,
) : GatewayTransport {
    @Volatile
    private var listener: GatewayTransport.Listener? = null

    @Volatile
    private var socket: WebSocket? = null

    private val client: OkHttpClient? =
        if (config.wsUrl.startsWith("wss://") && config.certSha256.isNotBlank()) {
            TlsPin.client(config.certSha256)
        } else {
            null
        }

    override fun setListener(listener: GatewayTransport.Listener?) {
        this.listener = listener
    }

    override fun connect() {
        if (socket != null) return
        val pinned = client
        if (pinned == null || !GatewayUrl.accept(config.wsUrl, config.deviceToken)) {
            listener?.onFailure()
            return
        }
        val request = runCatching {
            Request.Builder()
                .url(config.wsUrl)
                .header("X-Device-Id", config.deviceId)
                .header("X-Device-Token", config.deviceToken)
                .build()
        }.getOrElse {
            listener?.onFailure()
            return
        }

        socket = runCatching {
            pinned.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        listener?.onOpen()
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        listener?.onMessage(text)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        socket = null
                        listener?.onClosed()
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        socket = null
                        listener?.onFailure()
                    }
                },
            )
        }.getOrElse {
            listener?.onFailure()
            null
        }
    }

    override fun send(text: String): Boolean = socket?.send(text) == true

    override fun close() {
        socket?.close(1000, "client_reconfigure")
        socket = null
    }
}
