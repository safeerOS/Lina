package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.IOException

/**
 * Prijava v Google Cloud na telefonu (lastnik 18. 11. 2026: »upam da si ne bo treba uporabnik tega sam nastavljat«).
 * Uporabnik tapne »Prijava z Google«; projekt poisce in Vertex vklopi aplikacija sama. Zeton da Google (Play storitve)
 * in zivi samo v pomnilniku; nikoli se ne zapise. Naslovi so vgrajeni: zeton ne gre nikamor drugam.
 */
fun interface GoogleZeton {
    /** Veljaven dostopni zeton (obseg cloud-platform) ali null, ce je potrebna nova prijava; IOException brez povezave. Iz delovne niti. */
    fun zeton(): String?
}

/** [obracun]: true/false iz Cloud Billing, null = ni znano (API ni dosegljiv ali ni preverjeno). */
data class ProjektGoogle(val id: String, val ime: String, val obracun: Boolean? = null)

private val jsonG = Json { ignoreUnknownKeys = true }

/** ID projekta ne sme spremeniti poti URL (enako pravilo kot na racunalniku, providers.ts). */
val ID_PROJEKTA = Regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$")

const val NASLOV_PROJEKTOV = "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState%3AACTIVE&pageSize=100"

fun naslovOmogociVertex(projekt: String): String {
    require(ID_PROJEKTA.matches(projekt)) { "ID projekta Google Cloud ni veljaven." }
    return "https://serviceusage.googleapis.com/v1/projects/$projekt/services/aiplatform.googleapis.com:enable"
}

