package si.safeer.lina.asistent

import android.content.Context
import org.json.JSONObject
import si.safeer.lina.podpis.NalogaLine
import si.safeer.lina.podpis.NapravaKljuc
import si.safeer.lina.podpis.OdgovorLine
import si.safeer.lina.samostojna.KljucGemini
import si.safeer.lina.samostojna.KljuciMozganov
import si.safeer.lina.samostojna.Ponudnik
import si.safeer.lina.samostojna.PrenosPoPoti
import si.safeer.lina.samostojna.ShrambaUskladitve
import si.safeer.lina.samostojna.SinhronKljucev
import si.safeer.lina.samostojna.SlotiKljucev
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Kljuci za mozgane na vseh seznanjenih napravah (NALOGA-35) na telefonu: stanje uskladitve je en AES-GCM zapis v AndroidKeyStore
 * (KeystoreShranjevalnik.zaKljuceMozganov), sloti so obstojeca mesta kljucev ponudnikov (Keystore). Izmenjava z Lino na racunalniku
 * po POST /kljuci s podpisom naprave; doma ali prek Global Linka (IzbirnaPovezava). Logika je v modulu samostojna (SinhronKljucev).
 */
object UskladitevKljucev {
    private val teka = AtomicBoolean(false)
    private val cakajo = java.util.concurrent.ConcurrentLinkedQueue<() -> Unit>()

    fun shramba(context: Context): ShrambaUskladitve {
        val k = KeystoreShranjevalnik.zaKljuceMozganov(context.applicationContext)
        return ShrambaUskladitve(k) { k.imaZapis() }
    }

    /** Vrednost in »neberljiv« iz ISTEGA branja slota (sicer bi prehodna napaka Keystore med dvema branjema postala izbris). */
    fun sloti(context: Context): SlotiKljucev = object : SlotiKljucev {
        private val c = context.applicationContext
        @Volatile private var zadnjiNeznani: Set<String>? = null
        override fun preberi(): Map<String, String> {
            val vrednosti = HashMap<String, String>()
            val neznani = HashSet<String>()
            for (id in KljuciMozganov.PONUDNIKI) {
                val s = SkupniKljuci.shrambaZaPonudnika(c, Ponudnik.izId(id))
                val v = s.preberi()?.izpostavi()
                if (v != null) vrednosti[id] = v else if ((s as? KeystoreShranjevalnik)?.imaZapis() == true) neznani.add(id)
            }
            zadnjiNeznani = neznani
            return vrednosti
        }
        override fun neznani(): Set<String> = zadnjiNeznani ?: preberi().let { zadnjiNeznani.orEmpty() }
        override fun zapisi(ponudnik: String, vrednost: String?) {
            val s = SkupniKljuci.shrambaZaPonudnika(c, Ponudnik.izId(ponudnik))
            if (vrednost == null) s.izbrisi() else s.shrani(KljucGemini(vrednost))
        }
    }

    /** V ozadju; ob tekoci izmenjavi ne zacne druge, [poKoncu] pa se izvede ob koncu tekoce (seznam se osvezi). */
    fun zazeni(context: Context, poKoncu: (() -> Unit)? = null) {
        val app = context.applicationContext
        poKoncu?.let(cakajo::add)
        if (!teka.compareAndSet(false, true)) return
        Thread({
            try { runCatching { izvedi(app) } } finally {
                teka.set(false)
                while (true) (cakajo.poll() ?: break).let { runCatching { it() } }
            }
        }, "lina-kljuci").start()
    }

    internal fun izvedi(context: Context): Boolean {
        if (AsistentShramba.beri(context) == null) return false
        val id = runCatching { NapravaKljuc.id() }.getOrNull() ?: return false
        val pov = PovezavaLine.ustvari(context, PrenosPoPoti()) ?: return false
        try {
            return SinhronKljucev.izmenjaj(shramba(context), sloti(context), id, System::currentTimeMillis) { vsebina ->
                val cas = System.currentTimeMillis()
                val enkratni = NalogaLine.nakljucno(32)
                val podpis = runCatching { NapravaKljuc.podpisiKljuce(vsebina, cas, enkratni) }.getOrNull()
                if (podpis == null) null else {
                    val telo = JSONObject().put("posiljatelj", id).put("vsebina", vsebina).put("cas", cas)
                        .put("enkratni", enkratni).put("podpis", podpis).toString()
                    (pov.kljuci(telo) as? OdgovorLine.Ok)?.telo
                }
            }
        } finally {
            pov.zapri()
        }
    }
}
