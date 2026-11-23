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

    fun podpisiDogodke(id: String, cas: Long, enkratni: String): String? {
        val niz = NiziLine.nizDogodkov(id, idNaprave(), cas, enkratni) ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }

    fun podpisiKlice(koda: String, cas: Long, enkratni: String): String? {
        val niz = NiziLine.nizKlici(koda, idNaprave(), cas, enkratni) ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }

    /** Sinhronizacija: podpis pokriva SHA-256 niza [vsebina], ki ga telefon poslje v telesu. */
    fun podpisiSinhron(vsebina: String, cas: Long, enkratni: String): String? {
        if (!NiziLine.praviUnicode(vsebina)) return null
        val niz = NiziLine.nizSinhron(idNaprave(), cas, enkratni, NiziLine.zgostitevSinhron(vsebina)) ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }

    fun podpisiStanjeDodatkov(cas: Long, enkratni: String): String? {
        val niz = NiziLine.nizStanjaDodatkov(idNaprave(), cas, enkratni) ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }

    fun podpisiDodatek(dodatek: String, vklop: Boolean, cas: Long, enkratni: String): String? {
        val niz = NiziLine.nizDodatka(idNaprave(), dodatek, vklop, cas, enkratni) ?: return null
        return podpisi(niz.toByteArray(Charsets.UTF_8))
    }

    fun podpisiNalogo(id: String, vnos: String, cas: Long, enkratni: String): PodpisanaNaloga? =
        NalogaLine.podpisi(id, idNaprave(), vnos, cas, enkratni, podpisi)

    fun podpisiNadaljevanje(id: String, vnos: String, cas: Long, enkratni: String): PodpisanaNaloga? =
        NalogaLine.podpisiNadaljevanje(id, idNaprave(), vnos, cas, enkratni, podpisi)

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
