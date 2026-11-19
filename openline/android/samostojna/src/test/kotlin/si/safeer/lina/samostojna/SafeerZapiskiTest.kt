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

    @Test fun `predolg lokalni zapisek ostane lokalno in se pristeje`() {
        val safeer = LazenSafeer()
        val izid = SafeerZapiski(safeer).uskladi(listOf(zapisek(1), zapisek(2, 125_000)), zdajMs = 2000L)
        assertEquals(1, izid.prevelikihLokalno)
        assertEquals(2, izid.zapiski.size) // lokalno ni izgubljen
        assertEquals(1, safeer.stanje.size)
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
