package com.httpgateway.protocol

import java.io.BufferedReader
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Nadzor lupine. Zeton nikoli ne gre na zico in ne v ukazno vrstico.
 * Obe strani si izmenjata enkratni vrednosti in HMAC. Statičen pozdrav OL1
 * ni dokaz: napadalec, ki ga prebere, se ne more izdajati za lupino.
 * mediaUrl in odtis sta znana ob zagonu, ne iz zahteve start.
 * Povezava je TCP 127.0.0.1. UID vrstnika ni: SELinux na zalogi Android
 * zavrne abstraktno vticnico med aplikacijo in lupino.
 */
object ShellAuth {
    const val SHELL_UID = 2000
    const val HANDSHAKE_TIMEOUT_MS = 5_000
    /** Rok do dokaza odjemalca. Neoverjena povezava ne drzi mesta 5 s. */
    const val PROOF_TIMEOUT_MS = 300
    const val MAX_LINE_BYTES = 512
    const val MAX_CONNECTIONS = 8
    private val random = SecureRandom()

    data class LaunchConfig(
        val token: String,
        val appUid: Int,
        val mediaUrl: String,
        val certSha256: String,
        val deviceId: String,
        val deviceToken: String,
    ) {
        override fun toString(): String = "LaunchConfig(appUid=$appUid,deviceId=$deviceId)"
    }

    data class StartTarget(
        val callId: String,
        val mediaUrl: String,
        val certSha256: String,
        val deviceId: String,
        val deviceToken: String,
    ) {
        override fun toString(): String = "StartTarget(callId=$callId,deviceId=$deviceId)"
    }

    data class ClientProof(val serverNonce: String, val clientNonce: String, val line: String)

    fun nonce(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun serverHello(serverNonce: String): String = "OL2 $serverNonce"

    fun clientLine(token: String, serverNonce: String, clientNonce: String, port: Int): String =
        "$clientNonce ${mac(token, "c", serverNonce, clientNonce, port)}"

    fun serverLine(token: String, serverNonce: String, clientNonce: String, port: Int): String =
        mac(token, "s", serverNonce, clientNonce, port)

    fun acceptClient(token: String, serverNonce: String, line: String?, port: Int): Boolean {
        if (line.isNullOrBlank() || isStaticHello(line)) return false
        val parts = line.trim().split(" ", limit = 2)
        if (parts.size != 2) return false
        val clientNonce = parts[0]
        if (clientNonce.length < 32) return false
        return SecretCompare.equals(parts[1], mac(token, "c", serverNonce, clientNonce, port))
    }

    fun acceptServer(token: String, serverNonce: String, clientNonce: String, line: String?, port: Int): Boolean {
        if (line.isNullOrBlank() || isStaticHello(line)) return false
        return SecretCompare.equals(line.trim(), mac(token, "s", serverNonce, clientNonce, port))
    }

    fun clientNonceOf(line: String?): String? =
        line?.trim()?.split(" ", limit = 2)?.firstOrNull()?.takeIf { it.length >= 32 }

    /**
     * Odjemalec sestavi odgovor samo za OL2 z enkratno vrednostjo.
     * Vrstica ne vsebuje zetona. OL1 in prazen pozdrav data null, da se
     * skrivnost ne poslje lazni lupini.
     */
    fun clientProof(token: String, hello: String?, port: Int, clientNonce: String = nonce()): ClientProof? {
        if (hello.isNullOrBlank() || isStaticHello(hello)) return null
        val trimmed = hello.trim()
        if (!trimmed.startsWith("OL2 ")) return null
        val serverNonce = trimmed.removePrefix("OL2 ").trim()
        if (serverNonce.length < 32 || serverNonce.any { it.isWhitespace() }) return null
        val line = clientLine(token, serverNonce, clientNonce, port)
        if (line.contains(token)) return null
        return ClientProof(serverNonce, clientNonce, line)
    }

    /** Stari pozdrav OL1 in zgostitev zetona nista vec veljavna. */
    fun isStaticHello(line: String?): Boolean = line?.trim()?.startsWith("OL1 ") == true

    fun argvHasSecret(argv: List<String>, config: LaunchConfig): Boolean {
        val joined = argv.joinToString(" ")
        return listOf(config.token, config.deviceToken, config.certSha256, config.mediaUrl)
            .any { it.isNotEmpty() && joined.contains(it) }
    }

    /** Sest vrstic na standardni vhod. Zeton je prva, ne argument. */
    fun stdinText(config: LaunchConfig): String = listOf(
        config.token,
        config.appUid.toString(),
        config.mediaUrl,
        config.certSha256,
        config.deviceId,
        config.deviceToken,
    ).joinToString("\n", postfix = "\n")

    fun readConfig(lines: List<String>): LaunchConfig? {
        if (lines.size < 6) return null
        val token = lines[0].trim()
        val uid = lines[1].trim().toIntOrNull() ?: return null
        if (token.length < 16 || uid <= 0) return null
        return LaunchConfig(
            token = token,
            appUid = uid,
            mediaUrl = lines[2].trim(),
            certSha256 = lines[3].trim(),
            deviceId = lines[4].trim(),
            deviceToken = lines[5].trim(),
        )
    }

    /**
     * Natanko 6 klicev readLine. Ne bere do konca vhoda: pty adb shell
     * konca nima, dokler aplikacija toka ne zapre, takrat pa proces umre.
     */
    fun readConfigLines(reader: BufferedReader): LaunchConfig? {
        val lines = ArrayList<String>(6)
        repeat(6) {
            val line = reader.readLine() ?: return null
            lines.add(line)
        }
        return readConfig(lines)
    }

    fun portLine(port: Int): String = "PORT $port"

    /** Samo vrstica PORT gre naprej. Odmev pty se ne zapisuje. */
    fun parsePortLine(line: String): Int? {
        val trimmed = line.trim()
        if (!trimmed.startsWith("PORT ")) return null
        val port = trimmed.removePrefix("PORT ").trim().toIntOrNull() ?: return null
        if (port !in 1..65535) return null
        return port
    }

    /**
     * Samo cela vrstica, ki se konca z novim redom.
     * "PORT 45" brez \n se ni 45: nadaljevanje je lahko "678\n".
     */
    fun portFromBuffer(text: String): Int? {
        val end = text.lastIndexOf('\n')
        if (end < 0) return null
        val complete = text.substring(0, end)
        for (line in complete.split('\n')) {
            val port = parsePortLine(line.trimEnd('\r')) ?: continue
            return port
        }
        return null
    }

    /** Odtis zagona: sprememba naslova, odtisa, zetona ali razlicice zahteva nov zagon. */
    fun configSignature(version: Long, mediaUrl: String, certSha256: String, deviceToken: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        val body = "$version\n$mediaUrl\n$certSha256\n$deviceToken"
        return digest.digest(body.encodeToByteArray()).joinToString("") { "%02x".format(it) }
    }

    /** Potrditev velja samo za sejo, ki jo aplikacija se pricakuje. */
    fun acceptConfirm(activeCallId: String?, requestedCallId: String?): Boolean =
        !activeCallId.isNullOrEmpty() && activeCallId == requestedCallId

    fun parseOp(line: String?): Map<String, String>? {
        if (line.isNullOrBlank() || line.contains("\"token\"")) return null
        val op = field(line, "op") ?: return null
        return buildMap {
            put("op", op)
            field(line, "callId")?.let { put("callId", it) }
        }
    }

    fun requestCarriesSecrets(line: String?): Boolean {
        if (line.isNullOrBlank()) return false
        val raw = line.lowercase()
        return listOf("token", "mediaurl", "certsha256", "devicetoken", "deviceid").any { key ->
            raw.contains("\"$key\"")
        }
    }

    /** Cilj zajema je samo konfiguracija ob zagonu, nikoli polja iz zahteve. */
    fun targetForStart(config: LaunchConfig, callId: String, requestLine: String): StartTarget? {
        if (requestCarriesSecrets(requestLine)) return null
        val op = parseOp(requestLine) ?: return null
        if (op["op"] != "start" || op["callId"] != callId) return null
        if (config.mediaUrl.isBlank() || config.certSha256.isBlank()) return null
        return StartTarget(callId, config.mediaUrl, config.certSha256, config.deviceId, config.deviceToken)
    }

    private fun field(line: String, name: String): String? {
        val key = "\"$name\""
        val at = line.indexOf(key)
        if (at < 0) return null
        val colon = line.indexOf(':', at + key.length)
        if (colon < 0) return null
        val quote = line.indexOf('"', colon + 1)
        if (quote < 0) return null
        val end = line.indexOf('"', quote + 1)
        if (end < 0) return null
        return line.substring(quote + 1, end)
    }

    private fun mac(token: String, label: String, serverNonce: String, clientNonce: String, port: Int): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(token.encodeToByteArray(), "HmacSHA256"))
        val body = "$label\n$serverNonce\n$clientNonce\n$port".encodeToByteArray()
        return mac.doFinal(body).joinToString("") { "%02x".format(it) }
    }
}

