package si.safeer.lina.podpis

import java.io.Closeable

/** Pot, po kateri je zahteva DEJANSKO dosegla Lino (zavihek Racunalnik jo pokaze; nikoli ugibana). */
enum class PotLine { DOMACE_OMREZJE, NEPOSREDNO, GLOBAL_LINK }

/**
 * Povezava z Lino na racunalniku s samodejno izbiro poti kot v Safeer OS: domace omrezje (LAN), nato neposredna pot od zunaj
 * ([neposredno]; Lina je za asistentko nima - ostane null), nato rele Global Link ([rele]; null, ce Lina na racunalniku releja
 * ni vklopila). Uporabnik poti ne izbira. Vrstni red in premore vodi [prenos] (aplikacija poda PrenosPoPoti.izvedi).
 * Streznikov odgovor (tudi napaka) pomeni dosegljivo pot; samo OdgovorLine.Nedosegljiva je neuspeh poti. [obIzidu] dobi pot,
 * po kateri je odgovor prisel, ali null, ce ni bila dosegljiva nobena.
 * Podpisi naprave in preverba odtisa so v vsaki poti enaki (vse so HttpPovezavaZLino z istim odtisom).
 */
class IzbirnaPovezava(
    private val lan: PovezavaZLino,
    private val neposredno: PovezavaZLino?,
    private val rele: PovezavaZLino?,
    private val prenos: (() -> OdgovorLine?, (() -> OdgovorLine?)?, (() -> OdgovorLine?)?) -> OdgovorLine?,
    private val obIzidu: (PotLine?) -> Unit = {},
) : PovezavaZLino, Closeable {
    /**
     * [oddaljeno] = pot je na belem seznamu Line za zunaj doma (POTI_ODDALJENO). Sinhronizacija, klici in seznanjanje gredo samo
     * po domacem omrezju: prek releja bi jih Lina zavrnila in vsaka zavrnitev bi polnila skupno omejitev releja (pregled 1).
     */
    private fun po(oddaljeno: Boolean = true, klic: (PovezavaZLino) -> OdgovorLine): OdgovorLine {
        var uspela: PotLine? = null
        val odg = prenos(pot(lan, PotLine.DOMACE_OMREZJE, klic) { uspela = it },
            neposredno?.takeIf { oddaljeno }?.let { pot(it, PotLine.NEPOSREDNO, klic) { p -> uspela = p } },
            rele?.takeIf { oddaljeno }?.let { pot(it, PotLine.GLOBAL_LINK, klic) { p -> uspela = p } })
        obIzidu(if (odg == null) null else uspela)
        return odg ?: OdgovorLine.Nedosegljiva
    }

    private fun pot(p: PovezavaZLino, ime: PotLine, klic: (PovezavaZLino) -> OdgovorLine, uspeh: (PotLine) -> Unit): () -> OdgovorLine? =
        { klic(p).takeUnless { it is OdgovorLine.Nedosegljiva }?.also { uspeh(ime) } }

    /**
     * Klic z drugim izidom kot OdgovorLine (prenos APK: HttpPovezavaZLino.prenesiApk), ista izbira poti in premori kot [po].
     * [klic] vrne null SAMO, ce pot ni dosegljiva (noben odgovor Line) - sicer se naslednja pot ne poskusi (isti enkratni niz).
     * Vrne izid in pot, po kateri je prisel (zaslon pove, ce je prenos prek Global Linka spodletel), ali null.
     */
    fun <T : Any> poPoteh(klic: (PovezavaZLino) -> T?): Pair<T, PotLine>? {
        var izid: Pair<T, PotLine>? = null
        fun ovoj(p: PovezavaZLino, ime: PotLine): () -> OdgovorLine? = { klic(p)?.let { izid = it to ime; OdgovorLine.Ok("") } }
        prenos(ovoj(lan, PotLine.DOMACE_OMREZJE), neposredno?.let { ovoj(it, PotLine.NEPOSREDNO) }, rele?.let { ovoj(it, PotLine.GLOBAL_LINK) })
        obIzidu(izid?.second)
        return izid
    }

    override fun naloga(telo: String) = po { it.naloga(telo) }
    override fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int) =
        po { it.dogodki(id, posiljatelj, cas, enkratni, podpis, od, cakaS) }
    override fun klici(telo: String) = po(oddaljeno = false) { it.klici(telo) }
    override fun sinhron(telo: String) = po(oddaljeno = false) { it.sinhron(telo) }
    override fun odobritev(telo: String) = po { it.odobritev(telo) }
    override fun ustavi(telo: String) = po { it.ustavi(telo) }
    override fun nadaljuj(telo: String) = po { it.nadaljuj(telo) }
    override fun seznani(telo: String) = po(oddaljeno = false) { it.seznani(telo) }
    override fun stanjeSeznanitve(koda: String) = po(oddaljeno = false) { it.stanjeSeznanitve(koda) }
    override fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        po { it.stanjeSeje(posiljatelj, cas, enkratni, podpis) }
    override fun stanjeDodatkov(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        po { it.stanjeDodatkov(posiljatelj, cas, enkratni, podpis) }
    override fun dodatek(telo: String) = po { it.dodatek(telo) }
    // Gradnje in naloge agentov tudi prek Global Linka (lastnik 25. 11. 2026 »da«; poti so v POTI_ODDALJENO na racunalniku).
    override fun stanjeGradenj(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        po { it.stanjeGradenj(posiljatelj, cas, enkratni, podpis) }
    override fun predlogGradnje(telo: String) = po { it.predlogGradnje(telo) }
    override fun potrditevGradnje(telo: String) = po { it.potrditevGradnje(telo) }
    override fun stanjeAgentNalog(posiljatelj: String, cas: Long, enkratni: String, podpis: String) =
        po { it.stanjeAgentNalog(posiljatelj, cas, enkratni, podpis) }
    override fun dodeliAgentNalogo(telo: String) = po { it.dodeliAgentNalogo(telo) }
    override fun prekliciAgentNalogo(telo: String) = po { it.prekliciAgentNalogo(telo) }

    fun zapri() = close()

    override fun close() {
        for (p in listOfNotNull(lan, neposredno, rele)) try { (p as? Closeable)?.close() } catch (_: Exception) {}
    }
}
