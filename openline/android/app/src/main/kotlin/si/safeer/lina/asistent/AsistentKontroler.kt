package si.safeer.lina.asistent

import android.content.Context
import android.os.Handler
import android.os.Looper
import si.safeer.lina.podpis.AsistentProtokol
import si.safeer.lina.podpis.CakanjeSeje
import si.safeer.lina.samostojna.IzidPredaje
import si.safeer.lina.samostojna.PredajaNaloge
import si.safeer.lina.podpis.DogodekLine
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NapakaLine
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.OdgovorLine
import si.safeer.lina.podpis.SporociloNapake
import si.safeer.lina.podpis.StanjeAsistenta
import si.safeer.lina.podpis.StanjeSeznanitve
import si.safeer.lina.seznanitev.AsistentVabilo
import si.safeer.lina.seznanitev.AsistentNaslov
import si.safeer.lina.seznanitev.AsistentQr
import si.safeer.lina.seznanitev.KlicnoVabilo
import si.safeer.lina.seznanitev.KodaLine
import si.safeer.lina.seznanitev.KodaOdjemalec
import si.safeer.lina.seznanitev.QrSeznanitev
import si.safeer.lina.podpis.KodaProtokol
import si.safeer.lina.podpis.NapakaKode
import si.safeer.lina.podpis.IzidKroga
import si.safeer.lina.podpis.PrenosKode
import si.safeer.lina.podpis.TokKode

/**
 * Ena naloga naenkrat: poslje podpisano nalogo, v loceni niti dolgo poizveduje /dogodki, odobritev in ustavitev podpise kljuc
 * naprave (NapravaKljuc, Podpisnik). Stanje se spreminja samo na glavni niti; omrezje in KeyStore samo v ozadju.
 */
private const val VELJAVNOST_DOSEGLJIVOSTI_MS = 30_000L
/** Naloga 34: vsi racunalniki se izmerijo hkrati; kdor v tem roku ne odgovori, ne dobi naloge (domace omrezje + rele). */
private const val ROK_MERITVE_MS = 8_000L
/** Ime iz seznanitve (Racunalniki.dodaj), ki ga sme zamenjati ime racunalnika iz /stanje; uporabnikovega imena ne. */
private val PRIVZETO_IME = Regex("^${si.safeer.lina.samostojna.PRIVZETO_IME}( [0-9]+)?$")

class AsistentKontroler(private val context: Context, private val obSpremembi: () -> Unit) {
    data class Vrstica(val besedilo: String, val napaka: Boolean = false)
    enum class IzidSeznanitve { SPREJETO, ZAVRNJENO, POTEKLO, NAPAKA, NAPACNA_KODA, PREVEC, ZAPRTO, NI_ODPRTO, ZE_DODAN, ODTIS }
    enum class KorakKode { POVEZUJEM, CAKA_KODO, VNESI_ZNOVA, CAKA_DODAJ }

    private val glavna = Handler(Looper.getMainLooper())
    var nalogaId: String? = null; private set
    var odprta: DogodekLine.Odobritev? = null; private set
    var posiljam = false; private set
    var napaka: SporociloNapake? = null; private set
    var izid: DogodekLine.Izid? = null; private set
    val dnevnik = ArrayDeque<String>()
    /** Vabilo iz QR v1, ki caka na potrditev v Lini na racunalniku; shrani se sele ob "sprejeto". */
    var cakaPotrditev: AsistentVabilo? = null; private set
    var izidSeznanitve: IzidSeznanitve? = null; private set
    /** Seja Claude Code na racunalniku: true odprta, false zaprta, null neznano. */
    var seja: Boolean? = null; private set
    /** Seznanitev s kodo: korak in koda, ki jo telefon kaze (nacin B). */
    var korakKode: KorakKode? = null; private set
    var kodaZaPrikaz: String? = null; private set
    /** Razdelek klicev iz /koda/potrdi (kot v QR), preverjen; ponudi se po »sprejeto« z isto potrditvijo kot QR. */
    var kliciIzKode: KlicnoVabilo? = null; private set
    /** true, ce je zadnja seznanitev sla prek kode (besedilo izteka je drugo kot pri QR). */
    var zadnjaSKodo = false; private set
    /** Nacin B: koda, ki jo je lastnik vtipkal v Lini, ni bila prava; Lina je vnos odprla znova. */
    var kodaNiBilaPrava = false; private set
    /** Claude Code je vprasal in caka odgovor (reply vrsta=vprasanje ali »cakam na navodila«; 23. 11. 2026). */
    var cakaOdgovor = false; private set
    /** Besedilo naloge, ki jo je ta telefon poslal (za samodejni odgovor Line). */
    var nalogaBesedilo: String? = null; private set
    /** Koncana naloga, ki jo telefon se spremlja: Claude Code jo lahko odpre znova (lastnik v terminalu ali odgovor). */
    private var spremljana: String? = null
    /** Samodejni odgovori Line: najvec 10 na nalogo, lastnik jih lahko ustavi (SamodejniOdgovor.Stevec, preizkusi v modulu samostojna). */
    val samodejni = si.safeer.lina.samostojna.SamodejniOdgovor.Stevec()
    /** Klic ob vprasanju Claude Code (glavna nit): id naloge, besedilo naloge, vprasanje. */
    var naVprasanje: ((String, String, String) -> Unit)? = null
    /** Klic ob uspesnem izidu naloge (glavna nit): id, besedilo naloge, izid - Lina ga pregleda (23. 11. 2026, tocka (c)). */
    var naIzid: ((String, String, String) -> Unit)? = null
    private val noveKode = java.util.concurrent.LinkedBlockingQueue<String>()
    @Volatile private var poizvedovalec: Thread? = null
    @Volatile private var ustavljen = false
    private val shrambaCakajoce get() = context.getSharedPreferences(AsistentShramba.CAKAJOCA, Context.MODE_PRIVATE)

    /**
     * Naloga 26t: vse stanje naloge za Claude Code (cakajoca, oznaka oddaje, rocna ponovitev, shranjena, preklicani, dolgovane
     * ustavitve) je en zapis v AsistentShramba.CAKAJOCA; prehodi pod zaklepom v modulu samostojna (NalogaRacunalnika, ZaslonNaloge,
     * preizkusi vedenja in lastnosti). Kontroler samo klice prehode in izvede ucinke. »Pozabi racunalnik« zbrise datoteko (pozabi).
     */
    private val zaslon = si.safeer.lina.samostojna.ZaslonNaloge(si.safeer.lina.samostojna.NalogaRacunalnika(object : si.safeer.lina.samostojna.ShrambaNalogeIo {
        override fun vse(): Map<String, *> = shrambaCakajoce.all
        override fun zapisi(json: String?, odstrani: Collection<String>): Boolean {
            val e = shrambaCakajoce.edit()
            for (k in odstrani) e.remove(k)
            if (json == null) e.remove(si.safeer.lina.samostojna.NalogaRacunalnika.KLJUC) else e.putString(si.safeer.lina.samostojna.NalogaRacunalnika.KLJUC, json)
            // commit, ne apply: smrt procesa takoj po zapisu ne sme izgubiti cakanja ali oznake oddaje (krog 2 N13)
            return e.commit()
        }
    }))
    private val shrambaNaloge get() = zaslon.naloga

    /** Naloga 23t: id potrjene naloge, ki caka, da Lina na racunalniku odpre Claude Code (null = ne caka). Samo glavna nit. */
    val cakaSejo: String? get() = zaslon.cakaSejo

    fun stanje() = StanjeAsistenta(
        AsistentShramba.beri(context) != null, nalogaId != null, odprta, posiljam, cakaPotrditev != null || korakKode != null, cakaOdgovor,
        cakaSejo = cakaSejo != null,
    )

    /** Id naloge, ki ji telefon lahko odgovori (tekoca ali spremljana koncana). */
    fun nalogaZaOdgovor(): String? = nalogaId ?: spremljana

    fun vzemiKlice(): KlicnoVabilo? = kliciIzKode.also { kliciIzKode = null }