/** Brez potrditve aplikacije lupina sama ustavi zajem. */
object ShellLease {
    const val MAX_SILENCE_MS = 8_000L

    fun expired(lastConfirmMs: Long, nowMs: Long): Boolean = nowMs - lastConfirmMs >= MAX_SILENCE_MS
}

/** Telefon primerja sejo, ki jo pricakuje, s tisto, ki jo lupina javi na ping. */
object AudioPing {
    fun shouldConfirm(expectedCallId: String?): Boolean = !expectedCallId.isNullOrEmpty()

    /**
     * Padec ali tuja seja. Ce aplikacija nicesar ne pricakuje, a lupina se zajema,
     * je to tudja seja in jo je treba ustaviti.
     */
    fun dropped(expectedCallId: String?, reportedCallId: String?): Boolean {
        val reported = reportedCallId?.takeIf { it.isNotEmpty() }
        if (expectedCallId.isNullOrEmpty()) return reported != null
        return reported == null || reported != expectedCallId
    }

    fun stopSettled(replyOk: Boolean): Boolean = replyOk

    /**
     * Confirm samo, ce aplikacija se pricakuje tocno to sejo.
     * Ob tuji ali padli seji stop(null), dokler ne uspe.
     */
    fun tick(expectedCallId: String?, reportedCallId: String?): Tick {
        val dropped = dropped(expectedCallId, reportedCallId)
        val confirm = if (!dropped && shouldConfirm(expectedCallId)) expectedCallId else null
        val notify = dropped && !expectedCallId.isNullOrEmpty()
        val stopTarget = if (dropped && expectedCallId != reportedCallId) null else expectedCallId
        return Tick(
            confirmCallId = confirm,
            stop = dropped,
            clearExpected = notify,
            notifyDropped = notify,
            stopTarget = stopTarget,
        )
    }

    data class Tick(
        val confirmCallId: String?,
        val stop: Boolean,
        val clearExpected: Boolean,
        val notifyDropped: Boolean,
        val stopTarget: String?,
    )
}
