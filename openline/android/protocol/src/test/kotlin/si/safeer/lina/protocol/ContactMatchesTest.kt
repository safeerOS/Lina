package si.safeer.lina.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ContactMatchesTest {
    @Test
    fun `brez praznih stevilk in podvojenih stevilk, po imenu`() {
        val r = ContactMatches.top(listOf(
            ContactRow("Zala", "+386 40 111 222"),
            ContactRow("ana", "+386 31 000 000"),
            ContactRow("Ana", "+38631000000"),
            ContactRow("Brez", "  "),
        ))
        assertEquals(listOf("ana", "Zala"), r.map { it.name })
    }

    @Test
    fun `najvec toliko zadetkov, kot je dovoljeno, in nic za 0`() {
        val vsi = (1..20).map { ContactRow("Stik $it", "+3864000$it") }
        assertEquals(ContactMatches.DEFAULT_MAX, ContactMatches.top(vsi).size)
        assertEquals(3, ContactMatches.top(vsi, 3).size)
        assertTrue(ContactMatches.top(vsi, 0).isEmpty())
    }

    @Test
    fun `isti stevilki z in brez predpone nista ista stevilka`() {
        val r = ContactMatches.top(listOf(ContactRow("A", "+38631000000"), ContactRow("B", "031000000")))
        assertEquals(2, r.size)
    }
}