    /**
     * Seznanitev s 6-mestno kodo (pogodba @fdd787b). [koda] je vtipkana koda nacina A ali null za nacin B (telefon pokaze
     * svojo kodo). Naslov je iz DNS-SD ali rocnega vnosa (samo zasebni). Shrani se sele ob »sprejeto«, kot pri QR.
     */
    fun povezisKodo(naslov: String, vrata: Int, koda: String?): Boolean {
        if (cakaPotrditev != null || korakKode != null || nalogaId != null) return false
        if (koda != null && KodaLine.koda(koda) == null) return false
        korakKode = KorakKode.POVEZUJEM; kodaZaPrikaz = null; zadnjaSKodo = true; kodaNiBilaPrava = false; noveKode.clear(); izidSeznanitve = null; napaka = null; kliciIzKode = null
        obSpremembi()
        Thread {
            val izid = try { tokKode(naslov, vrata, koda?.let { KodaLine.koda(it) }) } catch (_: InterruptedException) { null }
            naGlavni {
                korakKode = null; kodaZaPrikaz = null; kodaNiBilaPrava = false
                izidSeznanitve = izid
                if (izid == IzidSeznanitve.SPREJETO) preveriSejo() else kliciIzKode = null
            }
        }.also { poizvedovalec = it }.start()
        return true
    }

    private fun izNapake(o: OdgovorLine): IzidSeznanitve = when (o) {
        is OdgovorLine.Napaka -> when (KodaProtokol.napaka(o.status, o.koda)) {
            NapakaKode.NAPACNA_KODA -> IzidSeznanitve.NAPACNA_KODA
            NapakaKode.PREVEC -> IzidSeznanitve.PREVEC
            NapakaKode.ZAPRTO -> IzidSeznanitve.ZAPRTO
            NapakaKode.NI_ODPRTO -> IzidSeznanitve.NI_ODPRTO
            NapakaKode.ID_ZASEDEN -> IzidSeznanitve.ZE_DODAN
            NapakaKode.NI_PRIJAVE -> IzidSeznanitve.POTEKLO
            NapakaKode.ZAVRNJENO -> IzidSeznanitve.ZAVRNJENO
            else -> IzidSeznanitve.NAPAKA
        }
        else -> IzidSeznanitve.NAPAKA
    }

    private fun tokKode(naslov: String, vrata: Int, vtipkana: String?): IzidSeznanitve? {
        val id = runCatching { NapravaKljuc.id() }.getOrNull() ?: return IzidSeznanitve.NAPAKA
        val ime = imeNaprave()
        // 1. Prva povezava: odtis, ki ga telefon VIDI; /koda/zacni mora vrniti isti fp.
        val prva = OdtisPrvePovezave()
        val pov1 = HttpPovezavaZLino(AsistentNaslov(naslov, vrata, ""), prva.client())
        val o1 = try { pov1.kodaZacni(KodaProtokol.teloZacni(id, ime, vtipkana == null)) } finally { pov1.zapri() }
        if (o1 !is OdgovorLine.Ok) return izNapake(o1)
        val z = KodaProtokol.razberiZacetek(o1.telo) ?: return IzidSeznanitve.NAPAKA
        val vidni = prva.odtis ?: return IzidSeznanitve.NAPAKA
        if (!KodaLine.veljavenZacetek(z.pairId, z.nacin, z.hubId, z.fp, vidni)) return IzidSeznanitve.ODTIS
        val cilj = AsistentQr.naslov(naslov, vrata, vidni) ?: return IzidSeznanitve.NAPAKA
        val doMs = System.currentTimeMillis() + z.poteceS * 1000
        val koda = vtipkana ?: KodaLine.novaKoda()
        if (vtipkana == null) naGlavni { kodaZaPrikaz = koda; korakKode = KorakKode.CAKA_KODO }
        // 2. Vse naprej pripeto na videni odtis; krogi na istem pair_id (TokKode, pogodba @abc0bd3).
        val pov = HttpPovezavaZLino(cilj)
        try {
            val kljuc = runCatching { NapravaKljuc.javniKljucB64() }.getOrNull() ?: return IzidSeznanitve.NAPAKA
            val prenos = object : PrenosKode {
                override fun spake(telo: String) = pov.kodaSpake(telo)
                override fun odpovej(telo: String) = pov.kodaOdpovej(telo)
                override fun potrdi(cb: String, mac: String): OdgovorLine {
                    val cas = System.currentTimeMillis()
                    val enkratni = NalogaLine.nakljucno(32)
                    val p = runCatching { NapravaKljuc.podpisiSeznanitev(z.pairId, ime, cas, enkratni) }.getOrNull()
                        ?: return OdgovorLine.Nedosegljiva
                    return pov.kodaPotrdi(KodaProtokol.teloPotrdi(z.pairId, p.id, p.kljuc, ime, cas, enkratni, p.podpis, cb, mac))
                }
            }
            val tok = TokKode(id, z.pairId, vidni, kljuc, prenos)
            val r = if (vtipkana == null) {
                tok.nacinB(koda, doMs, spi = { Thread.sleep(it) }, obNapacni = { naGlavni { kodaNiBilaPrava = true } }, prekinjeno = { ustavljen })
            } else {
                tok.nacinA(koda, doMs) {
                    naGlavni { korakKode = KorakKode.VNESI_ZNOVA }
                    val k = noveKode.poll(maxOf(0, doMs - System.currentTimeMillis()), java.util.concurrent.TimeUnit.MILLISECONDS)
                    naGlavni { if (korakKode == KorakKode.VNESI_ZNOVA) korakKode = KorakKode.POVEZUJEM }
                    k?.let { KodaLine.koda(it) }
                }
            }
            val sprejeto = when (r) {
                is IzidKroga.Sprejeto -> r
                is IzidKroga.Konec -> return izKonca(r.napaka)
                else -> return IzidSeznanitve.NAPAKA
            }
            naGlavni { korakKode = KorakKode.CAKA_DODAJ; kodaZaPrikaz = null; kodaNiBilaPrava = false }
            // 3. Kot pri QR: GET /seznani?koda=<pair_id> do »Dodaj«/»Zavrni« (najvec 10 min, kot velja QR).
            val izid = cakajNaDodaj(pov, z.pairId, System.currentTimeMillis() + 600_000)
            if (izid == IzidSeznanitve.SPREJETO) {
                if (!AsistentShramba.shrani(context, cilj)) return IzidSeznanitve.NAPAKA
                // T1-S1: koda OpenLine pride sele po lastnikovem »Dodaj«, s podpisanim POST /seznani/klici (ne iz /koda/potrdi)
                val klici = prevzemiKlice(pov, z.pairId)
                naGlavni { kliciIzKode = klici }
            }
            return izid
        } finally {
            pov.zapri()
        }
    }

    private fun izKonca(n: NapakaKode): IzidSeznanitve? = when (n) {
        NapakaKode.PREVEC -> IzidSeznanitve.PREVEC
        NapakaKode.ZAPRTO -> IzidSeznanitve.ZAPRTO
        NapakaKode.NI_ODPRTO -> IzidSeznanitve.NI_ODPRTO
        NapakaKode.ID_ZASEDEN -> IzidSeznanitve.ZE_DODAN
        NapakaKode.NI_PRIJAVE, NapakaKode.POTEKLO -> IzidSeznanitve.POTEKLO
        NapakaKode.ZAVRNJENO -> IzidSeznanitve.ZAVRNJENO
        NapakaKode.PREKINJENO -> null
        else -> IzidSeznanitve.NAPAKA
    }

    /** Nacin A: nova koda po napacni (null ali prazno = preklic). */
    fun vnesiKodoZnova(koda: String?) {
        noveKode.offer(koda ?: "")
    }

