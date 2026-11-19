# Zapiski in neposredna povezava z Global Link (nacrt)

Stanje 19. 11. 2026. Cilj lastnika: zapiski delujejo na telefonu in racunalniku, telefon in racunalnik sta povezana tudi prek Global Linka.

## Kaj ze obstaja (preverjeno v kodi)
- Telefon: zapiski v `:samostojna` (`Zapisek`, `zdruzi()` po casu/izbrisu, `ZapiskiZapis`), izvoz v Dokumente (`ZapiskiIzvoz`).
- Telefon: cista logika sinhronizacije `VrstaSprememb`, `IzbiraPoti` (LAN, neposredno prek Global Linka, rele), `smemSinhronizirati` (ne med klicem/pogovorom). Pravega prenosa (`OdjemalecSinhronizacije`) NI.
- Racunalnik (Safeer OS/Linux): `core/os_zapiski.py` (zapiski v JSON), krog zaupanja `core/link_krog.py`, sifriran prenos `core/link_data_transport.py` (protokol `data-transport-v1`: ECDH P-256 med kljucema clanov kroga + HKDF-SHA256 + AES-256-GCM, kosi 1 MiB); rele link.safeer.si vidi samo podpisani sporocili in sifrirane kose.
- Isti protokol je v Kotlinu v repozitoriju TV brskalnika (`cast/DataTransport.kt`, preizkusi `DataTransportTest.kt`).

## Kaj manjka
1. Telefon Lina ni clan kroga zaupanja (nima para kljucev P-256 v Keystore, ni vpisan v krog).
2. Kotlin odjemalec `data-transport-v1` v Lini (algoritem se prenese iz TV repozitorija).
3. Pot LAN/neposredno/rele za `OdjemalecSinhronizacije` (kratek poskus primarne poti, takoj rezerva, premor ob neuspehu: ze v `IzbiraPoti`).
4. Racunalniska stran: sprejem sprememb `sync.zapiski` v hubu in zdruzitev z `os_zapiski` po istih pravilih kot `zdruzi()`.
5. Povezava dogodkov: shrani zapisek -> `VrstaSprememb.dodaj` -> po koncu klica `poKoncuKlica()`.

## Faze
- F1 (brez lastnika): Kotlin `data-transport-v1` v Lini s skupnimi preizkusnimi vektorji proti Pythonu; cista logika, preizkusi v CI.
- F2 (brez lastnika): sporocilo `sync.zapiski` (JSON, verzija 1, `Zapisi`), zdruzevanje na racunalniski strani, preizkusi.
- F3 (potrebuje lastnika): vkljucitev telefona v krog zaupanja (potrditev na racunalniku). Brez ponovne potrditve na vsaki napravi.
- F4: pravi preizkus LAN, nato Global (neposredno, rele) in varnostni pregled povezav (skil safeer-varnostni-pregled-povezav).

## Varnostna pravila
- Vsebina zapiskov nikoli ni v dnevniku; sifrirano samo med clani kroga; rele vidi samo podpisane ponudbe.
- Sinhronizacija se ne sprozi iz besedila klica ali sporocila; vkljucitev v krog samo z uporabnikovo potrditvijo.
- Nobenega nesifriranega nadomestka (brez `cryptography` ni prenosa).
