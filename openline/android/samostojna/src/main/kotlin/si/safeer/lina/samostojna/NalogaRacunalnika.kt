package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.atomic.AtomicInteger

/**
 * Naloga 26t: celotno stanje naloge za Claude Code na telefonu v ENEM zapisu (en kljuc, verzija) in en stroj stanj. Prej je bilo
 * stanje razmetano po sedmih kljucih v AsistentKontroler (modul app, brez preizkusov vedenja) in vsak krog pregleda je nasel novo
 * dirko (naloga 23t, 24, CodeRabbit a2). Tu so vsi prehodi pod enim zaklepom procesa (vec zaslonov DialerActivity deli shrambo);
 * app samo klice prehode in izvede ucinke (omrezje, besedila).
 *
 * Invariante (preizkus lastnosti Naloga26tLastnostiTest):
 * 1. Ista naloga (ki jo je lastnik potrdil enkrat) se na racunalniku ne izvede dvakrat - tudi ne kot rocna ponovitev z novim id.
 * 2. Preklic pred oznako oddaje: naloga ne pride do racunalnika. Preklic po oznaki: /ustavi je dolgovan, zapisan v shrambi (prezivi
 *    smrt procesa), dokler ga racunalnik ne sprejme; lastnik izve, da je bila morda ze oddana.
 * 3. Nobena naloga ne izgine brez sporocila lastniku ali mesta za rocno ponovitev.
 */
@Serializable
data class CakajocaZapis(
    val id: String,
    val besedilo: String,
    val odtis: String? = null,
    val zacetek: Long,
    /** Stevilo zacetih ponovnih oddaj tega id (vsaka zapisana pod zaklepom PRED POST). 0 = racunalnik naloge zagotovo nima. */
    val oddaj: Int = 0,
)

@Serializable
data class ShranjenaZapis(val besedilo: String, val odtis: String? = null, val cas: Long)

@Serializable
data class UstavitevZapis(val id: String, val cas: Long)

@Serializable
data class StanjeNaloge(
    val v: Int = NalogaRacunalnika.VERZIJA,
    /** Potrjena naloga, ki caka, da Lina na racunalniku odpre Claude Code (prej Z_ID, Z_BESEDILO, Z_ODTIS, Z_CAS, Z_ODDANO). */
    val cakajoca: CakajocaZapis? = null,
    /** Besedilo za rocno ponovitev (prej Z_ROCNO): racunalnik je zagotovo nima; vzame jo samo lastnik (vnos v zavihku Racunalnik). */
    val rocno: String? = null,
    /** »Shrani za pozneje« iz klepeta (prej besedilo, odtis, cas). */
    val shranjena: ShranjenaZapis? = null,
    /** Zadnji preklicani id (prej Z_PREKLIC). */
    val preklicani: List<String> = emptyList(),
    /** Preklicane naloge, ki so bile morda oddane: /ustavi se poslje znova (tudi po ponovnem zagonu), dokler ga racunalnik ne sprejme. */
    val zaUstaviti: List<UstavitevZapis> = emptyList(),
    /** Zadnja naloga, ki jo ze spremlja kak zaslon (slepi 26t krog 2 N1: drugi zaslon je ne spremlja se enkrat). */
    val spremljana: String? = null,
)

/** Dostop do shrambe (SharedPreferences v app, lazna v preizkusih). [vse] je cel zapis (prefs.all), da staro obliko beremo strpno. */
interface ShrambaNalogeIo {
    fun vse(): Map<String, *>
    /** En zapis: [json] pod KLJUC (null = odstrani) in odstranitev [odstrani]; true samo, ce je zapis trajen (commit). */
    fun zapisi(json: String?, odstrani: Collection<String>): Boolean
}

class NalogaRacunalnika(private val io: ShrambaNalogeIo) {
    data class Branje(val stanje: StanjeNaloge, val izStarih: Boolean, val pokvarjen: Boolean)

    /** Preklic: [oddana] = oddaja je bila morda na poti (dolgovan /ustavi). */
    data class Preklic(val id: String, val oddana: Boolean)

