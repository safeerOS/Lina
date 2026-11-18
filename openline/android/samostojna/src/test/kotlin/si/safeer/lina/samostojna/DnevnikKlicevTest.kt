package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files

class DnevnikKlicevTest {

    @Test
    fun `zapisInBranje - ZapisKlica se pravilno shrani v Shramba in prebere nazaj z vsemi polji`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        val klicOsebna = ZapisKlica(
            id = "klic-1",
            casZacetka = 1_700_000_100_000L,
            stevilka = "+38640111222",
            trajanjeS = 45,
            nujno = false,
            povzetek = "Klicatelj Luka sprasuje, kdaj se vrnete.",
            prepis = "Dober dan, tukaj Lina. Kako vam lahko pomagam?",
            nacin = NacinKlica.OSEBNA
        )
        val klicPodjetje = ZapisKlica(
            id = "klic-2",
            casZacetka = 1_700_000_200_000L,
            stevilka = "+38641333444",
            trajanjeS = 120,
            nujno = true,
            povzetek = "Povprasevanje za 2 hrastovi mizi, rok do petka.",
            prepis = "Narocam dve hrastovi mizi, nujno rabim odgovor danes.",
            nacin = "podjetje"
        )

        assertTrue(dnevnik.dodaj(klicOsebna))
        assertTrue(dnevnik.dodaj(klicPodjetje))

        // Ustvarimo nov dnevnik nad isto shrambo, da preverimo dejansko branje iz shrambe
        val prebranDnevnik = DnevnikKlicev(shramba)
        val vsi = prebranDnevnik.seznamPoDatumu()
        assertEquals(2, vsi.size)

        val prvi = vsi[0]
        assertEquals("klic-2", prvi.id)
        assertEquals(1_700_000_200_000L, prvi.casZacetka)
        assertEquals("+38641333444", prvi.stevilka)
        assertEquals(120, prvi.trajanjeS)
        assertTrue(prvi.nujno)
        assertEquals("Povprasevanje za 2 hrastovi mizi, rok do petka.", prvi.povzetek)
        assertEquals("Narocam dve hrastovi mizi, nujno rabim odgovor danes.", prvi.prepis)
        assertEquals(NacinKlica.PODJETJE, prvi.nacin)

