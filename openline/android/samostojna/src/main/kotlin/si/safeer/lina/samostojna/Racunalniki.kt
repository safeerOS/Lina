package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Naloga 34 (lastnik 26. 11. 2026): telefon je seznanjen z VEC racunalniki (dom, sluzba, testni PC). Vsak je seznanjen loceno (QR ali
 * koda + »Dodaj« na TISTEM racunalniku) in ima svoj pripet odtis potrdila; zaupanje enega ne velja za drugega. Nova seznanitev ne
 * prepise obstojecih: isti odtis = isti racunalnik (posodobi se samo naslov), drug odtis = nov clan seznama.
 *
 * Cisti modul (preizkusi Naloga34Test): app samo prenese SharedPreferences (AsistentShramba). [izbran] je racunalnik, s katerim telefon
 * trenutno govori (AsistentShramba.beri); med tekoco nalogo se ne menja (AsistentKontroler.poslji).
 */
@Serializable
data class Racunalnik(
    val odtis: String,
    val naslov: String,
    val vrata: Int,
    val ime: String = PRIVZETO_IME,
    /** id Line na releju (Global Link) samo iz podpisanega /stanje TEGA racunalnika. */
    val rele: String? = null,
    /** Uporabnik je racunalnik izkljucil iz samodejne razdelitve (rocno ga se lahko izbere). */
    val prepovedan: Boolean = false,
)

@Serializable
data class SeznamRacunalnikov(
    val v: Int = 1,
    val racunalniki: List<Racunalnik> = emptyList(),
    val izbran: String? = null,
    /** true: nova naloga gre na najmanj obremenjen dosegljiv racunalnik; false: vedno na [izbran] (uporabnikova rocna izbira). */
    val samodejno: Boolean = true,
) {
    /** Rocna izbira za RazdelitevDela.izberi (null = samodejno). */
    fun rocno(): String? = if (samodejno) null else izbrani()?.odtis

    fun izbrani(): Racunalnik? = racunalniki.firstOrNull { it.odtis == izbran } ?: racunalniki.firstOrNull()
    fun po(odtis: String?): Racunalnik? = racunalniki.firstOrNull { it.odtis == odtis }
}

const val PRIVZETO_IME = "Racunalnik"
const val NAJVEC_RACUNALNIKOV = 16

object Racunalniki {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** Ime za prikaz: brez nadzornih/oblikovnih znakov, 1-60 znakov; prazno -> null (klicatelj obdrzi prejsnje). */
    fun cistoIme(ime: String?): String? =
        ime?.filter {
            val t = Character.getType(it)
            !Character.isISOControl(it) && t != Character.FORMAT.toInt() && t != Character.LINE_SEPARATOR.toInt() && t != Character.PARAGRAPH_SEPARATOR.toInt()
        }?.trim()?.take(60)?.ifEmpty { null }

    /**
     * Nova seznanitev: isti odtis posodobi naslov in vrata (ime, rele, prepoved ostanejo); drug odtis se doda na konec. Nikoli ne
     * odstrani drugega racunalnika. Nov izbrani je ta racunalnik, razen ko je uporabnik izbral »samo ta« (samodejno izklopljeno): takrat
     * izbira ostane (slepi pregled 34: nova seznanitev ne sme tiho prevzeti vseh nalog). null = seznam je poln ([NAJVEC_RACUNALNIKOV]).
     */
    fun dodaj(s: SeznamRacunalnikov, odtis: String, naslov: String, vrata: Int, ime: String? = null): SeznamRacunalnikov? {
        val o = odtis.lowercase()
        val obstojeci = s.po(o)
        val seznam = if (obstojeci != null) {
            s.racunalniki.map { if (it.odtis == o) it.copy(naslov = naslov, vrata = vrata) else it }
        } else {
            if (s.racunalniki.size >= NAJVEC_RACUNALNIKOV) return null
            s.racunalniki + Racunalnik(o, naslov, vrata, cistoIme(ime) ?: imeZaNovega(s))
        }
        return s.copy(racunalniki = seznam, izbran = if (!s.samodejno && s.izbrani() != null) s.izbrani()!!.odtis else o)
    }

    /** Prvo prosto privzeto ime (po odstranitvi se ime ne podvoji). */
    private fun imeZaNovega(s: SeznamRacunalnikov): String {
        val imena = s.racunalniki.map { it.ime }.toSet()
        if (PRIVZETO_IME !in imena) return PRIVZETO_IME
        return (2..NAJVEC_RACUNALNIKOV + 1).map { "$PRIVZETO_IME $it" }.first { it !in imena }
    }

