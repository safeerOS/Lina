package si.safeer.lina.samostojna

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files

/** Slepi pregled 0214 (a), naloga 21t: vsak preizkus brez popravka pade. */
class NajdbeA0214Test {
    private val DAN = 86_400_000L
    private val zdaj = 1_800_000_000_000L
    private val json = Json { encodeDefaults = true }

    private fun star(id: String = "klic-star-1", dni: Long = 100, nacin: NacinKlica = NacinKlica.PODJETJE) = ZapisKlica(
        id = id, casZacetka = zdaj - dni * DAN, stevilka = "+99955501001", trajanjeS = 30, povzetek = "Narocilo",
        nacin = nacin, sporocilo = "Poklicite nazaj", sporociloDobesedno = "Moja davcna je 12345678, poklicite me",
        linaDobesedno = "Zapisala sem", prepis = "star prepis",
        prepisPogovora = listOf(IzmenjavaKlica("klicatelj", zdaj - dni * DAN, "Moja davcna je 12345678, poklicite me")),
    )

    private fun nov(id: String = "klic-nov-1") = ZapisKlica(id = id, casZacetka = zdaj, stevilka = "+99955501002", trajanjeS = 30, povzetek = "Klic")

    // A1: telefon brez racunalnika ima vsak zapis v vrsti; rok hrambe velja tudi zanje (zapis gre v celoti, A2).
    @Test
    fun `A1 - telefon brez racunalnika - podjetniski klic po roku izbrisan tudi iz vrste`() {
        val d = DnevnikKlicev(PomnilniskaShramba(), ura = { zdaj })
        assertTrue(d.dodaj(star()))
        assertTrue(d.dodaj(nov())) // sprozi rok hrambe
        assertTrue(d.seznam().none { it.id == "klic-star-1" }, "podjetniski klic, star 100 dni, je ostal v dnevniku")
        assertTrue(d.cakajociZaSinhronizacijo().none { it.id == "klic-star-1" }, "podjetniski klic po roku je ostal v vrsti")
    }

