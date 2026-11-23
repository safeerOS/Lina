package si.safeer.lina.podpis

/** Izid ene zahteve na Lino na racunalniku. */
sealed class OdgovorLine {
    data class Ok(val telo: String) : OdgovorLine()
    /** HTTP napaka s kodo iz telesa {"napaka":...} (ali null). */
    data class Napaka(val status: Int, val koda: String?) : OdgovorLine()
    /** Ni povezave, napacen odtis, preusmeritev ali prekinitev. */
    object Nedosegljiva : OdgovorLine()
}

/** Povezava telefona z Lino (pogodba lina-asistent2 @e815ed0). Izvedba v aplikaciji: HTTPS s pripetim odtisom. */
interface PovezavaZLino {
    fun naloga(telo: String): OdgovorLine
    /** GET /dogodki je od T1-N3 podpisan (nizDogodkov); [podpis] je podpis niza iz (id, posiljatelj, cas, enkratni). */
    fun dogodki(id: String, posiljatelj: String, cas: Long, enkratni: String, podpis: String, od: Long, cakaS: Int): OdgovorLine
    /** POST /seznani/klici (T1-S1): pot klicev OpenLine po lastnikovem »Dodaj«. */
    fun klici(telo: String): OdgovorLine
    /** POST /sinhron (20. 11. 2026): podpisana izmenjava klicev, pogovora in navodil z racunalnikom. */
    fun sinhron(telo: String): OdgovorLine
    fun odobritev(telo: String): OdgovorLine
    fun ustavi(telo: String): OdgovorLine
    /** POST /nadaljuj (23. 11. 2026): odgovor v isto nalogo; starejsa Lina poti nima (404). */
    fun nadaljuj(telo: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
    fun seznani(telo: String): OdgovorLine
    fun stanjeSeznanitve(koda: String): OdgovorLine
    fun stanjeSeje(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine
    /** GET /dodatki (23. 11. 2026): stanje dodatkov na racunalniku; privzeto ga povezava nima (404 kot stara Lina). */
    fun stanjeDodatkov(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
    /** POST /dodatek (23. 11. 2026): vklop ali izklop enega dodatka. */
    fun dodatek(telo: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
}

/** Kaj uporabnik izve ob napaki (kljuc besedila v aplikaciji). Vse 403 so ista koda (Lina ne pove razloga). */
enum class SporociloNapake { NEDOSEGLJIVA, CLAUDE_CODE_NI, ZAVRNJENO, PREVEC, NI_NALOGE, NAPAKA }

object NapakaLine {
    fun sporocilo(o: OdgovorLine): SporociloNapake? = when (o) {
        is OdgovorLine.Ok -> null
        OdgovorLine.Nedosegljiva -> SporociloNapake.NEDOSEGLJIVA
        is OdgovorLine.Napaka -> when {
            o.status == 503 -> SporociloNapake.CLAUDE_CODE_NI
            o.status == 403 -> SporociloNapake.ZAVRNJENO
            o.status == 429 -> SporociloNapake.PREVEC
            o.status == 404 -> SporociloNapake.NI_NALOGE
            else -> SporociloNapake.NAPAKA
        }
    }
}
