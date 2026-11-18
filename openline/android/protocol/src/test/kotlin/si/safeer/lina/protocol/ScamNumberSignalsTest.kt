package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ScamNumberSignalsTest {
    @Test
    fun `slovenske stevilke s 8 stevkami niso nepravilne, druge so`() {
        assertFalse(ScamNumberSignals.malformed("+386 70 159 999"))
        assertFalse(ScamNumberSignals.malformed("+38640123456"))
        assertFalse(ScamNumberSignals.malformed("+38612345678"))
        assertTrue(ScamNumberSignals.malformed("+386 0 70 159 999"))
        assertTrue(ScamNumberSignals.malformed("+386701599"))
        assertTrue(ScamNumberSignals.malformed("+3867015999999"))
    }

    @Test
    fun `mednarodne izven E164, 000 in 1234 so nepravilne, domace in kratke ne`() {
        assertTrue(ScamNumberSignals.malformed("+1234567"))
        assertTrue(ScamNumberSignals.malformed("+1234567890123456"))
        assertTrue(ScamNumberSignals.malformed("0001234567"))
        assertTrue(ScamNumberSignals.malformed("123456789"))
        assertFalse(ScamNumberSignals.malformed("+4915112345678"))
        assertFalse(ScamNumberSignals.malformed("041555666"))
        assertFalse(ScamNumberSignals.malformed("112"))
        assertFalse(ScamNumberSignals.malformed(""))
    }

    @Test
    fun `tuja stevilka`() {
        assertTrue(ScamNumberSignals.foreign("+21612345678"))
        assertTrue(ScamNumberSignals.foreign("0049 151 123"))
        assertFalse(ScamNumberSignals.foreign("+38631000000"))
        assertFalse(ScamNumberSignals.foreign("041555666"))
    }
}
