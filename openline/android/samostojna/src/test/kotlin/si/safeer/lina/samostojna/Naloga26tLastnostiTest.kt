package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Naloga 26t, tocka 4: izcrpen preizkus nad VSEMI zaporedji dogodkov (iskanje v sirino z mnozico obiskanih stanj) do meja spodaj.
 * Dogodki: oddaj, preklici, korak niti (oznaka, POST z odgovorom 200/409/503/izgubljen/nedosegljiv), rok, konec niti na glavni niti,
 * smrt zaslona ali procesa (POST na poti dostavljen ali ne), nov zaslon, preveri (obnova), rocna ponovitev, dostava /ustavi.
 * Dva zaslona (dve instanci ZaslonNaloge + NalogaRacunalnika) nad ENO shrambo; nov zaslon bere samo shrambo (kot po smrti procesa).
 *
 * Simulirani zaslon ponovi AsistentKontroler (poslji, prekliciCakanje, cakajNaSejo, koncajCakanje, obnoviCakanje), nit pa vrstni
 * red CakanjeSeje.pocakajInOddaj (preklicano -> rok -> podpis -> preklicano -> rok -> predOddajo -> preklicano -> POST; pripet v
 * podpis/CakanjeSeje26tTest). Lazni racunalnik = lina-0213b asistent-streznik.server.ts: znan id ali grob -> 409 brez izvedbe,
 * /ustavi za neznan id -> 202 + grob, 503 z razlogom zagona pred prevzemom id.
 *
 * Invariante (oracle; POROCILO-26t.md):
 *  I1 Ista logicna naloga (lastnik jo je potrdil enkrat; rocna ponovitev ima novo id) se izvede najvec enkrat.
 *  I2a Preklic pred oznako oddaje: ta id racunalnik nikoli ne izvede.
 *  I2b Preklic po oznaki: izveden id je ustavljen ali pa je /ustavi zanj se dolgovan v SHRAMBI (prezivi smrt procesa).
 *  I3 Vsaka potrjena naloga je: spremljana, lastnik je dobil sporocilo, preklical jo je lastnik, je v mestu rocne ponovitve,
 *     caka v shrambi ali jo obdeluje nit.
 */
class Naloga26tLastnostiTest {
    private companion object {
        const val T0 = 1_800_000_000_000L
        const val ODTIS = "odtis-1"
        /** Vec kot toliko stanj = meje so prevelike za reden tek (ne »nic ni najdeno«). */
        const val NAJVEC_STANJ = 2_500_000
    }

    enum class Faza { CAKA, OZNACENA, KONEC }
    enum class Post { OK, IZGUBLJEN, NEDOSEGLJIV, ZAGON }

    class Nit(val id: String, val besedilo: String, val gen: Int, val klepet: Boolean = false, val zacetek: Long = T0) {
        var faza = Faza.CAKA
        var oznaka: Boolean? = null
        var konec: NalogaRacunalnika.Konec? = null
        fun kopija() = Nit(id, besedilo, gen, klepet, zacetek).also { it.faza = faza; it.oznaka = oznaka; it.konec = konec }
    }

    class Zaslon(val z: ZaslonNaloge) {
        /** Nov zaslon (zasuk, ponovni zagon): bere samo shrambo, kot init v AsistentKontroler. */
        constructor(io: ShrambaNalogeIo) : this(ZaslonNaloge(NalogaRacunalnika(io))) { z.naloga.preberiInPopravi() }
        val niti = mutableListOf<Nit>()
        var sledi: String? = null
        /** Prva oddaja je na poti (poslji: preklic in porabi rocno sta ze bila, 503 odpira se pride): id, besedilo, klepet. */
        var prva: Triple<String, String, Boolean>? = null
        fun kopija(io: ShrambaNalogeIo) = Zaslon(z.kopija(NalogaRacunalnika(io))).also { k -> k.niti += niti.map { it.kopija() }; k.sledi = sledi; k.prva = prva }
    }