    /**
     * Po skeniranju QR v1: podpisan POST /seznani, nato GET /seznani?koda= na 2 s do odlocitve lastnika ali izteka
     * vabila (do). Naslov se shrani samo ob "sprejeto"; zavrnitev, 404 ali iztek ne pustijo nicesar.
     */
    fun seznani(v: AsistentVabilo): Boolean {
        if (cakaPotrditev != null || nalogaId != null) return false
        cakaPotrditev = v; izidSeznanitve = null; napaka = null; zadnjaSKodo = false
        obSpremembi()
        Thread {
            val pov = HttpPovezavaZLino(v.naslov)
            var klici: KlicnoVabilo? = null
            val izid = try {
                seznaniNaRacunalniku(pov, v).also { if (it == IzidSeznanitve.SPREJETO) klici = prevzemiKlice(pov, v.koda) }
            } catch (_: InterruptedException) { null } finally { pov.zapri() }
            naGlavni {
                kliciIzKode = if (izid == IzidSeznanitve.SPREJETO) klici else null
                cakaPotrditev = null
                izidSeznanitve = izid
                if (izid == IzidSeznanitve.SPREJETO && !AsistentShramba.shrani(context, v.naslov)) izidSeznanitve = IzidSeznanitve.NAPAKA
                if (izidSeznanitve == IzidSeznanitve.SPREJETO) preveriSejo()
            }
        }.also { poizvedovalec = it }.start()
        return true
    }

    private fun seznaniNaRacunalniku(pov: HttpPovezavaZLino, v: AsistentVabilo): IzidSeznanitve? {
        val cas = System.currentTimeMillis()
        val enkratni = NalogaLine.nakljucno(32)
        val p = runCatching { NapravaKljuc.podpisiSeznanitev(v.koda, imeNaprave(), cas, enkratni) }.getOrNull()
            ?: return IzidSeznanitve.NAPAKA
        val prvi = pov.seznani(AsistentProtokol.teloSeznanitve(v.koda, p.id, p.kljuc, imeNaprave(), cas, enkratni, p.podpis))
        if (prvi !is OdgovorLine.Ok) return if (prvi is OdgovorLine.Napaka && prvi.status == 404) IzidSeznanitve.POTEKLO else IzidSeznanitve.NAPAKA
        return cakajNaDodaj(pov, v.koda, v.doMs)
    }

    /**
     * T1-S1: po lastnikovem »Dodaj« podpisan POST /seznani/klici (nizKlici). Vrne preverjeno vabilo ali null (Lina poti klicev
     * nima, OpenLine ni odgovoril, podpis ni mogoc ali odgovor ni veljaven: uporabnik klice nastavi sam, asistentka dela naprej).
     */
    private fun prevzemiKlice(pov: HttpPovezavaZLino, koda: String): KlicnoVabilo? {
        val id = runCatching { NapravaKljuc.id() }.getOrNull() ?: return null
        val cas = System.currentTimeMillis()
        val enkratni = NalogaLine.nakljucno(32)
        val podpis = runCatching { NapravaKljuc.podpisiKlice(koda, cas, enkratni) }.getOrNull() ?: return null
        val o = pov.klici(AsistentProtokol.teloKlici(koda, id, cas, enkratni, podpis)) as? OdgovorLine.Ok ?: return null
        return AsistentProtokol.razberiKlice(o.telo)?.let { QrSeznanitev.klicnoVabilo(it.url, it.code, it.fp) }
    }

    /** GET /seznani?koda= vsaki 2 s do lastnikove odlocitve, 404 ali izteka. */
    private fun cakajNaDodaj(pov: HttpPovezavaZLino, koda: String, doMs: Long): IzidSeznanitve? {
        while (!ustavljen) {
            if (System.currentTimeMillis() > doMs) return IzidSeznanitve.POTEKLO
            Thread.sleep(2000)
            val o = pov.stanjeSeznanitve(koda)
            when {
                o is OdgovorLine.Napaka && o.status == 404 -> return IzidSeznanitve.POTEKLO
                o is OdgovorLine.Ok -> when (AsistentProtokol.razberiSeznanitev(o.telo)) {
                    StanjeSeznanitve.SPREJETO -> return IzidSeznanitve.SPREJETO
                    StanjeSeznanitve.ZAVRNJENO -> return IzidSeznanitve.ZAVRNJENO
                    else -> Unit
                }
                else -> Unit // kratka prekinitev omrezja: poskusi znova do izteka vabila
            }
        }
        return null
    }

    /** Ime telefona, kot ga lastnik vidi v Lini na racunalniku (model naprave, 1-60 znakov brez nadzornih znakov). */
    private fun imeNaprave(): String =
        "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
            .filter { !Character.isISOControl(it) && Character.getType(it) != Character.FORMAT.toInt() }
            .trim().take(60).ifEmpty { "Android" }

    /** GET /stanje (podpisano): ali je seja Claude Code na racunalniku odprta. */
    fun preveriSejo() {
        // naloga 34: odgovor (rele, obremenitev) velja za racunalnik, ki mu je poizvedba sla, ne za izbranega ob odgovoru
        val r = AsistentShramba.izbrani(context) ?: return
        val pov = PovezavaLine.ustvari(context, prenosPoPoti, r) ?: return
        Thread {
            val cas = System.currentTimeMillis()
            val enkratni = NalogaLine.nakljucno(32)
            val podpis = runCatching { NapravaKljuc.podpisiStanje(cas, enkratni) }.getOrNull()
            val id = runCatching { NapravaKljuc.id() }.getOrNull()
            val odg = if (podpis == null || id == null) OdgovorLine.Nedosegljiva else pov.stanjeSeje(id, cas, enkratni, podpis)
            pov.zapri()
            val s = when (odg) {
                // id Line na releju samo iz podpisanega odgovora prek pripete povezave; brez njega rele izklopljen (naloga 22)
                is OdgovorLine.Ok -> AsistentProtokol.razberiSejo(odg.telo).also { zapisiStanje(r, odg.telo) }
                is OdgovorLine.Napaka -> if (odg.koda == "claude-code-ni") false else null
                else -> null
            }
            if (odg !is OdgovorLine.Nedosegljiva) zadnjaDosegljivost = true to System.currentTimeMillis()
            naGlavni { seja = s; if (odg !is OdgovorLine.Nedosegljiva) posljiShranjeno() }
        }.start()
    }

    private val prenosPoPoti = si.safeer.lina.samostojna.PrenosPoPoti()

    /** Naloga 34: zadnja izmerjena obremenitev po racunalniku (odtis -> meritev, cas ms) za seznam v zavihku Racunalnik. */
    val obremenitve = java.util.concurrent.ConcurrentHashMap<String, Pair<si.safeer.lina.samostojna.Kandidat, Long>>()

    /**
     * Odtis racunalnika, ki mu je sla zadnja naloga (slepi pregled 34): VSE poti te naloge (poizvedbe, cakanje seje, odgovori, nadaljevanje,
     * ustavitev) gredo njemu prek [povezava] (Racunalniki.zaNalogo), tudi ce uporabnik vmes izbere ali seznani drug racunalnik.
     */
    @Volatile var ciljNaloge: String? = null
        private set

    @Volatile private var zadnjaMeritev = 0L

    /** Naloga 34: izmeri vse racunalnike v ozadju (odprt zavihek Racunalnik), najvec vsakih 15 s, nato osvezi zaslon. */
    fun osveziObremenitve() {
        val vsi = AsistentShramba.seznam(context).racunalniki
        val zdaj = System.currentTimeMillis()
        if (vsi.isEmpty() || zdaj - zadnjaMeritev < 15_000L) return
        zadnjaMeritev = zdaj
        Thread({ izmeriVse(vsi); naGlavni {} }, "lina-meritve").start()
    }

    /** Racunalnik naloge je se na seznamu (T13: po »Pozabi« ali »Odstrani« tega racunalnika se naloga ne spremlja vec). */
    private fun nalogaSeznanjena(): Boolean = si.safeer.lina.samostojna.Racunalniki.zaNalogo(AsistentShramba.seznam(context), ciljNaloge) != null

    /** true, ko telefon oddaja, spremlja ali caka nalogo: takrat se izbrani racunalnik ne menja (vse poti naloge gredo na isti). */
    fun zaseden(): Boolean = posiljam || nalogaId != null || cakaSejo != null

