package si.safeer.lina.samostojna

import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Prenova telefona (NAVODILA-SEJA-LINA-TELEFON-UI-2211.md, 22. 11. 2026): Domov brez drsnega vsebnika, Pogovor s pripetim poljem
 * nad tipkovnico (zunaj drsnih obmocij), spodaj 4 enakovredni zavihki brez sredinske pilule. Preizkus bere postavitev aplikacije.
 */
class PostavitevTelefonTest {
    private val ns = "http://schemas.android.com/apk/res/android"
    private val datoteka = listOf("../app/src/main/res/layout/activity_dialer.xml", "app/src/main/res/layout/activity_dialer.xml").map(::File).first { it.isFile }
    private val dok = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(datoteka)

    private fun poId(id: String): Element {
        val vsi = dok.getElementsByTagName("*")
        for (i in 0 until vsi.length) {
            val e = vsi.item(i) as Element
            if (e.getAttributeNS(ns, "id") == "@+id/$id") return e
        }
        error("ni $id")
    }

    private fun prednikiImajo(e: Element, oznaka: String): Boolean {
        var p = e.parentNode
        while (p is Element) { if (p.tagName == oznaka) return true; p = p.parentNode }
        return false
    }

    @Test fun `Domov in Pogovor nista v drsnem obmocju, Domov sam nima drsnika`() {
        val domov = poId("tabHome")
        assertTrue(!prednikiImajo(domov, "ScrollView"), "Domov je v ScrollView")
        assertEquals(0, domov.getElementsByTagName("ScrollView").length, "Domov ne sme drseti")
        assertTrue(!prednikiImajo(poId("tabLina"), "ScrollView"))
    }

    @Test fun `polje za pisanje je pripeto zunaj drsnih obmocij, z mikrofonom in gumbom Poslji`() {
        val polje = poId("assistantChatInput")
        assertTrue(!prednikiImajo(polje, "ScrollView"), "polje je v ScrollView (tipkovnica ga prekrije)")
        val vrstica = polje.parentNode as Element
        assertEquals("@+id/assistantComposer", vrstica.getAttributeNS(ns, "id"))
        assertTrue(!prednikiImajo(poId("assistantChatSend"), "ScrollView"))
        assertTrue(!prednikiImajo(poId("assistantChatMic"), "ScrollView"))
        assertEquals("52dp", poId("assistantChatSend").getAttributeNS(ns, "layout_width"), "cilj dotika vsaj 48 dp")
    }

    @Test fun `spodaj 4 enakovredni zavihki brez pilule`() {
        val nav = poId("navBar")
        val gumbi = (0 until nav.childNodes.length).map { nav.childNodes.item(it) }.filterIsInstance<Element>()
        val vidni = gumbi.filter { it.getAttributeNS(ns, "visibility") != "gone" }
        assertEquals(listOf("navHome", "navCalls", "navLina", "navNotes"), vidni.map { it.getAttributeNS(ns, "id").removePrefix("@+id/") })
        for (g in vidni) {
            assertEquals("@style/Gw.Nav", g.getAttribute("style"), g.getAttributeNS(ns, "id"))
            assertEquals("1", g.getAttributeNS(ns, "layout_weight"))
        }
    }

    /** Sesutje na Samsungu 22. 11. 2026: polje v fokusu zunaj drsnega obmocja (IllegalArgumentException). */
    @Test fun `pomik nad tipkovnico preveri, da je pogled v drsnem obmocju`() {
        val f = listOf("../app/src/main/kotlin/si/safeer/lina/DialerActivity.kt", "app/src/main/kotlin/si/safeer/lina/DialerActivity.kt").map(::File).first { it.isFile }
        val koda = f.readText()
        val telo = koda.substringAfter("private fun pokaziVDrsnemObmocju").substringBefore("val r = android.graphics.Rect()")
        assertTrue("if (!jePotomec(drsno, pogled)) return" in telo)
    }
}
