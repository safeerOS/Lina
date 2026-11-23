package si.safeer.lina

import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import si.safeer.lina.protocol.ContactMatches
import si.safeer.lina.protocol.ContactRow

/** Iskanje po imeniku telefona (ime ali stevilka). Klicati z drugega kot glavne niti; potrebuje READ_CONTACTS. */
class ContactSearch(private val context: Context) {
    fun search(query: String): List<ContactRow> {
        val q = query.trim()
        if (q.length < 2) return emptyList()
        val uri = Uri.withAppendedPath(ContactsContract.CommonDataKinds.Phone.CONTENT_FILTER_URI, Uri.encode(q))
        val rows = ArrayList<ContactRow>()
        runCatching {
            context.contentResolver.query(
                uri,
                arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
                null, null, null,
            )?.use { c ->
                while (c.moveToNext() && rows.size < 60) {
                    val name = c.getString(0).orEmpty()
                    val number = c.getString(1).orEmpty()
                    if (number.isNotBlank()) rows.add(ContactRow(name.ifBlank { number }, number))
                }
            }
        }
        return ContactMatches.top(rows)
    }

    /** Ime iz imenika za stevilko (null, ce je ni ali ni dovoljenja READ_CONTACTS). Ena hitra poizvedba, lahko z glavne niti. */
    fun nameOf(number: String): String? {
        if (number.isBlank()) return null
        if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return null
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        return runCatching {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() } else null
            }
        }.getOrNull()
    }

    /** Starejsim zapisom klicev (pred 23. 11. 2026) brez imena iz imenika ga doda za prikaz; ena poizvedba na stevilko. */
    fun dopolniImena(zapisi: List<si.safeer.lina.samostojna.ZapisKlica>): List<si.safeer.lina.samostojna.ZapisKlica> {
        if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return zapisi
        // shortcut: ena poizvedba na razlicno stevilko ob vsakem osvezevanju na glavni niti; ob sto in vec razlicnih stevilkah omeji na prikazane vrstice.
        val znana = HashMap<String, String>()
        return zapisi.map { z ->
            if (z.imeImenik.isNotBlank() || z.stevilka.isBlank()) z
            else znana.getOrPut(z.stevilka) { nameOf(z.stevilka).orEmpty() }.let { ime -> if (ime.isEmpty()) z else z.copy(imeImenik = ime) }
        }
    }

    /** Ali je stevilka v imeniku (brez dovoljenja za imenik vedno false). Lahko z glavne niti: ena hitra poizvedba. */
    fun isKnown(number: String): Boolean {
        if (number.isBlank()) return false
        if (context.checkSelfPermission(android.Manifest.permission.READ_CONTACTS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return false
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
        return runCatching {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup._ID), null, null, null)?.use { it.count > 0 } ?: false
        }.getOrDefault(false)
    }
}
