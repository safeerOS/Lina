package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Naloga 34: vec racunalnikov na telefonu (seznam, prehod ene seznanitve) in razdelitev nalog po obremenitvi. */
class Naloga34Test {
    private val oA = "a".repeat(64)
    private val oB = "b".repeat(64)
    private val oC = "c".repeat(64)
    /** Kot AsistentQr.naslov: zasebni naslov, vrata, 64 hex. */
    private val veljaven: (Racunalnik) -> Boolean = { it.odtis.matches(Regex("^[0-9a-f]{64}$")) && it.vrata in 1..65535 && it.naslov.startsWith("192.168.") }

    private fun dva(): SeznamRacunalnikov {
        val s1 = Racunalniki.dodaj(SeznamRacunalnikov(), oA, "192.168.1.10", 8446, "Prenosnik")!!
        return Racunalniki.dodaj(s1, oB, "192.168.1.20", 8446, "Testni PC")!!
    }

    // ---------------------------------------------------------------- seznam

    @Test fun `nova seznanitev NE prepise stare - drug odtis je nov clan, izbran postane novi`() {
        val s = dva()
        assertEquals(listOf(oA, oB), s.racunalniki.map { it.odtis })
        assertEquals(oB, s.izbran)
        assertEquals("Prenosnik", s.po(oA)!!.ime)
    }

    @Test fun `ponovna seznanitev istega racunalnika posodobi samo naslov (ime, rele, prepoved ostanejo)`() {
        var s = Racunalniki.nastaviRele(dva(), oA, "r-1")
        s = Racunalniki.prepovej(s, oA, true)
        s = Racunalniki.dodaj(s, oA.uppercase(), "192.168.1.99", 9000, "Drugo ime")!!
        assertEquals(2, s.racunalniki.size)
        val a = s.po(oA)!!
        assertEquals("192.168.1.99", a.naslov); assertEquals(9000, a.vrata)
        assertEquals("Prenosnik", a.ime); assertEquals("r-1", a.rele); assertTrue(a.prepovedan)
        assertEquals(oA, s.izbran)
    }

    @Test fun `preimenuj in odstrani posamezno, ostali ostanejo - odstranjen izbran preda izbiro prvemu`() {
        var s = Racunalniki.preimenuj(dva(), oA, "  Dom‮\u0000  ")
        assertEquals("Dom", s.po(oA)!!.ime)
        assertEquals(s, Racunalniki.preimenuj(s, oA, "\u0007"), "prazno ime ne spremeni nicesar")
        s = Racunalniki.odstrani(s, oB)
        assertEquals(listOf(oA), s.racunalniki.map { it.odtis })
        assertEquals(oA, s.izbran)
        s = Racunalniki.odstrani(s, oA)
        assertNull(s.izbran); assertNull(s.izbrani())
    }

    @Test fun `seznam ima mejo, izbira neznanega odtisa ne spremeni nicesar`() {
        var s = SeznamRacunalnikov()
        repeat(NAJVEC_RACUNALNIKOV) { i -> s = Racunalniki.dodaj(s, "%064x".format(i + 1), "192.168.1.${i + 1}", 8446)!! }
        assertNull(Racunalniki.dodaj(s, oC, "192.168.2.1", 8446))
        assertEquals(s, Racunalniki.izberi(s, oC))
    }

    // ---------------------------------------------------------------- prehod in shramba

    @Test fun `prehod - obstojeca ena seznanitev postane prvi clan (izbran, z relejem)`() {
        val s = Racunalniki.prehod(null, "192.168.1.10", 8446, oA.uppercase(), "r-9", veljaven)
        assertEquals(listOf(Racunalnik(oA, "192.168.1.10", 8446, PRIVZETO_IME, "r-9")), s.racunalniki)
        assertEquals(oA, s.izbran)
        // seznam ze obstaja: stari kljuci se ne berejo vec (ne podvojijo ali vrnejo pozabljenega)
        val obstojec = dva()
        assertEquals(obstojec, Racunalniki.prehod(obstojec, "192.168.1.77", 8446, oC, null, veljaven))
        // brez stare seznanitve ali z neveljavno: prazen seznam
        assertTrue(Racunalniki.prehod(null, null, 0, null, null, veljaven).racunalniki.isEmpty())
        assertTrue(Racunalniki.prehod(null, "8.8.8.8", 8446, oA, null, veljaven).racunalniki.isEmpty())
    }

