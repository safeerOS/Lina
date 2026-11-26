package si.safeer.lina.asistent

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import si.safeer.lina.DialerActivity
import si.safeer.lina.R
import si.safeer.lina.podpis.PosodobitevGithub
import java.io.File

/**
 * Naloga 28: Lina na telefonu sama preveri izdajo na GitHubu (ob zagonu aplikacije, ko je cas, in vsakih 12 h prek JobSchedulerja,
 * samo z omrezjem), stikalo privzeto vklopljeno. Vsa odlocanje je v PosodobitevGithub (modul podpis, preizkusi); tu samo shramba,
 * nacrt, obvestilo in branje versionCode. Namesti se sele, ko lastnik tapne Posodobi (PosodobitevPogled) in potrdi sistemsko okno.
 * JobScheduler namesto WorkManagerja: enaka pogoja (periodicno, omrezje, prezivi ponovni zagon) brez nove odvisnosti v modulu app,
 * ki se lokalno ne prevaja. NEPREVERJENO na napravi (app se lokalno ne prevaja).
 */
object PosodobitevLine {
    private const val SHRAMBA = "lina_posodobitev"
    private const val K_STANJE = "stanje"
    private const val K_SAMODEJNO = "samodejno"
    private const val KANAL = "lina_posodobitev"
    private const val ID_OBVESTILA = 2801
    private const val ID_NALOGE = 2801
    /** Periodicna naloga se sprozi v oknu (fleks) tudi malo pred 12 h: brez tolerance bi se vsaka druga preskocila. */
    private const val TOLERANCA_NALOGE_MS = 3600_000L
    /** Namen iz obvestila: DialerActivity odpre Nastavitve > Posodobitev. */
    const val ODPRI = "si.safeer.lina.ODPRI_POSODOBITEV"

    private fun shramba(c: Context) = c.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)

    fun samodejno(c: Context): Boolean = shramba(c).getBoolean(K_SAMODEJNO, true)

    fun nastaviSamodejno(c: Context, vklop: Boolean) {
        shramba(c).edit().putBoolean(K_SAMODEJNO, vklop).apply()
        if (vklop) nacrtuj(c) else c.getSystemService(JobScheduler::class.java)?.cancel(ID_NALOGE)
    }

    fun stanje(c: Context): PosodobitevGithub.StanjePreverbe = PosodobitevGithub.StanjePreverbe.izNiza(shramba(c).getString(K_STANJE, null))

    private fun shrani(c: Context, s: PosodobitevGithub.StanjePreverbe) {
        shramba(c).edit().putString(K_STANJE, s.vNiz()).apply()
    }

    fun namesceniCode(c: Context): Long = c.packageManager.getPackageInfo(c.packageName, 0).longVersionCode

    /** versionCode arhiva (null, ce ga PackageManager ne prebere). */
    fun codeArhiva(c: Context, apk: File): Long? =
        runCatching { c.packageManager.getPackageArchiveInfo(apk.path, 0)?.longVersionCode }.getOrNull()

    /** Periodicna naloga (12 h, z omrezjem, prezivi ponovni zagon); ze nacrtovane ne nadomesti. */
    fun nacrtuj(c: Context) {
        if (!samodejno(c)) return
        val js = c.getSystemService(JobScheduler::class.java) ?: return
        if (js.getPendingJob(ID_NALOGE) != null) return
        runCatching {
            js.schedule(
                JobInfo.Builder(ID_NALOGE, ComponentName(c, PosodobitevNaloga::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(PosodobitevGithub.OBDOBJE_MS)
                    .setPersisted(true)
                    .build(),
            )
        }
    }

    /** Ob zagonu aplikacije: nacrt in preverba, ce je cas (odmik po napakah velja tudi tu: ni ponavljanja ob vsakem zagonu). */
    fun obZagonu(c: Context) {
        val ac = c.applicationContext
        nacrtuj(ac)
        if (samodejno(ac) && System.currentTimeMillis() >= stanje(ac).naslednjaMs) Thread({ runCatching { preveriZdaj(ac, false) } }, "lina-posodobitev").start()
    }

    /**
     * Ena preverba (blokira; samo v ozadju). rocno = gumb »Preveri zdaj« (izkljucen stikalo in cas ne veljata). Obvestilo enkrat na
     * versionCode; ce ga sistem ne dovoli, ostane gumb v aplikaciji.
     */
    @Synchronized fun preveriZdaj(c: Context, rocno: Boolean, izNaloge: Boolean = false): PosodobitevGithub.StanjePreverbe {
        val prej = stanje(c)
        val rok = prej.naslednjaMs - if (izNaloge) TOLERANCA_NALOGE_MS else 0L
        if (!rocno && (!samodejno(c) || System.currentTimeMillis() < rok)) return prej
        var s = PosodobitevGithub.preveri(PosodobitevGithub.HttpsHttp(), prej, namesceniCode(c), System.currentTimeMillis())
        val i = s.izdaja
        if (i != null && s.obvescenaCode < i.versionCode && obvesti(c, i)) s = s.copy(obvescenaCode = i.versionCode)
        shrani(c, s)
        return s
    }

    private fun obvesti(c: Context, i: PosodobitevGithub.Izdaja): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        val nm = c.getSystemService(NotificationManager::class.java) ?: return false
        nm.createNotificationChannel(NotificationChannel(KANAL, c.getString(R.string.update_channel), NotificationManager.IMPORTANCE_DEFAULT))
        val namen = Intent(c, DialerActivity::class.java).setAction(ODPRI).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(c, ID_OBVESTILA, namen, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(c, KANAL)
            .setSmallIcon(R.drawable.ic_stat_lina)
            .setContentTitle(c.getString(R.string.update_available, i.razlicica))
            .setContentText(c.getString(R.string.update_notify_text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        return runCatching { nm.notify(ID_OBVESTILA, n) }.isSuccess
    }
}

/** JobScheduler: periodicna preverba v ozadju (samo branje GitHuba; nicesar ne namesti). */
class PosodobitevNaloga : JobService() {
    override fun onStartJob(p: JobParameters): Boolean {
        val ac = applicationContext
        Thread({
            runCatching { PosodobitevLine.preveriZdaj(ac, false, izNaloge = true) }
            jobFinished(p, false)
        }, "lina-posodobitev").start()
        return true
    }

    override fun onStopJob(p: JobParameters): Boolean = false
}