    /**
     * Racunalnik, ki mu gredo vse poti TEKOCE naloge ([cilj] = odtis ob oddaji): poizvedbe, odgovori, nadaljevanje, ustavitev. Izbira
     * v zavihku ali nova seznanitev ga ne zamenjata (slepi pregled 34). Odstranjen ali pozabljen = null (naloga se ne spremlja vec, T13).
     * Brez tekoce naloge: izbrani.
     */
    fun zaNalogo(s: SeznamRacunalnikov, cilj: String?): Racunalnik? = if (cilj != null) s.po(cilj) else s.izbrani()

    /** Odtis naloge, ce je njen racunalnik se seznanjen (T3 za vec racunalnikov: primerja se z njim, ne z izbranim v zavihku). */
    fun seznanjen(s: SeznamRacunalnikov, odtis: String?): String? = odtis?.takeIf { s.po(it) != null }

    private val PRIVZETO = Regex("^$PRIVZETO_IME( [0-9]+)?$")

    /** Ime iz /stanje (ime gostitelja) zamenja samo privzeto ime iz seznanitve, nikoli uporabnikovega (preveri se ob zapisu). */
    fun imeIzStanja(s: SeznamRacunalnikov, odtis: String, ime: String?): SeznamRacunalnikov? {
        val c = cistoIme(ime) ?: return null
        val r = s.po(odtis) ?: return null
        if (!PRIVZETO.matches(r.ime) || r.ime == c) return null
        return preimenuj(s, odtis, c)
    }

    /**
     * Vrnitev na starejso razlicico in nazaj (slepi pregled 34 krog 2 N6): starejsa Lina pise samo zrcalo (naslov/vrata/odtis). Ce se
     * zrcalo ne ujema z izbranim, ga je spremenila ona: brez zrcala = izbrani je bil pozabljen; drug odtis = nova seznanitev (doda se).
     */
    fun uskladi(s: SeznamRacunalnikov, naslov: String?, vrata: Int, odtis: String?, veljaven: (Racunalnik) -> Boolean): SeznamRacunalnikov {
        val i = s.izbrani() ?: return s
        if (odtis == null || naslov == null) return odstrani(s, i.odtis)
        val o = odtis.lowercase()
        if (o == i.odtis) return s
        val r = Racunalnik(o, naslov, vrata)
        return if (veljaven(r)) dodaj(s.copy(samodejno = true), o, naslov, vrata)?.copy(samodejno = s.samodejno) ?: s else s
    }

    fun preimenuj(s: SeznamRacunalnikov, odtis: String, ime: String): SeznamRacunalnikov {
        val c = cistoIme(ime) ?: return s
        return s.copy(racunalniki = s.racunalniki.map { if (it.odtis == odtis) it.copy(ime = c) else it })
    }

    /** Odstrani samo ta racunalnik; ce je bil izbran, je izbran prvi preostali (ali noben). */
    fun odstrani(s: SeznamRacunalnikov, odtis: String): SeznamRacunalnikov {
        val ostali = s.racunalniki.filter { it.odtis != odtis }
        return s.copy(racunalniki = ostali, izbran = if (s.izbran == odtis || s.po(s.izbran) == null) ostali.firstOrNull()?.odtis else s.izbran)
    }

    fun prepovej(s: SeznamRacunalnikov, odtis: String, prepovedan: Boolean): SeznamRacunalnikov =
        s.copy(racunalniki = s.racunalniki.map { if (it.odtis == odtis) it.copy(prepovedan = prepovedan) else it })

    fun izberi(s: SeznamRacunalnikov, odtis: String): SeznamRacunalnikov = if (s.po(odtis) == null) s else s.copy(izbran = odtis)

    /** Rele samo za racunalnik, ki ga je poslal (odtis povezave, ki je odgovorila), nikoli za izbranega po zamenjavi. */
    fun nastaviRele(s: SeznamRacunalnikov, odtis: String, rele: String?): SeznamRacunalnikov =
        s.copy(racunalniki = s.racunalniki.map { if (it.odtis == odtis) it.copy(rele = rele) else it })

    fun vJson(s: SeznamRacunalnikov): String = json.encodeToString(s)

