package si.safeer.lina.samostojna

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encodeToString
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.StandardCopyOption

// Serializer, ki nacin klica zapisuje kot "osebna" ali "podjetje" in sprejme tudi velike crke.
object NacinKlicaSerializer : KSerializer<NacinKlica> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("NacinKlica", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: NacinKlica) {
        encoder.encodeString(value.koda)
    }

    override fun deserialize(decoder: Decoder): NacinKlica {
        val surovo = decoder.decodeString()
        return try {
            NacinKlica.izNiza(surovo)
        } catch (e: IllegalArgumentException) {
            throw SerializationException("Neznan nacin klica: $surovo", e)
        }
    }
}

// Nacin delovanja tajnice pri klicu: osebna asistentka ali tajnica za podjetje.
@Serializable(with = NacinKlicaSerializer::class)
enum class NacinKlica(val koda: String) {
    OSEBNA("osebna"),
    PODJETJE("podjetje");

    companion object {
        fun izNiza(vrednost: String): NacinKlica {
            return when (vrednost.trim().lowercase()) {
                "osebna" -> OSEBNA
                "podjetje" -> PODJETJE
                else -> throw IllegalArgumentException("Neveljaven nacin klica: $vrednost")
            }
        }
    }
}

typealias Nacin = NacinKlica

// Zapis posameznega klica na telefonu (vkljucno z lokalnim prepisom pogovora).
@Serializable
data class ZapisKlica(
    val id: String,
    val casZacetka: Long,
    val stevilka: String,
    val trajanjeS: Int,
    val nujno: Boolean = false,
    val povzetek: String,
    val prepis: String = "",
    val nacin: NacinKlica = NacinKlica.OSEBNA,
    /** Ime in priimek klicatelja, kot ju je povedal (prazno = klicatelj ni povedal). Stevilka je vedno poleg imena. */
    val klicatelj: String = "",
    val podjetje: String = "",
    /** Kratek povzetek sporocila klicatelja (Lina) in dobesedno, kar je klicatelj povedal. */
    val sporocilo: String = "",
    val sporociloDobesedno: String = "",
    /** Zakaj sporocila ni (klicatelj je prekinil, zvok ni deloval ...); prazno, kadar sporocilo obstaja. */
    val brezSporocilaRazlog: String = ""
) {
    constructor(
        id: String,
        casZacetka: Long,
        stevilka: String,
        trajanjeS: Int,
        nujno: Boolean,
        povzetek: String,
        prepis: String,
        nacin: String
    ) : this(
        id = id,
        casZacetka = casZacetka,
        stevilka = stevilka,
        trajanjeS = trajanjeS,
        nujno = nujno,
        povzetek = povzetek,
        prepis = prepis,
        nacin = NacinKlica.izNiza(nacin)
    )

    // Nujni klici imajo rdeco oznako in besedilni napis "Nujno" (dostopnost, enako kot na racunalniku).
    val rdecaOznaka: Boolean get() = nujno

    val oznakaNujno: String get() = if (nujno) "Nujno" else ""

    fun barvaOznake(tema: Tema = Tema.TEMNA): String? =
        if (nujno) barve(tema).napaka else null

    fun napisOznake(jezik: Jezik = Jezik.SL): String =
        if (!nujno) "" else when (jezik) {
            Jezik.SL -> "Nujno"
            Jezik.EN -> "Urgent"
        }

    // Pretvori zapis v obliko za sinhronizacijo z racunalnikom: brez celotnega prepisa pogovora (ta ostane na telefonu), s sporocilom klicatelja (lastnik 20. 11. 2026).
    fun zaSinhronizacijo(): ZapisKlicaSinhronizacija = ZapisKlicaSinhronizacija(
        id = id,
        casZacetka = casZacetka,
        stevilka = skrajsajZaSinhronizacijo(stevilka, 60),
        trajanjeS = trajanjeS,
        nujno = nujno,
        povzetek = skrajsajZaSinhronizacijo(povzetek, 2000),
        nacin = nacin,
        klicatelj = skrajsajZaSinhronizacijo(klicatelj, 240),
        podjetje = skrajsajZaSinhronizacijo(podjetje, 240),
        sporocilo = skrajsajZaSinhronizacijo(sporocilo, 2000),
        sporociloDobesedno = skrajsajZaSinhronizacijo(sporociloDobesedno, 6000),
        brezSporocilaRazlog = skrajsajZaSinhronizacijo(brezSporocilaRazlog, 2000)
    )
}

