package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NalogaLineTest {
    private val par = java.security.KeyPairGenerator.getInstance("EC").apply {
        initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()
    private val kljuc = java.util.Base64.getEncoder().encodeToString(par.public.encoded)
    private val id = KrogKljuc.idIzKljuca(kljuc)
    private val podpisnik: (ByteArray) -> String = { b ->
        val s = java.security.Signature.getInstance("SHA256withECDSA").apply { initSign(par.private); update(b) }
        java.util.Base64.getEncoder().encodeToString(s.sign())
    }

    @Test
    fun `podpisana naloga se preveri s kljucem naprave`() {
        val n = assertNotNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", id, "  izpisi git status  ", 1763120000000, "enkratni-vektor-0001", podpisnik))
        assertEquals("izpisi git status", n.besedilo)
        val niz = NiziLine.nizNaloge(n.id, n.posiljatelj, n.besedilo, n.cas, n.enkratni)!!.toByteArray(Charsets.UTF_8)
        assertTrue(KrogKljuc.preveriPodpisSKljucem(kljuc, niz, n.podpis))
    }

    @Test
    fun `neveljavna naloga se ne podpise`() {
        var podpisov = 0
        val stej: (ByteArray) -> String = { podpisov++; "x" }
        assertNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", id, "   ", 1, "enkratni-vektor-0001", stej))
        assertNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", id, "a".repeat(4001), 1, "enkratni-vektor-0001", stej))
        assertNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", id, "a\uD83Db", 1, "enkratni-vektor-0001", stej))
        assertNull(NalogaLine.podpisi("kratek", id, "ok", 1, "enkratni-vektor-0001", stej))
        assertNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", "telefon", "ok", 1, "enkratni-vektor-0001", stej))
        assertNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", id, "ok", 1, "kratek", stej))
        assertNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", id, "ok", 0, "enkratni-vektor-0001", stej))
        assertEquals(0, podpisov)
        assertNotNull(NalogaLine.podpisi("naloga-0001-aaaaaaaaaaaa", id, "a".repeat(4000), 1, "enkratni-vektor-0001", stej))
    }

    @Test
    fun `nakljucni nizi ustrezajo mejam Line`() {
        val a = NalogaLine.nakljucno()
        assertTrue(NiziLine.ENKRATNI.matches(a))
        assertFalse(a == NalogaLine.nakljucno())
    }

    @Test
    fun `id naloge krajsi od 22 znakov se ne podpise`() {
        assertNull(NalogaLine.podpisi("naloga-0001", id, "ok", 1, "enkratni-vektor-0001", podpisnik))
        assertNotNull(NalogaLine.podpisi(NalogaLine.nakljucno(), id, "ok", 1, "enkratni-vektor-0001", podpisnik))
    }
}
