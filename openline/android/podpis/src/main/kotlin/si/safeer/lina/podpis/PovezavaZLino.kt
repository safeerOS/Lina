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
    /** GET /gradnje (24. 11. 2026): stanje gradenj na GitHubu; samo domace omrezje (od zunaj 403). Privzeto 404 kot stara Lina. */
    fun stanjeGradenj(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
    /** POST /gradnja/predlog: nic ne zazene. */
    fun predlogGradnje(telo: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
    /** POST /gradnja/potrdi: zagon po lastnikovem podpisanem gumbu. */
    fun potrditevGradnje(telo: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
    /** GET /agent-naloge (24. 11. 2026): vrsta nalog agentov; samo domace omrezje. Privzeto 404 kot stara Lina. */
    fun stanjeAgentNalog(posiljatelj: String, cas: Long, enkratni: String, podpis: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
    /** POST /agent-naloga/dodeli: podpisana dodelitev = lastnikova potrditev za en zagon. */
    fun dodeliAgentNalogo(telo: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
    /** POST /agent-naloga/preklici. */
    fun prekliciAgentNalogo(telo: String): OdgovorLine = OdgovorLine.Napaka(404, "ni")
}

/** Kaj uporabnik izve ob napaki (kljuc besedila v aplikaciji). Vse 403 so ista koda (Lina ne pove razloga). */
enum class SporociloNapake { NEDOSEGLJIVA, CLAUDE_CODE_NI, ZAVRNJENO, PREVEC, NI_NALOGE, NAPAKA, NEZNAN_IZID }

/**
 * T1 (pregled 0213): izid zahteve, ki se je koncala brez odgovora Line. [oddano] = zahteva je bila ze zapisana v vzpostavljeno
 * povezavo (TLS z Lino uspel); [spreminja] = POST ali prenos, ki ga Lina izvede (naloga, gradnja, agent, odobritev).
 */
object IzidOddaje {
    const val NEZNAN = "neznan-izid"

    /**
     * Oddana zahteva, ki spreminja stanje, brez odgovora: Lina jo je morda ze izvedla. Druga pot (rele) bi poslala ISTO telo z istim
     * enkratnim nizom (Lina ga zavrne s 403, telefon bi lazno pokazal »zavrnjeno«) ali dvojni zagon; zato izid »neznan«, brez ponovitve.
     * Neuspela povezava (zunaj doma LAN ne odgovori, TLS ne uspe) in branje ostaneta Nedosegljiva: naslednja pot se poskusi.
     */
    fun poNapaki(oddano: Boolean, spreminja: Boolean): OdgovorLine =
        if (oddano && spreminja) OdgovorLine.Napaka(0, NEZNAN) else OdgovorLine.Nedosegljiva

    fun jeNeznan(o: OdgovorLine): Boolean = o is OdgovorLine.Napaka && o.status == 0 && o.koda == NEZNAN
}

object NapakaLine {
    fun sporocilo(o: OdgovorLine): SporociloNapake? = when (o) {
        is OdgovorLine.Ok -> null
        OdgovorLine.Nedosegljiva -> SporociloNapake.NEDOSEGLJIVA
        is OdgovorLine.Napaka -> when {
            IzidOddaje.jeNeznan(o) -> SporociloNapake.NEZNAN_IZID
            o.status == 503 -> SporociloNapake.CLAUDE_CODE_NI
            o.status == 403 -> SporociloNapake.ZAVRNJENO
            o.status == 429 -> SporociloNapake.PREVEC
            o.status == 404 -> SporociloNapake.NI_NALOGE
            else -> SporociloNapake.NAPAKA
        }
    }
}
