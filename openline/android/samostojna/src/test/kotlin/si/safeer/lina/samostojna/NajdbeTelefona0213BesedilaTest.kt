package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/** Slepi pregled telefona 0.2.13, T9: naloge gredo tudi prek Global Linka; besedila v vseh 6 jezikih. */
class NajdbeTelefona0213BesedilaTest {
    private val res = File("../app/src/main/res")
    private val mape = res.listFiles { f -> f.name == "values" || f.name.startsWith("values-") }!!.filter { File(it, "strings.xml").exists() }

    private fun niz(m: File, ime: String) = Regex("name=\"$ime\">([^<]*)<").find(File(m, "strings.xml").readText())?.groupValues?.get(1)

    @Test fun `T9 - nedosegljiv racunalnik ne trdi vec, da naloge delujejo samo doma`() {
        assertEquals(6, mape.size, mape.toString())
        val samoDoma = Regex("samo v domačem|only on the home|nur im Heimnetz|solo funcionan en la red|que sur le réseau|solo sulla rete", RegexOption.IGNORE_CASE)
        for (m in mape) {
            val b = niz(m, "local_task_nedosegljiv")
            assertTrue(b != null, m.name)
            assertFalse(samoDoma.containsMatchIn(b!!), "${m.name}: $b")
            assertTrue(b.contains("Global Link"), "${m.name}: $b")
        }
    }

    @Test fun `T9 - prekinjen prenos APK prek Global Linka ima besedilo v vseh jezikih`() {
        for (m in mape) assertTrue(niz(m, "install_err_global")?.contains("Global Link") == true, m.name)
    }
}
