package si.safeer.lina.asistent

import android.app.Activity
import android.content.Context
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.Paket
import java.time.Instant

/**
 * Dostava paketa (lastnik 23. 11. 2026, pojasnilo 24. 11. 2026): stikalo »Pričakujem paket«, mesto »Pred hišo« ali »Drugo mesto« (lastno
 * besedilo, isto preverjanje kot racunalnik) in neobvezno »velja do«. Shranjeno lokalno v telefonu; klic ga prebere, ko se klicatelj
 * predstavi kot dostava (LokalniPrehodUpravljalnik). Kljuci so isti kot v pravilih racunalnika.
 */
object PaketDostave {
    const val PREFS = "lina_paket"
    const val KLJUC_VKLOP = "paketVklop"
    const val KLJUC_MESTO = "paketMesto"
    const val KLJUC_NAVODILO = "paketNavodilo"
    const val KLJUC_DO = "paketDo"

    fun preberi(c: Context): Paket.Nastavitve {
        val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Paket.Nastavitve(
            vklop = p.getBoolean(KLJUC_VKLOP, false),
            mesto = p.getString(KLJUC_MESTO, Paket.MESTO_PRED_HISO) ?: Paket.MESTO_PRED_HISO,
            navodilo = p.getString(KLJUC_NAVODILO, "") ?: "",
            doDne = p.getString(KLJUC_DO, "") ?: "",
        )
    }

    fun nastaviVklop(c: Context, vklop: Boolean) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KLJUC_VKLOP, vklop).apply()
    }

    fun nastaviMesto(c: Context, mesto: String) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KLJUC_MESTO, mesto).apply()
    }

    /** Shrani lastno mesto in »velja do«; vrne id besedila napake (nic se ne shrani) ali null. */
    fun shraniBesedilo(c: Context, mesto: String, navodilo: String, doDne: String): Int? {
        if (Paket.doNeveljaven(doDne)) return R.string.parcel_err_date
        if (mesto == Paket.MESTO_DRUGO) {
            if (Paket.normiraj(navodilo).isEmpty()) return R.string.parcel_err_empty
            when (Paket.razlog(navodilo)) {
                Paket.Razlog.DOLZINA -> return R.string.parcel_err_length
                Paket.Razlog.KODA -> return R.string.parcel_err_code
                Paket.Razlog.DENAR -> return R.string.parcel_err_money
                null -> {}
            }
        }
        // Lastno mesto se shrani samo izbrano (in preverjeno); pri »Pred hišo« ostane prejsnje.
        val ured = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KLJUC_DO, Paket.normirajDo(doDne))
        if (mesto == Paket.MESTO_DRUGO) ured.putString(KLJUC_NAVODILO, Paket.normiraj(navodilo))
        ured.apply()
        return null
    }

    /** Stavek za ta klic ali "" (napaka branja = izklopljeno). */
    fun odgovorZaKlic(c: Context): String = runCatching { Paket.odgovorZaKlic(preberi(c), Instant.now()) }.getOrDefault("")
}

/**
 * Razdelek »Dostava paketa« v nastavitvah asistentke (za imenom). Vstavi se v [vsebnik] od mesta [zacetek]; [dodanih] pove, koliko pogledov
 * je dodal.
 */
class PaketDostavePogled(private val a: Activity, private val vsebnik: LinearLayout, zacetek: Int) {
    var dodanih = 0
        private set
    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    init {
        var mesto = zacetek
        fun vrstica(v: View, zgoraj: Int) = vsebnik.addView(
            v, mesto++.also { dodanih++ },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
        )
        val zacetno = PaketDostave.preberi(a)
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Heading); setText(R.string.parcel_title) }, 16)
        val namig = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.parcel_note) }
        vrstica(namig, 4)
        val vklop = CheckBox(a).apply {
            setText(R.string.parcel_expect)
            setTextAppearance(R.style.Gw_Body)
            minimumHeight = dp(48)
            isChecked = zacetno.vklop
        }
        vrstica(vklop, 8)
        val predHiso = RadioButton(a).apply { id = View.generateViewId(); setText(R.string.parcel_front); setTextAppearance(R.style.Gw_Body); minimumHeight = dp(48) }
        val drugo = RadioButton(a).apply { id = View.generateViewId(); setText(R.string.parcel_other); setTextAppearance(R.style.Gw_Body); minimumHeight = dp(48) }
        val izbira = RadioGroup(a).apply {
            orientation = RadioGroup.VERTICAL
            addView(predHiso)
            addView(drugo)
            check(if (zacetno.mesto == Paket.MESTO_DRUGO) drugo.id else predHiso.id)
        }
        vrstica(izbira, 4)
        fun polje(hint: Int, vrednost: String, vrsta: Int, najvec: Int) = EditText(a, null, 0, R.style.Gw_Field).apply {
            setHint(hint)
            setText(vrednost)
            inputType = vrsta
            filters = arrayOf(android.text.InputFilter.LengthFilter(najvec))
            // Slog polja jih sicer pusti nefokusirana (zaslon 22. 11. 2026); enako kot polja imena.
            isFocusable = true
            isFocusableInTouchMode = true
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        val mestoPolje = polje(R.string.parcel_other_hint, zacetno.navodilo, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, Paket.NAJVEC_ZNAKOV)
        vrstica(mestoPolje, 8)
        val doPolje = polje(R.string.parcel_until_hint, zacetno.doDne, InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_DATE, 10)
        vrstica(doPolje, 8)
        val shrani = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.parcel_save) }
        vrstica(shrani, 8)
        val stanje = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        vrstica(stanje, 6)

        fun izbranoMesto() = if (izbira.checkedRadioButtonId == drugo.id) Paket.MESTO_DRUGO else Paket.MESTO_PRED_HISO
        fun osvezi() {
            val drugoIzbrano = izbranoMesto() == Paket.MESTO_DRUGO
            izbira.isEnabled = vklop.isChecked
            predHiso.isEnabled = vklop.isChecked
            drugo.isEnabled = vklop.isChecked
            mestoPolje.isEnabled = vklop.isChecked && drugoIzbrano
            doPolje.isEnabled = vklop.isChecked
            shrani.isEnabled = vklop.isChecked
            val stavek = PaketDostave.odgovorZaKlic(a)
            stanje.text = when {
                !vklop.isChecked -> a.getString(R.string.parcel_off)
                stavek.isNotEmpty() -> a.getString(R.string.parcel_preview_fmt, stavek)
                // Brez datuma bi veljalo: datum »velja do« je mimo.
                Paket.aktivnoMesto(PaketDostave.preberi(a).copy(doDne = ""), Instant.now()).isNotEmpty() -> a.getString(R.string.parcel_expired)
                else -> a.getString(R.string.parcel_err_empty)
            }
        }
        // Stikalo in izbira mesta se shranita takoj (vedno veljavna); besedilo in datum z gumbom (preverba).
        vklop.setOnCheckedChangeListener { _, v -> PaketDostave.nastaviVklop(a, v); osvezi() }
        izbira.setOnCheckedChangeListener { _, _ -> PaketDostave.nastaviMesto(a, izbranoMesto()); osvezi() }
        shrani.setOnClickListener {
            val napaka = PaketDostave.shraniBesedilo(a, izbranoMesto(), mestoPolje.text.toString(), doPolje.text.toString())
            if (napaka != null) {
                stanje.text = a.getString(napaka)
                return@setOnClickListener
            }
            (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)?.hideSoftInputFromWindow(vsebnik.windowToken, 0)
            osvezi()
        }
        osvezi()
    }
}
