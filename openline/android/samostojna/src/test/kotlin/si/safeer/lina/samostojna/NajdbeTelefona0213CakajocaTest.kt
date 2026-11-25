package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Slepi pregled telefona 0.2.13, T3: shranjena naloga gre samo istemu racunalniku in v roku. */
class NajdbeTelefona0213CakajocaTest {
    private val t0 = 1_764_000_000_000L
    private val ura = 60L * 60 * 1000

    @Test fun `T3 - isti racunalnik v roku - poslje se sama`() {
        assertTrue(CakajocaNaloga.smePoslati("odtisA", "odtisA", t0, t0 + 2 * ura))
    }

    @Test fun `T3 - drug racunalnik, pozabljen racunalnik, star zapis brez odtisa ali potekel rok - ne poslje se`() {
        assertFalse(CakajocaNaloga.smePoslati("odtisA", "odtisB", t0, t0 + ura), "nov racunalnik")
        assertFalse(CakajocaNaloga.smePoslati("odtisA", null, t0, t0 + ura), "pozabljen")
        assertFalse(CakajocaNaloga.smePoslati(null, "odtisA", t0, t0 + ura), "zapis brez odtisa")
        assertFalse(CakajocaNaloga.smePoslati("odtisA", "odtisA", t0, t0 + CakajocaNaloga.ROK_MS + 1), "potekel rok")
        assertFalse(CakajocaNaloga.smePoslati("odtisA", "odtisA", t0 + 2 * ura, t0), "ura nazaj")
    }

    @Test fun `T3 - besedilo zavrnjene shranjene naloge v vseh 6 jezikih`() {
        val res = java.io.File("../app/src/main/res")
        val mape = res.listFiles { f -> f.name == "values" || f.name.startsWith("values-") }!!.filter { java.io.File(it, "strings.xml").exists() }
        org.junit.jupiter.api.Assertions.assertEquals(6, mape.size)
        for (m in mape) assertTrue(java.io.File(m, "strings.xml").readText().contains("name=\"local_task_shranjena_potekla\""), m.name)
    }
}
