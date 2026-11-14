package si.safeer.lina.protocol

import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong

/**
 * Primerjava skrivnosti v konstantnem casu glede na vsebino.
 * Najprej oba niza zgostimo, nato primerjamo odtisa z [MessageDigest.isEqual],
 * ki se ne ustavi na prvi razliki. == bi se ustavil na prvi razliki.
 */
object SecretCompare {
    /** Stevec klicev. Preizkus pade, ce rokovanje primerja z ==. */
    val compares: AtomicLong = AtomicLong(0)

    fun equals(
        left: String,
        right: String,
        compare: (ByteArray, ByteArray) -> Boolean = MessageDigest::isEqual,
    ): Boolean {
        compares.incrementAndGet()
        val digest = MessageDigest.getInstance("SHA-256")
        val a = digest.digest(left.encodeToByteArray())
        val b = digest.digest(right.encodeToByteArray())
        return compare(a, b)
    }
}
