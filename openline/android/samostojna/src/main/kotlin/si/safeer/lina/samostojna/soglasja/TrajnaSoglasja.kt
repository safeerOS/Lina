package si.safeer.lina.samostojna.soglasja

class TrajnaSoglasja(private val shramba: ShrambaSoglasij) {

    @Synchronized
    fun jeDovoljeno(vrsta: VrstaDejanja, obseg: Obseg): Boolean {
        if (vrsta.visokoTveganje) return false
        val vsa = shramba.preberi()
        return vsa.any { it.vrsta == vrsta && (it.obseg == Obseg.VSE || it.obseg == obseg) }
    }

    @Synchronized
    fun dodaj(vrsta: VrstaDejanja, obseg: Obseg, izvor: Izvor, casMs: Long) {
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

    @Synchronized
    fun odstrani(vrsta: VrstaDejanja) {
        val trenutna = shramba.preberi().toMutableList()
        trenutna.removeAll { it.vrsta == vrsta }
        shramba.shrani(trenutna)
    }

    @Synchronized
    fun odstraniVsa() {
        shramba.shrani(emptyList())
    }

    fun seznam(): List<Soglasje> {
        return shramba.preberi()
    }
}
