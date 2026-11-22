package si.safeer.lina

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import si.safeer.lina.samostojna.live.WsFabrika
import si.safeer.lina.samostojna.live.WsPoslusalec
import si.safeer.lina.samostojna.live.WsPovezava
import java.util.concurrent.TimeUnit

class OkHttpWsFabrika : WsFabrika {
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    override fun odpri(url: String, glave: Map<String, String>, poslusalec: WsPoslusalec): WsPovezava {
        val reqBuilder = Request.Builder().url(url)
        for ((k, v) in glave) {
            reqBuilder.addHeader(k, v)
        }
        val request = reqBuilder.build()
        
        var povezava: WsPovezava? = null

        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                povezava = object : WsPovezava {
                    override fun posiljiBesedilo(besedilo: String) {
                        webSocket.send(besedilo)
                    }
                    override fun zapri(koda: Int, razlog: String) {
                        webSocket.close(koda, razlog)
                    }
                }
                poslusalec.onOpen(povezava as WsPovezava)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                poslusalec.onText(text)
            }

            // Vertex Live poslje JSON v BINARNIH okvirjih (racunalniska pot jih bere kot ArrayBuffer). Klic na Samsungu 22. 11. 2026 ob 10.30:
            // brez te metode »setupComplete« ni nikoli prisel in klic se je po 5 s koncal z »Model se ni odzval«.
            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                poslusalec.onText(bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                poslusalec.onError(t)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                val veljavnaKoda = if (code == 1005 || code == 1006) 1000 else code
                webSocket.close(veljavnaKoda, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                poslusalec.onClose(code, reason)
            }
        })
        
        return object : WsPovezava {
            override fun posiljiBesedilo(besedilo: String) {
                ws.send(besedilo)
            }
            override fun zapri(koda: Int, razlog: String) {
                ws.close(koda, razlog)
            }
        }
    }
}
