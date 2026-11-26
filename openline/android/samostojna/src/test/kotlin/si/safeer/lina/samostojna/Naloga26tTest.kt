package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Lazna shramba (kot SharedPreferences.all): [zavrni] = commit ne uspe (poln disk). */
class LaznaIoNaloge(vsebina: Map<String, Any?> = emptyMap()) : ShrambaNalogeIo {
    val m = HashMap<String, Any?>(vsebina)
    var zavrni = false
    var zapisov = 0
    override fun vse(): Map<String, *> = HashMap(m)
    override fun zapisi(json: String?, odstrani: Collection<String>): Boolean {
        if (zavrni) return false
        zapisov++
        for (k in odstrani) m.remove(k)
        if (json == null) m.remove(NalogaRacunalnika.KLJUC) else m[NalogaRacunalnika.KLJUC] = json
        return true
    }
}

/** Naloga 26t: najdbe CodeRabbit krog 2 (CRA1-CRA5) in invariante 23t/24 kot vedenje stroja stanj (prej preizkus besedila app). */
class Naloga26tTest {
    private val t0 = 1_800_000_000_000L
    private val rok = 180_000L
    private val idA = "id-naloge-a-26t-abcdefghijkl"
    private val idB = "id-naloge-b-26t-abcdefghijkl"

    // CRA2: aplikacija pred 26t (c5b10d1, 40466a4) je oznako oddaje pisala kot Boolean; typed getString bi vrgel ClassCastException.
    @Test fun `CRA2 - stara oznaka oddaje Boolean true se prebere kot oddana, brez izjeme`() {
        val io = LaznaIoNaloge(mapOf("z_id" to idA, "z_besedilo" to "Naredi X", "z_odtis" to "odtis-1", "z_cas" to t0, "z_oddano" to true))
        val n = NalogaRacunalnika(io)
        val c = n.stanje().cakajoca
        assertEquals(idA, c?.id)
        assertEquals(1, c?.oddaj, "oznaka true (oddaja morda na poti) se je izgubila")
        // po roku: izid neznan, ne rocna ponovitev (bi se izvedla dvakrat)
        assertEquals(NalogaRacunalnika.Obnova.Neznan, n.obnovi("odtis-1", t0 + rok + 1, rok))
        assertNull(n.rocno())
    }

    @Test fun `CRA2 - stara oznaka false ali tuj id ni oznaka, oznaka z id te naloge je`() {
        fun oddaj(o: Any?) = NalogaRacunalnika(LaznaIoNaloge(mapOf("z_id" to idA, "z_besedilo" to "X", "z_cas" to t0, "z_oddano" to o))).stanje().cakajoca!!.oddaj
        assertEquals(0, oddaj(false))
        assertEquals(0, oddaj(idB), "oznaka stare (druge) naloge je veljala za to")
        assertEquals(1, oddaj(idA))
        assertEquals(0, oddaj(null))
        assertEquals(0, oddaj(42), "neznan tip ni oznaka in ne sesuje")
    }

    @Test fun `CRA2 - migracija v en zapis odstrani vse stare kljuce v enem zapisu, ohrani vsa mesta`() {
        val io = LaznaIoNaloge(mapOf("z_id" to idA, "z_besedilo" to "Naredi X", "z_odtis" to "odtis-1", "z_cas" to t0, "z_oddano" to true,
            "z_rocno" to "Rocna Y", "z_preklic" to "$idB,stari-id", "besedilo" to "Shranjena Z", "odtis" to "odtis-1", "cas" to t0 - 5))
        val n = NalogaRacunalnika(io)
        assertFalse(n.preberiInPopravi(), "stara oblika ni pokvarjena")
        assertEquals(1, io.zapisov, "migracija ni en zapis")
        assertEquals(setOf(NalogaRacunalnika.KLJUC), io.m.keys, "stari kljuci so ostali")
        val s = n.stanje()
        assertEquals(CakajocaZapis(idA, "Naredi X", "odtis-1", t0, 1), s.cakajoca)
        assertEquals("Rocna Y", s.rocno)
        assertEquals(ShranjenaZapis("Shranjena Z", "odtis-1", t0 - 5), s.shranjena)
        assertEquals(listOf(idB, "stari-id"), s.preklicani)
    }