    sealed class Ev {
        data class Oddaj(val zaslon: Int, val klepet: Boolean) : Ev()
        /** Prva oddaja dobi 503 odpira: cakajNaSejo (vmes lahko drug zaslon zacne cakati - slepi 26t krog 2 N2). */
        data class Prva(val zaslon: Int) : Ev()
        data class Preklici(val zaslon: Int) : Ev()
        data class Oznaci(val zaslon: Int, val nit: Int) : Ev()
        data class Poslji(val zaslon: Int, val nit: Int, val post: Post) : Ev()
        data class RokNiti(val zaslon: Int, val nit: Int) : Ev()
        data class Koncaj(val zaslon: Int, val nit: Int) : Ev()
        data class Smrt(val zaslon: Int, val dostavljeno: Boolean) : Ev()
        object NovZaslon : Ev()
        data class Preveri(val zaslon: Int) : Ev()
        data class Ponovi(val zaslon: Int) : Ev()
        data class Ustavi(val id: String) : Ev()
        /** Ura se premakne (enkrat): naprej cez rok cakanja, naprej 2 h ali nazaj 5 s. */
        data class Ura(val ms: Long) : Ev()
    }

    /** Meje iskanja: logicnih nalog, rocnih ponovitev, hkrati odprtih zaslonov, smrti (zasuk ali smrt procesa). */
    data class Meje(val naloge: Int, val ponovitve: Int, val zasloni: Int, val smrti: Int, val klepet: Boolean = true,
                    val ure: List<Long> = listOf(T0 + Svet.CAKANJE_MS + 1, T0 + 2 * 3_600_000L, T0 - 5_000))

    class Svet(val meje: Meje, val io: LaznaIoNaloge = LaznaIoNaloge(), zacetni: List<Zaslon?>? = null) {
        val zasloni: MutableList<Zaslon?> = (zacetni ?: listOf(Zaslon(io))).toMutableList()
        val pot = mutableListOf<Ev>()

        fun kopija(): Svet {
            val nio = LaznaIoNaloge(io.m)
            return Svet(meje, nio, zasloni.map { it?.kopija(nio) }).also { k ->
                k.pot += pot
                k.sprejeti += sprejeti; k.ustavljeni += ustavljeni; k.grob += grob; k.oznaka += oznaka; k.potrjene += potrjene
                k.spremljane += spremljane; k.sporocene += sporocene; k.preklicane += preklicane
                k.preklicPredOznako += preklicPredOznako; k.preklicPoOznaki += preklicPoOznaki; k.oznaceni += oznaceni; k.izgubljenaPrva += izgubljenaPrva
                k.cas = cas; k.uraPremaknjena = uraPremaknjena; k.nalog = nalog; k.idjev = idjev; k.smrti = smrti; k.ponovitev = ponovitev; k.odprtih = odprtih
            }
        }
        // racunalnik
        val sprejeti = mutableSetOf<String>()
        val ustavljeni = mutableSetOf<String>()
        val grob = mutableSetOf<String>()
        // knjigovodstvo
        val oznaka = mutableMapOf<String, String>() // id -> logicna naloga
        val potrjene = mutableSetOf<String>()
        val spremljane = mutableSetOf<String>()
        val sporocene = mutableSetOf<String>()
        val preklicane = mutableSetOf<String>()
        val preklicPredOznako = mutableSetOf<String>()
        val preklicPoOznaki = mutableSetOf<String>()
        /** Id, za katere je predOddajo vrnil true (neodvisno od stevca oddaj v stroju). */
        val oznaceni = mutableSetOf<String>()
        val izgubljenaPrva = mutableSetOf<String>()
        var cas = T0
        var uraPremaknjena = false
        var nalog = 0; var idjev = 0; var smrti = 0; var ponovitev = 0; var odprtih = 1

        private val stroj get() = NalogaRacunalnika(io)

        private fun besedilo(naloga: String) = "Naredi $naloga"
        private fun nalogaBesedila(b: String) = b.removePrefix("Naredi ")

