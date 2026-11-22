package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals

/** Isti primeri kot obvestila-odlocitev.test.ts na racunalniku (telefon mora odlocati enako). Podatki izmisljeni. */
class ObvestilaOdlocitevTest {
    private val P = NastavitveObvestil()
    private val doma = Prisotnost(racunalnikAktiven = false, telefonPovezan = true, uraLokalno = 14)
    private val zaRacunalnikom = doma.copy(racunalnikAktiven = true)
    private val klic = DogodekObvestila(VrstaDogodka.KLIC, od = "+386 41 222 333", besedilo = "Klicatelj prosi za ponudbo.")

    @Test fun `privzeto telefon z zakasnitvijo, racunalnik takoj`() {
        assertEquals(OdlocitevObvestila(true, RazlogObvestila.VSE, NapravaObvestila.TELEFON, 60_000), odlociObvestilo(klic, P, doma))
        assertEquals(OdlocitevObvestila(true, RazlogObvestila.VSE, NapravaObvestila.RACUNALNIK, 0), odlociObvestilo(klic, P, zaRacunalnikom))
    }

    @Test fun `nujno takoj, prebije ne moti in izklop vrste`() {
        val n = P.copy(neMoti = true, poVrsti = mapOf(VrstaDogodka.KLIC to RavenObvestil.NIC))
        assertEquals(OdlocitevObvestila(true, RazlogObvestila.NUJNO, NapravaObvestila.TELEFON, 0), odlociObvestilo(klic.copy(nujno = true), n, doma))
        assertEquals(OdlocitevObvestila(false, RazlogObvestila.IZKLOPLJENO), odlociObvestilo(klic.copy(nujno = true), n.copy(nujnoPrebijeNeMoti = false), doma))
    }

    @Test fun `ne moti in ure miru cez polnoc, VIP prebije`() {
        assertEquals(OdlocitevObvestila(false, RazlogObvestila.NE_MOTI), odlociObvestilo(klic, P.copy(neMoti = true), doma))
        val noc = P.copy(ureMiru = UreMiru(22, 7))
        assertEquals(false, odlociObvestilo(klic, noc, doma.copy(uraLokalno = 23)).poslji)
        assertEquals(false, odlociObvestilo(klic, noc, doma.copy(uraLokalno = 3)).poslji)
        assertEquals(true, odlociObvestilo(klic, noc, doma.copy(uraLokalno = 9)).poslji)
        assertEquals(RazlogObvestila.VIP, odlociObvestilo(klic, noc.copy(vip = listOf("041222333")), doma.copy(uraLokalno = 23)).razlog)
    }

    @Test fun `pomembno - novica samo s kljucno besedo, brez stresic`() {
        val novica = DogodekObvestila(VrstaDogodka.NOVICA, besedilo = "Nova različica WebKitGTK popravlja ranljivost.")
        assertEquals(OdlocitevObvestila(false, RazlogObvestila.NEPOMEMBNO), odlociObvestilo(novica, P, doma))
        assertEquals(RazlogObvestila.KLJUCNA_BESEDA, odlociObvestilo(novica, P.copy(kljucneBesede = listOf("ranljivost")), doma).razlog)
    }

    @Test fun `ze prebrano in brez naprave`() {
        assertEquals(OdlocitevObvestila(false, RazlogObvestila.ZE_PREBRANO), odlociObvestilo(klic.copy(prebranoNa = NapravaObvestila.RACUNALNIK), P, doma))
        assertEquals(OdlocitevObvestila(false, RazlogObvestila.NI_NAPRAVE), odlociObvestilo(klic, P, doma.copy(telefonPovezan = false)))
    }

    @Test fun `globalni izklop, vrsta vse prevlada, nujno ostane`() {
        assertEquals(false, odlociObvestilo(klic, P.copy(globalno = RavenObvestil.NIC), doma).poslji)
        assertEquals(true, odlociObvestilo(klic, P.copy(globalno = RavenObvestil.NIC, poVrsti = mapOf(VrstaDogodka.KLIC to RavenObvestil.VSE)), doma).poslji)
        assertEquals(true, odlociObvestilo(klic.copy(nujno = true), P.copy(globalno = RavenObvestil.NIC), doma).poslji)
    }

    @Test fun `stevilke kot na racunalniku`() {
        assertEquals("+38641222333", vE164("041 222 333")); assertEquals("+38641222333", vE164("00386 41 222 333"))
        assertEquals(null, vE164("Ana")); assertEquals(true, istaStevilka("+386 41 222 333", "041-222-333"))
        assertEquals(false, istaStevilka("041 222 333", "041 222 334"))
    }
}