    /** Kako se je koncala nit cakanja (CakanjeSeje.Izid, preveden v app). */
    sealed class Konec {
        /** Ponovna oddaja je dobila odgovor; [izid] = PredajaNaloge.izidPonovne. */
        data class Odgovor(val izid: IzidPredaje) : Konec()
        /** Rok brez odprte seje; [izid] = PredajaNaloge.izidRoka. */
        data class Rok(val izid: IzidPredaje) : Konec()
        object BrezPodpisa : Konec()
        /** Racunalnik ni vec isti (drug, pozabljen) ali potekel rok shranjene. */
        object Preklicano : Konec()
    }

    sealed class Ukrep {
        /** Mesto ni vec te naloge (preklic ali nova naloga na drugem zaslonu, Pozabi): nic ne pisi, samo »preklicano«. */
        object Tuje : Ukrep()
        data class Spremljaj(val id: String) : Ukrep()
        /** Racunalnik jo je morda sprejel: sporocilo »izid neznan«, brez ponovitve. */
        object Neznan : Ukrep()
        /** Racunalnik je zagotovo nima: besedilo je v mestu za rocno ponovitev; [izid] za sporocilo. */
        data class Rocno(val izid: IzidPredaje) : Ukrep()
        /** Napaka brez ponovitve (403, 429 ...) ali nedosegljiv s klepetom (klepet ponudi »shrani za pozneje«). */
        data class Napaka(val izid: IzidPredaje) : Ukrep()
        object Preklicano : Ukrep()
    }

    sealed class Obnova {
        object Prazno : Obnova()
        data class Nadaljuj(val naloga: CakajocaZapis) : Obnova()
        /** Rok je potekel, oddaje ni bilo: besedilo je za rocno ponovitev. */
        object Rok : Obnova()
        object Neznan : Obnova()
        /** Drug ali pozabljen racunalnik: ne odide; [besedilo] za sporocilo. */
        data class Nic(val besedilo: String) : Obnova()
    }

    companion object {
        const val VERZIJA = 1
        const val KLJUC = "naloga_v1"
        /** Kljuci pred nalogo 26t: preberejo se strpno (CRA2: z_oddano je bil v c5b10d1/40466a4 Boolean) in se ob prvem zapisu odstranijo. */
        val STARI_KLJUCI = listOf("z_id", "z_besedilo", "z_odtis", "z_cas", "z_oddano", "z_rocno", "z_preklic", "besedilo", "odtis", "cas")
        const val NAJVEC_USTAVITEV = 20
        /** En zaklep procesa za vse prehode (in AsistentShramba.pozabi): vec zaslonov in niti deli eno shrambo. */
        val ZAKLEP = Any()
        // slepi 26t N3: encodeDefaults, sicer se verzija (privzeta vrednost) ne zapise in prihodnja v2 ni locljiva od v1
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        fun beri(vse: Map<String, *>): Branje {
            val j = vse[KLJUC]
            if (j != null) {
                val s = (j as? String)?.let { runCatching { json.decodeFromString<StanjeNaloge>(it) }.getOrNull() }
                // neznana verzija (vrnitev na starejso aplikacijo) ali pokvarjen zapis: ne sesuj se, lastnik dobi sporocilo
                return if (s != null && s.v == VERZIJA) Branje(s, false, false) else Branje(StanjeNaloge(), false, true)
            }
            val izStarih = STARI_KLJUCI.any { vse.containsKey(it) }
            return Branje(if (izStarih) izStarih(vse) else StanjeNaloge(), izStarih, false)
        }

        private fun niz(vse: Map<String, *>, k: String) = vse[k] as? String

        private fun izStarih(vse: Map<String, *>): StanjeNaloge {
            val id = niz(vse, "z_id")
            val besedilo = niz(vse, "z_besedilo")
            // CRA2: oznaka oddaje je bila Boolean (true = oddaja te naloge morda na poti) ali id naloge; drugo = ni oznake
            val oddano = when (val o = vse["z_oddano"]) {
                is Boolean -> o
                is String -> id != null && o == id
                else -> false
            }
            val zacetek = (vse["z_cas"] as? Number)?.toLong() ?: 0L
            var rocno = niz(vse, "z_rocno")
            val cakajoca = when {
                besedilo == null -> null
                id != null -> CakajocaZapis(id, besedilo, niz(vse, "z_odtis"), zacetek, if (oddano) 1 else 0)
                // brez id (ni je mogel oddati z id): ne izgubi je, lastnik jo poslje sam
                else -> { if (rocno == null) rocno = besedilo; null }
            }
            val shranjena = niz(vse, "besedilo")?.let { ShranjenaZapis(it, niz(vse, "odtis"), (vse["cas"] as? Number)?.toLong() ?: 0L) }
            val preklicani = niz(vse, "z_preklic").orEmpty().split(',').filter { it.isNotEmpty() }
            return StanjeNaloge(cakajoca = cakajoca, rocno = rocno, shranjena = shranjena, preklicani = preklicani)
        }

        fun dodajPreklic(seznam: List<String>, id: String, najvec: Int = 20): List<String> =
            (seznam.filter { it != id } + id).takeLast(najvec)
    }