/** Besedilo v mejah, ki jih racunalnik sprejme (dolzina, brez osamljenih nadomestnih znakov): en zapis ne sme zatakniti sinhronizacije. */
fun skrajsajZaSinhronizacijo(s: String, meja: Int): String {
    var r = if (s.length > meja) s.substring(0, meja) else s
    val b = StringBuilder(r.length)
    var i = 0
    while (i < r.length) {
        val c = r[i]
        if (Character.isHighSurrogate(c)) {
            if (i + 1 < r.length && Character.isLowSurrogate(r[i + 1])) { b.append(c).append(r[i + 1]); i += 2; continue }
            i++; continue
        }
        if (!Character.isLowSurrogate(c)) b.append(c)
        i++
    }
    r = b.toString()
    return r
}

// Zapis klica za sinhronizacijo z racunalnikom: brez polja prepis, a s sporocilom klicatelja in razlogom, ce ga ni.
@Serializable
data class ZapisKlicaSinhronizacija(
    val id: String,
    val casZacetka: Long,
    val stevilka: String,
    val trajanjeS: Int,
    val nujno: Boolean,
    val povzetek: String,
    val nacin: NacinKlica,
    val klicatelj: String = "",
    val podjetje: String = "",
    val sporocilo: String = "",
    val sporociloDobesedno: String = "",
    val brezSporocilaRazlog: String = ""
)

@Serializable
private data class DnevnikKlicevShramba(
    val verzija: Int = 1,
    val zapisi: List<ZapisKlica>,
    val cakajoci: List<ZapisKlicaSinhronizacija> = emptyList()
)

@Serializable
private data class DnevnikKlicevSinhronizacijaPaket(
    val verzija: Int = 1,
    val zapisi: List<ZapisKlicaSinhronizacija>
)

// Podatki za prikaz zapisa klica v vmesniku (rdeca oznaka in napis Nujno za nujne klice).
data class PrikazZapisaKlica(
    val zapis: ZapisKlica,
    val rdecaOznaka: Boolean,
    val napisNujno: String,
    val barvaOznake: String?
)

// Izracuna prikaz zapisa klica z rdeco oznako za nujne klice (enako kot na racunalniku).
fun prikazZapisaKlica(
    zapis: ZapisKlica,
    tema: Tema = Tema.TEMNA,
    jezik: Jezik = Jezik.SL
): PrikazZapisaKlica {
    return PrikazZapisaKlica(
        zapis = zapis,
        rdecaOznaka = zapis.rdecaOznaka,
        napisNujno = zapis.napisOznake(jezik),
        barvaOznake = zapis.barvaOznake(tema)
    )
}

// Vmesnik za lokalno shranjevanje dnevnika klicev (v testih pomnilnik, na Androidu lokalna datoteka).
interface Shramba {
    /** null = shrambe (se) ni; izjema = branje je spodletelo (ni prazen dnevnik, pisanje se blokira). */
    fun preberi(): String?
    fun shrani(vsebina: String)
}

// Pomnilniska implementacija vmesnika Shramba za hitre in izolirane preizkuse.
class PomnilniskaShramba(zacetnaVsebina: String? = null) : Shramba {
    private var vsebina: String? = zacetnaVsebina

    override fun preberi(): String? = vsebina

    override fun shrani(vsebina: String) {
        this.vsebina = vsebina
    }
}

// Datotecna implementacija vmesnika Shramba z atomskim zapisovanjem prek zacasne datoteke.
class DatotecnaShramba(private val datoteka: File) : Shramba {
    override fun preberi(): String? {
        if (!datoteka.exists() || !datoteka.isFile) return null
        // Izjema ob branju NI »datoteke ni«: leti do naloziIzShrambe, ki blokira pisanje (F6 pregled, najdba 1).
        return datoteka.readText(StandardCharsets.UTF_8)
    }

    override fun shrani(vsebina: String) {
        val starsevskaMapa = datoteka.parentFile
        if (starsevskaMapa != null && !starsevskaMapa.exists()) {
            starsevskaMapa.mkdirs()
        }
        val zacasna = File(starsevskaMapa ?: File("."), "${datoteka.name}.tmp")
        try {
            zacasna.writeText(vsebina, StandardCharsets.UTF_8)
            try {
                Files.move(
                    zacasna.toPath(),
                    datoteka.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE
                )
            } catch (e: Exception) {
                Files.move(
                    zacasna.toPath(),
                    datoteka.toPath(),
                    StandardCopyOption.REPLACE_EXISTING
                )
            }
        } finally {
            if (zacasna.exists()) {
                zacasna.delete()
            }
        }
    }
}

