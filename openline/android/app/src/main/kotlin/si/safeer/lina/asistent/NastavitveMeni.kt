package si.safeer.lina.asistent

import android.app.Activity
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R

/**
 * Nastavitve s podmeniji (lastnik 22. 11. 2026: »tudi na telefonu morejo imeti nastavitve več podmenijev, da olajša uporabniku
 * brskanje«). Obstojeci razdelki zavihka Nastavitve se ob zagonu razdelijo v skupine; zacetni zaslon je seznam podmenijev,
 * izbran podmeni pokaze samo svojo skupino z vrstico »‹ Nastavitve«. Pogledi ostanejo isti (NastavitveKljuciPogled in ostali
 * jih se naprej upravljajo), samo prestavijo se v svoje plosce.
 */
class NastavitveMeni(private val a: Activity, private val odpriPripravo: () -> Unit, private val odpriRacunalnik: () -> Unit) {
    enum class Podmeni { IME, MOZGANI, SPOMIN, ORODJA, KLICI, ZAPISKI }

    private val koren: LinearLayout = a.findViewById(R.id.tabSettings)
    private val meni = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val plosce = mutableMapOf<Podmeni, LinearLayout>()
    private var odprt: Podmeni? = null

    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()

    init {
        val klici = koren.getChildAt(0)
        val zapiski: View = a.findViewById(R.id.notesStoragePanel)
        val asist: LinearLayout = a.findViewById(R.id.assistantSetupPanel)
        val otroci = (0 until asist.childCount).map { asist.getChildAt(it) }
        val iGoogle = otroci.indexOf(a.findViewById<View>(R.id.assistantGoogleBlock))
        val iOrodja = otroci.indexOf(a.findViewById<View>(R.id.assistantToolsTitle))
        val iPozabi = otroci.indexOf(a.findViewById<View>(R.id.assistantKeyForget))
        val naslovSpomina = a.getString(R.string.memory_heading)
        val iSpomin = otroci.indexOfFirst { (it as? TextView)?.text?.toString() == naslovSpomina }.takeIf { it in (iGoogle + 1) until iOrodja } ?: iOrodja
        // Gumb »Nazaj na asistentko« ni vec potreben: vrstica »‹ Nastavitve« in spodnja vrstica.
        a.findViewById<View>(R.id.assistantBackToAssistant).visibility = View.GONE

        val skupine = linkedMapOf(
            Podmeni.IME to otroci.subList(iGoogle + 1, iSpomin),
            Podmeni.MOZGANI to otroci.subList(0, iGoogle + 1) + listOf(otroci[iPozabi]),
            Podmeni.SPOMIN to otroci.subList(iSpomin, iOrodja),
            Podmeni.ORODJA to otroci.subList(iOrodja, iPozabi),
        )
        for ((p, pogledi) in skupine) {
            val plosca = novaPlosca(p)
            for (v in pogledi) { asist.removeView(v); plosca.addView(v) }
        }
        // Celotni plosci Klici in Zapiski ostaneta, kot sta (sta ze svoji plosci), samo zavijeta z vrstico nazaj.
        for ((p, v) in listOf(Podmeni.KLICI to klici, Podmeni.ZAPISKI to zapiski)) {
            koren.removeView(v)
            val plosca = novaPlosca(p, okvir = false)
            plosca.addView(v)
        }
        koren.removeView(asist)
        zgradiMeni()
        koren.addView(meni, 0)
        for (p in Podmeni.entries) plosce[p]?.let { koren.addView(it) }
        pokaziMeni()
    }

    private fun novaPlosca(p: Podmeni, okvir: Boolean = true): LinearLayout {
        val plosca = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            if (okvir) { background = a.getDrawable(R.drawable.bg_panel); setPadding(dp(18), dp(8), dp(18), dp(18)) }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
        }
        plosce[p] = plosca
        val zunanja = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        zunanja.addView(TextView(a, null, 0, R.style.Gw_Heading).apply {
            text = "‹ " + a.getString(R.string.settings_title)
            minHeight = dp(48)
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true; isFocusable = true
            background = a.getDrawable(android.R.drawable.list_selector_background)
            setOnClickListener { pokaziMeni() }
        })
        // Plosca je v zunanji, da je vrstica nazaj nad okvirjem; v korenu je zunanja.
        plosce[p] = zunanja.also { it.addView(plosca) }
        return plosca
    }

    private fun naslovInOpis(p: Podmeni): Pair<Int, Int> = when (p) {
        Podmeni.IME -> R.string.set_menu_name to R.string.set_menu_name_desc
        Podmeni.MOZGANI -> R.string.set_menu_brain to R.string.set_menu_brain_desc
        Podmeni.SPOMIN -> R.string.set_menu_memory to R.string.set_menu_memory_desc
        Podmeni.ORODJA -> R.string.set_menu_tools to R.string.set_menu_tools_desc
        Podmeni.KLICI -> R.string.set_menu_calls to R.string.set_menu_calls_desc
        Podmeni.ZAPISKI -> R.string.set_menu_notes to R.string.set_menu_notes_desc
    }

    private fun vrstica(naslov: Int, opis: Int, klik: () -> Unit): View = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(64)
        setPadding(dp(16), dp(10), dp(12), dp(10))
        background = a.getDrawable(R.drawable.bg_tile)
        isClickable = true; isFocusable = true
        setOnClickListener { klik() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
        val besedila = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        besedila.addView(TextView(a, null, 0, R.style.Gw_Heading).apply { setText(naslov) })
        besedila.addView(TextView(a, null, 0, R.style.Gw_Muted).apply { setText(opis) })
        addView(besedila, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(TextView(a, null, 0, R.style.Gw_Muted).apply { text = "›"; textSize = 24f; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO })
        contentDescription = a.getString(naslov) + ", " + a.getString(opis)
    }

    private fun zgradiMeni() {
        meni.addView(TextView(a, null, 0, R.style.Gw_Title).apply { setText(R.string.settings_title); accessibilityHeading = true })
        for (p in Podmeni.entries) {
            val (n, o) = naslovInOpis(p)
            meni.addView(vrstica(n, o) { odpri(p) })
        }
        meni.addView(vrstica(R.string.set_menu_setup, R.string.set_menu_setup_desc) { odpriPripravo() })
        meni.addView(vrstica(R.string.set_menu_computer, R.string.set_menu_computer_desc) { odpriRacunalnik() })
    }

    fun pokaziMeni() {
        odprt = null
        meni.visibility = View.VISIBLE
        for (v in plosce.values) v.visibility = View.GONE
        koren.rootView.findViewById<View>(R.id.root)?.scrollTo(0, 0)
    }

    fun odpri(p: Podmeni) {
        odprt = p
        meni.visibility = View.GONE
        for ((k, v) in plosce) v.visibility = if (k == p) View.VISIBLE else View.GONE
        koren.rootView.findViewById<View>(R.id.root)?.scrollTo(0, 0)
    }

    /** Sistemski gumb Nazaj v podmeniju vrne na seznam podmenijev; vrne true, ce je bil obdelan. */
    fun nazaj(): Boolean {
        if (odprt == null) return false
        pokaziMeni()
        return true
    }
}
