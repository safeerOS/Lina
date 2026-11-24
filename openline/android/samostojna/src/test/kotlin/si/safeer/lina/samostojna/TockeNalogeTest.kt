package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Tocke naloge (lastnik 24. 11. 2026: Lina je poslala 5 tock, narejena 1, nihce ni opazil): pripravi ostevilci tocke nacrta. */
class TockeNalogeTest {
    private val nacrt = "Tehnični načrt LearnHarness:\n- Kloniraj repozitorij.\n  - podtočka ostane\n* Poženi preizkuse.\n3) Napiši poročilo."
    private val pogovor = listOf(Sporocilo("model", nacrt), Sporocilo("user", "Daj to Claude Code."))

    @Test
    fun `ostevilci samo tocke najvisje ravni, podtocke in naslov ostanejo`() {
        val (b, n) = SamostojnaNaloga.ostevilci(nacrt)
        assertEquals(3, n)
        assertEquals("Tehnični načrt LearnHarness:\n1. Kloniraj repozitorij.\n  - podtočka ostane\n2. Poženi preizkuse.\n3. Napiši poročilo.", b)
    }

    @Test
    fun `nacrt brez vsaj dveh tock ostane nespremenjen`() {
        val proza = "Načrt: najprej preberi kodo, potem popravi napako.\n- ena sama alineja"
        assertEquals(proza to 0, SamostojnaNaloga.ostevilci(proza))
    }

    @Test
    fun `pripravi priloze ostevilcen nacrt in zahtevo dokaza za vsako tocko`() {
        val b = (SamostojnaNaloga.pripravi("Naredi po načrtu.", pogovor, emptyList()) as SamostojnaNaloga.Izid.Pripravljena).besedilo
        assertTrue(b.contains("1. Kloniraj repozitorij.\n  - podtočka ostane\n2. Poženi preizkuse.\n3. Napiši poročilo."), b)
        assertTrue(b.contains(SamostojnaNaloga.TOCKE_NAVODILO), b)
        assertTrue(b.length <= SamostojnaNaloga.NAJVEC_ZNAKOV)
    }

    @Test
    fun `izklopljeno stikalo - nacrt ostane kot je, brez zahteve dokaza`() {
        val b = (SamostojnaNaloga.pripravi("Naredi po načrtu.", pogovor, emptyList(), tocke = false) as SamostojnaNaloga.Izid.Pripravljena).besedilo
        assertTrue(b.contains("- Kloniraj repozitorij."), b)
        assertFalse(b.contains("1. Kloniraj"), b)
        assertFalse(b.contains(SamostojnaNaloga.TOCKE_NAVODILO), b)
    }

    @Test
    fun `naloga brez nacrta nima zahteve tock`() {
        val b = (SamostojnaNaloga.pripravi("Popravi zvok klica.", emptyList(), emptyList()) as SamostojnaNaloga.Izid.Pripravljena).besedilo
        assertFalse(b.contains(SamostojnaNaloga.TOCKE_NAVODILO), b)
    }

    @Test
    fun `Asistent - stikalo tock pride do priprave naloge`() {
        val odj = object : PonudnikOdjemalec {
            override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat =
                Rezultat.Besedilo("Predam.\n[[racunalnik: Naredi po načrtu.]]")
        }
        fun naloga(vklop: Boolean): String {
            val a = Asistent(odj, "", racunalnikPovezan = { true }, zapiski = { listOf(nacrt) }, tockeNaloge = { vklop })
            return (a.povej("Pošlji računalniku nalogo po načrtu.") as Odgovor.NalogaRacunalniku).besedilo
        }
        assertTrue(naloga(true).contains(SamostojnaNaloga.TOCKE_NAVODILO))
        assertFalse(naloga(false).contains(SamostojnaNaloga.TOCKE_NAVODILO))
    }
}