        val drugi = vsi[1]
        assertEquals("klic-1", drugi.id)
        assertEquals(NacinKlica.OSEBNA, drugi.nacin)
        assertEquals("Dober dan, tukaj Lina. Kako vam lahko pomagam?", drugi.prepis)
    }

    @Test
    fun `datotecnaShramba - zapis in branje v lokalno datoteko na disku`() {
        val zacasnaMapa = Files.createTempDirectory("lina-dnevnik-test").toFile()
        try {
            val datoteka = File(zacasnaMapa, "dnevnik-klicev.json")
            val shramba = DatotecnaShramba(datoteka)
            val dnevnik = DnevnikKlicev(shramba)

            val klic = ZapisKlica(
                id = "disk-1",
                casZacetka = 1_700_000_500_000L,
                stevilka = "+38631999888",
                trajanjeS = 60,
                nujno = false,
                povzetek = "Sporocilo za direktorja glede sestanka.",
                prepis = "Prosim, naj me direktor poklice nazaj po 14. uri.",
                nacin = NacinKlica.PODJETJE
            )
            assertTrue(dnevnik.dodaj(klic))
            assertTrue(datoteka.exists())

            val znova = DnevnikKlicev(DatotecnaShramba(datoteka))
            val zapisi = znova.seznamPoDatumu()
            assertEquals(1, zapisi.size)
            assertEquals("disk-1", zapisi[0].id)
            assertEquals("Prosim, naj me direktor poklice nazaj po 14. uri.", zapisi[0].prepis)
        } finally {
            zacasnaMapa.deleteRecursively()
        }
    }

    @Test
    fun `datotecnaShramba - obstojeca datoteka, ki je ni mogoce prebrati, ni prazen dnevnik in je zapis ne prepise (F6 pregled, najdba 1)`() {
        val zacasnaMapa = Files.createTempDirectory("lina-dnevnik-nepreberljiv").toFile()
        val datoteka = File(zacasnaMapa, "dnevnik-klicev.json")
        try {
            val prvi = DnevnikKlicev(DatotecnaShramba(datoteka))
            assertTrue(prvi.dodaj(ZapisKlica(id = "star-1", casZacetka = 1_700_000_700_000L, stevilka = "+38640123456", trajanjeS = 30, nujno = false, povzetek = "Star klic.", prepis = "Star klic za ohranitev.", nacin = NacinKlica.OSEBNA)))
            val vsebinaPrej = datoteka.readText()
            assertTrue(datoteka.setReadable(false, false))
            // root datoteko vedno prebere: preizkus je tam brez pomena
            org.junit.jupiter.api.Assumptions.assumeFalse(datoteka.canRead(), "datoteke ni mogoce narediti nepreberljive (root?)")

            val dnevnik = DnevnikKlicev(DatotecnaShramba(datoteka))
            // branje je spodletelo: to NI prazen dnevnik, zato pisanje ne sme prepisati obstojece datoteke
            assertFalse(dnevnik.dodaj(ZapisKlica(id = "nov-1", casZacetka = 1_700_000_800_000L, stevilka = "+38640654321", trajanjeS = 10, nujno = false, povzetek = "Nov klic.", prepis = "Nov klic.", nacin = NacinKlica.OSEBNA)))

            assertTrue(datoteka.setReadable(true, false))
            assertEquals(vsebinaPrej, datoteka.readText(), "datoteka se ne sme spremeniti")
        } finally {
            datoteka.setReadable(true, false)
            zacasnaMapa.deleteRecursively()
        }
    }

    @Test
    fun `serializacijaJson - krozna pretvorba ZapisKlica v JSON ohrani vsa polja in nacin`() {
        val zapis = ZapisKlica(
            id = "json-1",
            casZacetka = 1_700_000_300_000L,
            stevilka = "+38651222333",
            trajanjeS = 75,
            nujno = true,
            povzetek = "Nujno povprasevanje: češnja in hrast",
            prepis = "Prepis pogovora s šumniki čšž",
            nacin = NacinKlica.PODJETJE
        )

        val json = zapisKlicaVJson(zapis)
        assertTrue(json.contains("\"podjetje\""))
        val prebran = zapisKlicaIzJson(json)
        assertNotNull(prebran)
        assertEquals(zapis, prebran)
    }

    @Test
    fun `vrstniRedInSeznamPoDatumu - navadni zapisi so urejeni od najnovejsega proti najstarejsemu`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        dnevnik.dodaj(
            ZapisKlica("k1", 1000L, "+38640000001", 30, false, "Prvi klic", "Prepis 1", NacinKlica.OSEBNA)
        )
        dnevnik.dodaj(
            ZapisKlica("k3", 3000L, "+38640000003", 50, false, "Tretji klic", "Prepis 3", NacinKlica.PODJETJE)
        )
        dnevnik.dodaj(
            ZapisKlica("k2", 2000L, "+38640000002", 40, false, "Drugi klic", "Prepis 2", NacinKlica.OSEBNA)
        )

        val seznam = dnevnik.seznamPoDatumu()
        assertEquals(listOf("k3", "k2", "k1"), seznam.map { it.id })
    }

    @Test
    fun `nujniNaVrhu - nujni klici so vedno na vrhu seznama in imajo rdeco oznako ter napis Nujno`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        val navadenNovejsi = ZapisKlica(
            id = "navaden-novejsi",
            casZacetka = 5000L,
            stevilka = "+38640100100",
            trajanjeS = 40,
            nujno = false,
            povzetek = "Navadno povprasevanje za mizo",
            prepis = "Zanima me hrastova miza.",
            nacin = NacinKlica.PODJETJE
        )
        val nujenStarejsi = ZapisKlica(
            id = "nujen-starejsi",
            casZacetka = 2000L,
            stevilka = "+38640200200",
            trajanjeS = 60,
            nujno = true,
            povzetek = "Nujno: rabim odgovor danes glede dobave",
            prepis = "Nujno je, rabim odgovor danes.",
            nacin = NacinKlica.PODJETJE
        )
        val nujenNovejsi = ZapisKlica(
            id = "nujen-novejsi",
            casZacetka = 4000L,
            stevilka = "+38640300300",
            trajanjeS = 55,
            nujno = true,
            povzetek = "Nujno sporocilo za direktorja",
            prepis = "Nujno poklicite nazaj danes.",
            nacin = NacinKlica.PODJETJE
        )

        dnevnik.dodaj(navadenNovejsi)
        dnevnik.dodaj(nujenStarejsi)
        dnevnik.dodaj(nujenNovejsi)

        val seznam = dnevnik.seznamPoDatumu()
        assertEquals(listOf("nujen-novejsi", "nujen-starejsi", "navaden-novejsi"), seznam.map { it.id })

        // Preverimo rdeco oznako in napis "Nujno" (kot na racunalniku)
        val prikazNujnega = prikazZapisaKlica(seznam[0], Tema.TEMNA, Jezik.SL)
        assertTrue(prikazNujnega.rdecaOznaka)
        assertEquals("Nujno", prikazNujnega.napisNujno)
        assertEquals(barve(Tema.TEMNA).napaka, prikazNujnega.barvaOznake)

        val prikazNavadnega = prikazZapisaKlica(seznam[2], Tema.TEMNA, Jezik.SL)
        assertFalse(prikazNavadnega.rdecaOznaka)
        assertEquals("", prikazNavadnega.napisNujno)
        assertNull(prikazNavadnega.barvaOznake)
    }

    @Test
    fun `iskanje - najde klice po stevilki povzetku prepisu in nacinu ter ohrani nujne na vrhu`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        dnevnik.dodaj(
            ZapisKlica(
                id = "i1",
                casZacetka = 3000L,
                stevilka = "+38640555111",
                trajanjeS = 40,
                nujno = false,
                povzetek = "Ana Novak: povprasevanje za bukov stol",
                prepis = "Zanima me deset bukovih stolov.",
                nacin = NacinKlica.PODJETJE
            )
        )
        dnevnik.dodaj(
            ZapisKlica(
                id = "i2",
                casZacetka = 1000L,
                stevilka = "+38640555222",
                trajanjeS = 80,
                nujno = true,
                povzetek = "Marko Kralj: nujno sporocilo glede bukove mize",
                prepis = "Poklicite me glede bukovih izdelkov.",
                nacin = NacinKlica.PODJETJE
            )
        )
        dnevnik.dodaj(
            ZapisKlica(
                id = "i3",
                casZacetka = 2000L,
                stevilka = "+38631777888",
                trajanjeS = 25,
                nujno = false,
                povzetek = "Osebni klic prijatelja",
                prepis = "Se vidiva zvecer.",
                nacin = NacinKlica.OSEBNA
            )
        )

        // Iskanje po besedi v povzetku/prepisu: nujni klic (i2) mora biti pred navadnim (i1)
        val zadetkiBukov = dnevnik.poisci("bukov")
        assertEquals(listOf("i2", "i1"), zadetkiBukov.map { it.id })

        // Iskanje po telefonski stevilki
        val zadetkiStevilka = dnevnik.poisci("777888")
        assertEquals(listOf("i3"), zadetkiStevilka.map { it.id })

        // Iskanje po besedi samo v prepisu
        val zadetkiPrepis = dnevnik.poisci("zvecer")
        assertEquals(listOf("i3"), zadetkiPrepis.map { it.id })

        // Prazna poizvedba vrne prazen seznam
        assertTrue(dnevnik.poisci("   ").isEmpty())
    }

    @Test
    fun `brisanjeSamoNaUporabnikovoZahtevo - brez potrditve uporabnika izbris zavrne`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        dnevnik.dodaj(
            ZapisKlica("b1", 1000L, "+38640111222", 30, false, "Klic 1", "Prepis 1", NacinKlica.OSEBNA)
        )

        // Brez izrecne zahteve/potrditve uporabnika se zapis NE izbrise
        assertFalse(dnevnik.izbrisi("b1", potrditevUporabnika = false))
        assertFalse(dnevnik.izbrisi("b1"))
        assertEquals(1, dnevnik.seznamPoDatumu().size)

        // Z izrecno potrditvijo uporabnika se zapis izbrise in shrani v Shramba
        assertTrue(dnevnik.izbrisi("b1", potrditevUporabnika = true))
        assertTrue(dnevnik.seznamPoDatumu().isEmpty())
        assertTrue(DnevnikKlicev(shramba).seznamPoDatumu().isEmpty())
    }

    @Test
    fun `zasebnostCeneInObljube - v dnevnik ne gre nobena cena ali obljuba`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        val zCeno = ZapisKlica(
            id = "cena-1",
            casZacetka = 1000L,
            stevilka = "+38640111222",
            trajanjeS = 30,
            nujno = false,
            povzetek = "Miza stane 450 EUR.",
            prepis = "Veljaven prepis",
            nacin = NacinKlica.PODJETJE
        )
        val zBrezplacno = ZapisKlica(
            id = "cena-2",
            casZacetka = 2000L,
            stevilka = "+38640111222",
            trajanjeS = 30,
            nujno = false,
            povzetek = "Povprasevanje za omaro",
            prepis = "Dostava je brezplacna in brez doplacila.",
            nacin = NacinKlica.PODJETJE
        )
        val zObljubo = ZapisKlica(
            id = "obljuba-1",
            casZacetka = 3000L,
            stevilka = "+38640111222",
            trajanjeS = 30,
            nujno = false,
            povzetek = "Narocilo je potrjeno, obljubimo dostavo jutri.",
            prepis = "Klicatelj naroca mizo.",
            nacin = NacinKlica.PODJETJE
        )

        assertFalse(dnevnik.dodaj(zCeno))
        assertFalse(dnevnik.dodaj(zBrezplacno))
        assertFalse(dnevnik.dodaj(zObljubo))
        assertTrue(dnevnik.seznamPoDatumu().isEmpty())
    }

    @Test
    fun `zasebnostPrepisOstaneNaTelefonu - vrsta za sinhronizacijo ne vsebuje prepisa`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        val klic = ZapisKlica(
            id = "sync-1",
            casZacetka = 1000L,
            stevilka = "+38640999000",
            trajanjeS = 90,
            nujno = true,
            povzetek = "Povprasevanje za 4 stole, nujno.",
            prepis = "ZAUPNI PREPIS POGOVORA KI MORA OSTATI SAMO NA TELEFONU",
            nacin = NacinKlica.PODJETJE
        )
        assertTrue(dnevnik.dodaj(klic))

        // Na telefonu je prepis ohranjen
        assertEquals("ZAUPNI PREPIS POGOVORA KI MORA OSTATI SAMO NA TELEFONU", dnevnik.seznamPoDatumu()[0].prepis)

        // V vrsti za sinhronizacijo z racunalnikom in v JSON paketu za sinhronizacijo prepisa NI
        val cakajoci = dnevnik.cakajociZaSinhronizacijo()
        assertEquals(1, cakajoci.size)
        val syncJson = dnevnik.vJsonZaSinhronizacijo()
        assertFalse(syncJson.contains("ZAUPNI PREPIS POGOVORA"))
        assertFalse(syncJson.contains("\"prepis\""))
        assertTrue(syncJson.contains("Povprasevanje za 4 stole"))
    }

    @Test
    fun `delujeBrezRacunalnikaInBrezOmrezja - nobena operacija dnevnika ne klice omrezja`() {
        val sleparskiOdjemalec = LokalniPreizkusniOdjemalec {
            fail("DnevnikKlicev ne sme nikoli klicati omrezja ali racunalnika med lokalnim delom!")
        }
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba, sleparskiOdjemalec)

        assertTrue(
            dnevnik.dodaj(
                ZapisKlica("loc-1", 1000L, "+38640123456", 45, true, "Nujno sporocilo", "Prepis", NacinKlica.OSEBNA)
            )
        )
        assertEquals(1, dnevnik.seznamPoDatumu().size)
        assertEquals(1, dnevnik.poisci("Nujno").size)
        assertEquals(1, dnevnik.cakajociZaSinhronizacijo().size)
        assertTrue(dnevnik.izbrisi("loc-1", potrditevUporabnika = true))
    }

    @Test
    fun `sinhronizacijaSamoVOzadjuNikoliMedKlicem - med klicem ali uporabo asistentke sinhronizacija zavrnjena`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        dnevnik.dodaj(
            ZapisKlica("s1", 1000L, "+38640111222", 30, false, "Klic za sinhronizacijo", "Prepis", NacinKlica.PODJETJE)
        )

        var steviloKlicevPosiljatelja = 0

        // Med aktivnim telefonskim klicem: nikoli ne sinhronizira
        val medKlicem = dnevnik.poskusiSinhronizacijoVOzadju(
            medKlicem = true,
            uporabljaAsistentko = false,
            povezava = PovezavaStanje.DOMA_LAN
        ) {
            steviloKlicevPosiljatelja++
            true
        }
        assertFalse(medKlicem)
        assertEquals(0, steviloKlicevPosiljatelja)
        assertEquals(1, dnevnik.cakajociZaSinhronizacijo().size)

        // Ko uporabnik uporablja asistentko: ne sinhronizira
        val medPogovorom = dnevnik.poskusiSinhronizacijoVOzadju(
            medKlicem = false,
            uporabljaAsistentko = true,
            povezava = PovezavaStanje.GLOBAL_NEPOSREDNO
        ) {
            steviloKlicevPosiljatelja++
            true
        }
        assertFalse(medPogovorom)
        assertEquals(0, steviloKlicevPosiljatelja)

        // Ko ni povezave (NI_PARJENO ali NEDOSEGLJIVO): ne sinhronizira
        val brezPoti = dnevnik.poskusiSinhronizacijoVOzadju(
            medKlicem = false,
            uporabljaAsistentko = false,
            povezava = PovezavaStanje.NEDOSEGLJIVO
        ) {
            steviloKlicevPosiljatelja++
            true
        }
        assertFalse(brezPoti)
        assertEquals(0, steviloKlicevPosiljatelja)

        // V ozadju (ni klica, uporabnik ne uporablja asistentke, pot na voljo): sinhronizira in izprazni vrsto
        val vOzadju = dnevnik.poskusiSinhronizacijoVOzadju(
            medKlicem = false,
            uporabljaAsistentko = false,
            povezava = PovezavaStanje.GLOBAL_NEPOSREDNO
        ) { zapisi ->
            steviloKlicevPosiljatelja++
            assertEquals(1, zapisi.size)
            assertEquals("s1", zapisi[0].id)
            true
        }
        assertTrue(vOzadju)
        assertEquals(1, steviloKlicevPosiljatelja)
        assertTrue(dnevnik.cakajociZaSinhronizacijo().isEmpty())
    }

    @Test
    fun `poskodovanaDatoteka - varna zavrnitev brez izgube ostalih zapisov`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        val prvi = ZapisKlica("v1", 1000L, "+38640111111", 20, false, "Prvi veljaven zapis", "Prepis 1", NacinKlica.OSEBNA)
        val drugi = ZapisKlica("v2", 2000L, "+38640222222", 35, true, "Drugi nujen zapis", "Prepis 2", NacinKlica.PODJETJE)
        assertTrue(dnevnik.dodaj(prvi))
        assertTrue(dnevnik.dodaj(drugi))

        // 1. Scenarij: datoteka v shrambi se poskoduje (okrnjen JSON) med delovanjem
        shramba.shrani("{\"verzija\":1,\"zapisi\":[{\"id\":\"v1\", POSKODOVANO")
        assertFalse(dnevnik.naloziIzShrambe())
        // Obstojeca zapisa v dnevniku se NE izgubita
        assertEquals(2, dnevnik.seznamPoDatumu().size)

        // Ko dodamo nov veljaven zapis, se shramba popravi z vsemi tremi zapisi brez izgube
        val tretji = ZapisKlica("v3", 3000L, "+38640333333", 50, false, "Tretji veljaven zapis", "Prepis 3", NacinKlica.PODJETJE)
        assertTrue(dnevnik.dodaj(tretji))
        assertEquals(3, DnevnikKlicev(shramba).seznamPoDatumu().size)

        // 2. Scenarij: datoteka vsebuje seznam zapisov, kjer je en zapis poskodovan/neveljaven, ostala dva pa sta veljavna
        val delnoPoskodovanJson = """
            {
              "verzija": 1,
              "zapisi": [
                {"id":"ok-1","casZacetka":1500,"stevilka":"+38640111222","trajanjeS":25,"nujno":false,"povzetek":"Veljaven prvi","prepis":"P1","nacin":"osebna"},
                {"id":"pokvarjen","casZacetka":"NI_STEVILO","stevilka":""},
                {"id":"nedovoljena-cena","casZacetka":1800,"stevilka":"+38640111333","trajanjeS":30,"nujno":false,"povzetek":"Cena je 200 EUR","prepis":"P","nacin":"podjetje"},
                {"id":"ok-2","casZacetka":2500,"stevilka":"+38640999888","trajanjeS":40,"nujno":true,"povzetek":"Veljaven drugi nujen","prepis":"P2","nacin":"podjetje"}
              ]
            }
        """.trimIndent()

        val shrambaDelno = PomnilniskaShramba(delnoPoskodovanJson)
        val dnevnikIzDelnoPoskodovane = DnevnikKlicev(shrambaDelno)
        val ohranjeni = dnevnikIzDelnoPoskodovane.seznamPoDatumu()
        assertEquals(2, ohranjeni.size)
        assertEquals(listOf("ok-2", "ok-1"), ohranjeni.map { it.id })
    }

    // Lazna shramba za preizkus napak pri branju in shranjevanju.
    private class LaznaShramba(
        zacetnaVsebina: String? = null,
        var vrziObBranju: Boolean = false,
        var vsiliNeveljavnoBranje: Boolean = false,
        var vrziObShranjevanju: Boolean = false,
        var obShranjevanju: (() -> Unit)? = null
    ) : Shramba {
        var vsebina: String? = zacetnaVsebina
        var steviloShranjevanj: Int = 0

        override fun preberi(): String? {
            if (vrziObBranju) {
                throw IllegalStateException("Simulirana napaka pri branju iz shrambe")
            }
            if (vsiliNeveljavnoBranje) {
                return "{\"verzija\":1,\"zapisi\":[NEVELJAVEN_JSON"
            }
            return vsebina
        }

        override fun shrani(vsebina: String) {
            obShranjevanju?.invoke()
            if (vrziObShranjevanju) {
                throw IllegalStateException("Simulirana napaka pri shranjevanju v shrambo")
            }
            this.vsebina = vsebina
            steviloShranjevanj++
        }
    }

    @Test
    fun `tocka1_nePrepisiPoNeuspelemPrvemBranju - ob napaki prvega branja zavrne pisanje dokler branje ne uspe`() {
        val laznaShramba = LaznaShramba()
        val prviDnevnik = DnevnikKlicev(laznaShramba)
        val obstojeci = ZapisKlica(
            id = "obstojeci-1",
            casZacetka = 1000L,
            stevilka = "+38640111222",
            trajanjeS = 30,
            nujno = false,
            povzetek = "Obstojeci zapis v shrambi",
            prepis = "Prepis obstojecega klica",
            nacin = NacinKlica.OSEBNA
        )
        assertTrue(prviDnevnik.dodaj(obstojeci))
        val shranjenaPredNapako = laznaShramba.vsebina
        assertNotNull(shranjenaPredNapako)

        // Prvo branje ob zagonu vrze izjemo: konstruktor ne sme pasti, pisanje pa mora biti zavrnjeno
        laznaShramba.vrziObBranju = true
        val dnevnikPoIzjemi = DnevnikKlicev(laznaShramba)
        val novKlic = ZapisKlica(
            id = "nov-1",
            casZacetka = 2000L,
            stevilka = "+38640333444",
            trajanjeS = 40,
            nujno = true,
            povzetek = "Nov nujen klic",
            prepis = "Prepis novega klica",
            nacin = NacinKlica.PODJETJE
        )
        assertFalse(dnevnikPoIzjemi.dodaj(novKlic))
        assertEquals(shranjenaPredNapako, laznaShramba.vsebina)

        // Ko ponovno branje uspe, se obstojeci zapis nalozi in pisanje novega zapisa je spet dovoljeno
        laznaShramba.vrziObBranju = false
        assertTrue(dnevnikPoIzjemi.naloziIzShrambe())
        assertTrue(dnevnikPoIzjemi.dodaj(novKlic))

        val prebrani = DnevnikKlicev(laznaShramba).seznamPoDatumu()
        assertEquals(listOf("nov-1", "obstojeci-1"), prebrani.map { it.id })
    }

    @Test
    fun `tocka2_potrditevPoPosiljanju - odstrani samo poslano revizijo in ohrani novejso revizijo istega ID`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)

        val zacetni = ZapisKlica(
            id = "isti-id",
            casZacetka = 1000L,
            stevilka = "+38640111222",
            trajanjeS = 25,
            nujno = false,
            povzetek = "Prva revizija povzetka",
            prepis = "Prepis 1",
            nacin = NacinKlica.OSEBNA
        )
        val drugi = ZapisKlica(
            id = "drugi-id",
            casZacetka = 900L,
            stevilka = "+38640999888",
            trajanjeS = 20,
            nujno = false,
            povzetek = "Drugi klic ki se ne spremeni",
            prepis = "Prepis 2",
            nacin = NacinKlica.PODJETJE
        )
        assertTrue(dnevnik.dodaj(zacetni))
        assertTrue(dnevnik.dodaj(drugi))

        val posodobljenaRevizija = ZapisKlica(
            id = "isti-id",
            casZacetka = 1000L,
            stevilka = "+38640111222",
            trajanjeS = 50,
            nujno = true,
            povzetek = "Novejsa revizija povzetka med posiljanjem",
            prepis = "Prepis 1 dopolnjen",
            nacin = NacinKlica.PODJETJE
        )

        val uspeh = dnevnik.poskusiSinhronizacijoVOzadju(
            medKlicem = false,
            uporabljaAsistentko = false,
            povezava = PovezavaStanje.DOMA_LAN
        ) { poslani ->
            assertEquals(2, poslani.size)
            // Med posiljanjem v drugi niti dodamo novejso revizijo istega ID
            val nit = Thread {
                assertTrue(dnevnik.dodaj(posodobljenaRevizija))
            }
            nit.start()
            nit.join()
            true
        }

        assertTrue(uspeh)
        val preostali = dnevnik.cakajociZaSinhronizacijo()
        assertEquals(1, preostali.size)
        assertEquals("isti-id", preostali[0].id)
        assertEquals("Novejsa revizija povzetka med posiljanjem", preostali[0].povzetek)
        assertTrue(preostali[0].nujno)
    }

    @Test
    fun `tocka3_uvrstitevSelePoUspesnemShranjevanju - ob izjemi pri shranjevanju se klic ne uvrsti v zemljevide`() {
        var medShranjevanjemVSeznamu = false
        var medShranjevanjemVVrsti = false
        val laznaShramba = LaznaShramba(vrziObShranjevanju = true)
        val dnevnik = DnevnikKlicev(laznaShramba)

        laznaShramba.obShranjevanju = {
            medShranjevanjemVSeznamu = dnevnik.seznamPoDatumu().isNotEmpty()
            medShranjevanjemVVrsti = dnevnik.cakajociZaSinhronizacijo().isNotEmpty()
        }

        val klic = ZapisKlica(
            id = "ne-shrani-1",
            casZacetka = 1000L,
            stevilka = "+38640111222",
            trajanjeS = 30,
            nujno = true,
            povzetek = "Klic ob napaki shrambe",
            prepis = "Prepis",
            nacin = NacinKlica.PODJETJE
        )

        assertThrows(IllegalStateException::class.java) {
            dnevnik.dodaj(klic)
        }

        // Med poskusom shranjevanja in po neuspelem shranjevanju klica ne sme biti v nobenem zemljevidu
        assertFalse(medShranjevanjemVSeznamu)
        assertFalse(medShranjevanjemVVrsti)
        assertTrue(dnevnik.seznamPoDatumu().isEmpty())
        assertTrue(dnevnik.cakajociZaSinhronizacijo().isEmpty())

        // Ko shranjevanje uspe, je klic takoj na voljo v obeh zemljevidih
        laznaShramba.vrziObShranjevanju = false
        assertTrue(dnevnik.dodaj(klic))
        assertEquals(listOf("ne-shrani-1"), dnevnik.seznamPoDatumu().map { it.id })
        assertEquals(listOf("ne-shrani-1"), dnevnik.cakajociZaSinhronizacijo().map { it.id })
    }

    @Test
    fun `tocka4_potrjenIzbrisObIzjemiOstanePonovljiv - ob izjemi pri shranjevanju izbris ostane ponovljiv`() {
        val laznaShramba = LaznaShramba()
        val dnevnik = DnevnikKlicev(laznaShramba)

        val klic = ZapisKlica(
            id = "izbris-ponovi-1",
            casZacetka = 1000L,
            stevilka = "+38640111222",
            trajanjeS = 35,
            nujno = true,
            povzetek = "Klic za izbris",
            prepis = "Prepis",
            nacin = NacinKlica.OSEBNA
        )
        assertTrue(dnevnik.dodaj(klic))

        laznaShramba.vrziObShranjevanju = true
        assertThrows(IllegalStateException::class.java) {
            dnevnik.izbrisi("izbris-ponovi-1", potrditevUporabnika = true)
        }

        // Po neuspelem shranjevanju mora zapis ostati v pomnilniku in v vrsti sinhronizacije
        assertEquals(listOf("izbris-ponovi-1"), dnevnik.seznamPoDatumu().map { it.id })
        assertEquals(listOf("izbris-ponovi-1"), dnevnik.cakajociZaSinhronizacijo().map { it.id })

        // Ko shramba spet deluje, je potrjen izbris ponovljiv in uspe
        laznaShramba.vrziObShranjevanju = false
        assertTrue(dnevnik.izbrisi("izbris-ponovi-1", potrditevUporabnika = true))
        assertTrue(dnevnik.seznamPoDatumu().isEmpty())
        assertTrue(dnevnik.cakajociZaSinhronizacijo().isEmpty())
        assertTrue(DnevnikKlicev(laznaShramba).seznamPoDatumu().isEmpty())
    }

    @Test
    fun `tocka5_cakajoceRevizijePrezvijoPonovniZagon - cakajoce spremembe prezivijo ponovni zagon potrjeni klici pa ne`() {
        val shramba = PomnilniskaShramba()
        val dnevnik1 = DnevnikKlicev(shramba)

        val klic1 = ZapisKlica(
            id = "sync-trajno-1",
            casZacetka = 1000L,
            stevilka = "+38640111111",
            trajanjeS = 20,
            nujno = false,
            povzetek = "Prvi klic",
            prepis = "Prepis 1",
            nacin = NacinKlica.OSEBNA
        )
        val klic2 = ZapisKlica(
            id = "sync-trajno-2",
            casZacetka = 2000L,
            stevilka = "+38640222222",
            trajanjeS = 40,
            nujno = true,
            povzetek = "Drugi nujen klic",
            prepis = "Prepis 2",
            nacin = NacinKlica.PODJETJE
        )
        assertTrue(dnevnik1.dodaj(klic1))
        assertTrue(dnevnik1.dodaj(klic2))

        // Ponovni zagon pred posiljanjem: cakajoci reviziji morata preziveti
        val dnevnikPoZagonu1 = DnevnikKlicev(shramba)
        assertEquals(
            listOf("sync-trajno-2", "sync-trajno-1"),
            dnevnikPoZagonu1.cakajociZaSinhronizacijo().map { it.id }
        )

        // Potrditev po uspesnem posiljanju mora biti shranjena trajno
        assertTrue(
            dnevnikPoZagonu1.poskusiSinhronizacijoVOzadju(
                medKlicem = false,
                uporabljaAsistentko = false,
                povezava = PovezavaStanje.DOMA_LAN
            ) { poslani ->
                assertEquals(2, poslani.size)
                true
            }
        )
        assertTrue(dnevnikPoZagonu1.cakajociZaSinhronizacijo().isEmpty())

        // Dodamo nov klic po potrditvi prvih dveh
        val klic3 = ZapisKlica(
            id = "sync-trajno-3",
            casZacetka = 3000L,
            stevilka = "+38640333333",
            trajanjeS = 30,
            nujno = false,
            povzetek = "Tretji klic ki se caka",
            prepis = "Prepis 3",
            nacin = NacinKlica.PODJETJE
        )
        assertTrue(dnevnikPoZagonu1.dodaj(klic3))

        // Ponovni zagon po potrditvi: ze potrjenih klicev ne uvrsti spet, nepovratno caka samo klic3
        val dnevnikPoZagonu2 = DnevnikKlicev(shramba)
        assertEquals(3, dnevnikPoZagonu2.seznamPoDatumu().size)
        assertEquals(listOf("sync-trajno-3"), dnevnikPoZagonu2.cakajociZaSinhronizacijo().map { it.id })
    }

    // F6 (CodeRabbit, drugi krog): pomozni klic za preizkuse ponovne nalozitve
    private fun f6Klic(id: String, stevilka: String, cas: Long = 1000L) = ZapisKlica(
        id = id,
        casZacetka = cas,
        stevilka = stevilka,
        trajanjeS = 20,
        nujno = false,
        povzetek = "Navaden klic",
        prepis = "Prepis klica",
        nacin = NacinKlica.OSEBNA
    )

    @Test
    fun `f6a_ponovnaNaloziev - veljaven posnetek nadomesti vrsto cakajocih in potrjena revizija se ne poslje znova`() {
        val shramba = PomnilniskaShramba()
        val dnevnik1 = DnevnikKlicev(shramba)
        assertTrue(dnevnik1.dodaj(f6Klic("f6a-1", "+38640600001")))
        val dnevnik2 = DnevnikKlicev(shramba)
        assertEquals(listOf("f6a-1"), dnevnik2.cakajociZaSinhronizacijo().map { it.id })

        // Druga instanca potrdi revizijo in zapise prazno vrsto
        assertTrue(dnevnik1.poskusiSinhronizacijoVOzadju(medKlicem = false) { true })

        assertTrue(dnevnik2.naloziIzShrambe())
        assertTrue(dnevnik2.cakajociZaSinhronizacijo().isEmpty())
        var steviloPosiljanj = 0
        assertTrue(dnevnik2.poskusiSinhronizacijoVOzadju(medKlicem = false) { steviloPosiljanj++; true })
        assertEquals(0, steviloPosiljanj)
    }

    @Test
    fun `f6b_osirotelaProjekcija - cakajoca revizija brez veljavnega klica se ne obnovi in ne postane trajna`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)
        assertTrue(dnevnik.dodaj(f6Klic("f6b-x", "+38640600111", cas = 1000L)))
        assertTrue(dnevnik.dodaj(f6Klic("f6b-y", "+38640600222", cas = 2000L)))
        val surovo = shramba.preberi()!!
        // zapisi so v JSON pred cakajocimi: prva pojavitev stevilke je v shranjenem klicu, ne v projekciji
        val poskodovano = surovo.replaceFirst("+38640600111", "")
        assertNotEquals(surovo, poskodovano)

        val po = DnevnikKlicev(PomnilniskaShramba(poskodovano))
        assertEquals(listOf("f6b-y"), po.seznamPoDatumu().map { it.id })
        assertEquals(listOf("f6b-y"), po.cakajociZaSinhronizacijo().map { it.id })
    }

    @Test
    fun `f6g_zastarelaProjekcija - veljaven klic ostane v vrsti, projekcija se obnovi iz klica in ne iz datoteke (F6 pregled, najdba 3)`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)
        assertTrue(dnevnik.dodaj(f6Klic("f6g-1", "+38640600701")))
        val surovo = shramba.preberi()!!
        // projekcija v datoteki je zastarela ali spremenjena (druga stevilka); klic sam je veljaven
        val i = surovo.lastIndexOf("+38640600701")
        assertTrue(i > surovo.indexOf("+38640600701"), "stevilka mora biti v zapisu in v projekciji")
        val spremenjeno = surovo.substring(0, i) + "+38640600702" + surovo.substring(i + "+38640600701".length)

        val po = DnevnikKlicev(PomnilniskaShramba(spremenjeno))
        assertEquals(listOf("f6g-1"), po.seznamPoDatumu().map { it.id })
        // klic se ne izgubi iz vrste, poslje pa se podatek iz klica (nikoli stevilka iz spremenjene projekcije)
        assertEquals(listOf("+38640600701"), po.cakajociZaSinhronizacijo().map { it.stevilka })
    }

    @Test
    fun `f6c_potrditevPoNeuspeliNalozitvi - potrditev ne prepise novejsega posnetka ki ga ni bilo mogoce prebrati`() {
        val shramba = LaznaShramba()
        val dnevnik = DnevnikKlicev(shramba)
        assertTrue(dnevnik.dodaj(f6Klic("f6c-1", "+38640600301")))
        val novejsi = "NOVEJSI-POSNETEK-DRUGE-INSTANCE"
        assertTrue(
            dnevnik.poskusiSinhronizacijoVOzadju(medKlicem = false) {
                shramba.vrziObBranju = true
                assertFalse(dnevnik.naloziIzShrambe())
                shramba.vrziObBranju = false
                shramba.vsebina = novejsi
                true
            }
        )
        assertEquals(novejsi, shramba.vsebina)
    }

    @Test
    fun `f6d_napacenTipCakajocih - polje cakajoci ki ni polje je poskodba in blokira pisanje`() {
        val shramba = PomnilniskaShramba()
        val dnevnik = DnevnikKlicev(shramba)
        assertTrue(dnevnik.dodaj(f6Klic("f6d-1", "+38640600401")))
        val surovo = shramba.preberi()!!
        val i = surovo.indexOf("\"cakajoci\"")
        assertTrue(i > 0)
        val poskodovano = surovo.substring(0, i) + "\"cakajoci\": {\"a\": 1}\n}"
        val shramba2 = PomnilniskaShramba(poskodovano)

        val po = DnevnikKlicev(shramba2)
        assertFalse(po.dodaj(f6Klic("f6d-2", "+38640600402")))
        assertEquals(poskodovano, shramba2.preberi())
        assertFalse(po.naloziIzShrambe())
    }

    @Test
    fun `f6e_zavrnjenaDatotekaPriPraznemPomnilniku - pisanje je blokirano dokler ponovna nalozitev ne uspe`() {
        val vir = PomnilniskaShramba()
        assertTrue(DnevnikKlicev(vir).dodaj(f6Klic("f6e-0", "+38640600500")))
        val posnetek = vir.preberi()!!

        val shramba = LaznaShramba(zacetnaVsebina = posnetek, vsiliNeveljavnoBranje = true)
        val dnevnik = DnevnikKlicev(shramba)
        assertFalse(dnevnik.dodaj(f6Klic("f6e-1", "+38640600501")))
        assertEquals(0, shramba.steviloShranjevanj)

        shramba.vsiliNeveljavnoBranje = false
        assertTrue(dnevnik.naloziIzShrambe())
        assertTrue(dnevnik.dodaj(f6Klic("f6e-1", "+38640600501")))
        assertEquals(2, dnevnik.seznamPoDatumu().size)
    }
}
