# Zapiski in povezava z Global Link (nacrt)

Stanje 19. 11. 2026. Odlocitev lastnika: Lina deluje popolnoma SAMA; ce je na telefonu Safeer OS, se z njim neobvezno poveze in samo doprinese. Lina ne dobi lastnega clanstva v krogu zaupanja in ne podvaja kode Linka.

## Kaj ze obstaja (preverjeno v kodi)
- Lina (telefon): zapiski v `:samostojna` (`Zapisek`, `zdruzi()`, `ZapiskiZapis`), izvoz v Dokumente (`ZapiskiIzvoz`); logika `VrstaSprememb`, `IzbiraPoti`, `smemSinhronizirati`; vmesnik `OdjemalecSinhronizacije` brez prenosa.
- Skupna pravila: `skupni-vektorji/zapiski-zdruzitev-v1.json` (zdruzevanje in ciscenje nagrobnikov) s preizkusoma v Kotlinu (CI) in Pythonu (`tests/`). Vsaka druga izvedba mora uporabiti ISTO datoteko.
- Racunalnik (Safeer OS Linux): `core/os_zapiski.py`, krog zaupanja, sifriran prenos `data-transport-v1`, rele (`core/link_*.py`).
- Safeer OS za telefon (si.safeer.phone) je zgrajen iz safeerOS/Android-tv: Global Link (`link/GlobalLink.kt`, `link/InternetPoti.kt`), `cast/DataTransport.kt`, hub s kategorijami. Mobile-android (zaznamki po domacem hubu) ni vir objavljene aplikacije.

## Kaj manjka
- V Safeer OS (Android-tv): kategorija `notes` z zgornjimi pravili ter en lokalni vmesnik za Lino (zapiski in kljuci), zavarovan z dovoljenjem istega podpisa; nikoli ne sprozen z besedilom klica ali sporocila. Izvedba je pri seji Android TV.
- V Lini: zaznava Safeer OS (PackageManager + preverba podpisa), ponudba povezave v Nastavitvah in izvedba `OdjemalecSinhronizacije` prek vmesnika Safeer OS. Brez Safeer OS Lina ostane sama, brez opozoril.

## Faze
- F1 (Android TV): kategorija `notes` in lokalni vmesnik v Safeer OS, preizkusi proti skupnim vektorjem.
- F2 (Lina): zaznava Safeer OS in `OdjemalecSinhronizacije` prek vmesnika; samostojno delovanje ohranjeno.
- F3: pravi preizkus LAN, nato Global (neposredno, rele) in varnostni pregled povezav.

## Pravila
- Zdruzevanje in ciscenje samo po skupnih vektorjih: rok nagrobnika 90 dni, meji 5000 zapiskov in 262144 kodnih tock, najprej najstarejsi nagrobnik, zivi zapiski nikoli. Tveganje: naprava, dlje brez povezave kot rok, lahko izbrisan zapisek spet ozivi.
- Vsebina zapiskov nikoli ni v dnevniku; poti sifrirane med napravami kroga.
- Sinhronizacija se ne sprozi iz besedila klica ali sporocila; povezava samo z uporabnikovo potrditvijo.
- Ni nesifriranega nadomestka.