    /** Iz podpisanega /stanje racunalnika [r]: rele (samo njemu), obremenitev, ime racunalnika, ce ga uporabnik ni preimenoval. */
    private fun zapisiStanje(r: si.safeer.lina.samostojna.Racunalnik, telo: String): si.safeer.lina.samostojna.Obremenitev? {
        AsistentShramba.shraniRele(context, r.odtis, AsistentProtokol.razberiRele(telo))
        val o = si.safeer.lina.samostojna.Obremenitev.izStanja(telo)
        // ime iz seznama ZDAJ (uporabnik ga je lahko med meritvijo preimenoval)
        o?.ime?.let { if (PRIVZETO_IME.matches(AsistentShramba.seznam(context).po(r.odtis)?.ime ?: "")) AsistentShramba.preimenuj(context, r.odtis, it) }
        return o
    }

    /** Podpisan GET /stanje enega racunalnika (ne na glavni niti): dosegljiv samo ob 200 (403 = telefon tam ni vec seznanjen). */
    private fun izmeri(r: si.safeer.lina.samostojna.Racunalnik): si.safeer.lina.samostojna.Kandidat {
        val k = run {
            val pov = PovezavaLine.ustvari(context, prenosPoPoti, r) ?: return@run si.safeer.lina.samostojna.Kandidat(r, false)
            val cas = System.currentTimeMillis()
            val enkratni = NalogaLine.nakljucno(32)
            val podpis = runCatching { NapravaKljuc.podpisiStanje(cas, enkratni) }.getOrNull()
            val id = runCatching { NapravaKljuc.id() }.getOrNull()
            val odg = try { if (podpis == null || id == null) OdgovorLine.Nedosegljiva else pov.stanjeSeje(id, cas, enkratni, podpis) } finally { pov.zapri() }
            if (odg is OdgovorLine.Ok) si.safeer.lina.samostojna.Kandidat(r, true, zapisiStanje(r, odg.telo)) else si.safeer.lina.samostojna.Kandidat(r, false)
        }
        obremenitve[r.odtis] = k to System.currentTimeMillis()
        return k
    }

    /** Vsi racunalniki hkrati, skupaj najvec [ROK_MERITVE_MS]; kdor ne odgovori v roku, je nedosegljiv. */
    private fun izmeriVse(vsi: List<si.safeer.lina.samostojna.Racunalnik>): List<si.safeer.lina.samostojna.Kandidat> {
        val rez = java.util.concurrent.atomic.AtomicReferenceArray<si.safeer.lina.samostojna.Kandidat>(vsi.size)
        val niti = vsi.mapIndexed { i, r -> Thread({ runCatching { rez.set(i, izmeri(r)) } }, "lina-meritev").apply { isDaemon = true; start() } }
        val konec = System.currentTimeMillis() + ROK_MERITVE_MS
        for (n in niti) n.join(maxOf(1, konec - System.currentTimeMillis()))
        return vsi.mapIndexed { i, r -> rez.get(i) ?: si.safeer.lina.samostojna.Kandidat(r, false) }
    }

    /**
     * Naloga 34, zahteva 3: racunalnik za novo nalogo (ne na glavni niti). En racunalnik: brez meritve (kot prej). Vec: izmeri vse in izberi
     * (RazdelitevDela.cilj: najmanj obremenjen dosegljiv, rocna izbira, shranjena samo svojemu [naRacunalnik]). Izbira v zavihkih se ne spremeni.
     */
    private fun izberiZaNalogo(naRacunalnik: String?): si.safeer.lina.samostojna.Racunalnik? {
        val s = AsistentShramba.seznam(context)
        return si.safeer.lina.samostojna.RazdelitevDela.cilj(s, if (s.racunalniki.size > 1) izmeriVse(s.racunalniki) else null, naRacunalnik)
    }

    /** Zadnja izmerjena dosegljivost (vrednost, cas ms); seznanitev ni dosegljivost (naloga 11, 06:49 na 5G). */
    @Volatile private var zadnjaDosegljivost: Pair<Boolean, Long>? = null

    /**
     * Ali racunalnik ZDAJ odgovarja (podpisan GET /stanje; vsak odgovor streznika, tudi napaka, pomeni dosegljivo pot). Klice se v ozadju
     * ob vprasanju Lini; rezultat velja 30 s. Ob prehodu v dosegljivo poslje shranjeno nalogo (ce telefon ne dela druge).
     */
    fun dosegljivZdaj(): Boolean {
        zadnjaDosegljivost?.let { (v, t) -> if (System.currentTimeMillis() - t < VELJAVNOST_DOSEGLJIVOSTI_MS) return v }
        // naloga 34: z vec racunalniki je Lina dosegljiva, ce odgovori katerikoli (naloga gre potem nanj, izberiZaNalogo)
        val sez = AsistentShramba.seznam(context)
        val vsi = sez.racunalniki
        if (vsi.size > 1 && sez.samodejno) {
            val dosegljiv = izmeriVse(vsi).any { it.dosegljiv }
            zadnjaDosegljivost = dosegljiv to System.currentTimeMillis()
            if (dosegljiv) naGlavni { posljiShranjeno() }
            return dosegljiv
        }
        // en racunalnik ali rocna izbira: nova naloga gre na izbranega - meri se on (ne racunalnik prejsnje naloge)
        val pov = PovezavaLine.ustvari(context, prenosPoPoti, sez.izbrani()) ?: return false
        val cas = System.currentTimeMillis()
        val enkratni = NalogaLine.nakljucno(32)
        val podpis = runCatching { NapravaKljuc.podpisiStanje(cas, enkratni) }.getOrNull()
        val id = runCatching { NapravaKljuc.id() }.getOrNull()
        val odg = if (podpis == null || id == null) OdgovorLine.Nedosegljiva else pov.stanjeSeje(id, cas, enkratni, podpis)
        pov.zapri()
        val dosegljiv = odg !is OdgovorLine.Nedosegljiva
        zadnjaDosegljivost = dosegljiv to System.currentTimeMillis()
        if (dosegljiv) naGlavni { posljiShranjeno() }
        return dosegljiv
    }

    /** Ena shranjena naloga (lastnik jo je potrdil v oknu); nova zamenja staro. Odtis in cas: T3 (gre samo temu racunalniku, v roku). */
    fun shraniZaPozneje(besedilo: String, obIzidu: ((IzidPredaje, String?) -> Unit)? = null): Boolean {
        obIzidu?.let { obIzidShranjene = it }
        return shrambaNaloge.shrani(besedilo, AsistentShramba.beri(context)?.odtis, System.currentTimeMillis())
    }

    /** Klic klepeta za izid shranjene naloge (samo v pomnilniku: po ponovnem zagonu gre izid le v dnevnik zavihka Racunalnik). */
    @Volatile private var obIzidShranjene: ((IzidPredaje, String?) -> Unit)? = null

