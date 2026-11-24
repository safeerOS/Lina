package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import si.safeer.lina.pokaziVarno
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import si.safeer.lina.AppLocale
import si.safeer.lina.R
import si.safeer.lina.SistemskeVrstice
import si.safeer.lina.samostojna.PRIVZETA_STRANICA_OZNAKE_MM
import si.safeer.lina.samostojna.Poravnava
import si.safeer.lina.samostojna.ShranjenaPoravnava
import si.safeer.lina.samostojna.TockaSlike
import si.safeer.lina.samostojna.kretnja
import si.safeer.lina.samostojna.merilnaRavnina
import si.safeer.lina.samostojna.normalizirajKot
import si.safeer.lina.samostojna.odmik
import si.safeer.lina.samostojna.omejiProsojnost
import si.safeer.lina.samostojna.polozajVMm
import si.safeer.lina.samostojna.premakni
import si.safeer.lina.samostojna.preberiPoravnavo
import si.safeer.lina.samostojna.stranicaOznake
import si.safeer.lina.samostojna.zacetnaPoravnava
import si.safeer.lina.samostojna.zapisPoravnave
import java.io.File
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max

/**
 * Prosojna plast predloge (lastnik 23. 11. 2026): graficna predloga z racunalnika (slika ali prva stran PDF) lezi prosojno cez
 * fotografijo majice za ujemanje tiska. Drsnik prosojnosti, premik/zasuk/merilo s prsti (in z gumbi za natancne korake), zaklep,
 * shranjevanje poravnave po potrditvi. Ce uporabnik oznaci 4 vogale oznake ArUco znane velikosti (nacrt vid-kontrola-tiska-1510),
 * se polozaj predloge in odmik od shranjene poravnave izpiseta v mm in stopinjah. Lina nima dovoljenja CAMERA: fotografija gre
 * prek sistemskega programa (ACTION_IMAGE_CAPTURE) v PosnetekPonudnik.
 * Vse koordinate poravnave so v pikslih fotografije (ne zaslona), zato se poravnava obnovi enako na vsakem zaslonu.
 */
class ProsojnaPlastActivity : Activity() {
    companion object {
        private const val PREFS = "lina_prosojna"
        private const val KLJUC_VKLOP = "vklop"
        private const val KLJUC_SHRANJENA = "shranjena"
        private const val KLJUC_PDF = "predloga_pdf"
        private const val ZAHTEVA_PREDLOGA = 7411
        private const val ZAHTEVA_SLIKA = 7412
        private const val ZAHTEVA_FOTO = 7413
        private const val NAJVEC_BAJTOV = 30L * 1024 * 1024
        private const val NAJVEC_PIK = 2048
        private const val STANJE = "stanje"

        /** Stikalo v Nastavitvah > Orodja; privzeto vklopljeno (lastnikova ideja 23. 11. 2026). */
        fun vklopljena(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KLJUC_VKLOP, true)
        fun nastavi(c: Context, vklop: Boolean) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KLJUC_VKLOP, vklop).apply()

