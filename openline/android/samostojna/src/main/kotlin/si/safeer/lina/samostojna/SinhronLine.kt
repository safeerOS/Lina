package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

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
)

@Serializable
data class OdgovorSinhron(
    val rev: Long = 0,
    val klici: List<ZapisKlicaSinhronizacija> = emptyList(),
    val pogovor: List<PogovorSinhron> = emptyList(),
    val navodila: NavodilaSinhron? = null,
    val ostane: Boolean = false,
)

object SinhronLine {
    const val NAJVEC_VNOSOV = 300
    private const val NAJVEC_KROGOV = 20
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun zahteva(z: ZahtevaSinhron): String = json.encodeToString(z)

    /** null = odgovor ni veljaven (neznana oblika ali negativna revizija): telefon ne spremeni nicesar. */
    fun odgovor(telo: String): OdgovorSinhron? = try {
        json.decodeFromString<OdgovorSinhron>(telo).takeIf { it.rev >= 0 }
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
        var rev = try { reviziji.preberi()?.trim()?.toLongOrNull() ?: 0L } catch (_: Exception) { return false }
        var prvi = true
        repeat(NAJVEC_KROGOV) {
            val cakajoci = dnevnik.cakajociZaSinhronizacijo().take(NAJVEC_VNOSOV)
            val telo = zahteva(ZahtevaSinhron(rev, cakajoci, if (prvi) pogovor.takeLast(NAJVEC_VNOSOV) else emptyList(), if (prvi) navodila else null))
            val odg = odgovor(poslji(telo) ?: return false) ?: return false
            dnevnik.potrdiPoslane(cakajoci)
            dnevnik.sprejmiIzRacunalnika(odg.klici)
            if (odg.pogovor.isNotEmpty()) prejetPogovor(odg.pogovor)
            odg.navodila?.let(prejetoNavodilo)
            // Revizija se nikoli ne vrne nazaj (pokvarjen ali star odgovor ne sme ponovno vleci vsega).
            if (odg.rev > rev) {
                rev = odg.rev
                try { reviziji.shrani(rev.toString()) } catch (_: Exception) { return false }
            }
            prvi = false
            if (!odg.ostane) return true
        }
        return true
    }
}
