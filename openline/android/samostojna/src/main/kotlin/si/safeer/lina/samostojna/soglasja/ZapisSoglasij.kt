package si.safeer.lina.samostojna.soglasja

/**
 * Besedilni zapis soglasij za shrambo v aplikaciji (vrstica: VRSTA, obseg, cas; locilo tabulator). Visoko tvegana in
 * neznana soglasja se ne zapisejo in se ob branju zavrzejo (rocni vpis ali stara razlicica ne sme dati trajnega dovoljenja).
 */
object ZapisSoglasij {
    fun zapisi(soglasja: List<Soglasje>): String = soglasja
        .filter { !it.vrsta.visokoTveganje && it.obseg.vrednost.none { c -> c == '\t' || c == '\n' } }
        .joinToString("\n") { "${it.vrsta.name}\t${it.obseg.vrednost}\t${it.casMs}" }

    fun preberi(besedilo: String?): List<Soglasje> = besedilo.orEmpty().lines().mapNotNull { v ->
        val d = v.split("\t")
        if (d.size != 3 || d[1].isEmpty()) return@mapNotNull null
        val vrsta = VrstaDejanja.entries.firstOrNull { it.name == d[0] }?.takeUnless { it.visokoTveganje } ?: return@mapNotNull null
        val cas = d[2].toLongOrNull() ?: return@mapNotNull null
        Soglasje(vrsta, Obseg(d[1]), cas)
    }
}
