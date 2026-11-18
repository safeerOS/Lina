package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class Zapisi(
    val verzija: Int = 1,
    val zapiski: List<Zapisek>,
    val opomniki: List<Opomnik>
)

private val jsonFormat = Json {
    ignoreUnknownKeys = true
}

fun v_json(z: Zapisi): String {
    return jsonFormat.encodeToString(z)
}

fun iz_json(s: String): Zapisi? {
    if (s.isBlank()) return null
    return try {
        val zapisi = jsonFormat.decodeFromString<Zapisi>(s)
        if (zapisi.verzija != 1) null else zapisi
    } catch (e: Exception) {
        null
    }
}

// Stanje telefona za odlocanje, ali je sinhronizacija v ozadju dovoljena.
// Stanje zaslona (zaslonPrizgan) NI merilo: ob prizganem zaslonu sme sinhronizirati, ce ni klica ali pogovora z asistentko.
data class StanjeTelefona(
    val medKlicem: Boolean = false,
    val uporabljaAsistentko: Boolean = false,
    val aktivnoSnemanje: Boolean = false,
    val povezava: PovezavaStanje = PovezavaStanje.DOMA_LAN,
    val zaslonPrizgan: Boolean = false
)

// Cista funkcija: vrne true samo, ce NI aktivnega klica, NI pogovora z asistentko (in ni snemanja)
// ter je naprava parjena in dosegljiva. Zaslon ni merilo.
fun smemSinhronizirati(stanje: StanjeTelefona): Boolean {
    if (stanje.medKlicem || stanje.uporabljaAsistentko || stanje.aktivnoSnemanje) {
        return false
    }
    return when (stanje.povezava) {
        PovezavaStanje.DOMA_LAN,
        PovezavaStanje.GLOBAL_NEPOSREDNO,
        PovezavaStanje.GLOBAL_RELE -> true
        PovezavaStanje.NI_PARJENO,
        PovezavaStanje.NEDOSEGLJIVO -> false
    }
}

// Posamezna lokalna sprememba v vrsti za sinhronizacijo z racunalnikom.
@Serializable
data class Sprememba(
    val id: String,
    val vsebina: String = "",
    val cas: Long = 0L
)

// Vmesnik odjemalca za posiljanje sprememb prek izbrane poti (v preizkusih lazen odjemalec brez omrezja).
fun interface OdjemalecSinhronizacije {
    fun poslji(pot: Pot, spremembe: List<Sprememba>): Boolean
}

// Lokalna vrsta sprememb za asinhrono sinhronizacijo v ozadju.
// dodaj(sprememba) vrne takoj brez cakanja na racunalnik.
// poslji(pot) poslje vse po vrsti; ob neuspehu ostane vrsta nedotaknjena in brez podvajanja.
// poKoncuKlica() takoj sprozi poskus posiljanja, ce smemSinhronizirati(stanje) dovoli.
class VrstaSprememb(
    private val odjemalec: OdjemalecSinhronizacije,
    private val izbiraPoti: IzbiraPoti = IzbiraPoti(),
    var stanje: StanjeTelefona = StanjeTelefona()
) {
    private val vrsta = linkedMapOf<String, Sprememba>()
    private val posiljanjeVTeku = java.util.concurrent.atomic.AtomicBoolean(false)

    // Doda spremembo v lokalno vrsto in vrne takoj (nikoli ne klice ali caka na racunalnik).
    fun dodaj(sprememba: Sprememba) {
        vrsta[sprememba.id] = sprememba
    }

    // Okrajsava za dodajanje spremembe z ID-jem in vsebino.
    fun dodaj(id: String, vsebina: String = "", cas: Long = 0L) {
        dodaj(Sprememba(id = id, vsebina = vsebina, cas = cas))
    }

    // Vrne vse cakajoce spremembe v vrstnem redu dodajanja.
    fun cakajoce(): List<Sprememba> = vrsta.values.toList()

    // Vrne stevilo cakajocih sprememb v vrsti.
    fun velikost(): Int = vrsta.size

    // Preveri, ali je vrsta prazna.
    fun jePrazna(): Boolean = vrsta.isEmpty()

    // Poslje vse cakajoce spremembe po vrsti prek podane poti.
    // Ce naprava ni parjena (NI_PARJENO) ali sinhronizacija ni dovoljena, vrne false in vrste ne poslje.
    // Ob neuspehu ali izjemi odjemalca ostane vrsta nedotaknjena (brez izgube in brez podvajanja ob ponovnem poskusu).
    fun poslji(pot: Pot): Boolean {
        if (!smemSinhronizirati(stanje)) {
            return false
        }
        if (!posiljanjeVTeku.compareAndSet(false, true)) {
            return false
        }
        try {
            val zaPosiljanje = vrsta.values.toList()
            if (zaPosiljanje.isEmpty()) {
                return true
            }
            val uspeh = try {
                odjemalec.poslji(pot, zaPosiljanje)
            } catch (e: Exception) {
                false
            }
            if (uspeh) {
                for (element in zaPosiljanje) {
                    val trenutni = vrsta[element.id]
                    if (trenutni == element) {
                        vrsta.remove(element.id)
                    }
                }
                izbiraPoti.uspeh(pot)
            } else {
                izbiraPoti.neuspeh(pot)
            }
            return uspeh
        } finally {
            posiljanjeVTeku.set(false)
        }
    }

    // Po koncu telefonskega klica zakljuci stanje klica in takoj sprozi poskus posiljanja vrste, ce smemSinhronizirati dovoli.
    fun poKoncuKlica(): Boolean {
        if (stanje.medKlicem) {
            stanje = stanje.copy(medKlicem = false)
        }
        if (!smemSinhronizirati(stanje)) {
            return false
        }
        if (vrsta.isEmpty()) {
            return true
        }
        val pot = izbiraPoti.izberi(stanje.povezava) ?: return false
        return poslji(pot)
    }
}
