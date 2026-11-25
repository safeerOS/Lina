package si.safeer.lina.samostojna

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Slepi pregled telefona 0.2.13, T12: izmisljena mapa brez narekovajev in pot Windows. */
class NajdbeTelefona0213MapeTest {
    private val pogovor = listOf(Sporocilo("user", "Naredi nalogo za Lino na računalniku."))

    @Test fun `T12 - ime mape brez narekovajev ali pot Windows, ki je lastnik ni povedal - Lina vprasa`() {
        for (n in listOf("V mapi Lina-Project popravi prijavo.", "V mapi C:\\Lina-Project popravi prijavo.", "V projektu Lina_Projekt popravi prijavo."))
            assertTrue(SamostojnaNaloga.pripravi(n, pogovor, emptyList()) is SamostojnaNaloga.Izid.Manjka, n)
    }

    @Test fun `T12 - navadni stavki in mapa, ki jo je lastnik povedal, niso izmisljena mapa`() {
        for (n in listOf("V mapi Prenosi poišči račun in ga preimenuj.", "Projekt posodobi in poženi preizkuse.", "V projektu popravi prijavo.",
                "Mapo uredi po datumih.", "V projektih preveri odvisnosti."))
            assertTrue(SamostojnaNaloga.pripravi(n, pogovor, emptyList()) is SamostojnaNaloga.Izid.Pripravljena, n)
        val zIme = listOf(Sporocilo("user", "Projekt je v mapi Lina-Project na disku C:\\Lina-Project."))
        assertTrue(SamostojnaNaloga.pripravi("V mapi C:\\Lina-Project popravi prijavo.", zIme, emptyList()) is SamostojnaNaloga.Izid.Pripravljena)
        assertTrue(SamostojnaNaloga.pripravi("V mapi Lina-Project popravi prijavo.", zIme, emptyList()) is SamostojnaNaloga.Izid.Pripravljena)
    }
}
