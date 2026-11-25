package si.safeer.lina.asistent

import android.content.Context
import si.safeer.lina.podpis.IzbirnaPovezava
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.PotLine
import si.safeer.lina.podpis.ReleKanal
import si.safeer.lina.podpis.ReleVrata
import si.safeer.lina.protocol.PinnedHttp
import si.safeer.lina.samostojna.PrenosPoPoti
import si.safeer.lina.seznanitev.AsistentQr

/**
 * EDINA tovarna povezave telefon -> Lina na racunalniku (naloga 22): vsi klicatelji IzbirnaPovezava jo dobijo tu.
 * Poti iz shranjenih podatkov seznanitve: domace omrezje (naslov, vrata, odtis iz QR) in Global Link (id Line na releju iz
 * podpisanega /stanje). Neposredne poti Lina za asistentko nima (Caddy in tunel prepustita samo /api/voice) - ostane null.
 * Vse poti so HttpPovezavaZLino z ISTIM pripetim odtisom; podpisi naprave so v telesih/poizvedbah kot doma.
 */
object PovezavaLine {
    /** Pot zadnje zahteve, ki je DOSEGLA Lino; null, ce zadnja ni dosegla nobene (zavihek Racunalnik je ne ugiba). */
    @Volatile var zadnjaPot: PotLine? = null
        private set

    private var vrata: ReleVrata? = null
    private var ciljVrat: String? = null

    fun ustvari(context: Context, prenos: PrenosPoPoti): IzbirnaPovezava? {
        val a = AsistentShramba.beri(context) ?: run { zapriRele(); return null }
        val id = AsistentShramba.rele(context)
        // Global Link izklopljen na racunalniku ali telefon pozabljen: lokalna vrata releja se zaprejo (pregled 4)
        if (id == null) zapriRele()
        val rele = id?.let { relePovezava(it, a.odtis) }
        return IzbirnaPovezava(HttpPovezavaZLino(a), null, rele, { l, n, r -> prenos.izvedi(l, n, r) }) { zadnjaPot = it }
    }

    /** Lokalna vrata releja so ena na proces (ena skrivnost); ob drugem id-ju Line se stara zaprejo. */
    @Synchronized
    private fun vrataZa(cilj: String): ReleVrata? {
        vrata?.takeIf { ciljVrat == cilj }?.let { return it }
        vrata?.close()
        vrata = null
        return runCatching { ReleVrata(cilj, ReleKanal(kljuc = { runCatching { NapravaKljuc.javniKljucB64() }.getOrNull() }, podpisi = NapravaKljuc::podpisiRele)) }
            .getOrNull()?.also { vrata = it; ciljVrat = cilj }
    }

    @Synchronized
    private fun zapriRele() {
        vrata?.close()
        vrata = null
        ciljVrat = null
    }

    private fun relePovezava(cilj: String, odtis: String): HttpPovezavaZLino? {
        val v = vrataZa(cilj) ?: return null
        val naslov = AsistentQr.naslov("127.0.0.1", v.vrata, odtis) ?: return null
        return HttpPovezavaZLino(naslov, PinnedHttp.client(odtis, pingSeconds = 0).newBuilder().socketFactory(v.tovarna()).build())
    }
}
