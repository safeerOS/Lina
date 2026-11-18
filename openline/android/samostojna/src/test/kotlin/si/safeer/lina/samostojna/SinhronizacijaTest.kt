package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import kotlin.system.measureTimeMillis

class SinhronizacijaTest {

    @Test
    fun `krozno v_json in iz_json`() {
        val zapiski = listOf(
            Zapisek("1", "Ena", 100, false),
            Zapisek("2", "Dva", 200, true)
        )
        val opomniki = listOf(
            Opomnik("3", "Opomnik", 300, false, 350)
        )
        val zapisi = Zapisi(1, zapiski, opomniki)

        val json = v_json(zapisi)
        val prebrano = iz_json(json)

        assertNotNull(prebrano)
        assertEquals(1, prebrano!!.verzija)
        assertEquals(2, prebrano.zapiski.size)
        assertEquals(1, prebrano.opomniki.size)
        assertEquals("Ena", prebrano.zapiski[0].besedilo)
        assertEquals(350, prebrano.opomniki[0].spremenjeno)
    }

    @Test
    fun `neznana verzija vrne null`() {
        val json = """{"verzija":2,"zapiski":[],"opomniki":[]}"""
        val prebrano = iz_json(json)
        assertNull(prebrano)
    }

    @Test
    fun `okrnjen JSON vrne null`() {
        val json = """{"verzija":1,"zapiski":[{"id":"1""""
        val prebrano = iz_json(json)
        assertNull(prebrano)
    }

    @Test
    fun `prazno vrne null`() {
        val prebrano = iz_json("")
        assertNull(prebrano)
        val presledki = iz_json("   ")
        assertNull(presledki)
    }

    @Test
    fun `unicode cesnja in emoji`() {
        val z = Zapisi(1, listOf(Zapisek("1", "češnja 🍒", 0, false)), emptyList())
        val json = v_json(z)
        val prebrano = iz_json(json)
        assertNotNull(prebrano)
        assertEquals("češnja 🍒", prebrano!!.zapiski[0].besedilo)
    }

    @Test
    fun `10000 zapisov pod 1 s`() {
        val velikoZapisov = (1..10000).map {
            Zapisek(it.toString(), "Besedilo $it", it.toLong(), false)
        }
        val zapisi = Zapisi(1, velikoZapisov, emptyList())

        val casUstvarjanja = measureTimeMillis {
            v_json(zapisi)
        }
        assertTrue(casUstvarjanja < 1000, "Trajalo je $casUstvarjanja ms")

        val json = v_json(zapisi)
        val casBranja = measureTimeMillis {
            iz_json(json)
        }
        assertTrue(casBranja < 1000, "Trajalo je $casBranja ms")
    }

    @Test
    fun `zdruzi(a, iz_json(v_json(b))) enako zdruzi(a, b)`() {
        val z1 = Zapisek("1", "A", 100, false)
        val z2 = Zapisek("1", "B", 200, false) // Novejši

        val a = listOf(z1)
        val b = listOf(z2)

        val zapisiB = Zapisi(1, b, emptyList())
        val prebranB = iz_json(v_json(zapisiB))!!

        val zdruzenoDirektno = zdruzi(a, b)
        val zdruzenoPrekoJson = zdruzi(a, prebranB.zapiski)

        assertEquals(1, zdruzenoDirektno.size)
        assertEquals(zdruzenoDirektno, zdruzenoPrekoJson)
        assertEquals("B", zdruzenoPrekoJson[0].besedilo)
    }

    @Test
    fun `smemSinhronizirati - med klicem false, med pogovorom z asistentko false, zaslon prizgan brez uporabe true, NI_PARJENO false`() {
        // Med aktivnim telefonskim klicem -> false
        assertFalse(
            smemSinhronizirati(
                StanjeTelefona(
                    medKlicem = true,
                    uporabljaAsistentko = false,
                    povezava = PovezavaStanje.DOMA_LAN
                )
            )
        )

        // Med pogovorom z asistentko -> false
        assertFalse(
            smemSinhronizirati(
                StanjeTelefona(
                    medKlicem = false,
                    uporabljaAsistentko = true,
                    povezava = PovezavaStanje.GLOBAL_NEPOSREDNO
                )
            )
        )

        // Zaslon prizgan brez uporabe (ni klica, ni pogovora z asistentko) -> true
        assertTrue(
            smemSinhronizirati(
                StanjeTelefona(
                    medKlicem = false,
                    uporabljaAsistentko = false,
                    zaslonPrizgan = true,
                    povezava = PovezavaStanje.DOMA_LAN
                )
            )
        )
        assertTrue(
            smemSinhronizirati(
                StanjeTelefona(
                    medKlicem = false,
                    uporabljaAsistentko = false,
                    zaslonPrizgan = true,
                    povezava = PovezavaStanje.GLOBAL_NEPOSREDNO
                )
            )
        )

        // Neparjena naprava (NI_PARJENO) -> false
        assertFalse(
            smemSinhronizirati(
                StanjeTelefona(
                    medKlicem = false,
                    uporabljaAsistentko = false,
                    zaslonPrizgan = false,
                    povezava = PovezavaStanje.NI_PARJENO
                )
            )
        )
    }

