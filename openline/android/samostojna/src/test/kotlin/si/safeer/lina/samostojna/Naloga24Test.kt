package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/** Naloga 24 (najdbe CodeRabbit CR7, CR8, CR10 na 0.2.14): vsak preizkus brez popravka pade. */
class Naloga24Test {
    private val DAN = 86_400_000L
    private val zacetek = 1_800_000_000_000L

    private fun podjetniski(id: String, cas: Long) = ZapisKlica(id = id, casZacetka = cas, stevilka = "+99955501001", trajanjeS = 30,
        povzetek = "Narocilo", nacin = NacinKlica.PODJETJE, sporocilo = "Poklicite nazaj")

    private fun oseben(id: String, cas: Long) = ZapisKlica(id = id, casZacetka = cas, stevilka = "+99955501002", trajanjeS = 20, povzetek = "Oseben")

    /** Shramba, ki po vklopu [zavrni] pisanje zavrne (poln disk), branje pa dela. */
    private class ZavrnjenaShramba : Shramba {
        var vsebina: String? = null
        var zavrni = false
        override fun preberi() = vsebina
        override fun shrani(vsebina: String) { if (zavrni) throw java.io.IOException("poln disk"); this.vsebina = vsebina }
    }

    private fun poslanoTelo(d: DnevnikKlicev): String {
        var telo = ""
        // potrditev po odgovoru lahko vrze (zavrnjena shramba); preverja se samo, kaj je odslo
        runCatching { SinhronLine.izmenjaj(d, PomnilniskaShramba(), poslji = { t -> if (telo.isEmpty()) telo = t; """{"rev":0}""" }) }
        return telo
    }

