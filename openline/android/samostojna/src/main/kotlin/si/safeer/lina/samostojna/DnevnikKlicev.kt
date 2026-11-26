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
import kotlinx.serialization.json.contentOrNull
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
    val brezSporocilaRazlog: String = "",
    /** Dobesedno, kar je rekla Lina (prepis njenega govora; glasu klicatelja se ne snema). Na racunalnik gre kot del prepisPogovora. */
    val linaDobesedno: String = "",
    /** Ime iz imenika telefona za to stevilko ob koncu klica (lastnik 23. 11. 2026); prazno = ni v imeniku ali ni dovoljenja. Samo lokalno: ZapisKlicaSinhronizacija ga ne nosi. */
    val imeImenik: String = "",
    /**
     * Celoten prepis pogovora po vrsti (lastnik 25. 11. 2026: racunalnik naj zapise in shrani tudi pogovore klicev s telefona).
     * Samo besedilo, nikoli zvok. Ni pod pravilom o cenah in obljubah (jeVeljavenZapisKlica): izrek klicatelja ne sme izgubiti klica.
     */
    val prepisPogovora: List<IzmenjavaKlica> = emptyList(),
    /** true = prepis je bil zaradi meje skrajsan (konec pogovora manjka). */
    val prepisOkrnjen: Boolean = false,
    /** Samo lokalno: zapis je prisel z racunalnika (drug telefon, ponovna namestitev); cez mejo zapisov gre pred lastnimi (slepi pregled 0214 A8). */
    val prejetZRacunalnika: Boolean = false
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

    // Oblika za sinhronizacijo z racunalnikom: sporocilo klicatelja (lastnik 20. 11. 2026) in prepis pogovora v mejah (25. 11. 2026);
    // staro polje prepis (prost niz) in imeImenik ostaneta samo na telefonu.
    fun zaSinhronizacijo(): ZapisKlicaSinhronizacija {
        // Prepis dobi samo, kar od MEJA_ZAPISA_SINHRON_B ostane po ostalih poljih (vecbajtni znaki: slepi pregled N2).
        // Osnova s prepisOkrnjen=false kot na racunalniku (sPrepisom): "true" je 1 B krajsi, racunalnik bi okrnil zadnjo izmenjavo (0214 A3).
        val brez = jsonPrepis.encodeToString(projekcija(emptyList(), false)).toByteArray(Charsets.UTF_8).size
        val (prepis, skrajsan) = omejiPrepisZaSinhronizacijo(prepisPogovora, minOf(MEJA_PREPISA_SINHRON_B, MEJA_ZAPISA_SINHRON_B - brez))
        return projekcija(prepis, prepisOkrnjen || skrajsan)
    }

    private fun projekcija(prepis: List<IzmenjavaKlica>, okrnjen: Boolean) = ZapisKlicaSinhronizacija(
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
        brezSporocilaRazlog = skrajsajZaSinhronizacijo(brezSporocilaRazlog, 2000),
        prepisPogovora = prepis,
        prepisOkrnjen = okrnjen
    )
}

/** Ena izmenjava v prepisu klica: govorec ("klicatelj" ali "lina"), cas (epoch ms, ko je prisel prvi odlomek prepisa) in besedilo. */
@Serializable
data class IzmenjavaKlica(val govorec: String, val cas: Long, val besedilo: String)

/**
 * Najvec bajtov (UTF-8, JSON) prepisa v enem zapisu za racunalnik. Utemeljitev: racunalnik vraca klice v odgovorih do 48 KiB
 * (MEJA_ODGOVORA_B v sinhron-telefon.server.ts), telefon sprejme najvec 64 KiB (AsistentProtokol.NAJVEC_ODGOVORA), zahteva telefona
 * pa ima 400 000 B za klice. Prepis dobi samo, kar ostane do MEJA_ZAPISA_SINHRON_B po ostalih poljih (najvec ~38 KB, glej skrajsajZaSinhronizacijo).
 * Seja klica steje iste bajte (SejaKlica.MEJA_PREPISA_B, N8): ~23 000 B slovenskega besedila, npr. ~100 izmenjav po 170 znakov (~15-20 min pogovora).
 */
