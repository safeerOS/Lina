package si.safeer.lina.samostojna

/**
 * Opozorilo ob prvem zagonu (lastnik 24. 11. 2026; Linin AGENTS.md »Objava Line na safeer.si in opozorilo uporabniku«): osebna raba,
 * Lina je AI in dela napake, uporaba na lastno odgovornost, Safeer ne prevzema odgovornosti, nadzor in obseg dela doloci uporabnik.
 *
 * Odlocitev (24. 11. 2026, NALOGA »sprejem klicev ne sme pasti na obstojecih namestitvah«):
 * - Nova namestitev brez »Razumem« ne prevzema klicev (klic zvoni kot obicajno).
 * - Ze namescena Lina (posodobitev cez starejso razlicico) prevzema klice kot prej, dokler opozorila ne potrdi; opozorilo se pokaze
 *   ob naslednjem odprtju. Potrditev katerekoli razlicice velja za klice (sprememba besedila ne ustavi klicev, samo pokaze znova).
 * - Naloge za racunalnik, odgovori Claude Code in gradnje samo s potrditvijo TRENUTNE razlicice - tudi na obstojeci namestitvi.
 * Neznano stanje (shramba ni berljiva) = kot nova namestitev / brez potrditve.
 */
object OpozoriloLine {
    /** Razlicica besedila (first_run_body v sl in en). Ob spremembi besedila povecaj in posodobi ZGOSTITEV_BESEDILA. */
    const val RAZLICICA = 1
    /** SHA-256(sl + NUL + en) besedila first_run_body; preizkus pade, ce se besedilo spremeni brez nove razlicice. */
    const val ZGOSTITEV_BESEDILA = "73107a9a70e076f8bcc6742c0ce7dded470ad8be568f9c00b1b773d6bdf6365e"

    enum class Namestitev { NOVA, OBSTOJECA }

    fun smeSprejematiKlice(potrjena: Int?, namestitev: Namestitev?): Boolean =
        (potrjena != null && potrjena > 0) || namestitev == Namestitev.OBSTOJECA

    fun smeDelati(potrjena: Int?): Boolean = potrjena == RAZLICICA

    fun pokazi(potrjena: Int?): Boolean = potrjena != RAZLICICA

    /**
     * Obstojeca = paket posodobljen cez starejso namestitev (lastUpdateTime > firstInstallTime) IN ima ze nastavitve klicev ali
     * povezave. Po »Pocisti podatke« nastavitev ni, zato taka namestitev velja za novo (pregled 24. 11. 2026).
     */
    fun namestitevIzCasov(prvaNamestitev: Long, zadnjaPosodobitev: Long, stariPodatki: Boolean): Namestitev =
        if (zadnjaPosodobitev > prvaNamestitev && stariPodatki) Namestitev.OBSTOJECA else Namestitev.NOVA

    /**
     * Oznaka se izracuna samo, ce se ni shranjena (prvi, ki pride - zaslon ali klic), in se nato ne racuna znova: kasnejsa
     * posodobitev nove namestitve je ne sme spremeniti v obstojeco. Vrne (oznaka, ali jo je treba zapisati).
     */
    fun oznakaNamestitve(shranjeno: Namestitev?, izracunaj: () -> Namestitev): Pair<Namestitev, Boolean> =
        if (shranjeno != null) shranjeno to false else izracunaj() to true
}
