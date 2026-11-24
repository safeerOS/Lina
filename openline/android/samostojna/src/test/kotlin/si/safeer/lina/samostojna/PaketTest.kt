package si.safeer.lina.samostojna

import org.junit.jupiter.api.Test
import java.time.OffsetDateTime
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Dostava paketa na telefonu: isti primeri kot racunalnik (src/lib/lina/naloga-urnik-dostava.test.ts, razdelki »paket«) in stavek iz
 * pojasnila lastnika 24. 11. 2026. Nacin »podjetje« na telefonu ne obstaja (samostojni klic je vedno osebna tajnica).
 */
class PaketTest {
    private val navodilo = "Pustite ga pri sosedu na št. 5."
    private val tor1000 = OffsetDateTime.parse("2026-11-24T10:00:00+01:00").toInstant()

    @Test
    fun `predstavitev kot dostava`() {
        val da = listOf(
            "Dober dan, tukaj DPD, imam paket za vas.",
            "Tukaj Marko iz GLS.",
            "Kličem iz Pošte Slovenije.",
            "Sem s pošte, imam pošiljko za vas.",
            "Jaz sem kurir, kje vas najdem?",
            "Tukaj dostavljalec, paket je za vas.",
            "DHL, dober dan.",
            "Express One tukaj.",
            "InPost",
            "Dostava!",
            "Halo, kurir tukaj.",
            "Imam paket za gospo Novak.",
            "Dostavljam paket.",
            "Sem dostavljavec.",
            "Dober dan, UPS dostava.",
            "Kurirka GLS tukaj.",
            "tukaj ups imam paket",
            "DPD dostava.",
            "Dober dan, kurir DPD.",
            "Tukaj dostava.",
            "DPD, paket imam za vas.",
            "Pošta, paket za gospo Novak.",
        )
        for (s in da) assertTrue(Paket.jeDostava(s), s)
    }

    @Test
    fun `izreki o paketu ali posti, ki niso predstavitev, niso dostava`() {
        val ne = listOf(
            "Poslal sem vam paket ponudb po pošti.",
            "Kličem glede paketa, ki sem ga naročil.",
            "Ups, napačna številka.",
            "Ups.",
            "Moja e-pošta je ana@primer.si.",
            "Sem ga dobil od DPD, pa je poškodovan.",
            "Račun sem poslal s pošto.",
            "Dostava paketa zamuja, prosim pokličite me.",
            "Ali je kurir že prišel?",
            "Kje naj pustim?",
            "Imam vprašanje glede paketa.",
            "Nisem dostavljalec, kličem zaradi računa.",
            "Ne kličem iz DPD, sem soseda.",
            "Rad bi govoril z Ano.",
            "DPD paket je izgubljen, kaj naj naredim?",
            "Ups, halo?",
            "Ups, dober dan.",
            "Ups, imam napačno številko.",
            "Jaz sem ga dobil od DPD.",
            "Tukaj Ana, paket od DPD še ni prišel.",
            "Pošta, dober dan, račun sem plačal.",
            "Sem ga dostavljal sosedu.",
            "Jaz sem ga dostavljal včeraj.",
            "Sem dostavljal paket sosedu, pa ga ni bilo doma.",
            "",
        )
        for (s in ne) assertFalse(Paket.jeDostava(s), s)
    }

    @Test
    fun `odlomek prepisa - izrek, ki se se nadaljuje, ni dostava samo zaradi prve besede`() {
        // Prepis Gemini Live pride po odlomkih: »Dostava« + » paketa zamuja« ali »DPD« + » paket je izgubljen«.
        for (odlomek in listOf("Dostava", "DPD", "InPost", "Kurir")) assertFalse(Paket.jeDostava(odlomek, celIzrek = false), odlomek)
        assertTrue(Paket.jeDostava("Dostava", celIzrek = true))
        assertTrue(Paket.jeDostava("Dober dan, tukaj DPD", celIzrek = false), "predstavitev velja ze med izrekom")
    }

    @Test
    fun `koda, geslo, PIN, stiri stevke in denar so zavrnjeni, »st 5« je v redu, dolzina omejena`() {
        assertNull(Paket.razlog(navodilo))
        assertEquals(Paket.Razlog.KODA, Paket.razlog("Koda vrat je 4821."))
        assertEquals(Paket.Razlog.KODA, Paket.razlog("Pustite v nabiralniku, geslo je sonce."))
        assertEquals(Paket.Razlog.KODA, Paket.razlog("PIN 1 2 3 4"))
        assertEquals(Paket.Razlog.KODA, Paket.razlog("Vrata odprete z 4821."), "samo stevke")
        assertEquals(Paket.Razlog.KODA, Paket.razlog("Odprite s 48-21."), "stevke z locili")
        assertEquals(Paket.Razlog.KODA, Paket.razlog("Pustite v nabiralniku, šifra je modra."), "samo beseda")
        assertNotNull(Paket.razlog("Plačilo 20 EUR ob prevzemu."))
        assertEquals(Paket.Razlog.DOLZINA, Paket.razlog("a".repeat(161)))
        assertEquals("pri sosedu na št. 5.", Paket.normiraj("  pri sosedu\n na št. 5 "))
        val polno = "a".repeat(160)
        assertEquals(160, Paket.normiraj(polno).length)
        assertNull(Paket.razlog(Paket.normiraj(polno)))
        // Najdba za 02b: hisna stevilka nad 9 brez besede za njo je na racunalniku denarni signal (golaStevila); telefon ostane enak.
        assertEquals(Paket.Razlog.DENAR, Paket.razlog("Pri sosedu na št. 12."))
        for (ok in listOf("Pustite ga pri sosedu Pintarju.", "Pri Šifrerjevih, hiša desno.", "Na Kodeljevem pri vratih.", "Doma sem do 16.30, prej pri sosedu.")) {
            assertNull(Paket.razlog(ok), ok)
        }
    }

