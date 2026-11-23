package si.safeer.lina.asistent

import android.content.Context
import android.provider.CalendarContract
import si.safeer.lina.samostojna.DogodekKoledarja
import si.safeer.lina.samostojna.KoledarOrodje

/**
 * Dogodki iz koledarja telefona (samo branje, READ_CALENDAR). Brez dovoljenja poizvedba vrne SecurityException,
 * ki jo KoledarIzvajalec spremeni v besedilo za model. Kliče se iz niti orodja, ne iz glavne niti.
 */
class KoledarAndroid(private val context: Context) : KoledarOrodje {
    override fun dogodki(odMs: Long, doMs: Long): List<DogodekKoledarja> {
        val stolpci = arrayOf(
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.EVENT_LOCATION,
        )
        val izid = mutableListOf<DogodekKoledarja>()
        CalendarContract.Instances.query(context.contentResolver, stolpci, odMs, doMs)?.use { c ->
            while (c.moveToNext() && izid.size < 200) {
                izid += DogodekKoledarja(
                    naslov = c.getString(0).orEmpty(),
                    zacetekMs = c.getLong(1),
                    konecMs = c.getLong(2),
                    cezDan = c.getInt(3) == 1,
                    kraj = c.getString(4).orEmpty(),
                )
            }
        }
        return izid
    }

    /**
     * Doda dogodek v prvi pisljivi koledar telefona (po uporabnikovi potrditvi). Vrne false brez dovoljenja WRITE_CALENDAR,
     * brez pisljivega koledarja ali ob napaki; obstojecih dogodkov ne spreminja.
     */
    fun dodaj(naslov: String, zacetekMs: Long, konecMs: Long): Boolean = try {
        val cr = context.contentResolver
        val koledarId = cr.query(
            CalendarContract.Calendars.CONTENT_URI,
            arrayOf(CalendarContract.Calendars._ID),
            "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${CalendarContract.Calendars.VISIBLE} = 1",
            arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString()),
            "${CalendarContract.Calendars.IS_PRIMARY} DESC, ${CalendarContract.Calendars._ID} ASC",
        )?.use { if (it.moveToFirst()) it.getLong(0) else null }
        if (koledarId == null) false
        else {
            val v = android.content.ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, koledarId)
                put(CalendarContract.Events.TITLE, naslov)
                put(CalendarContract.Events.DTSTART, zacetekMs)
                put(CalendarContract.Events.DTEND, konecMs)
                put(CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().id)
            }
            cr.insert(CalendarContract.Events.CONTENT_URI, v) != null
        }
    } catch (e: SecurityException) {
        false
    } catch (e: RuntimeException) {
        false
    }

    companion object {
        /** Dovoljenji za branje in pisanje koledarja; brez njiju Lina ne vidi urnika in ne more dodati dogodka. */
        val DOVOLJENJA = arrayOf(android.Manifest.permission.READ_CALENDAR, android.Manifest.permission.WRITE_CALENDAR)
        const val KODA_DOVOLJENJ = 7411

        fun imaDovoljenja(c: Context): Boolean =
            DOVOLJENJA.all { c.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED }
    }
}
