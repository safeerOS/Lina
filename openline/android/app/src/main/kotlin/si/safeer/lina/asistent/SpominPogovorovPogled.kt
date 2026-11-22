package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.SpominPogovorov
import java.io.File

/**
 * Razdelek »Lina si zapomni pogovore« v nastavitvah asistentke (lastnik 22. 11. 2026: privzeto vklopljeno, brez potrjevanja,
 * dela brez racunalnika). Stikalo za izklop in »Izbriši vse« s potrditvijo. Spomin je v zasebni mapi aplikacije.
 */
class SpominPogovorovPogled(private val a: Activity, private val vsebnik: LinearLayout, zacetek: Int) {
    companion object {
        @Volatile private var edini: SpominPogovorov? = null
        fun spomin(c: Context): SpominPogovorov =
            edini ?: synchronized(this) { edini ?: SpominPogovorov(File(c.applicationContext.filesDir, "spomin")).also { edini = it } }
    }

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    init {
        val s = spomin(a)
        var mesto = zacetek
        fun vrstica(v: View, zgoraj: Int) = vsebnik.addView(
            v, mesto++, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
        )
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Heading); setText(R.string.memory_heading) }, 16)
        // Besedilo stikala v slogu aplikacije (zaslon 22. 11. 2026: privzeta barva je bila temna na temnem).
        val stikalo = CheckBox(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.memory_title); isChecked = s.vklopljen() }
        vrstica(stikalo, 8)
        vrstica(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.memory_note) }, 4)
        val stanje = TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val brisi = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.memory_delete) }
        vrstica(brisi, 8)
        vrstica(stanje, 4)
        stikalo.setOnCheckedChangeListener { _, vklop -> s.nastavi(vklop) }
        brisi.setOnClickListener {
            AlertDialog.Builder(a).setMessage(R.string.memory_delete_confirm)
                .setPositiveButton(R.string.memory_delete) { _, _ -> stanje.setText(if (s.izbrisiVse()) R.string.memory_deleted else R.string.tool_err_net) }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
    }
}
