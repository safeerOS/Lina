package si.safeer.lina.samostojna

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

/** Sporocila z racunalnika gredo v spomin telefona enkrat, z izvirnim casom (22. 11. 2026). Podatki izmisljeni. */
class SpominUvozTest {
    private class Pomnilnik : Shramba {
        var v: String? = null
        override fun preberi() = v
        override fun shrani(vsebina: String) { v = vsebina }
    }

    @Test
    fun `nova sporocila z racunalnika enkrat, ponovljena in lastna ne`() {
        val pogovor = PogovorShramba(Pomnilnik())
        pogovor.dodaj("lastnik", "Na telefonu vpisano", java.time.Instant.parse("2026-11-20T08:00:00Z"))
        val prejeta = listOf(
            PogovorSinhron("lastnik", "Na telefonu vpisano", "2026-11-20T08:00:00Z"),
            PogovorSinhron("lastnik", "Racunalnik: rok za mizarja je petek", "2026-11-20T10:00:00Z"),
            PogovorSinhron("lina", "Zapisala sem rok.", "2026-11-20T10:00:05Z"),
        )
        val nova = pogovor.zlijInVrni(prejeta)
        assertEquals(2, nova.size)
        assertEquals(0, pogovor.zlijInVrni(prejeta).size)

        val spomin = SpominPogovorov(Files.createTempDirectory("spomin-uvoz").toFile())
        val obrati = nova.map { SpominPogovorov.Obrat(java.time.Instant.parse(it.cas).toEpochMilli(), if (it.vloga == "lina") "lina" else "uporabnik", it.besedilo) }
        assertEquals(2, spomin.zapisiUvozene(obrati))
        assertEquals(0, spomin.zapisiUvozene(obrati), "ponovna sinhronizacija ne podvoji")
        assertEquals(listOf("uporabnik", "lina"), spomin.vsi().map { it.vloga })
        assertEquals(java.time.Instant.parse("2026-11-20T10:00:00Z").toEpochMilli(), spomin.vsi()[0].cas)
        assertEquals(0, spomin.zapisiUvozene(listOf(SpominPogovorov.Obrat(1L, "uporabnik", "geslo je Skrivno123"))), "skrivnost ne gre v spomin")
    }
}
