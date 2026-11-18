package si.safeer.lina.samostojna

import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Barve aplikacije (app/res/values*/colors.xml) so iz enega vira: Teme.kt (Aura). Brez tega se videz po datotekah razhaja.
class ColorsXmlTest {
    private fun preberi(pot: String): Map<String, String> {
        val f = File("../app/src/main/res/$pot/colors.xml")
        assertTrue(f.isFile, "manjka ${f.path}")
        return Regex("<color name=\"([a-z_]+)\">(#[0-9A-Fa-f]{6,8})</color>").findAll(f.readText())
            .associate { it.groupValues[1] to it.groupValues[2].uppercase() }
    }

    @Test
    fun `temna in svetla paleta aplikacije se ujemata s tokeni Aura`() {
        for ((mapa, b) in listOf("values-night" to barve(Tema.TEMNA), "values" to barve(Tema.SVETLA))) {
            val c = preberi(mapa)
            assertEquals(b.ozadje, c["paper"], "$mapa paper")
            assertEquals(b.povrsina, c["surface"], "$mapa surface")
            assertEquals(b.povrsina2, c["soft"], "$mapa soft")
            assertEquals(b.besedilo, c["ink"], "$mapa ink")
            assertEquals(b.tiho, c["muted"], "$mapa muted")
            assertEquals(b.poudarekCian, c["accent"], "$mapa accent")
            assertEquals(b.rozaSnemanje, c["record"], "$mapa record")
            assertEquals(b.napaka, c["bad"], "$mapa bad")
        }
    }

    @Test
    fun `pari besedilo proti ozadju v aplikaciji imajo kontrast vsaj 4_5 in obrobe polj vsaj 3`() {
        for (mapa in listOf("values-night", "values")) {
            val c = preberi(mapa)
            val pari = listOf("ink" to "paper", "ink" to "surface", "muted" to "paper", "muted" to "surface",
                "on_accent" to "accent", "on_bad" to "bad", "accent" to "paper", "accent" to "surface")
            for ((a, b) in pari) assertTrue(kontrast(c.getValue(a), c.getValue(b)) >= 4.5, "$mapa $a/$b = ${kontrast(c.getValue(a), c.getValue(b))}")
            assertTrue(kontrast(c.getValue("line"), c.getValue("surface")) >= 3.0, "$mapa line/surface = ${kontrast(c.getValue("line"), c.getValue("surface"))}")
        }
    }
}