        /**
         * Razdelek v Nastavitvah: stikalo (privzeto vklopljeno) in gumb, ki odpre zaslon. Vstavi se pred assistantKeyForget, zato ga
         * NastavitveMeni uvrsti v podmeni Orodja; izklop skrije gumb.
         */
        fun dodajVNastavitve(a: Activity, vsebnik: LinearLayout, zacetek: Int) {
            var mesto = zacetek
            val dp = { v: Int -> (v * a.resources.displayMetrics.density).toInt() }
            fun vrstica(v: View, zgoraj: Int) = vsebnik.addView(
                v, mesto++, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
            )
            vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Heading); setText(R.string.overlay_title) }, 16)
            val stikalo = android.widget.CheckBox(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.overlay_setting); isChecked = vklopljena(a) }
            vrstica(stikalo, 8)
            vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.overlay_setting_note) }, 4)
            val odpri = Button(a, null, 0, R.style.Gw_Button).apply {
                setText(R.string.overlay_open)
                visibility = if (stikalo.isChecked) View.VISIBLE else View.GONE
                setOnClickListener { a.startActivity(Intent(a, ProsojnaPlastActivity::class.java)) }
            }
            vsebnik.addView(odpri, mesto++, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
            stikalo.setOnCheckedChangeListener { _, vklop -> nastavi(a, vklop); odpri.visibility = if (vklop) View.VISIBLE else View.GONE }
        }
    }

    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private val mapa by lazy { File(filesDir, "prosojna").apply { mkdirs() } }
    private val datPredloga by lazy { File(mapa, "predloga") }
    private val datMajica by lazy { File(mapa, "majica") }

    private lateinit var plast: PlastPogled
    private lateinit var stanje: TextView
    private lateinit var meritev: TextView
    private lateinit var prosojnost: SeekBar
    private lateinit var zaklep: Button
    private lateinit var stranica: EditText

    private var predloga: Bitmap? = null
    private var majica: Bitmap? = null
    private var poravnava: Poravnava? = null
    private var kotiOznake: List<TockaSlike>? = null
    /** Med oznacevanjem: do zdaj tapnjeni vogali (v pikslih fotografije). */
    private var oznacujem: MutableList<TockaSlike>? = null

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        zgradi()
        predloga = runCatching { if (datPredloga.length() > 0) beriPredlogo() else null }.getOrNull()
        majica = runCatching { if (datMajica.length() > 0) dekodiraj(ImageDecoder.createSource(datMajica)) else null }.getOrNull()
        // Delovno stanje po vrtenju ali po ponovnem zagonu procesa med fotografiranjem; sicer shranjena poravnava.
        val delovno = preberiPoravnavo(savedInstanceState?.getString(STANJE))
        val s = delovno ?: preberiPoravnavo(prefs.getString(KLJUC_SHRANJENA, null))
        val p = predloga
        if (s != null && p != null && s.wPredloge == p.width && s.hPredloge == p.height) {
            poravnava = s.poravnava
            // Vogali shranjene poravnave veljajo za takratno fotografijo; ta je morda ze zamenjana, zato samo iz delovnega stanja.
            if (delovno != null) kotiOznake = s.kotiOznake
            stranica.setText(fmt(s.stranicaMm))
        }
        val m = majica
        if (poravnava == null && p != null && m != null) poravnava = zacetnaPoravnava(p.width, p.height, m.width, m.height)
        osvezi()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        trenutna()?.let { outState.putString(STANJE, zapisPoravnave(it)) }
    }

    override fun onDestroy() {
        super.onDestroy()
        predloga?.recycle(); majica?.recycle()
    }

    // ---------- vmesnik ----------

    private fun gumb(besedilo: Int, opis: Int? = null, klik: () -> Unit) = Button(this, null, 0, R.style.Gw_Button).apply {
        setText(besedilo)
        opis?.let { contentDescription = getString(it) }
        setOnClickListener { klik() }
    }

    private fun vrsta(vararg pogledi: View): View {
        val v = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        pogledi.forEachIndexed { i, p ->
            v.addView(p, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { if (i > 0) marginStart = dp(8) })
        }
        return HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(v) }
    }

    private fun zgradi() {
        val koren = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        koren.setOnApplyWindowInsetsListener { view, insets ->
            val b = SistemskeVrstice.odmiki(insets)
            view.setPadding(dp(12) + b[0], dp(8) + b[1], dp(12) + b[2], dp(8) + b[3])
            insets
        }
        val glava = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        glava.addView(TextView(this, null, 0, R.style.Gw_Heading).apply {
            text = "‹"; textSize = 24f; minWidth = dp(48); minHeight = dp(48); gravity = Gravity.CENTER
            isClickable = true; isFocusable = true
            contentDescription = getString(R.string.overlay_back)
            background = getDrawable(android.R.drawable.list_selector_background)
            setOnClickListener { finish() }
        })
        glava.addView(TextView(this, null, 0, R.style.Gw_Title).apply { setText(R.string.overlay_title); isAccessibilityHeading = true })
        koren.addView(glava)

        plast = PlastPogled(this)
        koren.addView(plast, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(4) })

        stanje = TextView(this, null, 0, R.style.Gw_Muted).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        meritev = TextView(this, null, 0, R.style.Gw_Body).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE; setTextIsSelectable(true) }
        koren.addView(stanje)
        koren.addView(meritev)

        prosojnost = SeekBar(this).apply {
            max = 100
            contentDescription = getString(R.string.overlay_opacity)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar, napredek: Int, odUporabnika: Boolean) {
                    if (!odUporabnika) return
                    poravnava = poravnava?.copy(prosojnost = omejiProsojnost(napredek / 100.0))
                    plast.invalidate()
                }
                override fun onStartTrackingTouch(s: SeekBar) {}
                override fun onStopTrackingTouch(s: SeekBar) {}
            })
        }
        val vrstaProsojnosti = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        vrstaProsojnosti.addView(TextView(this, null, 0, R.style.Gw_Muted).apply { setText(R.string.overlay_opacity) })
        vrstaProsojnosti.addView(prosojnost, LinearLayout.LayoutParams(0, dp(48), 1f))
        koren.addView(vrstaProsojnosti)

        zaklep = gumb(R.string.overlay_lock) { preklopiZaklep() }
        stranica = EditText(this, null, 0, R.style.Gw_Field).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(fmt(PRIVZETA_STRANICA_OZNAKE_MM))
            hint = getString(R.string.overlay_marker_size)
            contentDescription = getString(R.string.overlay_marker_size)
            minWidth = dp(72)
        }
        // Meritev v mm se osvezi ob vsakem vnosu (gumbi v nacinu dotika ne vzamejo fokusa, zato izguba fokusa ne zadostuje).
        stranica.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, z: Int, d: Int, n: Int) {}
            override fun onTextChanged(s: CharSequence?, z: Int, d: Int, n: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { osvezi() }
        })
        koren.addView(vrsta(
            gumb(R.string.overlay_pick_template) { izberi(ZAHTEVA_PREDLOGA, arrayOf("image/*", "application/pdf")) },
            gumb(R.string.overlay_take_photo) { fotografiraj() },
            gumb(R.string.overlay_pick_photo) { izberi(ZAHTEVA_SLIKA, arrayOf("image/*")) },
        ))
        // Natancni koraki z gumbi: tudi za bralnik zaslona in tipkovnico, kjer kretnje s prsti niso mogoce.
        koren.addView(vrsta(
            gumb(R.string.overlay_sym_left, R.string.overlay_left) { korak { it.premakni(-korakPik(), 0.0) } },
            gumb(R.string.overlay_sym_right, R.string.overlay_right) { korak { it.premakni(korakPik(), 0.0) } },
            gumb(R.string.overlay_sym_up, R.string.overlay_up) { korak { it.premakni(0.0, -korakPik()) } },
            gumb(R.string.overlay_sym_down, R.string.overlay_down) { korak { it.premakni(0.0, korakPik()) } },
            gumb(R.string.overlay_sym_rot_left, R.string.overlay_rot_left) { korak { it.kretnja(TockaSlike(it.x, it.y), 1.0, -0.5) } },
            gumb(R.string.overlay_sym_rot_right, R.string.overlay_rot_right) { korak { it.kretnja(TockaSlike(it.x, it.y), 1.0, 0.5) } },
            gumb(R.string.overlay_sym_smaller, R.string.overlay_smaller) { korak { it.kretnja(TockaSlike(it.x, it.y), 0.99, 0.0) } },
            gumb(R.string.overlay_sym_bigger, R.string.overlay_bigger) { korak { it.kretnja(TockaSlike(it.x, it.y), 1.01, 0.0) } },
        ))
        koren.addView(vrsta(
            zaklep,
            gumb(R.string.overlay_mark) { zacniOznacevanje() },
            TextView(this, null, 0, R.style.Gw_Muted).apply { setText(R.string.overlay_marker_size) },
            stranica,
        ))
        koren.addView(vrsta(
            gumb(R.string.overlay_save) { potrdiShranjevanje() },
            gumb(R.string.overlay_reset) { potrdiPonastavitev() },
        ))
        setContentView(koren)
    }

    /** En korak gumba = 1 piksel zaslona v pikslih fotografije (vsaj 1). */
    private fun korakPik(): Double = max(1.0, 1.0 / max(plast.merilo(), 1e-6))

    private fun korak(f: (Poravnava) -> Poravnava) {
        val p = poravnava ?: return
        poravnava = f(p)
        osvezi()
    }

    private fun fmt(v: Double) = String.format(Locale.getDefault(), "%.1f", v)

    private fun trenutna(): ShranjenaPoravnava? {
        val p = poravnava ?: return null
        val t = predloga ?: return null
        val vneseno = stranicaOznake(stranica.text.toString())
        val s = vneseno ?: PRIVZETA_STRANICA_OZNAKE_MM
        // Brez veljavne stranice ni meritve v mm (ne tiho privzetih 50 mm).
        val h = if (vneseno == null) null else kotiOznake?.let { merilnaRavnina(it, s) }
        return ShranjenaPoravnava(p, t.width, t.height, kotiOznake, s, h?.let { polozajVMm(it, p, t.width, t.height) })
    }

    private fun osvezi() {
        val p = poravnava
        zaklep.setText(if (p?.zaklenjena == true) R.string.overlay_unlock else R.string.overlay_lock)
        prosojnost.progress = ((p?.prosojnost ?: omejiProsojnost(Double.NaN)) * 100).toInt()
        val oz = oznacujem
        stanje.text = when {
            predloga == null || majica == null -> getString(R.string.overlay_hint_start)
            oz != null -> getString(R.string.overlay_hint_mark, oz.size + 1)
            else -> ""
        }
        meritev.text = besediloMeritve()
        plast.invalidate()
    }

    private fun besediloMeritve(): String {
        val zdaj = trenutna() ?: return ""
        if (stranicaOznake(stranica.text.toString()) == null) return getString(R.string.overlay_size_bad)
        val m = zdaj.referenca ?: return getString(R.string.overlay_no_marker)
        val vrstice = mutableListOf(getString(R.string.overlay_position, fmt(m.x), fmt(m.y), fmt(m.kot), fmt(m.sirina)))
        val shranjena = preberiPoravnavo(prefs.getString(KLJUC_SHRANJENA, null))
        val ref = shranjena?.referenca
        if (shranjena != null && ref != null && shranjena.wPredloge == zdaj.wPredloge && shranjena.hPredloge == zdaj.hPredloge) {
            val o = odmik(ref, m)
            vrstice += getString(R.string.overlay_offset, fmt(o.dx), fmt(o.dy), fmt(o.zasuk))
        }
        return vrstice.joinToString("\n")
    }

    private fun preklopiZaklep() {
        val p = poravnava ?: return
        poravnava = p.copy(zaklenjena = !p.zaklenjena)
        osvezi()
    }

    private fun zacniOznacevanje() {
        if (majica == null) return
        oznacujem = mutableListOf()
        osvezi()
    }

    private fun dodajVogal(t: TockaSlike) {
        val oz = oznacujem ?: return
        oz += t
        if (oz.size < 4) { osvezi(); return }
        oznacujem = null
        val s = stranicaOznake(stranica.text.toString()) ?: PRIVZETA_STRANICA_OZNAKE_MM
        if (merilnaRavnina(oz, s) == null) {
            osvezi()
            stanje.setText(R.string.overlay_mark_bad)
            return
        }
        kotiOznake = oz.toList()
        osvezi()
    }

    private fun potrdiShranjevanje() {
        val z = trenutna() ?: return
        AlertDialog.Builder(this).setMessage(R.string.overlay_save_confirm)
            .setPositiveButton(R.string.overlay_save) { _, _ ->
                prefs.edit().putString(KLJUC_SHRANJENA, zapisPoravnave(z)).apply()
                osvezi()
                stanje.setText(R.string.overlay_saved)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .pokaziVarno()
    }

    private fun potrdiPonastavitev() {
        val t = predloga ?: return
        val m = majica ?: return
        AlertDialog.Builder(this).setMessage(R.string.overlay_reset_confirm)
            .setPositiveButton(R.string.overlay_reset) { _, _ ->
                poravnava = zacetnaPoravnava(t.width, t.height, m.width, m.height)
                kotiOznake = null
                oznacujem = null
                osvezi()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .pokaziVarno()
    }

    // ---------- datoteke ----------

    private fun izberi(zahteva: Int, vrste: Array<String>) {
        val namen = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, vrste)
        try { startActivityForResult(namen, zahteva) }
        catch (e: ActivityNotFoundException) { stanje.setText(R.string.chat_attach_no_picker) }
    }

    private fun fotografiraj() {
        PosnetekPonudnik.datoteka(this).delete()   // ostanek, ce je bil proces med fotografiranjem ubit
        val uri = PosnetekPonudnik.naslov(this)
        val namen = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        namen.clipData = ClipData.newRawUri("", uri)
        try { startActivityForResult(namen, ZAHTEVA_FOTO) }
        catch (e: ActivityNotFoundException) { stanje.setText(R.string.overlay_no_camera) }
        catch (e: SecurityException) { stanje.setText(R.string.overlay_no_camera) }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            ZAHTEVA_FOTO -> {
                val uri = PosnetekPonudnik.naslov(this)
                revokeUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val f = PosnetekPonudnik.datoteka(this)
                try {
                    // Nekateri programi EXTRA_OUTPUT prezrejo in vrnejo samo sliciko: datoteka ostane prazna.
                    if (resultCode == RESULT_OK) {
                        if (f.length() == 0L) stanje.setText(R.string.overlay_read_fail)
                        else sprejmiMajico { f.inputStream() }
                    }
                } finally { f.delete() }
            }
            ZAHTEVA_SLIKA -> if (resultCode == RESULT_OK) data?.data?.let { u -> sprejmiMajico { contentResolver.openInputStream(u) ?: throw java.io.IOException() } }
            ZAHTEVA_PREDLOGA -> if (resultCode == RESULT_OK) data?.data?.let { sprejmiPredlogo(it) }
        }
    }

    /**
     * Kopija z mejo velikosti v [cilj].nova; vrne kopijo ali null. Klicatelj jo dekodira in sele nato preimenuje v [cilj], zato
     * pokvarjena ali prevelika datoteka ne zamenja prejsnje.
     */
    private fun kopiraj(vhod: () -> java.io.InputStream, cilj: File): File? {
        val nova = File(cilj.path + ".nova")
        try {
            var skupaj = 0L
            vhod().use { i ->
                nova.outputStream().use { o ->
                    val med = ByteArray(64 * 1024)
                    while (true) {
                        val n = i.read(med)
                        if (n < 0) break
                        skupaj += n
                        if (skupaj > NAJVEC_BAJTOV) { stanje.setText(R.string.overlay_too_big); nova.delete(); return null }
                        o.write(med, 0, n)
                    }
                }
            }
            if (skupaj == 0L) { stanje.setText(R.string.overlay_read_fail); nova.delete(); return null }
            return nova
        } catch (e: Exception) {
            stanje.setText(R.string.overlay_read_fail)
            nova.delete()
            return null
        }
    }

    /** Dekodira kopijo; ob uspehu jo preimenuje v [cilj], sicer jo pobrise in prejsnja datoteka ostane. */
    private fun sprejmi(nova: File, cilj: File, dekodiraj: (File) -> Bitmap): Bitmap? {
        val b = runCatching { dekodiraj(nova) }.getOrNull()
        if (b == null || !nova.renameTo(cilj)) {
            b?.recycle(); nova.delete()
            stanje.setText(R.string.overlay_read_fail)
            return null
        }
        return b
    }

    private fun sprejmiMajico(vhod: () -> java.io.InputStream) {
        val nova = kopiraj(vhod, datMajica) ?: return
        val b = sprejmi(nova, datMajica) { dekodiraj(ImageDecoder.createSource(it)) } ?: return
        majica?.recycle()
        majica = b
        kotiOznake = null   // vogali oznake veljajo samo za fotografijo, na kateri so bili oznaceni
        oznacujem = null
        val t = predloga
        if (poravnava == null && t != null) poravnava = zacetnaPoravnava(t.width, t.height, b.width, b.height)
        osvezi()
    }

    private fun sprejmiPredlogo(uri: Uri) {
        val pdf = contentResolver.getType(uri) == "application/pdf"
        val nova = kopiraj({ contentResolver.openInputStream(uri) ?: throw java.io.IOException() }, datPredloga) ?: return
        val b = sprejmi(nova, datPredloga) { beriPredlogo(it, pdf) } ?: return
        prefs.edit().putBoolean(KLJUC_PDF, pdf).apply()
        predloga?.recycle()
        predloga = b
        val m = majica
        // Brez fotografije ni okvira za poravnavo: nastavi se, ko pride fotografija (sprejmiMajico).
        poravnava = m?.let { zacetnaPoravnava(b.width, b.height, it.width, it.height) }
        osvezi()
    }

    private fun beriPredlogo(f: File = datPredloga, pdf: Boolean = prefs.getBoolean(KLJUC_PDF, false)): Bitmap =
        if (pdf) prvaStranPdf(f) else dekodiraj(ImageDecoder.createSource(f))

    /** ImageDecoder uposteva EXIF usmerjenost fotografije in jo pomanjsa na najvec [NAJVEC_PIK] po daljsi stranici. */
    private fun dekodiraj(vir: ImageDecoder.Source): Bitmap = ImageDecoder.decodeBitmap(vir) { dek, info, _ ->
        val w = info.size.width; val h = info.size.height
        val f = NAJVEC_PIK.toDouble() / max(w, h)
        if (f < 1) dek.setTargetSize(max(1, (w * f).toInt()), max(1, (h * f).toInt()))
        dek.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }

    /** Prva stran PDF kot slika s prosojnim ozadjem (prazni deli strani ne prekrijejo majice). */
    private fun prvaStranPdf(f: File): Bitmap =
        ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { r ->
                r.openPage(0).use { s ->
                    val k = NAJVEC_PIK.toDouble() / max(s.width, s.height)
                    val b = Bitmap.createBitmap(max(1, (s.width * k).toInt()), max(1, (s.height * k).toInt()), Bitmap.Config.ARGB_8888)
                    s.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    b
                }
            }
        }

    // ---------- risanje in kretnje ----------

    /** Fotografija majice, prosojna predloga in vogali oznake; kretnje spreminjajo poravnavo v pikslih fotografije. */
    private inner class PlastPogled(c: Context) : View(c) {
        private val risanje = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        private val crta = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = c.getColor(R.color.accent); strokeWidth = dp(2).toFloat(); style = Paint.Style.STROKE }
        private val pika = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = c.getColor(R.color.accent); style = Paint.Style.FILL }
        private var zadnjaSredina: TockaSlike? = null
        private var zadnjaRazdalja = 0.0
        private var zadnjiKot = 0.0
        private var premaknjeno = false

        init {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            contentDescription = c.getString(R.string.overlay_title)
            setBackgroundColor(c.getColor(R.color.surface))
        }

        /** Piksli zaslona na piksel fotografije (fotografija v celoti vidna, na sredini). */
        fun merilo(): Double {
            val m = majica ?: return 1.0
            return minOf(width.toDouble() / m.width, height.toDouble() / m.height)
        }

        private fun zamik(): Pair<Double, Double> {
            val m = majica ?: return 0.0 to 0.0
            val s = merilo()
            return (width - m.width * s) / 2 to (height - m.height * s) / 2
        }

        private fun vFotografijo(x: Float, y: Float): TockaSlike {
            val s = merilo(); val (ox, oy) = zamik()
            return TockaSlike((x - ox) / s, (y - oy) / s)
        }

        private fun naZaslon(t: TockaSlike): Pair<Float, Float> {
            val s = merilo(); val (ox, oy) = zamik()
            return (t.x * s + ox).toFloat() to (t.y * s + oy).toFloat()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val m = majica ?: return
            val s = merilo().toFloat(); val (ox, oy) = zamik()
            val vZaslon = Matrix().apply { setScale(s, s); postTranslate(ox.toFloat(), oy.toFloat()) }
            risanje.alpha = 255
            canvas.drawBitmap(m, vZaslon, risanje)
            val t = predloga; val p = poravnava
            if (t != null && p != null) {
                // Enako kot predlogaVSliko: sredisce predloge v izhodisce, merilo, zasuk, premik v (x, y), nato na zaslon.
                val mat = Matrix().apply {
                    setTranslate(-t.width / 2f, -t.height / 2f)
                    postScale(p.merilo.toFloat(), p.merilo.toFloat())
                    postRotate(p.kot.toFloat())
                    postTranslate(p.x.toFloat(), p.y.toFloat())
                    postConcat(vZaslon)
                }
                risanje.alpha = (p.prosojnost * 255).toInt().coerceIn(0, 255)
                canvas.drawBitmap(t, mat, risanje)
            }
            val vogali = oznacujem ?: kotiOznake ?: return
            val r = dp(5).toFloat()
            vogali.forEachIndexed { i, v ->
                val (x, y) = naZaslon(v)
                canvas.drawCircle(x, y, r, pika)
                if (i > 0) { val (x0, y0) = naZaslon(vogali[i - 1]); canvas.drawLine(x0, y0, x, y, crta) }
            }
            if (vogali.size == 4) { val (x0, y0) = naZaslon(vogali[3]); val (x1, y1) = naZaslon(vogali[0]); canvas.drawLine(x0, y0, x1, y1, crta) }
        }

        override fun onTouchEvent(e: MotionEvent): Boolean {
            if (majica == null) return false
            if (oznacujem != null) {
                if (e.actionMasked == MotionEvent.ACTION_UP) { dodajVogal(vFotografijo(e.x, e.y)); performClick() }
                return true
            }
            val p = poravnava ?: return false
            parent?.requestDisallowInterceptTouchEvent(true)
            val n = e.pointerCount
            val sx = (0 until n).sumOf { e.getX(it).toDouble() } / n
            val sy = (0 until n).sumOf { e.getY(it).toDouble() } / n
            val sredina = vFotografijo(sx.toFloat(), sy.toFloat())
            val razdalja = if (n >= 2) hypot((e.getX(1) - e.getX(0)).toDouble(), (e.getY(1) - e.getY(0)).toDouble()) else 0.0
            val kot = if (n >= 2) Math.toDegrees(atan2((e.getY(1) - e.getY(0)).toDouble(), (e.getX(1) - e.getX(0)).toDouble())) else 0.0
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> premaknjeno = false
                MotionEvent.ACTION_MOVE -> {
                    val prej = zadnjaSredina
                    if (prej != null) {
                        var q = p.premakni(sredina.x - prej.x, sredina.y - prej.y)
                        if (n >= 2 && zadnjaRazdalja > 0 && razdalja > 0) q = q.kretnja(sredina, razdalja / zadnjaRazdalja, normalizirajKot(kot - zadnjiKot))
                        if (q != p) { poravnava = q; premaknjeno = true; invalidate() }
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    zadnjaSredina = null
                    if (premaknjeno) osvezi()
                    if (e.actionMasked == MotionEvent.ACTION_UP) performClick()
                    return true
                }
            }
            // Ob vsaki spremembi stevila prstov se izhodisce kretnje postavi znova (brez skoka).
            if (e.actionMasked == MotionEvent.ACTION_POINTER_UP) {
                zadnjaSredina = null
                return true
            }
            zadnjaSredina = sredina; zadnjaRazdalja = razdalja; zadnjiKot = kot
            return true
        }

        override fun performClick(): Boolean = super.performClick()
    }
}
