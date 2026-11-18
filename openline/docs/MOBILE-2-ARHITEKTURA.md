# Lina Mobile 2.0 – faza 1: obstoječa arhitektura in funkcije za ohranitev

Stanje: 18. 11. 2026, veja `lina-klicalnik-1811`, paket `si.safeer.lina`. Vir resnice je koda; števila vrstic so izmerjena.

## 1. Moduli (Gradle)
| Modul | Vloga | Opomba |
|---|---|---|
| `:app` | Android: zasloni, Telecom (InCallService), zvok klica, prehod (gateway), lupina adb, samostojna asistentka (pogled) | 1 aktivnost za 5 zavihkov |
| `:protocol` | Čista JVM logika protokola prehoda, politike klica, zajem, življenjski potek (AppFlow, CaptureMachine, TakeoverPolicy, LineSelection, DialKeys …) | testi v JVM |
| `:podpis`, `:seznanitev` | Podpis ukazov, kode/QR in SPAKE2 seznanitev telefona z računalnikom | ne spreminjati protokolov |
| `:samostojna` | Samostojna asistentka (brez računalnika): ponudniki AI, Google Cloud (OAuth PKCE, Vertex), zapiski, dnevnik klicev, spletna orodja, besedila, teme (Aura) | testi 194/194 |

## 2. Zasloni in zavihki (`DialerActivity`, 1268 vrstic, `activity_dialer.xml`)
Spodnja navigacija (`navBar`) ima pet zavihkov: **Klici** (`tabCalls`: klicalnik, iskanje stikov po imenu, številčnica), **Telefon** (`tabPhone`: čarovnik 4 korakov in napredne nastavitve prehoda), **Lina** (`tabLina`: nastavitve Line: jezik, čas zvonjenja, seznam dovoljenih številk, izbira SIM/eSIM), **Asistent** (`tabAssistant`: ponudniki, ključi, pogovor, zapiski, spletna orodja), **Računalnik** (`tabComputer`: povezava Safeer Link). Poleg: `InCallActivity` (zaslon klica). Odmiki sistemskih vrstic in tipkovnice: `SistemskeVrstice` + `OnApplyWindowInsetsListener` na `root`.

## 3. Funkcije, ki jih Mobile 2.0 NE SME pokvariti (seznam za preverbo po vsaki fazi)
1. Lina kot privzeta telefonska aplikacija (vloga dialer), `GatewayInCallService`, `LinaCallGate`, `CallRegistry`, prevzem klica po politiki (`TakeoverPolicy`, `CallCommandPolicy`, `CallPrivacy`).
2. Zvok klica: `CallAudioEngine`/`CallAudioBridge`/`CallAudioPolicy`, zajem (`CaptureMachine`), vodenje po korakih za zvok in brezžično odpravljanje napak (`GatewayAdbManager`, `PairingService`, `ShellLauncher`).
3. Seznanitev z računalnikom (QR/koda, SPAKE2), `GatewayConnectionService`, `GatewayRuntime`, ponovna povezava; povezava ostane neobvezna.
4. Čarovnik Telefon (4 koraki: privzeta aplikacija, prehod prek QR, zvok klica, delovanje v ozadju) z jasnim stanjem; ne obljublja ozadja, če ga Android omeji.
5. Nastavitve: jezik (sl, en, de, es, fr, it), čas zvonjenja pred prevzemom, seznam dovoljenih številk + vklop, izbira SIM/eSIM (`LineSelection`), shranjevanje (`LinaSettingsStore`).
6. Klicalnik: `DialKeys`, iskanje stikov po imenu/številki (`ContactSearch`), dolg pritisk 0 = +.
7. Asistent: ponudniki Gemini, OpenAI, Claude, Grok, Google Cloud; ključi v Keystore (AES-GCM) brez izpisa v dnevnik; prijava Google (PKCE); zapiski; spletno iskanje (Brave), branje strani (TinyFish), preverba Twilio.
8. Dnevnik klicev (`DnevnikKlicev`), sinhronizacija (`Sinhronizacija`), spomin.
9. Zasebnost: nobenega ključa, številke ali imena lastnika v dnevniku, repozitoriju ali posnetku.

## 4. Oblikovni sistem danes
`colors.xml`/`values-night` (teme Aura, preizkus `ColorsXmlTest`), slogi `Gw.*` (Panel, Heading, Muted, Field, Button), `spinner_item`. Mobile 2.0 gradi NA TEM: nova paleta temno vijolična + turkizna aktivna stanja gre v iste žetone (en vir barv), svetla in temna tema obe.

## 5. Tveganja in odločitve za prenovo
- Ena aktivnost z enim velikim zvitkom: prenova poteka po zavihkih, ID-ji pogledov ostanejo (koda jih veže po ID), nič se ne briše, dokler novi zavihek ne dela.
- Domači zaslon (nov) ne sme imeti izmišljenih dogodkov: »Današnji pregled« prikaže samo dejanske podatke (dnevnik klicev, zapiski, koledar naprave, če dovoljeno), sicer prazno stanje.
- Referenčna slika ženskega lika se ne prevzame; logotip je obstoječi cvet Lina.
- »Pot klicev« (SIP, Twilio, WhatsApp Business Calling): vmesnik se pokaže šele, ko pot deluje; SIP je danes samo v računalniški Lini.
- Preverba po fazi: `:protocol:test :samostojna:test :app:assembleRelease`, nato namestitev na S25 in ogled zaslona, ko lastnik telefona ne uporablja.

## 6. Faze (po navodilu lastnika)
1 analiza (ta dokument) → 2 oblikovni sistem in skupne komponente → 3 domači zaslon + spodnja navigacija (sredinski gumb Lina) → 4 klici in klicalnik → 5 pogovor in ponudniki → 6 Link in nastavitve (+ pot klicev) → 7 preizkus vseh funkcij → 8 zmogljivost in APK.
