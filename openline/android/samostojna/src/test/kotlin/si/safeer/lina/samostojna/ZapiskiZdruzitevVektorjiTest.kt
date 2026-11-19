package si.safeer.lina.samostojna

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Skupni vektorji zdruzevanja zapiskov (telefon Kotlin <-> racunalnik Python): isto datoteko
 * skupni-vektorji/zapiski-zdruzitev-v1.json mora uporabiti tudi racunalniska stran. Zdruzitev mora biti
 * komutativna (a,b in b,a dasta isti izid), da vrstni red sinhronizacije ne spremeni stanja.
 */
class ZapiskiZdruzitevVektorjiTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val seznam = ListSerializer(Zapisek.serializer())

    @Test
    fun `zdruzi ustreza skupnim vektorjem v obe smeri`() {
        val koren = json.parseToJsonElement(File("../skupni-vektorji/zapiski-zdruzitev-v1.json").readText(Charsets.UTF_8)).jsonObject
        val primeri = koren.getValue("primeri").jsonArray
        assertTrue(primeri.size >= 7, "datoteka vektorjev je prazna ali okrnjena")
        for (p in primeri) {
            val o = p.jsonObject
            val ime = o.getValue("ime").jsonPrimitive.content
            val a = json.decodeFromJsonElement(seznam, o.getValue("a"))
            val b = json.decodeFromJsonElement(seznam, o.getValue("b"))
            val pricakovano = json.decodeFromJsonElement(seznam, o.getValue("pricakovano"))
            assertEquals(pricakovano, zdruzi(a, b), "a,b: $ime")
            assertEquals(pricakovano, zdruzi(b, a), "b,a: $ime")
        }
    }
}
