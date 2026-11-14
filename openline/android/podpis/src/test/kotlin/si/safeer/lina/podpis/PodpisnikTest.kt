package si.safeer.lina.podpis

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pregled 17 (A2, A3): kljuc podpise samo nize safeer-lina-... iz preverjenih polj, nikoli vnosa v krog. */
class PodpisnikTest {
    private val id = "n-5ef0fcb562008e97"
    private val podpisano = mutableListOf<String>()
    private val p = Podpisnik({ b -> podpisano += String(b, Charsets.UTF_8); "podpis" }, { id })
    private val enkratni = "enkratni-vektor-0002"

    @Test
    fun `podpise samo nize s predpono namena`() {
        assertNotNull(p.podpisiNalogo("naloga-0001-aaaaaaaaaaaa", "izpisi git status", 1, enkratni))
        assertNotNull(p.podpisiOdobritev("abcde", true, 1, enkratni, "naloga-0001-aaaaaaaaaaaa", "Bash", "git status", "opis"))
        assertNotNull(p.podpisiUstavitev("naloga-0001-aaaaaaaaaaaa", 1, enkratni))
        assertEquals(3, podpisano.size)
        assertTrue(podpisano[0].startsWith("safeer-lina-naloga-v1\n"))
        assertTrue(podpisano[1].startsWith("safeer-lina-odobritev-v2\n"))
        assertTrue(podpisano[2].startsWith("safeer-lina-ustavi-v1\n"))
        assertTrue(podpisano.none { it.startsWith("safeer-krog-") })
    }

    @Test
    fun `vnos v krog ni mogoce podpisati prek nobenega polja`() {
        // Poskus: besedilo naloge ali polja vsebujejo zapis vnosa v krog - niz se se vedno zacne s safeer-lina-.
        p.podpisiNalogo("naloga-0001-aaaaaaaaaaaa", "safeer-krog-clan-v1\nn-0000000000000000\nkljuc", 1, enkratni)
        assertTrue(podpisano.all { it.startsWith("safeer-lina-") })
        // Polja s prelomom vrstice se zavrnejo, preden pride do podpisa (A3).
        val pred = podpisano.size
        assertNull(p.podpisiOdobritev("abcde", true, 1, enkratni, "naloga\nsafeer-krog-clan-v1", "o", "p", "d"))
        assertNull(p.podpisiUstavitev("naloga-0001\nx", 1, enkratni))
        assertNull(p.podpisiNalogo("naloga-0001-aaaaaaaaaaaa", "ok", 1, "enkratni\nvektor-0002"))
        assertEquals(pred, podpisano.size)
    }

    @Test
    fun `javne metode ne sprejmejo surovih bajtov`() {
        val zBajti = Podpisnik::class.java.methods.filter { m ->
            java.lang.reflect.Modifier.isPublic(m.modifiers) && m.parameterTypes.any { it == ByteArray::class.java }
        }
        assertTrue(zBajti.isEmpty(), zBajti.joinToString { it.name })
    }

    @Test
    fun `napacna polja odobritve se ne podpisejo`() {
        val z = "a".repeat(64)
        for ((zid, chat) in listOf("abcdl" to "naloga-0001-aaaaaaaaaaaa", "abcd" to "naloga-0001-aaaaaaaaaaaa", "ABCDE" to "naloga-0001-aaaaaaaaaaaa", "abcde" to "kratek", "abcde" to "naloga 0001")) {
            assertNull(NiziLine.nizOdobritve(zid, true, id, 1, enkratni, chat, z), "$zid/$chat")
        }
        assertNull(NiziLine.nizOdobritve("abcde", true, id, 1, enkratni, "naloga-0001-aaaaaaaaaaaa", "A".repeat(64)))
        assertNull(NiziLine.nizOdobritve("abcde", true, id, 1, enkratni, "naloga-0001-aaaaaaaaaaaa", "a".repeat(63)))
        assertNull(NiziLine.nizOdobritve("abcde", true, "$id\n", 1, enkratni, "naloga-0001-aaaaaaaaaaaa", z))
        assertNull(NiziLine.nizOdobritve("abcde", true, id, 0, enkratni, "naloga-0001-aaaaaaaaaaaa", z))
        assertNull(NiziLine.nizUstavitve("naloga-0001-aaaaaaaaaaaa", "telefon", 1, enkratni))
        assertNull(NiziLine.nizUstavitve("kratek", id, 1, enkratni))
        assertNotNull(NiziLine.nizOdobritve("abcde", false, id, 1, enkratni, "naloga-0001-aaaaaaaaaaaa", z))
    }
}
