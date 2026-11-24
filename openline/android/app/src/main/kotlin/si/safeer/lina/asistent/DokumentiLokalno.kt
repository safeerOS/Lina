package si.safeer.lina.asistent

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.net.Uri
import android.provider.DocumentsContract
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import si.safeer.lina.samostojna.NAJVEC_BAJTOV_DOKUMENTA
import si.safeer.lina.samostojna.VrstaDokumenta
import si.safeer.lina.samostojna.besediloDocx
import si.safeer.lina.samostojna.besediloIzBajtov
import si.safeer.lina.samostojna.izrezekZadetka
import si.safeer.lina.samostojna.normalizirajZaIskanje
import si.safeer.lina.samostojna.razreziZaIndeks
import si.safeer.lina.samostojna.vrstaDokumenta
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Lokalni indeks dokumentov (lastnik 23. 11. 2026): uporabnik izbere mapo (SAF, samo branje), Lina besedilo PDF, DOCX, TXT
 * in slik (OCR ML Kit na telefonu) shrani v FTS4 v noBackupFilesDir (allowBackup je izklopljen; indeks ne zapusti telefona).
 * Iskalni stolpec hrani normalizirano obliko (normalizirajZaIskanje), izvirnik je samo za izrezek; zato iskanje ni odvisno
 * od razclenjevalnika SQLite na napravi. Vse spremembe (izbira mape, indeksiranje, brisanje) sprozi samo uporabnik v
 * Nastavitvah > Dokumenti; pogovor samo isce.
 */
object DokumentiLokalno {
    const val ZAHTEVA_MAPA = 7108
    private const val PREFS = "lina_dokumenti"
    private const val BAZA = "lina_dokumenti.db"
    private const val NAJVEC_DATOTEK = 3000
    private const val NAJVEC_GLOBINA = 8
    private const val NAJVEC_STRANI_PDF = 40
    private const val NAJVEC_STRANICA_SLIKE = 2048

    data class Zadetek(val ime: String, val stran: Int?, val izrezek: String)
    data class Stanje(val datotek: Int, val napak: Int, val casMs: Long)

    /** Indeksiranje in brisanje tecejo na svoji niti (ne na niti pogovora), drug za drugim. */
    val nit = Executors.newSingleThreadExecutor()
    /** Iskanje iz pogovora ne caka na dolgo indeksiranje (SQLite sam zaklepa bralce med zapisom). */
    val iskanje = Executors.newSingleThreadExecutor()
    @Volatile var indeksiram = false; private set
    private var baza: SQLiteDatabase? = null

