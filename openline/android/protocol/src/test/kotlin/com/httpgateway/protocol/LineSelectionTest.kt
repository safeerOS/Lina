package com.httpgateway.protocol

import kotlin.test.Test
import kotlin.test.assertEquals

class LineSelectionTest {

    @Test
    fun `shranjena in aktivna linija se uporabi`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = true),
            Line("2", "Druga", isEsim = true, active = true)
        )
        val result = LineSelection.choose(lines, "2")
        assertEquals(LineSelectionResult.Use("2"), result)
    }

    @Test
    fun `vec aktivnih linij brez shranjene zahteva izbiro`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = true),
            Line("2", "Druga", isEsim = true, active = true)
        )
        val result = LineSelection.choose(lines, null)
        assertEquals(LineSelectionResult.Ambiguous, result)
    }

    @Test
    fun `vec aktivnih linij in neustrezna shranjena zahteva izbiro`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = true),
            Line("2", "Druga", isEsim = true, active = true)
        )
        val result = LineSelection.choose(lines, "3")
        assertEquals(LineSelectionResult.SavedUnavailable, result)
    }

    @Test
    fun `shranjena neaktivna linija ne preklopi na drugo linijo`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = true),
            Line("2", "Druga", isEsim = true, active = false)
        )
        val result = LineSelection.choose(lines, "2")
        // Pregled 15 (N1): prej Single("1") - Lina bi prevzela klice na liniji, ki je uporabnik ni dovolil.
        assertEquals(LineSelectionResult.SavedUnavailable, result)
    }

    @Test
    fun `ena sama aktivna linija se izbere samodejno`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = false),
            Line("2", "Druga", isEsim = true, active = true)
        )
        val result = LineSelection.choose(lines, null)
        assertEquals(LineSelectionResult.Single("2"), result)
    }

    @Test
    fun `ena sama aktivna linija s pravo shranjeno vrne Use`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = false),
            Line("2", "Druga", isEsim = true, active = true)
        )
        val result = LineSelection.choose(lines, "2")
        assertEquals(LineSelectionResult.Use("2"), result)
    }

    @Test
    fun `brez aktivnih linij vrne None`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = false),
            Line("2", "Druga", isEsim = true, active = false)
        )
        val result = LineSelection.choose(lines, "1")
        assertEquals(LineSelectionResult.None, result)
    }

    @Test
    fun `podvojeni id-ji so neveljavni`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = true),
            Line("1", "Druga", isEsim = true, active = true)
        )
        val result = LineSelection.choose(lines, null)
        assertEquals(LineSelectionResult.Invalid, result)
    }

    @Test
    fun `prazen id je neveljaven`() {
        val lines = listOf(
            Line("", "Prva", isEsim = false, active = true)
        )
        val result = LineSelection.choose(lines, null)
        assertEquals(LineSelectionResult.Invalid, result)
    }

    @Test
    fun `prazen label je neveljaven`() {
        val lines = listOf(
            Line("1", "", isEsim = false, active = true)
        )
        val result = LineSelection.choose(lines, null)
        assertEquals(LineSelectionResult.Invalid, result)
    }

    @Test
    fun `vrstni red vhoda ne vpliva na rezultat`() {
        val lines1 = listOf(
            Line("1", "Prva", isEsim = false, active = false),
            Line("2", "Druga", isEsim = true, active = true)
        )
        val lines2 = listOf(
            Line("2", "Druga", isEsim = true, active = true),
            Line("1", "Prva", isEsim = false, active = false)
        )
        val result1 = LineSelection.choose(lines1, "2")
        val result2 = LineSelection.choose(lines2, "2")
        assertEquals(result1, result2)
        assertEquals(LineSelectionResult.Use("2"), result1)
    }

    @Test
    fun `id linije je stabilen, razlicen za razlicne racune in ne vsebuje ICCID`() {
        val component = "com.android.phone/com.android.services.telephony.TelephonyConnectionService"
        val iccid = "8938601234567890123"
        val key = ByteArray(32) { it.toByte() }
        val id = LineIdCodec.encode(key, component, iccid)
        assertEquals(id, LineIdCodec.encode(key, component, iccid))
        assertEquals(64, id.length)
        assertEquals(false, id.contains(iccid))
        assertEquals(false, id == LineIdCodec.encode(key, component, "8938601234567890124"))
        assertEquals(false, id == LineIdCodec.encode(key, "druga.komponenta", iccid))
    }

    @Test
    fun `id brez kljuca namestitve se ne da izracunati (ni gol SHA-256)`() {
        val component = "com.android.phone/com.android.services.telephony.TelephonyConnectionService"
        val iccid = "8938601234567890123"
        val gol = java.security.MessageDigest.getInstance("SHA-256")
            .digest("$component\n$iccid".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        val a = LineIdCodec.encode(ByteArray(32) { 1 }, component, iccid)
        val b = LineIdCodec.encode(ByteArray(32) { 2 }, component, iccid)
        assertEquals(false, a == gol)
        assertEquals(false, a == b)
        kotlin.test.assertFailsWith<IllegalArgumentException> { LineIdCodec.encode(ByteArray(8), component, iccid) }
    }
}
