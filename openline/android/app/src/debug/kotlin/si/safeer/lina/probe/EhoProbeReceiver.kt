package si.safeer.lina.probe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import si.safeer.lina.transport.TlsPin
import si.safeer.lina.protocol.EhoProbeInput
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Preizkus stopnje 1 (samo debug): odpre wss s pripetim odtisom, poslje binarne okvirje (20 ms zvoka
 * 16 kHz s16le = 640 B) in preveri, da se vrnejo nespremenjeni. Rezultat gre v logcat (oznaka OL_EHO).
 * Sprozi ga samo lupina adb (dovoljenje DUMP v manifestu).
 * Pregled 15 (N13): samo wss:// in zeton NE kot dodatek namere (ukazna vrstica je vidna v seznamu procesov) -
 * lupina ga zapise v zasebno datoteko aplikacije, sonda jo prebere in takoj izbrise:
 *   adb shell "run-as si.safeer.lina sh -c 'umask 077; mkdir -p files; cat > files/eho-zeton'" < zeton.txt
 *   adb shell am broadcast -n si.safeer.lina/.probe.EhoProbeReceiver \
 *     --es naslov wss://<IP eho-wss>:8787/v1/device-channel --es odtis <sha256 iz izpisa eho-wss>
 * Cilj je SAMO razvojni streznik android/tools/eho-wss (sprejme glavo Authorization: Bearer). Strezniku OpenLine sonda
 * ni namenjena: njegov /v1/device-channel zahteva deviceId in x-device-token in bi Bearer zavrnil z 401.
 */
class EhoProbeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Pošiljatelj mora imeti dovoljenje DUMP (manifest): ga imata samo lupina adb in sistem.
        val tokenFile = File(context.filesDir, EhoProbeInput.TOKEN_FILE)
        if (intent.hasExtra("zeton")) {
            // Zeton v ukazni vrstici je ze ušel; sonda ga ne uporabi, da se navada ne utrdi.
            tokenFile.delete()
            Log.w(TAG, "zeton kot dodatek ni dovoljen - zapisi ga v files/${EhoProbeInput.TOKEN_FILE}")
            return
        }
        val config = try {
            EhoProbeInput.config(intent.getStringExtra("naslov"), intent.getStringExtra("odtis"), intent.getIntExtra("okvirjev", 50))
        } catch (e: IllegalArgumentException) {
            tokenFile.delete()
            Log.w(TAG, "zavrnjeno: ${e.message}")
            return
        }
        val zeton = EhoProbeInput.readTokenOnce(tokenFile)
            ?: return Log.w(TAG, "manjka veljaven zeton v files/${EhoProbeInput.TOKEN_FILE}").let { }
        val pending = goAsync()
        thread(name = "eho-probe") {
            try {
                zazeni(config.url, config.pin, zeton, config.frames)
            } finally {
                pending.finish()
            }
        }
    }

    private fun zazeni(naslov: String, odtis: String, zeton: String, okvirjev: Int) {
        val client = TlsPin.client(odtis, pingSeconds = 0)
        val poslano = HashMap<Int, Long>()
        val rtt = java.util.Collections.synchronizedList(ArrayList<Long>())
        val napak = java.util.concurrent.atomic.AtomicInteger(0)
        val konec = CountDownLatch(1)
        val zahteva = Request.Builder().url(naslov).header("Authorization", "Bearer $zeton").build()
        val ws = client.newWebSocket(zahteva, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                for (i in 0 until okvirjev) {
                    val okvir = ByteArray(640) { ((i + it) and 0xFF).toByte() }
                    okvir[0] = (i and 0xFF).toByte()
                    synchronized(poslano) { poslano[i] = System.nanoTime() }
                    webSocket.send(okvir.toByteString())
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val i = bytes[0].toInt() and 0xFF
                val t0 = synchronized(poslano) { poslano.remove(i) }
                val ok = bytes.size == 640 && (1 until 640).all { bytes[it] == ((i + it) and 0xFF).toByte() }
                if (t0 == null || !ok) napak.incrementAndGet() else rtt.add((System.nanoTime() - t0) / 1_000_000)
                if (rtt.size + napak.get() >= okvirjev) konec.countDown()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "NAPAKA povezave: ${t.javaClass.simpleName} ${response?.code ?: ""}")
                napak.set(okvirjev)
                konec.countDown()
            }
        })
        val prisel = konec.await(8, TimeUnit.SECONDS)
        // CodeRabbit (krog 17): izid zajamemo PRED ws.cancel() - preklic sprozi onFailure, ki bi uspeh prepisal v napako.
        val napakIzid = napak.get()
        val kopija = synchronized(rtt) { ArrayList(rtt) }.sorted()
        ws.cancel()
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
        val mediana = if (kopija.isEmpty()) -1 else kopija[kopija.size / 2]
        val najvec = kopija.lastOrNull() ?: -1
        Log.i(TAG, "EHO ${if (prisel && napakIzid == 0 && kopija.size == okvirjev) "OK" else "NAPAKA"} " +
            "okvirjev=$okvirjev vrnjenih=${kopija.size} napak=$napakIzid rtt_mediana_ms=$mediana rtt_najvec_ms=$najvec")
    }

    private companion object {
        const val TAG = "OL_EHO"
    }
}
