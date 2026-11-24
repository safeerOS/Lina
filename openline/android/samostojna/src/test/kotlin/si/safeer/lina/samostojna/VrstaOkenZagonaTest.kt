package si.safeer.lina.samostojna

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class VrstaOkenZagonaTest {
    /** Pokaze vsa okna po vrsti, kot DialerActivity: naslednje, nato uporabnik zapre. */
    private fun vrstniRed(v0: VrstaOkenZagona): List<OknoZagona> {
        var v = v0
        val izid = mutableListOf<OknoZagona>()
        while (true) {
            val (o, nova) = v.naslednje() ?: break
            assertNull(nova.naslednje(), "ko je okno odprto, drugo ne sme priti")
            izid += o
            v = nova.zapri(o)
        }
        return izid
    }

    @Test fun `opozorilo vedno prvo, ne glede na vrstni red dodajanja`() {
        val v = VrstaOkenZagona().dodaj(OknoZagona.WIFI).dodaj(OknoZagona.OBVESTILA).dodaj(OknoZagona.PARJENJE).dodaj(OknoZagona.OPOZORILO)
        assertEquals(listOf(OknoZagona.OPOZORILO, OknoZagona.PARJENJE, OknoZagona.OBVESTILA, OknoZagona.WIFI), vrstniRed(v))
    }

    @Test fun `najdba lastnika - Wi-Fi pride med odprtim opozorilom, pokaze se sele po zaprtju`() {
        val (prvo, v1) = VrstaOkenZagona().dodaj(OknoZagona.OPOZORILO).naslednje()!!
        assertEquals(OknoZagona.OPOZORILO, prvo)
        val v2 = v1.dodaj(OknoZagona.WIFI)
        assertNull(v2.naslednje())
        val (drugo, v3) = v2.zapri(OknoZagona.OPOZORILO).naslednje()!!
        assertEquals(OknoZagona.WIFI, drugo)
        assertNull(v3.zapri(OknoZagona.WIFI).naslednje())
    }

    @Test fun `brez podvajanja - odprto, cakajoce in zaprto se ne doda znova`() {
        val (_, v) = VrstaOkenZagona().dodaj(OknoZagona.OPOZORILO).dodaj(OknoZagona.OPOZORILO).naslednje()!!
        assertEquals(v, v.dodaj(OknoZagona.OPOZORILO))
        val w = v.dodaj(OknoZagona.WIFI)
        assertEquals(w, w.dodaj(OknoZagona.WIFI))
        val z = w.zapri(OknoZagona.OPOZORILO)
        assertEquals(z, z.dodaj(OknoZagona.OPOZORILO))
        assertEquals(listOf(OknoZagona.WIFI), vrstniRed(z))
    }

    @Test fun `pozabljeno zaprto okno se sme spet pokazati`() {
        val v = VrstaOkenZagona().zapri(OknoZagona.WIFI)
        assertNull(v.dodaj(OknoZagona.WIFI).naslednje())
        assertEquals(listOf(OknoZagona.WIFI), vrstniRed(v.pozabi(OknoZagona.WIFI).dodaj(OknoZagona.WIFI)))
    }

    @Test fun `novo vabilo za parjenje med odprtim starim - staro zapre, novo pride na vrsto`() {
        val (_, v) = VrstaOkenZagona().dodaj(OknoZagona.PARJENJE).naslednje()!!
        assertEquals(v, v.dodaj(OknoZagona.PARJENJE), "brez zapri+pozabi bi se novo vabilo izgubilo")
        val nova = v.zapri(OknoZagona.PARJENJE).pozabi(OknoZagona.PARJENJE).dodaj(OknoZagona.PARJENJE)
        assertEquals(listOf(OknoZagona.PARJENJE), vrstniRed(nova))
        assertEquals(listOf(OknoZagona.PARJENJE), vrstniRed(VrstaOkenZagona().zapri(OknoZagona.PARJENJE).pozabi(OknoZagona.PARJENJE).dodaj(OknoZagona.PARJENJE)))
    }

    @Test fun `zapri cakajoce okno (Wi-Fi se je medtem povezal) ga umakne iz vrste`() {
        val (_, v) = VrstaOkenZagona().dodaj(OknoZagona.OPOZORILO).dodaj(OknoZagona.WIFI).naslednje()!!
        assertEquals(emptyList(), vrstniRed(v.zapri(OknoZagona.WIFI).zapri(OknoZagona.OPOZORILO)))
    }

    @Test fun `zasuk - okno aplikacije spet caka, okno sistema ostane odprto, zaprta ostanejo zaprta`() {
        val prezivijo = setOf(OknoZagona.OBVESTILA)
        val (_, v) = VrstaOkenZagona().dodaj(OknoZagona.OPOZORILO).dodaj(OknoZagona.WIFI).naslednje()!!
        val po = VrstaOkenZagona.izNiza(v.vNiz()).poZasuku(prezivijo)
        assertEquals(listOf(OknoZagona.OPOZORILO, OknoZagona.WIFI), vrstniRed(po.dodaj(OknoZagona.OPOZORILO)))

        val sistem = VrstaOkenZagona(OknoZagona.OBVESTILA, setOf(OknoZagona.WIFI), setOf(OknoZagona.OPOZORILO))
        val po2 = VrstaOkenZagona.izNiza(sistem.vNiz()).poZasuku(prezivijo)
        assertEquals(sistem, po2)
        assertNull(po2.dodaj(OknoZagona.OPOZORILO).naslednje(), "Pozneje pred zasukom: opozorilo se ne ponovi, prosnja je se odprta")
    }

    @Test fun `zapis - povratno in pokvarjen`() {
        val v = VrstaOkenZagona(OknoZagona.PARJENJE, setOf(OknoZagona.WIFI, OknoZagona.OBVESTILA), setOf(OknoZagona.OPOZORILO))
        assertEquals(v, VrstaOkenZagona.izNiza(v.vNiz()))
        assertEquals(VrstaOkenZagona(), VrstaOkenZagona.izNiza(VrstaOkenZagona().vNiz()))
        assertEquals(VrstaOkenZagona(), VrstaOkenZagona.izNiza(null))
        assertEquals(VrstaOkenZagona(), VrstaOkenZagona.izNiza("x"))
        assertEquals(VrstaOkenZagona(), VrstaOkenZagona.izNiza("WIFI,OPOZORILO;;"))
        assertEquals(VrstaOkenZagona(cakajo = setOf(OknoZagona.WIFI)), VrstaOkenZagona.izNiza(";WIFI,NEZNANO;"))
    }
}
