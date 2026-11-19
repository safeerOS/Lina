package si.safeer.lina.telecom

import android.content.Context
import si.safeer.lina.asistent.SkupniKljuci

object SamostojnaPripravljenost {
    fun imaNastavljenKljuc(context: Context): Boolean {
        return SkupniKljuci.preberiKljucAktivnegaPonudnika(context) != null
    }

    fun jePripravljena(context: Context): Boolean {
        if (!si.safeer.lina.telecom.LokalniPrehodUpravljalnik.tece()) return false
        return imaNastavljenKljuc(context)
    }
}
