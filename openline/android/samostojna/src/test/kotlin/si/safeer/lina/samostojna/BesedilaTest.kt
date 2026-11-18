package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Preizkusi za slovenska in angleska besedila ter prepoved cen in obljub brezplacnega.
class BesedilaTest {

    @Test
    fun `besedila - vsa besedila v sl in en so neprazna in se razlikujejo po jeziku`() {
        val sl = besedila(Jezik.SL)
        val en = besedila(Jezik.EN)

        assertTrue(sl.naslovMiruje.isNotBlank())
        assertTrue(sl.naslovPoslusa.isNotBlank())
        assertTrue(sl.naslovRazmislja.isNotBlank())
        assertTrue(sl.naslovGovori.isNotBlank())
        assertTrue(sl.naslovNapaka.isNotBlank())
        assertTrue(sl.naslovIzklopljena.isNotBlank())
        assertTrue(sl.stikaloVklop.isNotBlank())

        assertTrue(en.naslovMiruje.isNotBlank())
        assertTrue(en.naslovPoslusa.isNotBlank())
        assertTrue(en.naslovRazmislja.isNotBlank())
        assertTrue(en.naslovGovori.isNotBlank())
        assertTrue(en.naslovNapaka.isNotBlank())
        assertTrue(en.naslovIzklopljena.isNotBlank())
        assertTrue(en.stikaloVklop.isNotBlank())

        assertFalse(sl.naslovPoslusa == en.naslovPoslusa)
        assertFalse(sl.naslovIzklopljena == en.naslovIzklopljena)
    }

    @Test
    fun `besedila - nobeno besedilo v sl ali en ne vsebuje cen ali obljub brezplacnega`() {
        for (jezik in Jezik.values()) {
            for (niz in vsaBesedila(jezik)) {
                assertTrue(niz.isNotBlank(), "Besedilo v jeziku $jezik ne sme biti prazno")
                assertFalse(
                    vsebujeCenoAliBrezplacno(niz),
                    "Besedilo '$niz' v jeziku $jezik ne sme vsebovati cene ali obljube brezplacnega"
                )
            }
        }
    }

    @Test
    fun `vsebujeCenoAliBrezplacno - zazna zneske valute in obljube brezplacnosti`() {
        assertTrue(vsebujeCenoAliBrezplacno("Cena je 25 EUR"))
        assertTrue(vsebujeCenoAliBrezplacno("Stane 19,99 €"))
        assertTrue(vsebujeCenoAliBrezplacno("Only $10 per month"))
        assertTrue(vsebujeCenoAliBrezplacno("To vam uredimo brezplacno"))
        assertTrue(vsebujeCenoAliBrezplacno("Dostava je zastonj"))
        assertTrue(vsebujeCenoAliBrezplacno("Gratis vzorec"))
        assertTrue(vsebujeCenoAliBrezplacno("Brez doplacila"))
        assertTrue(vsebujeCenoAliBrezplacno("Podarimo vam"))
        assertTrue(vsebujeCenoAliBrezplacno("Completely free of charge"))

        assertFalse(vsebujeCenoAliBrezplacno("Poslusam"))
        assertFalse(vsebujeCenoAliBrezplacno("Asistentka je izklopljena"))
        assertFalse(vsebujeCenoAliBrezplacno("Pomoc pri klicih, sporocilih in e-posti"))
    }

    @Test
    fun `vsebujeCenoAliBrezplacno - glagol sit ni cena znesek 100 SIT pa ostane zaznan`() {
        assertFalse(vsebujeCenoAliBrezplacno("Please sit down"))
        assertFalse(vsebujeCenoAliBrezplacno("Sit back and relax"))
        assertTrue(vsebujeCenoAliBrezplacno("100 SIT"))
        assertTrue(vsebujeCenoAliBrezplacno("Cena je 500 sit"))
    }

    @Test
    fun `vsebujeCenoAliBrezplacno - zazna anglesko trditev Recording is free in dovoli free space`() {
        assertTrue(vsebujeCenoAliBrezplacno("Recording is free."))
        assertTrue(vsebujeCenoAliBrezplacno("The service is free"))
        assertFalse(vsebujeCenoAliBrezplacno("free space"))
        assertFalse(vsebujeCenoAliBrezplacno("Check available free space on device"))
    }

    @Test
    fun `besedila - slovenska prikazna besedila uporabljajo sumnike in nimajo brez-sumniskih oblik`() {
        val sl = besedila(Jezik.SL)
        assertEquals("Poslušam", sl.naslovPoslusa)
        assertEquals("Razmišljam", sl.naslovRazmislja)
        assertEquals("Sporočila", sl.gumbSporocila)
        assertTrue(sl.povezavaNiParjeno.contains("računalnikom"))
        assertTrue(sl.povezavaDomaLan.contains("domačem omrežju"))
        assertTrue(sl.povezavaNedosegljivo.startsWith("Računalnik nedosegljiv"))

        val slovenskiZaslonNizi = listOf(
            sl.naslovMiruje,
            sl.naslovPoslusa,
            sl.naslovRazmislja,
            sl.naslovGovori,
            sl.naslovNapaka,
            sl.naslovIzklopljena,
            sl.stikaloVklop,
            sl.stikaloIzklop,
            sl.gumbSporocila,
            sl.gumbSnemanje,
            sl.gumbZapri,
            sl.povezavaNiParjeno,
            sl.povezavaDomaLan,
            sl.povezavaGlobalNeposredno,
            sl.povezavaGlobalRele,
            sl.povezavaNedosegljivo
        )
        val prepovedaneOblikeBrezSumnikov = listOf(
            "poslusam",
            "razmisljam",
            "sporocila",
            "racunalnikom",
            "domacem",
            "omrezju",
            "racunalnik nedosegljiv"
        )
        for (niz in slovenskiZaslonNizi) {
            val mali = niz.lowercase()
            for (brezSumnika in prepovedaneOblikeBrezSumnikov) {
                assertFalse(
                    mali.contains(brezSumnika),
                    "Slovensko prikazno besedilo '$niz' ne sme vsebovati oblike brez sumnikov '$brezSumnika'"
                )
            }
        }
    }
}
