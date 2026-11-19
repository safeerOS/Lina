package si.safeer.lina.samostojna.soglasja

enum class VrstaDejanja(val visokoTveganje: Boolean) {
    POSLJI_SPOROCILO(false),
    USTVARI_ZAPISEK(false),
    ODPRI_SPLETNO_STRAN(false),
    KLICI_STORITEV(false),
    DENAR(true),
    BRISANJE_PODATKOV(true),
    SPOROCILO_NOVEMU_PREJEMNIKU(true),
    NAKUP(true),
    SPREMEMBA_NASTAVITEV_ALI_DOSTOPA(true)
}