        /** AsistentKontroler.poslji: preklic cakanja, porabi rocno, prva oddaja dobi 503 odpira -> cakajNaSejo. */
        private fun oddaj(zi: Int, naloga: String, klepet: Boolean) {
            val zs = zasloni[zi]!!
            preklici(zs)
            zs.z.naloga.porabiRocno(besedilo(naloga))
            val id = "id-${naloga}-${++idjev}"
            oznaka[id] = naloga
            potrjene += naloga
            zs.prva = Triple(id, besedilo(naloga), klepet)
        }

        /** 503 odpira na prvo oddajo -> cakajNaSejo. Cakajoca drugega zaslona, ki jo zacetek zamenja, je preklicana (kot nova naloga). */
        private fun prva(zi: Int) {
            val zs = zasloni[zi]!!
            val (id, b, klepet) = zs.prva!!
            zs.prva = null
            val pred = zs.z.naloga.stanje().cakajoca
            if (pred != null && pred.id != id) {
                preklicane += oznaka.getValue(pred.id)
                if (pred.id in oznaceni) preklicPoOznaki += pred.id else preklicPredOznako += pred.id
            }
            val gen = zs.z.zacni(id, b, ODTIS, cas)
            zs.niti += Nit(id, b, gen, klepet, cas)
        }

        /** AsistentKontroler.prekliciCakanje (PREPOZNO -> posljiUstavitve: dostava je dogodek Ustavi). */
        private fun preklici(zs: Zaslon) {
            val pred = zs.z.naloga.stanje().cakajoca
            val s = zs.z.preklici(cas)
            if (pred != null) {
                val n = oznaka.getValue(pred.id)
                preklicane += n
                if (pred.id in oznaceni) preklicPoOznaki += pred.id else preklicPredOznako += pred.id
            }
            if (s != null && pred == null) Unit // drug zaslon je ze preklical: samo sporocilo
        }

        /** AsistentKontroler.obnoviCakanje (posljiShranjeno ob dosegljivem racunalniku). */
        private fun preveri(zi: Int) {
            val zs = zasloni[zi]!!
            if (zs.z.cakaSejo != null || zs.sledi != null) return
            val pred = zs.z.naloga.stanje().cakajoca?.let { oznaka.getValue(it.id) }
            when (val o = zs.z.naloga.obnovi(ODTIS, cas, CAKANJE_MS)) {
                NalogaRacunalnika.Obnova.Prazno -> Unit
                is NalogaRacunalnika.Obnova.Nadaljuj -> {
                    val gen = zs.z.zacni(o.naloga.id, o.naloga.besedilo, o.naloga.odtis, o.naloga.zacetek)
                    zs.niti += Nit(o.naloga.id, o.naloga.besedilo, gen)
                }
                NalogaRacunalnika.Obnova.Rok, NalogaRacunalnika.Obnova.Neznan -> sporocene += pred!!
                is NalogaRacunalnika.Obnova.Nic -> sporocene += nalogaBesedila(o.besedilo)
            }
        }

        /** Preklicano v niti (CakanjeSeje.Odvisnosti.preklicano v AsistentKontroler). */
        private fun preklicano(zs: Zaslon, n: Nit) = n.oznaka == false || !zs.z.nitVelja(n.gen, n.id) ||
            !CakajocaNaloga.smePoslati(ODTIS, ODTIS, n.zacetek, cas)

