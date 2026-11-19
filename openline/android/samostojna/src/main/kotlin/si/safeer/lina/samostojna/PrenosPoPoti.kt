package si.safeer.lina.samostojna

/**
 * Samodejna izbira poti kot v Safeer OS (core/link_neposredno.py, link_mesh.py). Vrstni red od najhitrejse:
 * LAN -> GLOBAL_NEPOSREDNO (odhodna povezava TCP naravnost do doma, brez releja) -> RELE (rezerva). Pri pogovoru v zivo
 * je pomemben vsak ms, zato rele ni nikoli pred neposredno potjo, ki deluje. Neuspeh poti se zapomni (IzbiraPoti: premor
 * 300 s, podvaja do 1800 s, sprememba omrezja ga izbrise): uporabnik caka kvecjemu enkrat. Poti, ki je ni (null), ni.
 * Vsaka pot vrne null, ce ni dosegljiva (strezniski odgovor, tudi napaka 4xx, je dosegljivost).
 */
class PrenosPoPoti(private val izbira: IzbiraPoti = IzbiraPoti()) {
    fun <T : Any> izvedi(lan: (() -> T?)?, neposredno: (() -> T?)?, rele: (() -> T?)?): T? {
        val poti = listOfNotNull(
            lan?.let { Pot.LAN to it }, neposredno?.let { Pot.GLOBAL_NEPOSREDNO to it }, rele?.let { Pot.RELE to it },
        )
        // Pot v premoru gre na konec (hitrejse poti so se vedno pred rezervo); ce je vse v premoru, poskusimo vse po vrsti,
        // da uporabnik ne obtici.
        val urejeno = poti.filterNot { izbira.jeVPremoru(it.first) } + poti.filter { izbira.jeVPremoru(it.first) }
        for ((pot, klic) in urejeno) {
            val odg = try { klic() } catch (_: Exception) { null }
            if (odg != null) { izbira.uspeh(pot); return odg }
            izbira.neuspeh(pot)
        }
        return null
    }

    fun spremembaOmrezja() = izbira.spremembaOmrezja()
}
