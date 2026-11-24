package si.safeer.lina.samostojna.soglasja

enum class VrstaDejanja(val visokoTveganje: Boolean) {
    POSLJI_SPOROCILO(false),
    USTVARI_ZAPISEK(false),
    ODPRI_SPLETNO_STRAN(false),
    KLICI_STORITEV(false),
    /** Budilka v aplikaciji Ura (sistemski nadzor, 24. 11. 2026): enkratna potrditev velja za vse naslednje budilke. */
    NASTAVI_BUDILKO(false),
    DENAR(true),
    BRISANJE_PODATKOV(true),
    SPOROCILO_NOVEMU_PREJEMNIKU(true),
    NAKUP(true),
    SPREMEMBA_NASTAVITEV_ALI_DOSTOPA(true)
}
