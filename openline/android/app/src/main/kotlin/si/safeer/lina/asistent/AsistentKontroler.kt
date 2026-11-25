package si.safeer.lina.asistent

import android.content.Context
import android.os.Handler
import android.os.Looper
import si.safeer.lina.podpis.AsistentProtokol
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

    fun stanje() = StanjeAsistenta(
        AsistentShramba.beri(context) != null, nalogaId != null, odprta, posiljam, cakaPotrditev != null || korakKode != null, cakaOdgovor,
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
        val pov = povezava() ?: return
        Thread {
            val cas = System.currentTimeMillis()
            val enkratni = NalogaLine.nakljucno(32)
            val podpis = runCatching { NapravaKljuc.podpisiStanje(cas, enkratni) }.getOrNull()
            val id = runCatching { NapravaKljuc.id() }.getOrNull()
            val odg = if (podpis == null || id == null) OdgovorLine.Nedosegljiva else pov.stanjeSeje(id, cas, enkratni, podpis)
            pov.zapri()
            val s = when (odg) {
                // id Line na releju samo iz podpisanega odgovora prek pripete povezave; brez njega rele izklopljen (naloga 22)
                is OdgovorLine.Ok -> AsistentProtokol.razberiSejo(odg.telo).also { AsistentShramba.shraniRele(context, AsistentProtokol.razberiRele(odg.telo)) }
                is OdgovorLine.Napaka -> if (odg.koda == "claude-code-ni") false else null
                else -> null
            }
            if (odg !is OdgovorLine.Nedosegljiva) zadnjaDosegljivost = true to System.currentTimeMillis()
            naGlavni { seja = s; if (odg !is OdgovorLine.Nedosegljiva) posljiShranjeno() }
        }.start()
    }

    private val prenosPoPoti = si.safeer.lina.samostojna.PrenosPoPoti()

    /** Zadnja izmerjena dosegljivost (vrednost, cas ms); seznanitev ni dosegljivost (naloga 11, 06:49 na 5G). */
    @Volatile private var zadnjaDosegljivost: Pair<Boolean, Long>? = null

    /**
     * Ali racunalnik ZDAJ odgovarja (podpisan GET /stanje; vsak odgovor streznika, tudi napaka, pomeni dosegljivo pot). Klice se v ozadju
     * ob vprasanju Lini; rezultat velja 30 s. Ob prehodu v dosegljivo poslje shranjeno nalogo (ce telefon ne dela druge).
     */
    fun dosegljivZdaj(): Boolean {
        zadnjaDosegljivost?.let { (v, t) -> if (System.currentTimeMillis() - t < VELJAVNOST_DOSEGLJIVOSTI_MS) return v }
        val pov = povezava() ?: return false
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

    private val shrambaCakajoce get() = context.getSharedPreferences("lina_cakajoca_naloga", Context.MODE_PRIVATE)

    /** Ena shranjena naloga (lastnik jo je potrdil v oknu); nova zamenja staro. */
    fun shraniZaPozneje(besedilo: String, obIzidu: ((IzidPredaje, String?) -> Unit)? = null): Boolean {
        obIzidu?.let { obIzidShranjene = it }
        return shrambaCakajoce.edit().putString("besedilo", besedilo).commit()
    }

    /** Klic klepeta za izid shranjene naloge (samo v pomnilniku: po ponovnem zagonu gre izid le v dnevnik zavihka Racunalnik). */
    @Volatile private var obIzidShranjene: ((IzidPredaje, String?) -> Unit)? = null

    /** Glavna nit: shranjeno nalogo poslje, ko je racunalnik dosegljiv in telefon ne dela druge; izid gre v dnevnik zavihka Racunalnik. */
    private fun posljiShranjeno() {
        val b = shrambaCakajoce.getString("besedilo", null) ?: return
        if (posiljam || nalogaId != null) return
        shrambaCakajoce.edit().remove("besedilo").apply()
        // nazaj v shrambo samo ob nedosegljivem (403/429/napaka bi se sicer ponavljali v nedogled); izid gre v dnevnik zavihka Racunalnik
        poslji(b) { izid, id ->
            if (izid != IzidPredaje.NEDOSEGLJIV) obIzidShranjene?.also { obIzidShranjene = null }?.invoke(izid, id)
            when (izid) {
                IzidPredaje.SPREJETA -> dodaj(context.getString(si.safeer.lina.R.string.local_task_shranjena_poslana, b.take(120)))
                IzidPredaje.NEDOSEGLJIV -> shrambaCakajoce.edit().putString("besedilo", b).apply()
                else -> dodaj(context.getString(si.safeer.lina.R.string.local_task_shranjena_ni, b.take(120)))
            }
        }
    }

    /** Samodejna izbira poti (domace omrezje, nato Global Link) kot v Safeer OS; ena tovarna za vse klicatelje (PovezavaLine). */
    private fun povezava(): IzbirnaPovezava? = PovezavaLine.ustvari(context, prenosPoPoti)

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
    fun poslji(vnos: String, obIzidu: ((IzidPredaje, String?) -> Unit)? = null): Boolean {
        // izid vedno asinhrono (glavna nit), da pride za klicateljevim »Preverjam …«
        if (posiljam || nalogaId != null) { obIzidu?.let { glavna.post { it(IzidPredaje.ZASEDENO, null) } }; return false }
        if (NalogaLine.besedilo(vnos) == null) { obIzidu?.let { glavna.post { it(IzidPredaje.NAPAKA, null) } }; return false }
        posiljam = true; napaka = null; izid = null; dnevnik.clear(); cakaOdgovor = false; spremljana = null
        obSpremembi()
        Thread {
            val pov = povezava()
            val naloga = runCatching {
                NapravaKljuc.podpisiNalogo(NalogaLine.nakljucno(32), vnos, System.currentTimeMillis(), NalogaLine.nakljucno(32))
            }.getOrNull()
            val odg = if (pov == null || naloga == null) OdgovorLine.Nedosegljiva else pov.naloga(AsistentProtokol.teloNaloge(naloga))
            pov?.zapri()
            zadnjaDosegljivost = (odg !is OdgovorLine.Nedosegljiva) to System.currentTimeMillis()
            naGlavni {
                // napaka podpisa (KeyStore) ni nedosegljiv racunalnik
                obIzidu?.invoke(if (pov != null && naloga == null) IzidPredaje.NAPAKA
                    else PredajaNaloge.izid(odg is OdgovorLine.Ok, odg is OdgovorLine.Nedosegljiva, (odg as? OdgovorLine.Napaka)?.status), naloga?.id)
                posiljam = false
                if (odg is OdgovorLine.Ok && naloga != null) {
                    nalogaId = naloga.id
                    nalogaBesedilo = naloga.besedilo
                    seja = true
                    poizveduj(naloga.id)
                } else {
                    napaka = NapakaLine.sporocilo(odg) ?: SporociloNapake.NAPAKA
                    if (napaka == SporociloNapake.CLAUDE_CODE_NI) seja = false
                }
            }
        }.start()
        return true
    }

    private fun poizveduj(id: String) {
        val nit = Thread {
            val pov = povezava() ?: return@Thread
            var od = 0L
            var zaporednih = 0
            try {
                // koncana naloga se spremlja naprej (redkeje), dokler je Lina ne pozabi (1 h, 404) ali telefon ne da nove
                while (!ustavljen && (nalogaId == id || spremljana == id)) {
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
        val id = nalogaId ?: return
        // lastnik je nalogo ustavil: Lina je ne pregleduje in ne nadaljuje sama
        samodejni.ustavi(id)
        Thread {
            val pov = povezava()
            val cas = System.currentTimeMillis()
            val enkratni = NalogaLine.nakljucno(32)
            val podpis = runCatching { NapravaKljuc.podpisiUstavitev(id, cas, enkratni) }.getOrNull()
            val posiljatelj = runCatching { NapravaKljuc.id() }.getOrNull()
            val odg = if (pov == null || podpis == null || posiljatelj == null) OdgovorLine.Nedosegljiva
                else pov.ustavi(AsistentProtokol.teloUstavitve(id, posiljatelj, cas, enkratni, podpis))
            pov?.zapri()
            naGlavni { napaka = NapakaLine.sporocilo(odg) }
        }.start()
    }

    /** Ob unicenju zaslona: poizvedovanje se ustavi; naloga na racunalniku tece naprej. */
    fun zapri() {
        ustavljen = true
        poizvedovalec?.interrupt()
        glavna.removeCallbacksAndMessages(null)
    }
}
