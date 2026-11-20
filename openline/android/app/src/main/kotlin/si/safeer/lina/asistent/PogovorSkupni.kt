package si.safeer.lina.asistent

import android.content.Context
import si.safeer.lina.samostojna.DatotecnaShramba
import si.safeer.lina.samostojna.PogovorShramba
import java.io.File

/** EN trajni pogovor na proces (zaslon pogovora in sinhronizacija delata nad istim objektom). */
object PogovorSkupni {
    @Volatile private var primerek: PogovorShramba? = null

    fun dobi(context: Context): PogovorShramba = primerek ?: synchronized(this) {
        primerek ?: PogovorShramba(DatotecnaShramba(File(context.applicationContext.filesDir, "pogovor_lastnika.json"))).also { primerek = it }
    }
}