    fun izbiraMape(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Ideja lastnika: privzeto VKLOPLJENO; stikalo v Nastavitvah > Dokumenti. */
    fun vklopljeno(c: Context) = prefs(c).getBoolean("vklopljeno", true)
    fun nastaviVklopljeno(c: Context, v: Boolean) = prefs(c).edit().putBoolean("vklopljeno", v).apply()

    fun mapa(c: Context): Uri? = prefs(c).getString("mapa", null)?.let(Uri::parse)

    fun opisMape(c: Context): String? {
        val m = mapa(c) ?: return null
        return runCatching { Uri.decode(DocumentsContract.getTreeDocumentId(m)).substringAfter(':') }.getOrDefault("").ifEmpty { "/" }
    }

    fun stanje(c: Context): Stanje? = prefs(c).takeIf { it.contains("cas") }?.let { Stanje(it.getInt("datotek", 0), it.getInt("napak", 0), it.getLong("cas", 0)) }

    /** Uporabnik je v izbirniku izbral mapo: trajno dovoljenje SAMO za branje; prejsnja mapa se sprosti. */
    fun nastaviMapo(c: Context, uri: Uri): Boolean {
        try {
            c.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: SecurityException) { return false }
        mapa(c)?.takeIf { it != uri }?.let { sprostiDovoljenje(c, it) }
        prefs(c).edit().putString("mapa", uri.toString()).apply()
        return true
    }

    private fun sprostiDovoljenje(c: Context, uri: Uri) {
        runCatching { c.contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
    }

    @Synchronized
    private fun db(c: Context): SQLiteDatabase {
        baza?.takeIf { it.isOpen }?.let { return it }
        val d = SQLiteDatabase.openOrCreateDatabase(File(c.noBackupFilesDir, BAZA), null)
        d.execSQL("CREATE VIRTUAL TABLE IF NOT EXISTS kosi USING fts4(iskalno, izvirnik, uri, ime, stran, notindexed=izvirnik, notindexed=uri, notindexed=ime, notindexed=stran)")
        d.execSQL("CREATE TABLE IF NOT EXISTS datoteke(uri TEXT PRIMARY KEY, velikost INTEGER, spremenjeno INTEGER)")
        baza = d
        return d
    }

    /**
     * Isce v indeksu (klicati na [iskanje]). [poizvedba] je iz poizvedbaFts (samo crke, stevke, presledki in zvezdice) in gre v
     * SQL kot vezan parameter. Najvec en zadetek na datoteko, najvec [najvec] datotek. Izkljucuje se z [izbrisi].
     */
    @Synchronized
    fun isci(c: Context, poizvedba: String, najvec: Int = 5): List<Zadetek> {
        if (!File(c.noBackupFilesDir, BAZA).exists()) return emptyList()
        val izidi = mutableListOf<Zadetek>()
        val videne = mutableSetOf<String>()
        db(c).rawQuery("SELECT uri, ime, stran, izvirnik FROM kosi WHERE iskalno MATCH ? LIMIT 200", arrayOf(poizvedba)).use { k ->
            while (k.moveToNext() && izidi.size < najvec) {
                if (!videne.add(k.getString(0))) continue
                izidi += Zadetek(k.getString(1), k.getString(2)?.toIntOrNull(), izrezekZadetka(k.getString(3), poizvedba))
            }
        }
        return izidi
    }

    fun imaIndeks(c: Context): Boolean = mapa(c) != null && stanje(c) != null

    private data class Datoteka(val uri: Uri, val ime: String, val mime: String?, val velikost: Long, val spremenjeno: Long)

    /**
     * Rekurzivni seznam podprtih datotek v izbrani mapi (SAF); meje globine in stevila. Drugi del je false, ce seznam ni
     * popoln (ponudnik ni odgovoril, mapa ni dosegljiva, dosezena meja): takrat se izginule datoteke NE brisejo iz indeksa.
     */
    private fun datoteke(c: Context, drevo: Uri): Pair<List<Datoteka>, Boolean> {
        val r = c.contentResolver
        val izid = mutableListOf<Datoteka>()
        val vrsta = ArrayDeque(listOf(DocumentsContract.getTreeDocumentId(drevo) to 0))
        val stolpci = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        )
        var popoln = true
        while (vrsta.isNotEmpty()) {
            if (izid.size >= NAJVEC_DATOTEK) { popoln = false; break }
            val (id, globina) = vrsta.removeFirst()
            val ok = runCatching {
                r.query(DocumentsContract.buildChildDocumentsUriUsingTree(drevo, id), stolpci, null, null, null)?.use { k ->
                    while (k.moveToNext()) {
                        if (izid.size >= NAJVEC_DATOTEK) { popoln = false; break }
                        val otrok = k.getString(0) ?: continue
                        val mime = k.getString(2)
                        if (mime == DocumentsContract.Document.MIME_TYPE_DIR) { if (globina < NAJVEC_GLOBINA) vrsta.addLast(otrok to globina + 1); continue }
                        val ime = k.getString(1).orEmpty()
                        if (vrstaDokumenta(ime, mime) == null) continue
                        izid += Datoteka(DocumentsContract.buildDocumentUriUsingTree(drevo, otrok), ime, mime,
                            if (k.isNull(3)) -1L else k.getLong(3), if (k.isNull(4)) 0L else k.getLong(4))
                    }
                    true
                } ?: false
            }.getOrDefault(false)
            if (!ok) popoln = false
        }
        return izid to popoln
    }

    /**
     * Indeksira izbrano mapo (klicati na [nit]): preskoci nespremenjene datoteke (velikost in cas), izbrise vrstice izginulih,
     * datoteka, ki je ni bilo mogoce prebrati (tudi OCR brez modela), se ne zapise kot indeksirana in se poskusi naslednjic.
     */
    fun indeksiraj(c: Context, napredek: (Int) -> Unit = {}): Stanje? {
        val drevo = mapa(c) ?: return null
        indeksiram = true
        try {
            val d = db(c)
            val (vse, popoln) = datoteke(c, drevo)
            val ziveUri = vse.map { it.uri.toString() }.toSet()
            val znane = mutableMapOf<String, Pair<Long, Long>>()
            d.rawQuery("SELECT uri, velikost, spremenjeno FROM datoteke", null).use { k -> while (k.moveToNext()) znane[k.getString(0)] = k.getLong(1) to k.getLong(2) }
            // nepopoln seznam (nedosegljiva kartica, ponudnik brez povezave) ne sme izbrisati indeksa in dela OCR
            if (popoln) for (u in znane.keys - ziveUri) izbrisiDatoteko(d, u)
            var napak = 0
            var obdelanih = 0
            for (f in vse) {
                obdelanih++
                if (obdelanih % 5 == 0) napredek(obdelanih)
                val kljuc = f.uri.toString()
                if (znane[kljuc] == (f.velikost to f.spremenjeno)) continue
                val besedilo = runCatching { preberi(c, f) }.getOrNull()
                d.beginTransaction()
                try {
                    if (kljuc in znane) izbrisiDatoteko(d, kljuc)
                    if (besedilo != null) {
                        for ((stran, kos) in besedilo) for (del in razreziZaIndeks(kos)) {
                            d.insert("kosi", null, ContentValues().apply {
                                put("iskalno", normalizirajZaIskanje(f.ime + " " + del)); put("izvirnik", del); put("uri", kljuc); put("ime", f.ime)
                                put("stran", stran?.toString())
                            })
                        }
                        d.insert("datoteke", null, ContentValues().apply { put("uri", kljuc); put("velikost", f.velikost); put("spremenjeno", f.spremenjeno) })
                    } else napak++
                    d.setTransactionSuccessful()
                } finally { d.endTransaction() }
            }
            val st = Stanje(d.rawQuery("SELECT COUNT(*) FROM datoteke", null).use { k -> if (k.moveToFirst()) k.getInt(0) else 0 }, napak, System.currentTimeMillis())
            prefs(c).edit().putInt("datotek", st.datotek).putInt("napak", st.napak).putLong("cas", st.casMs).apply()
            return st
        } finally { indeksiram = false }
    }

    private fun izbrisiDatoteko(d: SQLiteDatabase, uri: String) {
        d.delete("kosi", "uri = ?", arrayOf(uri))
        d.delete("datoteke", "uri = ?", arrayOf(uri))
    }

    /** Pari (stran ali null, besedilo); null = branje ni uspelo. Prazen seznam = datoteka brez besedila (indeksirana). */
    private fun preberi(c: Context, f: Datoteka): List<Pair<Int?, String>>? {
        if (f.velikost > NAJVEC_BAJTOV_DOKUMENTA) return null
        return when (vrstaDokumenta(f.ime, f.mime)) {
            VrstaDokumenta.BESEDILO -> listOf(null to besediloIzBajtov(bajti(c, f.uri) ?: return null))
            VrstaDokumenta.DOCX -> listOf(null to (besediloDocx(bajti(c, f.uri) ?: return null) ?: return null))
            VrstaDokumenta.SLIKA -> listOf(null to (ocrSlike(c, f.uri) ?: return null))
            VrstaDokumenta.PDF -> ocrPdf(c, f.uri)
            null -> null
        }
    }

    private fun bajti(c: Context, uri: Uri): ByteArray? = c.contentResolver.openInputStream(uri)?.use { vhod ->
        val izhod = java.io.ByteArrayOutputStream()
        val med = ByteArray(64 * 1024)
        var n = vhod.read(med)
        while (n >= 0) {
            if (izhod.size() + n > NAJVEC_BAJTOV_DOKUMENTA) return null
            izhod.write(med, 0, n)
            n = vhod.read(med)
        }
        izhod.toByteArray()
    }

    /** OCR na telefonu (ML Kit, latinica: tudi c, s, z s stresico). Model prenesejo storitve Google Play; brez modela vrne izjemo. */
    private val prepoznava by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    private fun ocr(bmp: Bitmap, stopinje: Int = 0): String = Tasks.await(prepoznava.process(InputImage.fromBitmap(bmp, stopinje)), 60, TimeUnit.SECONDS).text

    private fun ocrSlike(c: Context, uri: Uri): String? {
        val meje = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        // z inJustDecodeBounds decodeStream vedno vrne null; velja samo meje.outWidth/outHeight
        (c.contentResolver.openInputStream(uri) ?: return null).use { BitmapFactory.decodeStream(it, null, meje) }
        if (meje.outWidth <= 0 || meje.outHeight <= 0) return null
        var vzorec = 1
        while (maxOf(meje.outWidth, meje.outHeight) / vzorec > NAJVEC_STRANICA_SLIKE) vzorec *= 2
        val bmp = c.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = vzorec }) } ?: return null
        // BitmapFactory ne uposteva EXIF: fotografija telefona bi sla v OCR obrnjena
        val stopinje = runCatching {
            c.contentResolver.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
                    else -> 0
                }
            }
        }.getOrNull() ?: 0
        return try { ocr(bmp, stopinje) } finally { bmp.recycle() }
    }

    /** PDF: vsaka stran (najvec 40) se izrise in prebere z OCR; deluje za skenirane in za besedilne PDF. Sifriran PDF vrne null. */
    private fun ocrPdf(c: Context, uri: Uri): List<Pair<Int?, String>>? {
        val fd = c.contentResolver.openFileDescriptor(uri, "r") ?: return null
        return fd.use {
            PdfRenderer(it).use { pdf ->
                (0 until minOf(pdf.pageCount, NAJVEC_STRANI_PDF)).map { i ->
                    pdf.openPage(i).use { stran ->
                        val merilo = minOf(2f, NAJVEC_STRANICA_SLIKE.toFloat() / maxOf(stran.width, stran.height))
                        val bmp = Bitmap.createBitmap(maxOf(1, (stran.width * merilo).toInt()), maxOf(1, (stran.height * merilo).toInt()), Bitmap.Config.ARGB_8888)
                        try {
                            bmp.eraseColor(Color.WHITE)
                            stran.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            (i + 1) to ocr(bmp)
                        } finally { bmp.recycle() }
                    }
                }
            }
        }
    }

    /** Izbrise indeks, dovoljenje za mapo in stanje (klicati na [nit], SAMO po potrditvi uporabnika v pogovornem oknu). */
    @Synchronized
    fun izbrisi(c: Context) {
        baza?.close(); baza = null
        SQLiteDatabase.deleteDatabase(File(c.noBackupFilesDir, BAZA))
        mapa(c)?.let { sprostiDovoljenje(c, it) }
        val vklop = vklopljeno(c)
        prefs(c).edit().clear().putBoolean("vklopljeno", vklop).apply()
    }
}