    /** Vse spremembe stanja: branje, prehod in zapis pod enim zaklepom procesa. [f] vrne novo stanje in rezultat. */
    private fun <T> spremeni(f: (StanjeNaloge) -> Pair<StanjeNaloge, T>): Pair<T, Boolean> = synchronized(ZAKLEP) {
        val b = beri(io.vse())
        val (novo, r) = f(b.stanje)
        val zapisano = if (novo != b.stanje || b.izStarih || b.pokvarjen) {
            val prazno = novo == StanjeNaloge()
            runCatching { io.zapisi(if (prazno) null else json.encodeToString(novo), STARI_KLJUCI) }.getOrDefault(false)
        } else true
        r to zapisano
    }

    fun stanje(): StanjeNaloge = synchronized(ZAKLEP) { beri(io.vse()).stanje }

    /** Ob zagonu: pokvarjen ali neznan zapis se pocisti (true = lastnik dobi sporocilo); stara oblika se prepise v novo. */
    fun preberiInPopravi(): Boolean = synchronized(ZAKLEP) {
        val b = beri(io.vse())
        if (b.pokvarjen || b.izStarih) runCatching { io.zapisi(if (b.stanje == StanjeNaloge()) null else json.encodeToString(b.stanje), STARI_KLJUCI) }
        b.pokvarjen
    }

    /** Prva oddaja je dobila 503 odpira: naloga caka na sejo. Isti id (obnova) ohrani stevec oddaj, nova naloga zacne pri 0. */
    fun zacniCakanje(id: String, besedilo: String, odtis: String?, zacetek: Long): Boolean = spremeni { s ->
        val prej = s.cakajoca
        val oddaj = prej?.takeIf { it.id == id }?.oddaj ?: 0
        // slepi 26t N4: druga naloga (drug zaslon je medtem zacel cakati) se ne prepise tiho - je preklicana, za oddano je /ustavi dolgovan
        val b = if (prej != null && prej.id != id) preklicano(s, prej, zacetek) else s
        b.copy(cakajoca = CakajocaZapis(id, besedilo, odtis, zacetek, oddaj)) to true
    }.second

    private fun preklicano(s: StanjeNaloge, c: CakajocaZapis, zdaj: Long): StanjeNaloge {
        val zaUstaviti = if (c.oddaj > 0) (s.zaUstaviti.filter { it.id != c.id } + UstavitevZapis(c.id, zdaj)).takeLast(NAJVEC_USTAVITEV) else s.zaUstaviti
        return s.copy(cakajoca = null, preklicani = dodajPreklic(s.preklicani, c.id), zaUstaviti = zaUstaviti)
    }