    @Test fun `zapis in branje - krog brez izgube - neveljaven clan se preskoci, ostali ostanejo - pokvarjen zapis je null`() {
        val s = Racunalniki.nastaviRele(dva(), oB, "r-2")
        assertEquals(s, Racunalniki.izJson(Racunalniki.vJson(s), veljaven))
        val z = Racunalniki.vJson(s.copy(racunalniki = s.racunalniki + Racunalnik(oC, "8.8.8.8", 8446) + s.racunalniki[0]))
        val p = Racunalniki.izJson(z, veljaven)!!
        assertEquals(listOf(oA, oB), p.racunalniki.map { it.odtis }, "javni naslov preskocen, podvojen odtis samo enkrat")
        assertNull(Racunalniki.izJson("{pokvarjeno", veljaven))
        assertNull(Racunalniki.izJson(null, veljaven))
        // izbran, ki ga ni vec na seznamu, ne velja
        assertEquals(oA, Racunalniki.izJson(Racunalniki.vJson(s.copy(izbran = oC)), veljaven)!!.izbran)
    }

    // ---------------------------------------------------------------- obremenitev iz /stanje

    @Test fun `obremenitev iz podpisanega stanja - polja posebej, napacna vrsta je neznano, nikoli 0`() {
        val o = Obremenitev.izStanja("""{"claudeCode":"odprta","racunalnik":{"ime":"Testni PC","jedra":4,"obremenitev5":3.5,"prostMb":6000}}""")!!
        assertEquals(Obremenitev(3.5, 4, 6000, "Testni PC"), o)
        assertEquals(0.875, o.naJedro())
        assertEquals(Obremenitev(), Obremenitev.izStanja("""{"claudeCode":"odprta"}"""), "starejsa Lina brez polja")
        val n = Obremenitev.izStanja("""{"racunalnik":{"jedra":"4","obremenitev5":-1,"prostMb":1.5,"ime":7}}""")!!
        assertEquals(Obremenitev(), n)
        assertNull(n.naJedro())
        assertNull(Obremenitev.izStanja("x".repeat(5000)))
    }

    // ---------------------------------------------------------------- razdelitev

    private fun k(odtis: String, l: Double?, j: Int? = 4, mb: Long? = 8000, dosegljiv: Boolean = true, prepovedan: Boolean = false) =
        Kandidat(Racunalnik(odtis, "192.168.1.1", 8446, prepovedan = prepovedan), dosegljiv, Obremenitev(l, j, mb))

    private fun izbran(i: RazdelitevDela.Izbira) = (i as RazdelitevDela.Izbira.Racunalnik).r.odtis

    @Test fun `dva lazna racunalnika z razlicno obremenitvijo - naloga gre na manj obremenjenega (na jedro)`() {
        // prenosnik 8 jeder load 6 (0,75/jedro) proti testnemu PC 4 jedra load 1 (0,25/jedro)
        assertEquals(oB, izbran(RazdelitevDela.izberi(listOf(k(oA, 6.0, 8), k(oB, 1.0, 4)))))
        assertEquals(oA, izbran(RazdelitevDela.izberi(listOf(k(oA, 1.0, 8), k(oB, 1.0, 4)))))
        assertEquals(RazdelitevDela.Razlog.NAJMANJ_OBREMENJEN, (RazdelitevDela.izberi(listOf(k(oA, 1.0, 8), k(oB, 1.0, 4))) as RazdelitevDela.Izbira.Racunalnik).razlog)
    }

    @Test fun `nedosegljiv gre drugemu, prepovedan se samodejno ne izbere, vsi nedosegljivi = noben`() {
        assertEquals(oB, izbran(RazdelitevDela.izberi(listOf(k(oA, 0.1, dosegljiv = false), k(oB, 3.0)))))
        assertEquals(oB, izbran(RazdelitevDela.izberi(listOf(k(oA, 0.1, prepovedan = true), k(oB, 3.0)))))
        assertEquals(RazdelitevDela.Izbira.Noben, RazdelitevDela.izberi(listOf(k(oA, 0.1, dosegljiv = false), k(oB, 1.0, dosegljiv = false))))
        assertEquals(RazdelitevDela.Izbira.Noben, RazdelitevDela.izberi(emptyList()))
    }

    @Test fun `samodejno privzeto vklopljeno - izklopljeno = rocna izbira izbranega, ohrani se v zapisu`() {
        val s = dva()
        assertTrue(s.samodejno); assertNull(s.rocno())
        val r = s.copy(samodejno = false)
        assertEquals(oB, r.rocno())
        assertEquals(oB, Racunalniki.izJson(Racunalniki.vJson(r), veljaven)!!.rocno())
        assertTrue(Racunalniki.prehod(null, "192.168.1.10", 8446, oA, null, veljaven).samodejno)
    }

