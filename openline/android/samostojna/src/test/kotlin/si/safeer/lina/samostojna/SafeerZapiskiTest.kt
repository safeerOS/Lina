package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Lazen Safeer OS: shramba z istimi pravili zlitja in mejo Bindra (120000 znakov na niz), kot jo opisuje navodilo seje Safeer. */
private class LazenSafeer(var stanje: List<Zapisek> = emptyList(), val sprejmi: Boolean = true, val strankoVelikost: Int = 50_000) : PrenosVmesnika {
    val klici = mutableListOf<Int>()
    override fun poslji(operacija: Int, podatki: Map<String, Any?>): Map<String, Any?>? {
        klici += operacija
        return when (operacija) {
            SafeerOp.ZAPISKI_PREBERI -> {
                val j = v_json(Zapisi(1, stanje, emptyList()))
                if (j.length > BINDER_NAJVEC_ZNAKOV) mapOf("preveliko" to true) else mapOf("zapisi" to j)
            }
            SafeerOp.ZAPISKI_STRAN -> {
                val od = podatki["od"] as Int
                val stran = mutableListOf<Zapisek>(); var izpuscenih = 0; var dolzina = 0; var i = od
                while (i < stanje.size && dolzina < strankoVelikost) {
                    val d = zapiskiVJson(listOf(stanje[i])).length + 1
                    if (d > 118_000) izpuscenih++ else { stran += stanje[i]; dolzina += d }
                    i++
                }
                mapOf("zapisi" to v_json(Zapisi(1, stran, emptyList())), "naslednji" to (if (i >= stanje.size) -1 else i), "izpuscenih" to izpuscenih)
            }
            SafeerOp.ZAPISKI_POSLJI -> {
                val s = podatki["zapisi"] as String
                assertTrue(s.length < BINDER_NAJVEC_ZNAKOV, "niz ${s.length} presega mejo Bindra")
                if (!sprejmi) mapOf("sprejeto" to false)
                else { stanje = zdruzi(stanje, iz_json(s)!!.zapiski); mapOf("sprejeto" to true) }
            }
            else -> null
        }
    }
}

private fun zapisek(i: Int, dolzina: Int = 10) = Zapisek("id%05d".format(i), "x".repeat(dolzina), 1000L + i, false)

class SafeerZapiskiTest {
    @Test fun `majhno stanje se zdruzi v obe smeri`() {
        val safeer = LazenSafeer(listOf(zapisek(1), zapisek(2)))
        val izid = SafeerZapiski(safeer).uskladi(listOf(zapisek(2), zapisek(3)), zdajMs = 2000L)
        assertEquals(StanjeUsklajevanja.USKLAJENO, izid.stanje)
        assertEquals(listOf("id00001", "id00002", "id00003"), izid.zapiski.map { it.id })
        assertEquals(3, safeer.stanje.size)
    }

    @Test fun `veliko stanje se bere po straneh in poslje v skupinah pod mejo Bindra`() {
        val veliko = (1..400).map { zapisek(it, 1000) } // ~420 KB JSON
        val safeer = LazenSafeer(veliko)
        val lokalni = (401..800).map { zapisek(it, 1000) }
        val izid = SafeerZapiski(safeer).uskladi(lokalni, zdajMs = 2000L)
        assertEquals(StanjeUsklajevanja.USKLAJENO, izid.stanje)
        assertEquals(800, izid.zapiski.size)
        assertEquals(800, safeer.stanje.size)
        assertTrue(safeer.klici.count { it == SafeerOp.ZAPISKI_STRAN } >= 2)
        assertTrue(safeer.klici.count { it == SafeerOp.ZAPISKI_POSLJI } >= 3)
    }

    @Test fun `predolg lokalni zapisek gre cez v vec delih`() {
        val safeer = LazenSafeer()
        val izid = SafeerZapiski(safeer).uskladi(listOf(zapisek(1), zapisek(2, 125_000)), zdajMs = 2000L)
        assertEquals(0, izid.prevelikihLokalno)
        assertEquals(StanjeUsklajevanja.USKLAJENO, izid.stanje)
        assertEquals(2, izid.zapiski.size)
        assertTrue(safeer.stanje.size >= 3) // majhen zapisek + vsaj 2 dela
    }

    @Test fun `zavrnitev ni zanka in lokalno stanje ostane`() {
        val safeer = LazenSafeer(sprejmi = false)
        val lokalni = (1..3000).map { zapisek(it, 100) }
        val izid = SafeerZapiski(safeer).uskladi(lokalni, zdajMs = 2000L)
        assertEquals(StanjeUsklajevanja.ZAVRNJENO_MEJA, izid.stanje)
        assertEquals(3000, izid.zapiski.size)
        assertEquals(1, safeer.klici.count { it == SafeerOp.ZAPISKI_POSLJI })
    }