    /**
     * CRA4: tik pred POST ponovne oddaje - pod zaklepom preveri, da mesto se pripada TEJ nalogi in da ni preklicana, in zapise oznako.
     * false = ne oddaj (preklic, nova naloga, ali oznake ni bilo mogoce trajno zapisati - brez nje bi se lahko izvedla dvakrat).
     */
    fun predOddajo(id: String): Boolean {
        val (sme, zapisano) = spremeni { s ->
            val c = s.cakajoca
            if (c == null || c.id != id || id in s.preklicani) s to false else s.copy(cakajoca = c.copy(oddaj = c.oddaj + 1)) to true
        }
        return sme && zapisano
    }

    /** Lastnik preklice (Ustavi) ali da drugo nalogo. Rocna ponovitev in shranjena ostaneta. */
    fun preklici(zdaj: Long): Preklic? = spremeni { s ->
        val c = s.cakajoca ?: return@spremeni s to null
        preklicano(s, c, zdaj) to Preklic(c.id, c.oddaj > 0)
    }.first

    /**
     * Dolgovane ustavitve; nit oddaje jih po odgovoru in app ob dosegljivem racunalniku poslje. Samo branje: dolg izgine SAMO s potrditvijo
     * racunalnika (slepi 26t N1: ura nazaj ga je brisala; N2: rok 1 h, racunalnik pa nekoncano nalogo hrani 24 h).
     */
    @Suppress("UNUSED_PARAMETER")
    fun zaUstavitev(zdaj: Long): List<String> = stanje().zaUstaviti.map { it.id }

    /** Racunalnik je /ustavi sprejel (202). */
    fun ustavitevPotrjena(id: String) {
        spremeni { s -> s.copy(zaUstaviti = s.zaUstaviti.filter { it.id != id }) to Unit }
    }

    /** Ali je za [id] dolgovan /ustavi (nit oddaje po odgovoru preklicane naloge). */
    fun dolgujeUstavitev(id: String): Boolean = stanje().zaUstaviti.any { it.id == id }

    /**
     * Konec niti cakanja (glavna nit). Racunalnik nalogo zagotovo nima samo, ce ni bilo nobene oddaje ali je ta oddaja dobila odgovor
     * pred prevzemom id (503 z razlogom zagona: asistent-streznik.server.ts preveri id pred sejo). NEDOSEGLJIV ponovne oddaje po
     * prejsnji oddaji istega id (CRA1: drug zaslon ali proces) je NEZNAN.
     */
    fun koncaj(id: String, konec: Konec, sKlepetom: Boolean, seznanjen: Boolean = true): Ukrep = spremeni { s ->
        val c = s.cakajoca
        if (c == null || c.id != id) {
            // slepi 26t N4: mesto je medtem pocistil drug zaslon (npr. njegov poskus je dobil neznan izid), ta poskus pa je racunalnik
            // sprejel: naloga ni preklicana, zato jo ta zaslon spremlja (ali javi neznan izid), ne javi »preklicano«
            // Krog 2: ne, ce jo ze spremlja drug zaslon (N1) ali je lastnik medtem pozabil racunalnik (N7, [seznanjen] = false)
            val prosta = id !in s.preklicani && id != s.spremljana && seznanjen
            val i = (konec as? Konec.Odgovor)?.izid
            return@spremeni when {
                prosta && i == IzidPredaje.SPREJETA -> s.copy(spremljana = id) to Ukrep.Spremljaj(id)
                prosta && i == IzidPredaje.NEZNAN -> s to Ukrep.Neznan
                else -> s to Ukrep.Tuje
            }
        }
        val brez = s.copy(cakajoca = null)
        val rocno = brez.copy(rocno = c.besedilo)
        when (konec) {
            is Konec.Odgovor -> when (val i = konec.izid) {
                IzidPredaje.SPREJETA -> brez.copy(spremljana = id) to Ukrep.Spremljaj(id)
                IzidPredaje.NEZNAN -> brez to Ukrep.Neznan
                // CRA1 in preizkus lastnosti: odgovor velja samo za TA poskus; ce je bil zacet se drug (drug zaslon ali proces, morda se
                // na poti), racunalnik nalogo morda ima - brez rocne ponovitve (nov id bi jo izvedel dvakrat) in brez »shrani za pozneje«
                IzidPredaje.NEDOSEGLJIV, in ZAGON -> when {
                    c.oddaj > 1 -> brez to Ukrep.Neznan
                    i == IzidPredaje.NEDOSEGLJIV && sKlepetom -> brez to Ukrep.Napaka(i)
                    else -> rocno to Ukrep.Rocno(i)
                }
                else -> brez to Ukrep.Napaka(i)
            }
            is Konec.Rok -> if (c.oddaj > 0) brez to Ukrep.Neznan else rocno to Ukrep.Rocno(konec.izid)
            Konec.BrezPodpisa -> if (c.oddaj > 0) brez to Ukrep.Neznan else rocno to Ukrep.Rocno(IzidPredaje.NAPAKA)
            Konec.Preklicano -> brez to (if (c.oddaj > 0) Ukrep.Neznan else Ukrep.Preklicano)
        }
    }.first

