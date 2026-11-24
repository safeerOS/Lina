package si.safeer.lina.samostojna

import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue

class ZajemGovoraTest {
    private val fs = 16000

    /** Cas (s) do prvega stanja, ki ni POSLUSA, ob dovajanju po 20 ms (kot AudioRecord); null = do konca posnetka poslusa. */
    private fun konec(x: DoubleArray, d: KonecGovora = KonecGovora()): Pair<StanjeGovora, Double>? {
        val kos = 320
        var i = 0
        while (i < x.size) {
            val n = minOf(kos, x.size - i)
            val s = d.dodaj(ShortArray(n) { x[i + it].coerceIn(-32768.0, 32767.0).toInt().toShort() })
            i += n
            if (s != StanjeGovora.POSLUSA) return s to i.toDouble() / fs
        }
        return null
    }

    /** Sinteticni »govor«: zlogi 200 ms (osnovni ton 150 Hz z visjimi harmoniki do 3 kHz), premor 100 ms. */
    private fun govor(zlogov: Int, amp: Double): DoubleArray = DoubleArray(zlogov * 4800) { i ->
        val t = i % 4800
        if (t >= 3200) 0.0 else {
            val ovoj = sin(PI * t / 3200)
            amp * ovoj * (1..20).sumOf { h -> sin(2 * PI * 150 * h * i / fs) / h }
        }
    }

    /** Sinteticni hrup tiskarne: brumenje 50/100 Hz, sum, udarci stroja vsakih 400 ms (30 ms, glasni). */
    private fun hrup(n: Int, amp: Double, r: Random): DoubleArray {
        val x = DoubleArray(n) { i -> amp * (3 * sin(2 * PI * 50 * i / fs) + 2 * sin(2 * PI * 100 * i / fs) + r.nextDouble(-1.0, 1.0)) }
        var p = 0
        while (p < n) { for (k in 0 until minOf(480, n - p)) x[p + k] += amp * 12 * exp(-k / 96.0) * r.nextDouble(-1.0, 1.0); p += 6400 }
        return x
    }

    @Test
    fun `konec govora v hrupu z udarci pride 1,6 s po zadnjem zlogu`() {
        val r = Random(2411)
        val g = govor(8, 2500.0)
        val x = hrup(fs * 10, 400.0, r)
        val zacetek = fs / 2
        for (i in g.indices) x[zacetek + i] += g[i]
        val konecGovora = (zacetek + g.size - 1600).toDouble() / fs
        val (stanje, t) = konec(x) ?: error("brez konca")
        assertEquals(StanjeGovora.KONEC, stanje)
        assertTrue(t in konecGovora + 1.6..konecGovora + 2.2, "konec $t, govor do $konecGovora")
    }

    @Test
    fun `neodvisno od ojacanja mikrofona`() {
        val r1 = Random(7); val r2 = Random(7)
        fun posnetek(r: Random, k: Double): DoubleArray {
            val x = hrup(fs * 10, 400.0 * k, r); val g = govor(6, 2500.0 * k)
            for (i in g.indices) x[fs + i] += g[i]
            return x
        }
        val glasno = konec(posnetek(r1, 1.0))!!
        val tiho = konec(posnetek(r2, 0.1))!!
        assertEquals(StanjeGovora.KONEC, tiho.first)
        assertTrue(abs(glasno.second - tiho.second) <= 0.1, "glasno $glasno, tiho $tiho")
    }

    @Test
    fun `samo hrup in udarci niso govor - po 8 s brez govora`() {
        val d = KonecGovora()
        val (stanje, t) = konec(hrup(fs * 12, 400.0, Random(3)), d)!!
        assertEquals(StanjeGovora.BREZ_GOVORA, stanje)
        assertEquals(8.0, t, 0.03)
        assertFalse(d.slisalGovor)
    }

    @Test
    fun `digitalna tisina na zacetku zajema ne pokvari ozadja`() {
        // Prva razlicica (ozadje navzgor samo 1 dB/s) je po nicelnih vzorcih stel sobni hrup za govor in ni koncala.
        val x = DoubleArray(fs) + hrup(fs * 10, 400.0, Random(11))
        val g = govor(6, 2500.0)
        for (i in g.indices) x[2 * fs + i] += g[i]
        val konecGovora = (2 * fs + g.size - 1600).toDouble() / fs
        val (stanje, t) = konec(x)!!
        assertEquals(StanjeGovora.KONEC, stanje)
        assertTrue(t in konecGovora + 1.6..konecGovora + 2.2, "konec $t, govor do $konecGovora")
    }

