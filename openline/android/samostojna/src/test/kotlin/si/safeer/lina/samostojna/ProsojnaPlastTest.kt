package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

class ProsojnaPlastTest {
    private val e = 1e-6

    private fun blizu(pricakovano: TockaSlike, dejansko: TockaSlike, d: Double = e) {
        assertEquals(pricakovano.x, dejansko.x, d, "x")
        assertEquals(pricakovano.y, dejansko.y, d, "y")
    }

    @Test
    fun `zacetna poravnava postavi predlogo na sredino slike in jo celo vidno pomanjsa`() {
        val p = zacetnaPoravnava(1000, 500, 4000, 3000)
        assertEquals(2000.0, p.x, e)
        assertEquals(1500.0, p.y, e)
        assertEquals(0.0, p.kot, e)
        // 60 % sirine slike: 2400 / 1000; visina 500 * 2.4 = 1200 < 0.6 * 3000
        assertEquals(2.4, p.merilo, e)
        assertEquals(PRIVZETA_PROSOJNOST, p.prosojnost, e)
        assertTrue(!p.zaklenjena)
        // Visoka predloga: omeji visina.
        assertEquals(0.6 * 3000 / 2000, zacetnaPoravnava(500, 2000, 4000, 3000).merilo, e)
    }

    @Test
    fun `zacetna poravnava ob nicelnih merah ne deli z nic`() {
        val p = zacetnaPoravnava(0, 0, 0, 0)
        assertEquals(1.0, p.merilo, e)
    }

    @Test
    fun `premik in kretnja ne delujeta, ko je poravnava zaklenjena`() {
        val p = Poravnava(10.0, 20.0, 5.0, 1.0, zaklenjena = true)
        assertEquals(p, p.premakni(5.0, 5.0))
        assertEquals(p, p.kretnja(TockaSlike(0.0, 0.0), 2.0, 30.0))
    }

    @Test
    fun `premik premakne sredisce predloge`() {
        val p = Poravnava(10.0, 20.0, 0.0, 1.0).premakni(5.0, -3.0)
        assertEquals(15.0, p.x, e)
        assertEquals(17.0, p.y, e)
    }

    @Test
    fun `kretnja povecuje in zasuka okoli tocke med prsti`() {
        // Sredisce (10, 0), prsti v (0, 0): podvojitev in zasuk 90 stopinj pripelje sredisce v (0, 20) (y navzdol, zasuk v smeri urinega kazalca).
        val p = Poravnava(10.0, 0.0, 0.0, 1.0).kretnja(TockaSlike(0.0, 0.0), 2.0, 90.0)
        assertEquals(0.0, p.x, e)
        assertEquals(20.0, p.y, e)
        assertEquals(90.0, p.kot, e)
        assertEquals(2.0, p.merilo, e)
    }

    @Test
    fun `tocka pod prsti ostane pod prsti po kretnji`() {
        val w = 400; val h = 200
        val p = Poravnava(500.0, 300.0, 15.0, 1.5)
        val prst = predlogaVSliko(p, w, h, TockaSlike(50.0, 30.0))
        val q = p.kretnja(prst, 1.7, -25.0)
        blizu(prst, predlogaVSliko(q, w, h, TockaSlike(50.0, 30.0)))
    }

    @Test
    fun `merilo kretnje je omejeno in neveljavne vrednosti nic ne spremenijo`() {
        val p = Poravnava(0.0, 0.0, 0.0, 1.0)
        assertEquals(NAJVECJE_MERILO, p.kretnja(TockaSlike(0.0, 0.0), 1e9, 0.0).merilo, e)
        assertEquals(NAJMANJSE_MERILO, p.kretnja(TockaSlike(0.0, 0.0), 1e-9, 0.0).merilo, e)
        assertEquals(p, p.kretnja(TockaSlike(0.0, 0.0), Double.NaN, 0.0))
        assertEquals(p, p.kretnja(TockaSlike(0.0, 0.0), 1.0, Double.POSITIVE_INFINITY))
        assertEquals(p, p.premakni(Double.NaN, 1.0))
        assertEquals(p, p.kretnja(TockaSlike(Double.NaN, 0.0), 2.0, 0.0))
    }

    @Test
    fun `kot je vedno v obmocju od -180 do 180`() {
        assertEquals(170.0, normalizirajKot(-190.0), e)
        assertEquals(180.0, normalizirajKot(180.0), e)
        assertEquals(180.0, normalizirajKot(-180.0), e)
        assertEquals(-90.0, normalizirajKot(270.0), e)
        assertEquals(10.0, normalizirajKot(730.0), e)
        assertEquals(350.0 - 360.0, Poravnava(0.0, 0.0, 340.0, 1.0).kretnja(TockaSlike(0.0, 0.0), 1.0, 10.0).kot, e)
    }

