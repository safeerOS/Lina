package si.safeer.lina.asistent

import si.safeer.lina.podpis.OdgovorLine
import si.safeer.lina.podpis.PovezavaZLino
import si.safeer.lina.samostojna.PrenosPoPoti

/**
 * Povezava z Lino na racunalniku s samodejno izbiro poti kot v Safeer OS: najprej domaci naslov (LAN), ob nedosegljivosti
 * takoj rele Global Linka ([rele], null dokler prenosa prek releja na telefonu ni). Uporabnik poti ne izbira.
 * Streznikov odgovor (tudi napaka) pomeni dosegljivo pot; samo OdgovorLine.Nedosegljiva je neuspeh poti.
 */
class IzbirnaPovezava(
    private val lan: PovezavaZLino,
    private val rele: PovezavaZLino?,
    private val prenos: PrenosPoPoti,
) : PovezavaZLino {
    private fun po(klic: (PovezavaZLino) -> OdgovorLine): OdgovorLine =
        prenos.izvedi({ klic(lan).takeUnless { it is OdgovorLine.Nedosegljiva } },
            rele?.let { r -> { klic(r).takeUnless { it is OdgovorLine.Nedosegljiva } } }) ?: OdgovorLine.Nedosegljiva

    override fun naloga(telo: String) = po { it.naloga(telo) }
    override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) =
        po { it.dogodki(id, posiljatelj, cas, enkratni, podpis, od, cakaS) }
    override fun klici(telo: String) = po { it.klici(telo) }
    override fun odobritev(telo: String) = po { it.odobritev(telo) }
    override fun ustavi(telo: String) = po { it.ustavi(telo) }
    override fun seznani(telo: String) = po { it.seznani(telo) }
    override fun stanjeSeznanitve(koda: String) = po { it.stanjeSeznanitve(koda) }
    override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        po { it.stanjeSeje(posiljatelj, cas, enkratni, podpis) }

    fun zapri() {
        (lan as? HttpPovezavaZLino)?.zapri()
        (rele as? HttpPovezavaZLino)?.zapri()
    }
}
