package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SpominTest {

    // Testi za zdruzi(Zapisek)
    @Test
    fun `zdruzi zapiske - prazna seznama`() {
        val rezultat = zdruzi(emptyList<Zapisek>(), emptyList<Zapisek>())
        assertEquals(0, rezultat.size)
    }

    @Test
    fun `zdruzi zapiske - novejsi zmaga`() {
        val stari = Zapisek("1", "Staro", 100, false)
        val novi = Zapisek("1", "Novo", 200, false)
        val rezultat = zdruzi(listOf(stari), listOf(novi))
        assertEquals(1, rezultat.size)
        assertEquals("Novo", rezultat[0].besedilo)
    }

    @Test
    fun `zdruzi zapiske - enak cas, brisanje zmaga`() {
        val ziv = Zapisek("1", "Vsebina", 100, false)
        val izbrisan = Zapisek("1", "Vsebina", 100, true)
        val rezultat1 = zdruzi(listOf(ziv), listOf(izbrisan))
        val rezultat2 = zdruzi(listOf(izbrisan), listOf(ziv))
        assertEquals(true, rezultat1[0].izbrisan)
        assertEquals(true, rezultat2[0].izbrisan)
    }

    @Test
    fun `zdruzi zapiske - razlicni id-ji se zdruzijo`() {
        val z1 = Zapisek("1", "Ena", 100, false)
        val z2 = Zapisek("2", "Dva", 100, false)
        val rezultat = zdruzi(listOf(z1), listOf(z2))
        assertEquals(2, rezultat.size)
    }

    @Test
    fun `zdruzi zapiske - determinizem besedilo in urejenost po id`() {
        val z1 = Zapisek("1", "A", 100, false)
        val z2 = Zapisek("1", "B", 100, false)
        val rezultat1 = zdruzi(listOf(z1), listOf(z2))
        val rezultat2 = zdruzi(listOf(z2), listOf(z1))
        
        assertEquals(1, rezultat1.size)
        assertEquals("B", rezultat1[0].besedilo)
        assertEquals("B", rezultat2[0].besedilo)
        
        val z3 = Zapisek("3", "X", 100, false)
        val z4 = Zapisek("2", "Y", 100, false)
        val rezSort = zdruzi(listOf(z3), listOf(z4))
        assertEquals("2", rezSort[0].id)
        assertEquals("3", rezSort[1].id)
    }

    @Test
    fun `zdruzi zapiske - lastnosti na nakljucnih podatkih`() {
        val random = java.util.Random(42)
        fun randomZapisek(): Zapisek {
            val id = random.nextInt(5).toString()
            val besedilo = listOf("A", "B", "C")[random.nextInt(3)]
            val cas = random.nextInt(3).toLong() * 100
            val izbrisan = random.nextBoolean()
            return Zapisek(id, besedilo, cas, izbrisan)
        }
        
        for (i in 0..200) {
            val a = listOf(randomZapisek(), randomZapisek())
            val b = listOf(randomZapisek(), randomZapisek())
            val c = listOf(randomZapisek(), randomZapisek())
            
            // Komutativnost
            val ab = zdruzi(a, b)
            val ba = zdruzi(b, a)
            assertEquals(ab, ba, "Ni komutativno za $a in $b")
            
            // Idempotentnost
            assertEquals(ab, zdruzi(ab, ab), "Ni idempotentno")
            
            // Asociativnost
            val abc1 = zdruzi(zdruzi(a, b), c)
            val abc2 = zdruzi(a, zdruzi(b, c))
            assertEquals(abc1, abc2, "Ni asociativno")
        }
    }

    @Test
    fun `zdruzi opomnike - lastnosti na nakljucnih podatkih`() {
        val random = java.util.Random(42)
        fun randomOpomnik(): Opomnik {
            val id = random.nextInt(5).toString()
            val besedilo = listOf("A", "B", "C")[random.nextInt(3)]
            val cas = random.nextInt(3).toLong() * 100
            val izbrisan = random.nextBoolean()
            val spremenjeno = random.nextInt(3).toLong() * 100
            return Opomnik(id, besedilo, cas, izbrisan, spremenjeno)
        }
        
        for (i in 0..200) {
            val a = listOf(randomOpomnik(), randomOpomnik())
            val b = listOf(randomOpomnik(), randomOpomnik())
            val c = listOf(randomOpomnik(), randomOpomnik())
            
            // Komutativnost
            val ab = zdruzi(a, b)
            val ba = zdruzi(b, a)
            assertEquals(ab, ba, "Ni komutativno za $a in $b")
            
            // Idempotentnost
            assertEquals(ab, zdruzi(ab, ab), "Ni idempotentno")
            
            // Asociativnost
            val abc1 = zdruzi(zdruzi(a, b), c)
            val abc2 = zdruzi(a, zdruzi(b, c))
            assertEquals(abc1, abc2, "Ni asociativno")
        }
    }

    // Testi za zdruzi(Opomnik)
    @Test
    fun `zdruzi opomnike - prazna seznama`() {
        val rezultat = zdruzi(emptyList<Opomnik>(), emptyList<Opomnik>())
        assertEquals(0, rezultat.size)
    }

    @Test
    fun `zdruzi opomnike - novejsi zmaga`() {
        val stari = Opomnik("1", "Staro", 100, false)
        val novi = Opomnik("1", "Novo", 200, false)
        val rezultat = zdruzi(listOf(stari), listOf(novi))
        assertEquals(1, rezultat.size)
        assertEquals("Novo", rezultat[0].besedilo)
    }

    @Test
    fun `zdruzi opomnike - enak cas, brisanje zmaga`() {
        val ziv = Opomnik("1", "Vsebina", 100, false)
        val izbrisan = Opomnik("1", "Vsebina", 100, true)
        val rezultat1 = zdruzi(listOf(ziv), listOf(izbrisan))
        val rezultat2 = zdruzi(listOf(izbrisan), listOf(ziv))
        assertEquals(true, rezultat1[0].izbrisan)
        assertEquals(true, rezultat2[0].izbrisan)
    }

    @Test
    fun `zdruzi opomnike - razlicni id-ji se zdruzijo`() {
        val o1 = Opomnik("1", "Ena", 100, false)
        val o2 = Opomnik("2", "Dva", 100, false)
        val rezultat = zdruzi(listOf(o1), listOf(o2))
        assertEquals(2, rezultat.size)
    }

    @Test
    fun `zdruzi opomnike - novejsi po casu spremembe zmaga in cas ostane rok`() {
        val stari = Opomnik("1", "Vsebina", cas = 500, izbrisan = false, spremenjeno = 100)
        val novi = Opomnik("1", "Vsebina", cas = 200, izbrisan = false, spremenjeno = 200)
        val rezultat = zdruzi(listOf(stari), listOf(novi))
        assertEquals(1, rezultat.size)
        assertEquals(200, rezultat[0].cas)
        assertEquals(200, rezultat[0].spremenjeno)
    }

    // Testi za zapadli(Opomnik)
    @Test
    fun `zapadli - prazen seznam`() {
        val rezultat = zapadli(emptyList(), 100)
        assertEquals(0, rezultat.size)
    }

    @Test
    fun `zapadli - filter vrne samo tiste, katerih cas je manjsi ali enak zdaj`() {
        val o1 = Opomnik("1", "Zapadlo", 50, false)
        val o2 = Opomnik("2", "Se vedno velja", 150, false)
        val o3 = Opomnik("3", "Tocno zdaj", 100, false)
        val rezultat = zapadli(listOf(o1, o2, o3), 100)
        assertEquals(2, rezultat.size)
        assertEquals("1", rezultat[0].id) // zaradi sortinga 50, 100
        assertEquals("3", rezultat[1].id)
    }

    @Test
    fun `zapadli - filter izloci izbrisane`() {
        val o1 = Opomnik("1", "Zapadlo a izbrisano", 50, true)
        val rezultat = zapadli(listOf(o1), 100)
        assertEquals(0, rezultat.size)
    }

    @Test
    fun `zapadli - urejenost po casu`() {
        val o1 = Opomnik("1", "Drugi", 80, false)
        val o2 = Opomnik("2", "Prvi", 20, false)
        val o3 = Opomnik("3", "Tretji", 100, false)
        val rezultat = zapadli(listOf(o1, o2, o3), 200)
        assertEquals(3, rezultat.size)
        assertEquals("2", rezultat[0].id)
        assertEquals("1", rezultat[1].id)
        assertEquals("3", rezultat[2].id)
    }

    // Testi za poisci(Zapisek)
    @Test
    fun `poisci - prazna poizvedba vrne prazen seznam`() {
        val zapiski = listOf(Zapisek("1", "Nekaj", 100, false))
        val rezultat = poisci(zapiski, "   ")
        assertEquals(0, rezultat.size)
    }

    @Test
    fun `poisci - najde ujemanje brez obzira na velikost crk in uredi padajoce po casu`() {
        val z1 = Zapisek("1", "Kupi mleko", 100, false)
        val z2 = Zapisek("2", "Mleko je zdravo", 300, false)
        val z3 = Zapisek("3", "Kruh", 200, false)
        
        val rezultat = poisci(listOf(z1, z2, z3), "mLeKo")
        assertEquals(2, rezultat.size)
        assertEquals("2", rezultat[0].id) // Novejsi prvi (300)
        assertEquals("1", rezultat[1].id) // Starejsi drugi (100)
    }

    @Test
    fun `poisci - ignorira izbrisane zapiske`() {
        val z1 = Zapisek("1", "Kupi mleko", 100, true)
        val rezultat = poisci(listOf(z1), "mleko")
        assertEquals(0, rezultat.size)
    }
}