    /**
     * Branje: neveljaven clan ([veljaven] = pravila QR: zasebni naslov, vrata, odtis) se preskoci, ostali ostanejo; podvojen odtis
     * samo enkrat; neveljaven id releja ([rele]) se zavrze, clan ostane. null = zapis ni berljiv (prehod iz stare ene seznanitve).
     */
    fun izJson(besedilo: String?, veljaven: (Racunalnik) -> Boolean, rele: (String) -> Boolean = { true }): SeznamRacunalnikov? {
        if (besedilo.isNullOrBlank()) return null
        val s = runCatching { json.decodeFromString<SeznamRacunalnikov>(besedilo) }.getOrNull() ?: return null
        val videni = HashSet<String>()
        val ok = s.racunalniki.map { it.copy(odtis = it.odtis.lowercase(), ime = cistoIme(it.ime) ?: PRIVZETO_IME, rele = it.rele?.takeIf(rele)) }
            .filter { veljaven(it) && videni.add(it.odtis) }.take(NAJVEC_RACUNALNIKOV)
        return s.copy(racunalniki = ok, izbran = s.izbran?.takeIf { i -> ok.any { it.odtis == i } } ?: ok.firstOrNull()?.odtis)
    }

    /**
     * Prehod (pravilo naloge 28: nastavitve ostanejo): telefon pred nalogo 34 je hranil EN racunalnik v kljucih naslov/vrata/odtis/rele.
     * Ob prvem branju postane prvi clan seznama (izbran), z istim relejem. Ce seznam ze obstaja, se stari kljuci ne berejo.
     */
    fun prehod(obstojec: SeznamRacunalnikov?, naslov: String?, vrata: Int, odtis: String?, rele: String?, veljaven: (Racunalnik) -> Boolean,
               veljavenRele: (String) -> Boolean = { true }): SeznamRacunalnikov {
        if (obstojec != null) return obstojec
        if (naslov == null || odtis == null) return SeznamRacunalnikov()
        val r = Racunalnik(odtis.lowercase(), naslov, vrata, PRIVZETO_IME, rele?.takeIf(veljavenRele))
        return if (veljaven(r)) SeznamRacunalnikov(racunalniki = listOf(r), izbran = r.odtis) else SeznamRacunalnikov()
    }
}

/**
 * Naloga 34, zahteva 3: obremenitev racunalnika iz podpisanega /stanje (obremenitev.server.ts). Polje, ki ga racunalnik ne poslje
 * (Windows nima load average, starejsa Lina nic), je null = NEZNANO - nikoli 0, sicer bi tak racunalnik dobil vsako nalogo.
 */
