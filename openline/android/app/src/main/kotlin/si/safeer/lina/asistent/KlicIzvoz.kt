package si.safeer.lina.asistent

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import si.safeer.lina.samostojna.ZapisKlica
import si.safeer.lina.samostojna.besediloDatotekeKlica
import si.safeer.lina.samostojna.imeDatotekeKlica

/**
 * Datoteka za vsak klic v mapi, ki jo uporabnik izbere (lastnik 20. 11. 2026): cas, ime in stevilka v imenu datoteke,
 * v datoteki ime, stevilka, podjetje, cas in sporocilo klicatelja. Mapa je ista kot za Zapiske (ZapiskiIzvoz):
 * privzeto Dokumenti/Lina/Klici (brez dovoljenja za pomnilnik), sicer izbrana mapa. Datoteka je kopija; vir zapisa je dnevnik klicev.
 */
class KlicIzvoz(private val context: Context) {
    companion object {
        const val PRIVZETA_MAPA = "Documents/Lina/Klici/"
        private const val ZADNJI_OK = "klic_zadnji_ok"
        private const val ZADNJI_CAS = "klic_zadnji_cas"
    }

    private val izvoz = ZapiskiIzvoz(context)
    private fun prefs() = context.getSharedPreferences("lina_zapiski_izvoz", Context.MODE_PRIVATE)

    /** Pot za prikaz uporabniku. */
    fun opis(): String {
        val m = izvoz.mapa() ?: return PRIVZETA_MAPA
        val pot = runCatching { Uri.decode(DocumentsContract.getTreeDocumentId(m)).substringAfter(':') }.getOrDefault("")
        return if (pot.isEmpty()) "/" else "$pot/"
    }

    /** (cas zadnjega poskusa, ali je uspel); cas 0 = se ni bilo poskusa. */
    fun zadnji(): Pair<Long, Boolean> = prefs().getLong(ZADNJI_CAS, 0L) to prefs().getBoolean(ZADNJI_OK, false)

    /** Zapise datoteko klica; klicati z ozadne niti. Neuspeh ne izgubi zapisa: ta ostane v dnevniku klicev. */
    @Synchronized
    fun zapisi(zapis: ZapisKlica): Boolean {
        val ime = imeDatotekeKlica(zapis)
        val besedilo = besediloDatotekeKlica(zapis)
        val ok = runCatching {
            val m = izvoz.mapa()
            if (m == null) pisiPrivzeto(ime, besedilo) else pisiMapo(m, ime, besedilo)
        }.getOrDefault(false)
        prefs().edit().putLong(ZADNJI_CAS, System.currentTimeMillis()).putBoolean(ZADNJI_OK, ok).apply()
        return ok
    }

    private fun pisi(uri: Uri, besedilo: String): Boolean =
        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(besedilo.toByteArray(Charsets.UTF_8)); true } ?: false

    private fun pisiPrivzeto(ime: String, besedilo: String): Boolean {
        val r = context.contentResolver
        val zbirka = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val sel = "${MediaStore.MediaColumns.DISPLAY_NAME}=? AND ${MediaStore.MediaColumns.RELATIVE_PATH}=?"
        var uri: Uri? = r.query(zbirka, arrayOf(MediaStore.MediaColumns._ID), sel, arrayOf(ime, PRIVZETA_MAPA), null)?.use {
            if (it.moveToFirst()) ContentUris.withAppendedId(zbirka, it.getLong(0)) else null
        }
        if (uri == null) {
            val v = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, ime)
                put(MediaStore.MediaColumns.MIME_TYPE, "text/plain")
                put(MediaStore.MediaColumns.RELATIVE_PATH, PRIVZETA_MAPA)
            }
            uri = r.insert(zbirka, v) ?: return false
        }
        return pisi(uri, besedilo)
    }

    private fun pisiMapo(drevo: Uri, ime: String, besedilo: String): Boolean {
        val r = context.contentResolver
        val korenId = DocumentsContract.getTreeDocumentId(drevo)
        val otroci = DocumentsContract.buildChildDocumentsUriUsingTree(drevo, korenId)
        var najden: Uri? = null
        r.query(otroci, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
            while (najden == null && it.moveToNext()) {
                if (it.getString(1) == ime) najden = DocumentsContract.buildDocumentUriUsingTree(drevo, it.getString(0))
            }
        }
        val cilj = najden ?: DocumentsContract.createDocument(r, DocumentsContract.buildDocumentUriUsingTree(drevo, korenId), "text/plain", ime) ?: return false
        return pisi(cilj, besedilo)
    }
}
