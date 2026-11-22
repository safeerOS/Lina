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
}