private val jsonDnevnik = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

// Pretvori posamezen ZapisKlica v JSON niz.
fun zapisKlicaVJson(zapis: ZapisKlica): String {
    return jsonDnevnik.encodeToString(zapis)
}

// Prebere posamezen ZapisKlica iz JSON niza; ob napaki ali neveljavni vsebini vrne null.
fun zapisKlicaIzJson(json: String): ZapisKlica? {
    if (json.isBlank()) return null
    return try {
        val zapis = jsonDnevnik.decodeFromString<ZapisKlica>(json)
        if (jeVeljavenZapisKlica(zapis)) zapis else null
    } catch (e: Exception) {
        null
    }
}

private fun normalizirajZaPreverbo(besedilo: String): String {
    return besedilo
        .replace('č', 'c')
        .replace('Č', 'C')
        .replace('š', 's')
        .replace('Š', 'S')
        .replace('ž', 'z')
        .replace('Ž', 'Z')
        .lowercase()
}

private val vzorecCeneBesede = Regex(
    "\\b(?:cena\\s+je\\s*\\d+|stane\\s+\\d+|znesek\\s+je\\s*\\d+)\\b",
    RegexOption.IGNORE_CASE
)

private val vzorecObljube = Regex(
    "\\b(?:potrjujem\\s+narocilo|potrjujemo\\s+narocilo|narocilo\\s+je\\s+potrjeno|" +
        "obljubim|obljubimo|obljubljam|obljubljamo|zagotavljam\\s+rok|zagotavljamo\\s+rok|" +
        "garantiram|garantiramo|order\\s+is\\s+confirmed|we\\s+promise)\\b",
    RegexOption.IGNORE_CASE
)

// Preveri, ali besedilo vsebuje nedovoljeno ceno, obljubo brezplacnosti ali obljubo potrditve/roka.
fun vsebujeCenoAliObljubo(besedilo: String): Boolean {
    if (besedilo.isBlank()) return false
    if (vsebujeCenoAliBrezplacno(besedilo)) return true
    val normirano = normalizirajZaPreverbo(besedilo)
    return vzorecCeneBesede.containsMatchIn(normirano) || vzorecObljube.containsMatchIn(normirano)
}

// Preveri, ali zapis klica izpolnjuje vsa pravila integritete in zasebnosti (brez cen in obljub).
fun jeVeljavenZapisKlica(zapis: ZapisKlica): Boolean {
    if (zapis.id.isBlank()) return false
    if (zapis.stevilka.isBlank()) return false
    if (zapis.casZacetka < 0L) return false
    if (zapis.trajanjeS < 0) return false
    // Pravilo o cenah in obljubah velja za Linine izjave. Sporocilo klicatelja je njegovo (lahko omeni ceno): zavrnitev bi zapis klica izgubila.
    if (zapis.sporocilo.isBlank() && vsebujeCenoAliObljubo(zapis.povzetek)) return false
    if (vsebujeCenoAliObljubo(zapis.prepis)) return false
    return true
}

// Cista logika: sinhronizacija dnevnika je dovoljena samo v ozadju, ko uporabnik telefona ne potrebuje, in nikoli med klicem.
fun smemSinhroniziratiDnevnik(
    medKlicem: Boolean,
    uporabljaAsistentko: Boolean = false,
    aktivnoSnemanje: Boolean = false,
    povezava: PovezavaStanje = PovezavaStanje.DOMA_LAN
): Boolean {
    if (medKlicem || uporabljaAsistentko || aktivnoSnemanje) return false
    return when (povezava) {
        PovezavaStanje.DOMA_LAN,
        PovezavaStanje.GLOBAL_NEPOSREDNO,
        PovezavaStanje.GLOBAL_RELE -> true
        PovezavaStanje.NI_PARJENO,
        PovezavaStanje.NEDOSEGLJIVO -> false
    }
}