    @Test
    fun `prosojnost je omejena`() {
        assertEquals(NAJMANJSA_PROSOJNOST, omejiProsojnost(0.0), e)
        assertEquals(1.0, omejiProsojnost(3.0), e)
        assertEquals(0.4, omejiProsojnost(0.4), e)
        assertEquals(PRIVZETA_PROSOJNOST, omejiProsojnost(Double.NaN), e)
    }

    @Test
    fun `predloga v sliko upostevata zasuk in merilo okoli sredisca`() {
        val p = Poravnava(100.0, 100.0, 90.0, 2.0)
        // Sredisce predloge 20x10 je (10, 5); desni rob sredine (20, 5) je 10 px desno, po merilu 20, po zasuku 90 navzdol.
        blizu(TockaSlike(100.0, 100.0), predlogaVSliko(p, 20, 10, TockaSlike(10.0, 5.0)))
        blizu(TockaSlike(100.0, 120.0), predlogaVSliko(p, 20, 10, TockaSlike(20.0, 5.0)))
    }

    /** Fotografija: oznaka stranice 50 mm, 4 px na mm, zasukana za [kot] stopinj okoli (cx, cy). */
    private fun vogaliOznake(cx: Double, cy: Double, kot: Double, pxNaMm: Double = 4.0, s: Double = 50.0): List<TockaSlike> {
        val r = Math.toRadians(kot)
        return listOf(-1.0 to -1.0, 1.0 to -1.0, 1.0 to 1.0, -1.0 to 1.0).map { (a, b) ->
            val x = a * s / 2 * pxNaMm; val y = b * s / 2 * pxNaMm
            TockaSlike(cx + x * cos(r) - y * sin(r), cy + x * sin(r) + y * cos(r))
        }
    }

    @Test
    fun `merilna ravnina ima izhodisce v sredini oznake in mm vzdolz njenih robov`() {
        val h = merilnaRavnina(vogaliOznake(1000.0, 800.0, 0.0), 50.0)!!
        blizu(TockaSlike(0.0, 0.0), preslikaj(h, TockaSlike(1000.0, 800.0)))
        blizu(TockaSlike(25.0, -10.0), preslikaj(h, TockaSlike(1100.0, 760.0)))
    }

    @Test
    fun `napaka tapa 1 px na enem vogalu premakne predlogo 200 mm stran za manj kot pol mm`() {
        // 3,4 px/mm (2048 px na ~600 mm mize), oznaka 50 mm; polna homografija iz ene oznake bi dala do 4,7 mm (teki/09-obcutljivost.txt).
        val px = 2048.0 / 600.0
        val v = vogaliOznake(400.0, 1000.0, 0.0, pxNaMm = px)
        val p = Poravnava(400.0 + 200 * px, 1000.0, 0.0, 1.0)
        val tocno = polozajVMm(merilnaRavnina(v, 50.0)!!, p, 100, 100)
        for (i in 0 until 4) for ((dx, dy) in listOf(1.0 to 0.0, -1.0 to 0.0, 0.0 to 1.0, 0.0 to -1.0)) {
            val z = v.toMutableList().also { it[i] = TockaSlike(it[i].x + dx, it[i].y + dy) }
            val m = polozajVMm(merilnaRavnina(z, 50.0)!!, p, 100, 100)
            assertTrue(abs(m.x - tocno.x) < 0.5 && abs(m.y - tocno.y) < 0.5, "vogal $i ($dx, $dy): ${m.x - tocno.x}, ${m.y - tocno.y}")
        }
    }

    @Test
    fun `merilna ravnina zavrne napacen vrstni red, nekonveksne vogale in neveljavno stranico`() {
        val v = vogaliOznake(1000.0, 800.0, 0.0)
        assertNull(merilnaRavnina(v.reversed(), 50.0), "nasprotna smer urinega kazalca (zrcalno)")
        assertNull(merilnaRavnina(listOf(v[0], v[2], v[1], v[3]), 50.0), "prekrizan stirikotnik")
        assertNull(merilnaRavnina(v, 0.0))
        assertNull(merilnaRavnina(v, Double.NaN))
        assertNull(merilnaRavnina(v.take(3), 50.0))
        // Premajhna oznaka (vogali skoraj v isti tocki) ne da meritve.
        assertNull(merilnaRavnina(vogaliOznake(10.0, 10.0, 0.0, pxNaMm = 0.01), 50.0))
    }

