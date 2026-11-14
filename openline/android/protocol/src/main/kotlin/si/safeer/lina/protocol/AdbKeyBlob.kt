package si.safeer.lina.protocol

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Zasebni kljuc ADB na disku je samo sifrogram AES-GCM.
 * Kljuc za ovijanje zivi v Android Keystore in ga v datoteki ni.
 * Goli PKCS#8 (zacetek 0x30) se ne zapisuje.
 */
object AdbKeyBlob {
    private val MAGIC = byteArrayOf(0x4F, 0x4C, 0x4B, 0x31) // OLK1

    fun seal(key: SecretKey, plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plain)
        return MAGIC + byteArrayOf(iv.size.toByte()) + iv + ciphertext
    }

    fun open(key: SecretKey, blob: ByteArray): ByteArray {
        if (blob.size < 5 || !blob.copyOfRange(0, 4).contentEquals(MAGIC)) {
            throw IllegalArgumentException("kljuc ni ovit")
        }
        val ivLength = blob[4].toInt() and 0xFF
        if (ivLength < 12 || blob.size < 5 + ivLength + 16) {
            throw IllegalArgumentException("ovojnica je pokvarjena")
        }
        val iv = blob.copyOfRange(5, 5 + ivLength)
        val ciphertext = blob.copyOfRange(5 + ivLength, blob.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    }

    /** Goli PKCS#8 se zacne z ASN.1 SEQUENCE. Ovito telo se ne sme. */
    fun looksLikeRawPkcs8(blob: ByteArray): Boolean = blob.isNotEmpty() && blob[0] == 0x30.toByte()
}
