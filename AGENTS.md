# Pravila za AI pomocnike (Claude, Gemini, Grok, Antigravity ...) v OpenLine / Lina za Android

Velja za vsako spremembo v tem repozitoriju. Kratko in preverljivo; podrobnosti so v kodi in preizkusih.

## Izdelek (lastnik)
- **ENA aplikacija (lastnik 13. in 14. 11. 2026: »OpenLine mora biti enotna aplikacija z Lino AI asistentko za telefon.«):**
  na Androidu je ena sama aplikacija - prevzem klicev (OpenLine) + Lina asistentka (pogovor z Lino, naloge in odobritve za
  Claude Code s podpisom naprave; NALOGA-lina-kanal-claude-code.md, razdelek 3b). Druge aplikacije za asistentko NE delamo.
  Nacrt: ogled/openline-k17/nacrt-enotna-aplikacija.md (izven repozitorija). V kodi se NI zdruzeno.
- Ime aplikacije »Lina« (v programu »Lina – AI tajnica«, v govoru »AI asistentka«; lastnik 10. 11. 2026).
- applicationId `si.safeer.lina` (lastnik 14. 11. 2026). Staro aplikacijo `com.httpgateway.dialer` na testnih telefonih
  odstrani vodja seje (koordinator) ob novi gradnji - podagent je ne odstranjuje.
- Uporabnik vidi samo ime Lina (tudi »konzola Lina« / »Lina console«). Strežnik se interno lahko še imenuje OpenLine;
  shema QR `httpgateway://` in ime procesa lupine ostaneta, ker ju uporabnik ne vidi (odločitev 14. 11. 2026).
- Seznanitev v ozji krog Safeer Linka (lastnik 14. 11. 2026): Safeer OS na istem telefonu potrdi Lino v krog z ENIM dotikom
  (namera, zascitena z dovoljenjem ravni signature - obe aplikaciji podpisani z istim kljucem Safeer). Rezerva, ce to ni
  izvedljivo: navadno seznanjanje Linka. Debug APK je podpisan z razvojnim kljucem, zato se za preizkus te poti podpise s
  kljucem Safeer (orodje podpisi-apk.sh izven repozitorija) - sicer Android dovoljenja ne podeli.
- Kljuc naprave: oblika Safeer Linka (EC P-256, SHA256withECDSA DER, id n-<16 hex SHA-256 SPKI); koda je KOPIJA iz Android-tv
  (KrogZaupanja.kt, HubTls.kt) z navedbo vira, ujemanje drzi skupni vektor TS <-> Kotlin. Ne pisi na novo.
- Tajnica (klici neznancev) in osebna asistentka (lastnik) sta strogo loceni: iz poti klica ni nobene poti do asistentke,
  kanala Claude Code ali podpisa naprave. Preizkus mora pasti, ce se poti povezeta.
- Lina prevzame samo klic na liniji (SIM/eSIM), ki jo izbere uporabnik, ali na edini aktivni liniji (LineGate, TakeoverPolicy).
  Brez dovoljenja za branje linij ali brez izbire med vec linijami se ne oglasi - in to uporabniku pove z besedami.
- Razkritje UI v PRVEM izgovorjenem stavku vsakega klica je trdo pravilo (Linin AGENTS.md); nobena pot ga ne izpusti.
- Jeziki: vsi, ki jih datoteka virov ze ima (zdaj sl, en); privzeto jezik sistema, rocni preklop. Besedila v values*/strings.xml.
- Kjer vmesnik pove, kje v nastavitvah naprave kaj klikniti, uporabi tocen napis, ki ga naprava pokaze (preveri na napravi).

## Seznanitev in asistentka (14. 11. 2026)
- Asistentka govori z Lino na racunalniku po pogodbi lina-asistent2 AGENTS.md »Koncna tocka asistentke za telefon«
  (@e815ed0): HTTPS s pripetim odtisom lista, samo zasebni naslov, brez preusmeritev, dolgo poizvedovanje /dogodki.
  Izvedba: app asistent/ (HttpPovezavaZLino, AsistentKontroler), cista logika v modulu podpis (AsistentProtokol, AsistentPrikaz).
