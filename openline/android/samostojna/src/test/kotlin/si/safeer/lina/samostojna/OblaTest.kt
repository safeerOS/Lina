package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Preizkusi za animirano kroglo Obla.
class OblaTest {

    @Test
    fun `polmer - zmanjsano gibanje je odvisno samo od faze in nikoli od casa ali glasnosti`() {
        for (faza in Faza.values()) {
            val p1 = polmer(faza, glasnost = 0f, cas = 0L, zmanjsanoGibanje = true)
            val p2 = polmer(faza, glasnost = 1f, cas = 1234L, zmanjsanoGibanje = true)
            val p3 = polmer(faza, glasnost = Float.NaN, cas = -999999L, zmanjsanoGibanje = true)
            val p4 = polmer(faza, glasnost = 100f, cas = Long.MAX_VALUE, zmanjsanoGibanje = true)

            assertTrue(p1 in 0.8f..1.2f)
            assertEquals(p1, p2)
            assertEquals(p1, p3)
            assertEquals(p1, p4)
        }
    }

    @Test
    fun `polmer - sinusno dihanje v MIRUJE ko zmanjsanoGibanje ni vklopljeno`() {
        val t0 = polmer(Faza.MIRUJE, glasnost = 0f, cas = 0L, zmanjsanoGibanje = false)
        val t1 = polmer(Faza.MIRUJE, glasnost = 0f, cas = 600L, zmanjsanoGibanje = false)
        val t2 = polmer(Faza.MIRUJE, glasnost = 0f, cas = 1800L, zmanjsanoGibanje = false)

        assertTrue(t0 in 0.8f..1.2f)
        assertTrue(t1 in 0.8f..1.2f)
        assertTrue(t2 in 0.8f..1.2f)
        assertNotEquals(t0, t1)
        assertNotEquals(t1, t2)
    }

    @Test
    fun `polmer - sledenje glasnosti v POSLUSA`() {
        val tiho = polmer(Faza.POSLUSA, glasnost = 0f, cas = 100L, zmanjsanoGibanje = false)
        val srednje = polmer(Faza.POSLUSA, glasnost = 0.5f, cas = 100L, zmanjsanoGibanje = false)
        val glasno = polmer(Faza.POSLUSA, glasnost = 1f, cas = 100L, zmanjsanoGibanje = false)

        assertTrue(tiho in 0.8f..1.2f)
        assertTrue(srednje in 0.8f..1.2f)
        assertTrue(glasno in 0.8f..1.2f)
        assertTrue(tiho < srednje)
        assertTrue(srednje < glasno)
    }

    @Test
    fun `polmer - mejne vrednosti NaN negativna in ogromna glasnost`() {
        for (faza in Faza.values()) {
            for (g in floatArrayOf(Float.NaN, -1000f, 0f, 0.5f, 1f, 1000f, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)) {
                val r = polmer(faza, glasnost = g, cas = 500L, zmanjsanoGibanje = false)
                assertTrue(!r.isNaN() && r in 0.8f..1.2f)
            }
        }
    }

    @Test
    fun `polmer - ekstremne vrednosti casa ostanejo v razponu 0_8 do 1_2`() {
        val casi = longArrayOf(Long.MIN_VALUE, -100000L, -1L, 0L, 1L, 100000L, Long.MAX_VALUE)
        for (faza in Faza.values()) {
            for (c in casi) {
                val r1 = polmer(faza, glasnost = 0.5f, cas = c, zmanjsanoGibanje = false)
                val r2 = polmer(faza, glasnost = 0.5f, cas = c, zmanjsanoGibanje = true)
                assertTrue(!r1.isNaN() && r1 in 0.8f..1.2f)
                assertTrue(!r2.isNaN() && r2 in 0.8f..1.2f)
            }
        }
    }
}
