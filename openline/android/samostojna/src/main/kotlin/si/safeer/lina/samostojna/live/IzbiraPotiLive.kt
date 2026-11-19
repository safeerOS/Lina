package si.safeer.lina.samostojna.live

enum class PotLive {
    VERTEX,
    API_KLJUC
}

class IzbiraPotiLive(
    private val naVoljo: (PotLive) -> Boolean,
    private val ura: () -> Long = { System.nanoTime() / 1_000_000_000L }
) {
    companion object {
        const val ZACETNI_PREMOR_S: Long = 300L
        const val NAJVECJI_PREMOR_S: Long = 1800L
    }

    private val zaporedniNeuspehi = mutableMapOf<PotLive, Int>()
    private val konecPremora = mutableMapOf<PotLive, Long>()

    fun izberi(): PotLive? {
        val zdaj = ura()
        for (pot in listOf(PotLive.VERTEX, PotLive.API_KLJUC)) {
            if (!naVoljo(pot)) continue
            val doCasa = konecPremora[pot]
            if (doCasa == null || zdaj >= doCasa) {
                return pot
            }
        }
        return null
    }

    fun neuspeh(pot: PotLive) {
        val st = (zaporedniNeuspehi[pot] ?: 0) + 1
        zaporedniNeuspehi[pot] = st
        val eksponent = (st - 1).coerceIn(0, 4)
        val premor = (ZACETNI_PREMOR_S * (1L shl eksponent)).coerceAtMost(NAJVECJI_PREMOR_S)
        konecPremora[pot] = ura() + premor
    }

    fun uspeh(pot: PotLive) {
        zaporedniNeuspehi.remove(pot)
        konecPremora.remove(pot)
    }
}