    @Test
    fun `vrsta - dodaj se konca pred odgovorom racunalnika z umetno zamudo 5 s v lazni uri`() {
        var laznaUra = 100L
        var casObOdgovoruRacunalnika: Long? = null

        val pocasenOdjemalec = OdjemalecSinhronizacije { _, _ ->
            // Lazen odjemalec z umetno zamudo 5 s v lazni uri
            laznaUra += 5L
            casObOdgovoruRacunalnika = laznaUra
            true
        }

        val vrsta = VrstaSprememb(
            odjemalec = pocasenOdjemalec,
            izbiraPoti = IzbiraPoti(ura = { laznaUra })
        )

        val casPredDodaj = laznaUra
        vrsta.dodaj(Sprememba(id = "s1", vsebina = "Nov zapisek", cas = laznaUra))
        val casPoDodaj = laznaUra

        // dodaj vrne takoj, pred kakrsnimkoli odgovorom racunalnika (0 s v lazni uri)
        assertEquals(casPredDodaj, casPoDodaj)
        assertNull(casObOdgovoruRacunalnika)
        assertEquals(1, vrsta.velikost())

        // Sele ob posiljanju v ozadju racunalnik odgovori po 5 s v lazni uri
        assertTrue(vrsta.poslji(Pot.LAN))
        assertEquals(105L, casObOdgovoruRacunalnika)
        assertTrue(casPoDodaj < casObOdgovoruRacunalnika!!)
        assertTrue(vrsta.jePrazna())
    }

    @Test
    fun `vrsta - neuspeh poslji ohrani vse in ponovni poskus ne podvoji`() {
        var laznaUra = 0L
        val izbira = IzbiraPoti(ura = { laznaUra })
        val prejeteSpremembeNaRacunalniku = mutableListOf<Sprememba>()
        var najUspe = false

        val odjemalec = OdjemalecSinhronizacije { _, spremembe ->
            if (!najUspe) {
                false
            } else {
                prejeteSpremembeNaRacunalniku.addAll(spremembe)
                true
            }
        }

        val vrsta = VrstaSprememb(odjemalec = odjemalec, izbiraPoti = izbira)
        val s1 = Sprememba("1", "Prva sprememba", 10L)
        val s2 = Sprememba("2", "Druga sprememba", 20L)
        val s3 = Sprememba("3", "Tretja sprememba", 30L)

        vrsta.dodaj(s1)
        vrsta.dodaj(s2)
        vrsta.dodaj(s3)

        // 1. poskus pade: vrsta ostane nedotaknjena, vrstni red ohranjen
        assertFalse(vrsta.poslji(Pot.LAN))
        assertEquals(listOf(s1, s2, s3), vrsta.cakajoce())
        assertTrue(prejeteSpremembeNaRacunalniku.isEmpty())

        // Ponovno dodajanje iste spremembe ne podvoji zapisa v vrsti
        vrsta.dodaj(s1)
        assertEquals(listOf(s1, s2, s3), vrsta.cakajoce())

        // 2. poskus prek naslednje poti (GLOBAL_NEPOSREDNO) uspe: poslje natanko enkrat v vrstnem redu
        najUspe = true
        val naslednjaPot = izbira.izberi()
        assertEquals(Pot.GLOBAL_NEPOSREDNO, naslednjaPot)
        assertTrue(vrsta.poslji(naslednjaPot!!))

        assertEquals(listOf(s1, s2, s3), prejeteSpremembeNaRacunalniku)
        assertTrue(vrsta.jePrazna())

        // 3. poskus na prazni vrsti ne poslje podvojenih sprememb
        assertTrue(vrsta.poslji(Pot.GLOBAL_NEPOSREDNO))
        assertEquals(3, prejeteSpremembeNaRacunalniku.size)
    }

