package si.safeer.lina.samostojna

// Sest zaslonov osebne asistentke in digitalne tajnice Lina.
enum class Zaslon(
    val oznakaSl: String,
    val oznakaEn: String,
    val opisSl: String,
    val opisEn: String
) {
    DOMOV(
        oznakaSl = "Domov",
        oznakaEn = "Home",
        opisSl = "Pozdrav, glasovni gumb (obla) in hiter dostop",
        opisEn = "Greeting, voice button (orb) and quick access"
    ),
    POGOVOR(
        oznakaSl = "Pogovor",
        oznakaEn = "Chat",
        opisSl = "Pogovor prek mikrofona ali tipkovnice",
        opisEn = "Conversation via microphone or keyboard"
    ),
    KOLEDAR(
        oznakaSl = "Koledar",
        oznakaEn = "Calendar",
        opisSl = "Dnevni in tedenski pregled dogodkov",
        opisEn = "Daily and weekly schedule overview"
    ),
    OPRAVILA(
        oznakaSl = "Opravila",
        oznakaEn = "Tasks",
        opisSl = "Lina predlaga opravila in opomnike",
        opisEn = "Lina suggests tasks and reminders"
    ),
    ZAPISKI(
        oznakaSl = "Zapiski",
        oznakaEn = "Notes",
        opisSl = "Narekovanje in prepis zapiskov",
        opisEn = "Voice dictation and note transcription"
    ),
    KOMUNIKACIJA(
        oznakaSl = "Komunikacija",
        oznakaEn = "Communication",
        opisSl = "Pomoc pri klicih, sporocilih in e-posti",
        opisEn = "Assistance with calls, messages and email"
    );

    fun oznaka(jezik: Jezik = Jezik.SL): String = when (jezik) {
        Jezik.SL -> oznakaSl
        Jezik.EN -> oznakaEn
    }

    fun opis(jezik: Jezik = Jezik.SL): String = when (jezik) {
        Jezik.SL -> opisSl
        Jezik.EN -> opisEn
    }
}

// Smer premika med zasloni v spodnji vrstici.
enum class Smer(val korak: Int) {
    NAPREJ(1),
    NAZAJ(-1),
    DESNO(1),
    LEVO(-1)
}

// Element spodnje navigacijske vrstice s 6 zasloni.
data class ElementSpodnjeVrstice(
    val zaslon: Zaslon,
    val oznaka: String,
    val poudarjen: Boolean,
    val omogocen: Boolean = true
) {
    val izbran: Boolean get() = poudarjen
}

// Vrste dejanj asistentke glede na potrebo po uporabnikovi potrditvi.
enum class Dejanje {
    POSLJI_SPOROCILO,
    POSLJI_EPOSTO,
    IZBRISI,
    POKLICI,
    PREBERI_KOLEDAR,
    USTVARI_OSNUTEK,
    DODAJ_ZAPISEK,
    DODAJ_OPOMNIK,
    PREKLOPI_ZASLON
}

// Vrne naslednji zaslon glede na podano smer (krozno med vsemi 6 zasloni).
fun naslednji(zaslon: Zaslon, smer: Smer = Smer.NAPREJ): Zaslon {
    return naslednji(zaslon, smer.korak)
}

// Vrne naslednji zaslon glede na celostevilski premik (npr. +1 ali -1).
fun naslednji(zaslon: Zaslon, smer: Int): Zaslon {
    val vsi = Zaslon.values()
    val n = vsi.size
    val indeks = ((zaslon.ordinal + (smer % n)) + n) % n
    return vsi[indeks]
}

// Pripravi seznam vseh 6 zaslonov za spodnjo vrstico, kjer je izbrani zaslon poudarjen.
fun spodnjaVrsticaZasloni(izbran: Zaslon, jezik: Jezik = Jezik.SL): List<ElementSpodnjeVrstice> {
    return Zaslon.values().map { zaslon ->
        ElementSpodnjeVrstice(
            zaslon = zaslon,
            oznaka = zaslon.oznaka(jezik),
            poudarjen = zaslon == izbran,
            omogocen = zmoznostBrezRacunalnika(zaslon)
        )
    }
}

// Vrne true za obcutljiva dejanja (posiljanje sporocil/e-poste, klicanje, brisanje), ki zahtevajo potrditev uporabnika.
fun potrebujePotrditev(dejanje: Dejanje): Boolean {
    return when (dejanje) {
        Dejanje.POSLJI_SPOROCILO,
        Dejanje.POSLJI_EPOSTO,
        Dejanje.IZBRISI,
        Dejanje.POKLICI -> true
        Dejanje.PREBERI_KOLEDAR,
        Dejanje.USTVARI_OSNUTEK,
        Dejanje.DODAJ_ZAPISEK,
        Dejanje.DODAJ_OPOMNIK,
        Dejanje.PREKLOPI_ZASLON -> false
    }
}

// Preveri potrebo po potrditvi za besedilno oznako dejanja.
fun potrebujePotrditev(dejanje: String): Boolean {
    val cisto = dejanje.trim().lowercase()
        .replace('č', 'c')
        .replace('š', 's')
        .replace('ž', 'z')
    if (cisto.isEmpty()) return false
    if (cisto.contains("osnutek") || cisto.contains("draft")) return false
    return cisto.contains("poslji") ||
        cisto.contains("send") ||
        cisto.contains("sporocil") ||
        cisto.contains("sms") ||
        cisto.contains("epost") ||
        cisto.contains("e-post") ||
        cisto.contains("email") ||
        cisto.contains("izbrisi") ||
        cisto.contains("brisanje") ||
        cisto.contains("delete") ||
        cisto.contains("poklici")
}

// Vsi zasloni delujejo samostojno na telefonu brez stalne povezave z racunalnikom.
fun zmoznostBrezRacunalnika(zaslon: Zaslon): Boolean {
    return when (zaslon) {
        Zaslon.DOMOV,
        Zaslon.POGOVOR,
        Zaslon.KOLEDAR,
        Zaslon.OPRAVILA,
        Zaslon.ZAPISKI,
        Zaslon.KOMUNIKACIJA -> true
    }
}