    @Test fun `CRA2 - z_cas kot Int, cakajoca brez id gre v rocno, pokvarjen ali neznan zapis ne sesuje`() {
        assertEquals(5L, NalogaRacunalnika(LaznaIoNaloge(mapOf("z_id" to idA, "z_besedilo" to "X", "z_cas" to 5))).stanje().cakajoca!!.zacetek)
        val brezId = NalogaRacunalnika(LaznaIoNaloge(mapOf("z_besedilo" to "Brez id")))
        assertNull(brezId.stanje().cakajoca); assertEquals("Brez id", brezId.rocno(), "naloga brez id je izginila")
        for (v in listOf<Any>("{ni json", """{"v":99,"rocno":"x"}""", 7)) {
            val io = LaznaIoNaloge(mapOf(NalogaRacunalnika.KLJUC to v))
            val n = NalogaRacunalnika(io)
            assertTrue(n.preberiInPopravi(), "pokvarjen zapis $v ni javljen lastniku")
            assertEquals(StanjeNaloge(), n.stanje())
            assertFalse(io.m.containsKey(NalogaRacunalnika.KLJUC), "pokvarjen zapis ni pociscen")
        }
    }

    @Test fun `zapis se prebere nazaj enak (verzija, vsa polja)`() {
        val io = LaznaIoNaloge()
        val n = NalogaRacunalnika(io)
        n.zacniCakanje(idA, "Naredi X", "odtis-1", t0)
        assertTrue(n.predOddajo(idA))
        n.nastaviRocno("R"); n.shrani("S", "odtis-1", t0)
        val pred = n.stanje()
        assertEquals(pred, NalogaRacunalnika(LaznaIoNaloge(io.m)).stanje())
        // slepi 26t N3: verzija mora biti v zapisu, sicer prihodnja v2 ni locljiva od v1
        assertTrue((io.m[NalogaRacunalnika.KLJUC] as String).contains("\"v\":1"), "verzija ni zapisana: ${io.m[NalogaRacunalnika.KLJUC]}")
        val v2 = LaznaIoNaloge(mapOf(NalogaRacunalnika.KLJUC to """{"v":2,"rocno":"R"}"""))
        assertTrue(NalogaRacunalnika(v2).preberiInPopravi(), "zapis prihodnje verzije je prebran kot v1")
    }

    // CRA4: A prestane preverbo preklica, lastnik jo preklice, B zacne cakati in odda, A nato zapise oznako - A ne sme oditi ne prepisati B.
    @Test fun `CRA4 - pozna oznaka preklicane naloge ne prepise oznake nove in ne odda`() {
        val io = LaznaIoNaloge()
        val zaslon1 = ZaslonNaloge(NalogaRacunalnika(io))
        val zaslon2 = ZaslonNaloge(NalogaRacunalnika(io))
        zaslon1.zacni(idA, "Naredi A", "odtis-1", t0)
        assertEquals(ZaslonNaloge.Sporocilo.PREKLICANO, zaslon2.preklici(t0 + 1))
        zaslon2.zacni(idB, "Naredi B", "odtis-1", t0 + 2)
        assertTrue(zaslon2.naloga.predOddajo(idB))
        assertFalse(zaslon1.naloga.predOddajo(idA), "preklicana A je dobila dovoljenje za oddajo")
        assertEquals(CakajocaZapis(idB, "Naredi B", "odtis-1", t0 + 2, 1), zaslon1.naloga.stanje().cakajoca, "oznaka B je prepisana")
        // po roku: B je bila oddana -> neznan (ne ROK, ki bi ponudil ponovitev)
        assertEquals(NalogaRacunalnika.Obnova.Neznan, zaslon1.naloga.obnovi("odtis-1", t0 + 2 + rok + 1, rok))
    }