    /** Po zasuku ali ponovnem zagonu (NalogaCakaSejo.obZagonu): nadaljuj, rok, neznan ali ne odide. */
    fun obnovi(zdajOdtis: String?, zdaj: Long, rokMs: Long): Obnova = obnoviZa({ it == zdajOdtis }, zdaj, rokMs)

    /**
     * Naloga 34 (slepi pregled 34 krog 2 N2): cakanje se obnovi za racunalnik, kateremu je bila naloga potrjena, ce je se seznanjen
     * ([seznanjen]) - ne glede na to, kateri racunalnik je zdaj izbran v zavihku. Sicer bi se naloga z oznako oddaje (NEZNAN) tiho
     * oznacila kot potekla in lastnik bi jo poslal znova (dvojna izvedba).
     */
    fun obnoviZa(seznanjen: (String) -> Boolean, zdaj: Long, rokMs: Long): Obnova = spremeni { s ->
        val c = s.cakajoca ?: return@spremeni s to Obnova.Prazno
        val brez = s.copy(cakajoca = null)
        val zdajOdtis = c.odtis?.takeIf(seznanjen)
        when (NalogaCakaSejo.obZagonu(true, c.id, c.odtis, zdajOdtis, c.zacetek, zdaj, rokMs, oddano = c.oddaj > 0)) {
            NalogaCakaSejo.Ob.OBNOVI -> s to Obnova.Nadaljuj(c)
            NalogaCakaSejo.Ob.ROK -> brez.copy(rocno = c.besedilo) to Obnova.Rok
            NalogaCakaSejo.Ob.NEZNAN -> brez to Obnova.Neznan
            NalogaCakaSejo.Ob.NIC -> brez to Obnova.Nic(c.besedilo)
        }
    }.first

    fun imaCakajoco(): Boolean = stanje().cakajoca != null
    fun cakajocaId(): String? = stanje().cakajoca?.id

    fun rocno(): String? = stanje().rocno

    /** Prva oddaja je dobila razlog zagona (503 pred prevzemom id): racunalnik je nima, lastnik jo poslje rocno. */
    fun nastaviRocno(besedilo: String) {
        spremeni { s -> s.copy(rocno = besedilo) to Unit }
    }

    /** Lastnik vzame nalogo za rocno ponovitev (en vnos). */
    fun vzemiRocno(): String? = spremeni { s -> s.copy(rocno = null) to s.rocno }.first

    /** Oddaja istega besedila (npr. iz klepeta) porabi nalogo za ponovitev - ne ponudi se znova (slepi pregled 24 krog 2 N3). */
    fun porabiRocno(vnos: String) {
        spremeni { s -> (if (s.rocno?.trim() == vnos.trim()) s.copy(rocno = null) else s) to Unit }
    }

    fun shrani(besedilo: String, odtis: String?, cas: Long): Boolean =
        spremeni { s -> s.copy(shranjena = ShranjenaZapis(besedilo, odtis, cas)) to true }.second

