package si.safeer.lina.shell

import android.content.Context
import si.safeer.lina.protocol.ShellAuth
import si.safeer.lina.protocol.ShellClientProtocol
import si.safeer.lina.protocol.ShellHandshake
import si.safeer.lina.protocol.ShellLaunchVerdict
import si.safeer.lina.protocol.ShellProbe
import si.safeer.lina.protocol.ShellSessionWrite
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64

/**
 * Odjemalec lupine. Samo TCP 127.0.0.1 in obojestranski HMAC.
 * Zeton ne gre v JSON. UID vrstnika na zalogi Android ni dosegljiv:
 * SELinux zavrne abstraktno vticnico med aplikacijo in lupino.
 */
class ShellClient(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("shell_server", Context.MODE_PRIVATE)

    val version: Long = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime

    /** Nov zeton in pozabljena vrata v enem zapisu. Stara vrata ne ostanejo ob novem zetonu. */
    fun rotateToken(): String {
        val next = newToken()
        val record = ShellSessionWrite.beginRotation(next)
        prefs.edit().putString(KEY_TOKEN, record.token).putInt(KEY_PORT, record.port).apply()
        return next
    }

    val token: String
        get() = prefs.getString(KEY_TOKEN, null) ?: rotateToken()

    fun forgetPort() {
        prefs.edit().remove(KEY_PORT).apply()
    }

    /** Zeton in vrata se zapiseta skupaj, da se po padcu ne razideta. */
    fun rememberPort(port: Int) {
        val record = ShellSessionWrite.commit(token, port)
        prefs.edit().putString(KEY_TOKEN, record.token).putInt(KEY_PORT, record.port).apply()
    }

    fun setSessionHeld(held: Boolean) {
        prefs.edit().putBoolean(KEY_HELD, held).apply()
    }

    fun sessionHeld(): Boolean = prefs.getBoolean(KEY_HELD, false)

    fun detachMemory(): String? = prefs.getString(KEY_DETACH, null)?.takeIf { it.isNotBlank() }

    fun rememberDetach(kind: ShellLaunchVerdict.Kind) {
        prefs.edit().putString(KEY_DETACH, kind.name).apply()
    }

    val port: Int
        get() = prefs.getInt(KEY_PORT, -1)

    fun launchConfig(
        mediaUrl: String, certSha256: String, deviceId: String, deviceToken: String,
        localPort: String = "", localCertSha256: String = "", localDeviceToken: String = ""
    ): ShellAuth.LaunchConfig =
        ShellAuth.LaunchConfig(
            token = token,
            appUid = android.os.Process.myUid(),
            mediaUrl = mediaUrl,
            certSha256 = certSha256,
            deviceId = deviceId,
            deviceToken = deviceToken,
            localPort = localPort,
            localCertSha256 = localCertSha256,
            localDeviceToken = localDeviceToken,
        )

    fun ping(): JSONObject? = request(JSONObject().put("op", "ping"))
        ?.takeIf { it.optBoolean("ok") && it.optLong("version") == version }

    fun isRunning(): Boolean = ping() != null

    fun probe(expectedSignature: String): ShellHandshake.Probe {
        val current = port
        if (current <= 0) return ShellHandshake.Probe.ABSENT
        fun once(): ShellHandshake.Probe {
            val trip = ShellClientProtocol.roundTrip(current, token, """{"op":"ping"}""")
            val body = (trip as? ShellClientProtocol.RoundTrip.Ok)
                ?.body
                ?.let { runCatching { JSONObject(it) }.getOrNull() }
            val versionMatches = body?.optBoolean("ok") == true && body.optLong("version") == version
            val reported = body?.optString("config").orEmpty()
            val configMatches = reported.isNotEmpty() && reported == expectedSignature
            return ShellProbe.fromTrip(trip, versionMatches, configMatches)
        }
        val first = once()
        if (first != ShellHandshake.Probe.BUSY) return first
        return ShellProbe.afterRetry(first, once())
    }

    /** Samo id klica. mediaUrl in odtis sta ze v lupini. */
    fun start(callId: String, local: Boolean = false): JSONObject? = request(JSONObject().put("op", "start").put("callId", callId).put("local", local))

    fun confirm(callId: String): JSONObject? =
        request(JSONObject().put("op", "confirm").put("callId", callId))

    /** Seja se sme povezati na streznik. Brez tega ukaza lupina ne poslje nobenega okvirja. */
    fun open(callId: String): JSONObject? =
        request(JSONObject().put("op", "open").put("callId", callId))

    fun stop(callId: String?, timeoutMs: Int = ShellAuth.HANDSHAKE_TIMEOUT_MS): JSONObject? {
        val body = JSONObject().put("op", "stop")
        if (!callId.isNullOrEmpty()) body.put("callId", callId)
        return request(body, timeoutMs)
    }

    fun exit(): JSONObject? = request(JSONObject().put("op", "exit"))

    private fun request(body: JSONObject, timeoutMs: Int = ShellAuth.HANDSHAKE_TIMEOUT_MS): JSONObject? {
        val current = port
        if (current <= 0) return null
        val line = body.toString()
        if (ShellAuth.requestCarriesSecrets(line) || line.contains(token)) return null
        val reply = ShellClientProtocol.exchange(current, token, line, timeoutMs) ?: return null
        return runCatching { JSONObject(reply) }.getOrNull()
    }

    private fun newToken(): String = ByteArray(32).also(SecureRandom()::nextBytes)
        .let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }

    private companion object {
        const val KEY_TOKEN = "token"
        const val KEY_PORT = "port"
        const val KEY_HELD = "adb_session_held"
        const val KEY_DETACH = "detach_verdict"
    }
}
