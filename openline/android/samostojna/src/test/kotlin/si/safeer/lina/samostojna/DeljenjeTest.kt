package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class DeljenjeTest {
    private val lastne = setOf("si.safeer.lina.posnetek")
    private val galerija = "content" to "com.sec.android.gallery3d.provider"

    private fun odloci(
        akcija: String? = AKCIJA_DELI, mime: String? = "image/jpeg", naslovi: List<Pair<String?, String?>> = listOf(galerija),
        besedilo: String? = null, vklopljeno: Boolean = true, ze: Int = 0,
    ) = odlociDeljenje(akcija, mime, naslovi, besedilo, vklopljeno, ze, lastne)

    @Test fun vrste() {
        assertTrue(sprejemljivaVrstaDeljenja("image/jpeg"))
        assertTrue(sprejemljivaVrstaDeljenja("image/*"))
        assertTrue(sprejemljivaVrstaDeljenja("Application/PDF"))
        assertTrue(sprejemljivaVrstaDeljenja("text/plain; charset=utf-8"))
        assertFalse(sprejemljivaVrstaDeljenja("video/mp4"))
        assertFalse(sprejemljivaVrstaDeljenja("*/*"))
        assertFalse(sprejemljivaVrstaDeljenja("image/"))
        assertFalse(sprejemljivaVrstaDeljenja("application/vnd.android.package-archive"))
        assertFalse(sprejemljivaVrstaDeljenja(null))
    }

    @Test fun samoTujiContentNaslovi() {
        assertTrue(dovoljenNaslovDeljenja("content", "media", lastne))
        assertFalse(dovoljenNaslovDeljenja("file", "", lastne))
        assertFalse(dovoljenNaslovDeljenja("FILE", null, lastne))
        assertFalse(dovoljenNaslovDeljenja("content", "SI.SAFEER.LINA.POSNETEK", lastne))
        assertFalse(dovoljenNaslovDeljenja("content", "", lastne))
        assertFalse(dovoljenNaslovDeljenja(null, "media", lastne))
        assertFalse(dovoljenNaslovDeljenja("content", "10@si.safeer.lina.posnetek", lastne))
    }

    @Test fun sistemskiPonudnikiZasebnihPodatkovSeZavrnejo() {
        for (a in listOf("com.android.contacts", "Com.Android.Calendar", "call_log", "sms", "0@com.android.contacts")) {
            assertFalse(dovoljenNaslovDeljenja("content", a, lastne), a)
        }
        assertTrue(dovoljenNaslovDeljenja("content", "com.google.android.apps.photos.contentprovider", lastne))
    }

    @Test fun drugeAkcijeNisoDeljenje() {
        assertIs<OdlocitevDeljenja.NiDeljenje>(odloci(akcija = "android.intent.action.MAIN"))
        assertIs<OdlocitevDeljenja.NiDeljenje>(odloci(akcija = null))
        // Tudi izklopljeno stikalo ne spremeni obdelave drugih namenov.
        assertIs<OdlocitevDeljenja.NiDeljenje>(odloci(akcija = "android.intent.action.VIEW", vklopljeno = false))
    }

    @Test fun enaSlikaSeSprejme() {
        assertEquals(OdlocitevDeljenja.Sprejmi(listOf(0), 0, 0, null), odloci())
    }

    @Test fun izklopljenoZavrne() {
        assertEquals(OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.IZKLOPLJENO), odloci(vklopljeno = false))
        assertEquals(OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.IZKLOPLJENO), odloci(akcija = AKCIJA_DELI_VEC, vklopljeno = false))
    }

    @Test fun nepodprtaVrstaZavrne() {
        assertEquals(OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.NEPODPRTA_VRSTA), odloci(mime = "video/mp4"))
        assertEquals(OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.NEPODPRTA_VRSTA), odloci(mime = null))
    }

    @Test fun mejaPriponk() {
        val sedem = List(7) { galerija }
        assertEquals(OdlocitevDeljenja.Sprejmi((0 until NAJVEC_PRIPONK).toList(), 7 - NAJVEC_PRIPONK, 0, null), odloci(AKCIJA_DELI_VEC, naslovi = sedem))
        // Dve ze izbrani: prostora je za tri.
        assertEquals(OdlocitevDeljenja.Sprejmi(listOf(0, 1, 2), 4, 0, null), odloci(AKCIJA_DELI_VEC, naslovi = sedem, ze = 2))
        // Polno: nic ne preberemo, vse je cez mejo.
        assertEquals(OdlocitevDeljenja.Sprejmi(emptyList(), 1, 0, null), odloci(ze = NAJVEC_PRIPONK))
        assertEquals(OdlocitevDeljenja.Sprejmi(emptyList(), 1, 0, null), odloci(ze = NAJVEC_PRIPONK + 3))
    }

    @Test fun nedovoljeniNasloviSePreskocijoInStejejo() {
        val naslovi = listOf("file" to null, galerija, "content" to "si.safeer.lina.posnetek", galerija)
        assertEquals(OdlocitevDeljenja.Sprejmi(listOf(1, 3), 0, 2, null), odloci(AKCIJA_DELI_VEC, naslovi = naslovi))
        // Sam file:// ni tiho prazen: lastnik izve, da ni bil sprejet.
        assertEquals(OdlocitevDeljenja.Sprejmi(emptyList(), 0, 1, null), odloci(naslovi = listOf("file" to null)))
    }

    @Test fun besediloGreVPolje() {
        val izid = odloci(mime = "text/plain", naslovi = emptyList(), besedilo = "  https://primer.si/clanek\u0000 ")
        assertEquals(OdlocitevDeljenja.Sprejmi(emptyList(), 0, 0, "https://primer.si/clanek"), izid)
        val dolgo = odloci(mime = "text/plain", naslovi = emptyList(), besedilo = "a".repeat(NAJVEC_ZNAKOV_DELJENEGA_BESEDILA + 50))
        assertEquals(NAJVEC_ZNAKOV_DELJENEGA_BESEDILA, (dolgo as OdlocitevDeljenja.Sprejmi).besedilo!!.length)
        // Vrstice ostanejo.
        assertEquals("a\nb", (odloci(mime = "text/plain", naslovi = emptyList(), besedilo = "a\nb") as OdlocitevDeljenja.Sprejmi).besedilo)
    }

    @Test fun praznoZavrne() {
        assertEquals(OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.PRAZNO), odloci(naslovi = emptyList()))
        assertEquals(OdlocitevDeljenja.Zavrni(ZavrnitevDeljenja.PRAZNO), odloci(mime = "text/plain", naslovi = emptyList(), besedilo = "   "))
    }
}
