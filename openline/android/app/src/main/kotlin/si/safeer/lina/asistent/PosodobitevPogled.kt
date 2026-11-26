package si.safeer.lina.asistent

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import si.safeer.lina.R
import si.safeer.lina.pokaziVarno
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NamestitevApk
import si.safeer.lina.podpis.PosodobitevGithub
import si.safeer.lina.podpis.PosodobitevGithub.IzidPriprave
import si.safeer.lina.podpis.PosodobitevGithub.RazlogPosodobitve
import si.safeer.lina.podpis.ZavrnitevApk
import java.io.File

/**
 * Nastavitve > Posodobitev (naloga 28): stikalo »Samodejno preveri posodobitve« (privzeto vklopljeno), stanje, »Preveri zdaj« in,
 * ko je na voljo novejsa Lina, opombe izdaje (golo besedilo) in gumb Posodobi. En dotik: prenos + podpis + vsota (PosodobitevGithub),
 * paket in podpisni certifikat = namescena Lina (NamestitevPaketa.preveriArhiv), versionCode izdaje in vecja od namescene, nato
 * seja PackageInstallerja; sistemsko okno potrditve je po Androidu obvezno. Isti kljuc = Android ohrani podatke in Keystore.
 * NEPREVERJENO na napravi (app se lokalno ne prevaja).
 */
class PosodobitevPogled(private val a: Activity, private val plosca: LinearLayout) {
    private val glavna = Handler(Looper.getMainLooper())
    private val mapa = File(a.cacheDir, "posodobitev")
    private fun dp(v: Int) = (v * a.resources.displayMetrics.density).toInt()
    private fun <T : View> dodaj(v: T, zgoraj: Int = 8): T = v.also {
        plosca.addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(zgoraj) })
    }

    private val stikalo = dodaj(Switch(a).apply { setTextAppearance(R.style.Gw_Body); setText(R.string.update_auto); minHeight = dp(48) }, 12)
    init { dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); setText(R.string.update_auto_note) }) }
    private val naslov = dodaj(TextView(a, null, 0, R.style.Gw_Heading).apply { visibility = View.GONE }, 12)
    private val opombe = dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Body); visibility = View.GONE; setTextIsSelectable(false) })
    private val posodobi = dodaj(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.update_button); visibility = View.GONE })
    private val stanje = dodaj(TextView(a).apply { setTextAppearance(R.style.Gw_Muted); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE })
    private val preveri = dodaj(Button(a, null, 0, R.style.Gw_Button).apply { setText(R.string.update_check_now) })

    init {
        stikalo.isChecked = PosodobitevLine.samodejno(a)
        stikalo.setOnCheckedChangeListener { _, v -> PosodobitevLine.nastaviSamodejno(a, v) }
        preveri.setOnClickListener { preveriZdaj() }
        posodobi.setOnClickListener { posodobi() }
        osvezi()
    }

    fun osvezi() {
        val i = PosodobitevLine.stanje(a).izdaja?.takeIf { it.versionCode > PosodobitevLine.namesceniCode(a) }
        naslov.visibility = if (i != null) View.VISIBLE else View.GONE
        posodobi.visibility = naslov.visibility
        opombe.visibility = if (i != null && i.opombe.isNotEmpty()) View.VISIBLE else View.GONE
        if (i != null) {
            naslov.text = a.getString(R.string.update_available, i.razlicica)
            // opombe so ze ociscene (PosodobitevGithub.ocistiOpombe); TextView brez povezav in HTML
            opombe.text = i.opombe
        }
    }

    private fun preveriZdaj() {
        preveri.isEnabled = false
        stanje.setText(R.string.update_checking)
        val ac = a.applicationContext
        Thread({
            val s = runCatching { PosodobitevLine.preveriZdaj(ac, true) }.getOrNull()
            glavna.post {
                if (a.isFinishing) return@post
                preveri.isEnabled = true
                stanje.text = a.getString(
                    when {
                        s == null || s.napak > 0 -> R.string.update_check_failed
                        s.izdaja == null -> R.string.update_none
                        else -> R.string.update_found
                    },
                )
                osvezi()
            }
        }, "lina-posodobitev").start()
    }

    private fun besedilo(r: RazlogPosodobitve): Int = when (r) {
        RazlogPosodobitve.PODPIS -> R.string.update_err_signature
        RazlogPosodobitve.VSOTA -> R.string.update_err_checksum
        RazlogPosodobitve.PRENOS -> R.string.update_err_download
        RazlogPosodobitve.RAZLICICA -> R.string.update_err_version
    }

    private fun posodobi() {
        val i = PosodobitevLine.stanje(a).izdaja?.takeIf { it.versionCode > PosodobitevLine.namesceniCode(a) } ?: return
        if (!NamestitevApk.zacetekPrenosa()) return
        if (!NamestitevPaketa.imaDovoljenje(a)) {
            NamestitevApk.konecPrenosa()
            AlertDialog.Builder(a, R.style.Gw_Dialog)
                .setTitle(R.string.update_button)
                .setMessage(R.string.install_perm_needed)
                .setPositiveButton(R.string.install_perm_open) { _, _ -> runCatching { NamestitevPaketa.odpriNastavitev(a) } }
                .setNegativeButton(android.R.string.cancel, null)
                .pokaziVarno()
            return
        }
        posodobi.isEnabled = false
        stanje.setText(R.string.install_downloading)
        Thread({
            var kopija: File? = null
            val sporocilo: String = try {
                when (val z = PosodobitevGithub.pripravi(PosodobitevGithub.HttpsHttp(), i, mapa, NalogaLine.nakljucno(32))) {
                    is IzidPriprave.Zavrnjeno -> a.getString(besedilo(z.razlog))
                    is IzidPriprave.Ok -> {
                        kopija = z.datoteka
                        glavna.post { stanje.setText(R.string.install_checking) }
                        val arhiv = NamestitevPaketa.preveriArhiv(a, z.datoteka)
                        val razlicica = PosodobitevGithub.preveriRazlicico(PosodobitevLine.codeArhiva(a, z.datoteka), z.versionCode, PosodobitevLine.namesceniCode(a))
                        when {
                            // drug podpisni kljuc: ne namesti (Android bi zahteval odstranitev Line = izguba nastavitev in kljucev)
                            arhiv == ZavrnitevApk.PODPIS -> a.getString(R.string.update_err_other_key)
                            arhiv != null -> a.getString(R.string.install_err_paket)
                            razlicica != null -> a.getString(besedilo(razlicica))
                            else -> {
                                NamestitevPaketa.namesti(a, z.datoteka)
                                a.getString(R.string.install_confirm_system)
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                a.getString(R.string.update_err_download)
            } finally {
                kopija?.let { NamestitevApk.pobrisi(it) }
                NamestitevApk.konecPrenosa()
            }
            glavna.post {
                if (a.isFinishing) return@post
                posodobi.isEnabled = true
                stanje.text = sporocilo
            }
        }, "lina-posodobitev").start()
    }
}
