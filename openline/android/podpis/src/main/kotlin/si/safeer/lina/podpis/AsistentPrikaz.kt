package si.safeer.lina.podpis

/**
 * Kaj zavihek Asistent pokaze (pravilo »kar ni narejeno, se ne pokaze«: nobenega gumba, ki ne bi imel ucinka).
 * Seznanitev s QR je vedno na voljo; vnos naloge samo, ko je telefon seznanjen in nobena naloga ne tece; Ustavi samo med
 * nalogo; Dovoli/Zavrni samo ob odprti zahtevi za odobritev.
 */
data class StanjeAsistenta(
    val seznanjen: Boolean,
    val nalogaTece: Boolean,
    val odprtaOdobritev: DogodekLine.Odobritev?,
    val posiljam: Boolean = false,
    /** Telefon se je prijavil z QR in caka, da ga lastnik v Lini na racunalniku potrdi. */
    val cakaPotrditev: Boolean = false,
    /** Claude Code je vprasal in caka odgovor (reply vrsta=vprasanje); lastnik lahko odgovori v isto nalogo (23. 11. 2026). */
    val cakaOdgovor: Boolean = false,
    /** Naloga 23t: potrjena naloga caka, da Lina na racunalniku odpre Claude Code (Ustavi jo preklice, nova naloga jo zamenja). */
    val cakaSejo: Boolean = false,
)

data class PrikazAsistenta(
    val seznani: Boolean,
    val pozabi: Boolean,
    val vnos: Boolean,
    val poslji: Boolean,
    val ustavi: Boolean,
    val odobritev: Boolean,
    /** Vnos in Poslji med nalogo posljeta ODGOVOR v isto nalogo (POST /nadaljuj), ne nove naloge. */
    val odgovor: Boolean = false,
)

object AsistentPrikaz {
    fun izracunaj(s: StanjeAsistenta): PrikazAsistenta {
        val prosto = s.seznanjen && !s.nalogaTece && !s.posiljam
        val odgovor = s.seznanjen && s.nalogaTece && s.cakaOdgovor && !s.posiljam
        return PrikazAsistenta(
            seznani = !s.seznanjen && !s.cakaPotrditev,
            pozabi = s.seznanjen && !s.nalogaTece,
            vnos = prosto || odgovor,
            poslji = prosto || odgovor,
            ustavi = s.seznanjen && (s.nalogaTece || s.cakaSejo),
            odobritev = s.seznanjen && s.nalogaTece && s.odprtaOdobritev != null,
            odgovor = odgovor,
        )
    }
}