const val MEJA_PREPISA_SINHRON_B = 24 * 1024

/** Najvec bajtov celega zapisa za racunalnik (JSON UTF-8): pod 48 KiB odgovora racunalnika z rezervo za ovoj odgovora. */
const val MEJA_ZAPISA_SINHRON_B = 46 * 1024

private val jsonPrepis = Json { encodeDefaults = true }

/** Prepis v mejah za racunalnik: samo znana govorca, besedilo do MEJA_IZMENJAVE_ZNAKOV, skupaj do [mejaB] bajtov; ohrani zacetek. */
fun omejiPrepisZaSinhronizacijo(prepis: List<IzmenjavaKlica>, mejaB: Int = MEJA_PREPISA_SINHRON_B): Pair<List<IzmenjavaKlica>, Boolean> {
    val izhod = ArrayList<IzmenjavaKlica>()
    var bajti = 2
    var skrajsan = false
    for (i in prepis) {
        if (i.govorec != GOVOREC_KLICATELJ && i.govorec != GOVOREC_LINA) { skrajsan = true; continue }
        val b = skrajsajZaSinhronizacijo(i.besedilo, SejaKlica.MEJA_IZMENJAVE_ZNAKOV)
        if (b.isBlank()) continue
        if (b.length != i.besedilo.length) skrajsan = true
        val e = IzmenjavaKlica(i.govorec, i.cas.coerceAtLeast(0L), b)
        val velikost = jsonPrepis.encodeToString(e).toByteArray(Charsets.UTF_8).size + 1
        if (izhod.size >= SejaKlica.MEJA_IZMENJAV || bajti + velikost > mejaB) { skrajsan = true; break }
        izhod.add(e); bajti += velikost
    }
    return izhod to skrajsan
}

/** Najvec zapomnjenih izbrisov (N3; ~30 B na id): toliko klicev hrani tudi racunalnik (MEJA_KLICEV). */
const val MEJA_IZBRISANIH = 1000

/** Najvec zapisov klicev na telefonu (N4): kot racunalnik (MEJA_KLICEV v sinhron-telefon.server.ts). */
const val MEJA_ZAPISOV_TELEFON = 1000

/** Rok hrambe podjetniskega klica (lastnik 22. 11. 2026: podjetniski zapis 90 dni, osebni do izbrisa); meje roka z racunalnika
 *  (zapiskiHrambaDni, pravila.server.ts: privzeto 90, najvec 3650 dni). */
const val ROK_HRAMBE_PRIVZETO_DNI = 90
const val ROK_HRAMBE_NAJVEC_DNI = 3650
private const val DAN_MS = 24L * 60 * 60 * 1000

const val GOVOREC_KLICATELJ = "klicatelj"
const val GOVOREC_LINA = "lina"

/**
 * Besedilo v mejah, ki jih racunalnik sprejme (dolzina, brez osamljenih nadomestnih znakov): en zapis ne sme zatakniti sinhronizacije.
 * Kontrolni znaki razen \n, \r, \t se izpustijo (N2): v JSON so 6 B (\u0001), zato bi polna polja zapis dvignila nad MEJA_ZAPISA_SINHRON_B.
 * Tako je znak v JSON najvec 3 B na enoto UTF-16; vsa polja razen prepisa (12 540 enot) so pod 38 KB.
 */
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
        if (!Character.isLowSurrogate(c) && (c >= ' ' || c == '\n' || c == '\r' || c == '\t')) b.append(c)
        i++
    }
    r = b.toString()
    return r
}

// Zapis klica za sinhronizacijo z racunalnikom: s sporocilom klicatelja, razlogom, ce ga ni, in prepisom pogovora (prepisPogovora).
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
    val brezSporocilaRazlog: String = "",
    val prepisPogovora: List<IzmenjavaKlica> = emptyList(),
    val prepisOkrnjen: Boolean = false
)