    @Test fun `rocna izbira velja (tudi prepovedan), nedosegljiv rocni NE gre drugam`() {
        assertEquals(oA, izbran(RazdelitevDela.izberi(listOf(k(oA, 9.0, prepovedan = true), k(oB, 0.1)), rocno = oA)))
        val r = RazdelitevDela.izberi(listOf(k(oA, 0.1, dosegljiv = false), k(oB, 0.1)), rocno = oA)
        assertEquals(oA, (r as RazdelitevDela.Izbira.RocniNedosegljiv).r.odtis)
    }

    @Test fun `neznana obremenitev je za znano neobremenjeno, a pred preobremenjenim - malo RAM je preobremenjen`() {
        assertEquals(oB, izbran(RazdelitevDela.izberi(listOf(k(oA, null), k(oB, 4.0)))))
        assertEquals(oA, izbran(RazdelitevDela.izberi(listOf(k(oA, null), k(oB, 6.0)))), "6 na 4 jedrih je nad pragom")
        assertEquals(oA, izbran(RazdelitevDela.izberi(listOf(k(oA, 2.0), k(oB, 0.1, mb = 500)))), "500 MB prostega")
        val vsi = RazdelitevDela.izberi(listOf(k(oA, 8.0), k(oB, 7.0)))
        assertEquals(oB, izbran(vsi))
        assertEquals(RazdelitevDela.Razlog.VSI_PREOBREMENJENI, (vsi as RazdelitevDela.Izbira.Racunalnik).razlog)
    }

    @Test fun `izenacenje - prej izbrani, nato stalni vrstni red po odtisu (deterministicno)`() {
        assertEquals(oB, izbran(RazdelitevDela.izberi(listOf(k(oA, 1.0), k(oB, 1.0)), prejIzbran = oB)))
        assertEquals(oA, izbran(RazdelitevDela.izberi(listOf(k(oB, 1.0), k(oA, 1.0)))))
        assertEquals(RazdelitevDela.Razlog.EDINI, (RazdelitevDela.izberi(listOf(k(oA, 9.0))) as RazdelitevDela.Izbira.Racunalnik).razlog)
    }

    @Test fun `dve nalogi zaporedoma gresta vsaka na svoj racunalnik, ko prva dvigne obremenitev`() {
        val prva = izbran(RazdelitevDela.izberi(listOf(k(oA, 1.0, 8), k(oB, 0.4, 4))))
        assertEquals(oB, prva)
        // po prvi nalogi testni PC izmeri 3,0 (0,75/jedro), prenosnik se vedno 1,0 (0,125/jedro)
        assertEquals(oA, izbran(RazdelitevDela.izberi(listOf(k(oA, 1.0, 8), k(oB, 3.0, 4)), prejIzbran = prva)))
        assertNotNull(prva)
    }

    // ---------------------------------------------------------------- slepi pregled 34

    @Test fun `S1 - poti tekoce naloge gredo na racunalnik ob oddaji, ne na kasneje izbranega - odstranjen = konec spremljanja`() {
        var s = dva() // izbran B
        val cilj = oA
        s = Racunalniki.izberi(s, oB)
        assertEquals(oA, Racunalniki.zaNalogo(s, cilj)!!.odtis, "izbira v zavihku ne preusmeri odgovora/ustavitve naloge")
        s = Racunalniki.dodaj(s, oC, "192.168.1.30", 8446)!!
        assertEquals(oA, Racunalniki.zaNalogo(s, cilj)!!.odtis, "nova seznanitev med nalogo tudi ne")
        assertNull(Racunalniki.zaNalogo(Racunalniki.odstrani(s, oA), cilj), "pozabljen racunalnik naloge: spremljanje se ustavi (T13)")
        assertEquals(s.izbrani(), Racunalniki.zaNalogo(s, null))
    }

    @Test fun `S2 - dolgovan ustavi je poravnan samo, ce so ga sprejeli VSI racunalniki`() {
        assertTrue(RazdelitevDela.ustavitevPoravnana(listOf(true, true)))
        assertFalse(RazdelitevDela.ustavitevPoravnana(listOf(true, false)), "drug racunalnik (z nalogo) je bil nedosegljiv")
        assertFalse(RazdelitevDela.ustavitevPoravnana(emptyList()))
    }