        fun uporabi(e: Ev) {
            pot += e
            when (e) {
                is Ev.Oddaj -> oddaj(e.zaslon, "N${++nalog}", e.klepet)
                is Ev.Prva -> prva(e.zaslon)
                is Ev.Preklici -> preklici(zasloni[e.zaslon]!!)
                is Ev.Oznaci -> {
                    val zs = zasloni[e.zaslon]!!; val n = zs.niti[e.nit]
                    // seja odprta: preklicano -> rok -> (podpis) -> preklicano -> rok -> predOddajo -> preklicano
                    if (preklicano(zs, n)) { n.faza = Faza.KONEC; n.konec = NalogaRacunalnika.Konec.Preklicano; return }
                    n.oznaka = zs.z.naloga.predOddajo(n.id)
                    if (n.oznaka == true) oznaceni += n.id
                    if (preklicano(zs, n)) { n.faza = Faza.KONEC; n.konec = NalogaRacunalnika.Konec.Preklicano; return }
                    n.faza = Faza.OZNACENA
                }
                is Ev.Poslji -> {
                    val zs = zasloni[e.zaslon]!!; val n = zs.niti[e.nit]
                    val izid = post(n.id, e.post)
                    n.faza = Faza.KONEC; n.konec = NalogaRacunalnika.Konec.Odgovor(izid)
                    // po odgovoru: ustaviPoPreklicu + dolgujeUstavitev -> posljiUstavitve (dostava = dogodek Ustavi)
                }
                is Ev.RokNiti -> { val n = zasloni[e.zaslon]!!.niti[e.nit]; n.faza = Faza.KONEC; n.konec = NalogaRacunalnika.Konec.Rok(PredajaNaloge.izidRoka(null)) }
                is Ev.Koncaj -> {
                    val zs = zasloni[e.zaslon]!!; val n = zs.niti.removeAt(e.nit)
                    val naloga = oznaka.getValue(n.id)
                    when (val u = zs.z.koncaj(n.gen, n.id, n.konec!!, sKlepetom = n.klepet, seznanjen = true)) {
                        // zastarela nit ali tuje mesto: sporocilo »preklicano« ne steje za sporocilo O TEJ nalogi (I3 mora drzati brez njega)
                        null, NalogaRacunalnika.Ukrep.Tuje -> Unit
                        is NalogaRacunalnika.Ukrep.Spremljaj -> { zs.sledi = n.id; spremljane += naloga }
                        else -> sporocene += naloga
                    }
                }
                is Ev.Smrt -> {
                    val zs = zasloni[e.zaslon]!!
                    smrti++
                    // POST na poti (oznacena nit): racunalnik ga je prejel ali ne
                    if (e.dostavljeno) zs.niti.filter { it.faza == Faza.OZNACENA }.forEach { post(it.id, Post.IZGUBLJEN) }
                    // prva oddaja na poti nima trajnega zapisa (slepi 26t N10, obstojece, NI popravljeno): smrt jo izgubi - izvzeta iz I3
                    zs.prva?.let { izgubljenaPrva += oznaka.getValue(it.first) }
                    zasloni[e.zaslon] = null
                }
                Ev.NovZaslon -> { odprtih++; val i = zasloni.indexOf(null); if (i >= 0) zasloni[i] = Zaslon(io) else zasloni += Zaslon(io) }
                is Ev.Preveri -> preveri(e.zaslon)
                is Ev.Ponovi -> {
                    val zs = zasloni[e.zaslon]!!
                    val b = zs.z.naloga.vzemiRocno() ?: return
                    ponovitev++
                    // lastnik poslje besedilo iz vnosa: ista logicna naloga, nov id
                    val naloga = nalogaBesedila(b)
                    preklici(zs)
                    zs.z.naloga.porabiRocno(b)
                    val id = "id-${naloga}-${++idjev}"
                    oznaka[id] = naloga
                    zs.prva = Triple(id, b, false)
                }
                is Ev.Ustavi -> {
                    if (e.id in sprejeti) ustavljeni += e.id else grob += e.id
                    stroj.ustavitevPotrjena(e.id)
                }
                is Ev.Ura -> { uraPremaknjena = true; cas = e.ms }
            }
        }