- Seznanitev je ZDRUZENA (lastnik): en QR z Linine strani nastavi pot klicev in pot asistentke, en gumb »Skeniraj QR«.
  Pogodbo v1 (dva razdelka, rok veljavnosti, enkratna koda) pise agent v lina-asistent2; dokler ni objavljena, modul
  seznanitev (QrSeznanitev) bere samo stari QR OpenLine (httpgateway://pair, samo klici) in vmesni QR asistentke
  (safeer-lina://asistent?v=1&naslov&vrata&odtis, samo asistentka - PREDLOG). Zdruzenega zapisa se ne ugiba.
- Moduli: seznanitev in podpis ne uvazata protocol (klici); protocol ne uvaza ne podpisa ne seznanitve. Kljuci in zetoni
  obeh poti so loceni (GatewayConfigStore za klice, AsistentShramba in AndroidKeyStore za asistentko).
- Telefon z nameščenim Safeer Phone/OS: Lina se v ozji krog vpise prek Safeer Phone/OS z enim dotikom (dovoljenje ravni
  signature OZJI_KROG, ne LINK), brez QR in kode; QR in 6-mestna koda (SPAKE2 kot Safeer Link) samo za telefone brez Safeerja.
  V kodi (15. 11. 2026): modul podpis OzjiKrogSafeer + app/asistent/OzjiKrogSafeer.kt; okno potrditve je v Safeerju (si.safeer.tv.link.OzjiKrogPotrdiActivity,
  veja ozji-krog-1511). NEPREVERJENO na napravi (potrebuje APK Line in Safeerja, oba podpisana s kljucem Safeer).

## Pravi klici in naprave
- Pravi klici prek OpenLine so PREPOVEDANI do cistega neodvisnega pregleda (lastnik 10. 11. 2026). Ko bo dovolj stabilno,
  lastnik aplikacijo SAM namesti na svoj Samsung. Na pravih telefonih agent nic ne namesca brez izrecne naloge.
- Privzeta aplikacija za klice z `cmd role add-role-holder` samo na emulatorju, nikoli na pravem telefonu.
- Emulator telefona: slika sistema se prenese samo po lastnikovem »da« (prenos in licenca). Po preizkusu `emu kill`,
  preveri po PID, da emulatorja ni, in `free -m`.

## Zasebnost (nikoli v kodo, preizkus, commit ali dnevnik)
- Ime lastnika, telefonske stevilke (v preizkusih izmisljene, npr. +99955501001), ICCID, IP-ji naprav, kljuci, zetoni, poti
  domace mape, posnetki zaslona pravih naprav. V besedilu: »lastnik«.
- Id linije je HMAC s kljucem namestitve (LineIdCodec), nikoli ICCID ali gol SHA-256. Logcat brez stevilk in ICCID.
- Zeton gre samo v glavo (Authorization: Bearer), nikoli v poizvedbo; >= 32 B; primerjava v konstantnem casu.

## Varnost povezav
- Zvok klica in zetoni samo prek TLS s pripetim odtisom lista (TlsPin / PinnedHttp); zahteve s kljucem NE sledijo preusmeritvam.
- Strezniki samo na 127.0.0.1 ali zasebnem IP domacega omrezja, nikoli 0.0.0.0. Vsaka pot nadgradnje gre prek
  server/src/upgrade-router.ts (tuja pot 404, vticnica se vedno zapre).
- Razvojna orodja (tools/eho-wss, debug sonda) imajo enaka pravila: samo wss, zeton iz datoteke ali okolja, ne iz ukazne vrstice.

## Git
- Avtor commitov: `Safeer <info@safeer.si>`; sporocila v slovenscini; `[skip ci]`; BREZ vrstic Co-Authored-By, Claude-Session
  ali podobnih oznak agenta. Brez potiska in objave brez lastnikovega »da«. Brez `--force`, brez `git stash` brez oznake.
- AGENTS.md se commita sam (samo ta datoteka v commitu).

## Preizkusi (vse pred commitom, vse zeleno)
- Kotlin: `ANDROID_HOME=<mapa Android SDK> JAVA_HOME=<jbr iz Android Studia> ./gradlew --max-workers=2 :protocol:test :app:compileDebugKotlin`
  v ozadju (setsid nohup, dnevnik), pred tem `uptime` (load < 4); na koncu `./gradlew --stop`.
- Streznik: `npx vitest run --config vitest.config.ts` in `npx tsc -p tsconfig.json --noEmit` v openline/server.
- Eho: `node --test --test-timeout=8000 eho-wss.test.mjs` v openline/android/tools/eho-wss.
- Vsak varnostni popravek ima preizkus, ki BREZ popravka pade - dokazi z mutacijo v kopiji `mktemp -d` (nikoli v izvirniku).
- Logika, ki jo je treba preizkusiti, gre v modul `protocol` (cisti JVM); `app` je tanek izvajalec. Kar v app ni preizkuseno,
  v porocilu pise NEPREVERJENO.
- Ena gradnja APK na sklop popravkov, sele po neodvisnem pregledu; nobenih gradenj, ki krpajo prejsnjo.

## Pospravi za sabo
- Procese ustavi po PID (ne `pkill -f`), zacasne mape v `mktemp -d`, brez streznikov, ki ostanejo odprti; na koncu
  `pgrep -af` in `ss -ltn`. Pomozne datoteke naloge, ki niso vec potrebne, izbrisi.

## Dnevnik dela in iskanje (lastnik 19. 11. 2026)
- Pred delom preberi zadnje bloke `DNEVNIK-DELA.md` in poisci, ali je kdo to ze delal: `python3 orodja/isci-dnevnik.py --zadnji 5` ali `python3 orodja/isci-dnevnik.py <besede>` (FTS5 kazalo v binarni datoteki, iscejo c/c, s/s, z/z; orodje in dnevnik hrani vodja izven repozitorija).
- Ob koncu vsake naloge (tudi nedokoncane) dopisi blok: naslov (datum, agent, projekt/veja), narocilo, narejeno (commiti, dokaz), ni narejeno (in zakaj), stanje, naslednji korak. Brez dostopa: v porocilu razdelek »Za zapis«.

## Pozdrav: ime lastnika samo znanim klicateljem (23. 11. 2026)
- Ime lastnika v pozdravu SAMO znanim klicateljem (lastnik 23. 11. 2026, po klicu prevaranta iz tujine: »Ja lahko naredimo da lina pove
  ime samo klicateljem ki jih pozna«). Osebna tajnica: »Poklicali ste <ime v tozilniku>« samo, ce je klicatelj znan - v imeniku telefona,
  med zaupanimi/znanimi klicatelji Line ali je ze kdaj pustil sporocilo z imenom, ki ga lastnik ni oznacil kot prevaro. Neznan, skrit ali
  blokiran/oznacen klicatelj dobi pozdrav brez imena (npr. »Dober dan. Tukaj Lina, umetna inteligenca. Pogovor se zapisuje. Kaj naj
  sporocim?«). Velja na telefonu (samostojni klic) in racunalniku; stalni stavki za glas morajo imeti obe razlicici (priprava sloga).
  Privzeto vklopljeno, stikalo »Ime povej samo znanim klicateljem«. V kodi na telefonu (23. 11. 2026): znan = imenik telefona (READ_CONTACTS)
  ali seznam zaupanih (allowlist); brez dovoljenja, skrita stevilka ali napaka = neznan, ime lastnika ni nikjer v navodilu klica
  (ImeTozilnik.imeZaPozdrav, GeminiLiveOdjemalec). Merilo »ze pustil sporocilo z imenom« in racunalnik: SE NI V KODI.
- Ime iz imenika v sprejetih klicih (lastnik 23. 11. 2026): zapis klica hrani ime iz imenika (ZapisKlica.imeImenik, samo lokalno, ne gre na
  racunalnik ne v pozive modelu); prikaz »Ana Novak (imenik)«, ce je klicatelj povedal drugo ime »Miha (v imeniku: Ana Novak)« (imeZaPrikaz).
