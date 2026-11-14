package si.safeer.lina.protocol

import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ShellHandshakeTest {
    private val token = "lupina-zeton-ki-ne-sme-v-tuj-proces"

    @Test
    fun `staticni OL1 in tuj pozdrav ne odpreta nase lupine`() {
        val digest = sha256(token)
        val legacy = "OL1 $digest"
        assertTrue(ShellAuth.isStaticHello(legacy))
        assertNull(ShellAuth.clientProof(token, legacy, 43111))
        assertNull(ShellAuth.clientProof(token, "HTTP/1.0 200 OK", 43111))
        assertNull(ShellAuth.clientProof(token, null, 43111))
        assertFalse(ShellAuth.serverHello(ShellAuth.nonce()).contains(digest))
        assertFalse(ShellAuth.serverHello("abc").startsWith("OL1 "))
        assertFalse(ShellAuth.serverHello("abc").contains(token))
    }

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.encodeToByteArray())
            .joinToString("") { "%02x".format(it) }
}
