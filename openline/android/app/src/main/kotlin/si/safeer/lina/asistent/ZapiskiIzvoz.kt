package si.safeer.lina.asistent

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import si.safeer.lina.R
import si.safeer.lina.samostojna.Zapisek
import si.safeer.lina.samostojna.zapiskiVBesedilo
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Kopija zapiskov v datoteki, ki jo uporabnik vidi (lastnik 19. 11. 2026: privzeto v Dokumentih, mapo si lahko nastavi sam).
 * Privzeto Documents/Lina/Zapiski.txt prek MediaStore (brez dovoljenja za pomnilnik); sicer izbrana mapa (SAF) s trajnim
 * dovoljenjem. Datoteka je samo kopija: vir zapiskov ostane v aplikaciji, urejanje datoteke ga ne spremeni.
 * Nastavitve so v svoji datoteki (ne v datoteki s tajnopisi kljucev).
 */
class ZapiskiIzvoz(private val context: Context) {
    companion object {
        const val ZAHTEVA_MAPA = 7107
        const val IME_DATOTEKE = "Zapiski.txt"
        private const val PRIVZETA_MAPA = "Documents/Lina/"
        private const val PREFS = "lina_zapiski_izvoz"

        fun izbiraMape(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
        )
    }

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun mapa(): Uri? = prefs().getString("mapa", null)?.let(Uri::parse)

    /** null = privzeto (Dokumenti/Lina). */
    fun nastaviMapo(uri: Uri?) {
        prefs().edit().apply { if (uri == null) remove("mapa") else putString("mapa", uri.toString()) }.remove("zadnji_cas").remove("zadnji_ok").apply()
    }

    /** Pot za prikaz uporabniku. */
    fun opis(): String {
        val m = mapa() ?: return PRIVZETA_MAPA + IME_DATOTEKE
        val pot = runCatching { Uri.decode(DocumentsContract.getTreeDocumentId(m)).substringAfter(':') }.getOrDefault("")
        return (if (pot.isEmpty()) "" else "$pot/") + IME_DATOTEKE
    }

    /** (cas zadnjega poskusa, ali je uspel); cas 0 = se ni bilo poskusa. */
    fun zadnji(): Pair<Long, Boolean> = prefs().getLong("zadnji_cas", 0L) to prefs().getBoolean("zadnji_ok", false)

    fun oblikaCasa(ms: Long): String =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).format(Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()))

    /** Zapise datoteko; klicati z ozadne niti. Brez zapiskov in brez prejsnjega zapisa datoteke ne ustvari. */
    @Synchronized
    fun izvozi(zapiski: List<Zapisek>): Boolean {
        if (zapiski.none { !it.izbrisan } && prefs().getLong("zadnji_cas", 0L) == 0L) return true
        val besedilo = zapiskiVBesedilo(zapiski, context.getString(R.string.notes_file_title), context.getString(R.string.notes_file_note), ::oblikaCasa)
        val ok = runCatching {
            val m = mapa()
            if (m == null) pisiPrivzeto(besedilo) else pisiMapo(m, besedilo)
        }.getOrDefault(false)
        prefs().edit().putLong("zadnji_cas", System.currentTimeMillis()).putBoolean("zadnji_ok", ok).apply()
        return ok
    }

    private fun pisi(uri: Uri, besedilo: String): Boolean =
        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(besedilo.toByteArray(Charsets.UTF_8)); true } ?: false

    private fun pisiPrivzeto(besedilo: String): Boolean {
        val r = context.contentResolver
        val zbirka = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val sel = "${MediaStore.MediaColumns.DISPLAY_NAME}=? AND ${MediaStore.MediaColumns.RELATIVE_PATH}=?"
        var uri: Uri? = r.query(zbirka, arrayOf(MediaStore.MediaColumns._ID), sel, arrayOf(IME_DATOTEKE, PRIVZETA_MAPA), null)?.use {
            if (it.moveToFirst()) ContentUris.withAppendedId(zbirka, it.getLong(0)) else null
        }
        if (uri == null) {
            val v = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, IME_DATOTEKE)
                put(MediaStore.MediaColumns.MIME_TYPE, "text/plain")
                put(MediaStore.MediaColumns.RELATIVE_PATH, PRIVZETA_MAPA)
            }
            uri = r.insert(zbirka, v) ?: return false
        }
        return pisi(uri, besedilo)
    }

    private fun pisiMapo(drevo: Uri, besedilo: String): Boolean {
        val r = context.contentResolver
        val korenId = DocumentsContract.getTreeDocumentId(drevo)
        val otroci = DocumentsContract.buildChildDocumentsUriUsingTree(drevo, korenId)
        var najden: Uri? = null
        r.query(otroci, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
            while (najden == null && it.moveToNext()) {
                if (it.getString(1) == IME_DATOTEKE) najden = DocumentsContract.buildDocumentUriUsingTree(drevo, it.getString(0))
            }
        }
        val cilj = najden ?: DocumentsContract.createDocument(r, DocumentsContract.buildDocumentUriUsingTree(drevo, korenId), "text/plain", IME_DATOTEKE) ?: return false
        return pisi(cilj, besedilo)
    }
}