    @Test
    fun `polozaj predloge v mm, zasuk in sirina iz poravnave in oznake`() {
        // Oznaka zasukana za 10 stopinj; predloga 250 mm siroka (1000 px pri 4 px/mm => merilo 1), postavljena 100 mm desno in 75 mm pod
        // sredino oznake (v smeri oznake) in zasukana 2 stopinji glede na oznako.
        val kotOznake = 10.0
        val h = merilnaRavnina(vogaliOznake(2000.0, 1500.0, kotOznake), 50.0)!!
        val r = Math.toRadians(kotOznake)
        val (mx, my) = 100.0 * 4 to 75.0 * 4
        val p = Poravnava(2000.0 + mx * cos(r) - my * sin(r), 1500.0 + mx * sin(r) + my * cos(r), kotOznake + 2.0, 1.0)
        val m = polozajVMm(h, p, 1000, 400)
        assertEquals(100.0, m.x, 1e-6)
        assertEquals(75.0, m.y, 1e-6)
        assertEquals(2.0, m.kot, 1e-6)
        assertEquals(250.0, m.sirina, 1e-6)
    }

    @Test
    fun `odmik od shranjene poravnave v mm in stopinjah`() {
        val o = odmik(PolozajMm(0.0, 75.0, 1.0, 250.0), PolozajMm(3.5, 72.0, -0.5, 251.0))
        assertEquals(3.5, o.dx, e)
        assertEquals(-3.0, o.dy, e)
        assertEquals(-1.5, o.zasuk, e)
        assertEquals(-2.0, odmik(PolozajMm(0.0, 0.0, 179.0, 1.0), PolozajMm(0.0, 0.0, 177.0, 1.0)).zasuk, e)
        assertEquals(2.0, odmik(PolozajMm(0.0, 0.0, 179.0, 1.0), PolozajMm(0.0, 0.0, -179.0, 1.0)).zasuk, e)
    }

    @Test
    fun `zapis poravnave se prebere nazaj enako`() {
        val s = ShranjenaPoravnava(
            Poravnava(12.5, -3.25, 1.75, 0.8, 0.35, zaklenjena = true), 1000, 400,
            vogaliOznake(1000.0, 800.0, 5.0), 50.0, PolozajMm(1.0, 2.0, 0.5, 250.0),
        )
        assertEquals(s, preberiPoravnavo(zapisPoravnave(s)))
        val brez = ShranjenaPoravnava(Poravnava(1.0, 2.0, 0.0, 1.0), 10, 20, null, PRIVZETA_STRANICA_OZNAKE_MM, null)
        assertEquals(brez, preberiPoravnavo(zapisPoravnave(brez)))
    }

    @Test
    fun `pokvarjen ali tuj zapis ne da poravnave`() {
        assertNull(preberiPoravnavo(null))
        assertNull(preberiPoravnavo(""))
        assertNull(preberiPoravnavo("{}"))
        assertNull(preberiPoravnavo("ni json"))
        assertNull(preberiPoravnavo("""{"v":2,"x":1,"y":1,"kot":0,"merilo":1,"prosojnost":0.5,"zaklep":false,"w":1,"h":1}"""))
        assertNull(preberiPoravnavo("""{"v":1,"x":1,"y":1,"kot":0,"merilo":-1,"prosojnost":0.5,"zaklep":false,"w":1,"h":1}"""))
        assertNull(preberiPoravnavo("""{"v":1,"x":1,"y":1,"kot":0,"merilo":1,"prosojnost":0.5,"zaklep":false,"w":0,"h":1}"""))
        // Vogali oznake, ki ne dajo merilne ravnine, se zavrzejo (poravnava ostane).
        val z = preberiPoravnavo("""{"v":1,"x":1,"y":1,"kot":0,"merilo":1,"prosojnost":0.5,"zaklep":false,"w":1,"h":1,"oznaka":[0,0,0,0,0,0,0,0],"stranica":50}""")
        assertNotNull(z)
        assertNull(z!!.kotiOznake)
    }

    @Test
    fun `stranica oznake je omejena na smiselne mere`() {
        assertNull(stranicaOznake("abc"))
        assertNull(stranicaOznake("0"))
        assertNull(stranicaOznake("2000"))
        assertEquals(50.0, stranicaOznake("50")!!, e)
        assertEquals(42.5, stranicaOznake("42,5")!!, e)
    }
}
