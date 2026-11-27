package si.safeer.lina.asistent

import android.content.Context
import android.telecom.TelecomManager
import org.json.JSONObject
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.OdgovorLine
import si.safeer.lina.samostojna.PogovorShramba
import si.safeer.lina.samostojna.Shramba
import si.safeer.lina.samostojna.SinhronLine
import si.safeer.lina.samostojna.SpominPogovorov
import si.safeer.lina.samostojna.smemSinhroniziratiDnevnik
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Sinhronizacija telefona z Lino na racunalniku (lastnik 20. 11. 2026): zapisi klicev gredo na racunalnik, klici z racunalnika na
 * telefon; vse podpisano s kljucem naprave (POST /sinhron). Samo domace omrezje (racunalnik poti ne pusti prek oddaljene poti).
 * Nikoli med klicem; zagon je poceni (ena izmenjava) in vedno v ozadju. Brez seznanjenega racunalnika ne naredi nicesar.
 */
object SinhronizacijaZLino {
    private const val NAJMANJ_MED_ZAGONI_MS = 30_000L
    private val teka = AtomicBoolean(false)
    @Volatile private var zadnjiZagon = 0L

    /** Naloga 34: revizija izmenjave je PO RACUNALNIKU (vsak racunalnik ima svoje stanje; skupna bi drugemu izpustila zapise). */
    private class PrefsShramba(private val context: Context, odtis: String) : Shramba {
        private val kljuc = "rev_$odtis"
        private val prefs get() = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)
        override fun preberi(): String? = prefs.getString(kljuc, null)
        override fun shrani(vsebina: String) { prefs.edit().putString(kljuc, vsebina).apply() }
    }

    private const val SHRAMBA = "lina_sinhron"

    /** Prehod (naloga 34): revizija edinega racunalnika pred seznamom postane revizija prvega clana (izmenjava se ne ponovi od zacetka). */
    fun prenesiRevizijo(context: Context, odtis: String) {
        val p = context.getSharedPreferences(SHRAMBA, Context.MODE_PRIVATE)
        val star = p.getString("rev", null) ?: return
        if (p.getString("rev_$odtis", null) == null) p.edit().putString("rev_$odtis", star).commit()
    }

    /** Zazene izmenjavo v ozadju; [takoj] preskoci premor med zagoni (npr. po koncu klica). */
    fun zazeni(context: Context, takoj: Boolean = false) {
        val app = context.applicationContext
        val zdaj = System.currentTimeMillis()
        if (!takoj && zdaj - zadnjiZagon < NAJMANJ_MED_ZAGONI_MS) return
        if (!teka.compareAndSet(false, true)) return
        zadnjiZagon = zdaj
        Thread({
            // NALOGA-35: kljuci za mozgane ob istih sprozilcih (odprtje, odgovor, konec klica); doma ali prek Global Linka
            try { runCatching { izvedi(app) }; runCatching { UskladitevKljucev.izvedi(app) } } finally { teka.set(false) }
        }, "lina-sinhron").start()
    }

    private fun medKlicem(context: Context): Boolean =
        runCatching { context.getSystemService(TelecomManager::class.java)?.isInCall == true }.getOrDefault(false)

    /**
     * Naloga 34 (slepi pregled 34): zapisi klicev in pogovor se izmenjajo z ENIM racunalnikom - glavnim (prvi seznanjeni, pri prehodu
     * dosedanji). Vrsta neposlanih zapisov in izbrisov je skupna (DnevnikKlicev.potrdiPoslane): ce bi jo izpraznil prvi racunalnik,
     * drugi zapisov ne bi dobil nikoli, pogovor z enega pa bi sel na drugega. Izmenjava z vec racunalniki: v kodi se ni (vrsta po racunalniku).
     */
    internal fun izvedi(context: Context): Boolean {
        val r = AsistentShramba.seznam(context).racunalniki.firstOrNull() ?: return false
        val naslov = si.safeer.lina.seznanitev.AsistentQr.naslov(r.naslov, r.vrata, r.odtis) ?: return false
        return izvediZ(context, naslov)
    }

    private fun izvediZ(context: Context, naslov: si.safeer.lina.seznanitev.AsistentNaslov): Boolean {
        if (!smemSinhroniziratiDnevnik(medKlicem = medKlicem(context))) return false
        val id = runCatching { NapravaKljuc.id() }.getOrNull() ?: return false
        val pov = HttpPovezavaZLino(naslov)
        val pogovor = PogovorSkupni.dobi(context)
        try {
            return SinhronLine.izmenjaj(
                dnevnik = DnevnikKlicevSkupni.dobi(context),
                reviziji = PrefsShramba(context, naslov.odtis),
                pogovor = pogovor.vsa(),
                prejetPogovor = { prejeta ->
                    // Nova sporocila z racunalnika gredo tudi v spomin telefona (brez podvajanja; lastna so ze zapisana).
                    val nova = pogovor.zlijInVrni(prejeta)
                    runCatching {
                        SpominPogovorovPogled.spomin(context).zapisiUvozene(nova.mapNotNull { p ->
                            val cas = runCatching { java.time.Instant.parse(p.cas).toEpochMilli() }.getOrNull() ?: return@mapNotNull null
                            SpominPogovorov.Obrat(cas, if (p.vloga == "lina") "lina" else "uporabnik", p.besedilo)
                        })
                    }
                },
                poslji = { vsebina ->
                    val cas = System.currentTimeMillis()
                    val enkratni = NalogaLine.nakljucno(32)
                    val podpis = runCatching { NapravaKljuc.podpisiSinhron(vsebina, cas, enkratni) }.getOrNull()
                    if (podpis == null) null else {
                        val telo = JSONObject().put("posiljatelj", id).put("vsebina", vsebina).put("cas", cas)
                            .put("enkratni", enkratni).put("podpis", podpis).toString()
                        (pov.sinhron(telo) as? OdgovorLine.Ok)?.telo
                    }
                },
            )
        } finally {
            pov.zapri()
        }
    }
}
