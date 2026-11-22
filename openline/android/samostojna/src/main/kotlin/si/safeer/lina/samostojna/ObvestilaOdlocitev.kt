package si.safeer.lina.samostojna

import java.text.Normalizer

/**
 * Enotna odlocitev »ali Lina poslje obvestilo in kam« - prenos obvestila-odlocitev.ts z racunalnika (lastnik 22. 11. 2026),
 * da telefon odloca enako tudi brez racunalnika. Cista funkcija; cas in prisotnost sta vhod. Vrstni red pravil:
 * izklop vrste, ne moti / ure miru (nujno in VIP prebijeta), »pomembno«, ze prebrano, kam (racunalnik takoj, telefon z zakasnitvijo).
 */
enum class VrstaDogodka { KLIC, SPOROCILO, OPOMNIK, NUJNO, AGENT, NOVICA, MOTIVACIJA }
enum class RavenObvestil { VSE, POMEMBNO, NIC, PRIVZETO }
enum class NapravaObvestila { RACUNALNIK, TELEFON }
enum class RazlogObvestila { IZKLOPLJENO, NE_MOTI, NEPOMEMBNO, ZE_PREBRANO, NI_NAPRAVE, NUJNO, VIP, KLJUCNA_BESEDA, NEPOSREDNO, VSE }

data class DogodekObvestila(
    val vrsta: VrstaDogodka,
    val nujno: Boolean = false,
    val od: String? = null,
    val besedilo: String? = null,
    val neposredno: Boolean = false,
    val casMs: Long = 0,
    val prebranoNa: NapravaObvestila? = null,
)

data class UreMiru(val od: Int, val doUre: Int)

data class NastavitveObvestil(
    val globalno: RavenObvestil = RavenObvestil.VSE,
    val poVrsti: Map<VrstaDogodka, RavenObvestil> = mapOf(VrstaDogodka.NOVICA to RavenObvestil.POMEMBNO, VrstaDogodka.MOTIVACIJA to RavenObvestil.POMEMBNO),
    val neMoti: Boolean = false,
    val ureMiru: UreMiru? = null,
    val nujnoPrebijeNeMoti: Boolean = true,
    val vip: List<String> = emptyList(),
    val kljucneBesede: List<String> = emptyList(),
    val zakasnitevTelefonaMs: Long = 60_000,
)

data class Prisotnost(val racunalnikAktiven: Boolean, val telefonPovezan: Boolean, val uraLokalno: Int)

data class OdlocitevObvestila(val poslji: Boolean, val razlog: RazlogObvestila, val kam: NapravaObvestila? = null, val zakasnitevMs: Long = 0)

private fun zlozi(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "").lowercase().replace(Regex("\\s+"), " ").trim()

private fun brezPresledkov(s: String) = zlozi(s).replace(Regex("[\\s\\-()./]"), "")

/** Kot vE164 na racunalniku (plast.ts): nacionalna 0 -> +386, 00 -> +, sicer null. */
fun vE164(vrednost: String): String? {
    val surovo = Normalizer.normalize(vrednost, Normalizer.Form.NFKC)
    if (surovo.any { it.isLetter() }) return null
    var s = surovo.replace("(0)", "").replace(Regex("[\\s()./-]"), "")
    if (s.startsWith("00")) s = "+" + s.drop(2)
    if (s.startsWith("0")) s = "+386" + s.drop(1)
    if (!s.startsWith("+") && s.isNotEmpty() && s.all { it.isDigit() }) s = "+$s"
    return if (Regex("^\\+[1-9]\\d{7,14}$").matches(s)) s else null
}

fun istaStevilka(a: String, b: String): Boolean {
    val l = vE164(a) ?: return false
    return l == vE164(b)
}

private fun vUrahMiru(u: UreMiru?, ura: Int): Boolean {
    if (u == null || u.od == u.doUre) return false
    return if (u.od < u.doUre) ura >= u.od && ura < u.doUre else ura >= u.od || ura < u.doUre
}

private fun pomembnost(d: DogodekObvestila, n: NastavitveObvestil): RazlogObvestila? {
    if (d.nujno || d.vrsta == VrstaDogodka.NUJNO) return RazlogObvestila.NUJNO
    val od = d.od
    if (od != null && n.vip.any { v -> v.isNotBlank() && (brezPresledkov(v) == brezPresledkov(od) || istaStevilka(v, od)) }) return RazlogObvestila.VIP
    val b = zlozi(d.besedilo ?: "")
    if (b.isNotEmpty() && n.kljucneBesede.any { k -> zlozi(k).length >= 3 && b.contains(zlozi(k)) }) return RazlogObvestila.KLJUCNA_BESEDA
    if (d.neposredno) return RazlogObvestila.NEPOSREDNO
    return null
}

fun odlociObvestilo(d: DogodekObvestila, n: NastavitveObvestil, p: Prisotnost): OdlocitevObvestila {
    val poVrsti = n.poVrsti[d.vrsta]
    val raven = if (poVrsti != null && poVrsti != RavenObvestil.PRIVZETO) poVrsti else n.globalno
    val zakaj = pomembnost(d, n)
    val jeNujno = zakaj == RazlogObvestila.NUJNO
    if (raven == RavenObvestil.NIC && !(jeNujno && n.nujnoPrebijeNeMoti)) return OdlocitevObvestila(false, RazlogObvestila.IZKLOPLJENO)
    if ((n.neMoti || vUrahMiru(n.ureMiru, p.uraLokalno)) && !((jeNujno || zakaj == RazlogObvestila.VIP) && n.nujnoPrebijeNeMoti)) {
        return OdlocitevObvestila(false, RazlogObvestila.NE_MOTI)
    }
    if (raven == RavenObvestil.POMEMBNO && zakaj == null) return OdlocitevObvestila(false, RazlogObvestila.NEPOMEMBNO)
    if (d.prebranoNa != null) return OdlocitevObvestila(false, RazlogObvestila.ZE_PREBRANO)
    val razlog = zakaj ?: RazlogObvestila.VSE
    if (p.racunalnikAktiven) return OdlocitevObvestila(true, razlog, NapravaObvestila.RACUNALNIK, 0)
    if (!p.telefonPovezan) return OdlocitevObvestila(false, RazlogObvestila.NI_NAPRAVE)
    return OdlocitevObvestila(true, razlog, NapravaObvestila.TELEFON, if (jeNujno) 0 else maxOf(0, n.zakasnitevTelefonaMs))
}