    /** Glavna nit: shranjeno nalogo poslje, ko je racunalnik dosegljiv in telefon ne dela druge; izid gre v dnevnik zavihka Racunalnik. */
    private fun posljiShranjeno() {
        // naloga 26t: dolgovane /ustavi preklicanih nalog (tudi iz prejsnjega procesa) gredo ob vsakem dosegljivem racunalniku
        posljiUstavitve()
        if (cakaSejo != null) return // naloga 23t: med cakanjem na sejo nic ne odide samo (nova naloga bi preklicala cakajoco)
        if (obnoviCakanje()) return
        // naloga 24 CR1, slepi pregled 24 N5: shranjena gre sama samo, ce ne caka nobena naloga in je mesto rocne ponovitve prazno
        // (NalogaRacunalnika.vzemiShranjeno, pod zaklepom)
        if (posiljam || nalogaId != null) return
        val z = shrambaNaloge.vzemiShranjeno() ?: return
        val b = z.besedilo
        val odtis = z.odtis
        val cas = z.cas
        // T3 (pregled 0213): drug (ali pozabljen) racunalnik ali potekel rok - ne poslje se sama, lastnik jo poslje znova.
        // naloga 34: racunalnik, za katerega je bila potrjena, je lahko se na seznamu, ceprav je zdaj izbran drug - gre njemu
        val zanj = odtis?.takeIf { AsistentShramba.seznam(context).po(it) != null }
        if (!si.safeer.lina.samostojna.CakajocaNaloga.smePoslati(odtis, zanj, cas, System.currentTimeMillis())) {
            dodaj(context.getString(si.safeer.lina.R.string.local_task_shranjena_potekla, b.take(120)))
            return
        }
        // nazaj v shrambo samo ob nedosegljivem (403/429/napaka bi se sicer ponavljali v nedogled); izid gre v dnevnik zavihka Racunalnik
        poslji(b, naRacunalnik = zanj, obIzidu = { izid, id ->
            if (izid != IzidPredaje.NEDOSEGLJIV && izid != IzidPredaje.ODPIRA) obIzidShranjene?.also { obIzidShranjene = null }?.invoke(izid, id)
            when (izid) {
                IzidPredaje.SPREJETA -> dodaj(context.getString(si.safeer.lina.R.string.local_task_shranjena_poslana, b.take(120)))
                // naloga 23t: cakanje na sejo in razlogi zagona imajo svoj zapis (cakajNaSejo, besediloZagona); naloga ostane za rocno ponovitev
                IzidPredaje.ODPIRA, IzidPredaje.ZAGON_NI_TERMINALA, IzidPredaje.ZAGON_NI_CLAUDE, IzidPredaje.ZAGON_IZKLOPLJENO,
                IzidPredaje.ZAGON_OPOZORILO, IzidPredaje.ZAGON_OMEJITEV, IzidPredaje.ZAGON_NAPAKA, IzidPredaje.ZAGON_ROK, IzidPredaje.ZAGON_NI_SPREJELA -> Unit
                IzidPredaje.NEDOSEGLJIV -> shrambaNaloge.vrniShranjeno(z)
                // T1: izid neznan - ne shrani znova (bi se lahko izvedla dvakrat), lastnik preveri v zavihku Racunalnik
                IzidPredaje.NEZNAN -> dodaj(context.getString(si.safeer.lina.R.string.local_task_neznan))
                else -> dodaj(context.getString(si.safeer.lina.R.string.local_task_shranjena_ni, b.take(120)))
            }
        })
    }

    /** Samodejna izbira poti (domace omrezje, nato Global Link) kot v Safeer OS; ena tovarna za vse klicatelje (PovezavaLine). */
    private fun povezava(): IzbirnaPovezava? =
        PovezavaLine.ustvari(context, prenosPoPoti, si.safeer.lina.samostojna.Racunalniki.zaNalogo(AsistentShramba.seznam(context), ciljNaloge))

    private fun naGlavni(delo: () -> Unit) = glavna.post { if (!ustavljen) { delo(); obSpremembi() } }

    /** Zavihek Racunalnik kaze vsako sporocilo s casom (lastnik 23. 11. 2026: zadnje vmesno sporocilo in cas). */
    fun dodaj(besedilo: String) {
        val ura = java.time.LocalTime.now().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
        dnevnik.addLast("$ura  $besedilo")
        while (dnevnik.size > 50) dnevnik.removeFirst()
    }

    /**
     * true, ce je bila naloga sprejeta v obdelavo (ne pomeni, da jo je Lina sprejela). [obIzidu] (glavna nit) dobi dejanski izid:
     * SPREJETA z id-jem sele po odgovoru racunalnika (naloga 11), sicer razlog; ob zavrnitvi takoj ZASEDENO ali NAPAKA.
     */
    fun poslji(vnos: String, obIzidu: ((IzidPredaje, String?) -> Unit)? = null, naRacunalnik: String? = null): Boolean {
        // izid vedno asinhrono (glavna nit), da pride za klicateljevim »Preverjam …«
        if (posiljam || nalogaId != null) { obIzidu?.let { glavna.post { it(IzidPredaje.ZASEDENO, null) } }; return false }
        if (NalogaLine.besedilo(vnos) == null) { obIzidu?.let { glavna.post { it(IzidPredaje.NAPAKA, null) } }; return false }
        posiljam = true; napaka = null; izid = null; dnevnik.clear(); cakaOdgovor = false; spremljana = null
        // naloga 23t: nova naloga zamenja tisto, ki caka na sejo - stara se ne poslje (slepi 26t N5: PO ciscenju dnevnika, da sporocilo ostane)
        prekliciCakanje()
        // slepi pregled 24 krog 2 N3: isto besedilo kot naloga za ponovitev (npr. iz klepeta) jo porabi - ne ponudi se znova (dvojna izvedba)
        shrambaNaloge.porabiRocno(vnos)
        obSpremembi()
        Thread {
            // naloga 34: racunalnik se izbere enkrat ob oddaji (obremenitev) in je pripet za celo nalogo; T3 / slepi pregled 23t N9:
            // racunalnik, kateremu je lastnik nalogo potrdil, se zapomni ob oddaji (ne sele po odgovoru)
            val cilj = izberiZaNalogo(naRacunalnik)
            val odtisOb = cilj?.odtis
            ciljNaloge = odtisOb
            val pov = cilj?.let { PovezavaLine.ustvari(context, prenosPoPoti, it) }
            val naloga = runCatching {
                NapravaKljuc.podpisiNalogo(NalogaLine.nakljucno(32), vnos, System.currentTimeMillis(), NalogaLine.nakljucno(32))
            }.getOrNull()
            val odg = if (pov == null || naloga == null) OdgovorLine.Nedosegljiva else pov.naloga(AsistentProtokol.teloNaloge(naloga))
            pov?.zapri()
            zadnjaDosegljivost = (odg !is OdgovorLine.Nedosegljiva) to System.currentTimeMillis()
            naGlavni {
                // naloga 23t: 503 claude-code-ni z zagon == "odpira" - Lina odpira sejo, telefon pocaka in poslje sam (vmesni izid ODPIRA)
                val caka = naloga != null && CakanjeSeje.cakaj(odg)
                // naloga 34, zahteva 5: izid pove, na katerem racunalniku tece (ali caka) naloga
                if (naloga != null && (odg is OdgovorLine.Ok || caka)) cilj?.let { dodaj(context.getString(si.safeer.lina.R.string.local_task_racunalnik, AsistentShramba.seznam(context).po(it.odtis)?.ime ?: it.ime)) }
                // napaka podpisa (KeyStore) ni nedosegljiv racunalnik
                val izidOddaje = if (pov != null && naloga == null) IzidPredaje.NAPAKA
                    else PredajaNaloge.izidPrve(odg is OdgovorLine.Ok, odg is OdgovorLine.Nedosegljiva, (odg as? OdgovorLine.Napaka)?.status,
                        (odg as? OdgovorLine.Napaka)?.zagon).let { if (it == IzidPredaje.ODPIRA && !caka) IzidPredaje.CLAUDE_CODE_NI else it }
                obIzidu?.invoke(izidOddaje, naloga?.id)
                posiljam = false
                if (odg is OdgovorLine.Ok && naloga != null) {
                    nalogaId = naloga.id
                    nalogaBesedilo = naloga.besedilo
                    seja = true
                    poizveduj(naloga.id)
                } else if (caka && naloga != null) {
                    seja = false
                    cakajNaSejo(naloga.id, naloga.besedilo, odtisOb, System.currentTimeMillis(), obIzidu)
                } else {
                    napaka = NapakaLine.sporocilo(odg) ?: SporociloNapake.NAPAKA
                    if (napaka == SporociloNapake.CLAUDE_CODE_NI) seja = false
                    // razlog zagona (izklopljeno, opozorilo ...): takoj besedilo, naloga ostane za rocno ponovitev (vnos v zavihku Racunalnik)
                    // 503 z razlogom zagona: racunalnik je odgovoril pred prevzemom id, naloge zagotovo nima
                    besediloZagona(izidOddaje)?.let { r -> naloga?.besedilo?.let(shrambaNaloge::nastaviRocno); dodaj(context.getString(r)) }
                }
            }
        }.start()
        return true
    }

