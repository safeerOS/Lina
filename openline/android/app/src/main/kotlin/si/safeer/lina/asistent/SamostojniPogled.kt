package si.safeer.lina.asistent

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.samostojna.Asistent
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.ustvariOdjemalca
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.Odgovor
import si.safeer.lina.samostojna.SistemskoNavodilo
import si.safeer.lina.samostojna.dodajZapisek
import si.safeer.lina.samostojna.izbrisiZapisek
import si.safeer.lina.samostojna.vidniZapiski
import java.time.LocalDate
import java.time.ZonedDateTime
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Samostojna asistentka v zavihku Asistent (lastnik 18. 11. 2026: mora delovati tudi brez racunalnika).
 * Pogovor je v pomnilniku (trajen zapis pogovora je naslednji sklop), zapiski in kljuc sta trajna na telefonu.
 */
class SamostojniPogled(private val a: Activity) {
    private val glavna = Handler(Looper.getMainLooper())
    private val nit = Executors.newSingleThreadExecutor()
    private val ponudnikShramba = PonudnikShramba(a)
    private var ponudnik = ponudnikShramba.beri()
    private var kljuci = KeystoreShranjevalnik(a, ponudnik)
    private val zapiski = ZapiskiShramba(a)
    private var asistent: Asistent? = null
    private var asistentDan: LocalDate? = null
    private var caka = false
    private val pogovor = StringBuilder()

    private val info: TextView = a.findViewById(R.id.assistantLocalInfo)
    private val kljucBlok: View = a.findViewById(R.id.assistantKeyBlock)
    private val kljucVnos: EditText = a.findViewById(R.id.assistantKeyInput)
    private val kljucShrani: Button = a.findViewById(R.id.assistantKeySave)
    private val klepetBlok: View = a.findViewById(R.id.assistantChatBlock)
    private val klepetDnevnik: TextView = a.findViewById(R.id.assistantChatLog)
    private val klepetVnos: EditText = a.findViewById(R.id.assistantChatInput)
    private val klepetPosli: Button = a.findViewById(R.id.assistantChatSend)
    private val zapisekNaslov: TextView = a.findViewById(R.id.assistantNotesTitle)
    private val zapiskiSeznam: LinearLayout = a.findViewById(R.id.assistantNotesList)
    private val kljucPozabi: Button = a.findViewById(R.id.assistantKeyForget)
    private val ponudnikVrstica: LinearLayout = a.findViewById(R.id.assistantProviderRow)

    init {
        kljucShrani.setOnClickListener { shraniKljuc() }
        klepetPosli.setOnClickListener { poslji() }
        kljucPozabi.setOnClickListener { kljuci.izbrisi(); asistent = null; pogovor.setLength(0); osvezi() }
        for (p in Ponudnik.entries) {
            ponudnikVrstica.addView(
                Button(a, null, 0, R.style.Gw_Button).apply { tag = p; setOnClickListener { izberiPonudnika(p) } },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
            )
        }
    }

    /** Vsak ponudnik ima svoj kljuc; menjava ne izbrise kljuca drugega ponudnika, pogovor pa se zacne znova (drug model). */
    private fun izberiPonudnika(p: Ponudnik) {
        if (p == ponudnik || caka) return
        ponudnik = p
        ponudnikShramba.shrani(p)
        kljuci = KeystoreShranjevalnik(a, p)
        asistent = null
        pogovor.setLength(0)
        kljucVnos.setText("")
        kljucVnos.error = null
        osvezi()
    }

    fun osvezi() {
        val imaKljuc = kljuci.preberi() != null
        info.text = a.getString(R.string.local_info)
        kljucVnos.hint = a.getString(R.string.local_key_hint_fmt, ponudnik.oznaka)
        for (i in 0 until ponudnikVrstica.childCount) {
            val b = ponudnikVrstica.getChildAt(i) as Button
            val p = b.tag as Ponudnik
            val izbran = p == ponudnik
            b.text = if (izbran) "\u2713 ${p.oznaka}" else p.oznaka
            b.isSelected = izbran
            b.alpha = if (izbran) 1f else 0.6f
            b.contentDescription = if (izbran) "${p.oznaka}, ${a.getString(R.string.local_provider_selected)}" else p.oznaka
            b.isEnabled = !caka
        }
        kljucBlok.visibility = if (imaKljuc) View.GONE else View.VISIBLE
        klepetBlok.visibility = if (imaKljuc) View.VISIBLE else View.GONE
        kljucPozabi.visibility = if (imaKljuc) View.VISIBLE else View.GONE
        klepetDnevnik.text = pogovor.toString()
        klepetDnevnik.visibility = if (pogovor.isEmpty()) View.GONE else View.VISIBLE
        klepetPosli.isEnabled = !caka
        osveziZapiske()
    }

