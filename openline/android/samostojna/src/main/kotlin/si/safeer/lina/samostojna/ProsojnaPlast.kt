package si.safeer.lina.samostojna

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

/*
 * Prosojna plast predloge cez fotografijo majice (lastnik 23. 11. 2026). Cista geometrija brez Androida:
 * - poravnava predloge je v PIKSLIH FOTOGRAFIJE (sredisce predloge, zasuk v stopinjah v smeri urinega kazalca pri y navzdol,
 *   merilo = piksli fotografije na piksel predloge), zato se obnovi enako na vsakem zaslonu;
 * - merilna ravnina iz 4 vogalov oznake ArUco znane stranice (nacrt vid-kontrola-tiska-1510: DICT_4X4_50, 50 mm):
 *   podobnostna preslikava (merilo, zasuk, premik; najmanjsi kvadrati) piksli fotografije -> mm, izhodisce v sredini oznake,
 *   x in y vzdolz robov oznake. Polne homografije iz ENE majhne oznake ne uporabljamo: 1 px napake tapa da 200 mm stran do
 *   4,7 mm napake, podobnost 0,37 mm (teki/09-obcutljivost.txt); perspektivo odpravi pravokoten posnetek (NACRT.md par. 4);
 * - polozaj predloge v mm, njen zasuk in sirina; odmik od shranjene poravnave.
 */

data class TockaSlike(val x: Double, val y: Double)

data class Poravnava(
    val x: Double,
    val y: Double,
    val kot: Double,
    val merilo: Double,
    val prosojnost: Double = PRIVZETA_PROSOJNOST,
    val zaklenjena: Boolean = false,
)

/** Polozaj sredisca predloge v mm od sredine oznake, zasuk glede na rob oznake (stopinje) in sirina predloge v mm. */
data class PolozajMm(val x: Double, val y: Double, val kot: Double, val sirina: Double)

data class OdmikPredloge(val dx: Double, val dy: Double, val zasuk: Double)

data class ShranjenaPoravnava(
    val poravnava: Poravnava,
    /** Mere predloge v pikslih ob shranjevanju: poravnava velja samo za isto predlogo. */
    val wPredloge: Int,
    val hPredloge: Int,
    val kotiOznake: List<TockaSlike>?,
    val stranicaMm: Double,
    val referenca: PolozajMm?,
)

const val PRIVZETA_PROSOJNOST = 0.5
const val NAJMANJSA_PROSOJNOST = 0.05
const val NAJMANJSE_MERILO = 0.01
const val NAJVECJE_MERILO = 100.0
const val PRIVZETA_STRANICA_OZNAKE_MM = 50.0
/** Oznaka, ki je na fotografiji manjsa od tega (stranica v pikslih), ne da zanesljive meritve. */
private const val NAJMANJSA_OZNAKA_PIK = 8.0

private fun koncno(vararg v: Double) = v.all { it.isFinite() }

fun normalizirajKot(stopinje: Double): Double {
    var k = stopinje % 360.0
    if (k <= -180.0) k += 360.0
    if (k > 180.0) k -= 360.0
    return k
}

fun omejiProsojnost(p: Double): Double = if (p.isNaN()) PRIVZETA_PROSOJNOST else p.coerceIn(NAJMANJSA_PROSOJNOST, 1.0)

/** Predloga na sredini fotografije, cela vidna, na 60 % daljse omejitve. */
fun zacetnaPoravnava(wPredloge: Int, hPredloge: Int, wSlike: Int, hSlike: Int): Poravnava {
    if (wPredloge <= 0 || hPredloge <= 0 || wSlike <= 0 || hSlike <= 0) return Poravnava(wSlike / 2.0, hSlike / 2.0, 0.0, 1.0)
    val m = 0.6 * min(wSlike.toDouble() / wPredloge, hSlike.toDouble() / hPredloge)
    return Poravnava(wSlike / 2.0, hSlike / 2.0, 0.0, m.coerceIn(NAJMANJSE_MERILO, NAJVECJE_MERILO))
}

fun Poravnava.premakni(dx: Double, dy: Double): Poravnava =
    if (zaklenjena || !koncno(dx, dy)) this else copy(x = x + dx, y = y + dy)

