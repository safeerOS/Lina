package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.pokaziVarno
import si.safeer.lina.samostojna.Racunalnik

/**
 * Naloga 34, zahteva 5: zavihek Racunalnik > »Moji racunalniki« - vsak seznanjen racunalnik s stanjem (dosegljiv, obremenitev,
 * tece naloga), preimenuj, izkljuci iz razdelitve, odstrani posamezno; stikalo samodejne razdelitve. Med tekoco nalogo se izbira ne
 * menja tekoce naloge (AsistentKontroler.ciljNaloge). Dodajanje: isti gumbi seznanitve kot prej (QR ali koda) - nova seznanitev ne prepise stare.
 */
class RacunalnikiPogled(private val a: Activity, private val kontroler: () -> AsistentKontroler?, private val poSpremembi: () -> Unit) {
    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    val koren = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
    private val seznam = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val samodejno = Button(a, null, 0, R.style.Gw_Button)

    private fun dodaj(v: View, zgoraj: Int, kam: LinearLayout = koren) = kam.addView(
        v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
    )

    init {
        dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Heading); setText(R.string.computers_title); isAccessibilityHeading = true }, 16)
        dodaj(samodejno, 8)
        dodaj(seznam, 4)
        samodejno.setOnClickListener { spremeni { AsistentShramba.samodejno(a, !AsistentShramba.seznam(a).samodejno) } }
    }

    /** Izbira v zavihku ne vpliva na tekoco nalogo (AsistentKontroler.ciljNaloge), zato je dovoljena vedno. */
    private fun spremeni(delo: () -> Unit) { delo(); poSpremembi() }

    private fun stanje(r: Racunalnik, izbran: Boolean): String {
        val k = kontroler()
        val deli = ArrayList<String>()
        if (izbran) deli += a.getString(R.string.computer_selected)
        if (r.prepovedan) deli += a.getString(R.string.computer_excluded)
        // meritev, starejsa od 2 min, ne velja (slepi pregled 34: sicer ure kaze staro »dosegljiv«)
        val m = k?.obremenitve?.get(r.odtis)?.takeIf { System.currentTimeMillis() - it.second < 120_000L }?.first
        when {
            m == null -> deli += a.getString(R.string.computer_unmeasured)
            !m.dosegljiv -> deli += a.getString(R.string.computer_unreachable)
            else -> {
                deli += a.getString(R.string.computer_reachable)
                val nj = m.o?.naJedro()
                val mb = m.o?.prostMb
                if (nj != null && mb != null) deli += a.getString(R.string.computer_load, String.format(java.util.Locale.getDefault(), "%.2f", nj), mb.toInt())
            }
        }
        if (k != null && k.zaseden() && k.ciljNaloge == r.odtis) deli += a.getString(R.string.computer_task_running)
        return deli.joinToString(" · ")
    }

    fun osvezi() {
        val s = AsistentShramba.seznam(a)
        koren.visibility = if (s.racunalniki.isEmpty()) View.GONE else View.VISIBLE
        samodejno.setText(if (s.samodejno) R.string.computers_auto_on else R.string.computers_auto_off)
        samodejno.visibility = if (s.racunalniki.size > 1) View.VISIBLE else View.GONE
        seznam.removeAllViews()
        val izbran = s.izbrani()?.odtis
        for (r in s.racunalniki) {
            dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Body); text = r.ime }, 12, seznam)
            dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); text = stanje(r, r.odtis == izbran) }, 2, seznam)
            val gumbi = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
            fun gumb(besedilo: Int, delo: () -> Unit) = gumbi.addView(Button(a, null, 0, R.style.Gw_Button).apply {
                setText(besedilo); contentDescription = a.getString(besedilo) + ": " + r.ime; setOnClickListener { delo() }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
            if (s.racunalniki.size > 1) gumb(R.string.computer_use_only) { spremeni { AsistentShramba.izberi(a, r.odtis); AsistentShramba.samodejno(a, false) } }
            gumb(R.string.computer_rename) { preimenuj(r) }
            if (s.racunalniki.size > 1) gumb(if (r.prepovedan) R.string.computer_include else R.string.computer_exclude) { spremeni { AsistentShramba.prepovej(a, r.odtis, !r.prepovedan) } }
            gumb(R.string.computer_remove) { odstrani(r) }
            dodaj(android.widget.HorizontalScrollView(a).apply { addView(gumbi) }, 4, seznam)
        }
    }

    private fun preimenuj(r: Racunalnik) {
        val vnos = EditText(a).apply { setText(r.ime); filters = arrayOf(android.text.InputFilter.LengthFilter(60)) }
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setTitle(a.getString(R.string.computer_rename))
            .setView(vnos)
            .setPositiveButton(a.getString(R.string.computer_rename)) { _, _ -> AsistentShramba.preimenuj(a, r.odtis, vnos.text.toString()); poSpremembi() }
            .setNegativeButton(a.getString(R.string.pair_cancel), null)
            .pokaziVarno()
    }

    private fun odstrani(r: Racunalnik) {
        AlertDialog.Builder(a, R.style.Gw_Dialog)
            .setMessage(a.getString(R.string.computer_remove_confirm, r.ime))
            .setPositiveButton(a.getString(R.string.computer_remove)) { _, _ -> spremeni { AsistentShramba.odstrani(a, r.odtis) } }
            .setNegativeButton(a.getString(R.string.pair_cancel), null)
            .pokaziVarno()
    }
}