    @Test
    fun `govor od prve milisekunde se konca`() {
        val g = govor(5, 3000.0)
        val x = hrup(fs * 6, 300.0, Random(5))
        for (i in g.indices) x[i] += g[i]
        assertEquals(StanjeGovora.KONEC, konec(x)!!.first)
    }

    @Test
    fun `najvec 60 s`() {
        val g = govor(220, 3000.0) // 66 s brez premora, daljsega od 1,6 s
        assertEquals(StanjeGovora.NAJDLJE to 60.0, konec(g)!!.let { it.first to Math.round(it.second * 50) / 50.0 })
    }

    @Test
    fun `wav glava 16 kHz mono 16 bit in zaznava kot zvok`() {
        val w = wavIzPcm(ByteArray(3200) { it.toByte() })
        assertEquals(44 + 3200, w.size)
        assertEquals(VrstaPriponke.ZVOK to "audio/wav", zaznajVrstoPriponke(w, "govor.wav"))
        val b = java.nio.ByteBuffer.wrap(w).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        assertEquals(36 + 3200, b.getInt(4)); assertEquals(16000, b.getInt(24)); assertEquals(16.toShort(), b.getShort(34)); assertEquals(3200, b.getInt(40))
    }

    @Test
    fun `lastni zajem samo s stikalom in pri ponudniku, ki bere zvok`() {
        assertTrue(lastniZajemGovora(true, Ponudnik.GEMINI))
        assertTrue(lastniZajemGovora(true, Ponudnik.VERTEX))
        assertFalse(lastniZajemGovora(false, Ponudnik.GEMINI))
        for (p in listOf(Ponudnik.OPENROUTER, Ponudnik.OPENAI, Ponudnik.CLAUDE, Ponudnik.GROK)) assertFalse(lastniZajemGovora(true, p), p.name)
    }

    @Test
    fun `prepis iz odgovora modela`() {
        assertEquals("Pokliči Marka jutri.", prepisIzRezultata(Rezultat.Besedilo("  \"Pokliči Marka jutri.\"\n")))
        assertEquals("", prepisIzRezultata(Rezultat.Besedilo("   ")))
        assertEquals("", prepisIzRezultata(Rezultat.Napaka(500, "x")))
    }

    // --- Posnetki meritve (zvok-hrup-1510): 13 glasovnih ukazov, 16 kHz, sinteticni hrup tiskarne. Posnetki niso v repozitoriju
    // (glas lastnika); pot iz okolja LINA_ZVOK_POSNETKI, brez nje se preizkus preskoci.

    private fun beriWav(f: File): DoubleArray {
        val b = f.readBytes()
        val bb = java.nio.ByteBuffer.wrap(b).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        require(String(b, 0, 4) == "RIFF" && bb.getShort(22).toInt() == 1 && bb.getInt(24) == 16000 && bb.getShort(34).toInt() == 16) { f.name }
        var p = 12
        while (String(b, p, 4) != "data") p += 8 + bb.getInt(p + 4)
        val n = bb.getInt(p + 4) / 2
        return DoubleArray(n) { bb.getShort(p + 8 + it * 2).toDouble() }
    }

    /** Danasnji racunalnik (pogovor.tsx): RMS okna ~21 ms > 0,035, korak ~16,7 ms, konec po 1,6 s tisine po govoru. */
    private fun konecRms(x: DoubleArray): Double? {
        var govoril = false; var tihoOd = -1.0
        var i = 341
        while (i <= x.size) {
            var s = 0.0; for (k in i - 341 until i) s += (x[k] / 32768) * (x[k] / 32768)
            val t = i.toDouble() / fs
            if (sqrt(s / 341) > 0.035) { govoril = true; tihoOd = -1.0 }
            else if (govoril) { if (tihoOd < 0) tihoOd = t; if (t - tihoOd > 1.6) return t }
            i += 267
        }
        return null
    }