    @Test
    fun `vrsta - poKoncuKlica takoj poslje cakajoce spremembe ce smemSinhronizirati`() {
        var poslanePoti = mutableListOf<Pot>()
        val poslaniElementi = mutableListOf<Sprememba>()

        val odjemalec = OdjemalecSinhronizacije { pot, spremembe ->
            poslanePoti.add(pot)
            poslaniElementi.addAll(spremembe)
            true
        }

        val vrsta = VrstaSprememb(
            odjemalec = odjemalec,
            izbiraPoti = IzbiraPoti(ura = { 0L }),
            stanje = StanjeTelefona(medKlicem = true, uporabljaAsistentko = false, povezava = PovezavaStanje.DOMA_LAN)
        )

        val s1 = Sprememba("klic-opomnik-1", "Poklici nazaj", 500L)
        val s2 = Sprememba("klic-zapisek-2", "Povzetek klica", 510L)
        vrsta.dodaj(s1)
        vrsta.dodaj(s2)

        // Med klicem posiljanje ni dovoljeno
        assertFalse(vrsta.poslji(Pot.LAN))
        assertTrue(poslaniElementi.isEmpty())
        assertEquals(2, vrsta.velikost())

        // Po koncu klica se vrsta poslje takoj
        assertTrue(vrsta.poKoncuKlica())
        assertEquals(listOf(Pot.LAN), poslanePoti)
        assertEquals(listOf(s1, s2), poslaniElementi)
        assertTrue(vrsta.jePrazna())
    }

    @Test
    fun `neparjenaNaprava - ob NI_PARJENO se sinhronizacija ne izvede in vrsta se ne poslje`() {
        var steviloKlicevOdjemalca = 0
        val odjemalec = OdjemalecSinhronizacije { _, _ ->
            steviloKlicevOdjemalca++
            true
        }

        val vrsta = VrstaSprememb(
            odjemalec = odjemalec,
            izbiraPoti = IzbiraPoti(ura = { 0L }),
            stanje = StanjeTelefona(povezava = PovezavaStanje.NI_PARJENO)
        )

        val s1 = Sprememba("u1", "Lokalni zapisek na neparjeni napravi", 100L)
        vrsta.dodaj(s1)

        assertFalse(vrsta.poslji(Pot.LAN))
        assertFalse(vrsta.poslji(Pot.GLOBAL_NEPOSREDNO))
        assertFalse(vrsta.poslji(Pot.RELE))
        assertFalse(vrsta.poKoncuKlica())

        assertEquals(0, steviloKlicevOdjemalca)
        assertEquals(listOf(s1), vrsta.cakajoce())
    }

    @Test
    fun `odpornost - lazen odjemalec ki pade ob vsakem klicu ne blokira lokalnih operacij`() {
        var steviloPoskusovPosiljanja = 0
        val vednoPadajociOdjemalec = OdjemalecSinhronizacije { _, _ ->
            steviloPoskusovPosiljanja++
            throw IllegalStateException("Omrezje in racunalnik sta popolnoma nedosegljiva!")
        }
        val vednoPadajociLokalniPreizkus = LokalniPreizkusniOdjemalec {
            throw IllegalStateException("Lokalna operacija ne sme klicati omrezja!")
        }

        val vrsta = VrstaSprememb(
            odjemalec = vednoPadajociOdjemalec,
            izbiraPoti = IzbiraPoti(ura = { 1000L }),
            stanje = StanjeTelefona(povezava = PovezavaStanje.DOMA_LAN)
        )

        // Lokalne operacije na telefonu in dodajanje v vrsto delujejo brez izjem in brez blokiranja
        var lokalnoStanje = LokalnoStanjeTelefona()
        lokalnoStanje = izvediLokalnoOperacijo(
            lokalnoStanje,
            LokalnaOperacija.DodajZapisek("z1", "Nujni zapisek", 1000L),
            vednoPadajociLokalniPreizkus
        )
        lokalnoStanje = izvediLokalnoOperacijo(
            lokalnoStanje,
            LokalnaOperacija.DodajOpomnik("o1", "Sestanek ob 10h", 2000L),
            vednoPadajociLokalniPreizkus
        )
        vrsta.dodaj(Sprememba("z1", "Nujni zapisek", 1000L))
        vrsta.dodaj(Sprememba("o1", "Sestanek ob 10h", 2000L))

        // Poskusi sinhronizacije z odjemalcem, ki ob vsakem klicu vrze izjemo, varno vrnejo false brez izjeme
        assertFalse(vrsta.poslji(Pot.LAN))
        assertFalse(vrsta.poslji(Pot.GLOBAL_NEPOSREDNO))
        assertFalse(vrsta.poslji(Pot.RELE))
        assertFalse(vrsta.poKoncuKlica())
        assertEquals(3, steviloPoskusovPosiljanja) // poKoncuKlica ne klice vec, ker so vse 3 poti v premoru

        // Vsi lokalni podatki in cakajoce spremembe v vrsti ostanejo nedotaknjeni
        assertEquals(1, lokalnoStanje.zapiski.size)
        assertEquals(1, lokalnoStanje.opomniki.size)
        assertEquals(2, vrsta.velikost())
    }

