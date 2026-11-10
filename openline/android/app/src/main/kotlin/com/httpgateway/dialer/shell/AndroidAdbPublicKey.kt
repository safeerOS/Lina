package com.httpgateway.dialer.shell

import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.interfaces.RSAPublicKey
import java.util.Base64

/** Javni kljuc v obliki, ki jo adbd zapise v /data/misc/adb/adb_keys. */
object AndroidAdbPublicKey {
    private const val MODULUS_BYTES = 256
    private const val MODULUS_WORDS = MODULUS_BYTES / 4

    fun encodeLine(key: RSAPublicKey, name: String = "httpgateway"): String {
        val body = Base64.getEncoder().encodeToString(encode(key))
        return "$body $name"
    }

    fun encode(key: RSAPublicKey): ByteArray {
        val modulus = key.modulus
        val out = ByteBuffer.allocate(4 + 4 + MODULUS_BYTES + MODULUS_BYTES + 4).order(ByteOrder.LITTLE_ENDIAN)
        out.putInt(MODULUS_WORDS)
        val n0 = modulus.mod(BigInteger.ONE.shiftLeft(32))
        out.putInt(n0.modInverse(BigInteger.ONE.shiftLeft(32)).negate().toInt())
        putLittleEndian(out, modulus, MODULUS_BYTES)
        val rr = BigInteger.ONE.shiftLeft(MODULUS_BYTES * 8).modPow(BigInteger.TWO, modulus)
        putLittleEndian(out, rr, MODULUS_BYTES)
        out.putInt(key.publicExponent.toInt())
        return out.array()
    }

    private fun putLittleEndian(buf: ByteBuffer, value: BigInteger, length: Int) {
        val raw = value.toByteArray()
        val copy = if (raw.size > length) raw.copyOfRange(raw.size - length, raw.size) else raw
        val bigEndian = ByteArray(length)
        System.arraycopy(copy, 0, bigEndian, length - copy.size, copy.size)
        for (index in length - 1 downTo 0) buf.put(bigEndian[index])
    }
}
