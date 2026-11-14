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

/**
 * Ena naloga naenkrat: poslje podpisano nalogo, v loceni niti dolgo poizveduje /dogodki, odobritev in ustavitev podpise kljuc
 * naprave (NapravaKljuc, Podpisnik). Stanje se spreminja samo na glavni niti; omrezje in KeyStore samo v ozadju.
 */
class AsistentKontroler(private val context: Context, private val obSpremembi: () -> Unit) {
    data class Vrstica(val besedilo: String, val napaka: Boolean = false)
    enum class IzidSeznanitve { SPREJETO, ZAVRNJENO, POTEKLO, NAPAKA }

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
    @Volatile private var poizvedovalec: Thread? = null
    @Volatile private var ustavljen = false

    fun stanje() = StanjeAsistenta(AsistentShramba.beri(context) != null, nalogaId != null, odprta, posiljam, cakaPotrditev != null)

    /**
     * Po skeniranju QR v1: podpisan POST /seznani, nato GET /seznani?koda= na 2 s do odlocitve lastnika ali izteka
     * vabila (do). Naslov se shrani samo ob "sprejeto"; zavrnitev, 404 ali iztek ne pustijo nicesar.
     */
    fun seznani(v: AsistentVabilo): Boolean {
        if (cakaPotrditev != null || nalogaId != null) return false
        cakaPotrditev = v; izidSeznanitve = null; napaka = null
        obSpremembi()
        Thread {
            val pov = HttpPovezavaZLino(v.naslov)
            val izid = try { seznaniNaRacunalniku(pov, v) } catch (_: InterruptedException) { null } finally { pov.zapri() }
            naGlavni {
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
        while (!ustavljen) {
            if (System.currentTimeMillis() > v.doMs) return IzidSeznanitve.POTEKLO
            Thread.sleep(2000)
            val o = pov.stanjeSeznanitve(v.koda)
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

    private fun povezava(): HttpPovezavaZLino? = AsistentShramba.beri(context)?.let { HttpPovezavaZLino(it) }

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
                    val odg = pov.dogodki(id, od, 25)
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
