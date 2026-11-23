package si.safeer.lina.asistent

import si.safeer.lina.podpis.OdgovorLine
import si.safeer.lina.podpis.PovezavaZLino
import si.safeer.lina.samostojna.PrenosPoPoti

/**
 * Povezava z Lino na racunalniku s samodejno izbiro poti kot v Safeer OS: LAN, nato neposredna pot od zunaj
 * ([neposredno], hitrejsa od releja), nato rele ([neposredno] in [rele] sta null, dokler prenosa na telefonu ni). Uporabnik poti ne izbira.
 * Streznikov odgovor (tudi napaka) pomeni dosegljivo pot; samo OdgovorLine.Nedosegljiva je neuspeh poti.
 */
class IzbirnaPovezava(
    private val lan: PovezavaZLino,
    private val neposredno: PovezavaZLino?,
    private val rele: PovezavaZLino?,
    private val prenos: PrenosPoPoti,
) : PovezavaZLino {
    private fun po(klic: (PovezavaZLino) -> OdgovorLine): OdgovorLine =
        prenos.izvedi(pot(lan, klic), neposredno?.let { pot(it, klic) }, rele?.let { pot(it, klic) }) ?: OdgovorLine.Nedosegljiva

    private fun pot(p: PovezavaZLino, klic: (PovezavaZLino) -> OdgovorLine): () -> OdgovorLine? =
        { klic(p).takeUnless { it is OdgovorLine.Nedosegljiva } }

    override fun naloga(telo: String) = po { it.naloga(telo) }
    override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) =
        po { it.dogodki(id, posiljatelj, cas, enkratni, podpis, od, cakaS) }
    override fun klici(telo: String) = po { it.klici(telo) }
    override fun sinhron(telo: String) = po { it.sinhron(telo) }
    override fun odobritev(telo: String) = po { it.odobritev(telo) }
    override fun ustavi(telo: String) = po { it.ustavi(telo) }
    override fun seznani(telo: String) = po { it.seznani(telo) }
    override fun stanjeSeznanitve(koda: String) = po { it.stanjeSeznanitve(koda) }
    override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        po { it.stanjeSeje(posiljatelj, cas, enkratni, podpis) }
    override fun stanjeDodatkov(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        po { it.stanjeDodatkov(posiljatelj, cas, enkratni, podpis) }
    override fun dodatek(telo: String) = po { it.dodatek(telo) }

    fun zapri() {
        (lan as? HttpPovezavaZLino)?.zapri()
        (neposredno as? HttpPovezavaZLino)?.zapri()
        (rele as? HttpPovezavaZLino)?.zapri()
    }
}