// Dnevnik klicev na telefonu: deluje samostojno brez racunalnika, sinhronizacijo pa zbira v vrsti za ozadje.
class DnevnikKlicev(
    private val shramba: Shramba,
    @Suppress("UNUSED_PARAMETER") private val odjemalec: LokalniPreizkusniOdjemalec? = null
) {
    private val zapisi = linkedMapOf<String, ZapisKlica>()
    private val vrstaSinhronizacije = linkedMapOf<String, ZapisKlicaSinhronizacija>()
    private var branjeSpodletelo = false

    init {
        try {
            naloziIzShrambe()
        } catch (e: Exception) {
            branjeSpodletelo = true
        }
    }

    // Doda nov zapis klica (brez omreznega klica); zavrne zapis, ce vsebuje ceno ali obljubo.
    @Synchronized
    fun dodaj(zapis: ZapisKlica): Boolean {
        if (!jeVeljavenZapisKlica(zapis)) {
            return false
        }
        if (branjeSpodletelo) {
            return false
        }
        val predlaganiZapisi = zapisi.toMutableMap()
        val predlaganiCakajoci = vrstaSinhronizacije.toMutableMap()
        predlaganiZapisi[zapis.id] = zapis
        predlaganiCakajoci[zapis.id] = zapis.zaSinhronizacijo()
        shraniVShrambo(predlaganiZapisi.values, predlaganiCakajoci.values)
        zapisi[zapis.id] = zapis
        vrstaSinhronizacije[zapis.id] = zapis.zaSinhronizacijo()
        return true
    }

    // Vrne seznam klicev urejen po datumu (od najnovejsega), pri cemer so nujni klici privzeto na vrhu.
    @Synchronized
    fun seznamPoDatumu(nujniNaVrhu: Boolean = true): List<ZapisKlica> {
        return urediZapise(zapisi.values, nujniNaVrhu)
    }

    // Okrajsava za seznam klicev z nujnimi klici na vrhu.
    fun seznam(nujniNaVrhu: Boolean = true): List<ZapisKlica> = seznamPoDatumu(nujniNaVrhu)

    // Poisce klice po stevilki, povzetku, prepisu ali nacinu; nujni zadetki so na vrhu.
    @Synchronized
    fun poisci(poizvedba: String): List<ZapisKlica> {
        val iskalniNiz = normalizirajZaPreverbo(poizvedba.trim())
        if (iskalniNiz.isEmpty()) return emptyList()

        val zadetki = zapisi.values.filter { zapis ->
            normalizirajZaPreverbo(zapis.stevilka).contains(iskalniNiz) ||
                normalizirajZaPreverbo(zapis.povzetek).contains(iskalniNiz) ||
                normalizirajZaPreverbo(zapis.prepis).contains(iskalniNiz) ||
                normalizirajZaPreverbo(zapis.nacin.koda).contains(iskalniNiz) ||
                (zapis.nujno && "nujno".contains(iskalniNiz))
        }
        return urediZapise(zadetki, nujniNaVrhu = true)
    }

    // Izbrise zapis klica SAMO ob izrecni zahtevi/potrditvi uporabnika.
    @Synchronized
    fun izbrisi(id: String, potrditevUporabnika: Boolean = false): Boolean {
        if (!potrditevUporabnika) {
            return false
        }
        if (branjeSpodletelo) {
            return false
        }
        if (!zapisi.containsKey(id)) return false
        val predlaganiZapisi = zapisi.toMutableMap()
        val predlaganiCakajoci = vrstaSinhronizacije.toMutableMap()
        predlaganiZapisi.remove(id)
        predlaganiCakajoci.remove(id)
        shraniVShrambo(predlaganiZapisi.values, predlaganiCakajoci.values)
        zapisi.remove(id)
        vrstaSinhronizacije.remove(id)
        return true
    }

    // Vrne zapise, ki cakajo v vrsti za sinhronizacijo z racunalnikom (brez prepisa).
    @Synchronized
    fun cakajociZaSinhronizacijo(): List<ZapisKlicaSinhronizacija> {
        return vrstaSinhronizacije.values.sortedWith(
            compareByDescending<ZapisKlicaSinhronizacija> { it.nujno }
                .thenByDescending { it.casZacetka }
                .thenBy { it.id }
        )
    }

    // Serializira vrsto za sinhronizacijo v JSON (brez prepisa pogovora).
    @Synchronized
    fun vJsonZaSinhronizacijo(): String {
        val paket = DnevnikKlicevSinhronizacijaPaket(
            verzija = 1,
            zapisi = cakajociZaSinhronizacijo()
        )
        return jsonDnevnik.encodeToString(paket)
    }

    // Izvede sinhronizacijo vrste samo v ozadju (nikoli med klicem ali uporabo asistentke).
    fun poskusiSinhronizacijoVOzadju(
        medKlicem: Boolean,
        uporabljaAsistentko: Boolean = false,
        aktivnoSnemanje: Boolean = false,
        povezava: PovezavaStanje = PovezavaStanje.DOMA_LAN,
        posiljatelj: (List<ZapisKlicaSinhronizacija>) -> Boolean
    ): Boolean {
        if (!smemSinhroniziratiDnevnik(medKlicem, uporabljaAsistentko, aktivnoSnemanje, povezava)) {
            return false
        }
        val zaPosiljanje = synchronized(this) { cakajociZaSinhronizacijo() }
        if (zaPosiljanje.isEmpty()) {
            return true
        }
        val uspeh = try {
            posiljatelj(zaPosiljanje)
        } catch (e: Exception) {
            false
        }
        if (uspeh) potrdiPoslane(zaPosiljanje)
        return uspeh
    }

    // Po uspesni izmenjavi z racunalnikom odstrani iz vrste SAMO tiste zapise, ki so bili poslani in se medtem niso spremenili.
    fun potrdiPoslane(zaPosiljanje: List<ZapisKlicaSinhronizacija>) {
        synchronized(this) {
            // Po neuspeli ponovni nalozitvi shramba morda hrani novejsi posnetek, ki ga nismo mogli prebrati:
            // potrditve ne zapisemo (revizija ostane cakajoca; ponovno posiljanje je varnejse od prepisa).
            if (branjeSpodletelo) return
            var sprememba = false
            val predlagani = vrstaSinhronizacije.toMutableMap()
            for (element in zaPosiljanje) {
                if (predlagani[element.id] == element) {
                    predlagani.remove(element.id)
                    sprememba = true
                }
            }
            if (sprememba) {
                shraniVShrambo(zapisi.values, predlagani.values)
                vrstaSinhronizacije.clear()
                vrstaSinhronizacije.putAll(predlagani)
            }
        }
    }

    // Zapisi klicev, ki jih racunalnik pozna, telefon pa ne (npr. ob ponovni namestitvi): se dodajo brez prepisa in NE gredo v vrsto za posiljanje.
    @Synchronized
    fun sprejmiIzRacunalnika(prejeti: List<ZapisKlicaSinhronizacija>): Int {
        if (branjeSpodletelo) return 0
        val predlagani = zapisi.toMutableMap()
        var dodanih = 0
        for (p in prejeti) {
            if (predlagani.containsKey(p.id)) continue
            val zapis = ZapisKlica(
                id = p.id, casZacetka = p.casZacetka, stevilka = p.stevilka, trajanjeS = p.trajanjeS, nujno = p.nujno,
                povzetek = p.povzetek, nacin = p.nacin, klicatelj = p.klicatelj, podjetje = p.podjetje, sporocilo = p.sporocilo,
                sporociloDobesedno = p.sporociloDobesedno, brezSporocilaRazlog = p.brezSporocilaRazlog,
            )
            if (!jeVeljavenZapisKlica(zapis)) continue
            predlagani[zapis.id] = zapis
            dodanih++
        }
        if (dodanih > 0) {
            shraniVShrambo(predlagani.values, vrstaSinhronizacije.values)
            zapisi.clear()
            zapisi.putAll(predlagani)
        }
        return dodanih
    }

    // Prebere zapise iz lokalne shrambe; poskodovano datoteko ali poskodovane posamezne vnose varno zavrne brez izgube ostalih zapisov.
    @Synchronized
    fun naloziIzShrambe(): Boolean {
        val surovo = try {
            shramba.preberi()
        } catch (e: Exception) {
            branjeSpodletelo = true
            return false
        }
        branjeSpodletelo = false
        if (surovo == null) {
            return zapisi.isEmpty()
        }
        if (surovo.isBlank()) {
            return zapisi.isEmpty()
        }
        val uspelo = naloziRazclenjeno(surovo)
        // Zavrnjena datoteka ob praznem pomnilniku: ni dokaza, da je prazen dnevnik pravilen, zato pisanje
        // (ki bi prepisalo datoteko) ostane blokirano do uspesne ponovne nalozitve.
        if (!uspelo && zapisi.isEmpty() && vrstaSinhronizacije.isEmpty()) {
            branjeSpodletelo = true
        }
        return uspelo
    }

    private fun naloziRazclenjeno(surovo: String): Boolean {
        return try {
            val koren = jsonDnevnik.parseToJsonElement(surovo)
            val seznamElementov: JsonArray
            var cakajociElementi: JsonArray? = null
            when (koren) {
                is JsonObject -> {
                    val verzija = koren["verzija"]?.jsonPrimitive?.intOrNull ?: return false
                    if (verzija != 1) return false
                    val poljeZapisi = koren["zapisi"]
                    if (poljeZapisi !is JsonArray) return false
                    seznamElementov = poljeZapisi
                    val poljeCakajoci = koren["cakajoci"]
                    if (poljeCakajoci != null && poljeCakajoci !is JsonArray) return false
                    cakajociElementi = poljeCakajoci as? JsonArray
                }
                is JsonArray -> {
                    seznamElementov = koren
                }
                else -> return false
            }

            var vsajEnPoskodovan = false
            val prebraniVeljavni = mutableListOf<ZapisKlica>()
            val prebraniCakajoci = mutableListOf<ZapisKlicaSinhronizacija>()

            for (element in seznamElementov) {
                try {
                    val zapis = jsonDnevnik.decodeFromJsonElement<ZapisKlica>(element)
                    if (jeVeljavenZapisKlica(zapis)) {
                        prebraniVeljavni.add(zapis)
                    } else {
                        vsajEnPoskodovan = true
                    }
                } catch (e: Exception) {
                    // Poskodovan posamezen zapis preskocimo, da ne izgubimo ostalih veljavnih zapisov v datoteki.
                    vsajEnPoskodovan = true
                }
            }

            if (cakajociElementi != null) {
                for (element in cakajociElementi) {
                    try {
                        val cakajoc = jsonDnevnik.decodeFromJsonElement<ZapisKlicaSinhronizacija>(element)
                        val veljavenKlic = prebraniVeljavni.firstOrNull { it.id == cakajoc.id }
                        if (veljavenKlic != null) {
                            // Vir resnice je klic: projekcija se vedno obnovi iz njega, nikoli ne prevzame vsebine iz datoteke
                            // (zastarela ali spremenjena projekcija ne izgubi klica iz vrste in ne poslje tuje stevilke).
                            prebraniCakajoci.add(veljavenKlic.zaSinhronizacijo())
                            if (veljavenKlic.zaSinhronizacijo() != cakajoc) vsajEnPoskodovan = true
                        } else {
                            // osirotela projekcija (klica ni ali je neveljaven): ne postane trajna in se ne poslje
                            vsajEnPoskodovan = true
                        }
                    } catch (e: Exception) {
                        vsajEnPoskodovan = true
                    }
                }
            }

            for (zapis in prebraniVeljavni) {
                zapisi[zapis.id] = zapis
            }
            if (cakajociElementi != null) {
                vrstaSinhronizacije.clear()
                for (cakajoc in prebraniCakajoci) {
                    vrstaSinhronizacije[cakajoc.id] = cakajoc
                }
            }
            // vrsta ne sme kazati na klic, ki ga dnevnik nima
            vrstaSinhronizacije.keys.retainAll(zapisi.keys)

            if (vsajEnPoskodovan && zapisi.isNotEmpty()) {
                // Ce smo iz delno poskodovane datoteke resili veljavne zapise, jih takoj varno zapisemo nazaj.
                shraniVShrambo()
            }
            !vsajEnPoskodovan || prebraniVeljavni.isNotEmpty()
        } catch (e: Exception) {
            // Celotna datoteka je okrnjena ali neveljaven JSON: varno zavrnemo brez brisanja obstojecih zapisov v pomnilniku.
            false
        }
    }

    private fun shraniVShrambo(
        predlaganiZapisi: Collection<ZapisKlica> = zapisi.values,
        predlaganiCakajoci: Collection<ZapisKlicaSinhronizacija> = vrstaSinhronizacije.values
    ) {
        val urejeni = urediZapise(predlaganiZapisi, nujniNaVrhu = true)
        val cakajoci = predlaganiCakajoci.sortedWith(
            compareByDescending<ZapisKlicaSinhronizacija> { it.nujno }
                .thenByDescending { it.casZacetka }
                .thenBy { it.id }
        )
        val ovoj = DnevnikKlicevShramba(verzija = 1, zapisi = urejeni, cakajoci = cakajoci)
        val json = jsonDnevnik.encodeToString(ovoj)
        shramba.shrani(json)
    }

    private fun urediZapise(vhod: Collection<ZapisKlica>, nujniNaVrhu: Boolean): List<ZapisKlica> {
        return if (nujniNaVrhu) {
            vhod.sortedWith(
                compareByDescending<ZapisKlica> { it.nujno }
                    .thenByDescending { it.casZacetka }
                    .thenBy { it.id }
            )
        } else {
            vhod.sortedWith(
                compareByDescending<ZapisKlica> { it.casZacetka }
                    .thenBy { it.id }
            )
        }
    }
}
