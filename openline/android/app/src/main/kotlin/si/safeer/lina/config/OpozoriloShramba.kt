package si.safeer.lina.config

import android.content.Context
import si.safeer.lina.samostojna.OpozoriloLine

/**
 * Potrditev opozorila ob prvem zagonu (lastnik 24. 11. 2026) in oznaka namestitve. Odlocitve so v OpozoriloLine (samostojna,
 * preizkusi); tu samo zasebne nastavitve aplikacije. V config, ker jo bere tudi pot klica (GatewayInCallService), ki ne sme
 * uvoziti asistentke ali podpisa. Oznaka namestitve se zapise enkrat (prvi, ki pride: zaslon ali klic) in se ne racuna znova.
 */
class OpozoriloShramba(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("lina_opozorilo", Context.MODE_PRIVATE)

    fun potrjena(): Int? = prefs.getInt(KLJUC_POTRJENA, 0).takeIf { it > 0 }

    fun potrdi() {
        prefs.edit().putInt(KLJUC_POTRJENA, OpozoriloLine.RAZLICICA).putLong(KLJUC_CAS, System.currentTimeMillis()).commit()
    }

    @Synchronized
    fun namestitev(): OpozoriloLine.Namestitev? = runCatching {
        val shranjeno = prefs.getString(KLJUC_NAMESTITEV, null)?.let { s -> OpozoriloLine.Namestitev.entries.firstOrNull { it.name == s } }
        val (n, zapisi) = OpozoriloLine.oznakaNamestitve(shranjeno) {
            @Suppress("DEPRECATION") // minSdk 29; PackageInfoFlags je od API 33
            val p = app.packageManager.getPackageInfo(app.packageName, 0)
            // Stare nastavitve klicev ali povezave: po »Pocisti podatke« jih ni, zato taka namestitev velja za novo.
            val stariPodatki = listOf("lina_policy", "gateway_config").any { app.getSharedPreferences(it, Context.MODE_PRIVATE).all.isNotEmpty() }
            OpozoriloLine.namestitevIzCasov(p.firstInstallTime, p.lastUpdateTime, stariPodatki)
        }
        if (zapisi) prefs.edit().putString(KLJUC_NAMESTITEV, n.name).commit()
        n
    }.getOrNull()

    fun smeSprejematiKlice(): Boolean = runCatching { OpozoriloLine.smeSprejematiKlice(potrjena(), namestitev()) }.getOrDefault(false)
    fun smeDelati(): Boolean = runCatching { OpozoriloLine.smeDelati(potrjena()) }.getOrDefault(false)
    fun pokazi(): Boolean = OpozoriloLine.pokazi(potrjena())

    private companion object {
        const val KLJUC_POTRJENA = "potrjena_razlicica"
        const val KLJUC_CAS = "potrjeno_ob"
        const val KLJUC_NAMESTITEV = "namestitev"
    }
}
