package si.safeer.lina.asistent

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.soglasja.VrstaDejanja

/**
 * Nastavitve > Dovoljenja (24. 11. 2026): stikalo »Sistemski nadzor telefona« (privzeto vklopljeno) in seznam trajnih
 * potrditev (»Velja tudi za vse podobne«) s preklicem vsake posebej ali vseh. Preklicana vrsta spet vprasa ob naslednjem dejanju.
 */
class DovoljenjaPogled(private val a: Activity) {
    private val sistem = SistemskiNadzorAndroid(a)
    private val soglasja = SistemskiNadzorAndroid.soglasja(a)
    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    val koren = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val seznam = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val prekliciVse = Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.consent_revoke_all) }

    private fun dodaj(v: View, zgoraj: Int, kam: LinearLayout = koren) = kam.addView(
        v, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) },
    )

    init {
        dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Heading); setText(R.string.sys_heading); isAccessibilityHeading = true }, 8)
        val stikalo = CheckBox(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.sys_switch); isChecked = sistem.vklopljen() }
        stikalo.setOnCheckedChangeListener { _, vklop -> sistem.nastavi(vklop) }
        dodaj(stikalo, 8)
        dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.sys_switch_note) }, 4)
        dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Heading); setText(R.string.consent_heading); isAccessibilityHeading = true }, 20)
        dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.consent_note) }, 4)
        dodaj(seznam, 8)
        prekliciVse.setOnClickListener { soglasja.odstraniVsa(); osvezi() }
        dodaj(prekliciVse, 12)
        osvezi()
    }

    private fun ime(v: VrstaDejanja): String = when (v) {
        VrstaDejanja.NASTAVI_BUDILKO -> a.getString(R.string.consent_kind_alarm)
        else -> v.name.lowercase().replace('_', ' ')
    }

    fun osvezi() {
        seznam.removeAllViews()
        val vse = soglasja.seznam()
        if (vse.isEmpty()) dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.consent_none) }, 0, seznam)
        for (vrsta in vse.map { it.vrsta }.distinct()) {
            val vrstica = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(48) }
            vrstica.addView(TextView(a).apply { setTextAppearance(R.style.Gw_Body); text = ime(vrsta) }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            vrstica.addView(Button(a, null, 0, R.style.Gw_Button).apply {
                setText(R.string.consent_revoke)
                contentDescription = a.getString(R.string.consent_revoke) + ": " + ime(vrsta)
                setOnClickListener { soglasja.odstrani(vrsta); osvezi() }
            })
            dodaj(vrstica, 4, seznam)
        }
        prekliciVse.visibility = if (vse.isEmpty()) View.GONE else View.VISIBLE
    }
}
