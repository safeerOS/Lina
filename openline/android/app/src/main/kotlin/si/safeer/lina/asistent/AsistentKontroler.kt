package si.safeer.lina.asistent

import android.content.Context
import android.os.Handler
import android.os.Looper
import si.safeer.lina.podpis.AsistentProtokol
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
    private val noveKode = java.util.concurrent.LinkedBlockingQueue<String>()
    @Volatile private var poizvedovalec: Thread? = null
    @Volatile private var ustavljen = false

    fun stanje() = StanjeAsistenta(
        AsistentShramba.beri(context) != null, nalogaId != null, odprta, posiljam, cakaPotrditev != null || korakKode != null,
    )

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
                is OdgovorLine.Ok -> AsistentProtokol.razberiSejo(odg.telo)
                is OdgovorLine.Napaka -> if (odg.koda == "claude-code-ni") false else null
                else -> null
            }
            naGlavni { seja = s }
        }.start()
    }

    private val prenosPoPoti = si.safeer.lina.samostojna.PrenosPoPoti()

    /** Samodejna izbira poti (LAN, nato rele) kot v Safeer OS; rele za asistentko na telefonu se doda, ko obstaja prenos. */
    private fun povezava(): IzbirnaPovezava? = AsistentShramba.beri(context)?.let { IzbirnaPovezava(HttpPovezavaZLino(it), null, null, prenosPoPoti) }

    private fun naGlavni(delo: () -> Unit) = glavna.post { if (!ustavljen) { delo(); obSpremembi() } }

    private fun dodaj(besedilo: String) {
        dnevnik.addLast(besedilo)
        while (dnevnik.size > 50) dnevnik.removeFirst()
    }

    /** true, ce je bila naloga sprejeta v obdelavo (ne pomeni, da jo je Lina sprejela). */
    fun poslji(vnos: String): Boolean {
        if (posiljam || nalogaId != null || NalogaLine.besedilo(vnos) == null) return false
        posiljam = true; napaka = null; izid = null; dnevnik.clear()
        obSpremembi()
        Thread {
            val pov = povezava()
            val naloga = runCatching {
                NapravaKljuc.podpisiNalogo(NalogaLine.nakljucno(32), vnos, System.currentTimeMillis(), NalogaLine.nakljucno(32))
            }.getOrNull()
            val odg = if (pov == null || naloga == null) OdgovorLine.Nedosegljiva else pov.naloga(AsistentProtokol.teloNaloge(naloga))
            pov?.zapri()
            naGlavni {
                posiljam = false
                if (odg is OdgovorLine.Ok && naloga != null) {
                    nalogaId = naloga.id
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
                while (!ustavljen && nalogaId == id) {
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
                            if (d.koncano) return@Thread
                        }
                    } else {
                        zaporednih++
                        val s = NapakaLine.sporocilo(odg)
                        naGlavni { napaka = s }
                        if (s == SporociloNapake.NI_NALOGE || s == SporociloNapake.ZAVRNJENO) {
                            naGlavni { if (nalogaId == id) { nalogaId = null; odprta = null } }
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
        if (nalogaId != id) return
        for (d in dogodki) when (d) {
            is DogodekLine.Stanje -> dodaj(d.besedilo)
            is DogodekLine.Odobritev -> odprta = d
            is DogodekLine.Izid -> { izid = d; dodaj(d.besedilo) }
        }
        if (koncano) { nalogaId = null; odprta = null }
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