    /**
     * Naloga 23t: besedilo naloge, ki je racunalnik zagotovo nima (razlog zagona, rok brez oddaje) - trajno (NalogaRacunalnika.rocno),
     * da »naloga ostane shranjena« drzi tudi po zasuku ali ponovnem zagonu; zavihek Racunalnik ga enkrat vpise v vnos (en dotik Poslji).
     */
    fun vzemiZaPonovitev(): String? = shrambaNaloge.vzemiRocno()

    /** Ob prvem dosegljivem racunalniku po zasuku ali ponovnem zagonu: cakanje na sejo se nadaljuje (true) ali se konca. */
    private fun obnoviCakanje(): Boolean =
        when (val o = shrambaNaloge.obnovi(AsistentShramba.beri(context)?.odtis, System.currentTimeMillis(), CakanjeSeje.ROK_MS)) {
            si.safeer.lina.samostojna.NalogaRacunalnika.Obnova.Prazno -> false
            // isti id: ce jo racunalnik ze ima (zasuk med oddajo), vrne 409 obstaja in telefon jo spremlja; klic klepeta je bil od starega zaslona
            is si.safeer.lina.samostojna.NalogaRacunalnika.Obnova.Nadaljuj -> {
                if (!posiljam && nalogaId == null) o.naloga.let { cakajNaSejo(it.id, it.besedilo, it.odtis, it.zacetek, null) }
                true
            }
            si.safeer.lina.samostojna.NalogaRacunalnika.Obnova.Rok -> { dodaj(context.getString(si.safeer.lina.R.string.local_task_zagon_rok)); false }
            // krog 2 N1: oddaja je bila morda na poti - ne ponudi ponovitve (bi se izvedla dvakrat), lastnik preveri na racunalniku
            si.safeer.lina.samostojna.NalogaRacunalnika.Obnova.Neznan -> { dodaj(context.getString(si.safeer.lina.R.string.local_task_neznan)); false }
            // drug ali pozabljen racunalnik: ne odide; lastnik jo poslje znova sam
            is si.safeer.lina.samostojna.NalogaRacunalnika.Obnova.Nic -> {
                dodaj(context.getString(si.safeer.lina.R.string.local_task_shranjena_potekla, o.besedilo.take(120))); false
            }
        }

    /**
     * Naloga 23t: lastnik je preklical (Ustavi) ali dal drugo nalogo. Preklic in oznaka oddaje sta en prehod pod zaklepom
     * (NalogaRacunalnika.preklici / predOddajo): ali nit oddaje oznake ne zapise vec (ne odda), ali preklic vidi oznako in je /ustavi
     * dolgovan (zapisan, poslje se tudi po ponovnem zagonu). Rocna ponovitev in shranjena ostaneta (naloga 24 CR1, N6).
     */
    private fun prekliciCakanje() {
        when (zaslon.preklici(System.currentTimeMillis())) {
            null -> return
            si.safeer.lina.samostojna.ZaslonNaloge.Sporocilo.PREPOZNO -> {
                posljiUstavitve()
                dodaj(context.getString(si.safeer.lina.R.string.local_task_preklic_prepozno))
            }
            si.safeer.lina.samostojna.ZaslonNaloge.Sporocilo.PREKLICANO -> dodaj(context.getString(si.safeer.lina.R.string.local_task_odpiranje_preklicano))
        }
        obSpremembi()
    }

    /** Naloga 26t: vse dolgovane /ustavi (preklicane naloge, ki so bile morda oddane); vsak ostane zapisan, dokler ga racunalnik ne sprejme. */
    private fun posljiUstavitve() {
        for (id in shrambaNaloge.zaUstavitev(System.currentTimeMillis())) posljiUstavitev(id, izPreklica = true)
    }

    init {
        // naloga 26t CRA2: stara oblika (tudi z_oddano kot Boolean) se prebere strpno in prepise; pokvarjen zapis ne sesuje zaslona
        if (shrambaNaloge.preberiInPopravi()) dodaj(context.getString(si.safeer.lina.R.string.local_task_neznan))
        // krog 2 N5: po zasuku ali ponovnem zagonu se cakanje (in dolgovane ustavitve) nadaljuje takoj, ne sele ob odprtju zavihka
        if (shrambaNaloge.imaCakajoco() || shrambaNaloge.stanje().zaUstaviti.isNotEmpty()) glavna.post { if (!ustavljen) preveriSejo() }
    }

    private fun besediloZagona(i: IzidPredaje): Int? = when (i) {
        IzidPredaje.ZAGON_NI_TERMINALA -> si.safeer.lina.R.string.local_task_zagon_ni_terminala
        IzidPredaje.ZAGON_NI_CLAUDE -> si.safeer.lina.R.string.local_task_zagon_ni_claude
        IzidPredaje.ZAGON_IZKLOPLJENO -> si.safeer.lina.R.string.local_task_zagon_izklopljeno
        IzidPredaje.ZAGON_OPOZORILO -> si.safeer.lina.R.string.local_task_zagon_opozorilo
        IzidPredaje.ZAGON_OMEJITEV -> si.safeer.lina.R.string.local_task_zagon_omejitev
        IzidPredaje.ZAGON_NAPAKA -> si.safeer.lina.R.string.local_task_zagon_napaka
        IzidPredaje.ZAGON_ROK -> si.safeer.lina.R.string.local_task_zagon_rok
        IzidPredaje.ZAGON_NI_SPREJELA -> si.safeer.lina.R.string.local_task_zagon_ni_sprejela
        else -> null
    }

    /** Glavna nit. Poizvedovanje in ena ponovna oddaja v ozadju (CakanjeSeje, preizkusi v modulu podpis); izid na glavni niti. */
    private fun cakajNaSejo(id: String, besedilo: String, odtis: String?, shranjeno: Long, obIzidu: ((IzidPredaje, String?) -> Unit)?) {
        // naloga 34: cakanje (tudi obnovljeno po zagonu) gre racunalniku, kateremu je bila naloga potrjena
        ciljNaloge = odtis
        val gen = zaslon.zacni(id, besedilo, odtis, shranjeno)
        dodaj(context.getString(si.safeer.lina.R.string.local_task_odpira))
        Thread {
            val pov = povezava()
            val posiljatelj = runCatching { NapravaKljuc.id() }.getOrNull()
            // CRA4: false = oznake oddaje ni bilo mogoce zapisati (mesto ni vec te naloge ali zapis ni trajen) - POST ne odide
            var oznaka: Boolean? = null
            val izid = try {
                // ni seznanitve (pozabljen racunalnik) = preklic; ni kljuca naprave = brez podpisa (ne »3 minute«, slepi pregled N8)
                if (pov == null) CakanjeSeje.Izid.Preklicano else if (posiljatelj == null) CakanjeSeje.Izid.BrezPodpisa
                else CakanjeSeje.pocakajInOddaj(CakanjeSeje.Odvisnosti(
                    pov = pov, posiljatelj = posiljatelj,
                    podpisiStanje = { c, e -> runCatching { NapravaKljuc.podpisiStanje(c, e) }.getOrNull() },
                    // isti id: ce je racunalnik nalogo ze sprejel (npr. zasuk med oddajo), vrne 409 obstaja in je ne izvede dvakrat
                    podpisiNalogo = { c, e -> runCatching { NapravaKljuc.podpisiNalogo(id, besedilo, c, e) }.getOrNull() },
                    nakljucno = { NalogaLine.nakljucno(32) },
                    zdaj = { System.currentTimeMillis() },
                    spi = { Thread.sleep(it) },
                    zacetek = shranjeno,
                    predOddajo = { oznaka = shrambaNaloge.predOddajo(id) },
                    // T3: samo ta racunalnik in v roku shranjene naloge; »Pozabi racunalnik« jo ustavi. Preklic ali nova naloga na drugem
                    // zivem zaslonu (slepi pregled 24 N1) zamenja mesto v skupni shrambi - nitVelja je potem false
                    preklicano = { ustavljen || oznaka == false || !zaslon.nitVelja(gen, id) ||
                        !si.safeer.lina.samostojna.CakajocaNaloga.smePoslati(odtis, AsistentShramba.beri(context)?.odtis, shranjeno, System.currentTimeMillis()) },
                ))
            } catch (_: InterruptedException) { CakanjeSeje.Izid.Preklicano } finally { pov?.zapri() }
            // naloga 24 CR3/CR6, 26t: po odgovoru, NE glede na zaslon (lahko je ze zaprt), nit poslje dolgovan /ustavi za nalogo, ki jo je
            // lastnik medtem preklical (tudi z drugega zaslona); ce /ustavi ob preklicu ni bil sprejet, ostane zapisan za naslednji zagon
            CakanjeSeje.ustaviPoPreklicu(izid)?.takeIf { shrambaNaloge.dolgujeUstavitev(it) }?.let { posljiUstavitve() }
            // zaprt zaslon (zapri): naGlavni ne tece, zapis ostane in novi zaslon cakanje nadaljuje (obnoviCakanje)
            naGlavni { koncajCakanje(gen, id, besedilo, izid, obIzidu) }
        }.start()
    }

