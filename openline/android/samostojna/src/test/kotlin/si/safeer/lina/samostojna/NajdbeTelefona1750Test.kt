package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Najdbe N2 (povezava v aplikaciji), N4 in N5 pregleda 1750 (telefon). Modula app lokalno ni mogoce prevesti, zato preizkus bere
 * izvorne datoteke (enako kot PostavitevTelefonTest).
 */
class NajdbeTelefona1750Test {
    private fun datoteka(pot: String) = listOf("../$pot", pot).map(::File).first { it.isFile }.readText()
    private val pogovor by lazy { datoteka("app/src/main/kotlin/si/safeer/lina/asistent/LinaPogovorPogled.kt") }
    private val klicalnik by lazy { datoteka("app/src/main/kotlin/si/safeer/lina/DialerActivity.kt") }

    /** Telo funkcije od »fun ime(« do naslednje deklaracije funkcije na isti ravni. */
    private fun telo(vir: String, ime: String): String {
        val z = vir.indexOf("fun $ime(")
        assertTrue(z >= 0, "ni funkcije $ime")
        val k = Regex("\n    (private |internal |override )?fun ").find(vir, z + 4)?.range?.first ?: vir.length
        return vir.substring(z, k)
    }

    // ------------------------------------------------------------------ N5
    @Test
    fun `N5 - potrditvena okna zavrnejo dotike skozi prekrivno plast`() {
        val pomoc = datoteka("app/src/main/kotlin/si/safeer/lina/VarnoOkno.kt")
        assertTrue(Regex("""decorView\??\.filterTouchesWhenObscured\s*=\s*true""").containsMatchIn(pomoc))
        val okna = listOf(pogovor to "potrdi", pogovor to "razloziDostop", pogovor to "potrdiDogodek",
            klicalnik to "confirmAsistent", klicalnik to "confirmAndPair")
        for ((vir, ime) in okna) {
            val t = telo(vir, ime)
            assertTrue(t.contains("setPositiveButton"), "$ime ni potrditveno okno")
            assertTrue(t.contains("pokaziVarno()"), "$ime: okno brez filterTouchesWhenObscured")
            // .show() okna (veriga v svoji vrstici ali okno.show()); Toast...show() ni okno
            assertFalse(Regex("""(^\s*|okno)\.show\(\)""", RegexOption.MULTILINE).containsMatchIn(t), "$ime: okno se pokaze brez zascite")
        }
    }

    // ------------------------------------------------------------------ N4
    @Test
    fun `N4 - opis lokalnih dokumentov v vseh jezikih pove, da model prepoznave prenesejo storitve Google Play`() {
        for (j in listOf("values", "values-sl", "values-de", "values-es", "values-fr", "values-it")) {
            val niz = Regex("""<string name="docs_info">(.*?)</string>""").find(datoteka("app/src/main/res/$j/strings.xml"))?.groupValues?.get(1)
            assertTrue(niz != null, "$j: ni docs_info")
            assertTrue(niz!!.contains("Google Play"), "$j: docs_info ne omeni storitev Google Play")
        }
    }

    // ------------------------------------------------------------------ N2 (povezava v aplikaciji)
    @Test
    fun `N2 - lokalni rezultat, besedilo iz Deli in povzetek klicev gredo Lini kot nezaupani`() {
        assertTrue(telo(pogovor, "posljiBesedilo").contains("asist.povej(vnos, binarne, nezaupano)"))
        // gumb »Poslji Lini« pod lokalnim rezultatom
        assertTrue(Regex("""docs_chat_send_prefix\).let \{ posljiBesedilo\([^\n]*nezaupano = true""").containsMatchIn(pogovor))
        // besedilo iz Deli v osnutku: naslednja poslana prosnja je nezaupana
        assertTrue(Regex("""klepetVnos\.setText\(if \(zdaj\.isEmpty\(\)\) b else "\${'$'}zdaj\\n\${'$'}b"\)\s*\n\s*deljenoVOsnutku = true""").containsMatchIn(pogovor))
        assertTrue(Regex("""posljiBesedilo\(vnos, vnos, nezaupano = nezaupano\)""").containsMatchIn(telo(pogovor, "poslji")))
        // povzetek klicev nosi besedilo klicateljev
        assertTrue(telo(pogovor, "posljiPoziv").contains("nezaupano = true"))
        // »Poskusi znova« ohrani oznako
        assertTrue(telo(pogovor, "ponovi").contains("nezaupano = nezaupanoZaPonovitev"))
    }
}