data class Obremenitev(val obremenitev5: Double? = null, val jedra: Int? = null, val prostMb: Long? = null, val ime: String? = null) {
    /** 5-min load na jedro; null, ce kateri podatek manjka ali je izven razumnega obsega. */
    fun naJedro(): Double? {
        val l = obremenitev5?.takeIf { it.isFinite() && it in 0.0..4096.0 } ?: return null
        val j = jedra?.takeIf { it in 1..1024 } ?: return null
        return l / j
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * Polje "racunalnik" iz podpisanega odgovora /stanje (prek pripete povezave). Vsako polje posebej: napacna vrsta ali obseg ->
         * null (neznano), nikoli privzeta stevilka. Odgovor brez polja (starejsa Lina) -> vse neznano.
         */
        fun izStanja(besedilo: String): Obremenitev? {
            if (besedilo.length > 4096) return null
            val k = runCatching { json.parseToJsonElement(besedilo) as? kotlinx.serialization.json.JsonObject }.getOrNull() ?: return null
            val r = k["racunalnik"] as? kotlinx.serialization.json.JsonObject ?: return Obremenitev()
            fun st(ime: String) = (r[ime] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.takeIf { it.isFinite() }
            val ime = (r["ime"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
            return Obremenitev(
                obremenitev5 = st("obremenitev5")?.takeIf { it in 0.0..4096.0 },
                jedra = st("jedra")?.takeIf { it == Math.floor(it) && it in 1.0..1024.0 }?.toInt(),
                prostMb = st("prostMb")?.takeIf { it == Math.floor(it) && it in 0.0..1.0e9 }?.toLong(),
                ime = Racunalniki.cistoIme(ime),
            )
        }
    }
}

/** Kandidat za nalogo: [dosegljiv] = podpisan /stanje je odgovoril v roku; [o] = njegova obremenitev (lahko neznana). */
data class Kandidat(val r: Racunalnik, val dosegljiv: Boolean, val o: Obremenitev? = null)

/**
 * Izbira racunalnika za nalogo (skil safeer-razdeli-delo-racunalnika: meri vse, nove naloge na najmanj obremenjenega; prag: load na
 * jedro nad [PRAG_NA_JEDRO] ali prost RAM pod [NAJMANJ_PROST_MB] = preobremenjen). Cista funkcija, deterministicna.
 */
object RazdelitevDela {
    /** ~5 na 4 jedrih testnega PC (skil: »prag ~5, nove naloge pod 4«). */
    const val PRAG_NA_JEDRO = 1.25
    const val NAJMANJ_PROST_MB = 1500L

    sealed interface Izbira {
        data class Racunalnik(val r: si.safeer.lina.samostojna.Racunalnik, val razlog: Razlog) : Izbira
        /** Uporabnik je izbral ta racunalnik rocno, a ni dosegljiv - naloga NE gre drugam brez njegove odlocitve. */
        data class RocniNedosegljiv(val r: si.safeer.lina.samostojna.Racunalnik) : Izbira
        data object Noben : Izbira
    }

    enum class Razlog { ROCNO, EDINI, NAJMANJ_OBREMENJEN, NEZNANA_OBREMENITEV, VSI_PREOBREMENJENI }

    /**
     * Racunalnik za NOVO nalogo (AsistentKontroler.izberiZaNalogo). [kandidati] = meritve vseh (null, ce je racunalnik samo eden in se ne
     * meri). [naRacunalnik] = shranjena naloga gre samo racunalniku, za katerega je bila potrjena (T3). Noben dosegljiv: izbrani, ce ni
     * izkljucen (naloga potem javi »ni dosegljiv« ali gre za pozneje); izkljucenega samodejno nikoli.
     */
    fun cilj(s: SeznamRacunalnikov, kandidati: List<Kandidat>?, naRacunalnik: String? = null): si.safeer.lina.samostojna.Racunalnik? {
        if (naRacunalnik != null) {
            val r = s.po(naRacunalnik) ?: return null
            if (kandidati == null) return r
        }
        if (kandidati == null || s.racunalniki.size <= 1) return s.izbrani()
        return when (val iz = izberi(kandidati, naRacunalnik ?: s.rocno(), s.izbrani()?.odtis)) {
            is Izbira.Racunalnik -> iz.r
            is Izbira.RocniNedosegljiv -> iz.r
            Izbira.Noben -> if (naRacunalnik != null) null else s.izbrani()?.takeUnless { it.prepovedan }
        }
    }

    /**
     * Dolgovan /ustavi preklicane naloge (naloga 26t) gre VSEM seznanjenim racunalnikom (dolg ne hrani, kam je bila naloga morda oddana;
     * racunalnik, ki id nima, ga zapise v grob). Poravnan je samo, ce so ga sprejeli vsi - sicer ostane za naslednji poskus.
     */
    fun ustavitevPoravnana(sprejeli: List<Boolean>): Boolean = sprejeli.isNotEmpty() && sprejeli.all { it }

    fun preobremenjen(o: Obremenitev?): Boolean =
        (o?.naJedro()?.let { it > PRAG_NA_JEDRO } ?: false) || (o?.prostMb?.let { it in 0 until NAJMANJ_PROST_MB } ?: false)

    /**
     * [rocno] = odtis, ki ga je uporabnik izbral za to nalogo (velja tudi za prepovedan racunalnik - prepoved velja samo za samodejno).
     * Sicer: dosegljivi, ne prepovedani; najprej ne-preobremenjeni z znano obremenitvijo (najmanjsa na jedro, nato vec prostega RAM),
     * nato tisti z neznano, nato preobremenjeni (najmanj obremenjen). Izenacenje: prej izbrani, nato odtis (stalni vrstni red).
     */
    fun izberi(kandidati: List<Kandidat>, rocno: String? = null, prejIzbran: String? = null): Izbira {
        if (rocno != null) {
            val k = kandidati.firstOrNull { it.r.odtis == rocno } ?: return Izbira.Noben
            return if (k.dosegljiv) Izbira.Racunalnik(k.r, Razlog.ROCNO) else Izbira.RocniNedosegljiv(k.r)
        }
        val ok = kandidati.filter { it.dosegljiv && !it.r.prepovedan }
        if (ok.isEmpty()) return Izbira.Noben
        if (ok.size == 1) return Izbira.Racunalnik(ok[0].r, Razlog.EDINI)
        val vrstni = compareBy<Kandidat>(
            { when { preobremenjen(it.o) -> 2; it.o?.naJedro() == null -> 1; else -> 0 } },
            { it.o?.naJedro() ?: Double.MAX_VALUE },
            { -(it.o?.prostMb ?: 0L) },
            { if (it.r.odtis == prejIzbran) 0 else 1 },
            { it.r.odtis },
        )
        val najboljsi = ok.sortedWith(vrstni).first()
        val razlog = when {
            preobremenjen(najboljsi.o) -> Razlog.VSI_PREOBREMENJENI
            najboljsi.o?.naJedro() == null -> Razlog.NEZNANA_OBREMENITEV
            else -> Razlog.NAJMANJ_OBREMENJEN
        }
        return Izbira.Racunalnik(najboljsi.r, razlog)
    }
}
