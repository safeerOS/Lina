package si.safeer.lina.samostojna

// Povzetek za zaslon Domov na telefonu: »Lina je odgovorila na N klicev«, nujni klici na vrhu.
// Racuna se samo iz lokalnega dnevnika (deluje brez racunalnika); ploscice brez vira podatkov se ne prikazejo.
data class PovzetekDomov(
    val stevilo: Int,
    val nujnih: Int,
    val naslov: String,
    val nujni: List<ZapisKlica>,
    val ostali: List<ZapisKlica>
) {
    val kartica: Boolean get() = stevilo > 0
}

fun povzetekDomov(zapisi: List<ZapisKlica>, odCasa: Long, jezik: Jezik = Jezik.SL, najvecPrikazanih: Int = 5): PovzetekDomov {
    val novi = zapisi.filter { it.casZacetka >= odCasa }.sortedByDescending { it.casZacetka }
    val nujni = novi.filter { it.nujno }
    val ostali = novi.filterNot { it.nujno }
    val n = novi.size
    val naslov = if (n == 0) "" else when (jezik) {
        Jezik.SL -> "Lina je odgovorila na $n ${oblikaKlicev(n)}"
        Jezik.EN -> "Lina answered $n ${if (n == 1) "call" else "calls"}"
    }
    return PovzetekDomov(n, nujni.size, naslov, nujni.take(najvecPrikazanih), ostali.take(najvecPrikazanih))
}

// Slovenska dvojina: 1 klic, 2 klica, 3 in 4 klice, sicer klicev.
private fun oblikaKlicev(n: Int): String = when {
    n % 100 == 1 -> "klic"
    n % 100 == 2 -> "klica"
    n % 100 == 3 || n % 100 == 4 -> "klice"
    else -> "klicev"
}
