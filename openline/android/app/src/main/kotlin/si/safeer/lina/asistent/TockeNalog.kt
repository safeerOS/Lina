package si.safeer.lina.asistent

import android.app.Activity
import android.content.Context
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R

/**
 * Stikalo »Točke naloge« (lastnik 24. 11. 2026: Lina je poslala 5 tock, narejena 1, nihce ni opazil; privzeto VKLOPLJENO):
 * Lina ostevilci tocke nacrta v nalogi za racunalnik, kartica »Agenti in naloge« pokaze »3/5 narejeno« in manjkajoce tocke.
 */
object TockeNalog {
    const val PREFS = "lina_naloge"
    const val KLJUC = "tocke"

    fun vklopljeno(c: Context): Boolean = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KLJUC, true)

    fun nastavi(c: Context, vklop: Boolean) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KLJUC, vklop).apply()
    }

    /** Stikalo in opomba v Nastavitvah, vstavljena v [vsebnik] na [mesto]; shrani se takoj (kot »Ime povej samo znanim«). */
    fun vstavi(a: Activity, vsebnik: LinearLayout, mesto: Int) {
        val dp = a.resources.displayMetrics.density
        fun lp(zgoraj: Int) = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = (zgoraj * dp).toInt() }
        vsebnik.addView(CheckBox(a).apply {
            setText(R.string.tasks_points_switch)
            setTextAppearance(R.style.Gw_Body)
            minimumHeight = (48 * dp).toInt()
            isChecked = vklopljeno(a)
            setOnCheckedChangeListener { _, vklop -> nastavi(a, vklop) }
        }, mesto, lp(16))
        vsebnik.addView(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.tasks_points_note) }, mesto + 1, lp(4))
    }
}