    @Test fun `brez Safeer OS Lina deluje sama`() {
        val izid = SafeerZapiski { _, _ -> null }.uskladi(listOf(zapisek(1)), zdajMs = 2000L)
        assertEquals(StanjeUsklajevanja.NI_SAFEER_OS, izid.stanje)
        assertEquals(1, izid.zapiski.size)
    }

    @Test fun `pokvarjen kazalec strani ne povzroci zanke`() {
        var n = 0
        val prenos = PrenosVmesnika { op, _ ->
            when (op) {
                SafeerOp.ZAPISKI_PREBERI -> mapOf("preveliko" to true)
                else -> { n++; mapOf("zapisi" to v_json(Zapisi(1, emptyList(), emptyList())), "naslednji" to 0, "izpuscenih" to 0) }
            }
        }
        assertEquals(null, SafeerZapiski(prenos).preberi())
        assertTrue(n <= 2)
    }

    @Test fun `izpuscene zapiske Safeer javi uporabniku`() {
        val safeer = LazenSafeer(listOf(zapisek(1, 125_000), zapisek(2)))
        val izid = SafeerZapiski(safeer).uskladi(emptyList(), zdajMs = 2000L)
        assertEquals(1, izid.izpuscenihOdSafeer)
        assertEquals(listOf("id00002"), izid.zapiski.map { it.id })
    }
}

class RazrezZapiskovTest {
    private fun velik(id: String, dolzina: Int, cas: Long = 5000L, znak: String = "a") = Zapisek(id, znak.repeat(dolzina), cas, false)

    @Test fun `majhen zapisek se ne razreze`() {
        val z = velik("u1", 100)
        assertEquals(listOf(z), razrezi(z))
    }

    @Test fun `velik zapisek se razreze in sestavi nazaj enak`() {
        val z = velik("u1", 250_000)
        val deli = razrezi(z)
        assertTrue(deli.size >= 3)
        assertTrue(deli.all { zapiskiVJson(listOf(it)).length < 100_000 && it.cas == z.cas && !it.izbrisan })
        assertEquals(listOf(z), sestavi(deli).zapiski)
    }

    @Test fun `surrogatni pari in znaki z ubegom se ne prelomijo`() {
        val z = velik("u1", 60_000, znak = "😀\"\n")
        val deli = razrezi(z)
        assertTrue(deli.size >= 2)
        assertTrue(deli.all { zapiskiVJson(listOf(it)).length < 100_000 })
        assertEquals(z.besedilo, sestavi(deli).zapiski.single().besedilo)
    }

    @Test fun `nepopoln niz delov se ne pokaze in ne cisti`() {
        val deli = razrezi(velik("u1", 250_000))
        val izid = sestavi(deli.dropLast(1))
        assertTrue(izid.zapiski.isEmpty())
        assertTrue(izid.ciscenje.isEmpty())
        assertEquals(1, izid.nepopolnih)
    }

    @Test fun `novejsa verzija zamenja staro in stari deli dobijo nagrobnik`() {
        val stari = razrezi(velik("u1", 250_000, cas = 5000L))
        val novi = Zapisek("u1", "kratko", 6000L, false)
        val izid = sestavi(stari + novi)
        assertEquals(listOf(novi), izid.zapiski)
        assertEquals(stari.size, izid.ciscenje.size)
        assertTrue(izid.ciscenje.all { it.izbrisan && it.cas == 6000L && it.besedilo.isEmpty() })
    }

    @Test fun `izbris velikega zapiska skrije dele`() {
        val deli = razrezi(velik("u1", 250_000, cas = 5000L))
        val izbris = razrezi(Zapisek("u1", "a".repeat(250_000), 6000L, true)).single()
        assertEquals("", izbris.besedilo)
        val izid = sestavi(deli + izbris)
        assertEquals(1, izid.zapiski.size)
        assertTrue(izid.zapiski.single().izbrisan)
    }

    @Test fun `dve napravi izmenjata velik zapisek prek lazne shrambe`() {
        val safeer = LazenSafeer()
        val z = velik("u1", 250_000, cas = 5000L)
        val a = SafeerZapiski(safeer).uskladi(listOf(z), zdajMs = 6000L)
        assertEquals(StanjeUsklajevanja.USKLAJENO, a.stanje)
        val b = SafeerZapiski(safeer).uskladi(emptyList(), zdajMs = 6000L)
        assertEquals(StanjeUsklajevanja.USKLAJENO, b.stanje)
        assertEquals(listOf(z), b.zapiski)
    }

    @Test fun `urejanje velikega zapiska v kratkega po izmenjavi ne pusti starih delov zivih`() {
        val safeer = LazenSafeer()
        SafeerZapiski(safeer).uskladi(listOf(velik("u1", 250_000, cas = 5000L)), zdajMs = 6000L)
        val kratek = Zapisek("u1", "kratko", 7000L, false)
        val izid = SafeerZapiski(safeer).uskladi(listOf(kratek), zdajMs = 8000L)
        assertEquals(listOf(kratek), izid.zapiski)
        assertTrue(safeer.stanje.filter { razberiDel(it.id) != null }.all { it.izbrisan })
    }
}
