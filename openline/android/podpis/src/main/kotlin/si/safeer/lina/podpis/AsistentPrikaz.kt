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
)

data class PrikazAsistenta(
    val seznani: Boolean,
    val pozabi: Boolean,
    val vnos: Boolean,
    val poslji: Boolean,
    val ustavi: Boolean,
    val odobritev: Boolean,
)

object AsistentPrikaz {
    fun izracunaj(s: StanjeAsistenta): PrikazAsistenta {
        val prosto = s.seznanjen && !s.nalogaTece && !s.posiljam
        return PrikazAsistenta(
            seznani = !s.seznanjen && !s.cakaPotrditev,
            pozabi = s.seznanjen && !s.nalogaTece,
            vnos = prosto,
            poslji = prosto,
            ustavi = s.seznanjen && s.nalogaTece,
            odobritev = s.seznanjen && s.nalogaTece && s.odprtaOdobritev != null,
        )
    }
}
