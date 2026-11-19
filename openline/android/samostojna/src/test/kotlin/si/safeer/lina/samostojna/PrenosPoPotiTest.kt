package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PrenosPoPotiTest {
    private var cas = 0L
    private fun prenos() = PrenosPoPoti(IzbiraPoti { cas })

    @Test fun domaGreLanBrezRelea() {
        var releKlican = false
        assertEquals("lan", prenos().izvedi({ "lan" }, { releKlican = true; "rele" }))
        assertEquals(false, releKlican)
    }

    @Test fun zunajDomaLanPadeInTakojRele() {
        assertEquals("rele", prenos().izvedi({ null }, { "rele" }))
    }

    @Test fun neuspehLanSeZapomniInNaslednjicReleNajprej() {
        val p = prenos(); val vrstni = mutableListOf<String>()
        p.izvedi({ vrstni += "lan"; null }, { vrstni += "rele"; "r" })
        vrstni.clear()
        p.izvedi({ vrstni += "lan"; "l" }, { vrstni += "rele"; "r" })
        assertEquals(listOf("rele"), vrstni)
    }

    @Test fun poPremoruSeLanSpetPoskusi() {
        val p = prenos()
        p.izvedi({ null }, { "r" })
        cas += 301
        assertEquals("lan", p.izvedi({ "lan" }, { "r" }))
    }

    @Test fun spremembaOmrezjaIzbrisePremor() {
        val p = prenos()
        p.izvedi({ null }, { "r" })
        p.spremembaOmrezja()
        assertEquals("lan", p.izvedi({ "lan" }, { "r" }))
    }

    @Test fun brezReleaSeLanVednoPoskusiInNiObtica() {
        val p = prenos()
        assertNull(p.izvedi({ null }, null))
        assertEquals("lan", p.izvedi({ "lan" }, null))
    }

    @Test fun obaPadetaVrneNull() {
        assertNull(prenos().izvedi({ null }, { null }))
    }

    @Test fun izjemaJeNeuspehPoti() {
        assertEquals("rele", prenos().izvedi({ error("x") }, { "rele" }))
    }
}
