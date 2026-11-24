package si.safeer.lina.podpis

import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** Glave odgovora GET /gradnja/apk (x-lina-sha256, content-length, x-lina-paket, x-lina-gradnja, content-type). */
data class GlaveApk(val sha256: String?, val velikost: Long?, val paket: String?, val gradnja: String?, val vrsta: String?)

/** Zakaj se APK ne namesti (kljuc besedila v aplikaciji). */
enum class ZavrnitevApk { GLAVE, PREVELIK, VELIKOST, VSOTA, PAKET, PODPIS, PREKINJENO }

sealed class IzidPrenosa {
    data class Ok(val datoteka: File, val sha256: String, val gradnja: String) : IzidPrenosa()
    data class Zavrnjeno(val razlog: ZavrnitevApk) : IzidPrenosa()
}

/**
 * »Namesti na ta telefon« (lastnik 24. 11. 2026): varovala pred PackageInstallerjem, cista logika (app dela samo PackageManager in
 * sejo). Vrstni red: glave -> prenos v SVOJO datoteko v cacheDir z mejo velikosti -> sha256 in velikost = glave -> paket
 * si.safeer.lina in podpisni certifikat = namescena aplikacija. Vsaka zavrnitev pobrise kopijo; drugih datotek se ne dotika.
 */
object NamestitevApk {
    const val PAKET = "si.safeer.lina"
    const val VRSTA = "application/vnd.android.package-archive"
    const val IME_DATOTEKE = "lina-gradnja.apk"
    /** Zgornja meja velikosti APK (Lina je ~100 MB; vec je napaka ali napad na prostor). */
    const val NAJVEC_BAJTOV = 300L * 1024 * 1024
    private val HEX64 = Regex("^[0-9a-f]{64}$")

    fun preveriGlave(g: GlaveApk): ZavrnitevApk? = when {
        g.paket != PAKET -> ZavrnitevApk.PAKET
        g.velikost != null && g.velikost > NAJVEC_BAJTOV -> ZavrnitevApk.PREVELIK
        g.sha256 == null || !HEX64.matches(g.sha256) -> ZavrnitevApk.GLAVE
        g.velikost == null || g.velikost <= 0 -> ZavrnitevApk.GLAVE
        g.gradnja == null || !NiziLine.ID_GRADNJE.matches(g.gradnja) -> ZavrnitevApk.GLAVE
        g.vrsta?.substringBefore(';')?.trim() != VRSTA -> ZavrnitevApk.GLAVE
        else -> null
    }

    fun odtis(b: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /**
     * Prebere najvec content-length + 1 bajt v [mapa]/IME_DATOTEKE (prepise samo svojo prejsnjo kopijo) in sproti racuna sha256.
     * Krajse ali daljse telo, drugacna vsota ali prekinitev: kopija se pobrise.
     */
    fun shrani(vhod: InputStream, g: GlaveApk, mapa: File): IzidPrenosa {
        preveriGlave(g)?.let { return IzidPrenosa.Zavrnjeno(it) }
        val velikost = g.velikost!!
        val cilj = File(mapa, IME_DATOTEKE)
        val md = MessageDigest.getInstance("SHA-256")
        var prebrano = 0L
        val izid: ZavrnitevApk? = try {
            cilj.outputStream().use { izhod ->
                val buf = ByteArray(64 * 1024)
                while (prebrano <= velikost) {
                    val n = vhod.read(buf, 0, minOf(buf.size.toLong(), velikost + 1 - prebrano).toInt())
                    if (n < 0) break
                    prebrano += n
                    if (prebrano > velikost) break
                    md.update(buf, 0, n)
                    izhod.write(buf, 0, n)
                }
                izhod.fd.sync()
            }
            when {
                prebrano != velikost -> ZavrnitevApk.VELIKOST
                md.digest().joinToString("") { "%02x".format(it) } != g.sha256 -> ZavrnitevApk.VSOTA
                else -> null
            }
        } catch (_: Exception) {
            ZavrnitevApk.PREKINJENO
        }
        if (izid != null) {
            cilj.delete()
            return IzidPrenosa.Zavrnjeno(izid)
        }
        return IzidPrenosa.Ok(cilj, g.sha256!!, g.gradnja!!)
    }

    /** Paket arhiva in mnozica odtisov podpisnih certifikatov morata biti enaka namesceni aplikaciji (neprazni). */
    fun preveriArhiv(paket: String?, arhiv: List<String>?, namescena: List<String>?): ZavrnitevApk? = when {
        paket != PAKET -> ZavrnitevApk.PAKET
        arhiv.isNullOrEmpty() || namescena.isNullOrEmpty() -> ZavrnitevApk.PODPIS
        arhiv.toSet() != namescena.toSet() -> ZavrnitevApk.PODPIS
        else -> null
    }

    /** Pobrise samo svojo kopijo v [mapa]; true, ce je ni vec. */
    fun pobrisi(mapa: File): Boolean {
        val f = File(mapa, IME_DATOTEKE)
        return !f.exists() || f.delete()
    }
}
