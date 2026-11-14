package si.safeer.lina.podpis

/**
 * Edina vrata do kljuca naprave (pregled 17, A2). Sprejme samo polja, niz sestavi sam (NiziLine) - zato kljuc podpise samo
 * nize s predpono safeer-lina-..., nikoli vnosa v krog (safeer-krog-clan-v1), umika ali drugih bajtov. Funkcija, ki podpise
 * bajte, je zasebna v NapravaKljuc in pride sem kot [podpisi]; javne metode tega razreda ne sprejmejo ByteArray.
 */
/** Podpisan zahtevek za seznanitev: id in javni kljuc naprave ter podpis niza seznanitve. */
data class PodpisSeznanitve(val id: String, val kljuc: String, val podpis: String)

class Podpisnik(
    private val podpisi: (ByteArray) -> String,
    private val idNaprave: () -> String,
    private val javniKljuc: () -> String = { "" },
) {
    fun podpisiSeznanitev(koda: String, ime: String, cas: Long, enkratni: String): PodpisSeznanitve? {
        val id = idNaprave(); val kljuc = javniKljuc()
        val niz = NiziLine.nizSeznanitve(koda, id, kljuc, ime, cas, enkratni) ?: return null
        return PodpisSeznanitve(id, kljuc, podpisi(niz.toByteArray(Charsets.UTF_8)))
    }

    fun podpisiStanje(cas: Long, enkratni: String): String? {
        val niz = NiziLine.nizStanja(idNaprave(), cas, enkratni) ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }

    fun podpisiNalogo(id: String, vnos: String, cas: Long, enkratni: String): PodpisanaNaloga? =
        NalogaLine.podpisi(id, idNaprave(), vnos, cas, enkratni, podpisi)

    fun podpisiOdobritev(
        zahtevaId: String, dovoli: Boolean, cas: Long, enkratni: String, chatId: String, orodje: String, predogled: String, opis: String,
    ): String? {
        val niz = NiziLine.nizOdobritve(zahtevaId, dovoli, idNaprave(), cas, enkratni, chatId, NiziLine.zgostitevPrikaza(orodje, predogled, opis))
            ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }

    fun podpisiUstavitev(id: String, cas: Long, enkratni: String): String? {
        val niz = NiziLine.nizUstavitve(id, idNaprave(), cas, enkratni) ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }
}
