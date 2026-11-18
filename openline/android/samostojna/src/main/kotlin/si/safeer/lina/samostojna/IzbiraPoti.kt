package si.safeer.lina.samostojna

// Mozne poti za sinhronizacijo med telefonom in racunalnikom po prednostnem vrstnem redu.
enum class Pot {
    LAN,
    GLOBAL_NEPOSREDNO,
    RELE
}

// Izbira poti sinhronizacije s spominom neuspehov in eksponentnim premorom (300 s -> 600 s -> 1200 s -> 1800 s).
class IzbiraPoti(
    private val ura: () -> Long = { System.nanoTime() / 1_000_000_000L }
) {
    companion object {
        const val ZACETNI_PREMOR_S: Long = 300L
        const val NAJVECJI_PREMOR_S: Long = 1800L
    }

    private val zaporedniNeuspehi = mutableMapOf<Pot, Int>()
    private val konecPremora = mutableMapOf<Pot, Long>()

    // Izbere prvo razpolozljivo pot po vrstnem redu LAN -> GLOBAL_NEPOSREDNO -> RELE.
    // Poti, ki so trenutno v premoru zaradi neuspeha, preskoci. Ce so vse v premoru, vrne null.
    fun izberi(): Pot? {
        val zdaj = ura()
        for (pot in listOf(Pot.LAN, Pot.GLOBAL_NEPOSREDNO, Pot.RELE)) {
            val doCasa = konecPremora[pot]
            if (doCasa == null || zdaj >= doCasa) {
                return pot
            }
        }
        return null
    }

    // Izbere pot ob upostevanju stanja povezave (ce naprava ni parjena ali je nedosegljiva, vrne null).
    fun izberi(povezava: PovezavaStanje): Pot? {
        if (povezava == PovezavaStanje.NI_PARJENO || povezava == PovezavaStanje.NEDOSEGLJIVO) {
            return null
        }
        return izberi()
    }

    // Zabelezi neuspeh poti: prvi neuspeh nastavi premor 300 s, vsak naslednji podvoji do najvec 1800 s.
    fun neuspeh(pot: Pot) {
        val st = (zaporedniNeuspehi[pot] ?: 0) + 1
        zaporedniNeuspehi[pot] = st
        val premor = izracunajPremor(st)
        konecPremora[pot] = ura() + premor
    }

    // Zabelezi uspeh poti in pobrise spomin neuspehov za to pot.
    fun uspeh(pot: Pot) {
        zaporedniNeuspehi.remove(pot)
        konecPremora.remove(pot)
    }

    // Ob spremembi omrezja pobrise spomin neuspehov za vse poti.
    fun spremembaOmrezja() {
        zaporedniNeuspehi.clear()
        konecPremora.clear()
    }

    // Vrne zadnje nastavljeno trajanje premora v sekundah za podano pot (0, ce ni neuspeha v spominu).
    fun trenutniPremor(pot: Pot): Long {
        val st = zaporedniNeuspehi[pot] ?: return 0L
        return izracunajPremor(st)
    }

    // Preveri, ali je podana pot trenutno v premoru.
    fun jeVPremoru(pot: Pot): Boolean {
        val doCasa = konecPremora[pot] ?: return false
        return ura() < doCasa
    }

    private fun izracunajPremor(zaporedniNeuspeh: Int): Long {
        val eksponent = (zaporedniNeuspeh - 1).coerceIn(0, 4)
        val surovo = ZACETNI_PREMOR_S * (1L shl eksponent)
        return surovo.coerceAtMost(NAJVECJI_PREMOR_S)
    }
}
