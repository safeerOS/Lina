package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class IzbiraPotiTest {

    @Test
    fun `izbira - vrstni red LAN nato GLOBAL_NEPOSREDNO nato RELE in ko vse padejo null`() {
        var cas = 1_000L
        val izbira = IzbiraPoti(ura = { cas })

        // Privzeto izbere LAN
        assertEquals(Pot.LAN, izbira.izberi())

        // LAN pade -> GLOBAL_NEPOSREDNO
        izbira.neuspeh(Pot.LAN)
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())

        // Obe padeta -> RELE
        izbira.neuspeh(Pot.GLOBAL_NEPOSREDNO)
        assertEquals(Pot.RELE, izbira.izberi())

        // Vse padejo -> null
        izbira.neuspeh(Pot.RELE)
        assertNull(izbira.izberi())
    }

    @Test
    fun `izbira - po 300 s lazna ura spet dovoli LAN`() {
        var cas = 0L
        val izbira = IzbiraPoti(ura = { cas })

        izbira.neuspeh(Pot.LAN)
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())

        // Pred iztekom 300 s je LAN se v premoru
        cas = 299L
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())

        // Natanko po 300 s je spet na voljo LAN
        cas = 300L
        assertEquals(Pot.LAN, izbira.izberi())
    }

    @Test
    fun `izbira - podvajanje premora 300 v 600 v 1200 v 1800 kot zgornja meja`() {
        var cas = 0L
        val izbira = IzbiraPoti(ura = { cas })

        // 1. neuspeh: premor 300 s
        izbira.neuspeh(Pot.LAN)
        assertEquals(300L, izbira.trenutniPremor(Pot.LAN))
        cas += 299L
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())
        cas += 1L // skupaj +300 s
        assertEquals(Pot.LAN, izbira.izberi())

        // 2. neuspeh iste poti: premor 600 s
        izbira.neuspeh(Pot.LAN)
        assertEquals(600L, izbira.trenutniPremor(Pot.LAN))
        cas += 599L
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())
        cas += 1L // skupaj +600 s
        assertEquals(Pot.LAN, izbira.izberi())

        // 3. neuspeh iste poti: premor 1200 s
        izbira.neuspeh(Pot.LAN)
        assertEquals(1200L, izbira.trenutniPremor(Pot.LAN))
        cas += 1199L
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())
        cas += 1L // skupaj +1200 s
        assertEquals(Pot.LAN, izbira.izberi())

        // 4. neuspeh iste poti: premor 1800 s (zgornja meja, ne 2400 s)
        izbira.neuspeh(Pot.LAN)
        assertEquals(1800L, izbira.trenutniPremor(Pot.LAN))
        cas += 1799L
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())
        cas += 1L // skupaj +1800 s
        assertEquals(Pot.LAN, izbira.izberi())

        // 5. neuspeh iste poti: ostane na zgornji meji 1800 s
        izbira.neuspeh(Pot.LAN)
        assertEquals(1800L, izbira.trenutniPremor(Pot.LAN))
        cas += 1799L
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())
        cas += 1L
        assertEquals(Pot.LAN, izbira.izberi())
    }

    @Test
    fun `izbira - spremembaOmrezja pobrise celoten spomin neuspehov`() {
        var cas = 500L
        val izbira = IzbiraPoti(ura = { cas })

        izbira.neuspeh(Pot.LAN)
        izbira.neuspeh(Pot.LAN) // 600 s
        izbira.neuspeh(Pot.GLOBAL_NEPOSREDNO)
        izbira.neuspeh(Pot.RELE)
        assertNull(izbira.izberi())

        // Ob spremembi omrezja se spomin vseh poti pobrise in naslednji neuspeh zacne spet pri 300 s
        izbira.spremembaOmrezja()
        assertEquals(Pot.LAN, izbira.izberi())
        assertEquals(0L, izbira.trenutniPremor(Pot.LAN))

        izbira.neuspeh(Pot.LAN)
        assertEquals(300L, izbira.trenutniPremor(Pot.LAN))
    }

    @Test
    fun `izbira - uspeh pobrise spomin te poti`() {
        var cas = 100L
        val izbira = IzbiraPoti(ura = { cas })

        // LAN dvakrat pade (premor 600 s), GLOBAL_NEPOSREDNO enkrat pade (premor 300 s)
        izbira.neuspeh(Pot.LAN)
        cas += 300L
        izbira.neuspeh(Pot.LAN)
        assertEquals(600L, izbira.trenutniPremor(Pot.LAN))

        izbira.neuspeh(Pot.GLOBAL_NEPOSREDNO)
        assertEquals(Pot.RELE, izbira.izberi())

        // Uspeh na LAN pobrise spomin za LAN (tudi stevec podvajanja), GLOBAL_NEPOSREDNO pa ostane v premoru
        izbira.uspeh(Pot.LAN)
        assertEquals(0L, izbira.trenutniPremor(Pot.LAN))
        assertEquals(Pot.LAN, izbira.izberi())

        // Naslednji neuspeh na LAN ima spet zacetni premor 300 s (ne 1200 s)
        izbira.neuspeh(Pot.LAN)
        assertEquals(300L, izbira.trenutniPremor(Pot.LAN))
        // Ker je GLOBAL_NEPOSREDNO se vedno v premoru, izbere RELE
        assertEquals(Pot.RELE, izbira.izberi())
    }

    @Test
    fun `izbira - privzeta ura je monotona in premik stenske ure ne spremeni premora`() {
        val privzeta = IzbiraPoti()
        val poljeUra = IzbiraPoti::class.java.getDeclaredField("ura").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val privzetaUra = poljeUra.get(privzeta) as () -> Long
        val odcitek = privzetaUra()

        // Monotona ura od zagona procesa ni stenska epoch ura (System.currentTimeMillis / 1000 > 1_700_000_000)
        assertTrue(odcitek in 0L until 1_000_000_000L, "Privzeta ura mora biti monotona od zagona, ne stenska: $odcitek")

        var monotonaSekunde = 100L
        var stenskaSekunde = 1_795_000_000L
        val izbira = IzbiraPoti(ura = { monotonaSekunde })

        izbira.neuspeh(Pot.LAN)
        assertTrue(izbira.jeVPremoru(Pot.LAN))

        // Premik stenske ure za 1 uro nazaj ali naprej ne podaljsa in ne skrajsa premora
        stenskaSekunde -= 3600L
        monotonaSekunde = 250L
        assertTrue(izbira.jeVPremoru(Pot.LAN))
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())

        stenskaSekunde += 7200L
        monotonaSekunde = 399L
        assertTrue(izbira.jeVPremoru(Pot.LAN))
        assertEquals(Pot.GLOBAL_NEPOSREDNO, izbira.izberi())

        // Sele ko monotona ura napreduje za 300 s (na 400 s), se premor iztece
        monotonaSekunde = 400L
        assertFalse(izbira.jeVPremoru(Pot.LAN))
        assertEquals(Pot.LAN, izbira.izberi())
    }
}
