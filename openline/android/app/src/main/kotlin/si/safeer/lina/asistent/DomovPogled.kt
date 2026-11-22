package si.safeer.lina.asistent

import android.app.Activity
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
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
 * Zaslon Domov po skici Lina 2.0 (lastnik 22. 11. 2026): pozdrav z imenom, sest ploscic za funkcije, ki na telefonu
 * delujejo, danasnja obvestila iz lokalnega dnevnika klicev (deluje brez racunalnika) in vrstica »Vprasajte Lino«.
 */
class DomovPogled(private val a: Activity, private val odpri: (PloscaDomov) -> Unit, private val vprasaj: () -> Unit) {
    private val pozdrav: TextView = a.findViewById(R.id.homeGreeting)
    private val ploscice: LinearLayout = a.findViewById(R.id.homeTiles)
    private val seznam: LinearLayout = a.findViewById(R.id.homeNoticesList)
    private val znacke = mutableMapOf<PloscaDomov, TextView>()
    private val gumbi = mutableMapOf<PloscaDomov, View>()

    init {
        a.findViewById<Button>(R.id.homeNoticesAll).setOnClickListener { odpri(PloscaDomov.KLICI) }
        a.findViewById<Button>(R.id.homeAsk).setOnClickListener { vprasaj() }
        zgradiPloscice()
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), a.resources.displayMetrics).toInt()

    private fun opis(p: PloscaDomov): Triple<Int, Int, Int> = when (p) {
        PloscaDomov.POGOVOR -> Triple(R.drawable.ic_nav_lina, R.string.home_tile_chat, R.string.home_tile_chat_desc)
        PloscaDomov.KLICI -> Triple(R.drawable.ic_nav_calls, R.string.home_tile_calls, R.string.home_tile_calls_desc)
        PloscaDomov.ZAPISKI -> Triple(R.drawable.ic_notes, R.string.home_tile_notes, R.string.home_tile_notes_desc)
        PloscaDomov.PRIPRAVA -> Triple(R.drawable.ic_nav_phone, R.string.home_tile_setup, R.string.home_tile_setup_desc)
        PloscaDomov.RACUNALNIK -> Triple(R.drawable.ic_nav_computer, R.string.home_tile_computer, R.string.home_tile_computer_desc)
        PloscaDomov.NASTAVITVE -> Triple(R.drawable.ic_nav_settings, R.string.settings_title, R.string.home_tile_settings_desc)
    }

    private fun zgradiPloscice() {
        ploscice.removeAllViews()
        PloscaDomov.entries.chunked(3).forEachIndexed { vrsta, trojka ->
            val v = LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .apply { if (vrsta > 0) topMargin = dp(10) }
            }
            trojka.forEachIndexed { i, p -> v.addView(ploscica(p, i)) }
            ploscice.addView(v)
        }
    }

    private fun ploscica(p: PloscaDomov, stolpec: Int): View {
        val (ikona, naslov, podnaslov) = opis(p)
        val okvir = FrameLayout(a).apply {
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { if (stolpec > 0) marginStart = dp(10) }
        }
        val vsebina = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = a.getDrawable(R.drawable.bg_tile)
            setPadding(dp(8), dp(14), dp(8), dp(12))
            minimumHeight = dp(124)
            isClickable = true
            isFocusable = true
            setOnClickListener { odpri(p) }
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT)
        }
        vsebina.addView(ImageView(a).apply {
            setImageResource(ikona)
            background = a.getDrawable(R.drawable.bg_tile_icon)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
        })
        vsebina.addView(TextView(a, null, 0, R.style.Gw_Heading).apply {
            setText(naslov); gravity = Gravity.CENTER; maxLines = 1
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
        })
        vsebina.addView(TextView(a, null, 0, R.style.Gw_Muted).apply {
            setText(podnaslov); gravity = Gravity.CENTER; maxLines = 2; textSize = 12f
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(2) }
        })
        okvir.addView(vsebina)
        if (p == PloscaDomov.KLICI) {
            val znacka = TextView(a).apply {
                background = a.getDrawable(R.drawable.bg_badge)
                setTextColor(a.getColor(R.color.on_bad)); textSize = 12f; typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER; minWidth = dp(22); setPadding(dp(5), 0, dp(5), 0)
                visibility = View.GONE
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(22), Gravity.END or Gravity.TOP).apply { setMargins(0, dp(6), dp(6), 0) }
            }
            okvir.addView(znacka)
            znacke[p] = znacka
        }
        vsebina.contentDescription = a.getString(naslov) + ", " + a.getString(podnaslov)
        gumbi[p] = vsebina
        return okvir
    }

    /** Ob vsakem prikazu zavihka: pozdrav po uri in imenu, znacka in vrstice iz dnevnika klicev. */
    fun osvezi() {
        val zdaj = ZonedDateTime.now()
        val dan = a.getString(when (delDneva(zdaj.hour)) {
            DelDneva.JUTRO -> R.string.home_greet_morning
            DelDneva.DAN -> R.string.home_greet_day
            DelDneva.VECER -> R.string.home_greet_evening
        })
        val ime = ImeUporabnika.preberi(a).first.trim()
        pozdrav.text = (if (ime.isEmpty()) "$dan!" else "$dan, $ime!") + "\n" + a.getString(R.string.home_help)

        val zapisi = try { DnevnikKlicevSkupni.dobi(a).seznamPoDatumu() } catch (e: Exception) { emptyList() }
        val cona = ZoneId.systemDefault()
        val ms = System.currentTimeMillis()
        val n = steviloDanes(zapisi, ms, cona)
        znacke[PloscaDomov.KLICI]?.let { it.visibility = if (n > 0) View.VISIBLE else View.GONE; it.text = if (n > 99) "99+" else n.toString() }
        gumbi[PloscaDomov.KLICI]?.contentDescription = a.getString(R.string.home_tile_calls) + ", " + a.getString(R.string.home_tile_calls_desc) +
            (if (n > 0) ", " + a.getString(R.string.home_today_fmt, n) else "")

        seznam.removeAllViews()
        val vrstice = obvestilaDanes(zapisi, ms, cona)
        if (vrstice.isEmpty()) {
            seznam.addView(TextView(a, null, 0, R.style.Gw_Muted).apply { setText(R.string.home_notices_empty) })
            return
        }
        for (v in vrstice) {
            seznam.addView(LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(6), 0, dp(6))
                isClickable = true; isFocusable = true
                background = a.getDrawable(android.R.drawable.list_selector_background)
                setOnClickListener { odpri(PloscaDomov.KLICI) }
                addView(View(a).apply {
                    background = a.getDrawable(R.drawable.dot)
                    backgroundTintList = android.content.res.ColorStateList.valueOf(a.getColor(if (v.nujno) R.color.bad else R.color.accent))
                    layoutParams = LinearLayout.LayoutParams(dp(10), dp(10)).apply { marginEnd = dp(10) }
                })
                addView(TextView(a, null, 0, R.style.Gw_Body).apply {
                    text = v.ura
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(12) }
                })
                addView(TextView(a, null, 0, R.style.Gw_Body).apply {
                    text = if (v.sporocilo.isEmpty()) v.kdo else "${v.kdo}: ${v.sporocilo}"
                    maxLines = 2
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                contentDescription = listOf(v.ura, v.kdo, v.sporocilo, if (v.nujno) a.getString(R.string.home_urgent) else "")
                    .filter { it.isNotEmpty() }.joinToString(", ")
            })
        }
    }
}