    private fun osveziZapiske() {
        val vidni = vidniZapiski(zapiski.beri())
        zapisekNaslov.visibility = if (vidni.isEmpty()) View.GONE else View.VISIBLE
        zapiskiSeznam.removeAllViews()
        for (z in vidni) {
            val vrstica = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
            vrstica.addView(
                TextView(a).apply { text = z.besedilo; setTextIsSelectable(true); setTextAppearance(R.style.Gw_Body) },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
            )
            vrstica.addView(Button(a, null, 0, R.style.Gw_Button).apply {
                text = a.getString(R.string.local_note_delete)
                setOnClickListener { zapiski.shrani(izbrisiZapisek(zapiski.beri(), z.id, System.currentTimeMillis())); osveziZapiske() }
            })
            zapiskiSeznam.addView(vrstica)
        }
    }

    private fun shraniKljuc() {
        val k = kljucVnos.text.toString().trim()
        // Kljuci ponudnikov so brez presledkov in dolgi vsaj 20 znakov; vse drugo je napacen vnos.
        if (k.length < 20 || k.any { it.isWhitespace() }) { kljucVnos.error = a.getString(R.string.local_key_bad); return }
        kljuci.shrani(KljucGemini(k))
        kljucVnos.setText("")
        osvezi()
    }

    private fun trenutniAsistent(): Asistent {
        val zdaj = ZonedDateTime.now()
        val danes = zdaj.toLocalDate()
        val obstojeci = asistent
        if (obstojeci != null && asistentDan == danes) return obstojeci
        // Navodilo vsebuje cas, zato se ob novem dnevu pogovor zacne znova.
        return Asistent(ustvariOdjemalca(ponudnik, kljuci, AndroidPrenos()), SistemskoNavodilo.zgradi(zdaj)).also { asistent = it; asistentDan = danes }
    }

    private fun poslji() {
        val vnos = klepetVnos.text.toString().trim()
        if (vnos.isEmpty() || caka) return
        caka = true
        klepetVnos.setText("")
        (a.getSystemService(Activity.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(klepetVnos.windowToken, 0)
        dodajVrstico(a.getString(R.string.local_you), vnos)
        dodajVrstico(a.getString(R.string.local_lina), a.getString(R.string.local_thinking))
        osvezi()
        val asist = trenutniAsistent()
        nit.execute {
            val odgovor = try { asist.povej(vnos) } catch (e: Exception) { Odgovor.Napaka(e.javaClass.simpleName) }
            glavna.post {
                if (a.isFinishing) return@post
                odstraniZadnjo()
                val besedilo = when (odgovor) {
                    is Odgovor.Besedilo -> odgovor.besedilo
                    is Odgovor.Zapisek -> {
                        zapiski.shrani(dodajZapisek(zapiski.beri(), odgovor.besedilo, System.currentTimeMillis(), UUID.randomUUID().toString()))
                        a.getString(R.string.local_note_saved, odgovor.besedilo)
                    }
                    is Odgovor.Opomnik -> {
                        // Opomnikov ob casu ta aplikacija se ne sprozi: model ga ne bi smel napovedati, ce pa ga, ga shranimo kot zapisek s casom.
                        val tekst = "${odgovor.besedilo} (${odgovor.cas})"
                        zapiski.shrani(dodajZapisek(zapiski.beri(), tekst, System.currentTimeMillis(), UUID.randomUUID().toString()))
                        a.getString(R.string.local_note_saved, tekst)
                    }
                    is Odgovor.Napaka -> if (odgovor.sporocilo == "Brez povezave") a.getString(R.string.local_err_offline)
                        else a.getString(R.string.local_err_generic, odgovor.sporocilo)
                }
                dodajVrstico(a.getString(R.string.local_lina), besedilo)
                caka = false
                osvezi()
            }
        }
    }

    private fun dodajVrstico(kdo: String, besedilo: String) {
        if (pogovor.isNotEmpty()) pogovor.append("\n\n")
        pogovor.append(kdo).append(": ").append(besedilo)
    }

    private fun odstraniZadnjo() {
        val i = pogovor.lastIndexOf("\n\n")
        pogovor.setLength(if (i < 0) 0 else i)
    }
}