    @Test
    fun `vrsta - zahteva izrecnega posiljatelja brez privzetega ki bi brisal vrsto`() {
        val brezArgumentov = VrstaSprememb::class.java.declaredConstructors.any { it.parameterCount == 0 }
        assertFalse(
            brezArgumentov,
            "VrstaSprememb ne sme imeti privzetega konstruktorja brez izrecnega posiljatelja"
        )
    }

    @Test
    fun `vrsta - prepreci prekrivajoca posiljanja iste revizije sprosti ob uspehu in neuspehu ter dodaj ne caka`() {
        var aktivnaPosiljanja = 0
        var najvecSocasnih = 0
        var steviloKlicevOdjemalca = 0
        var izidVgnezdenegaPosiljanja: Boolean? = null
        var velikostPoDodajanjuMedPosiljanjem = 0

        lateinit var vrsta: VrstaSprememb
        val odjemalec = OdjemalecSinhronizacije { _, _ ->
            steviloKlicevOdjemalca++
            aktivnaPosiljanja++
            if (aktivnaPosiljanja > najvecSocasnih) {
                najvecSocasnih = aktivnaPosiljanja
            }
            if (steviloKlicevOdjemalca == 1) {
                // Medtem ko prvo posiljanje tece, socasni poskus posiljanja iste vrste ne sme sproziti drugega posiljanja
                izidVgnezdenegaPosiljanja = vrsta.poslji(Pot.LAN)
                // Lokalno dodajanje med posiljanjem se izvede takoj brez cakanja
                vrsta.dodaj(Sprememba("s2", "Dodano med posiljanjem", 20L))
                velikostPoDodajanjuMedPosiljanjem = vrsta.velikost()
                aktivnaPosiljanja--
                false
            } else {
                aktivnaPosiljanja--
                true
            }
        }

        vrsta = VrstaSprememb(
            odjemalec = odjemalec,
            izbiraPoti = IzbiraPoti(ura = { 0L })
        )
        vrsta.dodaj(Sprememba("s1", "Prva sprememba", 10L))

        // 1. poskus pade, med njim se vgnezdeno posiljanje zavrne, dodaj("s2") pa takoj uspe
        assertFalse(vrsta.poslji(Pot.LAN))
        assertEquals(false, izidVgnezdenegaPosiljanja)
        assertEquals(1, najvecSocasnih)
        assertEquals(1, steviloKlicevOdjemalca)
        assertEquals(2, velikostPoDodajanjuMedPosiljanjem)
        assertEquals(2, vrsta.velikost())

        // Po neuspehu je kljucavnica sproscena, zato naslednje posiljanje stece in uspe
        assertTrue(vrsta.poslji(Pot.GLOBAL_NEPOSREDNO))
        assertEquals(2, steviloKlicevOdjemalca)
        assertTrue(vrsta.jePrazna())

        // Po uspehu je kljucavnica prav tako sproscena za nove spremembe
        vrsta.dodaj(Sprememba("s3", "Tretja sprememba", 30L))
        assertTrue(vrsta.poslji(Pot.GLOBAL_NEPOSREDNO))
        assertEquals(3, steviloKlicevOdjemalca)
        assertTrue(vrsta.jePrazna())
    }

    @Test
    fun `vrsta - dodaj iz druge niti se konca med posiljanjem ki se se izvaja`() {
        val posiljanjeZacelo = java.util.concurrent.CountDownLatch(1)
        val sprostiOdjemalca = java.util.concurrent.CountDownLatch(1)
        val odjemalec = OdjemalecSinhronizacije { _, _ ->
            posiljanjeZacelo.countDown()
            sprostiOdjemalca.await(10, java.util.concurrent.TimeUnit.SECONDS)
            true
        }
        val vrsta = VrstaSprememb(odjemalec = odjemalec, izbiraPoti = IzbiraPoti(ura = { 0L }))
        vrsta.dodaj(Sprememba("t1", "Prva sprememba", 10L))

        val posiljalec = Thread { vrsta.poslji(Pot.LAN) }
        var delavec: Thread? = null
        try {
            posiljalec.start()
            assertTrue(posiljanjeZacelo.await(5, java.util.concurrent.TimeUnit.SECONDS))
            val dodano = java.util.concurrent.CountDownLatch(1)
            delavec = Thread {
                vrsta.dodaj(Sprememba("t2", "Druga sprememba", 20L))
                dodano.countDown()
            }
            delavec.start()
            // dodaj mora vrniti, medtem ko je odjemalec se odprt (ni ga sprostil noben klic)
            assertTrue(
                dodano.await(2, java.util.concurrent.TimeUnit.SECONDS),
                "dodaj iz druge niti mora vrniti pred koncem posiljanja"
            )
        } finally {
            sprostiOdjemalca.countDown()
            posiljalec.join(5000)
            delavec?.join(5000)
        }
    }
}
