package si.safeer.lina.samostojna

import java.io.File
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Klic na Samsungu 22. 11. 2026 brez zvoka: TLS kljuc lokalnega prehoda iz starejse razlicice ni imel DIGEST_NONE
// (»Incompatible digest«, NONEwithECDSA). Lina mora tak kljuc zamenjati, ne samo preveriti, da obstaja.
class PrehodKljucTest {
    private val vir = File("../app/src/main/kotlin/si/safeer/lina/telecom/LokalniPrehodUpravljalnik.kt").readText()

    @Test
    fun `star kljuc brez DIGEST_NONE se zamenja`() {
        val start = vir.substringAfter("fun start(").substringBefore("val kmf")
        assertTrue(start.contains("!kljucPodpiraSurovPodpis(ks, alias)"), "preverba digestov pred uporabo kljuca")
        assertTrue(start.indexOf("deleteEntry(alias)") in 0 until start.indexOf("generateKeyPair()"), "izbris starega pred novim")
        assertTrue(start.contains("KeyProperties.DIGEST_NONE"), "nov kljuc ima DIGEST_NONE")
        assertTrue(vir.contains("info.digests.contains(KeyProperties.DIGEST_NONE)"))
    }
}
