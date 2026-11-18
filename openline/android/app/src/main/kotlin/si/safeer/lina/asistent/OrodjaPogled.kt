package si.safeer.lina.asistent

import android.app.Activity
import android.os.Handler
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.IzidOrodja
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.Prenos
import si.safeer.lina.samostojna.SpletnaOrodja
import java.util.concurrent.ExecutorService

/**
 * Vnos kljucev za spletno iskanje (Brave), branje strani (TinyFish) in racun Twilio v zavihku Asistent
 * (lastnik 18. 11. 2026: na telefonu so manjkali). Kljuc se shrani sele, ko ga storitev sprejme; v Keystore je samo
 * tajnopis, v zaslonu in dnevniku nikoli. Twilio se za zdaj samo preveri (klici in SMS prek Twilio niso vkljuceni).
 */
class OrodjaPogled(
    private val a: Activity,
    private val vsebnik: LinearLayout,
    private val prenos: Prenos,
    private val nit: ExecutorService,
    private val glavna: Handler,
    /** Poklicano, ko se kljuc doda ali odstrani (asistentka se ob naslednjem sporocilu zgradi znova). */
    private val obSpremembi: () -> Unit,
) {
    private val brave = KeystoreShranjevalnik(a, VrstaOrodja.BRAVE)
    private val tinyfish = KeystoreShranjevalnik(a, VrstaOrodja.TINYFISH)
    private val twilioZeton = KeystoreShranjevalnik(a, VrstaOrodja.TWILIO_ZETON)
    private val twilio = TwilioShramba(a)
    private val osveziVse = mutableListOf<() -> Unit>()

    fun orodja(): SpletnaOrodja =
        SpletnaOrodja(prenos, { brave.preberi()?.izpostavi() }, { tinyfish.preberi()?.izpostavi() })

    init {
        razdelek(
            naslov = R.string.tool_brave_title, opomba = R.string.tool_brave_note,
            polja = listOf(R.string.tool_brave_hint), skrita = listOf(true),
            povezan = { if (brave.preberi() != null) a.getString(R.string.tool_connected) else null },
            preveri = { SpletnaOrodja.preveriBrave(prenos, it[0]) },
            shrani = { v, _ -> brave.shrani(KljucGemini(v[0])) },
            pozabi = { brave.izbrisi() },
        )
        razdelek(
            naslov = R.string.tool_tinyfish_title, opomba = R.string.tool_tinyfish_note,
            polja = listOf(R.string.tool_tinyfish_hint), skrita = listOf(true),
            povezan = { if (tinyfish.preberi() != null) a.getString(R.string.tool_connected) else null },
            preveri = { SpletnaOrodja.preveriTinyFish(prenos, it[0]) },
            shrani = { v, _ -> tinyfish.shrani(KljucGemini(v[0])) },
            pozabi = { tinyfish.izbrisi() },
        )
        razdelek(
            naslov = R.string.tool_twilio_title, opomba = R.string.tool_twilio_note,
            polja = listOf(R.string.tool_twilio_sid_hint, R.string.tool_twilio_token_hint), skrita = listOf(false, true),
            povezan = {
                if (twilio.sid() != null && twilioZeton.preberi() != null)
                    twilio.ime()?.takeIf { it.isNotBlank() }?.let { a.getString(R.string.tool_twilio_connected_fmt, it) } ?: a.getString(R.string.tool_connected)
                else null
            },
            preveri = { SpletnaOrodja.preveriTwilio(prenos, it[0], it[1]) },
            shrani = { v, izid -> twilio.shrani(v[0], izid.besedilo); twilioZeton.shrani(KljucGemini(v[1])) },
            pozabi = { twilio.izbrisi(); twilioZeton.izbrisi() },
        )
        osvezi()
    }

    fun osvezi() = osveziVse.forEach { it() }

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    private fun razdelek(
        naslov: Int, opomba: Int, polja: List<Int>, skrita: List<Boolean>,
        povezan: () -> String?,
        preveri: (List<String>) -> IzidOrodja,
        shrani: (List<String>, IzidOrodja.Besedilo) -> Unit,
        pozabi: () -> Unit,
    ) {
        fun vrstica(v: View, zgoraj: Int) = vsebnik.addView(
            v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
        )
        val glava = TextView(a).apply { setTextAppearance(R.style.Gw_Body); setText(naslov); typeface = android.graphics.Typeface.DEFAULT_BOLD }
        vrstica(glava, 16)
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(opomba) }, 4)
        val vnosi = polja.mapIndexed { i, hint ->
            EditText(a, null, 0, R.style.Gw_Field).apply {
                setHint(hint)
                // 18. 11. 2026: z defStyleAttr 0 EditText ne dobi editTextStyle, zato ni bil fokusabilen z dotikom: tipkovnica se ni odprla
                // in lastnik kljucev ni mogel vpisati (fokus je ostal v polju klepeta). Dotik mora polje fokusirati.
                isFocusable = true
                isFocusableInTouchMode = true
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
                inputType = InputType.TYPE_CLASS_TEXT or (if (skrita[i]) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)
                filters = arrayOf(android.text.InputFilter.LengthFilter(200))
            }.also { vrstica(it, 8) }
        }
        val gumbShrani = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.tool_save) }
        vrstica(gumbShrani, 8)
        val stanje = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        vrstica(stanje, 8)
        val gumbPozabi = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.tool_forget) }
        vrstica(gumbPozabi, 8)

        var sporocilo: String? = null
        var caka = false
        fun narisi() {
            val p = povezan()
            vnosi.forEach { it.visibility = if (p == null) View.VISIBLE else View.GONE }
            gumbShrani.visibility = if (p == null) View.VISIBLE else View.GONE
            gumbShrani.isEnabled = !caka
            gumbPozabi.visibility = if (p != null) View.VISIBLE else View.GONE
            stanje.text = sporocilo ?: p ?: a.getString(R.string.tool_not_connected)
        }
        osveziVse.add(::narisi)

        gumbShrani.setOnClickListener {
            if (caka) return@setOnClickListener
            val v = vnosi.map { it.text.toString().trim() }
            if (v.any { it.isEmpty() }) { sporocilo = a.getString(R.string.tool_err_format); narisi(); return@setOnClickListener }
            caka = true; sporocilo = a.getString(R.string.tool_checking); narisi()
            nit.execute {
                val izid = try { preveri(v) } catch (e: Exception) { IzidOrodja.Napaka("omrezje") }
                glavna.post {
                    if (a.isFinishing) return@post
                    caka = false
                    when (izid) {
                        is IzidOrodja.Besedilo -> {
                            shrani(v, izid); vnosi.forEach { it.setText("") }; sporocilo = null; obSpremembi()
                            // Tipkovnica zakrije spodnjo navigacijo: po uspesnem shranjevanju se zapre, da je pot nazaj vidna.
                            vnosi.forEach { it.clearFocus() }
                            (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)
                                ?.hideSoftInputFromWindow(vsebnik.windowToken, 0)
                        }
                        is IzidOrodja.Napaka -> sporocilo = a.getString(
                            when (izid.razlog) {
                                "kljuc" -> R.string.tool_err_key
                                "oblika" -> R.string.tool_err_format
                                "meja" -> R.string.tool_err_limit
                                "racun" -> R.string.tool_err_account
                                else -> R.string.tool_err_net
                            },
                        )
                    }
                    narisi()
                }
            }
        }
        gumbPozabi.setOnClickListener { pozabi(); sporocilo = null; obSpremembi(); narisi() }
    }
}