/** Povecava za [faktor] in zasuk za [zasuk] stopinj okoli [sredisce] (tocka med prsti v pikslih fotografije). */
fun Poravnava.kretnja(sredisce: TockaSlike, faktor: Double, zasuk: Double): Poravnava {
    if (zaklenjena || !koncno(sredisce.x, sredisce.y, faktor, zasuk) || faktor <= 0) return this
    val novo = (merilo * faktor).coerceIn(NAJMANJSE_MERILO, NAJVECJE_MERILO)
    val f = novo / merilo
    val r = Math.toRadians(zasuk)
    val dx = x - sredisce.x; val dy = y - sredisce.y
    return copy(
        x = sredisce.x + f * (dx * cos(r) - dy * sin(r)),
        y = sredisce.y + f * (dx * sin(r) + dy * cos(r)),
        kot = normalizirajKot(kot + zasuk),
        merilo = novo,
    )
}

/** Tocka predloge (piksli predloge) v piksle fotografije. */
fun predlogaVSliko(p: Poravnava, wPredloge: Int, hPredloge: Int, t: TockaSlike): TockaSlike {
    val r = Math.toRadians(p.kot)
    val dx = (t.x - wPredloge / 2.0) * p.merilo
    val dy = (t.y - hPredloge / 2.0) * p.merilo
    return TockaSlike(p.x + dx * cos(r) - dy * sin(r), p.y + dx * sin(r) + dy * cos(r))
}

fun preslikaj(h: DoubleArray, t: TockaSlike): TockaSlike {
    val w = h[6] * t.x + h[7] * t.y + h[8]
    return TockaSlike((h[0] * t.x + h[1] * t.y + h[2]) / w, (h[3] * t.x + h[4] * t.y + h[5]) / w)
}

/**
 * Preslikava piksli fotografije -> mm na ravnini oznake (3x3 v vrsticah, za [preslikaj]). Vogali v vrstnem redu zgoraj levo,
 * zgoraj desno, spodaj desno, spodaj levo (na fotografiji v smeri urinega kazalca); konveksen stirikotnik z vsako stranico
 * vsaj [NAJMANJSA_OZNAKA_PIK]. Podobnost po najmanjsih kvadratih iz vseh 4 vogalov (napaka enega tapa se razdeli).
 */
fun merilnaRavnina(kotiOznake: List<TockaSlike>, stranicaMm: Double): DoubleArray? {
    if (kotiOznake.size != 4 || !stranicaMm.isFinite() || stranicaMm <= 0) return null
    if (kotiOznake.any { !koncno(it.x, it.y) }) return null
    for (i in 0 until 4) {
        val a = kotiOznake[i]; val b = kotiOznake[(i + 1) % 4]; val c = kotiOznake[(i + 2) % 4]
        if (hypot(b.x - a.x, b.y - a.y) < NAJMANJSA_OZNAKA_PIK) return null
        val vektorski = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
        if (vektorski <= 0) return null
    }
    val p = stranicaMm / 2
    val mm = listOf(TockaSlike(-p, -p), TockaSlike(p, -p), TockaSlike(p, p), TockaSlike(-p, p))
    val sx = kotiOznake.sumOf { it.x } / 4; val sy = kotiOznake.sumOf { it.y } / 4
    var vsota = 0.0; var a = 0.0; var b = 0.0
    for (i in 0 until 4) {
        val x = kotiOznake[i].x - sx; val y = kotiOznake[i].y - sy
        vsota += x * x + y * y
        a += x * mm[i].x + y * mm[i].y
        b += x * mm[i].y - y * mm[i].x
    }
    a /= vsota; b /= vsota
    // mm = [a -b; b a] * (tocka - sredisce vogalov); sredisce mm je (0, 0).
    val h = doubleArrayOf(a, -b, -(a * sx - b * sy), b, a, -(b * sx + a * sy), 0.0, 0.0, 1.0)
    return if (h.all { it.isFinite() }) h else null
}

