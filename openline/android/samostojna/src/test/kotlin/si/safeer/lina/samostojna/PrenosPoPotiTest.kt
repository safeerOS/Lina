package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PrenosPoPotiTest {
    private var cas = 0L
    private fun prenos() = PrenosPoPoti(IzbiraPoti { cas })
    private fun <T : Any> pot(log: MutableList<String>, ime: String, r: T?): () -> T? = { log += ime; r }

    @Test fun domaGreLanBrezDrugih() {
        val v = mutableListOf<String>()
        assertEquals("l", prenos().izvedi(pot(v, "lan", "l"), pot(v, "nep", "n"), pot(v, "rele", "r")))
        assertEquals(listOf("lan"), v)
    }

    @Test fun zunajDomaNeposrednaPotPredReleom() {
        val v = mutableListOf<String>()
        assertEquals("n", prenos().izvedi(pot(v, "lan", null), pot(v, "nep", "n"), pot(v, "rele", "r")))
        assertEquals(listOf("lan", "nep"), v)
    }

    @Test fun neposrednaNiDosegljivaTakojRele() {
        val v = mutableListOf<String>()
        assertEquals("r", prenos().izvedi(pot(v, "lan", null), pot(v, "nep", null), pot(v, "rele", "r")))
        assertEquals(listOf("lan", "nep", "rele"), v)
    }

    @Test fun neuspehuSeNaslednjicIzognemoInReleNaPrviMesto() {
        val p = prenos(); val v = mutableListOf<String>()
        p.izvedi(pot(v, "lan", null), pot(v, "nep", null), pot(v, "rele", "r")); v.clear()
        assertEquals("r", p.izvedi(pot(v, "lan", "l"), pot(v, "nep", "n"), pot(v, "rele", "r")))
        assertEquals(listOf("rele"), v)
    }

    @Test fun poPremoruSeHitrejsaPotSpetPoskusi() {
        val p = prenos(); val v = mutableListOf<String>()
        p.izvedi(pot(v, "lan", null), pot(v, "nep", null), pot(v, "rele", "r")); v.clear()
        cas += 301
        assertEquals("n", p.izvedi(pot(v, "lan", null), pot(v, "nep", "n"), pot(v, "rele", "r")))
    }

    @Test fun spremembaOmrezjaIzbrisePremor() {
        val p = prenos(); val v = mutableListOf<String>()
        p.izvedi(pot(v, "lan", null), pot(v, "nep", null), pot(v, "rele", "r")); v.clear()
        p.spremembaOmrezja()
        assertEquals("l", p.izvedi(pot(v, "lan", "l"), pot(v, "nep", "n"), pot(v, "rele", "r")))
    }

    @Test fun brezNeposredneInRelea() {
        val p = prenos()
        assertNull(p.izvedi<String>({ null }, null, null))
        assertEquals("l", p.izvedi({ "l" }, null, null))
    }

    @Test fun vsePotiVPremoruSeVednoPoskusijo() {
        val p = prenos()
        p.izvedi<String>({ null }, { null }, { null })
        assertEquals("r", p.izvedi({ null }, { null }, { "r" }))
    }

    @Test fun izjemaJeNeuspehPoti() {
        assertEquals("r", prenos().izvedi({ error("x") }, null, { "r" }))
    }
}
