package si.safeer.lina.protocol

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/**
 * Branje vrstice z omejitvijo dolzine in skupnim rokom.
 * soTimeout na posameznem branju se ne sme podaljsevati ob vsakem bajtu.
 * IOException (tudi RST) je konec vrstice, ne pobeg iz niti.
 */
object ShellIo {
    fun readLine(
        input: InputStream,
        maxBytes: Int,
        deadlineMs: Long,
        arm: (timeoutMs: Int) -> Unit,
    ): String? {
        val buf = ByteArrayOutputStream()
        while (buf.size() < maxBytes) {
            val remain = (deadlineMs - System.currentTimeMillis()).toInt()
            if (remain <= 0) return null
            arm(remain)
            val b = try {
                input.read()
            } catch (_: IOException) {
                return null
            }
            if (b < 0) return null
            if (b == '\n'.code) return buf.toString(Charsets.UTF_8).trimEnd('\r')
            if (b != '\r'.code) buf.write(b)
        }
        return null
    }
}
