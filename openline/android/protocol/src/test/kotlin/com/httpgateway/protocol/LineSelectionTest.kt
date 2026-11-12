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
        assertEquals(LineSelectionResult.Ambiguous, result)
    }

    @Test
    fun `shranjena neaktivna linija se ignorira`() {
        val lines = listOf(
            Line("1", "Prva", isEsim = false, active = true),
            Line("2", "Druga", isEsim = true, active = false)
        )
        val result = LineSelection.choose(lines, "2")
        // Ker je samo ena aktivna in shranjena ni aktivna, vrne Single(1)
        assertEquals(LineSelectionResult.Single("1"), result)
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
}
