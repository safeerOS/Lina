package si.safeer.lina.podpis

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** En dodatek na racunalniku: shranjeno stikalo in dejansko stanje (izklopljen, se_zaganja, deluje, napaka, ni_na_voljo). */
data class DodatekRacunalnika(val id: String, val vklopljen: Boolean, val stanje: String, val razlog: String)

/** Kaj uporabnik izve ob neuspehu (kljuc besedila v aplikaciji). STARA_LINA = Lina na racunalniku te poti se nima (404, 405 ali koda "ni"). */
enum class NapakaDodatkov { NEDOSEGLJIV, ZAVRNJENO, PREVEC, STARA_LINA, NAPAKA }

sealed class IzidDodatkov {
    data class Ok(val dodatki: List<DodatekRacunalnika>) : IzidDodatkov()
    data class Napaka(val vrsta: NapakaDodatkov) : IzidDodatkov()
}

/**
 * Dodatki na racunalniku s telefona (lastnik 23. 11. 2026; pogodba v Lininem AGENTS.md »Dodatki na racunalniku«): podpisano
 * GET /dodatki in POST /dodatek prek iste povezave kot naloge (IzbirnaPovezava). Odgovor racunalnika je nezaupljiv: samo znani
 * dodatki in stanja, sicer se zavrze ves. Podpis gre samo skozi Podpisnik (niz sestavi NiziLine).
 */
object DodatkiLine {
    val STANJA = setOf("izklopljen", "se_zaganja", "deluje", "napaka", "ni_na_voljo")
    private const val NAJVEC_RAZLOGA = 80
    private val RAZLOG = Regex("^[a-z0-9-]{0,$NAJVEC_RAZLOGA}$")
    private val json = Json { ignoreUnknownKeys = true }

    fun teloPreklopa(posiljatelj: String, dodatek: String, vklop: Boolean, cas: Long, enkratni: String, podpis: String): String = buildJsonObject {
        put("posiljatelj", posiljatelj); put("dodatek", dodatek); put("vklop", vklop)
        put("cas", cas); put("enkratni", enkratni); put("podpis", podpis)
    }.toString()

    /** {"dodatki":[{id, vklopljen, stanje, razlog}]}; vsak dodatek najvec enkrat, samo znani. null = neveljaven odgovor. */
    fun razcleni(telo: String): List<DodatekRacunalnika>? = runCatching {
        if (telo.length > AsistentProtokol.NAJVEC_ODGOVORA) return null
        val seznam = json.parseToJsonElement(telo).jsonObject["dodatki"]!!.jsonArray
        if (seznam.size > NiziLine.DODATKI.size) return null
        val izid = seznam.map { e ->
            val o = e as JsonObject
            val id = (o["id"] as JsonPrimitive).takeIf { it.isString }!!.content
            val vklopljen = (o["vklopljen"] as JsonPrimitive).takeUnless { it.isString }!!.booleanOrNull!!
            val stanje = (o["stanje"] as JsonPrimitive).takeIf { it.isString }!!.content
            val razlog = (o["razlog"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: ""
            if (id !in NiziLine.DODATKI || stanje !in STANJA || !RAZLOG.matches(razlog)) return null
            DodatekRacunalnika(id, vklopljen, stanje, razlog)
        }
        if (izid.map { it.id }.toSet().size != izid.size) return null
        izid
    }.getOrNull()

    fun napaka(o: OdgovorLine): NapakaDodatkov = when (o) {
        is OdgovorLine.Ok -> NapakaDodatkov.NAPAKA // neveljavno telo
        OdgovorLine.Nedosegljiva -> NapakaDodatkov.NEDOSEGLJIV
        is OdgovorLine.Napaka -> when (o.status) {
            403 -> NapakaDodatkov.ZAVRNJENO
            429 -> NapakaDodatkov.PREVEC
            // starejsa Lina vrne 404 ali 405 {"napaka":"ni"} (»Ni take poti.«), lastnik 25. 11. 2026
            404, 405 -> NapakaDodatkov.STARA_LINA
            else -> if (o.koda == "ni") NapakaDodatkov.STARA_LINA else NapakaDodatkov.NAPAKA
        }
    }

    private fun izid(o: OdgovorLine): IzidDodatkov =
        (o as? OdgovorLine.Ok)?.let { razcleni(it.telo) }?.let { IzidDodatkov.Ok(it) } ?: IzidDodatkov.Napaka(napaka(o))

    /** Podpisana poizvedba o stanju; [podpisi] = Podpisnik.podpisiStanjeDodatkov. Brez podpisa se ne poslje nic. */
    fun stanje(pov: PovezavaZLino, posiljatelj: String, cas: Long, enkratni: String, podpisi: (Long, String) -> String?): IzidDodatkov {
        val podpis = podpisi(cas, enkratni) ?: return IzidDodatkov.Napaka(NapakaDodatkov.NAPAKA)
        return izid(pov.stanjeDodatkov(posiljatelj, cas, enkratni, podpis))
    }

    /** Podpisan vklop ali izklop; [podpisi] = Podpisnik.podpisiDodatek. Vrne novo stanje vseh dodatkov. */
    fun preklopi(
        pov: PovezavaZLino, posiljatelj: String, dodatek: String, vklop: Boolean, cas: Long, enkratni: String,
        podpisi: (String, Boolean, Long, String) -> String?,
    ): IzidDodatkov {
        if (dodatek !in NiziLine.DODATKI) return IzidDodatkov.Napaka(NapakaDodatkov.NAPAKA)
        val podpis = podpisi(dodatek, vklop, cas, enkratni) ?: return IzidDodatkov.Napaka(NapakaDodatkov.NAPAKA)
        return izid(pov.dodatek(teloPreklopa(posiljatelj, dodatek, vklop, cas, enkratni, podpis)))
    }
}
