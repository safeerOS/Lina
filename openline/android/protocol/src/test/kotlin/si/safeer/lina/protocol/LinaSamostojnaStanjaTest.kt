package si.safeer.lina.protocol

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

class LinaSamostojnaStanjaTest {
    @Test
    fun `stanja besedil v 6 jezikih obstajajo`() {
        val langs = listOf("", "-sl", "-de", "-es", "-fr", "-it")
        val keys = listOf("lina_answers_pc", "lina_answers_local", "lina_silent_no_key")
        for (lang in langs) {
            val file = File("../app/src/main/res/values$lang/strings.xml")
            assertTrue(file.exists(), "Manjka strings.xml za jezik $lang")
            val content = file.readText()
            for (key in keys) {
                assertTrue(content.contains("<string name=\"$key\">"), "Manjka $key v values$lang")
            }
        }
    }
}