    @Test fun `S3 - izkljucen izbrani ne dobi nove naloge, ko drugi ni dosegljiv`() {
        val s = Racunalniki.prepovej(Racunalniki.izberi(dva(), oA), oA, true)
        assertNull(RazdelitevDela.cilj(s, listOf(Kandidat(s.po(oA)!!, true), Kandidat(s.po(oB)!!, false))))
        assertEquals(oB, RazdelitevDela.cilj(s, listOf(Kandidat(s.po(oA)!!, true), Kandidat(s.po(oB)!!, true)))!!.odtis)
        // nihce ni dosegljiv in izbrani ni izkljucen: izbrani (naloga javi nedosegljiv ali gre za pozneje)
        val t = Racunalniki.izberi(dva(), oA)
        assertEquals(oA, RazdelitevDela.cilj(t, listOf(Kandidat(t.po(oA)!!, false), Kandidat(t.po(oB)!!, false)))!!.odtis)
    }

    @Test fun `S3b - shranjena naloga samo svojemu racunalniku - nedosegljiv ostane on, odstranjen nihce`() {
        val s = dva()
        assertEquals(oA, RazdelitevDela.cilj(s, listOf(Kandidat(s.po(oA)!!, false), Kandidat(s.po(oB)!!, true)), naRacunalnik = oA)!!.odtis)
        assertNull(RazdelitevDela.cilj(s, listOf(Kandidat(s.po(oB)!!, true)), naRacunalnik = oC))
        val en = Racunalniki.dodaj(SeznamRacunalnikov(), oA, "192.168.1.10", 8446)!!
        assertEquals(oA, RazdelitevDela.cilj(en, null, naRacunalnik = oA)!!.odtis)
        assertNull(RazdelitevDela.cilj(en, null, naRacunalnik = oB))
    }

    @Test fun `S4 - nova seznanitev ne prevzame rocne izbire »samo ta«`() {
        val r = Racunalniki.izberi(dva(), oA).copy(samodejno = false)
        val n = Racunalniki.dodaj(r, oC, "192.168.1.30", 8446)!!
        assertEquals(oA, n.rocno())
        assertEquals(3, n.racunalniki.size)
        // samodejno vklopljeno: novi postane izbran (za zavihke), naloge se tako ali tako razdelijo po obremenitvi
        assertEquals(oC, Racunalniki.dodaj(dva(), oC, "192.168.1.30", 8446)!!.izbran)
    }

    @Test fun `S9 - neveljaven rele ne zavrze racunalnika, samo rele`() {
        val s = Racunalniki.nastaviRele(dva(), oA, "x")
        val p = Racunalniki.izJson(Racunalniki.vJson(s), veljaven) { it.startsWith("r-") }!!
        assertEquals(listOf(oA, oB), p.racunalniki.map { it.odtis })
        assertNull(p.po(oA)!!.rele)
        assertNull(Racunalniki.prehod(null, "192.168.1.10", 8446, oA, "x", veljaven) { it.startsWith("r-") }.racunalniki[0].rele)
    }

    @Test fun `S11 - ime brez locil vrstic, privzeto ime se po odstranitvi ne podvoji`() {
        assertEquals("ab", Racunalniki.cistoIme("a\u2028b\u2029"))
        var s = SeznamRacunalnikov()
        for (o in listOf(oA, oB, oC)) s = Racunalniki.dodaj(s, o, "192.168.1.1", 8446)!!
        assertEquals(listOf("Racunalnik", "Racunalnik 2", "Racunalnik 3"), s.racunalniki.map { it.ime })
        s = Racunalniki.odstrani(s, oB)
        s = Racunalniki.dodaj(s, "d".repeat(64), "192.168.1.1", 8446)!!
        assertEquals(listOf("Racunalnik", "Racunalnik 3", "Racunalnik 2"), s.racunalniki.map { it.ime })
    }

    // ---------------------------------------------------------------- slepi pregled 34, krog 2

