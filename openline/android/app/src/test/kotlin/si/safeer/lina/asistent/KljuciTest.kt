package si.safeer.lina.asistent

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import org.mockito.Mockito.mock
import android.content.Context
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.telecom.SamostojnaPripravljenost
import si.safeer.lina.telecom.LokalniPrehodUpravljalnik
import si.safeer.lina.samostojna.ShranjevalnikKljuca

class KljuciTest {
    class LaznaShramba : ShranjevalnikKljuca {
        var kljuc: KljucGemini? = null
        override fun preberi(): KljucGemini? = kljuc
        override fun shrani(k: KljucGemini) { kljuc = k }
        override fun izbrisi() { kljuc = null }
    }

    @Test
    fun testEnaNastavitevKljucaHkratiPripraviObePoti() {
        val lazna = LaznaShramba()
        SkupniKljuci.aktivniPonudnikTest = Ponudnik.GEMINI
        SkupniKljuci.shrambaZaPonudnikaTest = { lazna }

        val context = mock(Context::class.java)

        // Na zacetku ni kljuca
        assertFalse(SamostojnaPripravljenost.imaNastavljenKljuc(context), "Tajnici manjka kljuc")
        var asistentKljuc = SkupniKljuci.preberiKljucAktivnegaPonudnika(context)
        assertEquals(null, asistentKljuc, "Asistentki manjka kljuc")

        // Uporabnik vnese kljuc na enem mestu (v Nastavitvah)
        val testniKljuc = KljucGemini("skrivnost1234567890123")
        SkupniKljuci.shrambaZaPonudnika(context, Ponudnik.GEMINI).shrani(testniKljuc)

        // Obe poti (asistentka in tajnica) sta hkrati pripravljeni
        assertTrue(SamostojnaPripravljenost.imaNastavljenKljuc(context), "Tajnica ima kljuc")
        asistentKljuc = SkupniKljuci.preberiKljucAktivnegaPonudnika(context)
        assertEquals("skrivnost1234567890123", asistentKljuc?.izpostavi(), "Asistentka ima isti kljuc")

        // Pocisti
        SkupniKljuci.aktivniPonudnikTest = null
        SkupniKljuci.shrambaZaPonudnikaTest = null
    }
}