    @Test
    fun `pregled 0_2_10 najdba 2 - kljuc, odklenjen, odprt, koda, geslo in stevke z besedami so zavrnjeni`() {
        for (ne in listOf(
            "Ključ je v nabiralniku.",
            "Ključa sta pod predpražnikom.",
            "Garaža je odklenjena.",
            "Vrata so odprta, pustite ga v veži.",
            "Vhodna koda je modra.",
            "Geslo je sonce.",
            "Vtipkajte štiri osem dva ena pri vratih.",
            "Pri vratih vtipkajte ena dva 3 4.",
        )) assertEquals(Paket.Razlog.KODA, Paket.razlog(ne), ne)
    }

    @Test
    fun `postna stevilka pred krajem je dovoljena, »vkljucno« in »zakljucek« nista kljuc, posamezne besede stevil so v redu`() {
        for (ok in listOf(
            "Pustite ga na Cesti 5, 1000 Ljubljana, pri sosedu.",
            "Pošta 2000 Maribor, okence 3.",
            "Velja vključno s petkom, pri sosedu.",
            "Po zaključku dela pri sosedu.",
            "Pustite ga pri sosedu na št. pet.",
            "Pri sosedu, dva paketa naenkrat.",
        )) assertNull(Paket.razlog(ok), ok)
    }

    @Test
    fun `velja vkljucno z dnem »velja do« po Ljubljani, izklop in neveljavno besedilo ali datum = nic`() {
        val n = Paket.Nastavitve(vklop = true, mesto = Paket.MESTO_DRUGO, navodilo = navodilo, doDne = "2026-11-24")
        val stavek = "Paket pričakujemo. Prosim, pustite ga pri sosedu na št. 5."
        assertEquals(stavek, Paket.odgovorZaKlic(n, OffsetDateTime.parse("2026-11-24T23:30:00+01:00").toInstant()))
        assertEquals("", Paket.odgovorZaKlic(n, OffsetDateTime.parse("2026-11-25T00:10:00+01:00").toInstant()))
        // Ura telefona v UTC: 23.30 UTC 24. 11. je ze 25. 11. v Ljubljani.
        assertEquals("", Paket.odgovorZaKlic(n, OffsetDateTime.parse("2026-11-24T23:30:00Z").toInstant()))
        assertEquals("", Paket.odgovorZaKlic(n.copy(vklop = false), tor1000))
        assertEquals("", Paket.odgovorZaKlic(n.copy(navodilo = ""), tor1000))
        assertEquals("", Paket.odgovorZaKlic(n.copy(navodilo = "Koda je 4821."), tor1000), "rocno popravljene nastavitve")
        assertEquals("", Paket.odgovorZaKlic(n.copy(navodilo = "Ključ je pod predpražnikom."), tor1000), "prej shranjeno, zdaj zavrnjeno")
        assertEquals("", Paket.odgovorZaKlic(n.copy(doDne = "2026-02-30"), tor1000), "30. 2. ni datum")
        assertEquals("", Paket.odgovorZaKlic(n.copy(doDne = "jutri"), tor1000))
        assertEquals(stavek, Paket.odgovorZaKlic(n.copy(doDne = ""), tor1000), "prazno = dokler ne izklopi")
        assertTrue(Paket.doNeveljaven("2026-02-30"))
        assertFalse(Paket.doNeveljaven(""))
    }

    @Test
    fun `stavek - pred hiso (prednastavljeno) ali izbrano mesto, brez imena lastnika in brez dvojne pike`() {
        val pred = Paket.Nastavitve(vklop = true)
        assertEquals("Paket pričakujemo. Prosim, pustite ga pred hišo.", Paket.odgovorZaKlic(pred, tor1000))
        assertEquals("Paket pričakujemo. Prosim, pustite ga pred hišo.", Paket.odgovorZaKlic(pred.copy(navodilo = "Koda je 4821."), tor1000), "besedilo drugega mesta ne velja")
        val drugo = pred.copy(mesto = Paket.MESTO_DRUGO)
        assertEquals("Paket pričakujemo. Prosim, pustite ga pri sosedu Pintarju.", Paket.odgovorZaKlic(drugo.copy(navodilo = "Pri sosedu Pintarju"), tor1000))
        assertEquals("Paket pričakujemo. Prosim, pustite ga v garaži.", Paket.odgovorZaKlic(drugo.copy(navodilo = "pustite ga v garaži!"), tor1000))
        assertEquals("Paket pričakujemo. Prosim, pustite ga DPD paketniku.", Paket.odgovorZaKlic(drugo.copy(navodilo = "DPD paketniku"), tor1000), "kratica ostane")
        assertEquals("", Paket.odgovorZaKlic(drugo.copy(navodilo = "   "), tor1000))
        for (s in listOf(Paket.odgovor("pred hišo"), Paket.odgovorZaKlic(drugo.copy(navodilo = navodilo), tor1000))) {
            assertFalse(s.contains(".."), s)
            assertTrue(s.startsWith("Paket pričakujemo. Prosim, pustite ga "), s)
        }
    }
}