    @Test fun `CRA4 - preklicana naloga ostane preklicana tudi, ce isti id znova zacne cakati na drugem zaslonu`() {
        val n = NalogaRacunalnika(LaznaIoNaloge())
        n.zacniCakanje(idA, "A", "o", t0)
        assertEquals(NalogaRacunalnika.Preklic(idA, false), n.preklici(t0))
        n.zacniCakanje(idA, "A", "o", t0) // obnova starega zaslona s starim id
        assertFalse(n.predOddajo(idA), "preklicani id je odsel")
    }

    @Test fun `CRA4 - oznake ni mogoce trajno zapisati - ne oddaj`() {
        val io = LaznaIoNaloge()
        val n = NalogaRacunalnika(io)
        n.zacniCakanje(idA, "A", "o", t0)
        io.zavrni = true
        assertFalse(n.predOddajo(idA), "oddaja brez trajne oznake (po smrti procesa bi se ponudila ponovitev)")
    }

    // CRA1: oddaja A je prisla do racunalnika, zaslon se zapre, obnovljen poskus ne doseze racunalnika - ne sme v rocno (nov id).
    @Test fun `CRA1 - nedosegljiv po prejsnji oddaji istega id je NEZNAN, prvi nedosegljiv je rocna ponovitev`() {
        val n = NalogaRacunalnika(LaznaIoNaloge())
        n.zacniCakanje(idA, "Naredi A", "o", t0)
        assertTrue(n.predOddajo(idA)) // prvi zaslon: POST odide, odgovor izgubljen ob zaprtju
        n.zacniCakanje(idA, "Naredi A", "o", t0) // obnova (isti id ohrani stevec)
        assertTrue(n.predOddajo(idA))
        assertEquals(NalogaRacunalnika.Ukrep.Neznan, n.koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.NEDOSEGLJIV), sKlepetom = false))
        assertNull(n.rocno(), "naloga, ki jo racunalnik morda ze ima, je ponujena za rocno ponovitev")
        val m = NalogaRacunalnika(LaznaIoNaloge())
        m.zacniCakanje(idA, "Naredi A", "o", t0)
        assertTrue(m.predOddajo(idA))
        assertEquals(NalogaRacunalnika.Ukrep.Rocno(IzidPredaje.NEDOSEGLJIV), m.koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.NEDOSEGLJIV), false))
        assertEquals("Naredi A", m.rocno())
        // preizkus lastnosti (1. tek): razlog zagona za ta poskus, a drug zaslon je isti id oddal hkrati - ne rocna ponovitev
        val d = NalogaRacunalnika(LaznaIoNaloge()).apply { zacniCakanje(idA, "A", "o", t0); predOddajo(idA); predOddajo(idA) }
        assertEquals(NalogaRacunalnika.Ukrep.Neznan, d.koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.ZAGON_IZKLOPLJENO), false))
        assertNull(d.rocno())
        // s klepetom: klepet ponudi »shrani za pozneje«, mesto rocne ostane prazno
        val k = NalogaRacunalnika(LaznaIoNaloge()).apply { zacniCakanje(idA, "A", "o", t0); predOddajo(idA) }
        assertEquals(NalogaRacunalnika.Ukrep.Napaka(IzidPredaje.NEDOSEGLJIV), k.koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.NEDOSEGLJIV), true))
    }

    // Prej besedilo app (Naloga23tTest »kontroler«, Naloga24Test »CR1 CR2 CR3«): ista pravila zdaj kot vedenje.
    @Test fun `23t 24 - rok ali brez podpisa po oddaji je NEZNAN, brez oddaje rocna ponovitev (krog 3 N1b)`() {
        fun stroj(oddaj: Boolean) = NalogaRacunalnika(LaznaIoNaloge()).apply { zacniCakanje(idA, "A", "o", t0); if (oddaj) assertTrue(predOddajo(idA)) }
        assertEquals(NalogaRacunalnika.Ukrep.Neznan, stroj(true).koncaj(idA, NalogaRacunalnika.Konec.Rok(IzidPredaje.ZAGON_ROK), false))
        assertEquals(NalogaRacunalnika.Ukrep.Neznan, stroj(true).koncaj(idA, NalogaRacunalnika.Konec.BrezPodpisa, false))
        stroj(false).let { assertEquals(NalogaRacunalnika.Ukrep.Rocno(IzidPredaje.ZAGON_ROK), it.koncaj(idA, NalogaRacunalnika.Konec.Rok(IzidPredaje.ZAGON_ROK), false)); assertEquals("A", it.rocno()) }
        stroj(false).let { assertEquals(NalogaRacunalnika.Ukrep.Rocno(IzidPredaje.NAPAKA), it.koncaj(idA, NalogaRacunalnika.Konec.BrezPodpisa, false)) }
        // razlog zagona po oddaji: racunalnik je odgovoril pred prevzemom id - rocna; 403/429 brez ponovitve; NEZNAN brez ponovitve
        assertEquals(NalogaRacunalnika.Ukrep.Rocno(IzidPredaje.ZAGON_IZKLOPLJENO), stroj(true).koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.ZAGON_IZKLOPLJENO), false))
        assertEquals(NalogaRacunalnika.Ukrep.Napaka(IzidPredaje.ZAVRNJENA), stroj(true).koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.ZAVRNJENA), false))
        assertEquals(NalogaRacunalnika.Ukrep.Neznan, stroj(true).koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.NEZNAN), false))
        assertEquals(NalogaRacunalnika.Ukrep.Spremljaj(idA), stroj(true).koncaj(idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.SPREJETA), false))
        assertEquals(NalogaRacunalnika.Ukrep.Neznan, stroj(true).koncaj(idA, NalogaRacunalnika.Konec.Preklicano, false))
        assertEquals(NalogaRacunalnika.Ukrep.Preklicano, stroj(false).koncaj(idA, NalogaRacunalnika.Konec.Preklicano, false))
    }

    @Test fun `24 krog 2 N1 - mesto druge naloge (ali pobrisano) - tuje, nic se ne zapise`() {
        val n = NalogaRacunalnika(LaznaIoNaloge())
        n.zacniCakanje(idB, "B", "o", t0)
        val pred = n.stanje()
        assertEquals(NalogaRacunalnika.Ukrep.Tuje, n.koncaj(idA, NalogaRacunalnika.Konec.Rok(IzidPredaje.ZAGON_ROK), false))
        assertEquals(pred, n.stanje(), "tuja nit je spremenila mesta druge naloge")
        assertNull(n.rocno())
    }

    @Test fun `24 CR1 N5 N6 krog 2 N3 - rocna ponovitev ostane ob preklicu, blokira shranjeno, porabi jo isto besedilo`() {
        val n = NalogaRacunalnika(LaznaIoNaloge())
        n.nastaviRocno("Naredi R")
        n.shrani("Shranjena", "o", t0)
        n.zacniCakanje(idA, "A", "o", t0)
        n.preklici(t0)
        assertEquals("Naredi R", n.rocno(), "preklic je zbrisal rocno ponovitev")
        assertNull(n.vzemiShranjeno(), "shranjena je sla mimo rocne")
        n.porabiRocno("drugo besedilo")
        assertEquals("Naredi R", n.rocno())
        n.porabiRocno("  Naredi R ")
        assertNull(n.rocno())
        assertEquals(ShranjenaZapis("Shranjena", "o", t0), n.vzemiShranjeno())
        assertNull(n.vzemiShranjeno(), "shranjena je sla dvakrat")
        // med cakanjem shranjena ne gre (23t)
        val m = NalogaRacunalnika(LaznaIoNaloge()).apply { shrani("S", "o", t0); zacniCakanje(idA, "A", "o", t0) }
        assertNull(m.vzemiShranjeno())
        // vzem rocne: enkrat
        val r = NalogaRacunalnika(LaznaIoNaloge()).apply { nastaviRocno("X") }
        assertEquals("X", r.vzemiRocno()); assertNull(r.vzemiRocno())
    }

    @Test fun `24 CR3 CR6 N2 - preklic po oznaki - dolgovan ustavi prezivi ponovni zagon do potrditve, preklic pred oznako ne`() {
        val io = LaznaIoNaloge()
        val n = NalogaRacunalnika(io)
        n.zacniCakanje(idA, "A", "o", t0)
        assertTrue(n.predOddajo(idA))
        assertEquals(NalogaRacunalnika.Preklic(idA, true), n.preklici(t0 + 10))
        val po = NalogaRacunalnika(LaznaIoNaloge(io.m)) // nov proces
        assertEquals(listOf(idA), po.zaUstavitev(t0 + 20))
        assertTrue(po.dolgujeUstavitev(idA))
        po.ustavitevPotrjena(idA)
        assertEquals(emptyList(), po.zaUstavitev(t0 + 30))
        // preklic pred oznako: nic ni dolgovano, oddaja ne odide
        val m = NalogaRacunalnika(LaznaIoNaloge())
        m.zacniCakanje(idB, "B", "o", t0)
        assertEquals(NalogaRacunalnika.Preklic(idB, false), m.preklici(t0))
        assertFalse(m.predOddajo(idB))
        assertEquals(emptyList(), m.zaUstavitev(t0))
    }

    @Test fun `23t krog 2 N1 in 24 CR10 - obnova po zagonu`() {
        fun s(oddaj: Boolean) = NalogaRacunalnika(LaznaIoNaloge()).apply { zacniCakanje(idA, "A", "odtis-1", t0); if (oddaj) predOddajo(idA) }
        assertIs<NalogaRacunalnika.Obnova.Nadaljuj>(s(true).obnovi("odtis-1", t0 + 5_000, rok))
        s(false).let { assertEquals(NalogaRacunalnika.Obnova.Rok, it.obnovi("odtis-1", t0 + rok + 1, rok)); assertEquals("A", it.rocno()) }
        assertEquals(NalogaRacunalnika.Obnova.Neznan, s(true).obnovi("odtis-1", t0 + 25 * 3_600_000L, rok))
        assertEquals(NalogaRacunalnika.Obnova.Nic("A"), s(false).obnovi("odtis-2", t0 + 5_000, rok))
        assertEquals(NalogaRacunalnika.Obnova.Prazno, NalogaRacunalnika(LaznaIoNaloge()).obnovi("odtis-1", t0, rok))
    }

    @Test fun `zaslon - zastarela nit (preklic ali nova naloga v isti instanci) ne naredi nicesar`() {
        val z = ZaslonNaloge(NalogaRacunalnika(LaznaIoNaloge()))
        val gen = z.zacni(idA, "A", "o", t0)
        assertTrue(z.nitVelja(gen, idA))
        assertEquals(ZaslonNaloge.Sporocilo.PREKLICANO, z.preklici(t0))
        assertNull(z.cakaSejo)
        assertFalse(z.nitVelja(gen, idA))
        assertNull(z.koncaj(gen, idA, NalogaRacunalnika.Konec.Rok(IzidPredaje.ZAGON_ROK), false))
        assertNull(z.naloga.rocno())
        assertNull(z.preklici(t0), "preklic brez cakanja je javil sporocilo")
    }

    // slepi 26t N1, N2: dolgovan /ustavi ne izgine ne zaradi ure nazaj ne po dolgem casu brez racunalnika (nekoncana naloga zivi 24 h)
    @Test fun `slepi N1 N2 - dolg ustavi prezivi uro nazaj in dolgo odsotnost racunalnika`() {
        val io = LaznaIoNaloge()
        val n = NalogaRacunalnika(io)
        n.zacniCakanje(idA, "A", "o", t0)
        assertTrue(n.predOddajo(idA))
        n.preklici(t0 + 10_000)
        assertEquals(listOf(idA), n.zaUstavitev(t0), "ura nazaj: dolg ni ponujen")
        assertEquals(listOf(idA), n.zaUstavitev(t0 + 20_000), "ura nazaj je dolg trajno izbrisala")
        assertEquals(listOf(idA), NalogaRacunalnika(LaznaIoNaloge(io.m)).zaUstavitev(t0 + 2 * 3_600_000L), "dolg je potekel po 1 h")
    }

    // slepi 26t N4: isti id oddata dva zaslona; prvi dobi nedosegljiv (neznan), drugi 202 - drugi mora nalogo spremljati, ne javiti preklica.
    @Test fun `slepi N4 - sprejeta naloga po tujem mestu se spremlja, preklicana ne`() {
        val io = LaznaIoNaloge()
        val z1 = ZaslonNaloge(NalogaRacunalnika(io)); val z2 = ZaslonNaloge(NalogaRacunalnika(io))
        val g1 = z1.zacni(idA, "A", "o", t0)
        assertTrue(z1.naloga.predOddajo(idA))
        val o = z2.naloga.obnovi("o", t0 + 1, rok) as NalogaRacunalnika.Obnova.Nadaljuj
        val g2 = z2.zacni(o.naloga.id, o.naloga.besedilo, o.naloga.odtis, o.naloga.zacetek)
        assertTrue(z2.naloga.predOddajo(idA))
        assertEquals(NalogaRacunalnika.Ukrep.Neznan, z1.koncaj(g1, idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.NEDOSEGLJIV), false))
        assertEquals(NalogaRacunalnika.Ukrep.Spremljaj(idA), z2.koncaj(g2, idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.SPREJETA), false),
            "sprejeto nalogo nihce ne spremlja")
        // preklicana: tuje (ustavitev je dolgovana)
        val m = NalogaRacunalnika(LaznaIoNaloge())
        m.zacniCakanje(idB, "B", "o", t0); assertTrue(m.predOddajo(idB)); m.preklici(t0)
        assertEquals(NalogaRacunalnika.Ukrep.Tuje, m.koncaj(idB, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.SPREJETA), false))
        assertEquals(listOf(idB), m.zaUstavitev(t0))
    }

    // slepi 26t N4 (druga pot): zacetek cakanja druge naloge prepise oznaceno nalogo - ta je preklicana in /ustavi zanjo dolgovan.
    @Test fun `slepi N4 - zacetek cakanja druge naloge preklice prejsnjo`() {
        val n = NalogaRacunalnika(LaznaIoNaloge())
        n.zacniCakanje(idA, "A", "o", t0)
        assertTrue(n.predOddajo(idA))
        n.zacniCakanje(idB, "B", "o", t0)
        assertTrue(idA in n.stanje().preklicani, "prepisana naloga ni preklicana")
        assertEquals(listOf(idA), n.zaUstavitev(t0), "za prepisano oddano nalogo /ustavi ni dolgovan")
        assertFalse(n.predOddajo(idA))
    }

    // slepi 26t krog 2 N1: oba zaslona oddata isti id; prvi dobi 202 in nalogo spremlja, drugi 409 - drugi je ne sme spremljati se enkrat
    @Test fun `slepi K2 N1 - drugi zaslon ne spremlja naloge, ki jo ze spremlja prvi`() {
        val io = LaznaIoNaloge()
        val z1 = ZaslonNaloge(NalogaRacunalnika(io)); val z2 = ZaslonNaloge(NalogaRacunalnika(io))
        val g1 = z1.zacni(idA, "A", "o", t0)
        val o = z2.naloga.obnovi("o", t0 + 1, rok) as NalogaRacunalnika.Obnova.Nadaljuj
        val g2 = z2.zacni(o.naloga.id, o.naloga.besedilo, o.naloga.odtis, o.naloga.zacetek)
        assertTrue(z1.naloga.predOddajo(idA)); assertTrue(z2.naloga.predOddajo(idA))
        assertEquals(NalogaRacunalnika.Ukrep.Spremljaj(idA), z1.koncaj(g1, idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.SPREJETA), false))
        assertEquals(NalogaRacunalnika.Ukrep.Tuje, z2.koncaj(g2, idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.SPREJETA), false),
            "drugi zaslon spremlja isto nalogo (dvojni samodejni odgovori)")
    }

    // slepi 26t krog 2 N7: »Pozabi racunalnik« med oddajo - sprejeta naloga se ne spremlja (ni vec seznanitve)
    @Test fun `slepi K2 N7 - po Pozabi racunalnik sprejeta oddaja ni spremljana`() {
        val io = LaznaIoNaloge()
        val z = ZaslonNaloge(NalogaRacunalnika(io))
        val g = z.zacni(idA, "A", "o", t0)
        assertTrue(z.naloga.predOddajo(idA))
        io.m.clear() // AsistentShramba.pozabi
        assertEquals(NalogaRacunalnika.Ukrep.Tuje, z.koncaj(g, idA, NalogaRacunalnika.Konec.Odgovor(IzidPredaje.SPREJETA), false, seznanjen = false))
    }

    // CRA5: 1001 izbrisov brez racunalnika; racunalnik sprejme najvec 300 na zahtevo (sinhron-telefon.server.ts MEJA_VNOSOV_ZAHTEVE).
    @Test fun `CRA5 - izbrisi gredo v paketih do 300, potrdi se samo poslano, nic se ne izgubi`() {
        val d = DnevnikKlicev(PomnilniskaShramba(), ura = { t0 })
        val vsi = (1..MEJA_IZBRISANIH + 1).map { i ->
            ZapisKlica(id = "klic-$i", casZacetka = t0 - i, stevilka = "+99955501001", trajanjeS = 1, povzetek = "p").also {
                assertTrue(d.dodaj(it)); assertTrue(d.izbrisi(it.id, potrditevUporabnika = true))
            }.id
        }
        val prejeti = LinkedHashSet<String>()
        var zahtev = 0
        while (d.izbrisiZaRacunalnik().isNotEmpty() && zahtev < 10) {
            zahtev++
            assertTrue(SinhronLine.izmenjaj(d, PomnilniskaShramba(), poslji = { telo ->
                val izbrisi = Regex("\"izbrisani\":\\[([^\\]]*)\\]").find(telo)?.groupValues?.get(1).orEmpty()
                    .split(',').filter { it.isNotBlank() }.map { it.trim('"') }
                // racunalnik zavrne zahtevo z vec kot 300 vnosi v seznamu (preveriZahtevo)
                if (izbrisi.size > 300) null else { prejeti += izbrisi; """{"rev":0,"zmoznosti":["izbris-v1"]}""" }
            }), "izmenjava $zahtev ni uspela")
        }
        assertEquals(4, zahtev, "1001 izbrisov ni slo v 4 paketih po najvec 300")
        assertEquals(vsi.toSet(), prejeti, "izbris se je izgubil")
        // racunalnik brez izbris-v1 (ali neuspeh): vrsta ostane cela
        val e = DnevnikKlicev(PomnilniskaShramba(), ura = { t0 })
        val z = ZapisKlica(id = "klic-x", casZacetka = t0, stevilka = "+99955501001", trajanjeS = 1, povzetek = "p")
        assertTrue(e.dodaj(z)); assertTrue(e.izbrisi(z.id, potrditevUporabnika = true))
        SinhronLine.izmenjaj(e, PomnilniskaShramba(), poslji = { """{"rev":0}""" })
        assertEquals(listOf("klic-x"), e.izbrisiZaRacunalnik())
    }
}
