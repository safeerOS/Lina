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
