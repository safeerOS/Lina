package si.safeer.lina.samostojna.live

import java.net.URI
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.util.concurrent.CompletionStage

class JavaNetWsFabrika : WsFabrika {
    private val client = HttpClient.newBuilder().build()

    override fun odpri(url: String, glave: Map<String, String>, poslusalec: WsPoslusalec): WsPovezava {
        val builder = client.newWebSocketBuilder()
        for ((k, v) in glave) {
            builder.header(k, v)
        }
        
        var w: WebSocket? = null
        val povezava = object : WsPovezava {
            override fun posiljiBesedilo(besedilo: String) {
                w?.sendText(besedilo, true)
            }
            override fun zapri(koda: Int, razlog: String) {
                w?.sendClose(koda, razlog)
            }
        }

        val listener = object : WebSocket.Listener {
            private val textBuilder = StringBuilder()

            override fun onOpen(webSocket: WebSocket) {
                w = webSocket
                poslusalec.onOpen(povezava)
                webSocket.request(1)
            }

            override fun onText(webSocket: WebSocket, data: CharSequence, last: Boolean): CompletionStage<*>? {
                textBuilder.append(data)
                if (last) {
                    val msg = textBuilder.toString()
                    textBuilder.clear()
                    poslusalec.onText(msg)
                }
                webSocket.request(1)
                return null
            }

            override fun onError(webSocket: WebSocket, error: Throwable) {
                poslusalec.onError(error)
            }

            override fun onClose(webSocket: WebSocket, statusCode: Int, reason: String): CompletionStage<*>? {
                poslusalec.onClose(statusCode, reason)
                return null
            }
        }
        
        builder.buildAsync(URI.create(url), listener).join() // wait for connect to throw exceptions synchronously like OkHttp
        return povezava
    }
}
