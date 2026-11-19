package si.safeer.lina.samostojna

/**
 * Odjemalec lokalnega vmesnika Safeer OS za zapiske (navodila seje Safeer, 19. 11. 2026; operacije 1, 2, 7).
 * Cista logika brez Androida: prenos (Binder Messenger) je skrit za PrenosVmesnika, da se meje in zanke preizkusijo na racunalniku.
 * Brez Safeer OS (prenos vrne null) Lina deluje naprej sama; zapiskov nikoli ne izgubi.
 */
const val BINDER_NAJVEC_ZNAKOV = 120_000
private const val SKUPINA_NAJVEC_ZNAKOV = 100_000
private const val ZAPISEK_NAJVEC_ZNAKOV = 118_000
private const val NAJVEC_STRANI = 10_000

object SafeerOp {
    const val ZAPISKI_PREBERI = 1
    const val ZAPISKI_POSLJI = 2
    const val ZAPISKI_STRAN = 7
}

/** Poslje operacijo in vrne vsebino odgovora (what=10); null = brez odgovora v casovni omejitvi (Safeer OS ni na voljo). */
fun interface PrenosVmesnika {
    fun poslji(operacija: Int, podatki: Map<String, Any?>): Map<String, Any?>?
}

enum class StanjeUsklajevanja {
    /** Vse poslano in sprejeto. */
    USKLAJENO,
    /** Safeer OS ni na voljo ali ni odgovoril; Lina uporablja samo lokalne zapiske. */
    NI_SAFEER_OS,
    /** Safeer meja (5000 zapiskov / 262144 kodnih tock / 1 MiB): stanje ni spremenjeno; uporabnik naj izbrise nekaj. Brez ponavljanja v zanki. */
    ZAVRNJENO_MEJA,
}

data class Branje(val zapiski: List<Zapisek>, val izpuscenih: Int)

data class IzidPosiljanja(val stanje: StanjeUsklajevanja, val prevelikih: Int)

data class IzidUsklajevanja(
    val zapiski: List<Zapisek>,
    val stanje: StanjeUsklajevanja,
    /** Zapiski, ki jih Safeer pri branju ni mogel prenesti prek Bindra (en zapisek > ~118000 znakov JSON); ostanejo na drugi napravi. */
    val izpuscenihOdSafeer: Int = 0,
    /** Lokalni zapiski, predolgi za Binder; ostanejo samo na tem telefonu, uporabniku se to pokaze. */
    val prevelikihLokalno: Int = 0,
)

class SafeerZapiski(private val prenos: PrenosVmesnika) {

    private fun zapisi(vrednost: Any?): List<Zapisek>? {
        val besedilo = vrednost as? String ?: return null
        return iz_json(besedilo)?.zapiski
    }

    /** null = Safeer OS ne odgovori ali odgovor ni veljaven. */
    fun preberi(): Branje? {
        val o = prenos.poslji(SafeerOp.ZAPISKI_PREBERI, emptyMap()) ?: return null
        if (o["preveliko"] != true) {
            return Branje(zdruzi(zapisi(o["zapisi"]) ?: return null, emptyList()), 0)
        }
        val vsi = mutableListOf<Zapisek>()
        var od = 0
        var izpuscenih = 0
        var strani = 0
        while (true) {
            val s = prenos.poslji(SafeerOp.ZAPISKI_STRAN, mapOf("od" to od)) ?: return null
            vsi += zapisi(s["zapisi"]) ?: return null
            izpuscenih += (s["izpuscenih"] as? Int) ?: 0
            val naslednji = (s["naslednji"] as? Int) ?: return null
            if (naslednji == -1) break
            // Zascita pred zanko ob pokvarjenem odgovoru: indeks mora napredovati.
            if (naslednji <= od || ++strani > NAJVEC_STRANI) return null
            od = naslednji
        }
        return Branje(zdruzi(vsi, emptyList()), izpuscenih)
    }

    /** Razreze po skupinah JSON pod mejo Bindra in poslje vsako posebej. Zlitje je asociativno in komutativno (vrstni red ni pomemben). */
    fun poslji(zapiski: List<Zapisek>): IzidPosiljanja {
        val skupine = mutableListOf<List<Zapisek>>()
        var trenutna = mutableListOf<Zapisek>()
        var dolzina = 0
        var prevelikih = 0
        for (z in zapiski) {
            val d = zapiskiVJson(listOf(z)).length + 1
            if (d > ZAPISEK_NAJVEC_ZNAKOV) { prevelikih++; continue }
            if (trenutna.isNotEmpty() && dolzina + d > SKUPINA_NAJVEC_ZNAKOV) {
                skupine += trenutna; trenutna = mutableListOf(); dolzina = 0
            }
            trenutna += z; dolzina += d
        }
        if (trenutna.isNotEmpty()) skupine += trenutna
        for (skupina in skupine) {
            val o = prenos.poslji(SafeerOp.ZAPISKI_POSLJI, mapOf("zapisi" to v_json(Zapisi(1, skupina, emptyList()))))
                ?: return IzidPosiljanja(StanjeUsklajevanja.NI_SAFEER_OS, prevelikih)
            // Ob zavrnitvi se ustavimo: naslednje skupine bi bile zavrnjene iz istega razloga.
            if (o["sprejeto"] != true) return IzidPosiljanja(StanjeUsklajevanja.ZAVRNJENO_MEJA, prevelikih)
        }
        return IzidPosiljanja(StanjeUsklajevanja.USKLAJENO, prevelikih)
    }

    /** Preberi, zdruzi po skupnih pravilih, pocisti nagrobnike, poslji. Lokalnih zapiskov nikoli ne zavrze. */
    fun uskladi(lokalni: List<Zapisek>, zdajMs: Long): IzidUsklajevanja {
        val oddaljeno = preberi() ?: return IzidUsklajevanja(lokalni, StanjeUsklajevanja.NI_SAFEER_OS)
        val zdruzeno = pocistiNagrobnike(zdruzi(lokalni, oddaljeno.zapiski), zdajMs).zapiski
        val izid = poslji(zdruzeno)
        return IzidUsklajevanja(zdruzeno, izid.stanje, oddaljeno.izpuscenih, izid.prevelikih)
    }
}