        /** Lazni racunalnik (lina-0213b): vrne izid ponovne oddaje kot AsistentKontroler.koncajCakanje (PredajaNaloge.izidPonovne). */
        private fun post(id: String, p: Post): IzidPredaje {
            val znan = id in sprejeti || id in grob
            return when (p) {
                Post.NEDOSEGLJIV -> PredajaNaloge.izidPonovne(false, true, null, null)
                Post.OK -> { if (!znan) sprejeti += id; PredajaNaloge.izidPonovne(true, false, null, null) }
                Post.IZGUBLJEN -> { if (!znan) sprejeti += id; PredajaNaloge.izidPonovne(false, false, 0, null) }
                // 503 z razlogom zagona samo za neznan id (racunalnik preveri id pred sejo); znan dobi 409 -> sprejeta
                Post.ZAGON -> if (znan) PredajaNaloge.izidPonovne(true, false, null, null) else PredajaNaloge.izidPonovne(false, false, 503, "izklopljeno")
            }
        }

        fun dogodki(): List<Ev> {
            val ev = mutableListOf<Ev>()
            val st = stroj.stanje()
            zasloni.forEachIndexed { zi, zs ->
                if (zs == null) return@forEachIndexed
                if (zs.prva != null) ev += Ev.Prva(zi)
                if (nalog < meje.naloge && zs.sledi == null && zs.prva == null) { ev += Ev.Oddaj(zi, false); if (meje.klepet) ev += Ev.Oddaj(zi, true) }
                if (zs.sledi == null) ev += Ev.Preklici(zi)
                zs.niti.forEachIndexed { ni, n ->
                    when (n.faza) {
                        // rok niti tece od njenega zacetka: lahko pride kadar koli pred oznako
                        Faza.CAKA -> { ev += Ev.Oznaci(zi, ni); ev += Ev.RokNiti(zi, ni) }
                        Faza.OZNACENA -> Post.entries.forEach { ev += Ev.Poslji(zi, ni, it) }
                        Faza.KONEC -> ev += Ev.Koncaj(zi, ni)
                    }
                }
                if (smrti < meje.smrti) { ev += Ev.Smrt(zi, false); if (zs.niti.any { it.faza == Faza.OZNACENA }) ev += Ev.Smrt(zi, true) }
                ev += Ev.Preveri(zi)
                if (ponovitev < meje.ponovitve && st.rocno != null && zs.sledi == null && zs.prva == null) ev += Ev.Ponovi(zi)
            }
            if (zasloni.count { it != null } < meje.zasloni && odprtih < meje.zasloni + meje.smrti) ev += Ev.NovZaslon
            // kot AsistentKontroler.posljiUstavitve: dolgovi samo prek zaUstavitev (slepi 26t N1/N2: ta klic je bil zunaj prostora)
            stroj.zaUstavitev(cas).forEach { ev += Ev.Ustavi(it) }
            if (!uraPremaknjena) for (ms in meje.ure) ev += Ev.Ura(ms)
            return ev
        }

        fun odtis(): String = buildString {
            append(io.m[NalogaRacunalnika.KLJUC]).append('|').append(sprejeti.sorted()).append(ustavljeni.sorted()).append(grob.sorted())
            append(potrjene.sorted()).append(spremljane.sorted()).append(sporocene.sorted()).append(preklicane.sorted())
            append(preklicPredOznako.sorted()).append(preklicPoOznaki.sorted())
            append(cas).append(oznaceni.sorted()).append(izgubljenaPrva.sorted()).append(nalog).append(idjev).append(smrti).append(ponovitev).append(odprtih)
            for (zs in zasloni) {
                if (zs == null) { append("[x]"); continue }
                append("[").append(zs.z.cakaSejo).append(zs.sledi).append(zs.prva)
                for (n in zs.niti) append("(").append(n.id).append(n.klepet).append(n.zacetek).append(n.faza).append(n.gen == zs.z.generacija()).append(n.oznaka).append(n.konec).append(")")
                append("]")
            }
        }

