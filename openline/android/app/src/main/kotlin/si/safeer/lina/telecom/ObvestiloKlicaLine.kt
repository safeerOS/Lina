package si.safeer.lina.telecom

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import si.safeer.lina.DialerActivity
import si.safeer.lina.R
import si.safeer.lina.samostojna.DogodekObvestila
import si.safeer.lina.samostojna.NastavitveObvestil
import si.safeer.lina.samostojna.Prisotnost
import si.safeer.lina.samostojna.VrstaDogodka
import si.safeer.lina.samostojna.ZapisKlica
import si.safeer.lina.samostojna.odlociObvestilo
import java.time.ZonedDateTime

/**
 * Obvestilo »Lina je sprejela klic« na telefonu, tudi brez racunalnika (lastnik 22. 11. 2026). Ali in kako odloci
 * odlociObvestilo (isto pravilo kot na racunalniku); nujni klic ima svoj kanal z visoko pomembnostjo.
 * Stevilka in sporocilo nista vidna na zaklenjenem zaslonu (javna razlicica je samo dejstvo).
 */
object ObvestiloKlicaLine {
    const val ODPRI_KLICE = "si.safeer.lina.ODPRI_KLICE"
    const val ID_KLICA = "si.safeer.lina.ID_KLICA"
    const val PONOVNI = "si.safeer.lina.PONOVNI"
    private const val KANAL = "lina_klici"
    private const val KANAL_NUJNO = "lina_klici_nujno"

    fun pokazi(context: Context, zapis: ZapisKlica, nastavitve: NastavitveObvestil = NastavitveObvestil()) {
        if (!MissedCallNotice.canShow(context)) return
        val odlocitev = odlociObvestilo(
            DogodekObvestila(VrstaDogodka.KLIC, nujno = zapis.nujno, od = zapis.stevilka, besedilo = zapis.sporocilo.ifBlank { zapis.povzetek }, casMs = zapis.casZacetka),
            nastavitve,
            // Obvestilo nastane na tem telefonu: racunalnik o klicu obvesti sinhronizacija, zato se tu steje samo telefon.
            Prisotnost(racunalnikAktiven = false, telefonPovezan = true, uraLokalno = ZonedDateTime.now().hour),
        )
        if (!odlocitev.poslji) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val kanal = if (zapis.nujno) KANAL_NUJNO else KANAL
        manager.createNotificationChannel(
            NotificationChannel(
                kanal,
                context.getString(if (zapis.nujno) R.string.lina_call_notice_channel_urgent else R.string.lina_call_notice_channel),
                if (zapis.nujno) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { lockscreenVisibility = Notification.VISIBILITY_PRIVATE },
        )
        val kdo = zapis.klicatelj.trim().ifBlank {
            si.safeer.lina.ContactSearch(context).nameOf(zapis.stevilka) ?: zapis.stevilka.ifBlank { context.getString(R.string.unknown_number) }
        }
        val besedilo = zapis.sporocilo.ifBlank { zapis.povzetek }.trim()
        val osnova = context.getString(if (zapis.nujno) R.string.lina_call_notice_title_urgent else R.string.lina_call_notice_title, kdo)
        // Isti klicatelj je ze klical (22. 11. 2026): naslov pove, koliko krat; obvestilo odpre vsa njegova sporocila s povzetkom.
        val steviloKlicev = runCatching {
            si.safeer.lina.samostojna.skupinaZaKlic(si.safeer.lina.asistent.DnevnikKlicevSkupni.dobi(context).seznamPoDatumu(nujniNaVrhu = false), zapis)?.klici?.size
        }.getOrNull() ?: 1
        val naslov = if (steviloKlicev > 1) context.getString(R.string.lina_call_notice_repeat_fmt, osnova, steviloKlicev) else osnova
        // Vsako obvestilo svojo zahtevo: s skupno kodo in FLAG_UPDATE_CURRENT bi starejse obvestilo odprlo zadnjega klicatelja.
        val odpri = PendingIntent.getActivity(
            context, zapis.id.hashCode(),
            Intent(context, DialerActivity::class.java).setAction(ODPRI_KLICE)
                .putExtra(ID_KLICA, zapis.id).putExtra(PONOVNI, steviloKlicev > 1)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val obvestilo = Notification.Builder(context, kanal)
            .setSmallIcon(R.drawable.ic_stat_lina)
            .setContentTitle(naslov)
            .setContentText(besedilo)
            .setStyle(Notification.BigTextStyle().bigText(besedilo))
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(
                Notification.Builder(context, kanal).setSmallIcon(R.drawable.ic_stat_lina)
                    .setContentTitle(context.getString(R.string.lina_call_notice_public)).build(),
            )
            .setContentIntent(odpri)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setWhen(zapis.casZacetka)
            .build()
        manager.notify(zapis.id, 7006, obvestilo)
    }
}
