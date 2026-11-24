package si.safeer.lina.asistent

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * Gumb »Fotografiraj« v Pogovoru (lastnik 24. 11. 2026): program za fotografiranje, ki ga izbere sistem, zapise sliko v ENO
 * datoteko v cacheDir Line prek tega ponudnika (dovoljenje mu da namen z FLAG_GRANT_WRITE_URI_PERMISSION). Lina zato ne
 * potrebuje dovoljenja CAMERA. Ponudnik ni izvozen in streze samo [DATOTEKA]; vsak drug naslov je FileNotFound.
 * (Lasten namesto androidx FileProvider: androidx.core ni med odvisnostmi aplikacije.)
 */
class PosnetekPonudnik : ContentProvider() {
    companion object {
        private const val DATOTEKA = "posnetek.jpg"
        fun avtoriteta(c: Context) = c.packageName + ".posnetek"
        fun naslov(c: Context): Uri = Uri.Builder().scheme("content").authority(avtoriteta(c)).appendPath(DATOTEKA).build()
        fun datoteka(c: Context) = File(File(c.cacheDir, "posnetek"), DATOTEKA)
    }

    override fun onCreate() = true

    private fun preveri(uri: Uri): File {
        val c = context ?: throw FileNotFoundException()
        if (uri.authority != avtoriteta(c) || uri.pathSegments != listOf(DATOTEKA)) throw FileNotFoundException(uri.toString())
        return datoteka(c)
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val f = preveri(uri)
        f.parentFile?.mkdirs()
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode))
    }

    override fun getType(uri: Uri) = "image/jpeg"

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        val f = preveri(uri)
        val stolpci = projection?.filter { it == OpenableColumns.DISPLAY_NAME || it == OpenableColumns.SIZE }?.toTypedArray()
            ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(stolpci, 1).apply { addRow(stolpci.map { if (it == OpenableColumns.SIZE) f.length() else DATOTEKA }) }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}