@Serializable
private data class DnevnikKlicevShramba(
    val verzija: Int = 1,
    val zapisi: List<ZapisKlica>,
    val cakajoci: List<ZapisKlicaSinhronizacija> = emptyList(),
    /** Id zapisov s prepisom, ki jih je racunalnik brez zmoznosti prepisa (0.2.13) prejel brez njega (N1). */
    val zadrzaniPrepisi: List<String> = emptyList(),
    /** Id klicev, ki jih je uporabnik izbrisal (N3): z racunalnika se ne sprejmejo vec. */
    val izbrisani: List<String> = emptyList(),
    /** Izbrisi, ki jih racunalnik se ni potrdil (ZMOZNOST_IZBRIS). */
    val izbrisiZaRacunalnik: List<String> = emptyList(),
    /** Rok hrambe podjetniskih klicev, kot ga je zadnjic poslal racunalnik (0214 A7). */
    val rokHrambeDni: Int = ROK_HRAMBE_PRIVZETO_DNI
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
    @Suppress("UNUSED_PARAMETER") private val odjemalec: LokalniPreizkusniOdjemalec? = null,
    private val ura: () -> Long = System::currentTimeMillis
) {
    private val zapisi = linkedMapOf<String, ZapisKlica>()
    private val vrstaSinhronizacije = linkedMapOf<String, ZapisKlicaSinhronizacija>()
    /** Zapisi s prepisom, ki jih je racunalnik prejel brez prepisa: gredo znova v vrsto, ko racunalnik javi ZMOZNOST_PREPIS (N1). */
    private val zadrzaniPrepisi = linkedSetOf<String>()
    /** Izbrisani klici (N3): seznam zavrnitev za zapise z racunalnika in vrsta izbrisov, ki jih racunalnik se ni potrdil. */
    private val izbrisani = linkedSetOf<String>()
    private val izbrisiZaRac = linkedSetOf<String>()
    private var branjeSpodletelo = false
    private var rokHrambeDni = ROK_HRAMBE_PRIVZETO_DNI

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
        val predlaganiZadrzani = LinkedHashSet(zadrzaniPrepisi)
        uveljaviHrambo(predlaganiZapisi, predlaganiCakajoci, predlaganiZadrzani)
        shraniVShrambo(predlaganiZapisi.values, predlaganiCakajoci.values, predlaganiZadrzani)
        zapisi.clear()
        zapisi.putAll(predlaganiZapisi)
        vrstaSinhronizacije.clear()
        vrstaSinhronizacije.putAll(predlaganiCakajoci)
        zadrzaniPrepisi.clear()
        zadrzaniPrepisi.addAll(predlaganiZadrzani)
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
        val noviIzbrisani = (izbrisani + id).toList().takeLast(MEJA_IZBRISANIH)
        val noviZaRac = (izbrisiZaRac + id).toList().takeLast(MEJA_IZBRISANIH)
        shraniVShrambo(predlaganiZapisi.values, predlaganiCakajoci.values, zadrzaniPrepisi - id, noviIzbrisani, noviZaRac)
        zapisi.remove(id)
        vrstaSinhronizacije.remove(id)
        zadrzaniPrepisi.remove(id)
        izbrisani.clear(); izbrisani.addAll(noviIzbrisani)
        izbrisiZaRac.clear(); izbrisiZaRac.addAll(noviZaRac)
        return true
    }

    // Vrne zapise, ki cakajo v vrsti za sinhronizacijo z racunalnikom (s prepisPogovora, brez starega polja prepis).
    @Synchronized
    fun cakajociZaSinhronizacijo(): List<ZapisKlicaSinhronizacija> {
        return vrstaSinhronizacije.values.sortedWith(
            compareByDescending<ZapisKlicaSinhronizacija> { it.nujno }
                .thenByDescending { it.casZacetka }
                .thenBy { it.id }
        )
    }

    // Serializira vrsto za sinhronizacijo v JSON (s prepisPogovora v mejah, brez starega polja prepis).
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
    // prepisSprejet = racunalnik je javil ZMOZNOST_PREPIS; sicer se zapis s prepisom zadrzi za ponovno posiljanje (N1).
    fun potrdiPoslane(zaPosiljanje: List<ZapisKlicaSinhronizacija>, prepisSprejet: Boolean = false) {
        synchronized(this) {
            // Po neuspeli ponovni nalozitvi shramba morda hrani novejsi posnetek, ki ga nismo mogli prebrati:
            // potrditve ne zapisemo (revizija ostane cakajoca; ponovno posiljanje je varnejse od prepisa).
            if (branjeSpodletelo) return
            var sprememba = false
            val predlagani = vrstaSinhronizacije.toMutableMap()
            val zadrzani = LinkedHashSet(zadrzaniPrepisi)
            for (element in zaPosiljanje) {
                if (predlagani[element.id] == element) {
                    predlagani.remove(element.id)
                    if (!prepisSprejet && element.prepisPogovora.isNotEmpty()) zadrzani.add(element.id)
                    sprememba = true
                }
            }
            if (sprememba) {
                shraniVShrambo(zapisi.values, predlagani.values, zadrzani)
                vrstaSinhronizacije.clear()
                vrstaSinhronizacije.putAll(predlagani)
                zadrzaniPrepisi.clear()
                zadrzaniPrepisi.addAll(zadrzani)
            }
        }
    }

    // Izbrisi za racunalnik (N3), od najstarejsega.
    @Synchronized
    fun izbrisiZaRacunalnik(): List<String> = izbrisiZaRac.toList()

    // Racunalnik je javil ZMOZNOST_IZBRIS: poslani izbrisi so opravljeni (seznam zavrnitev ostane).
    @Synchronized
    fun potrdiIzbrise(poslani: List<String>) {
        if (branjeSpodletelo || poslani.none { it in izbrisiZaRac }) return
        val ostali = izbrisiZaRac - poslani.toSet()
        shraniVShrambo(predlaganiIzbrisiZaRac = ostali)
        izbrisiZaRac.clear(); izbrisiZaRac.addAll(ostali)
    }

    // Racunalnik je javil ZMOZNOST_PREPIS: zadrzani zapisi s prepisom gredo znova v vrsto (isti id, racunalnik dopolni prepis).
    @Synchronized
    fun vrniZadrzanePrepise() {
        if (branjeSpodletelo || zadrzaniPrepisi.isEmpty()) return
        val predlagani = vrstaSinhronizacije.toMutableMap()
        for (id in zadrzaniPrepisi) zapisi[id]?.let { predlagani[id] = it.zaSinhronizacijo() }
        shraniVShrambo(zapisi.values, predlagani.values, emptyList())
        vrstaSinhronizacije.clear()
        vrstaSinhronizacije.putAll(predlagani)
        zadrzaniPrepisi.clear()
    }

    // Zapisi klicev, ki jih racunalnik pozna, telefon pa ne (npr. ob ponovni namestitvi): se dodajo s prepisom v mejah (ce ga racunalnik poslje) in NE gredo v vrsto za posiljanje.
    @Synchronized
    fun sprejmiIzRacunalnika(prejeti: List<ZapisKlicaSinhronizacija>): Int {
        if (branjeSpodletelo) return 0
        val predlagani = zapisi.toMutableMap()
        val dodani = ArrayList<String>()
        val zdaj = ura()
        for (p in prejeti) {
            if (predlagani.containsKey(p.id) || p.id in izbrisani) continue
            // Cas vec kot dan v prihodnosti (pokvarjena ura ali napaka druge naprave) se zavrne; podjetniski po roku se ne sprejme (0214 A8, A2).
            if (p.casZacetka > zdaj + DAN_MS || potekel(p.nacin, p.casZacetka, zdaj)) continue
            // Prepis z racunalnika je nezaupan: iste meje kot za posiljanje (govorec, dolzina, bajti).
            val (prepis, skrajsan) = omejiPrepisZaSinhronizacijo(p.prepisPogovora)
            val zapis = ZapisKlica(
                id = p.id, casZacetka = p.casZacetka, stevilka = p.stevilka, trajanjeS = p.trajanjeS, nujno = p.nujno,
                povzetek = p.povzetek, nacin = p.nacin, klicatelj = p.klicatelj, podjetje = p.podjetje, sporocilo = p.sporocilo,
                sporociloDobesedno = p.sporociloDobesedno, brezSporocilaRazlog = p.brezSporocilaRazlog,
                prepisPogovora = prepis, prepisOkrnjen = p.prepisOkrnjen || skrajsan, prejetZRacunalnika = true,
            )
            if (!jeVeljavenZapisKlica(zapis)) continue
            predlagani[zapis.id] = zapis
            dodani.add(zapis.id)
        }
        val predlaganiCakajoci = vrstaSinhronizacije.toMutableMap()
        val predlaganiZadrzani = LinkedHashSet(zadrzaniPrepisi)
        if (uveljaviHrambo(predlagani, predlaganiCakajoci, predlaganiZadrzani) || dodani.isNotEmpty()) {
            shraniVShrambo(predlagani.values, predlaganiCakajoci.values, predlaganiZadrzani)
            zapisi.clear()
            zapisi.putAll(predlagani)
            vrstaSinhronizacije.clear()
            vrstaSinhronizacije.putAll(predlaganiCakajoci)
            zadrzaniPrepisi.clear()
            zadrzaniPrepisi.addAll(predlaganiZadrzani)
        }
        // Steje samo zapise, ki so po meji 1000 res ostali (slepi pregled 21t, #4).
        return dodani.count { it in zapisi }
    }

    /**
     * Rok hrambe in meja rasti (slepi pregled 17t N4 in 0214 A1, A2, A8; pravila hrambe lastnika 22. 11. 2026): podjetniski klic po roku
     * (rokHrambeDni z racunalnika, privzeto 90 dni) gre V CELOTI, tudi iz vrste in zadrzanih - kot na racunalniku (sinhron-telefon.server.ts,
     * potekelKlicTelefona), brez izbrisa za racunalnik (ta ga po svojem roku izbrise sam). Osebni ostane do izbrisa uporabnika.
     * Dnevnik najvec MEJA_ZAPISOV_TELEFON zapisov (kot racunalnik MEJA_KLICEV): cez mejo gredo najprej zapisi z racunalnika, nato lastni,
     * ki jih racunalnik ze ima, nazadnje cakajoci; znotraj skupine najstarejsi. true = sprememba.
     */
    private fun uveljaviHrambo(
        predlagani: MutableMap<String, ZapisKlica>,
        cakajoci: MutableMap<String, ZapisKlicaSinhronizacija>,
        zadrzani: MutableSet<String>,
        rokDni: Int = rokHrambeDni
    ): Boolean {
        var sprememba = false
        val zdaj = ura()
        for (z in predlagani.values.toList()) {
            if (potekel(z.nacin, z.casZacetka, zdaj, rokDni)) {
                predlagani.remove(z.id); cakajoci.remove(z.id); zadrzani.remove(z.id); sprememba = true
            }
        }
        val presezek = predlagani.size - MEJA_ZAPISOV_TELEFON
        if (presezek > 0) {
            predlagani.values.sortedWith(compareBy<ZapisKlica> { !it.prejetZRacunalnika }.thenBy { it.id in cakajoci || it.id in zadrzani }.thenBy { it.casZacetka }.thenBy { it.id })
                .take(presezek).forEach { predlagani.remove(it.id); cakajoci.remove(it.id); zadrzani.remove(it.id) }
            sprememba = true
        }
        return sprememba
    }

    private fun potekel(nacin: NacinKlica, cas: Long, zdaj: Long, rokDni: Int = rokHrambeDni) =
        nacin == NacinKlica.PODJETJE && zdaj - cas > rokDni * DAN_MS

    /** Rok hrambe podjetniskih klicev z racunalnika (zapiskiHrambaDni, 0214 A7); vrednost zunaj 1..3650 se ne uposteva. */
    @Synchronized
    fun nastaviRokHrambe(dni: Long) {
        if (branjeSpodletelo || dni < 1 || dni > ROK_HRAMBE_NAJVEC_DNI || dni.toInt() == rokHrambeDni) return
        val predlagani = zapisi.toMutableMap()
        val predlaganiCakajoci = vrstaSinhronizacije.toMutableMap()
        val predlaganiZadrzani = LinkedHashSet(zadrzaniPrepisi)
        uveljaviHrambo(predlagani, predlaganiCakajoci, predlaganiZadrzani, dni.toInt())
        shraniVShrambo(predlagani.values, predlaganiCakajoci.values, predlaganiZadrzani, rok = dni.toInt())
        rokHrambeDni = dni.toInt()
        zapisi.clear(); zapisi.putAll(predlagani)
        vrstaSinhronizacije.clear(); vrstaSinhronizacije.putAll(predlaganiCakajoci)
        zadrzaniPrepisi.clear(); zadrzaniPrepisi.addAll(predlaganiZadrzani)
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
            var zadrzaniElementi: JsonArray? = null
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
                    zadrzaniElementi = koren["zadrzaniPrepisi"] as? JsonArray
                    // Rok mora biti znan PRED uveljavitvijo hrambe ob nalaganju (sicer bi rok 365 dni ob vsakem zagonu padel na 90).
                    rokHrambeDni = koren["rokHrambeDni"]?.jsonPrimitive?.intOrNull?.takeIf { it in 1..ROK_HRAMBE_NAJVEC_DNI } ?: ROK_HRAMBE_PRIVZETO_DNI
                    for ((polje, cilj) in listOf("izbrisani" to izbrisani, "izbrisiZaRacunalnik" to izbrisiZaRac)) {
                        (koren[polje] as? JsonArray)?.let { el -> cilj.clear(); el.mapNotNullTo(cilj) { e -> runCatching { e.jsonPrimitive.contentOrNull }.getOrNull() } }
                    }
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
                            val projekcija = veljavenKlic.zaSinhronizacijo()
                            prebraniCakajoci.add(projekcija)
                            if (projekcija != cakajoc) vsajEnPoskodovan = true
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
            zadrzaniElementi?.let { el ->
                zadrzaniPrepisi.clear()
                el.mapNotNullTo(zadrzaniPrepisi) { e -> runCatching { e.jsonPrimitive.contentOrNull }.getOrNull()?.takeIf { it in zapisi } }
            }

            // Rok hrambe velja tudi ob zagonu, ne sele ob naslednjem klicu (0214 A1).
            val hramba = uveljaviHrambo(zapisi, vrstaSinhronizacije, zadrzaniPrepisi)
            if (vsajEnPoskodovan && zapisi.isNotEmpty()) {
                // Ce smo iz delno poskodovane datoteke resili veljavne zapise, jih takoj varno zapisemo nazaj.
                shraniVShrambo()
            } else if (hramba) {
                // Neuspel zapis ne blokira dnevnika: v pomnilniku je zapis ze izbrisan, datoteka se prepise ob naslednji spremembi.
                runCatching { shraniVShrambo() }
            }
            !vsajEnPoskodovan || prebraniVeljavni.isNotEmpty()
        } catch (e: Exception) {
            // Celotna datoteka je okrnjena ali neveljaven JSON: varno zavrnemo brez brisanja obstojecih zapisov v pomnilniku.
            false
        }
    }

    private fun shraniVShrambo(
        predlaganiZapisi: Collection<ZapisKlica> = zapisi.values,
        predlaganiCakajoci: Collection<ZapisKlicaSinhronizacija> = vrstaSinhronizacije.values,
        predlaganiZadrzani: Collection<String> = zadrzaniPrepisi,
        predlaganiIzbrisani: Collection<String> = izbrisani,
        predlaganiIzbrisiZaRac: Collection<String> = izbrisiZaRac,
        rok: Int = rokHrambeDni
    ) {
        val urejeni = urediZapise(predlaganiZapisi, nujniNaVrhu = true)
        val cakajoci = predlaganiCakajoci.sortedWith(
            compareByDescending<ZapisKlicaSinhronizacija> { it.nujno }
                .thenByDescending { it.casZacetka }
                .thenBy { it.id }
        )
        val ovoj = DnevnikKlicevShramba(verzija = 1, zapisi = urejeni, cakajoci = cakajoci, zadrzaniPrepisi = predlaganiZadrzani.toList(),
            izbrisani = predlaganiIzbrisani.toList(), izbrisiZaRacunalnik = predlaganiIzbrisiZaRac.toList(), rokHrambeDni = rok)
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
