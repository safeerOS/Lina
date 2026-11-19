package si.safeer.lina.samostojna.soglasja

/**
 * Trajna soglasja uporabnika. Klic `dodaj` sme priti SAMO iz potrditve v zaslonu aplikacije (nikoli iz klica,
 * sporocila, spleta, drugega agenta ali opomnika): vrednost `izvor` mora nastaviti koda zaslona, ne podatki od zunaj.
 * Zaklep je skupen za vse primerke, ker si delijo isto shrambo (preklic ne sme biti razveljavljen z zastarelim seznamom).
 */
class TrajnaSoglasja(private val shramba: ShrambaSoglasij) {

    private companion object {
        val ZAKLEP = Any()
    }


    fun jeDovoljeno(vrsta: VrstaDejanja, obseg: Obseg): Boolean {
        synchronized(ZAKLEP) {
            if (vrsta.visokoTveganje) return false
            val vsa = shramba.preberi()
            return vsa.any { it.vrsta == vrsta && (it.obseg == Obseg.VSE || it.obseg == obseg) }
        }
    }

    fun dodaj(vrsta: VrstaDejanja, obseg: Obseg, izvor: Izvor, casMs: Long) {
        synchronized(ZAKLEP) {
            if (izvor != Izvor.UPORABNIK_V_APLIKACIJI) {
                throw IllegalArgumentException("Soglasje se lahko doda samo prek izvora UPORABNIK_V_APLIKACIJI. Zavrnjen izvor: $izvor")
            }
            if (vrsta.visokoTveganje) {
                throw IllegalArgumentException("Visoko tvegana dejanja ne morejo imeti trajnega soglasja.")
            }
            val trenutna = shramba.preberi().toMutableList()
            trenutna.removeAll { it.vrsta == vrsta && it.obseg == obseg }
            trenutna.add(Soglasje(vrsta, obseg, casMs))
            shramba.shrani(trenutna)
        }
    }

    fun odstrani(vrsta: VrstaDejanja) {
        synchronized(ZAKLEP) {
            val trenutna = shramba.preberi().toMutableList()
            trenutna.removeAll { it.vrsta == vrsta }
            shramba.shrani(trenutna)
        }
    }

    fun odstraniVsa() {
        synchronized(ZAKLEP) {
            shramba.shrani(emptyList())
        }
    }

    fun seznam(): List<Soglasje> {
        synchronized(ZAKLEP) {
            return shramba.preberi()
        }
    }
}
