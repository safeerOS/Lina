package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SecretCompareTest {
    @Test
    fun `ujemanje ne ustavi se na prvi crki`() {
        val token = "abcdefghijklmnopqrstuvwx"
        assertTrue(SecretCompare.equals(token, token))
        assertFalse(SecretCompare.equals("X" + token.drop(1), token))
        assertFalse(SecretCompare.equals(token.dropLast(1) + "X", token))
        assertFalse(SecretCompare.equals("", token))
        assertFalse(SecretCompare.equals(token, token + "y"))
    }
}