    private fun koncajCakanje(gen: Int, id: String, besedilo: String, izid: CakanjeSeje.Izid, obIzidu: ((IzidPredaje, String?) -> Unit)?) {
        val odg = (izid as? CakanjeSeje.Izid.Oddana)?.odgovor
        val konec = when (izid) {
            is CakanjeSeje.Izid.Oddana -> {
                val ima = CakanjeSeje.sprejeta(izid.odgovor)
                zadnjaDosegljivost = (izid.odgovor !is OdgovorLine.Nedosegljiva) to System.currentTimeMillis()
                si.safeer.lina.samostojna.NalogaRacunalnika.Konec.Odgovor(PredajaNaloge.izidPonovne(ima, izid.odgovor is OdgovorLine.Nedosegljiva,
                    if (ima) null else (izid.odgovor as? OdgovorLine.Napaka)?.status, (izid.odgovor as? OdgovorLine.Napaka)?.zagon))
            }
            is CakanjeSeje.Izid.Rok -> si.safeer.lina.samostojna.NalogaRacunalnika.Konec.Rok(PredajaNaloge.izidRoka(izid.razlog))
            CakanjeSeje.Izid.BrezPodpisa -> si.safeer.lina.samostojna.NalogaRacunalnika.Konec.BrezPodpisa
            CakanjeSeje.Izid.Preklicano -> si.safeer.lina.samostojna.NalogaRacunalnika.Konec.Preklicano
        }
        // preklic ali nova naloga v tej instanci: nit je zastarela, nic vec (slepi pregled N1, 24 N2)
        // slepi 26t krog 2 N7: po »Pozabi racunalnik« (ni seznanitve) ta zaslon naloge ne prevzame v spremljanje
        val u = zaslon.koncaj(gen, id, konec, sKlepetom = obIzidu != null, seznanjen = nalogaSeznanjena()) ?: return
        val napakaIzida = if (odg != null) NapakaLine.sporocilo(odg) ?: SporociloNapake.NAPAKA
            else if (izid is CakanjeSeje.Izid.Rok) SporociloNapake.CLAUDE_CODE_NI else SporociloNapake.NAPAKA
        when (u) {
            // slepi pregled 24 krog 2 N1: zapis pripada drugi nalogi ali je pobrisan (drug zaslon, »Pozabi racunalnik«)
            si.safeer.lina.samostojna.NalogaRacunalnika.Ukrep.Tuje, si.safeer.lina.samostojna.NalogaRacunalnika.Ukrep.Preklicano ->
                dodaj(context.getString(si.safeer.lina.R.string.local_task_odpiranje_preklicano))
            is si.safeer.lina.samostojna.NalogaRacunalnika.Ukrep.Spremljaj -> {
                obIzidu?.invoke(IzidPredaje.SPREJETA, id)
                napaka = null
                nalogaId = id
                nalogaBesedilo = besedilo
                seja = true
                poizveduj(id)
            }
            // T1, krog 3 N1b, CRA1: racunalnik jo je morda sprejel (tudi prejsnja oddaja drugega zaslona ali procesa) - brez ponovitve
            si.safeer.lina.samostojna.NalogaRacunalnika.Ukrep.Neznan -> {
                obIzidu?.invoke(IzidPredaje.NEZNAN, id); napaka = SporociloNapake.NEZNAN_IZID
                dodaj(context.getString(si.safeer.lina.R.string.local_task_neznan))
            }
            is si.safeer.lina.samostojna.NalogaRacunalnika.Ukrep.Rocno -> {
                obIzidu?.invoke(u.izid, if (odg != null) id else null); napaka = napakaIzida
                besediloZagona(u.izid)?.let { dodaj(context.getString(it)) }
                // krog 3 N2: brez klepeta (zavihek Racunalnik ali obnova) nedosegljiva naloga ne sme tiho izginiti
                if (u.izid == IzidPredaje.NEDOSEGLJIV) dodaj(context.getString(si.safeer.lina.R.string.local_task_nedosegljiv))
            }
            is si.safeer.lina.samostojna.NalogaRacunalnika.Ukrep.Napaka -> { obIzidu?.invoke(u.izid, id); napaka = napakaIzida }
        }
    }

    private fun poizveduj(id: String) {
        val nit = Thread {
            val pov = povezava() ?: return@Thread
            var od = 0L
            var zaporednih = 0
            try {
                // koncana naloga se spremlja naprej (redkeje), dokler je Lina ne pozabi (1 h, 404) ali telefon ne da nove
                // T13 (pregled 0213): po »Pozabi racunalnik« se spremljanje ustavi (ne tece naprej po stari povezavi)
                while (!ustavljen && (nalogaId == id || spremljana == id) && nalogaSeznanjena()) {
                    val cas = System.currentTimeMillis()
                    val enkratni = NalogaLine.nakljucno(32)
                    val posiljatelj = runCatching { NapravaKljuc.id() }.getOrNull()
                    val podpis = runCatching { NapravaKljuc.podpisiDogodke(id, cas, enkratni) }.getOrNull()
                    val odg = if (posiljatelj == null || podpis == null) OdgovorLine.Nedosegljiva
                        else pov.dogodki(id, posiljatelj, cas, enkratni, podpis, od, 25)
                    if (odg is OdgovorLine.Ok) {
                        val d = AsistentProtokol.razberiDogodke(odg.telo, od)
                        if (d == null) { zaporednih++; naGlavni { napaka = SporociloNapake.NAPAKA } }
                        else {
                            zaporednih = 0
                            od = AsistentProtokol.zadnjaSt(odg.telo, od)
                            naGlavni { napaka = null; uporabi(id, d.dogodki, d.koncano) }
                            // Lina pri koncani nalogi ne caka (dolgo poizvedovanje): ne vrti zanke, preveri vsakih 10 s
                            if (d.koncano) Thread.sleep(10_000)
                        }
                    } else {
                        zaporednih++
                        val s = NapakaLine.sporocilo(odg)
                        naGlavni { napaka = s }
                        if (s == SporociloNapake.NI_NALOGE || s == SporociloNapake.ZAVRNJENO) {
                            naGlavni { if (nalogaId == id) { nalogaId = null; odprta = null }; if (spremljana == id) spremljana = null; cakaOdgovor = false }
                            return@Thread
                        }
                    }
                    if (zaporednih > 0) Thread.sleep((3000L * zaporednih).coerceAtMost(30_000))
                }
            } catch (_: InterruptedException) {
            } finally {
                pov.zapri()
            }
        }
        poizvedovalec = nit
        nit.start()
    }

