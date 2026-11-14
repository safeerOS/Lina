package si.safeer.lina.shell

import android.os.Process
import android.util.Log
import si.safeer.lina.audio.CallAudioEngine
import si.safeer.lina.protocol.MediaStream
import si.safeer.lina.protocol.ShellAuth
import si.safeer.lina.protocol.ShellCrashGuard
import si.safeer.lina.protocol.ShellEndpoint
import si.safeer.lina.protocol.StartReply
import org.json.JSONObject
import kotlin.system.exitProcess

/**
 * Lupina. Zeton in dovoljeni mediaUrl prideta po standardnem vhodu, ne v argv.
 * Natanko 6 vrstic: pty adb nima konca vhoda, readLines bi cakal, dokler
 * aplikacija toka ne zapre, takrat pa proces izgine. Odmeva vhoda ne pisemo.
 * Povezava je TCP 127.0.0.1. Vrata so nakljucna in gredo na izhod kot PORT.
 * Start ne sme prinesti svojega naslova ali odtisa.
 */
object ShellServerMain {
    private const val TAG = "HttpGatewayShell"

    @JvmStatic
    fun main(args: Array<String>) {
        Thread.setDefaultUncaughtExceptionHandler(ShellCrashGuard.handler { error ->
            Log.e(TAG, "neujeta izjema", error)
        })
        val version = args.getOrNull(0)?.toLongOrNull() ?: 0L
        if (args.size > 1) exitWith("skrivnost ne sme biti v ukazni vrstici")
        val config = ShellAuth.readConfigLines(System.`in`.bufferedReader())
            ?: exitWith("manjka konfiguracija na vhodu")
        val context = runCatching { ShellRuntime.install() }
            .onFailure { Log.e(TAG, "shell context unavailable", it) }
            .getOrNull()
        val engine = CallAudioEngine(context)
        engine.arm(config.mediaUrl, config.certSha256, config.deviceId, config.deviceToken)
        val endpoint = try {
            ShellEndpoint(config) { op, raw -> handle(op, raw, version, engine, config).toString() }
        } catch (e: Exception) {
            exitWith("cannot bind loopback: $e")
        }
        // Samo stevilka vrat. Konfiguracije in odmeva pty tu ni.
        println(endpoint.portLine())
        System.out.flush()
        Log.i(TAG, "listening uid=${Process.myUid()} version=$version port=${endpoint.port}")
        try {
            Thread.currentThread().join()
        } finally {
            endpoint.close()
        }
    }

    private fun handle(
        op: Map<String, String>,
        raw: String,
        version: Long,
        engine: CallAudioEngine,
        config: ShellAuth.LaunchConfig,
    ): JSONObject {
        val ok = JSONObject().put("ok", true)
        when (op["op"]) {
            "ping" -> ok.put("uid", Process.myUid())
                .put("version", version)
                .put("callId", engine.activeCallId().orEmpty())
                .put(
                    "config",
                    ShellAuth.configSignature(version, config.mediaUrl, config.certSha256, config.deviceToken),
                )
            "confirm" -> {
                if (!ShellAuth.acceptConfirm(engine.activeCallId(), op["callId"])) {
                    return JSONObject().put("ok", false).put("error", "confirm")
                }
                engine.confirm()
            }
            "open" -> {
                if (!ShellAuth.acceptConfirm(engine.activeCallId(), op["callId"])) {
                    return JSONObject().put("ok", false).put("error", "open")
                }
                engine.open()
            }
            "start" -> {
                val callId = op["callId"] ?: return JSONObject().put("ok", false).put("error", "callId")
                val gate = ShellAuth.targetForStart(config, callId, raw)
                    ?: return JSONObject().put("ok", false).put("error", "start zavrnjen")
                val media = runCatching { MediaStream.deviceMediaUrl(gate.mediaUrl, callId) }.getOrNull()
                    ?: return JSONObject().put("ok", false).put("error", "media url")
                val started = engine.start(
                    CallAudioEngine.Target(
                        callId = callId,
                        mediaUrl = media,
                        deviceId = gate.deviceId,
                        deviceToken = gate.deviceToken,
                        certSha256 = gate.certSha256,
                    ),
                )
                if (!StartReply.accepted(started)) {
                    return JSONObject().put("ok", false).put("error", "start zavrnjen")
                }
            }
            "stop" -> engine.stop(op["callId"]?.takeIf { it.isNotEmpty() })
            "exit" -> Thread {
                engine.stop()
                Thread.sleep(200)
                exitProcess(0)
            }.start()
            else -> return JSONObject().put("ok", false).put("error", "unknown op")
        }
        return ok
    }

    private fun exitWith(message: String): Nothing {
        Log.e(TAG, message)
        System.err.println(message)
        exitProcess(1)
    }
}
