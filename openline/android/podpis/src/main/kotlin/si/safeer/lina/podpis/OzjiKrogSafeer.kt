package si.safeer.lina.podpis

/**
 * Potrditev Line v ozji krog Safeer Linka z enim dotikom prek Safeer Phone/OS na istem telefonu (lastnik 14. 11. 2026,
 * AGENTS.md »Seznanitev v ozji krog«; naloga T4 15. 11. 2026). Cista pravila (brez Androida); Android lepilo je
 * app/asistent/OzjiKrogSafeer.kt. Pot asistentke: tajnica (klici) te poti nikoli ne uporabi.
 *
 * Pogodba (Android-tv src/main/kotlin/si/safeer/tv/link/OzjiKrogSorodnikPravila.kt, preizkus tam in tu): Lina odpre
 * okno Safeer z startActivityForResult in namero [DEJANJE] z id-jem in javnim kljucem; okno ZASCITENO z dovoljenjem
 * ravni signature (si.safeer.tv.permission.LINK) uporabnik potrdi enkrat. Odgovor: RESULT_OK + [POLJE_IZID].
 *
 * Varnost: (1) cilj je izrecna komponenta v aplikaciji z DOVOLJENIM imenom paketa IN istim podpisom kot Lina - namera
 * brez cilja bi jo lahko prestregla tuja aplikacija, ki napove isto dejanje; (2) uspeh je samo RESULT_OK z znanim izidom;
 * (3) Lina nikoli ne poslje imena ali skrivnosti, samo javni kljuc in id iz njega; (4) brez potrditve v Safeerju v krog
 * nihce ne pride - Lina sama ne more vpisati sebe.
 */
object OzjiKrogSafeer {
    const val DEJANJE = "si.safeer.tv.OZJI_KROG_POTRDI"
    const val POLJE_ID = "id"
    const val POLJE_KLJUC = "kljuc"
    const val POLJE_IZID = "izid"

    /** Aplikacije Safeer z oknom potrditve, po prednosti (telefon pred Safeer OS pred tablico). */
    val DOVOLJENI_PAKETI: List<String> = listOf("si.safeer.phone", "si.safeer.os", "si.safeer.tablet")

    /** Najvec znakov javnega kljuca (EC P-256 SPKI v base64 je ~124); enaka meja kot na strani Safeer. */
    const val NAJVEC_KLJUC = 256

    /** Aplikacija, ki je na napravi in ponuja okno potrditve (po Androidu: paket, ali ima isti podpis kot Lina). */
    data class Kandidat(val paket: String, val podpisUjemanje: Boolean)

    /**
     * Izbere paket, kamor Lina poslje zahtevo: prvi iz [DOVOLJENI_PAKETI] z istim podpisom. Paket, ki ni na seznamu, ali
     * se podpis ne ujema, se ne uporabi nikoli (tudi ce edini ponuja dejanje). null = Safeerja ni (ali ni ozjega kroga).
     */
    fun izberiCilj(kandidati: List<Kandidat>): String? =
        DOVOLJENI_PAKETI.firstOrNull { p -> kandidati.any { it.paket == p && it.podpisUjemanje } }

    /** Polja zahteve; null, ce id ni TOCNO id iz kljuca ali je kljuc predolg/neveljaven (brez poskusa vpisa). */
    fun zahteva(id: String, kljuc: String): Map<String, String>? {
        if (kljuc.isBlank() || kljuc.length > NAJVEC_KLJUC) return null
        val izpeljan = try { KrogKljuc.idIzKljuca(kljuc) } catch (_: Throwable) { return null }
        if (id != izpeljan) return null
        return mapOf(POLJE_ID to id, POLJE_KLJUC to kljuc)
    }

    enum class Izid { V_KROGU, ZE_V_KROGU, ZAVRNJENO, NAPAKA }

    /**
     * Izid iz odgovora okna. Uspeh samo ob RESULT_OK z znanim izidom; prazno ali neznano ob RESULT_OK = NAPAKA (ne
     * domnevamo uspeha). Preklic (uporabnik pritisne »Preklici«) ni napaka.
     */
    fun izid(resultOk: Boolean, izid: String?): Izid = when {
        resultOk && izid == "dodano" -> Izid.V_KROGU
        resultOk && izid == "ze_v_krogu" -> Izid.ZE_V_KROGU
        !resultOk && izid == "zavrnjeno" -> Izid.ZAVRNJENO
        else -> Izid.NAPAKA
    }

    /** Ali pokazati gumb »Potrdi v ozji krog«: samo ko je Safeer na voljo in Lina se ni v krogu (ne ponujaj, kar ne uspe). */
    fun pokaziGumb(ciljNaVoljo: Boolean, vKrogu: Boolean): Boolean = ciljNaVoljo && !vKrogu

    /** Uspeh, ki ga shranimo (Lina se naslednjic ne ponuja znova); preklic ali napaka se ne shrani. */
    fun jeUspeh(i: Izid): Boolean = i == Izid.V_KROGU || i == Izid.ZE_V_KROGU
}