    private fun uporabi(id: String, dogodki: List<DogodekLine>, koncano: Boolean) {
        if (nalogaId != id && spremljana != id) return
        // spremljana koncana naloga je spet v teku (Claude Code je po koncu znova odgovoril)
        if (!koncano && nalogaId == null && spremljana == id && dogodki.isNotEmpty()) { nalogaId = id; spremljana = null; izid = null }
        // Lina samodejno odgovori samo na ZADNJE vprasanje v paketu (starejsa ne porabijo meje 10; pregled 24. 11. 2026)
        val stanja = dogodki.filterIsInstance<DogodekLine.Stanje>()
        val zadnje = si.safeer.lina.samostojna.SamodejniOdgovor.zadnjeVprasanje(stanja.map { it.besedilo to it.vprasanje })?.let { stanja[it] }
        var zaPregled: DogodekLine.Izid? = null
        for (d in dogodki) when (d) {
            is DogodekLine.Stanje -> {
                dodaj(d.besedilo)
                if (si.safeer.lina.samostojna.SamodejniOdgovor.jeVprasanje(d.besedilo, d.vprasanje)) cakaOdgovor = true
                else if (d.odgovor) cakaOdgovor = false
            }
            is DogodekLine.Odobritev -> {
                // tocka (b): odobritev ostane gumb lastnika; Lina takoj obvesti (enkrat na zahtevo)
                if (odprta?.zahtevaId != d.zahtevaId) runCatching {
                    OpomnikAlarm.pokaziObvestilo(context, "odobritev-${d.zahtevaId}",
                        context.getString(si.safeer.lina.R.string.assistant_approval_title) + "\n" +
                            context.getString(si.safeer.lina.R.string.assistant_approval_tool, d.orodje))
                }
                odprta = d
            }
            is DogodekLine.Izid -> { izid = d; cakaOdgovor = false; dodaj(d.besedilo); zaPregled = d.takeIf { it.ok } }
        }
        if (koncano) { nalogaId = null; odprta = null; cakaOdgovor = false; spremljana = id }
        if (zadnje != null && cakaOdgovor) naVprasanje?.invoke(id, nalogaBesedilo.orEmpty(), zadnje.besedilo)
        // Claude Code je javil konec (ok): Lina pregleda izid ob nacrtu in po potrebi da naslednji korak (AGENTS.md tocka (c))
        else if (zaPregled != null && koncano) naIzid?.invoke(id, nalogaBesedilo.orEmpty(), zaPregled!!.besedilo)
    }

    /**
     * Odgovor v ISTO nalogo (POST /nadaljuj, podpis nizNadaljevanja): lastnik ali Lina sama ([samodejno]). Odobritev s tem ni
     * mogoca (racunalnik besedilno odobritev zavrne; odobritve ostanejo gumb). true, ce je bil odgovor sprejet v obdelavo.
     */
    fun nadaljuj(vnos: String, samodejno: Boolean = false): Boolean {
        val id = nalogaZaOdgovor() ?: return false
        if (posiljam || NalogaLine.besedilo(vnos) == null) return false
        posiljam = true; napaka = null
        obSpremembi()
        Thread {
            val pov = povezava()
            val n = runCatching { NapravaKljuc.podpisiNadaljevanje(id, vnos, System.currentTimeMillis(), NalogaLine.nakljucno(32)) }.getOrNull()
            val odg = if (pov == null || n == null) OdgovorLine.Nedosegljiva else pov.nadaljuj(AsistentProtokol.teloNadaljevanja(n))
            pov?.zapri()
            naGlavni {
                posiljam = false
                if (odg is OdgovorLine.Ok && n != null) {
                    cakaOdgovor = false
                    dodaj(context.getString(if (samodejno) si.safeer.lina.R.string.assistant_auto_answered else si.safeer.lina.R.string.assistant_owner_answered,
                        samodejni.porabljenih(id), si.safeer.lina.samostojna.SamodejniOdgovor.NAJVEC_NA_NALOGO, n.besedilo))
                    if (nalogaId == null && spremljana == id) { nalogaId = id; spremljana = null; izid = null }
                } else {
                    napaka = NapakaLine.sporocilo(odg) ?: SporociloNapake.NAPAKA
                }
            }
        }.start()
        return true
    }

    /** Lastnik ustavi samodejne odgovore Line za tekoco nalogo (gumb v zavihku Racunalnik). */
    fun ustaviSamodejne() {
        val id = nalogaZaOdgovor() ?: return
        samodejni.ustavi(id)
        dodaj(context.getString(si.safeer.lina.R.string.assistant_auto_stopped))
        obSpremembi()
    }

    /** Odobritev ali zavrnitev TOCNO prikazane zahteve; podpis vezan na nalogo in na prikazano (zgostitev). */
    fun odgovori(dovoli: Boolean) {
        val o = odprta ?: return
        val id = nalogaId ?: return
        odprta = null
        obSpremembi()
        Thread {
            val pov = povezava()
            val cas = System.currentTimeMillis()
            val enkratni = NalogaLine.nakljucno(32)
            val podpis = runCatching {
                NapravaKljuc.podpisiOdobritev(o.zahtevaId, dovoli, cas, enkratni, id, o.orodje, o.predogled, o.opis)
            }.getOrNull()
            val posiljatelj = runCatching { NapravaKljuc.id() }.getOrNull()
            val odg = if (pov == null || podpis == null || posiljatelj == null) OdgovorLine.Nedosegljiva
                else pov.odobritev(AsistentProtokol.teloOdobritve(id, o.zahtevaId, dovoli, posiljatelj, cas, enkratni, podpis))
            pov?.zapri()
            naGlavni { napaka = NapakaLine.sporocilo(odg) }
        }.start()
    }

    fun ustavi() {
        val id = nalogaId ?: run { prekliciCakanje(); return }
        // lastnik je nalogo ustavil: Lina je ne pregleduje in ne nadaljuje sama
        samodejni.ustavi(id)
        posljiUstavitev(id)
    }

    /** Podpisan POST /ustavi za nalogo [id] (tudi naloga, ki je bila oddana tik pred preklicem cakanja - slepi pregled 23t N1). */
    private fun posljiUstavitev(id: String, izPreklica: Boolean = false) {
        Thread {
            // naloga 34: dolg (izPreklica) ne ve, kam je bila naloga morda oddana - gre vsem racunalnikom, poravnan samo, ce so ga sprejeli vsi
            val cilji = if (izPreklica) AsistentShramba.seznam(context).racunalniki.map { PovezavaLine.ustvari(context, prenosPoPoti, it) } else listOf(povezava())
            val odgovori = cilji.map { pov ->
                val cas = System.currentTimeMillis()
                val enkratni = NalogaLine.nakljucno(32)
                val podpis = runCatching { NapravaKljuc.podpisiUstavitev(id, cas, enkratni) }.getOrNull()
                val posiljatelj = runCatching { NapravaKljuc.id() }.getOrNull()
                (if (pov == null || podpis == null || posiljatelj == null) OdgovorLine.Nedosegljiva
                    else pov.ustavi(AsistentProtokol.teloUstavitve(id, posiljatelj, cas, enkratni, podpis))).also { pov?.zapri() }
            }
            val odg = if (izPreklica) (if (si.safeer.lina.samostojna.RazdelitevDela.ustavitevPoravnana(odgovori.map { it is OdgovorLine.Ok })) odgovori.first() else OdgovorLine.Nedosegljiva)
                else odgovori.first()
            // naloga 26t: dolgovan /ustavi je poravnan SAMO, ko ga racunalnik sprejme (202; za id, ki ga se nima, ga zapise v grob).
            // 403 (starejsa Lina pred sprejemom), 404, nedosegljiv ali neznan izid ostane za naslednji poskus (TLS je pripet na Lino tudi prek releja)
            if (izPreklica && odg is OdgovorLine.Ok) shrambaNaloge.ustavitevPotrjena(id)
            // slepi pregled 24 krog 2 N5: ustavitev ob preklicu (morda pred sprejemom, 403) ne pise napake druge, nove naloge
            if (!izPreklica) naGlavni { napaka = NapakaLine.sporocilo(odg) }
        }.start()
    }

    /** Ob unicenju zaslona: poizvedovanje se ustavi; naloga na racunalniku tece naprej. */
    fun zapri() {
        ustavljen = true
        poizvedovalec?.interrupt()
        glavna.removeCallbacksAndMessages(null)
    }
}
