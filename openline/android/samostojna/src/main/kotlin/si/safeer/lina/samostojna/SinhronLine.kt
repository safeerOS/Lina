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
    val epoha: String? = null,
)

@Serializable
data class OdgovorSinhron(
    val epoha: String = "",
    val rev: Long = 0,
    val klici: List<ZapisKlicaSinhronizacija> = emptyList(),
    val pogovor: List<PogovorSinhron> = emptyList(),
    val navodila: NavodilaSinhron? = null,
    val ostane: Boolean = false,
)

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
        // Shramba hrani »revizija:epoha«; ce se stanje na racunalniku ponastavi, se epoha spremeni in telefon zacne znova pri 0.
        val shranjeno = try { reviziji.preberi()?.trim().orEmpty() } catch (_: Exception) { return false }
        var rev = shranjeno.substringBefore(':').toLongOrNull()?.takeIf { it >= 0 } ?: 0L
        var epoha = shranjeno.substringAfter(':', "")
        var prvi = true
        repeat(NAJVEC_KROGOV) {
            val cakajoci = omejiPoBajtih(dnevnik.cakajociZaSinhronizacijo().take(NAJVEC_VNOSOV))
            val telo = zahteva(ZahtevaSinhron(rev, cakajoci, if (prvi) pogovor.takeLast(NAJVEC_VNOSOV) else emptyList(), if (prvi) navodila else null, epoha.ifEmpty { null }))
            val odg = odgovor(poslji(telo) ?: return false) ?: return false
            dnevnik.potrdiPoslane(cakajoci)
            dnevnik.sprejmiIzRacunalnika(odg.klici)
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