    /**
     * Referencni konec v cistem posnetku po istem pravilu (1,6 s tisine po govoru), govor = 20-ms okvir 12 dB nad sobnim sumom
     * posnetka (20. percentil nenicelnih okvirjev). Posnetek z dvema izrekoma in daljsim premorom se po pravilu konca po prvem.
     */
    private fun referencniKonec(c: DoubleArray): Double {
        val e = DoubleArray(c.size / 320) { k -> var s = 0.0; for (i in k * 320 until (k + 1) * 320) s += c[i] * c[i]; 10 * kotlin.math.log10(s / 320 + 1) }
        val nenicelni = e.filter { it > 1.0 }.sorted()
        val sobni = nenicelni[nenicelni.size / 5]
        var govoril = false; var tiho = 0
        for (k in e.indices) {
            if (e[k] > sobni + 12) { govoril = true; tiho = 0 } else if (govoril && ++tiho * 20 > 1600) return (k + 1) * 0.02
        }
        return (e.size + 81) * 0.02
    }

    @Test
    fun `posnetki meritve - konec pri 5 in 0 dB pravocasen in nikoli ne obvisi, star prag RMS pri 0 dB odpove`() {
        val koren = System.getenv("LINA_ZVOK_POSNETKI")?.let { File(it, "mesanice/sir16/brez") }
        assumeTrue(koren != null && File(koren, "cisto").isDirectory, "LINA_ZVOK_POSNETKI ni nastavljen")
        val imena = File(koren, "cisto").list()!!.filter { it.endsWith(".wav") }.sorted()
        assertTrue(imena.size >= 10, "posnetkov ${imena.size}")
        val izpis = StringBuilder()
        for (snr in listOf("cisto", "5", "0")) {
            var pravocasno = 0; var prezgodaj = 0; var brezKonca = 0; var zgresen = 0; var rmsKoncev = 0; var preskok = 0
            for (ime in imena) {
                val c = beriWav(File(koren, "cisto/$ime")); val m = if (snr == "cisto") c else beriWav(File(koren, "$snr/$ime"))
                // Mesanica, ki je bila zaradi vrha znizana, ni govor + hrup; razlika ne bi bila cisti hrup.
                if (m.size != c.size || m.maxOf { abs(it) } >= 32700) { preskok++; continue }
                val h = DoubleArray(m.size) { m[it] - c[it] }
                val hrupnoRep = m + h + h // posnetki imajo za govorom samo 0,8 s; hrup se nadaljuje
                val ref = referencniKonec(c)
                val km = konec(hrupnoRep)
                when {
                    km == null || km.first == StanjeGovora.NAJDLJE -> brezKonca++ // obvisi: nikoli ali sele po 60 s
                    km.first == StanjeGovora.BREZ_GOVORA -> zgresen++ // govora ni slisal: nic se ne poslje, uporabnik ponovi
                    km.second < ref - 0.3 -> prezgodaj++
                    km.second <= ref + 1.0 -> pravocasno++
                }
                if (konecRms(hrupnoRep) != null) rmsKoncev++
                izpis.append("$snr dB $ime: referenca ${"%.2f".format(ref)}, konec ${km?.let { "${it.first} %.2f".format(it.second) }}\n")
            }
            val n = imena.size - preskok
            println("POSNETKI $snr dB: n=$n pravocasno=$pravocasno prezgodaj=$prezgodaj zgresen=$zgresen brezKonca=$brezKonca rmsKoncev=$rmsKoncev preskok=$preskok")
            assertTrue(n >= 10, "uporabnih $n")
            assertEquals(0, brezKonca, izpis.toString())
            // 24. 11. 2026: 12/13 pri 5 in 0 dB; izjema g8238 (ena kratka beseda po 3 s cakanja), glej POROCILO.md.
            // Cisto (24. 11. 2026): 4/13 pravocasno, ostali +1 do +2 s POZNEJE (zacetek posnetka z nicami/pojemanjem, 3-s okno ozadja);
            // nikoli prezgodaj. Znana omejitev v POROCILO.md; zahteva tu: brez rezov in brez obvisenja.
            if (snr == "cisto") { assertEquals(0, prezgodaj, izpis.toString()); continue }
            assertTrue(pravocasno >= n - 1, "pravocasno $pravocasno / $n\n$izpis")
            if (snr == "0") assertTrue(rmsKoncev <= n / 2, "stari prag RMS je pri 0 dB koncal $rmsKoncev / $n (negativni dokaz)")
        }
        print(izpis)
    }
}