fun polozajVMm(h: DoubleArray, p: Poravnava, wPredloge: Int, hPredloge: Int): PolozajMm {
    val c = preslikaj(h, predlogaVSliko(p, wPredloge, hPredloge, TockaSlike(wPredloge / 2.0, hPredloge / 2.0)))
    val l = preslikaj(h, predlogaVSliko(p, wPredloge, hPredloge, TockaSlike(0.0, hPredloge / 2.0)))
    val d = preslikaj(h, predlogaVSliko(p, wPredloge, hPredloge, TockaSlike(wPredloge.toDouble(), hPredloge / 2.0)))
    return PolozajMm(c.x, c.y, Math.toDegrees(atan2(d.y - l.y, d.x - l.x)), hypot(d.x - l.x, d.y - l.y))
}

fun odmik(referenca: PolozajMm, zdaj: PolozajMm) =
    OdmikPredloge(zdaj.x - referenca.x, zdaj.y - referenca.y, normalizirajKot(zdaj.kot - referenca.kot))

/** Stranica oznake iz polja (tudi z decimalno vejico); med 5 in 1000 mm, sicer null. */
fun stranicaOznake(besedilo: String): Double? =
    besedilo.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() && it in 5.0..1000.0 }

private const val RAZLICICA_ZAPISA = 1

fun zapisPoravnave(s: ShranjenaPoravnava): String = buildJsonObject {
    put("v", RAZLICICA_ZAPISA)
    put("x", s.poravnava.x); put("y", s.poravnava.y); put("kot", s.poravnava.kot); put("merilo", s.poravnava.merilo)
    put("prosojnost", s.poravnava.prosojnost); put("zaklep", s.poravnava.zaklenjena)
    put("w", s.wPredloge); put("h", s.hPredloge)
    s.kotiOznake?.let { k -> put("oznaka", JsonArray(k.flatMap { listOf(JsonPrimitive(it.x), JsonPrimitive(it.y)) })) }
    put("stranica", s.stranicaMm)
    s.referenca?.let { r -> put("ref", JsonArray(listOf(r.x, r.y, r.kot, r.sirina).map { JsonPrimitive(it) })) }
}.toString()

/** Prebere zapis; pokvarjen, tuj ali nesmiseln zapis vrne null. Neveljavni vogali oznake ali referenca se zavrzejo. */
fun preberiPoravnavo(zapis: String?): ShranjenaPoravnava? {
    if (zapis.isNullOrBlank()) return null
    val o = runCatching { Json.parseToJsonElement(zapis) as? JsonObject }.getOrNull() ?: return null
    fun d(k: String) = runCatching { o[k]?.jsonPrimitive?.doubleOrNull }.getOrNull()
    fun i(k: String) = runCatching { o[k]?.jsonPrimitive?.intOrNull }.getOrNull()
    fun stevila(k: String) = runCatching { (o[k] as? JsonArray)?.map { it.jsonPrimitive.doubleOrNull ?: Double.NaN } }.getOrNull()
    if (i("v") != RAZLICICA_ZAPISA) return null
    val x = d("x") ?: return null; val y = d("y") ?: return null; val kot = d("kot") ?: return null
    val merilo = d("merilo") ?: return null
    val w = i("w") ?: return null; val h = i("h") ?: return null
    if (!koncno(x, y, kot, merilo) || merilo !in NAJMANJSE_MERILO..NAJVECJE_MERILO || w <= 0 || h <= 0) return null
    val zaklep = runCatching { o["zaklep"]?.jsonPrimitive?.booleanOrNull }.getOrNull() ?: false
    val stranica = d("stranica")?.takeIf { it.isFinite() && it in 5.0..1000.0 } ?: PRIVZETA_STRANICA_OZNAKE_MM
    val koti = stevila("oznaka")?.takeIf { it.size == 8 }?.chunked(2)?.map { TockaSlike(it[0], it[1]) }
        ?.takeIf { merilnaRavnina(it, stranica) != null }
    val ref = stevila("ref")?.takeIf { it.size == 4 && it.all { v -> v.isFinite() } }?.let { PolozajMm(it[0], it[1], it[2], it[3]) }
    return ShranjenaPoravnava(
        Poravnava(x, y, normalizirajKot(kot), merilo, omejiProsojnost(d("prosojnost") ?: Double.NaN), zaklep),
        w, h, koti, stranica, ref,
    )
}
