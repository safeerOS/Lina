package si.safeer.lina.asistent

import android.content.Context
import si.safeer.lina.podpis.IzbirnaPovezava
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.PotLine
import si.safeer.lina.podpis.ReleKanal
import si.safeer.lina.podpis.ReleVrata
import si.safeer.lina.protocol.PinnedHttp
import si.safeer.lina.samostojna.PrenosPoPoti
import si.safeer.lina.samostojna.Racunalnik
import si.safeer.lina.seznanitev.AsistentQr

/**
 * EDINA tovarna povezave telefon -> Lina na racunalniku (naloga 22): vsi klicatelji IzbirnaPovezava jo dobijo tu.
 * Poti iz shranjenih podatkov seznanitve: domace omrezje (naslov, vrata, odtis iz QR) in Global Link (id Line na releju iz
 * podpisanega /stanje). Neposredne poti Lina za asistentko nima (Caddy in tunel prepustita samo /api/voice) - ostane null.
 * Vse poti so HttpPovezavaZLino z ISTIM pripetim odtisom; podpisi naprave so v telesih/poizvedbah kot doma.
 * Naloga 34: povezava vedno za EN racunalnik ([r], privzeto izbrani); vrata releja so po racunalniku (odtis + id releja), da poizvedba
 * drugega racunalnika ne zapre kanalov tistega, na katerem tece naloga, in da racunalnik, ki v /stanje navede tuj id releja, ne deli
 * (in ne zapira) vrat drugega racunalnika (slepi pregled 34).
 */
object PovezavaLine {
    /** Pot zadnje zahteve, ki je DOSEGLA Lino; null, ce zadnja ni dosegla nobene (zavihek Racunalnik je ne ugiba). */
    @Volatile var zadnjaPot: PotLine? = null
        private set

    private val vrata = HashMap<String, ReleVrata>()

    fun ustvari(context: Context, prenos: PrenosPoPoti, r: Racunalnik? = AsistentShramba.izbrani(context)): IzbirnaPovezava? {
        val a = r?.let { AsistentQr.naslov(it.naslov, it.vrata, it.odtis) } ?: run { if (AsistentShramba.seznam(context).racunalniki.isEmpty()) zapriRele(); return null }
        val rele = r.rele?.takeIf { si.safeer.lina.podpis.ReleProtokol.jeIdReleja(it) }?.let { relePovezava(it, a.odtis) }
        return IzbirnaPovezava(HttpPovezavaZLino(a), null, rele, { l, n, rp -> prenos.izvedi(l, n, rp) }) { zadnjaPot = it }
    }

    private fun kljucVrat(odtis: String, cilj: String) = "$odtis|$cilj"

    /** Ena lokalna vrata releja na racunalnik (odtis + id Line na releju); seznam je omejen z NAJVEC_RACUNALNIKOV. */
    @Synchronized
    private fun vrataZa(odtis: String, cilj: String): ReleVrata? {
        val k = kljucVrat(odtis, cilj)
        vrata[k]?.let { return it }
        return runCatching { ReleVrata(cilj, ReleKanal(kljuc = { runCatching { NapravaKljuc.javniKljucB64() }.getOrNull() }, podpisi = NapravaKljuc::podpisiRele)) }
            .getOrNull()?.also { vrata[k] = it }
    }

    /** Zapre lokalna vrata releja racunalnika [odtis] za id [cilj] (ali vsa, ce null) in vse kanale, ki tecejo (ReleVrata.close); T13. */
    @Synchronized
    fun zapriRele(odtis: String? = null, cilj: String? = null) {
        if (odtis == null || cilj == null) { vrata.values.forEach { it.close() }; vrata.clear() } else vrata.remove(kljucVrat(odtis, cilj))?.close()
    }

    private fun relePovezava(cilj: String, odtis: String): HttpPovezavaZLino? {
        val v = vrataZa(odtis, cilj) ?: return null
        val naslov = AsistentQr.naslov("127.0.0.1", v.vrata, odtis) ?: return null
        return HttpPovezavaZLino(naslov, PinnedHttp.client(odtis, pingSeconds = 0).newBuilder().socketFactory(v.tovarna()).build())
    }
}
