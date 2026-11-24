package si.safeer.lina.samostojna

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LokalniDokumentiTest {
    private fun zip(vararg vnosi: Pair<String, String>): ByteArray {
        val b = ByteArrayOutputStream()
        ZipOutputStream(b).use { z -> for ((ime, vsebina) in vnosi) { z.putNextEntry(ZipEntry(ime)); z.write(vsebina.toByteArray()); z.closeEntry() } }
        return b.toByteArray()
    }

    @Test fun `vrsta po mime in koncnici`() {
        assertEquals(VrstaDokumenta.PDF, vrstaDokumenta("racun.PDF", null))
        assertEquals(VrstaDokumenta.DOCX, vrstaDokumenta("pogodba.docx", "application/octet-stream"))
        assertEquals(VrstaDokumenta.SLIKA, vrstaDokumenta("IMG_1.jpg", "image/jpeg"))
        assertEquals(VrstaDokumenta.BESEDILO, vrstaDokumenta("zapis", "text/plain"))
        assertNull(vrstaDokumenta("logo.svg", "image/svg+xml"))
        assertNull(vrstaDokumenta("stari.doc", "application/msword"))
        assertNull(vrstaDokumenta("program.apk", null))
    }

    @Test fun `besedilo utf8 z BOM in windows-1250`() {
        assertEquals("čšž", besediloIzBajtov(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "čšž".toByteArray()))
        assertEquals("Češnja, šola in žaba", besediloIzBajtov("Češnja, šola in žaba".toByteArray(charset("windows-1250"))))
    }

    @Test fun `docx odstavki, tabulator, entitete, brez drugih oznak`() {
        val xml = """<?xml version="1.0"?><w:document><w:body><w:p><w:pPr/><w:r><w:t xml:space="preserve">Pogodba o </w:t></w:r>""" +
            """<w:r><w:t>najemu &amp; čiščenju</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B&#x10D;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>""" +
            """<w:p><w:r><w:t/><w:br/><w:t>konec &lt;3</w:t></w:r></w:p></w:body></w:document>"""
        val b = zip("[Content_Types].xml" to "<x/>", "word/document.xml" to xml)
        assertEquals("Pogodba o najemu & čiščenju\nA\tBč\n\nkonec <3", besediloDocx(b))
    }

    @Test fun `docx brez dokumenta, pokvarjen ali prevelik je null`() {
        assertNull(besediloDocx(zip("word/styles.xml" to "<x/>")))
        assertNull(besediloDocx("ni zip".toByteArray()))
        assertNull(besediloDocx(zip("word/document.xml" to "<w:t>" + "a".repeat(5000) + "</w:t>"), najvec = 1000))
    }

    @Test fun `normalizacija brez stresic in locil`() {
        assertEquals("cesnja zaba dorde 2024 strasse", normalizirajZaIskanje("Češnja, ŽABA! Đorđe – 2024 Straße"))
    }

    @Test fun `poizvedba FTS je varna in brez operatorjev`() {
        assertEquals("pogodb* najem*", poizvedbaFts("pogodbo za najem"))
        // narekovaji, stolpci, operatorji in zvezdice uporabnika ne pridejo v MATCH
        val q = poizvedbaFts("\"ime:*\" OR NEAR(x) - besedilo")!!
        assertTrue(Regex("^([a-z0-9]+\\* ?)+$").matches(q), q)
        assertEquals("ime* near* besedil*", q)
        assertNull(poizvedbaFts("in v na za"))
        assertNull(poizvedbaFts("!!! ..."))
        assertEquals(8, poizvedbaFts((1..20).joinToString(" ") { "beseda$it" })!!.split(' ').size)
    }

    @Test fun `ukaz iskanja v pogovoru`() {
        assertEquals("pogodbo za najem", zahtevaIskanjaVDokumentih("Poišči v mojih dokumentih pogodbo za najem"))
        assertEquals("racun elektro", zahtevaIskanjaVDokumentih("poisci v dokumentih: račun Elektro"))
        assertEquals("garancija", zahtevaIskanjaVDokumentih("Lina, v mojih dokumentih najdi garancija"))
        assertEquals("invoice", zahtevaIskanjaVDokumentih("Search my documents for invoice"))
        assertEquals("rechnung", zahtevaIskanjaVDokumentih("Suche in meinen Dokumenten nach Rechnung"))
        assertEquals("factura", zahtevaIskanjaVDokumentih("Busca en mis documentos factura"))
        assertEquals("facture", zahtevaIskanjaVDokumentih("Cherche dans mes documents facture"))
        assertEquals("fattura", zahtevaIskanjaVDokumentih("Cerca nei miei documenti fattura"))
        // obicajna vprasanja ostanejo Lini
        assertNull(zahtevaIskanjaVDokumentih("Poišči mi recept za potico"))
        assertNull(zahtevaIskanjaVDokumentih("Kaj piše v dokumentih o dopustu?"))
        assertNull(zahtevaIskanjaVDokumentih("poišči v mojih dokumentih"))
    }

    @Test fun `razrez na kose`() {
        val besedilo = (1..500).joinToString(" ") { "beseda$it" }
        val kosi = razreziZaIndeks(besedilo, 300)
        assertTrue(kosi.all { it.length <= 300 })
        assertEquals(besedilo.split(' '), kosi.flatMap { it.split(' ') })
        assertEquals(emptyList(), razreziZaIndeks("   ", 100))
    }

    @Test fun `izrezek okoli zadetka s sumniki`() {
        val besedilo = "x ".repeat(200) + "Najemna pogodba za stanovanje v Ljubljani. " + "y ".repeat(200)
        val izrezek = izrezekZadetka(besedilo, "pogodb*", 60)
        assertTrue("pogodba" in izrezek && izrezek.startsWith("…") && izrezek.endsWith("…"), izrezek)
        assertTrue("Žiga" in izrezekZadetka("Račun za Žiga Novak", "ziga*"))
    }
}
