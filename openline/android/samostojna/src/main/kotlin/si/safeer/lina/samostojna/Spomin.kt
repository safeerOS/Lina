package si.safeer.lina.samostojna

import kotlinx.serialization.Serializable

@Serializable
data class Zapisek(val id: String, val besedilo: String, val cas: Long, val izbrisan: Boolean)

@Serializable
data class Opomnik(val id: String, val besedilo: String, val cas: Long, val izbrisan: Boolean, val spremenjeno: Long = cas)

fun zdruzi(a: List<Zapisek>, b: List<Zapisek>): List<Zapisek> {
    val mapa = mutableMapOf<String, Zapisek>()
    
    for (zapisek in a + b) {
        val obstojeci = mapa[zapisek.id]
        if (obstojeci == null) {
            mapa[zapisek.id] = zapisek
        } else {
            if (zapisek.cas > obstojeci.cas) {
                mapa[zapisek.id] = zapisek
            } else if (zapisek.cas == obstojeci.cas) {
                if (zapisek.izbrisan && !obstojeci.izbrisan) {
                    mapa[zapisek.id] = zapisek
                } else if (zapisek.izbrisan == obstojeci.izbrisan) {
                    if (zapisek.besedilo > obstojeci.besedilo) {
                        mapa[zapisek.id] = zapisek
                    }
                }
            }
        }
    }
    
    return mapa.values.sortedBy { it.id }
}

@JvmName("zdruziOpomnike")
fun zdruzi(a: List<Opomnik>, b: List<Opomnik>): List<Opomnik> {
    val mapa = mutableMapOf<String, Opomnik>()
    
    for (opomnik in a + b) {
        val obstojeci = mapa[opomnik.id]
        if (obstojeci == null) {
            mapa[opomnik.id] = opomnik
        } else {
            if (opomnik.spremenjeno > obstojeci.spremenjeno) {
                mapa[opomnik.id] = opomnik
            } else if (opomnik.spremenjeno == obstojeci.spremenjeno) {
                if (opomnik.izbrisan && !obstojeci.izbrisan) {
                    mapa[opomnik.id] = opomnik
                } else if (opomnik.izbrisan == obstojeci.izbrisan) {
                    if (opomnik.besedilo > obstojeci.besedilo) {
                        mapa[opomnik.id] = opomnik
                    } else if (opomnik.besedilo == obstojeci.besedilo) {
                        if (opomnik.cas > obstojeci.cas) {
                            mapa[opomnik.id] = opomnik
                        }
                    }
                }
            }
        }
    }
    
    return mapa.values.sortedBy { it.id }
}

fun zapadli(opomniki: List<Opomnik>, zdaj: Long): List<Opomnik> {
    return opomniki.filter { !it.izbrisan && it.cas <= zdaj }
        .sortedBy { it.cas }
}

fun poisci(zapiski: List<Zapisek>, poizvedba: String): List<Zapisek> {
    val iskalniNiz = poizvedba.trim().lowercase()
    if (iskalniNiz.isEmpty()) return emptyList()
    
    return zapiski.filter { !it.izbrisan && it.besedilo.lowercase().contains(iskalniNiz) }
        .sortedByDescending { it.cas }
}
