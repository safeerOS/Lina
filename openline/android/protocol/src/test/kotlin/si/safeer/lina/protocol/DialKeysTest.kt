package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DialKeysTest {
    @Test
    fun `tipkovnica ima 12 tipk v obicajnem vrstnem redu`() {
        assertEquals("123456789*0#", DialKeys.ALL.joinToString("") { it.digit })
    }

    @Test
    fun `crke pod tipkami so kot na telefonu, nic ni dvakrat`() {
        val crke = DialKeys.ALL.filter { it.digit in "23456789" }.joinToString("") { it.letters }
        assertEquals("ABCDEFGHIJKLMNOPQRSTUVWXYZ", crke)
        assertEquals("+", DialKeys.ALL.first { it.digit == "0" }.letters)
    }

    @Test
    fun `ime od stevilke loci po crki`() {
        assertTrue(DialKeys.isNameQuery("Ana"))
        assertTrue(DialKeys.isNameQuery("Žiga 2"))
        assertFalse(DialKeys.isNameQuery("+386 40 111"))
        assertFalse(DialKeys.isNameQuery(""))
    }
}
