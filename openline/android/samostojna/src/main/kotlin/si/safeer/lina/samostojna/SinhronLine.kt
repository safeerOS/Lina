package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/**
 * Sinhronizacija telefona z racunalnikom (lastnik 20. 11. 2026): zapisi klicev, pogovor in navodila lastnika. Racunalnik steje
 * REVIZIJE; telefon si zapomni zadnjo in ob naslednji izmenjavi prosi samo za novejse. Oblika vsebine = sinhron-telefon.server.ts.
 */
@Serializable
data class PogovorSinhron(val vloga: String, val besedilo: String, val cas: String)

@Serializable
data class NavodilaSinhron(val besedilo: String, val cas: Long)

@Serializable
data class ZahtevaSinhron(
    val rev: Long,
    val klici: List<ZapisKlicaSinhronizacija>,
    val pogovor: List<PogovorSinhron> = emptyList(),
    val navodila: NavodilaSinhron? = null,
    val epoha: String? = null,
    /** Id klicev, ki jih je uporabnik izbrisal na telefonu (N3): racunalnik jih izbrise s prepisom vred in jih ne vrne vec. */
    val izbrisani: List<String> = emptyList(),
)

@Serializable
data class OdgovorSinhron(
    val epoha: String = "",
    val rev: Long = 0,
    val klici: List<ZapisKlicaSinhronizacija> = emptyList(),
    val pogovor: List<PogovorSinhron> = emptyList(),
    val navodila: NavodilaSinhron? = null,
    val ostane: Boolean = false,
    /**
     * Kaj racunalnik zna (slepi pregled 17t, N1). "prepis-v1" = prepisPogovora sprejme in shrani (tudi za id, ki ga ze pozna brez prepisa).
     * Brez tega polja (racunalnik 0.2.13) telefon zapisa s prepisom ne steje za sprejetega: zadrzi ga in ga poslje znova po posodobitvi.
     */
    val zmoznosti: List<String> = emptyList(),
)

const val ZMOZNOST_PREPIS = "prepis-v1"
/** Racunalnik zna izbrisati klic po seznamu izbrisani (N3); brez tega izbris ostane v vrsti telefona. */
const val ZMOZNOST_IZBRIS = "izbris-v1"

object SinhronLine {
    const val NAJVEC_VNOSOV = 300
    /** Najvec bajtov klicev v eni zahtevi (racunalnik sprejme 1 MiB; ostane rezerva za pogovor). */
    const val NAJVEC_BAJTOV_KLICEV = 400_000
    private const val NAJVEC_KROGOV = 20
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun zahteva(z: ZahtevaSinhron): String = json.encodeToString(z)

    /** Zapisi v mejah bajtov ene zahteve; vsaj en zapis gre vedno (ostali v naslednjem krogu). */
    internal fun omejiPoBajtih(zapisi: List<ZapisKlicaSinhronizacija>): List<ZapisKlicaSinhronizacija> {
        val izhod = ArrayList<ZapisKlicaSinhronizacija>()
        var bajti = 0
        for (z in zapisi) {
            val velikost = json.encodeToString(z).toByteArray(Charsets.UTF_8).size + 1
            if (izhod.isNotEmpty() && bajti + velikost > NAJVEC_BAJTOV_KLICEV) break
            izhod.add(z); bajti += velikost
        }
        return izhod
    }

    /** null = odgovor ni veljaven (neznana oblika ali negativna revizija): telefon ne spremeni nicesar. */
    fun odgovor(telo: String): OdgovorSinhron? = try {
        // Polje rev mora biti izrecno prisotno: privzeta vrednost 0 ne sme potrditi vrste ob okvarjenem odgovoru.
        if (json.parseToJsonElement(telo).jsonObject["rev"] == null) null
        else json.decodeFromString<OdgovorSinhron>(telo).takeIf { it.rev >= 0 }
    } catch (_: Exception) {
        null
    }

    /**
     * Ena izmenjava (ali vec, ce racunalnik pove, da je se vnosov): [poslji] dobi JSON vsebine in vrne telo odgovora ali null
     * (ni povezave, zavrnjeno). Vrsta se potrdi SAMO po veljavnem odgovoru; ob neuspehu ostane nedotaknjena (brez izgube in dvojnikov).
     */
    fun izmenjaj(
        dnevnik: DnevnikKlicev,
        reviziji: Shramba,
        navodila: NavodilaSinhron? = null,
        pogovor: List<PogovorSinhron> = emptyList(),
        poslji: (String) -> String?,
        prejetoNavodilo: (NavodilaSinhron) -> Unit = {},
        prejetPogovor: (List<PogovorSinhron>) -> Unit = {},
    ): Boolean {
        // Shramba hrani »revizija:epoha«; ce se stanje na racunalniku ponastavi, se epoha spremeni in telefon zacne znova pri 0.
        val shranjeno = try { reviziji.preberi()?.trim().orEmpty() } catch (_: Exception) { return false }
        var rev = shranjeno.substringBefore(':').toLongOrNull()?.takeIf { it >= 0 } ?: 0L
        var epoha = shranjeno.substringAfter(':', "")
        var prvi = true
        repeat(NAJVEC_KROGOV) {
            val cakajoci = omejiPoBajtih(dnevnik.cakajociZaSinhronizacijo().take(NAJVEC_VNOSOV))
            val izbrisi = if (prvi) dnevnik.izbrisiZaRacunalnik().take(NAJVEC_VNOSOV) else emptyList()
            val telo = zahteva(ZahtevaSinhron(rev, cakajoci, if (prvi) pogovor.takeLast(NAJVEC_VNOSOV) else emptyList(), if (prvi) navodila else null, epoha.ifEmpty { null }, izbrisi))
            val odg = odgovor(poslji(telo) ?: return false) ?: return false
            val prepisSprejet = ZMOZNOST_PREPIS in odg.zmoznosti
            dnevnik.potrdiPoslane(cakajoci, prepisSprejet)
            // Racunalnik zdaj zna prepis: zapisi, ki jih je star racunalnik dobil brez prepisa, gredo v vrsto (naslednji krog).
            if (prepisSprejet) dnevnik.vrniZadrzanePrepise()
            if (ZMOZNOST_IZBRIS in odg.zmoznosti) dnevnik.potrdiIzbrise(izbrisi)
            // Ce zapis prejetih klicev ne uspe, revizija ostane (racunalnik jih ob naslednjem krogu poslje znova).
            try { dnevnik.sprejmiIzRacunalnika(odg.klici) } catch (_: Exception) { return false }
            if (odg.pogovor.isNotEmpty()) prejetPogovor(odg.pogovor)
            odg.navodila?.let(prejetoNavodilo)
            // Revizija se nikoli ne vrne nazaj, razen ob NOVI epohi (stanje na racunalniku ponastavljeno: odgovor vsebuje vse).
            val novaEpoha = odg.epoha.isNotEmpty() && odg.epoha != epoha
            if (novaEpoha || odg.rev > rev) {
                rev = odg.rev
                if (novaEpoha) epoha = odg.epoha
                try { reviziji.shrani("$rev:$epoha") } catch (_: Exception) { return false }
            }
            prvi = false
            // Konec, ko racunalnik nima vec vnosov in je vrsta telefona prazna (vrsta je lahko presegla mejo ene zahteve).
            if (!odg.ostane && dnevnik.cakajociZaSinhronizacijo().isEmpty()) return true
        }
        return true
    }
}