    /** Shranjena gre sama samo, ce ne caka nobena naloga in mesto rocne ponovitve je prazno (naloga 24 CR1, slepi pregled 24 N5). */
    fun vzemiShranjeno(): ShranjenaZapis? = spremeni { s ->
        if (s.cakajoca != null || s.rocno != null || s.shranjena == null) s to null else s.copy(shranjena = null) to s.shranjena
    }.first

    /** Nedosegljiv: shranjena se vrne (ce je medtem ni zamenjala nova). */
    fun vrniShranjeno(z: ShranjenaZapis) {
        spremeni { s -> (if (s.shranjena == null) s.copy(shranjena = z) else s) to Unit }
    }
}

/** Razlogi zagona seje in rok: racunalnik naloge ni prevzel (odgovoril je pred prevzemom id), lastnik jo poslje rocno. */
private val ZAGON = setOf(IzidPredaje.ZAGON_NI_TERMINALA, IzidPredaje.ZAGON_NI_CLAUDE, IzidPredaje.ZAGON_IZKLOPLJENO, IzidPredaje.ZAGON_OPOZORILO,
    IzidPredaje.ZAGON_OMEJITEV, IzidPredaje.ZAGON_NAPAKA, IzidPredaje.ZAGON_ROK, IzidPredaje.ZAGON_NI_SPREJELA)

/**
 * Naloga 26t: stanje enega zaslona (ena instanca AsistentKontroler): katera naloga caka v TEJ instanci in stevec generacij, s katerim
 * nit cakanja ve, da je zastarela. Vse trajno je v [naloga] (skupno vsem zaslonom). App izvede ucinke, ki jih vrnejo metode.
 */
class ZaslonNaloge(val naloga: NalogaRacunalnika) {
    /** Naloga, ki caka na sejo v tej instanci (samo glavna nit). */
    var cakaSejo: String? = null; private set
    private val generacija = AtomicInteger()

    enum class Sporocilo { PREKLICANO, PREPOZNO }

    /** Ustavi ali nova naloga. null = ni bilo cakanja; PREPOZNO = oddaja je bila morda na poti (app poslje dolgovane /ustavi). */
    fun preklici(zdaj: Long): Sporocilo? {
        val p = naloga.preklici(zdaj)
        if (p == null && cakaSejo == null) return null
        generacija.incrementAndGet()
        cakaSejo = null
        return if (p?.oddana == true) Sporocilo.PREPOZNO else Sporocilo.PREKLICANO
    }

    /** Zacetek (ali nadaljevanje) cakanja v tej instanci: vrne generacijo za nit. */
    fun zacni(id: String, besedilo: String, odtis: String?, zacetek: Long): Int {
        val gen = generacija.incrementAndGet()
        cakaSejo = id
        naloga.zacniCakanje(id, besedilo, odtis, zacetek)
        return gen
    }

    /** Trenutna generacija (preizkus lastnosti primerja generacijo niti s to). */
    internal fun generacija(): Int = generacija.get()

    /** Kopija stanja zaslona nad drugo shrambo (samo preizkus lastnosti: iskanje po stanjih). */
    internal fun kopija(naloga: NalogaRacunalnika): ZaslonNaloge =
        ZaslonNaloge(naloga).also { it.cakaSejo = cakaSejo; it.generacija.set(generacija.get()) }

    /** Za nit: ali je ta nit se veljavna (ista generacija, mesto se pripada nalogi). */
    fun nitVelja(gen: Int, id: String): Boolean = generacija.get() == gen && naloga.cakajocaId() == id

    /** Glavna nit po koncu niti; null = nit je zastarela (preklic ali nova naloga v tej instanci), nic se ne naredi. */
    fun koncaj(gen: Int, id: String, konec: NalogaRacunalnika.Konec, sKlepetom: Boolean, seznanjen: Boolean = true): NalogaRacunalnika.Ukrep? {
        if (generacija.get() != gen) return null
        cakaSejo = null
        return naloga.koncaj(id, konec, sKlepetom, seznanjen)
    }
}
