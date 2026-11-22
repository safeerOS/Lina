package si.safeer.lina.asistent

import android.app.Activity
import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.ImeTozilnik

/**
 * Ime uporabnika za pozdrav osebne tajnice (lastnik 21. 11. 2026: »Poklicali ste Tomaža«; brez imena »Dosegli ste glasovno tajnico.«).
 * Shranjeno lokalno v telefonu (zasebne nastavitve aplikacije); klic ga prebere ob vsakem zacetku (LokalniPrehodUpravljalnik).
 */
object ImeUporabnika {
    const val PREFS = "lina_ime"
    const val KLJUC_IME = "ime"
    const val KLJUC_TOZILNIK = "tozilnik"
    private const val NAJVEC = 60

    fun preberi(c: Context): Pair<String, String> {
        val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return (p.getString(KLJUC_IME, "") ?: "") to (p.getString(KLJUC_TOZILNIK, "") ?: "")
    }

    fun shrani(c: Context, ime: String, tozilnik: String) {
        fun cisto(s: String) = s.replace(Regex("\\s+"), " ").trim().take(NAJVEC)
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KLJUC_IME, cisto(ime)).putString(KLJUC_TOZILNIK, cisto(tozilnik)).apply()
    }
}

/**
 * Razdelek »Kako vam je ime?« v nastavitvah asistentke (pred spletnimi orodji): ime, predlog tozilnika (popravljiv) in predogled pozdrava.
 * Vstavi se v [vsebnik] od mesta [zacetek]; [dodanih] pove, koliko pogledov je dodal.
 */
class ImeUporabnikaPogled(private val a: Activity, private val vsebnik: LinearLayout, zacetek: Int) {
    var dodanih = 0
        private set
    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    init {
        var mesto = zacetek
        fun vrstica(v: View, zgoraj: Int) = vsebnik.addView(
            v, mesto++.also { dodanih++ },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
        )
        val (ime0, toz0) = ImeUporabnika.preberi(a)
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Heading); setText(R.string.name_title) }, 16)
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.name_note) }, 4)
        fun polje(hint: Int, vrednost: String) = EditText(a, null, 0, R.style.Gw_Field).apply {
            setHint(hint)
            setText(vrednost)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PERSON_NAME or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            filters = arrayOf(android.text.InputFilter.LengthFilter(60))
            // Slog polja jih sicer pusti nefokusirana (zaslon 22. 11. 2026: vnos ni bil mogoc); enako kot polja kljucev.
            isFocusable = true
            isFocusableInTouchMode = true
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        val imePolje = polje(R.string.name_hint, ime0).also { vrstica(it, 8) }
        val tozPolje = polje(R.string.name_acc_hint, toz0).also { vrstica(it, 8) }
        val predogled = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        vrstica(predogled, 6)
        val shrani = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.name_save) }
        vrstica(shrani, 8)

        fun osvezi() {
            val ime = imePolje.text.toString()
            // Predlog tozilnika je viden kot namig polja; rocni vnos ima prednost.
            tozPolje.hint = ImeTozilnik.imeVTozilniku(ime).ifEmpty { a.getString(R.string.name_acc_hint) }
            predogled.text = a.getString(R.string.name_preview_fmt, ImeTozilnik.pozdrav(ime, tozPolje.text.toString()))
        }
        val opazovalec = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, z: Int, c: Int, p: Int) {}
            override fun onTextChanged(s: CharSequence?, z: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) = osvezi()
        }
        imePolje.addTextChangedListener(opazovalec)
        tozPolje.addTextChangedListener(opazovalec)
        shrani.setOnClickListener {
            ImeUporabnika.shrani(a, imePolje.text.toString(), tozPolje.text.toString())
            predogled.text = a.getString(R.string.name_saved_fmt, ImeTozilnik.pozdrav(imePolje.text.toString(), tozPolje.text.toString()))
            (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)?.hideSoftInputFromWindow(vsebnik.windowToken, 0)
        }
        osvezi()
    }
}
