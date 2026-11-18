package si.safeer.lina.samostojna

// Kartica nedavne dejavnosti na glavnem zaslonu.
data class Kartica(
    val id: String,
    val naslov: String,
    val podnaslov: String = "",
    val cas: String = ""
)

// Stanje povezave telefona z racunalnikom za sinhronizacijo.
enum class PovezavaStanje {
    NI_PARJENO,
    DOMA_LAN,
    GLOBAL_NEPOSREDNO,
    GLOBAL_RELE,
    NEDOSEGLJIVO
}

// Prikaz stanja povezave (besedilo, ikona in ali sinhronizacija trenutno tece).
data class PrikazPovezave(
    val stanje: PovezavaStanje,
    val besedilo: String,
    val ikona: String,
    val sinhronizacijaAktivna: Boolean
)

// Celotno stanje glavnega zaslona samostojne asistentke Line.
data class GlavniZaslonStanje(
    val vklopljena: Boolean = true,
    val faza: Faza = Faza.MIRUJE,
    val casSekunde: Int = 0,
    val nedavno: List<Kartica> = emptyList(),
    val zaslon: Zaslon = Zaslon.DOMOV,
    val povezava: PovezavaStanje = PovezavaStanje.NI_PARJENO,
    val sinhronizacijaAktivna: Boolean = false,
    val zmanjsanoGibanje: Boolean = false,
    val jezik: Jezik = Jezik.SL,
    val glasnost: Float = 0f
)

// Izracunan prikaz glavnega zaslona (brez cakanja in brez klicev omrezja).
data class Prikaz(
    val naslov: String,
    val oblaSvetla: Boolean,
    val oblaMirna: Boolean,
    val spodnjaVrsticaAktivna: Boolean,
    val snemanjeOmogoceno: Boolean,
    val casovnik: String,
    val polmerOble: Float,
    val animacijaAktivna: Boolean,
    val stolpciValovanja: List<Float>,
    val prikaziStikaloVklopa: Boolean,
    val povezavaPrikaz: PrikazPovezave?,
    val izbranZaslon: Zaslon,
    val zasloniSpodaj: List<ElementSpodnjeVrstice>,
    val delujeBrezRacunalnika: Boolean,
    val sinhronizacijaAktivna: Boolean,
    val nedavno: List<Kartica>
)

// Oblikuje cas v sekundah kot niz "m:ss".
fun oblikujCasovnik(casSekunde: Int): String {
    val varno = if (casSekunde < 0) 0 else casSekunde
    val minute = varno / 60
    val sekunde = varno % 60
    val sekundeNiz = if (sekunde < 10) "0$sekunde" else "$sekunde"
    return "$minute:$sekundeNiz"
}

// Izracuna prikaz povezave (besedilo + ikona) za podano stanje povezave.
fun prikazPovezave(stanje: PovezavaStanje, jezik: Jezik = Jezik.SL, sinhronizacijaAktivna: Boolean = false): PrikazPovezave {
    val b = besedila(jezik)
    return when (stanje) {
        PovezavaStanje.NI_PARJENO -> PrikazPovezave(
            stanje = stanje,
            besedilo = b.povezavaNiParjeno,
            ikona = "phone_standalone",
            sinhronizacijaAktivna = false
        )
        PovezavaStanje.DOMA_LAN -> PrikazPovezave(
            stanje = stanje,
            besedilo = b.povezavaDomaLan,
            ikona = "wifi_lan",
            sinhronizacijaAktivna = sinhronizacijaAktivna
        )
        PovezavaStanje.GLOBAL_NEPOSREDNO -> PrikazPovezave(
            stanje = stanje,
            besedilo = b.povezavaGlobalNeposredno,
            ikona = "global_direct",
            sinhronizacijaAktivna = sinhronizacijaAktivna
        )
        PovezavaStanje.GLOBAL_RELE -> PrikazPovezave(
            stanje = stanje,
            besedilo = b.povezavaGlobalRele,
            ikona = "global_relay",
            sinhronizacijaAktivna = sinhronizacijaAktivna
        )
        PovezavaStanje.NEDOSEGLJIVO -> PrikazPovezave(
            stanje = stanje,
            besedilo = b.povezavaNedosegljivo,
            ikona = "cloud_off",
            sinhronizacijaAktivna = false
        )
    }
}

