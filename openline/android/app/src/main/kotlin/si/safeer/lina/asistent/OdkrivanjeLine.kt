package si.safeer.lina.asistent

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import si.safeer.lina.seznanitev.KodaLine

/**
 * DNS-SD v domacem omrezju (dogovor 14. 11. 2026, po vzorcu Safeer Linka _safeercast._tcp): Lina oglasuje _safeer-lina._tcp
 * samo, dokler je okno kode odprto; TXT ima samo v=1 (in vrata). Naslov in vrata iz odgovora, samo zasebni naslovi
 * (KodaLine.sprejmiOglas). Isce najvec 5 s; razresevanje po vrsti (starejsi Android ne razresi dveh hkrati).
 */
class OdkrivanjeLine(context: Context) {
    data class Najdena(val ime: String, val naslov: String, val vrata: Int)

    private val nsd = context.getSystemService(NsdManager::class.java)
    private val glavna = Handler(Looper.getMainLooper())
    private val najdene = LinkedHashMap<String, Najdena>()
    private val vrsta = ArrayDeque<NsdServiceInfo>()
    private var razresujem = false
    private var koncano = false
    private var poslusalec: NsdManager.DiscoveryListener? = null

    /** Klice [izid] enkrat, na glavni niti, po najvec 5 s. */
    fun isci(izid: (List<Najdena>) -> Unit) {
        val l = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) = koncaj(izid)
            override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) = Unit
            override fun onDiscoveryStarted(serviceType: String?) = Unit
            override fun onDiscoveryStopped(serviceType: String?) = Unit
            override fun onServiceLost(serviceInfo: NsdServiceInfo?) = Unit
            override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
                serviceInfo ?: return
                synchronized(this@OdkrivanjeLine) { if (!koncano) vrsta.addLast(serviceInfo) }
                naslednji()
            }
        }
        poslusalec = l
        try {
            nsd.discoverServices(KodaLine.STORITEV, NsdManager.PROTOCOL_DNS_SD, l)
        } catch (_: Exception) {
            poslusalec = null
            koncaj(izid); return
        }
        glavna.postDelayed({ koncaj(izid) }, KodaLine.ISCI_MS)
    }

    @Suppress("DEPRECATION") // resolveService: na API 34+ je novejsi registerServiceInfoCallback, minSdk je 29
    private fun naslednji() {
        val s = synchronized(this) {
            if (razresujem || koncano) return
            vrsta.removeFirstOrNull()?.also { razresujem = true } ?: return
        }
        try {
            nsd.resolveService(s, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) = koncanoRazresevanje()
                override fun onServiceResolved(info: NsdServiceInfo?) {
                    val v = info?.attributes?.get("v")?.toString(Charsets.UTF_8)
                    val n = KodaLine.sprejmiOglas(info?.host?.hostAddress, info?.port ?: 0, v)
                    if (info != null && n != null) synchronized(this@OdkrivanjeLine) {
                        val ime = info.serviceName.orEmpty().take(60).ifEmpty { n.first }
                        najdene["${n.first}:${n.second}"] = Najdena(ime, n.first, n.second)
                    }
                    koncanoRazresevanje()
                }
            })
        } catch (_: Exception) {
            koncanoRazresevanje()
        }
    }

    private fun koncanoRazresevanje() {
        synchronized(this) { razresujem = false }
        naslednji()
    }

    private fun koncaj(izid: (List<Najdena>) -> Unit) {
        val seznam = synchronized(this) {
            if (koncano) return
            koncano = true
            najdene.values.toList()
        }
        ustavi()
        glavna.post { izid(seznam) }
    }

    fun ustavi() {
        val l = poslusalec ?: return
        poslusalec = null
        try { nsd.stopServiceDiscovery(l) } catch (_: Exception) { }
    }
}
