package si.safeer.lina.asistent

import android.app.Activity
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.DelDneva
import si.safeer.lina.samostojna.PloscaDomov
import si.safeer.lina.samostojna.delDneva
import si.safeer.lina.samostojna.obvestilaDanes
import si.safeer.lina.samostojna.steviloDanes
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Domov brez drsenja (prenova 22. 11. 2026, NAVODILA-SEJA-LINA-TELEFON-UI-2211.md, svet Duck.ai): pozdrav v eni vrstici, vrstica
 * stanja (klik odpre Pripravo), velik gumb »Pogovor z Lino«, kartica Danes (en klik do klicev, nujni z rdeco piko) in trije hitri
 * gumbi (Pogovor, Klici, Zapiski). Vse se racuna iz lokalnih podatkov, zato dela brez racunalnika.
 */
class DomovPogled(
    private val a: Activity,
    private val odpri: (PloscaDomov) -> Unit,
    private val vprasaj: () -> Unit,
    private val odpriPripravo: () -> Unit,
    /** Odpre mapo z datotekami klicev (lastnik 22. 11. 2026: gumb »Odpri mapo« mora biti na domaci strani). */
    private val odpriMapoKlicev: () -> Unit = {},
) {
    private val pozdrav: TextView = a.findViewById(R.id.homeGreeting)
    private val gumbi: LinearLayout = a.findViewById(R.id.homeTiles)
    private val seznam: LinearLayout = a.findViewById(R.id.homeNoticesList)
    private val stevec: TextView = a.findViewById(R.id.homeTodayCount)

    /**
     * Hitri gumbi na Domovu (en skupni gradnik); Racunalnik in Priprava nista glavna gumba. Brez »Pogovor«: Domov ima ze velik gumb
     * »Pogovor z Lino« (lastnik 22. 11. 2026: »zakaj je na domacem zaslonu 2 krat gumb pogovor«).
     */
    private val hitri = listOf(PloscaDomov.KLICI, PloscaDomov.POVZETEK, PloscaDomov.ZAPISKI)

    init {
        a.findViewById<Button>(R.id.homeChat).setOnClickListener { vprasaj() }
        a.findViewById<View>(R.id.homeToday).setOnClickListener { odpri(PloscaDomov.KLICI) }
        a.findViewById<View>(R.id.connectionRow).setOnClickListener { odpriPripravo() }
        a.findViewById<Button>(R.id.homeOpenFolder).setOnClickListener { odpriMapoKlicev() }
        zgradiGumbe()
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), a.resources.displayMetrics).toInt()

    private fun opis(p: PloscaDomov): Pair<Int, Int> = when (p) {
        PloscaDomov.POGOVOR -> R.drawable.ic_nav_lina to R.string.tab_chat
        PloscaDomov.KLICI -> R.drawable.ic_nav_calls to R.string.home_tile_calls
        PloscaDomov.POVZETEK -> R.drawable.ic_nav_lina to R.string.home_tile_summary
        PloscaDomov.ZAPISKI -> R.drawable.ic_notes to R.string.home_tile_notes
        PloscaDomov.PRIPRAVA -> R.drawable.ic_nav_phone to R.string.home_tile_setup
        PloscaDomov.RACUNALNIK -> R.drawable.ic_nav_computer to R.string.home_tile_computer
        PloscaDomov.NASTAVITVE -> R.drawable.ic_nav_settings to R.string.settings_title
    }

    private fun zgradiGumbe() {
        gumbi.removeAllViews()
        hitri.forEachIndexed { i, p ->
            val (ikona, naslov) = opis(p)
            gumbi.addView(Button(a, null, 0, R.style.Gw_Button).apply {
                setText(naslov)
                background = a.getDrawable(R.drawable.bg_tile)
                setCompoundDrawablesRelativeWithIntrinsicBounds(0, ikona, 0, 0)
                compoundDrawableTintList = android.content.res.ColorStateList.valueOf(a.getColor(R.color.accent))
                compoundDrawablePadding = dp(4)
                minHeight = dp(84)
                setPadding(dp(4), dp(12), dp(4), dp(10))
                maxLines = 1
                setOnClickListener { odpri(p) }
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { if (i > 0) marginStart = dp(12) }
            })
        }
    }

    /** Ob vsakem prikazu Domova: pozdrav po uri in imenu, stevilo in do dve vrstici danasnjih klicev. */
    fun osvezi() {
        val zdaj = ZonedDateTime.now()
        val dan = a.getString(when (delDneva(zdaj.hour)) {
            DelDneva.JUTRO -> R.string.home_greet_morning
            DelDneva.DAN -> R.string.home_greet_day
            DelDneva.VECER -> R.string.home_greet_evening
        })
        val ime = ImeUporabnika.preberi(a).first.trim()
        pozdrav.text = if (ime.isEmpty()) "$dan!" else "$dan, $ime!"

        val zapisi = try { DnevnikKlicevSkupni.dobi(a).seznamPoDatumu() } catch (e: Exception) { emptyList() }
        val cona = ZoneId.systemDefault()
        val ms = System.currentTimeMillis()
        val n = steviloDanes(zapisi, ms, cona)
        stevec.text = if (n > 0) a.getString(R.string.home_today_fmt, n) else ""
        seznam.removeAllViews()
        // Kartica je visoka najvec za dve vrstici: Domov se ne sme drsati (preostanek je v zavihku Klici).
        val vrstice = obvestilaDanes(zapisi, ms, cona, najvec = 2, najvecZnakov = 48)
        if (vrstice.isEmpty()) {
            seznam.addView(TextView(a, null, 0, R.style.Gw_Muted).apply { setText(R.string.home_calls_none) })
            return
        }
        for (v in vrstice) {
            seznam.addView(LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(4), 0, dp(4))
                addView(View(a).apply {
                    background = a.getDrawable(R.drawable.dot)
                    backgroundTintList = android.content.res.ColorStateList.valueOf(a.getColor(if (v.nujno) R.color.bad else R.color.accent))
                    layoutParams = LinearLayout.LayoutParams(dp(10), dp(10)).apply { marginEnd = dp(10) }
                })
                addView(TextView(a, null, 0, R.style.Gw_Body).apply {
                    text = v.ura
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(10) }
                })
                addView(TextView(a, null, 0, R.style.Gw_Body).apply {
                    text = if (v.sporocilo.isEmpty()) v.kdo else "${v.kdo}: ${v.sporocilo}"
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                contentDescription = listOf(v.ura, v.kdo, v.sporocilo, if (v.nujno) a.getString(R.string.home_urgent) else "")
                    .filter { it.isNotEmpty() }.joinToString(", ")
            })
        }
    }
}