// Sinhrono izracuna prikaz zaslona iz trenutnega stanja.
fun nakljucek(
    stanje: GlavniZaslonStanje,
    zmanjsanoGibanje: Boolean = stanje.zmanjsanoGibanje,
    jezik: Jezik = stanje.jezik
): Prikaz {
    val naslov = naslovZaStanje(stanje.vklopljena, stanje.faza, jezik)
    val oblaSvetla = stanje.vklopljena
    val mirnaFaza = stanje.faza == Faza.MIRUJE || stanje.faza == Faza.NAPAKA
    val oblaMirna = !stanje.vklopljena || zmanjsanoGibanje || mirnaFaza
    val spodnjaVrsticaAktivna = stanje.vklopljena
    val snemanjeOmogoceno = stanje.vklopljena
    val casovnik = oblikujCasovnik(stanje.casSekunde)

    val polmerOble = if (!stanje.vklopljena || zmanjsanoGibanje) {
        polmer(Faza.MIRUJE, glasnost = 0f, cas = 0L, zmanjsanoGibanje = true)
    } else {
        polmer(
            faza = stanje.faza,
            glasnost = stanje.glasnost,
            cas = stanje.casSekunde.toLong() * 1000L + 250L,
            zmanjsanoGibanje = false
        )
    }

    val animacijaAktivna = stanje.vklopljena && !zmanjsanoGibanje && stanje.faza != Faza.NAPAKA
    val stolpci = if (!animacijaAktivna) {
        List(5) { 0f }
    } else {
        val g = if (stanje.glasnost.isNaN()) 0f else stanje.glasnost.coerceIn(0f, 1f)
        listOf(0.3f * g, 0.6f * g, g, 0.6f * g, 0.3f * g)
    }

    // Stikalo za vklop asistentke se prikaze samo na domacem zaslonu (DOMOV).
    val prikaziStikaloVklopa = stanje.zaslon == Zaslon.DOMOV
    val podrobnostiPovezave = prikazPovezave(stanje.povezava, jezik, stanje.sinhronizacijaAktivna)
    val povezavaNaDomovu = if (stanje.zaslon == Zaslon.DOMOV) podrobnostiPovezave else null

    return Prikaz(
        naslov = naslov,
        oblaSvetla = oblaSvetla,
        oblaMirna = oblaMirna,
        spodnjaVrsticaAktivna = spodnjaVrsticaAktivna,
        snemanjeOmogoceno = snemanjeOmogoceno,
        casovnik = casovnik,
        polmerOble = polmerOble,
        animacijaAktivna = animacijaAktivna,
        stolpciValovanja = stolpci,
        prikaziStikaloVklopa = prikaziStikaloVklopa,
        povezavaPrikaz = povezavaNaDomovu,
        izbranZaslon = stanje.zaslon,
        zasloniSpodaj = spodnjaVrsticaZasloni(stanje.zaslon, jezik),
        delujeBrezRacunalnika = zmoznostBrezRacunalnika(stanje.zaslon),
        sinhronizacijaAktivna = podrobnostiPovezave.sinhronizacijaAktivna,
        nedavno = stanje.nedavno
    )
}

// Preklopi vklop/izklop asistentke; ob izklopu med POSLUSA/RAZMISLJA/GOVORI ustavi fazo na MIRUJE.
fun preklopiVklop(stanje: GlavniZaslonStanje): GlavniZaslonStanje {
    return if (stanje.vklopljena) {
        val novaFaza = when (stanje.faza) {
            Faza.POSLUSA, Faza.RAZMISLJA, Faza.GOVORI -> Faza.MIRUJE
            else -> Faza.MIRUJE
        }
        stanje.copy(vklopljena = false, faza = novaFaza, glasnost = 0f)
    } else {
        stanje.copy(vklopljena = true, faza = Faza.MIRUJE, glasnost = 0f)
    }
}

// Vmesnik za preverjanje, da lokalne operacije nikoli ne klicejo racunalnika ali omrezja.
fun interface LokalniPreizkusniOdjemalec {
    fun kliciOmrezje()
}

// Lokalno stanje telefona (zaslon, zapiski, opomniki/koledar), ki deluje brez racunalnika.
data class LokalnoStanjeTelefona(
    val zaslonStanje: GlavniZaslonStanje = GlavniZaslonStanje(),
    val zapiski: List<Zapisek> = emptyList(),
    val opomniki: List<Opomnik> = emptyList()
)

// Lokalne operacije, ki se morajo izvesti takoj na telefonu brez omreznega klica.
sealed class LokalnaOperacija {
    data class PreklopZaslona(val zaslon: Zaslon) : LokalnaOperacija()
    data class DodajZapisek(val id: String, val besedilo: String, val cas: Long) : LokalnaOperacija()
    data class DodajOpomnik(val id: String, val besedilo: String, val cas: Long) : LokalnaOperacija()
}

// Sinhrono izvede lokalno operacijo na telefonu brez kakrsnegakoli klica odjemalca ali omrezja.
fun izvediLokalnoOperacijo(
    stanje: LokalnoStanjeTelefona,
    operacija: LokalnaOperacija,
    @Suppress("UNUSED_PARAMETER") odjemalec: LokalniPreizkusniOdjemalec? = null
): LokalnoStanjeTelefona {
    return when (operacija) {
        is LokalnaOperacija.PreklopZaslona -> {
            stanje.copy(zaslonStanje = stanje.zaslonStanje.copy(zaslon = operacija.zaslon))
        }
        is LokalnaOperacija.DodajZapisek -> {
            val novZapisek = Zapisek(
                id = operacija.id,
                besedilo = operacija.besedilo,
                cas = operacija.cas,
                izbrisan = false
            )
            stanje.copy(zapiski = zdruzi(stanje.zapiski, listOf(novZapisek)))
        }
        is LokalnaOperacija.DodajOpomnik -> {
            val novOpomnik = Opomnik(
                id = operacija.id,
                besedilo = operacija.besedilo,
                cas = operacija.cas,
                izbrisan = false,
                spremenjeno = operacija.cas
            )
            stanje.copy(opomniki = zdruzi(stanje.opomniki, listOf(novOpomnik)))
        }
    }
}

// Sinhrono vrne dogodke/opomnike v izbranem casovnem oknu brez omreznega klica.
fun pregledLokalnegaKoledarja(
    stanje: LokalnoStanjeTelefona,
    odCasa: Long,
    doCasa: Long,
    @Suppress("UNUSED_PARAMETER") odjemalec: LokalniPreizkusniOdjemalec? = null
): List<Opomnik> {
    return stanje.opomniki
        .filter { !it.izbrisan && it.cas in odCasa..doCasa }
        .sortedBy { it.cas }
}
