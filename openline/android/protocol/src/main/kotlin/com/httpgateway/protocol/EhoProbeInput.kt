package com.httpgateway.protocol

import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.LinkOption

/**
 * Vhod debug eho sonde (pregled 15, N13), brez Androida, da ima preizkus.
 * - Naslov samo wss:// s polnim odtisom: ws:// bi zeton poslal nesifrirano.
 * - Zeton NE pride kot dodatek namere: ukazna vrstica `am broadcast --es zeton ...` je vidna v seznamu procesov
 *   lupine in v zgodovini ukazov. Lupina ga zapise v zasebno datoteko aplikacije (run-as), sonda ga prebere
 *   in datoteko takoj izbrise - tudi ce je zeton neveljaven.
 */
object EhoProbeInput {
    const val TOKEN_FILE = "eho-zeton"
    const val MIN_TOKEN_BYTES = 32
    private const val MAX_TOKEN_FILE_BYTES = 4096L

    data class Config(val url: String, val pin: String, val frames: Int)

    fun config(naslov: String?, odtis: String?, okvirjev: Int): Config {
        val url = naslov?.trim().orEmpty()
        val uri = try { URI(url) } catch (_: Exception) { throw IllegalArgumentException("neveljaven naslov") }
        require(uri.scheme.equals("wss", ignoreCase = false)) { "sonda samo prek wss" }
        require(!uri.host.isNullOrEmpty()) { "naslov brez gostitelja" }
        require(uri.rawUserInfo == null) { "naslov z uporabniskim imenom" }
        val pin = TlsPin.requireMediaPin(url, odtis)
        return Config(url, pin, okvirjev.coerceIn(1, 256))
    }

    /** Prebere zeton in datoteko vedno izbrise. Vrne null, ce datoteke ni, ni navadna ali zeton ni veljaven. */
    fun readTokenOnce(file: File): String? {
        try {
            val path = file.toPath()
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) return null
            if (Files.size(path) > MAX_TOKEN_FILE_BYTES) return null
            val token = String(Files.readAllBytes(path), Charsets.UTF_8).trim()
            if (token.toByteArray(Charsets.UTF_8).size < MIN_TOKEN_BYTES) return null
            if (token.any { it.isWhitespace() || it.isISOControl() }) return null
            return token
        } catch (_: java.io.IOException) {
            return null
        } finally {
            try { Files.deleteIfExists(file.toPath()) } catch (_: java.io.IOException) { }
        }
    }
}
