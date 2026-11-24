package si.safeer.lina.asistent

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.content.pm.SigningInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import si.safeer.lina.podpis.NamestitevApk
import si.safeer.lina.podpis.ZavrnitevApk
import java.io.File

/**
 * »Namesti na ta telefon« (lastnik 24. 11. 2026): Android del. Preverbe so v NamestitevApk (modul podpis, preizkusi); tu samo
 * PackageManager (paket in podpisni certifikat arhiva proti namesceni Lini) in PackageInstaller seja, ki jo potrdi lastnik v
 * sistemskem oknu (STATUS_PENDING_USER_ACTION). Brez adb in roota. NEPREVERJENO na napravi (app se lokalno ne prevaja).
 */
object NamestitevPaketa {
    const val AKCIJA = "si.safeer.lina.NAMESTITEV_IZID"

    /** Zadnji izid seje za pogled (glavna nit ga bere ob osvezitvi). */
    @Volatile var obIzidu: ((Int, String?) -> Unit)? = null

    fun imaDovoljenje(c: Context): Boolean = c.packageManager.canRequestPackageInstalls()

    /** Nastavitev »namescanje neznanih aplikacij« za Lino (napis gumba je odvisen od naprave; besedilo ga ne ugiba). */
    fun odpriNastavitev(c: Context) {
        c.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${c.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun odtisi(s: SigningInfo?): List<String>? =
        s?.apkContentsSigners?.map { NamestitevApk.odtis(it.toByteArray()) }?.takeIf { it.isNotEmpty() }

    /** Paket in podpis arhiva proti namesceni aplikaciji; null = enako. */
    fun preveriArhiv(c: Context, apk: File): ZavrnitevApk? {
        val pm = c.packageManager
        @Suppress("DEPRECATION")
        val arhiv = runCatching { pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) }.getOrNull()
        @Suppress("DEPRECATION")
        val nas = runCatching { pm.getPackageInfo(c.packageName, PackageManager.GET_SIGNING_CERTIFICATES) }.getOrNull()
        return NamestitevApk.preveriArhiv(arhiv?.packageName, odtisi(arhiv?.signingInfo), odtisi(nas?.signingInfo))
    }

    /**
     * Zapise APK v sejo PackageInstallerja in jo odda; sistem nato pokaze okno, ki ga potrdi lastnik. Kopija v cacheDir se pobrise
     * takoj, ko so bajti v seji (posodobitev same sebe ustavi proces), in na vsaki poti napake.
     */
    fun namesti(c: Context, apk: File) {
        val pi = c.packageManager.packageInstaller
        val p = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(NamestitevApk.PAKET)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
        }
        var id = -1
        try {
            id = pi.createSession(p)
            pi.openSession(id).use { s ->
                s.openWrite("lina.apk", 0, apk.length()).use { izhod ->
                    apk.inputStream().use { it.copyTo(izhod) }
                    s.fsync(izhod)
                }
                NamestitevApk.pobrisi(apk)
                val namen = Intent(c, IzidNamestitve::class.java).setAction(AKCIJA)
                val pending = PendingIntent.getBroadcast(c, id, namen, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                s.commit(pending.intentSender)
            }
        } catch (e: Exception) {
            if (id >= 0) runCatching { pi.abandonSession(id) }
            throw e
        } finally {
            NamestitevApk.pobrisi(apk)
        }
    }
}

/** Izid seje (neizvozen prejemnik, ekspliciten namen). Ob PENDING_USER_ACTION odpre sistemsko okno za potrditev. */
class IzidNamestitve : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val potrdi = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
            c.startActivity(potrdi.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        NamestitevPaketa.obIzidu?.invoke(status, i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)?.take(200))
    }
}
