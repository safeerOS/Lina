package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Naloga 11 (25. 11. 2026, posnetek lastnika 06:49 na 5G): Lina je rekla »Da, povezana sem« in »Pošiljam nalogo računalniku«,
 * računalnik pa ni bil dosegljiv; o svoji različici je ugibala. Lina o povezavi, pošiljanju in sebi poroča samo iz dejstev programa.
 */
class ZvestobaVirom11Test {
    private class Model(private vararg val odgovori: String) : PonudnikOdjemalec {
        val klici = mutableListOf<Pair<List<Sporocilo>, String>>()
        override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
            klici += zgodovina.toList() to sistemsko
            return Rezultat.Besedilo(odgovori.getOrElse(klici.size - 1) { odgovori.last() })
        }
    }

    private val trdiPosiljanje = Regex("po[sš]iljam|poslala|predala|predajam", RegexOption.IGNORE_CASE)

    private fun besedilo(o: Odgovor) = (o as? Odgovor.Besedilo)?.besedilo ?: ""

    @Test fun `nesparjen telefon - model trdi povezavo in posiljanje - odgovor nikoli ne trdi posiljanja`() {
        val m = Model("Da, povezana sem. Pošiljam nalogo računalniku: popravi stran.")
        val o = Asistent(m, "S", racunalnikPovezan = { false }).povej("Ali si povezana preko global linka? Pošlji nalogo računalniku.")
        assertTrue(o is Odgovor.Besedilo)
        assertFalse(trdiPosiljanje.containsMatchIn(besedilo(o)), besedilo(o))
        assertTrue(besedilo(o).contains("nisem mogla poslati"), besedilo(o))
    }

    @Test fun `seznanjen a nedosegljiv - navodilo pove nedosegljivost in ne trdi dostopa`() {
        val n = SistemskoNavodilo.racunalnik(StanjeRacunalnika.NEDOSEGLJIV)
        assertTrue(n.contains("NI dosegljiv"), n)
        assertFalse(n.contains("Nikoli ne trdi, da nimas dostopa"), n)
        assertTrue(SistemskoNavodilo.racunalnik(StanjeRacunalnika.DOSEGLJIV).contains("[[racunalnik:"))
    }

    @Test fun `seznanjen a nedosegljiv - vprasanje o povezavi dobi navodilo nedosegljivosti`() {
        val m = Model("Računalnik zdaj ni dosegljiv.")
        Asistent(m, "S", racunalnikPovezan = { false }, racunalnikSeznanjen = { true }).povej("Ali si povezana z računalnikom?")
        assertTrue(m.klici.single().second.contains("NI dosegljiv"), m.klici.single().second)
    }

    @Test fun `seznanjen a nedosegljiv - naloga gre programu, model trditve o posiljanju v zgodovini ni`() {
        val m = Model("Pošiljam nalogo računalniku.\n[[racunalnik: V mapi /home/uporabnik/projekt popravi napako v prijavi; merilo: preizkusi uspejo.]]", "V redu.")
        val a = Asistent(m, "S", racunalnikPovezan = { false }, racunalnikSeznanjen = { true })
        val o = a.povej("Pošlji računalniku nalogo: v mapi /home/uporabnik/projekt popravi napako v prijavi.")
        assertTrue(o is Odgovor.NalogaRacunalniku, o.toString())
        a.povej("Hvala")
        val zgodovina = m.klici.last().first.filter { it.vloga == "model" }.joinToString("\n") { it.besedilo }
        assertFalse(trdiPosiljanje.containsMatchIn(zgodovina), zgodovina)
    }

    @Test fun `vprasanje o razlicici - odgovor iz namescene aplikacije, brez modela`() {
        val m = Model("Sem različica iz 23. novembra.")
        val o = Asistent(m, "S", razlicica = "0.2.13").povej("Katera različica si?")
        assertTrue(besedilo(o).contains("0.2.13"), besedilo(o))
        assertFalse(besedilo(o).contains("23. novembra"))
        assertTrue(m.klici.isEmpty())
    }

    @Test fun `vprasanje o razlicici brez podatka - ne ugiba`() {
        val m = Model("Sem različica 0.1.0.")
        val o = Asistent(m, "S").povej("Katero verzijo imaš nameščeno?")
        assertTrue(besedilo(o).contains("ne vem"), besedilo(o))
        assertTrue(m.klici.isEmpty())
    }

    @Test fun `navodilo modelu vsebuje razlicico in seznam funkcij`() {
        val m = Model("Znam pogovor.")
        Asistent(m, "S", razlicica = "0.2.13").povej("Kaj vse znaš?")
        val s = m.klici.single().second
        assertTrue(s.contains("0.2.13"), s)
        OSebi.FUNKCIJE.forEach { assertTrue(s.contains(it), it) }
    }

    @Test fun `naloga z izmisljeno mapo - Lina vprasa za pravo pot`() {
        val pogovor = listOf(Sporocilo("user", "Naredi nalogo za Lino na računalniku."))
        val izid = SamostojnaNaloga.pripravi("V mapi 'Lina-Project' popravi prijavo.", pogovor, emptyList())
        assertTrue(izid is SamostojnaNaloga.Izid.Manjka, izid.toString())
        assertTrue((izid as SamostojnaNaloga.Izid.Manjka).vprasanje.contains("Lina-Project"))
        val izid2 = SamostojnaNaloga.pripravi("V mapi /home/uporabnik/x/Lina popravi prijavo.", pogovor, emptyList())
        assertTrue(izid2 is SamostojnaNaloga.Izid.Manjka, izid2.toString())
    }

    @Test fun `naloga s potjo, ki jo je povedal lastnik ali je v zapiskih - pripravljena`() {
        val pogovor = listOf(Sporocilo("user", "Projekt je v /media/uporabnik/Podatki/lina-obnova/projekt-3."))
        assertTrue(SamostojnaNaloga.pripravi("V mapi /media/uporabnik/Podatki/lina-obnova/projekt-3 popravi prijavo.", pogovor, emptyList()) is SamostojnaNaloga.Izid.Pripravljena)
        assertTrue(SamostojnaNaloga.pripravi("V mapi »safeer-stran« popravi glavo.", emptyList(), listOf("Mapa safeer-stran je moja stran.")) is SamostojnaNaloga.Izid.Pripravljena)
    }

    @Test fun `resnicni stavki ostanejo nespremenjeni - povezava ob dosegljivem, zanikanje, posiljanje po sprejeti nalogi`() {
        val dosegljiv = Model("Da, povezana sem z računalnikom.")
        assertEquals("Da, povezana sem z računalnikom.", besedilo(Asistent(dosegljiv, "S", racunalnikPovezan = { true }, racunalnikSeznanjen = { true }).povej("Si povezana z računalnikom?")))
        val nedosegljiv = Model("Nisem povezana z računalnikom, ker ni dosegljiv.")
        assertEquals("Nisem povezana z računalnikom, ker ni dosegljiv.", besedilo(Asistent(nedosegljiv, "S", racunalnikSeznanjen = { true }).povej("Si povezana z računalnikom?")))
        val a = Asistent(Model("Nalogo sem poslala računalniku, potek je v zavihku Računalnik."), "S", racunalnikPovezan = { true }, racunalnikSeznanjen = { true })
        a.nalogaPredana("popravi prijavo")
        assertEquals("Nalogo sem poslala računalniku, potek je v zavihku Računalnik.", besedilo(a.povej("Kaj je z mojo zadevo?")))
    }

    @Test fun `sprejeta naloga prezivi ponovni zagon - resnicna trditev ni zanikana`() {
        val cona = java.time.ZoneId.of("Europe/Ljubljana")
        val zdaj = { java.time.ZonedDateTime.of(2026, 11, 25, 7, 0, 0, 0, cona) }
        val disk = PomnilniskaShramba()
        val a1 = Asistent(Model("V redu."), "S", seja = ZgodovinaSeje(disk), zdaj = zdaj, racunalnikSeznanjen = { true })
        a1.povej("Živjo")
        a1.nalogaPredana("popravi prijavo")
        val a2 = Asistent(Model("Nalogo sem poslala računalniku."), "S", seja = ZgodovinaSeje(disk), zdaj = zdaj, racunalnikSeznanjen = { true })
        assertEquals("Nalogo sem poslala računalniku.", besedilo(a2.povej("Kaj je z zadevo?")))
        val a3 = Asistent(Model("Nalogo sem poslala računalniku."), "S", seja = ZgodovinaSeje(PomnilniskaShramba()), zdaj = zdaj, racunalnikSeznanjen = { true })
        assertTrue(besedilo(a3.povej("Kaj je z zadevo?")).contains("nisem mogla poslati"))
    }

    @Test fun `vprasanje o razlicici necesa drugega ni vprasanje o Lini`() {
        for (v in listOf("Katero verzijo ponudbe naj pošljem stranki?", "Katera različica dokumenta je zadnja?", "Katero različico si želiš za stran?", "Katera različica Pythona je na računalniku?",
                "Zapiši si, da je nova verzija pogodbe podpisana", "Opomni me jutri, da si ogledam novo različico ponudbe", "Ali si poslala novo verzijo ponudbe?"))
            assertFalse(OSebi.jeVprasanjeORazlicici(v), v)
        for (v in listOf("Katera različica si?", "Katero verzijo imaš nameščeno?", "Kakšna je tvoja različica?", "Which version are you?"))
            assertTrue(OSebi.jeVprasanjeORazlicici(v), v)
    }

    @Test fun `varovalo ohrani vrstice z ukazi - zapisek z besedo predala in opomnik za trditvijo`() {
        val z = Asistent(Model("Zapisala sem.\n[[zapisek: Ana je predala nalogo računalniku]]"), "S").povej("Zapiši: Ana je predala nalogo računalniku.")
        assertTrue(z is Odgovor.Zapisek, z.toString())
        assertEquals("Ana je predala nalogo računalniku", (z as Odgovor.Zapisek).besedilo)
        val o = Asistent(Model("Pošiljam nalogo računalniku.\n[[opomnik: 2026-12-01T09:00:00+01:00|preveri nalogo]]"), "S").povej("Opomni me 1. 12. ob 9h, da preverim nalogo.")
        assertTrue(o is Odgovor.Opomnik, o.toString())
    }

    @Test fun `izid predaje gre v zgodovino - model v naslednjem obratu ve, da naloga ni bila sprejeta`() {
        val m = Model("[[racunalnik: V mapi /home/uporabnik/projekt popravi prijavo.]]", "V redu.")
        val a = Asistent(m, "S", racunalnikSeznanjen = { true })
        assertTrue(a.povej("Pošlji računalniku: v mapi /home/uporabnik/projekt popravi prijavo.") is Odgovor.NalogaRacunalniku)
        a.nalogaNiPredana("popravi prijavo", "Naloge nisem mogla poslati, ker računalnik ni dosegljiv.")
        a.povej("Kaj je z nalogo?")
        val model = m.klici.last().first.filter { it.vloga == "model" }.joinToString("\n") { it.besedilo }
        assertTrue(model.contains("ni sprejel") && model.contains("ni dosegljiv"), model)
        assertFalse(model.contains("izid sporoči program"), model)
    }

    @Test fun `izid predaje - vsak primer OdgovorLine ima svoje besedilo`() {
        assertEquals(IzidPredaje.SPREJETA, PredajaNaloge.izid(ok = true, nedosegljiva = false, status = null))
        assertEquals(IzidPredaje.NEDOSEGLJIV, PredajaNaloge.izid(ok = false, nedosegljiva = true, status = null))
        assertEquals(IzidPredaje.CLAUDE_CODE_NI, PredajaNaloge.izid(false, false, 503))
        assertEquals(IzidPredaje.ZAVRNJENA, PredajaNaloge.izid(false, false, 403))
        assertEquals(IzidPredaje.PREVEC, PredajaNaloge.izid(false, false, 429))
        assertEquals(IzidPredaje.NAPAKA, PredajaNaloge.izid(false, false, 500))
        assertEquals("a1b2c3d4", PredajaNaloge.stevilka("a1b2c3d4e5f6"))
    }

    @Test fun `besedila izida v vseh jezikih - neuspeh nikoli ne trdi posiljanja, nedosegljiv ponudi shranjevanje`() {
        val res = File("../app/src/main/res")
        val mape = res.listFiles { f -> f.name == "values" || f.name.startsWith("values-") }!!.filter { File(it, "strings.xml").exists() }
        assertEquals(6, mape.size, mape.toString())
        val sl = File(res, "values-sl/strings.xml").readText()
        for (izid in IzidPredaje.values()) {
            for (m in mape) assertTrue(File(m, "strings.xml").readText().contains("name=\"${PredajaNaloge.kljuc(izid)}\""), "${m.name} ${izid}")
            val besedilo = Regex("name=\"${PredajaNaloge.kljuc(izid)}\">([^<]*)<").find(sl)!!.groupValues[1]
            if (izid == IzidPredaje.SPREJETA) assertTrue(besedilo.contains("%1\$s") && besedilo.contains("%2\$s"), besedilo)
            else assertFalse(trdiPosiljanje.containsMatchIn(besedilo), "$izid: $besedilo")
        }
        assertTrue(Regex("name=\"${PredajaNaloge.kljuc(IzidPredaje.NEDOSEGLJIV)}\">([^<]*)<").find(sl)!!.groupValues[1].contains("ni dosegljiv"))
        // stari »Pošiljam nalogo računalniku« (pred potrditvijo) ne obstaja vec
        assertFalse(sl.contains("Pošiljam nalogo računalniku"))
    }
}
