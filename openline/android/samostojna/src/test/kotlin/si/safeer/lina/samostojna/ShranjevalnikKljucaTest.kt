package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ShranjevalnikKljucaTest {
    @Test
    fun preveriShranjevalnik() {
        val s: ShranjevalnikKljuca = PomnilniskiShranjevalnik()
        assertNull(s.preberi())
        s.shrani(KljucGemini("skrivnost"))
        assertEquals("skrivnost", s.preberi()?.izpostavi())
        s.izbrisi()
        assertNull(s.preberi())
    }
}
