package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.pokaziVarno
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.SinhronKljucev
import java.util.concurrent.ExecutorService

/**
 * Nastavitve > »Kljuci na vseh napravah« (NALOGA-35): kljuci za mozgane z oznako, ki jih imajo vse seznanjene naprave Line. Na
 * zaslonu samo oznaka, ponudnik in zadnji 4 znaki. »Uporabi« velja samo za ta telefon; »Odstrani« (s potrditvijo) na vseh napravah.
 * Vse branje in pisanje Keystore tece na [nit]; po vsakem dejanju se uskladitev zazene takoj.
 */
class KljuciNaNapravahPogled(
    private val a: Activity,
    private val vsebnik: LinearLayout,
    private val nit: ExecutorService,
    private val glavna: Handler,
    private val obSpremembi: () -> Unit,
) {
    private val seznam = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val obvestilo = TextView(a).apply { setTextAppearance(R.style.Gw_Body); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    private val obvestiloGumb = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.keys_sync_ok) }
    private val oznaka = EditText(a, null, 0, R.style.Gw_Field).apply {
        setHint(R.string.keys_sync_label_hint)
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        inputType = InputType.TYPE_CLASS_TEXT
        filters = arrayOf(android.text.InputFilter.LengthFilter(40))
    }
    private val kljuc = EditText(a, null, 0, R.style.Gw_Field).apply {
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        filters = arrayOf(android.text.InputFilter.LengthFilter(400))
    }
    private val dodaj = Button(a, null, 0, R.style.Gw_Button)
    private val stanje = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    private var sporocilo: String? = null

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()
    private fun vrstica(starsi: LinearLayout, v: View, zgoraj: Int) = starsi.addView(
        v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
    )
    private fun jaz(): String = runCatching { NapravaKljuc.id() }.getOrDefault("")

    init {
        vrstica(vsebnik, TextView(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.keys_sync_title); typeface = android.graphics.Typeface.DEFAULT_BOLD }, 16)
        vrstica(vsebnik, TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.keys_sync_note) }, 4)
        vrstica(vsebnik, obvestilo, 8)
        vrstica(vsebnik, obvestiloGumb, 4)
        vrstica(vsebnik, seznam, 4)
        // vidni oznaki polj (namig izgine ob vnosu)
        vrstica(vsebnik, TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.keys_sync_label_title); labelFor = View.generateViewId().also { oznaka.id = it } }, 8)
        vrstica(vsebnik, oznaka, 4)
        vrstica(vsebnik, TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.keys_sync_key_title); labelFor = View.generateViewId().also { kljuc.id = it } }, 8)
        vrstica(vsebnik, kljuc, 4)
        vrstica(vsebnik, dodaj, 8)
        vrstica(vsebnik, stanje, 4)
        obvestiloGumb.setOnClickListener { vOzadju { SinhronKljucev.potrdiObvestilo(UskladitevKljucev.shramba(a)); null } }
        dodaj.setOnClickListener {
            val p = SkupniKljuci.aktivniPonudnik(a).id
            val o = oznaka.text.toString(); val k = kljuc.text.toString()
            vOzadju {
                SinhronKljucev.dodaj(UskladitevKljucev.shramba(a), UskladitevKljucev.sloti(a), jaz(), System.currentTimeMillis(), p, o, k)
            }
        }
        narisi()
        // ob odprtju nastavitev: uskladi (kljuc z druge naprave se pokaze brez gumba)
        UskladitevKljucev.zazeni(a) { glavna.post { if (!a.isFinishing) narisi() } }
    }

    /** [delo] vrne kljuc napake (SinhronKljucev) ali null; po uspehu pobrise vnosa in zazene uskladitev. */
    private fun vOzadju(delo: () -> String?) {
        dodaj.isEnabled = false
        // med delom brez drugega dotika (sicer zavajajoce »ga ni vec«)
        for (i in 0 until seznam.childCount) seznam.getChildAt(i).isEnabled = false
        nit.execute {
            val napaka = try { delo() } catch (_: Exception) { "napaka" }
            glavna.post {
                if (a.isFinishing) return@post
                dodaj.isEnabled = true
                sporocilo = napaka?.let {
                    a.getString(when (it) {
                        "kljuc" -> R.string.keys_sync_err_key
                        "oznaka" -> R.string.keys_sync_err_label
                        "ni" -> R.string.keys_sync_err_exists
                        else -> R.string.keys_sync_err
                    })
                }
                if (napaka == null) { oznaka.setText(""); kljuc.setText(""); obSpremembi() }
                narisi()
                if (napaka == null) UskladitevKljucev.zazeni(a) { glavna.post { if (!a.isFinishing) { narisi(); obSpremembi() } } }
            }
        }
    }

    fun narisi() {
        val p = SkupniKljuci.aktivniPonudnik(a)
        kljuc.hint = a.getString(R.string.local_key_hint_fmt, p.oznaka)
        dodaj.text = a.getString(R.string.keys_sync_add_fmt, p.oznaka)
        stanje.text = sporocilo.orEmpty()
        stanje.visibility = if (sporocilo == null) View.GONE else View.VISIBLE
        val vidno = p != Ponudnik.VERTEX // Google Cloud nima kljuca API (prijava), ne usklajuje se
        for (v in listOf(oznaka, kljuc, dodaj)) v.visibility = if (vidno) View.VISIBLE else View.GONE
        nit.execute {
            val shramba = UskladitevKljucev.shramba(a)
            val vrstice = SinhronKljucev.seznam(shramba, jaz())
            val odstranjeni = SinhronKljucev.odstranjeni(shramba)
            glavna.post { if (!a.isFinishing) prikazi(vrstice, odstranjeni) }
        }
    }

    private fun prikazi(vrstice: List<SinhronKljucev.Prikaz>, odstranjeni: List<String>) {
        val imena = odstranjeni.joinToString(", ") { Ponudnik.izId(it).oznaka }
        obvestilo.text = if (odstranjeni.isEmpty()) "" else a.getString(R.string.keys_sync_removed_fmt, imena)
        obvestilo.visibility = if (odstranjeni.isEmpty()) View.GONE else View.VISIBLE
        obvestiloGumb.visibility = obvestilo.visibility
        seznam.removeAllViews()
        if (vrstice.isEmpty()) {
            vrstica(seznam, TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.keys_sync_empty) }, 4)
            return
        }
        for (v in vrstice) {
            val ponudnik = Ponudnik.izId(v.ponudnik).oznaka
            val opis = a.getString(if (v.vUporabi) R.string.keys_sync_row_used_fmt else R.string.keys_sync_row_fmt, v.oznaka, ponudnik, v.namig)
            vrstica(seznam, TextView(a).apply { setTextAppearance(R.style.Gw_Body); text = opis }, 10)
            if (!v.vUporabi) {
                vrstica(seznam, Button(a, null, 0, R.style.Gw_Button).apply {
                    text = a.getString(R.string.keys_sync_use)
                    contentDescription = "${a.getString(R.string.keys_sync_use)}: $opis"
                    setOnClickListener { vOzadju { SinhronKljucev.uporabi(UskladitevKljucev.shramba(a), UskladitevKljucev.sloti(a), jaz(), System.currentTimeMillis(), v.id) } }
                }, 4)
            }
            vrstica(seznam, Button(a, null, 0, R.style.Gw_Button).apply {
                text = a.getString(R.string.keys_sync_remove)
                contentDescription = "${a.getString(R.string.keys_sync_remove)}: $opis"
                setOnClickListener {
                    AlertDialog.Builder(a)
                        .setMessage(a.getString(R.string.keys_sync_remove_confirm_fmt, v.oznaka))
                        .setPositiveButton(R.string.keys_sync_remove) { _, _ ->
                            vOzadju { SinhronKljucev.odstrani(UskladitevKljucev.shramba(a), UskladitevKljucev.sloti(a), jaz(), System.currentTimeMillis(), v.id) }
                        }
                        .setNegativeButton(android.R.string.cancel, null)
                        .pokaziVarno()
                }
            }, 4)
        }
    }
}
