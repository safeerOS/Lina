package si.safeer.lina.protocol

import java.security.MessageDigest

/**
 * Pripenjanje samopodpisanega certifikata.
 * Primerja se samo list (prvi certifikat v verigi). Odtis na vmesnem ali
 * korenskem certifikatu ne steje: napadalec v LAN lahko poslje
 * [svoj list, pravi certifikat] in bi sicer presel preverjanje.
 */
object TlsPin {
    class Rejected(message: String) : Exception(message)

    fun normalize(fingerprint: String): String =
        fingerprint.lowercase().filter { it in '0'..'9' || it in 'a'..'f' }

    fun sha256Hex(encoded: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(encoded).joinToString("") { "%02x".format(it) }

    /**
     * Prazen niz, prekratak odtis, prazna veriga ali drug list so zavrnitev.
     * Ostali certifikati v verigi se ne gledajo.
     */
    fun assertLeaf(encodedChain: List<ByteArray>, fingerprint: String) {
        val expected = normalize(fingerprint)
        if (expected.length != 64) throw Rejected("odtis manjka")
        val leaf = encodedChain.firstOrNull() ?: throw Rejected("ni certifikata")
        val actual = sha256Hex(leaf)
        // Konstanten cas. Primerjava niza z != se ustavi na prvi razliki.
        if (!SecretCompare.equals(actual, expected)) throw Rejected("odtis certifikata se ne ujema")
    }

    /**
     * Zvok in zeton naprave smeta venci samo prek wss in samo s polnim odtisom.
     * Vrne normaliziran odtis ali vrze, ce se povezava ne sme odpreti.
     */
    fun requireMediaPin(mediaUrl: String, fingerprint: String?): String {
        if (!mediaUrl.trim().startsWith("wss://")) throw IllegalArgumentException("zvok samo prek wss")
        val pin = normalize(fingerprint.orEmpty())
        if (pin.length != 64) throw IllegalArgumentException("odtis manjka")
        return pin
    }
}
