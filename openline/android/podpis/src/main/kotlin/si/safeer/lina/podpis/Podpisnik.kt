package si.safeer.lina.podpis

/**
 * Edina vrata do kljuca naprave (pregled 17, A2). Sprejme samo polja, niz sestavi sam (NiziLine) - zato kljuc podpise samo
 * nize s predpono safeer-lina-..., nikoli vnosa v krog (safeer-krog-clan-v1), umika ali drugih bajtov. Funkcija, ki podpise
 * bajte, je zasebna v NapravaKljuc in pride sem kot [podpisi]; javne metode tega razreda ne sprejmejo ByteArray.
 */
class Podpisnik(private val podpisi: (ByteArray) -> String, private val idNaprave: () -> String) {
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
