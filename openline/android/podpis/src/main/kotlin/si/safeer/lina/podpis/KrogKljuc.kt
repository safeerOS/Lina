package si.safeer.lina.podpis

import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * KOPIJA (dobesedno; edina razlika: KDoc preveriPodpisSKljucem prestavljen k funkciji, pregled 17 B10) iz Android-tv: src/main/kotlin/si/safeer/tv/cast/KrogZaupanja.kt @707ff60,
 * companion object od dekodirajKljuc do jeIdIzKljuca. Isti zapis kot core/link_krog.py (Safeer-linux) in idIzKljuca v
 * Lini (kanal-claude.ts). Ne spreminjaj tu - popravek gre najprej v Android-tv; ujemanje drzi KrogKljucTest (skupni vektor).
 */
object KrogKljuc {
    fun dekodirajKljuc(b64: String): java.security.PublicKey? = try {
        KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(b64)))
    } catch (_: Throwable) { null }

    /**
     * Kar podpise naprava, ki v krog doda drugo napravo. Podpis je vezan na id, kljuc, platformo,
     * cas in podpisnika: vnosa ni mogoce spremeniti ne prestaviti k drugemu clanu. Isti zapis kot
     * link_krog.podatki_clana na racunalniku.
     */
    fun podatkiClana(id: String, kljuc: String, platforma: String, dodano: Double, dodal: String): ByteArray =
        "safeer-krog-clan-v1\n$id\n$kljuc\n$platforma\n${String.format(java.util.Locale.ROOT, "%.3f", dodano)}\n$dodal".toByteArray(Charsets.UTF_8)

    /** Kar podpise naprava, ki clana umakne (link_krog.podatki_umika). */
    fun podatkiUmika(id: String, umaknjeno: Double, umaknil: String): ByteArray =
        "safeer-krog-umik-v1\n$id\n${String.format(java.util.Locale.ROOT, "%.3f", umaknjeno)}\n$umaknil".toByteArray(Charsets.UTF_8)

    /** Ali je [podpisB64] podpis [podatkov] z javnim kljucem [kljucB64] (SHA256withECDSA, DER podpis). */
    fun preveriPodpisSKljucem(kljucB64: String, podatki: ByteArray, podpisB64: String): Boolean {
        val kljuc = dekodirajKljuc(kljucB64) ?: return false
        return try {
            val s = Signature.getInstance("SHA256withECDSA")
            s.initVerify(kljuc)
            s.update(podatki)
            s.verify(Base64.getDecoder().decode(podpisB64))
        } catch (_: Throwable) { false }
    }

    /** Id naprave iz javnega kljuca: prvih 16 sestnajstiskih znakov SHA-256 zapisa SPKI. */
    fun idIzKljuca(kljucB64: String): String {
        val izvlecek = java.security.MessageDigest.getInstance("SHA-256").digest(Base64.getDecoder().decode(kljucB64))
        return "n-" + izvlecek.joinToString("") { "%02x".format(it) }.take(16)
    }

    /** Dolzina id-ja iz kljuca brez pripone sorodnika: "n-" + 16 znakov. */
    const val DOLZINA_ID_IZ_KLJUCA = 18

    /**
     * Ali je [id] izpeljan iz kljuca: `n-<16 hex>`, po zelji s pripono programa (`-os`, `-control` ...) iz crk, stevk,
     * pike, podcrtaja in vezaja, skupaj najvec 128 znakov. Id z drugimi znaki (presledek, prelom vrstice ...) NI id iz
     * kljuca in kljuca po jedru ne dobi: z njim je sredisce sejo zascite ene naprave prevezalo na drugo (drugi
     * neodvisni pregled, 7. 10. 2026). Isto pravilo kot DostopPravila.jeIdIzKljuca in core/link_krog.py.
     */
    fun jeIdIzKljuca(id: String): Boolean {
        if (id.length < DOLZINA_ID_IZ_KLJUCA || id.length > 128 || !id.startsWith("n-")) return false
        if (!id.substring(2, DOLZINA_ID_IZ_KLJUCA).all { it in '0'..'9' || it in 'a'..'f' }) return false
        if (id.length == DOLZINA_ID_IZ_KLJUCA) return true
        return id[DOLZINA_ID_IZ_KLJUCA] == '-' && id.substring(DOLZINA_ID_IZ_KLJUCA + 1).all {
            it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '.' || it == '_' || it == '-'
        }
    }
}
