package com.httpgateway.protocol

import javax.crypto.KeyGenerator
import kotlin.test.Test
import kotlin.test.assertFails
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AdbKeyBlobTest {
    @Test
    fun `pkcs8 na disku ni gol`() {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val pkcs8 = byteArrayOf(0x30, 0x82.toByte(), 0x04, 0x00) + ByteArray(64) { it.toByte() }
        val blob = AdbKeyBlob.seal(key, pkcs8)
        assertFalse(AdbKeyBlob.looksLikeRawPkcs8(blob))
        assertTrue(pkcs8.contentEquals(AdbKeyBlob.open(key, blob)))
        assertFails { AdbKeyBlob.open(other, blob) }
        assertFails { AdbKeyBlob.open(key, pkcs8) }
    }
}
