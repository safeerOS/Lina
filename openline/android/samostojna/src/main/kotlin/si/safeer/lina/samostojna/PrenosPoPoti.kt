package si.safeer.lina.samostojna

/**
 * Samodejna izbira poti kot v Safeer OS (core/link_neposredno.py, link_mesh.py): najprej kratek poskus domace poti (LAN),
 * ob neuspehu TAKOJ rezerva (rele Global Linka). Neuspeh poti se zapomni (IzbiraPoti: premor 300 s, podvaja do 1800 s,
 * sprememba omrezja ga izbrise); pot je "dobra" sele po uspesnem odgovoru. Uporabnik poti nikoli ne izbira.
 * [lan] / [rele] vrneta null, ce pot ni dosegljiva (strezniski odgovor, tudi napaka 4xx, je dosegljivost).
 */
class PrenosPoPoti(private val izbira: IzbiraPoti = IzbiraPoti()) {
    /** Vrne odgovor ali null, ce ni dosegljiva nobena pot. [rele] je null, ce Global Link ni nastavljen. */
    fun <T : Any> izvedi(lan: () -> T?, rele: (() -> T?)?): T? {
        val lanVPremoru = izbira.jeVPremoru(Pot.LAN)
        val vrstniRed = if (lanVPremoru && rele != null) listOf(Pot.RELE to rele, Pot.LAN to lan)
        else if (rele != null) listOf(Pot.LAN to lan, Pot.RELE to rele)
        else listOf(Pot.LAN to lan)
        for ((pot, klic) in vrstniRed) {
            // Pot v premoru preskocimo, razen ce je to zadnja moznost (potem poskusimo, da uporabnik ne obtici).
            if (izbira.jeVPremoru(pot) && pot != vrstniRed.last().first) continue
            val odg = try { klic() } catch (_: Exception) { null }
            if (odg != null) { izbira.uspeh(pot); return odg }
            izbira.neuspeh(pot)
        }
        return null
    }

    fun spremembaOmrezja() = izbira.spremembaOmrezja()
}