        fun preveriInvariante(pot: List<Ev>) {
            val izvedene = sprejeti.groupBy { oznaka.getValue(it) }
            for ((n, ids) in izvedene) if (ids.size > 1) fail("I1: naloga $n izvedena ${ids.size}x ($ids) po $pot")
            for (id in preklicPredOznako) if (id in sprejeti) fail("I2a: preklicana pred oznako $id izvedena po $pot")
            val dolg = stroj.stanje().zaUstaviti.map { it.id }.toSet()
            for (id in preklicPoOznaki) if (id in sprejeti && id !in ustavljeni && id !in dolg) fail("I2b: $id izvedena, /ustavi ni dolgovan po $pot")
            // I4 (slepi 26t krog 2 N1): isto nalogo spremlja najvec en zaslon (sicer dvojni samodejni odgovori)
            val sledi = zasloni.mapNotNull { it?.sledi }
            if (sledi.size != sledi.toSet().size) fail("I4: dva zaslona spremljata isto nalogo $sledi po $pot")
            val st = stroj.stanje()
            val zive = zasloni.filterNotNull().flatMap { z -> z.niti.map { oznaka.getValue(it.id) } + listOfNotNull(z.prva?.let { oznaka.getValue(it.first) }) }.toSet()
            val cakajoca = st.cakajoca?.let { oznaka.getValue(it.id) }
            val rocna = st.rocno?.let { nalogaBesedila(it) }
            for (n in potrjene) if (n !in izgubljenaPrva && n !in spremljane && n !in sporocene && n !in preklicane && n != rocna && n != cakajoca && n !in zive)
                fail("I3: naloga $n je izginila brez sporocila po $pot")
        }

        companion object { const val CAKANJE_MS = 180_000L }
    }

    /** 64-bitni FNV-1a odtis stanja (mnozica obiskanih ostane majhna). */
    private fun h(s: String): Long {
        var x = -0x340d631b7bdddcdbL
        for (c in s) { x = x xor c.code.toLong(); x *= 0x100000001b3L }
        return x
    }

    private fun isci(meje: Meje): Int {
        val obiskana = HashSet<Long>()
        val sklad = ArrayDeque<Svet>()
        val zacetek = Svet(meje)
        obiskana += h(zacetek.odtis())
        sklad += zacetek
        var stanj = 0
        while (sklad.isNotEmpty()) {
            val s = sklad.removeLast()
            if (++stanj > NAJVEC_STANJ) fail("meje $meje: vec kot $NAJVEC_STANJ stanj - zmanjsaj meje (iskanje ni koncano)")
            for (e in s.dogodki()) {
                val n = s.kopija()
                n.uporabi(e)
                if (obiskana.add(h(n.odtis()))) { n.preveriInvariante(n.pot); sklad += n }
            }
        }
        println("Naloga26tLastnostiTest: meje $meje, raziskanih stanj $stanj (vsa)")
        // kontrola: iskanje je res raziskalo prostor (prazen ali skoraj prazen prostor ne dokaze nicesar)
        assertTrue(stanj > 1_000, "raziskanih le $stanj stanj")
        return stanj
    }

    // Vsaka konfiguracija je izcrpna (vsa dosegljiva stanja); skupaj pokrijejo dva zaslona + rocno ponovitev (dvojna izvedba istega id,
    // 1. tek je tu nasel napako) in dve smrti z dvema nalogama (preklic z novo nalogo, dolgovan /ustavi cez dve smrti).
    @Test fun `dva zaslona, ena naloga in rocna ponovitev, ena smrt`() { isci(Meje(naloge = 1, ponovitve = 1, zasloni = 2, smrti = 1)) }

    @Test fun `en zaslon, dve nalogi in rocna ponovitev, dve smrti`() { isci(Meje(naloge = 2, ponovitve = 1, zasloni = 1, smrti = 2)) }

    @Test fun `dva zaslona, ena naloga in rocna ponovitev, dve smrti`() { isci(Meje(naloge = 1, ponovitve = 1, zasloni = 2, smrti = 2)) }

    // najvecji prostor: brez klepeta in brez premikov ure (oboje imajo ostale tri konfiguracije; dve od njih z dvema zaslonoma)
    @Test fun `dva zaslona, dve nalogi, ena smrt`() {
        isci(Meje(naloge = 2, ponovitve = 0, zasloni = 2, smrti = 1, klepet = false, ure = emptyList()))
    }
}
