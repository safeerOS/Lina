package si.safeer.lina.samostojna

/**
 * T3 (pregled 0213): naloga, ki jo je lastnik shranil za pozneje, gre samo racunalniku, za katerega jo je potrdil (odtis Line ob
 * shranjevanju), in samo v roku [ROK_MS]. Po »Pozabi racunalnik« ali seznanitvi z drugim racunalnikom se ne poslje sama.
 */
object CakajocaNaloga {
    /** Rok 24 h je izbira pregleda (ne lastnikova odlocitev): starejso nalogo lastnik poslje znova sam. */
    const val ROK_MS = 24L * 60 * 60 * 1000

    fun smePoslati(shranjenOdtis: String?, zdajOdtis: String?, shranjenoMs: Long, zdajMs: Long): Boolean =
        shranjenOdtis != null && shranjenOdtis == zdajOdtis && zdajMs >= shranjenoMs && zdajMs - shranjenoMs <= ROK_MS
}

/**
 * Naloga 23t: potrjena naloga, ki caka, da Lina na racunalniku odpre Claude Code (lastna mesta v shrambi, loceno od »shrani za
 * pozneje«). Po zasuku zaslona ali ponovnem zagonu aplikacije se cakanje nadaljuje samo za isti racunalnik in v roku cakanja.
 */
object NalogaCakaSejo {
    /** NEZNAN: ponovna oddaja je bila morda ze na poti (oznaka [oddano]), rok pa je potekel - lastnik preveri, ne poslje znova. */
    enum class Ob { OBNOVI, ROK, NEZNAN, NIC }

    fun obZagonu(caka: Boolean, id: String?, shranjenOdtis: String?, zdajOdtis: String?, zacetekMs: Long, zdajMs: Long, rokMs: Long,
                 oddano: Boolean = false): Ob = when {
        !caka || id == null -> Ob.NIC
        !CakajocaNaloga.smePoslati(shranjenOdtis, zdajOdtis, zacetekMs, zdajMs) -> Ob.NIC
        zdajMs - zacetekMs > rokMs -> if (oddano) Ob.NEZNAN else Ob.ROK
        else -> Ob.OBNOVI
    }
}
