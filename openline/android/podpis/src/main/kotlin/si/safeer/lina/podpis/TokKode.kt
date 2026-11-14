package si.safeer.lina.podpis

import si.safeer.lina.seznanitev.KodaOdjemalec

/** Izid enega kroga SPAKE2 ali celega toka s kodo (pogodba lina-asistent2 @abc0bd3). */
sealed class IzidKroga {
    object CakaKodo : IzidKroga()
    object NapacnaKoda : IzidKroga()
    object NovKrog : IzidKroga()
    data class Sprejeto(val klici: KliciIzKode?) : IzidKroga()
    data class Konec(val napaka: NapakaKode) : IzidKroga()
}

/** Poti /koda/spake, /koda/potrdi in /koda/odpovej (v aplikaciji pripeto na videni odtis); potrdi sestavi in podpise klicatelj. */
interface PrenosKode {
    fun spake(telo: String): OdgovorLine
    fun potrdi(cb: String, mac: String): OdgovorLine
    fun odpovej(telo: String): OdgovorLine
}

/**
 * Krogi na ISTEM pair_id (brez novega /koda/zacni). Ce cA ne velja, telefon /koda/potrdi NE poslje, ampak takoj /koda/odpovej
 * (409/404 samo v dnevnik, brez ponovitve). /koda/potrdi mora priti v ROK_POTRDI_MS po odgovoru kroga, sicer nov krog.
 */
class TokKode(
    private val id: String,
    private val pairId: String,
    private val vidniOdtis: String,
    private val kljuc: String,
    private val prenos: PrenosKode,
    private val zdaj: () -> Long = System::currentTimeMillis,
    private val dnevnik: (String) -> Unit = {},
) {
    private fun napakaOd(o: OdgovorLine): NapakaKode = when (o) {
        is OdgovorLine.Napaka -> KodaProtokol.napaka(o.status, o.koda)
        else -> NapakaKode.NEDOSEGLJIVA
    }

    fun krog(koda: String): IzidKroga {
        val odj = KodaOdjemalec.zacni(koda, id, pairId, vidniOdtis) ?: return IzidKroga.Konec(NapakaKode.NAPAKA)
        val o = prenos.spake(KodaProtokol.teloSpake(pairId, id, odj.pb))
        if (o !is OdgovorLine.Ok) {
            val n = napakaOd(o)
            return if (n == NapakaKode.CAKA_KODO) IzidKroga.CakaKodo else IzidKroga.Konec(n)
        }
        val odgovorjeno = zdaj()
        val (pa, ca) = KodaProtokol.razberiSpake(o.telo) ?: return IzidKroga.Konec(NapakaKode.NAPAKA)
        val cb = odj.potrdi(pa, ca)
        if (cb == null) {
            val od = prenos.odpovej(KodaProtokol.teloOdpovej(pairId, id))
            if (od !is OdgovorLine.Ok || !KodaProtokol.odpovedano(od.telo)) dnevnik("odpoved kroga: ${napakaOd(od)}")
            return IzidKroga.NapacnaKoda
        }
        val mac = odj.mac(kljuc) ?: return IzidKroga.Konec(NapakaKode.NAPAKA)
        // Po roku bi Lina vrnila 409 manjka_korak: potrditve ne posljemo, krog ponovimo.
        if (zdaj() - odgovorjeno > ROK_POTRDI_MS - VARNOST_MS) return IzidKroga.NovKrog
        val p = prenos.potrdi(cb, mac)
        if (p is OdgovorLine.Ok) return KodaProtokol.razberiPotrdi(p.telo)?.let { IzidKroga.Sprejeto(it.second) }
            ?: IzidKroga.Konec(NapakaKode.NAPAKA)
        return when (val n = napakaOd(p)) {
            NapakaKode.MANJKA_KORAK -> IzidKroga.NovKrog
            NapakaKode.NAPACNA_KODA -> IzidKroga.NapacnaKoda
            else -> IzidKroga.Konec(n)
        }
    }

    /** Nacin B: ista koda; po napacni kodi Lina vnos pri cakajocem telefonu odpre znova, telefon med tem dobiva 409 caka_kodo. */
    fun nacinB(koda: String, doMs: Long, spi: (Long) -> Unit, obNapacni: () -> Unit, prekinjeno: () -> Boolean = { false }): IzidKroga {
        var novih = 0
        while (!prekinjeno()) {
            if (zdaj() > doMs) return IzidKroga.Konec(NapakaKode.POTEKLO)
            when (val r = krog(koda)) {
                IzidKroga.CakaKodo -> spi(CAKAJ_MS)
                IzidKroga.NapacnaKoda -> { obNapacni(); spi(CAKAJ_MS) }
                IzidKroga.NovKrog -> if (++novih > NAJVEC_NOVIH) return IzidKroga.Konec(NapakaKode.NAPAKA)
                else -> return r
            }
        }
        return IzidKroga.Konec(NapakaKode.PREKINJENO)
    }

    /** Nacin A: po napacni kodi uporabnik vtipka novo ([novaKoda], null = preklic) in nov krog gre na isti pair_id. */
    fun nacinA(koda: String, doMs: Long, novaKoda: () -> String?): IzidKroga {
        var k = koda
        var novih = 0
        while (true) {
            if (zdaj() > doMs) return IzidKroga.Konec(NapakaKode.POTEKLO)
            when (val r = krog(k)) {
                IzidKroga.NapacnaKoda -> k = novaKoda() ?: return IzidKroga.Konec(NapakaKode.PREKINJENO)
                IzidKroga.NovKrog -> if (++novih > NAJVEC_NOVIH) return IzidKroga.Konec(NapakaKode.NAPAKA)
                IzidKroga.CakaKodo -> return IzidKroga.Konec(NapakaKode.NAPAKA) // v nacinu A Lina kode ne caka
                else -> return r
            }
        }
    }

    companion object {
        const val ROK_POTRDI_MS = 10_000L
        const val VARNOST_MS = 1_000L
        const val CAKAJ_MS = 2_500L
        /** Samodejni novi krogi po izteku roka (vsak krog steje v mejah Line), nato konec. */
        const val NAJVEC_NOVIH = 1
    }
}