    @Test
    fun `A1 - zadrzan zapis (stari racunalnik) po roku izbrisan`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d.dodaj(star()))
        d.potrdiPoslane(d.cakajociZaSinhronizacijo(), prepisSprejet = false) // racunalnik 0.2.13: zapis gre med zadrzane
        assertTrue(d.dodaj(nov()))
        assertTrue(d.seznam().none { it.id == "klic-star-1" }, "zadrzan podjetniski klic po roku je ostal")
        assertFalse(shramba.preberi()!!.contains("klic-star-1"), "id zadrzanega klica po roku je ostal v shrambi")
    }

    @Test
    fun `A1 - rok hrambe velja ze ob nalaganju iz shrambe`() {
        val shramba = PomnilniskaShramba()
        assertTrue(DnevnikKlicev(shramba, ura = { zdaj - 80 * DAN }).dodaj(star(dni = 100))) // ob zapisu 20 dni star
        val ob = DnevnikKlicev(shramba, ura = { zdaj }) // 100 dni pozneje, brez novega klica
        assertTrue(ob.seznam().none { it.id == "klic-star-1" }, "rok hrambe se ob zagonu ni uveljavil")
        assertFalse(shramba.preberi()!!.contains("davcna"), "zapis po roku je ostal v datoteki")
    }

    // A2: po roku telefon ravna kot racunalnik (sinhron-telefon.server.ts:405-409): zapis gre v celoti, izbris za racunalnik ne nastane.
    @Test
    fun `A2 - po roku hrambe podjetniskega klica ne ostane nic, izbrisa za racunalnik ni`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d.dodaj(star()))
        assertTrue(d.dodaj(ZapisKlica(id = "klic-oseben-1", casZacetka = zdaj - 100 * DAN, stevilka = "+99955501004", trajanjeS = 9, povzetek = "Oseben",
            prepisPogovora = listOf(IzmenjavaKlica("klicatelj", zdaj - 100 * DAN, "Oseben pogovor")))))
        d.potrdiPoslane(d.cakajociZaSinhronizacijo(), prepisSprejet = true)
        assertTrue(d.dodaj(nov()))
        assertTrue(d.seznam().none { it.id == "klic-star-1" }, "podjetniski zapis po roku je ostal")
        listOf("12345678", "Zapisala sem", "star prepis", "Poklicite nazaj", "Narocilo").forEach { s ->
            assertFalse(shramba.preberi()!!.contains(s), "po roku je ostalo '$s' podjetniskega klica")
        }
        assertTrue(d.izbrisiZaRacunalnik().isEmpty(), "rok hrambe ne sme ustvariti izbrisa za racunalnik")
        assertEquals(1, d.seznam().count { it.id == "klic-oseben-1" && it.prepisPogovora.isNotEmpty() }, "osebni klic ostane do izbrisa")
    }

    @Test
    fun `A2 - podjetniski klic po roku z racunalnika se ne sprejme`() {
        val d = DnevnikKlicev(PomnilniskaShramba(), ura = { zdaj })
        assertEquals(0, d.sprejmiIzRacunalnika(listOf(star().zaSinhronizacijo())))
        assertTrue(d.seznam().isEmpty())
    }

    // A8: klici z racunalnika ne izrinejo lastnih; cas v prihodnosti se zavrne.
    private fun tuji(n: Int, cas: (Int) -> Long) = (1..n).map { i ->
        ZapisKlicaSinhronizacija(id = "klic-tuj-$i", casZacetka = cas(i), stevilka = "+99955509999", trajanjeS = 1, nujno = false, povzetek = "x", nacin = NacinKlica.OSEBNA)
    }

    private fun petLastnih(): DnevnikKlicev {
        val d = DnevnikKlicev(PomnilniskaShramba(), ura = { zdaj })
        repeat(5) { i -> assertTrue(d.dodaj(ZapisKlica(id = "klic-moj-$i", casZacetka = zdaj - 10 * DAN - i, stevilka = "+99955501010", trajanjeS = 30, povzetek = "Moj klic $i"))) }
        d.potrdiPoslane(d.cakajociZaSinhronizacijo(), prepisSprejet = true)
        return d
    }

    @Test
    fun `A8 - 1000 tujih klicev v prihodnosti ne izbrise lastnih`() {
        val d = petLastnih()
        d.sprejmiIzRacunalnika(tuji(MEJA_ZAPISOV_TELEFON) { 4_000_000_000_000L + it })
        assertEquals(5, d.seznam().count { it.id.startsWith("klic-moj-") })
    }

    @Test
    fun `A8 - 1000 novejsih tujih klicev (ne v prihodnosti) ne izrine lastnih`() {
        val d = petLastnih()
        d.sprejmiIzRacunalnika(tuji(MEJA_ZAPISOV_TELEFON) { zdaj - it })
        assertEquals(5, d.seznam().count { it.id.startsWith("klic-moj-") }, "lastni klici so bili izrinjeni s tujimi")
        assertEquals(MEJA_ZAPISOV_TELEFON, d.seznam().size)
    }

    @Test
    fun `A8 - lastni klici ostanejo prednostni tudi po ponovnem nalaganju`() {
        val shramba = PomnilniskaShramba()
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        repeat(5) { i -> assertTrue(d.dodaj(ZapisKlica(id = "klic-moj-$i", casZacetka = zdaj - 10 * DAN - i, stevilka = "+99955501010", trajanjeS = 30, povzetek = "Moj"))) }
        d.potrdiPoslane(d.cakajociZaSinhronizacijo(), prepisSprejet = true)
        DnevnikKlicev(shramba, ura = { zdaj }).sprejmiIzRacunalnika(tuji(MEJA_ZAPISOV_TELEFON - 5) { zdaj - it })
        val d2 = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d2.dodaj(nov()))
        assertEquals(5, d2.seznam().count { it.id.startsWith("klic-moj-") }, "po nalaganju je nov klic izrinil lastnega namesto tujega")
    }

    @Test
    fun `A8 - klic z racunalnika s casom vec kot dan v prihodnosti se zavrne`() {
        val d = DnevnikKlicev(PomnilniskaShramba(), ura = { zdaj })
        assertEquals(0, d.sprejmiIzRacunalnika(tuji(1) { zdaj + 2 * DAN }))
        assertEquals(1, d.sprejmiIzRacunalnika(tuji(1) { zdaj + DAN / 2 }), "kontrola: ura racunalnika malo naprej se sprejme")
    }

    // A7: rok hrambe pride z racunalnika (zapiskiHrambaDni), ostane ob ponovnem zagonu; neveljavna vrednost = privzeto 90 dni.
    private fun izmenjajZRokom(shramba: Shramba, rok: String, ura: Long = zdaj) =
        SinhronLine.izmenjaj(DnevnikKlicev(shramba, ura = { ura }), PomnilniskaShramba(), poslji = { """{"epoha":"00112233aabbccdd","rev":1,"zmoznosti":["prepis-v1"]$rok}""" })

    @Test
    fun `A7 - rok 30 dni z racunalnika izbrise 40 dni star podjetniski klic`() {
        val shramba = PomnilniskaShramba()
        assertTrue(DnevnikKlicev(shramba, ura = { zdaj }).dodaj(star(dni = 40)))
        assertTrue(izmenjajZRokom(shramba, ""","rokHrambeDni":30"""))
        assertTrue(DnevnikKlicev(shramba, ura = { zdaj }).seznam().none { it.id == "klic-star-1" }, "rok racunalnika 30 dni ni veljal")
    }

    @Test
    fun `A7 - rok 365 dni z racunalnika ohrani 100 dni star klic tudi ob ponovnem zagonu`() {
        val shramba = PomnilniskaShramba()
        assertTrue(DnevnikKlicev(shramba, ura = { zdaj - 90 * DAN }).dodaj(star(dni = 100))) // ob zapisu 10 dni star
        assertTrue(izmenjajZRokom(shramba, ""","rokHrambeDni":365""", ura = zdaj - 90 * DAN)) // rok pride, ko je zapis star 10 dni
        val d = DnevnikKlicev(shramba, ura = { zdaj })
        assertTrue(d.dodaj(nov()))
        assertEquals(1, d.seznam().count { it.id == "klic-star-1" && it.prepisPogovora.isNotEmpty() }, "telefon je zapis izbrisal ali izpraznil pred rokom racunalnika")
    }

    @Test
    fun `A7 - neveljaven rok z racunalnika ne velja (privzeto 90 dni)`() {
        for (rok in listOf(""","rokHrambeDni":0""", ""","rokHrambeDni":-5""", "")) {
            val shramba = PomnilniskaShramba()
            val d = DnevnikKlicev(shramba, ura = { zdaj })
            assertTrue(d.dodaj(star("a", dni = 50)))
            assertTrue(d.dodaj(star("b", dni = 95)))
            assertTrue(izmenjajZRokom(shramba, rok))
            assertEquals(listOf("a"), DnevnikKlicev(shramba, ura = { zdaj }).seznam().map { it.id }, "rok '$rok'")
        }
    }

    // A3: telefon meri prostor za prepis enako kot racunalnik (sPrepisom: osnova s prepisOkrnjen=false), da racunalnik ne okrni poslanega.
    @Test
    fun `A3 - prepis, ki ga telefon poslje, je v meji racunalnika`() {
        fun niz(n: Int) = "č".repeat(n)
        val osnova = ZapisKlica(
            id = "klic-meja-1", casZacetka = zdaj, stevilka = "+99955501003", trajanjeS = 30, povzetek = niz(2000), nacin = NacinKlica.PODJETJE,
            klicatelj = niz(240), podjetje = niz(240), sporocilo = niz(2000), sporociloDobesedno = niz(6000), brezSporocilaRazlog = niz(2000),
        )
        val b = { v: ZapisKlicaSinhronizacija -> json.encodeToString(v).toByteArray().size }
        val izmenjava = { e: IzmenjavaKlica -> json.encodeToString(e).toByteArray().size + 1 }
        // prepis tocno do stare meje telefona (osnova merjena s prepisOkrnjen=true, 1 B manj kot pri racunalniku)
        val staraMeja = minOf(MEJA_PREPISA_SINHRON_B, MEJA_ZAPISA_SINHRON_B - b(osnova.zaSinhronizacijo().copy(prepisPogovora = emptyList(), prepisOkrnjen = true)))
        val izm = ArrayList<IzmenjavaKlica>()
        var bajti = 2
        val ovoj = izmenjava(IzmenjavaKlica("klicatelj", zdaj, ""))
        while (staraMeja - bajti - ovoj > 0) {
            val n = minOf(1000, staraMeja - bajti - ovoj)
            izm.add(IzmenjavaKlica("klicatelj", zdaj, "a".repeat(n))); bajti += ovoj + n
        }
        assertEquals(staraMeja, bajti, "kontrola: prepis zapolni staro mejo")
        val s = osnova.copy(prepisPogovora = izm).zaSinhronizacijo()
        val mejaRacunalnika = minOf(MEJA_PREPISA_SINHRON_B, MEJA_ZAPISA_SINHRON_B - b(s.copy(prepisPogovora = emptyList(), prepisOkrnjen = false)))
        val poslano = 2 + s.prepisPogovora.sumOf(izmenjava)
        System.getProperty("a3.izhod")?.let { File(it).writeText(json.encodeToString(s)) }
        assertTrue(poslano <= mejaRacunalnika, "telefon poslje $poslano B prepisa, racunalnik sprejme $mejaRacunalnika B")
        assertTrue(s.prepisOkrnjen, "telefon mora sam oznaciti, da je prepis okrnil")
    }

    // A4: lastnikovo pravilo »nikoli posnetek zvoka«: stari posnetki Lininega izhoda (0.2.13) se ob zagonu izbrisejo.
    @Test
    fun `A4 - ob zagonu izbrise mapo starih posnetkov, ostalo ostane`() {
        val files = Files.createTempDirectory("lina-a4").toFile()
        try {
            val zajem = File(files, "lina_zvok/zajem").apply { mkdirs() }
            File(zajem, "lina-1.pcm").writeBytes(ByteArray(320))
            File(zajem, "pod").mkdirs(); File(zajem, "pod/lina-2.pcm").writeBytes(ByteArray(10))
            val sosed = File(files, "lina_zvok/drugo.json").apply { writeText("{}") }
            val dnevnik = File(files, "dnevnik_klicev.json").apply { writeText("{}") }
            assertTrue(izbrisiStarePosnetkeZvoka(files))
            assertFalse(zajem.exists(), "mapa s posnetki zvoka je ostala")
            assertTrue(sosed.exists() && dnevnik.exists(), "izbris je zadel druge datoteke")
            assertFalse(izbrisiStarePosnetkeZvoka(files), "drugic ni cesa brisati")
            assertFalse(izbrisiStarePosnetkeZvoka(File(files, "ne-obstaja")), "manjkajoca mapa: brez napake")
        } finally {
            files.deleteRecursively()
        }
    }

    @Test
    fun `A4 - povezava v mapi posnetkov ne izbrise cilja`() {
        val files = Files.createTempDirectory("lina-a4l").toFile()
        val zunaj = Files.createTempDirectory("lina-a4z").toFile()
        try {
            File(zunaj, "tuje.txt").writeText("ostane")
            val zajem = File(files, "lina_zvok/zajem").apply { mkdirs() }
            Files.createSymbolicLink(File(zajem, "povezava").toPath(), zunaj.toPath())
            assertTrue(izbrisiStarePosnetkeZvoka(files))
            assertFalse(zajem.exists())
            assertTrue(File(zunaj, "tuje.txt").exists(), "izbris je sledil povezavi")
        } finally {
            files.deleteRecursively(); zunaj.deleteRecursively()
        }
    }
}
