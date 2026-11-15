package si.safeer.lina.asistent

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.OzjiKrogSafeer

/**
 * Android lepilo za potrditev Line v ozji krog prek Safeer Phone/OS (pravila: modul podpis, OzjiKrogSafeer). Okno
 * potrditve je v Safeerju (zasciteno z dovoljenjem ravni signature); uporabnik potrdi tam, enkrat. Kljuc ne gre izven
 * KeyStore - Safeerju poslemo samo javni kljuc in id iz njega. Vse klice delaj zunaj glavne niti (KeyStore, B6).
 */
object OzjiKrogSafeerLepilo {
    /** Paket Safeer z oknom potrditve in istim podpisom kot Lina; null, ce Safeerja ni (ali ni iste podpisne verige). */
    fun cilj(context: Context): String? {
        val pm = context.packageManager
        val kandidati = OzjiKrogSafeer.DOVOLJENI_PAKETI.mapNotNull { paket ->
            val ponuja = try {
                pm.queryIntentActivities(Intent(OzjiKrogSafeer.DEJANJE).setPackage(paket), 0)
                    .any { it.activityInfo?.exported == true && it.activityInfo?.packageName == paket }
            } catch (_: Throwable) { false }
            if (!ponuja) null else OzjiKrogSafeer.Kandidat(paket, try {
                pm.checkSignatures(paket, context.packageName) == PackageManager.SIGNATURE_MATCH
            } catch (_: Throwable) { false })
        }
        return OzjiKrogSafeer.izberiCilj(kandidati)
    }

    /** Namera z IZRECNO komponento (nikoli samo z dejanjem); null, ce zahteve ni mogoce sestaviti. Ne na glavni niti. */
    fun namera(paket: String): Intent? {
        val kljuc = runCatching { NapravaKljuc.javniKljucB64() }.getOrNull() ?: return null
        val polja = OzjiKrogSafeer.zahteva(NapravaKljuc.id(), kljuc) ?: return null
        return Intent(OzjiKrogSafeer.DEJANJE).setComponent(ComponentName(paket, KOMPONENTA))
            .putExtra(OzjiKrogSafeer.POLJE_ID, polja.getValue(OzjiKrogSafeer.POLJE_ID))
            .putExtra(OzjiKrogSafeer.POLJE_KLJUC, polja.getValue(OzjiKrogSafeer.POLJE_KLJUC))
    }

    private const val KOMPONENTA = "si.safeer.tv.link.OzjiKrogPotrdiActivity"
    const val ZAHTEVA = 4711
}