    // CR7: klic poteče, medtem ko je dnevnik naložen (brez nove spremembe) - izmenjava ga ne sme poslati.
    @Test
    fun `CR7 - podjetniski klic, ki potece med delovanjem, ne gre v izmenjavo`() {
        var zdaj = zacetek
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d.dodaj(podjetniski("klic-podjetje-1", zacetek - 89 * DAN)))
        assertTrue(d.dodaj(oseben("klic-oseben-1", zacetek - 200 * DAN)))
        assertTrue(d.dodaj(podjetniski("klic-podjetje-2", zacetek - 10 * DAN)))
        zdaj += 2 * DAN // klic-podjetje-1 je zdaj star 91 dni (rok 90)
        val telo = poslanoTelo(d)
        assertFalse(telo.contains("klic-podjetje-1"), "potekel podjetniski klic je odsel na racunalnik: $telo")
        assertTrue(telo.contains("klic-oseben-1"), "osebni klic ostane v vrsti")
        assertTrue(telo.contains("klic-podjetje-2"), "nepotekel podjetniski klic ostane v vrsti")
        assertFalse(shramba.preberi()!!.contains("klic-podjetje-1"), "potekel klic je ostal v shrambi")
    }

    // slepi pregled 24 N12: izhodni posnetek sam (brez izmenjave, ki bi ocistila ob sprejemu) izbrise potekel klic iz shrambe
    @Test
    fun `CR7 - izhodni posnetek uveljavi rok in ga zapise v shrambo`() {
        var zdaj = zacetek
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d.dodaj(podjetniski("klic-podjetje-1", zacetek - 89 * DAN)))
        zdaj += 2 * DAN
        assertTrue(d.cakajociZaSinhronizacijo().none { it.id == "klic-podjetje-1" }, "potekel klic je v izhodnem posnetku")
        assertFalse(shramba.preberi()!!.contains("klic-podjetje-1"), "potekel klic je ostal v shrambi po izhodnem posnetku")
        assertTrue(d.seznam().none { it.id == "klic-podjetje-1" }, "potekel klic je ostal v dnevniku")
    }

    // druzina CR7: bralca dnevnika (zaslon, navodila Line) ne vrneta klica, ki je potekel med delovanjem
    @Test
    fun `CR7 - seznam in iskanje ne vrneta klica, ki je potekel med delovanjem`() {
        var zdaj = zacetek
        val shramba = ZavrnjenaShramba()
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d.dodaj(podjetniski("klic-podjetje-1", zacetek - 89 * DAN)))
        assertTrue(d.dodaj(oseben("klic-oseben-1", zacetek)))
        zdaj += 2 * DAN
        shramba.zavrni = true // tudi ko zapis ciscenja ne uspe
        assertTrue(d.seznam().none { it.id == "klic-podjetje-1" }, "seznam je vrnil potekel klic")
        assertTrue(d.poisci("Narocilo").isEmpty(), "iskanje je vrnilo potekel klic")
        assertEquals(listOf("klic-oseben-1"), d.seznam().map { it.id })
    }

    @Test
    fun `CR7 - ce zapis ciscenja ne uspe, potekel klic vseeno ne odide`() {
        var zdaj = zacetek
        val shramba = ZavrnjenaShramba()
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d.dodaj(podjetniski("klic-podjetje-1", zacetek - 89 * DAN)))
        assertTrue(d.dodaj(oseben("klic-oseben-1", zacetek)))
        zdaj += 2 * DAN
        shramba.zavrni = true
        val telo = poslanoTelo(d)
        assertFalse(telo.contains("klic-podjetje-1"), "potekel klic je odsel, ceprav ciscenje ni bilo zapisano: $telo")
        assertTrue(telo.contains("klic-oseben-1"))
    }

    // CR8: izbris A ne sme izginiti iz vrste izbrisov (in seznama zavrnitev), ce telefon brez racunalnika izbrise se 1000 klicev.
    @Test
    fun `CR8 - nepotrjen izbris ostane po 1000 kasnejsih izbrisih, tudi po ponovnem nalaganju`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba, ura = { zacetek })
        val a = oseben("klic-a-0", zacetek - DAN)
        assertTrue(d.dodaj(a))
        assertTrue(d.izbrisi(a.id, potrditevUporabnika = true))
        for (i in 1..MEJA_IZBRISANIH) {
            val z = oseben("klic-b-$i", zacetek - i)
            assertTrue(d.dodaj(z))
            assertTrue(d.izbrisi(z.id, potrditevUporabnika = true))
        }
        assertEquals(MEJA_IZBRISANIH + 1, d.izbrisiZaRacunalnik().size, "nepotrjeni izbrisi so bili odrezani")
        assertTrue(a.id in d.izbrisiZaRacunalnik(), "izbris A je izginil, racunalnik ga ne bo nikoli dobil")
        assertEquals(0, d.sprejmiIzRacunalnika(listOf(a.zaSinhronizacijo())), "racunalnik je izbrisani klic A vrnil na telefon")
        val znova = DnevnikKlicev(shramba, ura = { zacetek })
        assertTrue(a.id in znova.izbrisiZaRacunalnik(), "po nalaganju izbrisa A ni vec")
        assertEquals(0, znova.sprejmiIzRacunalnika(listOf(a.zaSinhronizacijo())), "po nalaganju je racunalnik vrnil izbrisani A")
    }

    @Test
    fun `CR8 - potrjeni izbrisi se obrezejo na mejo, nepotrjeni ne`() {
        val d = DnevnikKlicev(PomnilniskaShramba(), ura = { zacetek })
        for (i in 1..MEJA_IZBRISANIH) {
            val z = oseben("klic-c-$i", zacetek - i)
            assertTrue(d.dodaj(z)); assertTrue(d.izbrisi(z.id, potrditevUporabnika = true))
        }
        d.potrdiIzbrise(d.izbrisiZaRacunalnik()) // racunalnik je potrdil vse
        val nov = oseben("klic-d-1", zacetek)
        assertTrue(d.dodaj(nov)); assertTrue(d.izbrisi(nov.id, potrditevUporabnika = true))
        assertEquals(listOf(nov.id), d.izbrisiZaRacunalnik())
        // najstarejsi potrjen je sel iz seznama zavrnitev (meja), novi nepotrjen ostane zavrnjen
        assertEquals(1, d.sprejmiIzRacunalnika(listOf(oseben("klic-c-1", zacetek - 1).zaSinhronizacijo())))
        assertEquals(0, d.sprejmiIzRacunalnika(listOf(nov.zaSinhronizacijo())))
    }

    // CR1, CR2, CR3 v modulu app (lokalno se ne prevaja): preizkus BESEDILA kode, vedenje NEPREVERJENO (logika ustavitve je v
    // CakanjeSeje.ustaviPoZaprtju s preizkusom vedenja v modulu podpis).
    private fun app(pot: String) = listOf("../app/src/main/kotlin/si/safeer/lina/$pot", "app/src/main/kotlin/si/safeer/lina/$pot")
        .map(::File).first { it.isFile }.readText()

    @Test
    fun `CR1 CR2 CR3 - kontroler in zaslon (besedilo kode)`() {
        val k = app("asistent/AsistentKontroler.kt")
        // naloga 26t: CR1, krog 2 N1/N1b/N3/N5 so vedenje stroja (Naloga26tTest); tu samo, da kontroler klice prehode
        assertTrue(k.contains("val u = zaslon.koncaj(gen, id, konec, sKlepetom = obIzidu != null, seznanjen = AsistentShramba.beri(context) != null) ?: return"), "koncaj prek stroja (krog 2 N7: seznanitev)")
        assertEquals(1, Regex("""shrambaNaloge\.vzemiRocno\(\)""").findAll(k).count(), "rocno vzame samo lastnikov vzem")
        assertTrue(k.contains("shrambaNaloge.porabiRocno(vnos)"), "krog 2 N3")
        // CR3/CR6, 26t: nit po odgovoru (ne glede na zaslon) poslje dolgovan /ustavi; dolg se poravna samo s 202 ali 404
        assertTrue(Regex("""\n\s+CakanjeSeje\.ustaviPoPreklicu\(izid\)\?\.takeIf \{ shrambaNaloge\.dolgujeUstavitev\(it\) \}\?\.let \{ posljiUstavitve\(\) \}\n(\s*//[^\n]*\n)*\s+naGlavni \{ koncajCakanje""").containsMatchIn(k), "CR3 nit")
        assertTrue(k.contains("if (izPreklica && (odg is OdgovorLine.Ok || (odg is OdgovorLine.Napaka && odg.status == 404))) shrambaNaloge.ustavitevPotrjena(id)"), "poravnava dolga")
        assertEquals(1, Regex("""posljiUstavitev\([^)]*izPreklica = true\)""").findAll(k).count(), "krog 2 N5: ustavitev ob preklicu samo iz posljiUstavitve")
        // »Pozabi racunalnik« brise pod istim zaklepom
        assertTrue(app("asistent/AsistentShramba.kt").contains("synchronized(si.safeer.lina.samostojna.NalogaRacunalnika.ZAKLEP)"), "pozabi pod zaklepom")
        // CR2: naloga za ponovitev se vzame sele po obnovi stanja pogleda (post), ne neposredno v renderAssistant
        val a = app("DialerActivity.kt")
        assertTrue(Regex("""assistantTaskInput\.post \{\s+val q = AsistentPrikaz\.izracunaj\(asistent\.stanje\(\)\)[^\n]*\n\s+if \(!isDestroyed && q\.vnos && !q\.odgovor && assistantTaskInput\.text\.isNullOrEmpty\(\)\) asistent\.vzemiZaPonovitev\(\)""").containsMatchIn(a), "CR2 post")
        assertEquals(1, Regex("""vzemiZaPonovitev\(\)""").findAll(a).count(), "CR2 neposreden klic")
    }

    // CR10: oddaja je bila morda na poti, aplikacija je bila zaprta vec kot 24 h - izid neznan, ne tiho »potekla«.
    @Test
    fun `CR10 - oddana naloga po vec kot 24 h pri istem racunalniku je NEZNAN`() {
        val rok = 3 * 60_000L
        val id = "id-naloge-24-abcdefghijklmno"
        assertEquals(NalogaCakaSejo.Ob.NEZNAN,
            NalogaCakaSejo.obZagonu(true, id, "odtis-1", "odtis-1", zacetek, zacetek + 25 * 3_600_000L, rok, oddano = true))
        assertEquals(NalogaCakaSejo.Ob.NEZNAN,
            NalogaCakaSejo.obZagonu(true, id, "odtis-1", "odtis-1", zacetek, zacetek - 60_000L, rok, oddano = true), "ura nazaj po oddaji")
        // brez oznake oddaje in pri drugem racunalniku ostane kot prej
        assertEquals(NalogaCakaSejo.Ob.NIC,
            NalogaCakaSejo.obZagonu(true, id, "odtis-1", "odtis-1", zacetek, zacetek + 25 * 3_600_000L, rok, oddano = false))
        assertEquals(NalogaCakaSejo.Ob.NIC,
            NalogaCakaSejo.obZagonu(true, id, "odtis-1", "odtis-2", zacetek, zacetek + 25 * 3_600_000L, rok, oddano = true))
        assertEquals(NalogaCakaSejo.Ob.OBNOVI,
            NalogaCakaSejo.obZagonu(true, id, "odtis-1", "odtis-1", zacetek, zacetek + 60_000L, rok, oddano = true))
    }
}