/** Samo aktivni projekti z veljavnim ID, po imenu; neveljavni zapisi se tiho izpustijo (ne smejo spremeniti poti). */
fun projektiIzOdgovora(telo: String): List<ProjektGoogle> {
    val o = try { jsonG.parseToJsonElement(telo) as? JsonObject } catch (e: Exception) { null } ?: return emptyList()
    val seznam = o["projects"] as? JsonArray ?: return emptyList()
    return seznam.mapNotNull { e ->
        val p = e as? JsonObject ?: return@mapNotNull null
        val id = (p["projectId"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
        if (!ID_PROJEKTA.matches(id)) return@mapNotNull null
        if ((p["lifecycleState"] as? JsonPrimitive)?.contentOrNull.let { it != null && it != "ACTIVE" }) return@mapNotNull null
        ProjektGoogle(id, (p["name"] as? JsonPrimitive)?.contentOrNull?.take(80) ?: id)
    }.sortedBy { it.ime.lowercase() }
}

fun naslovObracuna(projekt: String): String {
    require(ID_PROJEKTA.matches(projekt)) { "ID projekta Google Cloud ni veljaven." }
    return "https://cloudbilling.googleapis.com/v1/projects/$projekt/billingInfo"
}

/**
 * Ali ima projekt vklopljeno obracunavanje (lastnik 22. 11. 2026: telefon je izbral projekt AI Studio brez obracuna,
 * Vertex je nato zavrnil vsak odgovor). Napaka ali neznan odgovor = null; nikoli ne ustavi prijave.
 */
fun obracunVklopljen(zeton: String, prenos: Prenos, projekt: String): Boolean? = try {
    val odg = prenos.get(naslovObracuna(projekt), mapOf("Authorization" to "Bearer $zeton"), 15000L)
    if (odg.koda != 200) null
    else ((jsonG.parseToJsonElement(odg.telo) as? JsonObject)?.get("billingEnabled") as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull()
} catch (e: Exception) { null }

/** Projekti z znanim obracunom; prvi so tisti z obracunom, nato neznani, nazadnje brez obracuna (znotraj po imenu). */
fun projektiZObracunom(zeton: String, prenos: Prenos, projekti: List<ProjektGoogle>, najvecPreverb: Int = 10): List<ProjektGoogle> {
    if (projekti.size > najvecPreverb) return projekti
    return projekti.map { it.copy(obracun = obracunVklopljen(zeton, prenos, it.id)) }
        .sortedWith(compareBy<ProjektGoogle> { when (it.obracun) { true -> 0; null -> 1; false -> 2 } }.thenBy { it.ime.lowercase() })
}

/** Natanko en projekt: izbran sam; sicer uporabnik izbere (aplikacija ne ugiba, kam gre racun). */
fun samodejniProjekt(projekti: List<ProjektGoogle>): ProjektGoogle? = projekti.singleOrNull()

sealed class PrijavaGoogle {
    data class Pripravljeno(val projekt: ProjektGoogle) : PrijavaGoogle()
    data class Izbira(val projekti: List<ProjektGoogle>) : PrijavaGoogle()
    data class Napaka(val sporocilo: String) : PrijavaGoogle()
}

/** Po prijavi: poisce projekte in (ce je en sam ali je ze izbran) vklopi Vertex. */
fun poPrijaviGoogle(zeton: String, prenos: Prenos, izbran: String?): PrijavaGoogle {
    val glave = mapOf("Authorization" to "Bearer $zeton")
    val odg = try { prenos.get(NASLOV_PROJEKTOV, glave, 20000L) } catch (e: IOException) { return PrijavaGoogle.Napaka("Brez povezave") }
    if (odg.koda == 401 || odg.koda == 403) return PrijavaGoogle.Napaka("Google ni dovolil branja projektov (${odg.koda})")
    if (odg.koda != 200) return PrijavaGoogle.Napaka("Napaka ${odg.koda}")
    val projekti = projektiIzOdgovora(odg.telo)
    if (projekti.isEmpty()) return PrijavaGoogle.Napaka("Na tem Google racunu ni projekta Google Cloud")
    projekti.firstOrNull { it.id == izbran }?.let { p ->
        // Prej izbran projekt brez obracuna: znova ponudi izbiro (oznaceno), namesto da vsak odgovor pade.
        if (projekti.size > 1 && obracunVklopljen(zeton, prenos, p.id) == false) return PrijavaGoogle.Izbira(projektiZObracunom(zeton, prenos, projekti))
        return vklopiVertex(zeton, prenos, p)
    }
    samodejniProjekt(projekti)?.let { return vklopiVertex(zeton, prenos, it) }
    val oznaceni = projektiZObracunom(zeton, prenos, projekti)
    // Natanko en projekt z obracunom: uporabniku ni treba izbirati (racun gre tja, kjer je dobroimetje).
    oznaceni.filter { it.obracun == true }.singleOrNull()?.let { return vklopiVertex(zeton, prenos, it) }
    return PrijavaGoogle.Izbira(oznaceni)
}

fun vklopiVertex(zeton: String, prenos: Prenos, projekt: ProjektGoogle): PrijavaGoogle {
    val odg = try {
        prenos.post(naslovOmogociVertex(projekt.id), mapOf("Authorization" to "Bearer $zeton"), "{}", 30000L)
    } catch (e: IOException) { return PrijavaGoogle.Napaka("Brez povezave") }
    return if (odg.koda in 200..299) PrijavaGoogle.Pripravljeno(projekt)
    else PrijavaGoogle.Napaka(when (odg.koda) {
        403 -> "Projekt nima obracuna ali racun nima pravice za vklop Vertex AI (403)"
        else -> "Vklop Vertex AI ni uspel (${odg.koda})"
    })
}

/** Vertex AI (Gemini prek Google Cloud): isto telo kot Gemini, zeton namesto kljuca, naslov vgrajen. */
class VertexOdjemalec(
    private val zeton: GoogleZeton,
    private val projekt: () -> String?,
    private val model: String = Ponudnik.VERTEX.model,
    private val prenos: Prenos = JavaHttpPrenos(),
) : PonudnikOdjemalec {
    var spanje: (Long) -> Unit = { Thread.sleep(it) }

    override fun poslji(zgodovina: List<Sporocilo>, sistemsko: String): Rezultat {
        val p = projekt()?.takeIf { ID_PROJEKTA.matches(it) } ?: return Rezultat.Napaka(null, "Manjka projekt")
        val t = try { zeton.zeton() } catch (e: IOException) { return Rezultat.Napaka(null, "Brez povezave") } ?: return Rezultat.Napaka(null, "Prijava poteka")
        var r: Rezultat = Rezultat.Napaka(null, "Ni modela")
        // Model ni na voljo na tem projektu (404): poskusi rezervnega, namesto da Lina ne odgovori.
        for (m in listOf(model) + REZERVNI_MODELI_VERTEX.filter { it != model }) {
            val url = "https://aiplatform.googleapis.com/v1/projects/$p/locations/global/publishers/google/models/$m:generateContent"
            r = posljiZPonovitvami(prenos, url, mapOf("Authorization" to "Bearer $t"), gradiTelo(zgodovina, sistemsko), spanje, ::razberiOdgovor)
            if (!(r is Rezultat.Napaka && (r.koda == 404 || r.sporocilo.contains("was not found", ignoreCase = true)))) break
        }
        return if (r is Rezultat.Napaka && jeNapakaObracuna(r.sporocilo)) Rezultat.Napaka(r.koda, sporociloBrezObracuna(p)) else r
    }
}

/** Google vrne angleski opis z naslovom konzole; uporabnik dobi slovensko navodilo (brez dolgega naslova). */
fun jeNapakaObracuna(sporocilo: String): Boolean =
    sporocilo.contains("billing to be enabled", ignoreCase = true) || sporocilo.contains("BILLING_DISABLED")

fun sporociloBrezObracuna(projekt: String): String =
    "Projekt Google Cloud »$projekt« nima vklopljenega obračunavanja, zato Google ne odgovori. " +
        "V Nastavitvah se odjavite iz Googla, se znova prijavite in izberite projekt z dobroimetjem. " +
        "$KORAKI_OBRACUNA"

/** Koraki vklopa obracuna (docs.cloud.google.com/billing/docs/how-to/modify-project, 2026-08-11); napisi konzole so angleski. */
const val KORAKI_OBRACUNA = "Kako vklopite obračun v projektu: na console.cloud.google.com odprite meni ☰ → »Billing« → »Manage billing accounts« → zavihek »My projects«. V vrstici projekta, kjer piše »Billing is disabled«, odprite »⋮« (Actions) → »Change billing«, izberite obračunski račun in pritisnite »Set account«. Če obračunskega računa še nimate, vam ga Google ponudi ustvariti."

/** Rezervni modeli Vertex po vrsti, ce izbrani na projektu ni na voljo. */
val REZERVNI_MODELI_VERTEX = listOf("gemini-3-flash-preview", "gemini-2.5-flash")
