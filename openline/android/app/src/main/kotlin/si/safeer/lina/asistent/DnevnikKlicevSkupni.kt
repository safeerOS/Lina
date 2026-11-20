package si.safeer.lina.asistent

import android.content.Context
import si.safeer.lina.samostojna.DatotecnaShramba
import si.safeer.lina.samostojna.DnevnikKlicev
import java.io.File

/**
 * EN dnevnik klicev na proces (20. 11. 2026): prehod (zapis klica), zavihek Klici in sinhronizacija z racunalnikom uporabljajo isti
 * objekt. Vec primerkov nad isto datoteko bi se medsebojno prepisovalo (sinhronizacija bi izgubila prejete klice ali vrnila poslane).
 */
object DnevnikKlicevSkupni {
    @Volatile private var primerek: DnevnikKlicev? = null

    fun dobi(context: Context): DnevnikKlicev = primerek ?: synchronized(this) {
        primerek ?: DnevnikKlicev(DatotecnaShramba(File(context.applicationContext.filesDir, "dnevnik_klicev.json"))).also { primerek = it }
    }
}
