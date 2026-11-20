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

    private class PrefsShramba(private val context: Context) : Shramba {
        private val prefs get() = context.getSharedPreferences("lina_sinhron", Context.MODE_PRIVATE)
        override fun preberi(): String? = prefs.getString("rev", null)
        override fun shrani(vsebina: String) { prefs.edit().putString("rev", vsebina).apply() }
    }

    /** Zazene izmenjavo v ozadju; [takoj] preskoci premor med zagoni (npr. po koncu klica). */
    fun zazeni(context: Context, takoj: Boolean = false) {
        val app = context.applicationContext
        val zdaj = System.currentTimeMillis()
        if (!takoj && zdaj - zadnjiZagon < NAJMANJ_MED_ZAGONI_MS) return
        if (!teka.compareAndSet(false, true)) return
        zadnjiZagon = zdaj
        Thread({
            try { runCatching { izvedi(app) } } finally { teka.set(false) }
        }, "lina-sinhron").start()
    }

    private fun medKlicem(context: Context): Boolean =
        runCatching { context.getSystemService(TelecomManager::class.java)?.isInCall == true }.getOrDefault(false)

    internal fun izvedi(context: Context): Boolean {
        val naslov = AsistentShramba.beri(context) ?: return false
        if (!smemSinhroniziratiDnevnik(medKlicem = medKlicem(context))) return false
        val id = runCatching { NapravaKljuc.id() }.getOrNull() ?: return false
        val pov = HttpPovezavaZLino(naslov)
        val pogovor = PogovorSkupni.dobi(context)
        try {
            return SinhronLine.izmenjaj(
                dnevnik = DnevnikKlicevSkupni.dobi(context),
                reviziji = PrefsShramba(context),
                pogovor = pogovor.vsa(),
                prejetPogovor = { pogovor.zlij(it) },
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