    @Test fun `K2 N1 N2 - cakanje in obnova po zagonu za racunalnik naloge, ne za izbranega v zavihku`() {
        val s = Racunalniki.izberi(dva(), oB) // izbran B, naloga na A
        assertEquals(oA, Racunalniki.seznanjen(s, oA), "A je se seznanjen: cakanje se ne preklice")
        assertTrue(CakajocaNaloga.smePoslati(oA, Racunalniki.seznanjen(s, oA), 1000L, 2000L))
        assertNull(Racunalniki.seznanjen(Racunalniki.odstrani(s, oA), oA), "pozabljen A: preklic")
        val rok = 3 * 60_000L
        val t0 = 1_800_000_000_000L
        // naloga caka na A, oznaka oddaje zapisana, proces umre, izbran je B: po zagonu NEZNAN (ne »potekla«, ki bi vodila v dvojno izvedbo)
        val io = LaznaIoNaloge()
        val n = NalogaRacunalnika(io)
        assertTrue(n.zacniCakanje("id-naloge-34-abcdefghijklmn", "b", oA, t0))
        assertTrue(n.predOddajo("id-naloge-34-abcdefghijklmn"))
        assertEquals(NalogaRacunalnika.Obnova.Neznan, NalogaRacunalnika(io).obnoviZa({ s.po(it) != null }, t0 + rok + 1, rok))
        // v roku: nadaljuje se na A
        val io2 = LaznaIoNaloge()
        assertTrue(NalogaRacunalnika(io2).zacniCakanje("id-naloge-34-bbcdefghijklmn", "b", oA, t0))
        assertTrue(NalogaRacunalnika(io2).obnoviZa({ s.po(it) != null }, t0 + 1000, rok) is NalogaRacunalnika.Obnova.Nadaljuj)
        // A pozabljen: nic se ne poslje
        val io3 = LaznaIoNaloge()
        assertTrue(NalogaRacunalnika(io3).zacniCakanje("id-naloge-34-cbcdefghijklmn", "b", oA, t0))
        assertTrue(NalogaRacunalnika(io3).obnoviZa({ false }, t0 + 1000, rok) is NalogaRacunalnika.Obnova.Nic)
    }

    @Test fun `K2 N8 - ime gostitelja zamenja samo privzeto ime`() {
        val s = SeznamRacunalnikov(racunalniki = listOf(Racunalnik(oA, "192.168.1.1", 8446, "Racunalnik 2"), Racunalnik(oB, "192.168.1.2", 8446, "Pisarna")))
        assertEquals("testni-pc", Racunalniki.imeIzStanja(s, oA, "testni-pc")!!.po(oA)!!.ime)
        assertNull(Racunalniki.imeIzStanja(s, oB, "testni-pc"), "uporabnikovo ime ostane")
        assertNull(Racunalniki.imeIzStanja(s, oA, "\u0007"))
        assertNull(Racunalniki.imeIzStanja(s, oC, "x"))
    }

    @Test fun `K2 N6 - vrnitev na starejso razlicico - pozabljen ostane pozabljen, nova seznanitev se doda`() {
        val s = Racunalniki.izberi(dva(), oA)
        assertEquals(s, Racunalniki.uskladi(s, "192.168.1.10", 8446, oA, veljaven), "zrcalo enako: nic")
        assertEquals(listOf(oB), Racunalniki.uskladi(s, null, 0, null, veljaven).racunalniki.map { it.odtis }, "starejsa je A pozabila")
        val u = Racunalniki.uskladi(s, "192.168.1.30", 8446, oC, veljaven)
        assertEquals(listOf(oA, oB, oC), u.racunalniki.map { it.odtis })
        assertEquals(oC, u.izbran)
        assertEquals(s, Racunalniki.uskladi(s, "8.8.8.8", 8446, oC, veljaven), "neveljavno zrcalo se ne doda")
        val r = s.copy(samodejno = false)
        val ur = Racunalniki.uskladi(r, "192.168.1.30", 8446, oC, veljaven)
        assertFalse(ur.samodejno)
        assertEquals(oC, ur.izbran, "seznanitev v starejsi razlicici je bila izrecna izbira")
        // krog 3 N1: prazen seznam (vse pozabljeno), starejsa seznani C -> C je na seznamu
        assertEquals(listOf(oC), Racunalniki.uskladi(SeznamRacunalnikov(), "192.168.1.30", 8446, oC, veljaven).racunalniki.map { it.odtis })
        assertEquals(SeznamRacunalnikov(), Racunalniki.uskladi(SeznamRacunalnikov(), null, 0, null, veljaven))
        // krog 3 N2: isti racunalnik z novim naslovom (DHCP) -> nov naslov ostane
        val a = Racunalniki.uskladi(s, "192.168.1.99", 8447, oA, veljaven).po(oA)!!
        assertEquals("192.168.1.99" to 8447, a.naslov to a.vrata)
    }

    @Test fun `K3 - ime se ne konca z osamljenim nadomestnim znakom`() {
        val c = Racunalniki.cistoIme("a" + "\uD83D\uDE00".repeat(59))!!
        assertFalse(c.last().isHighSurrogate())
        assertEquals(59, c.length)
    }
}
