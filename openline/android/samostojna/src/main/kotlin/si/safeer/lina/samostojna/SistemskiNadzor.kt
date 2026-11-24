package si.safeer.lina.samostojna

import si.safeer.lina.samostojna.soglasja.Obseg
import si.safeer.lina.samostojna.soglasja.TrajnaSoglasja
import si.safeer.lina.samostojna.soglasja.VrstaDejanja

/** Stanje telefona za sistemski nadzor; izvede ga aplikacija (Android), Asistent ga prebere ob vsakem vprasanju. */
interface SistemskiNadzorVir {
    /** Stikalo »Sistemski nadzor telefona« v Nastavitvah (privzeto vklopljeno). */
    fun vklopljen(): Boolean
    /** null = ni podatka. */
    fun baterija(): StanjeBaterije?
}

data class StanjeBaterije(val odstotek: Int, val polni: Boolean)

/**
 * Sistemski nadzor telefona iz Line (lastnik 23. 11. 2026): budilka, nacin »ne moti«, svetlost zaslona, stanje baterije.
 * Model samo predlaga z vrstico; dejanje izvede aplikacija po uporabnikovi potrditvi. Budilka ima trajno soglasje
 * (»Velja tudi za vse podobne«), »ne moti« in svetlost sta sprememba nastavitev sistema in vedno vprasata (pravilo 19. in 24. 11.).
 */
object SistemskiNadzor {
    /** Obseg soglasij sistemskega nadzora: ista vrsta dejanja na tem telefonu. */
    val OBSEG = Obseg("lina-telefon")

    fun razclenjiNeMoti(vsebina: String): Odgovor.NeMoti? = when (vsebina.trim().lowercase()) {
        "vklop", "vklopi", "on" -> Odgovor.NeMoti(true)
        "izklop", "izklopi", "off" -> Odgovor.NeMoti(false)
        else -> null
    }

    private val ODSTOTEK = Regex("^(\\d{1,3})\\s*%?$")

    fun razclenjiSvetlost(vsebina: String): Odgovor.Svetlost? {
        val n = ODSTOTEK.matchEntire(vsebina.trim())?.groupValues?.get(1)?.toInt() ?: return null
        return if (n in 0..100) Odgovor.Svetlost(n) else null
    }

    /** 0..100 % v Settings.System.SCREEN_BRIGHTNESS (1..255); 0 ni dovoljen, ker je zaslon na nekaterih telefonih takrat crn. */
    fun vSistemsko(odstotek: Int): Int = ((odstotek.coerceIn(0, 100) * 255 + 50) / 100).coerceIn(1, 255)

    fun opisBaterije(b: StanjeBaterije?): String =
        if (b == null || b.odstotek !in 0..100) "stanje baterije ni znano"
        else "baterija telefona je napolnjena ${b.odstotek} %" + if (b.polni) " in se polni" else " in se ne polni"

    /** Del sistemskega navodila; doda se ob vsakem vprasanju, ker se baterija in stikalo spreminjata. */
    fun navodilo(b: StanjeBaterije?): String =
        " Sistemski nadzor telefona: ${opisBaterije(b)} (povej, ce uporabnik vprasa o bateriji). " +
            "Ce uporabnik zeli vklopiti ali izklopiti nacin »ne moti«, dodaj samostojno vrstico natanko [[nemoti: vklop]] ali [[nemoti: izklop]]; " +
            "ce zeli drugacno svetlost zaslona, dodaj samostojno vrstico natanko [[svetlost: 40]] (odstotek 0-100; ena vrstica, nic drugega). " +
            "Nastavitev spremeni aplikacija sele, ko jo uporabnik potrdi, zato v odgovoru povej, kaj predlagas."

    /** Vrsta dejanja v skupnem modulu soglasij (naloga 02f). */
    fun vrsta(o: Odgovor): VrstaDejanja? = when (o) {
        is Odgovor.NovaBudilka -> VrstaDejanja.NASTAVI_BUDILKO
        is Odgovor.NeMoti, is Odgovor.Svetlost -> VrstaDejanja.SPREMEMBA_NASTAVITEV_ALI_DOSTOPA
        else -> null
    }

    /**
     * Ali mora aplikacija pred dejanjem vprasati. Po rezultatih orodij (splet, koledar) vedno: vrstico bi lahko vsililo
     * tuje besedilo, ki ga je model prebral v tem obratu.
     */
    fun potrebnaPotrditev(vrsta: VrstaDejanja, soglasja: TrajnaSoglasja, poOrodjih: Boolean): Boolean =
        poOrodjih || !soglasja.jeDovoljeno(vrsta, OBSEG)

    /** Ali dialog ponudi »Velja tudi za vse podobne« (samo dejanja brez visokega tveganja). */
    fun ponudiZaPodobne(vrsta: VrstaDejanja): Boolean = !vrsta.visokoTveganje
}
