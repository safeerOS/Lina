package si.safeer.lina.telecom

import android.content.Context
import si.safeer.lina.asistent.KeystoreShranjevalnik
import si.safeer.lina.asistent.PonudnikShramba
import si.safeer.lina.samostojna.Ponudnik

object SamostojnaPripravljenost {
    fun imaNastavljenKljuc(context: Context): Boolean {
        val ponudnik = PonudnikShramba(context).beri()
        return if (ponudnik == Ponudnik.VERTEX) {
            KeystoreShranjevalnik(context, Ponudnik.VERTEX).preberi() != null
        } else {
            KeystoreShranjevalnik(context, ponudnik).preberi() != null
        }
    }

    fun jePripravljena(context: Context): Boolean {
        if (!si.safeer.lina.telecom.LokalniPrehodUpravljalnik.tece()) return false
        return imaNastavljenKljuc(context)
    }
}
