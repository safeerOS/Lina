# Lina

Lina je AI telefonska tajnica in osebna asistentka iz družine Safeer. Prevzame klice, ki jih uporabnik ne sprejme, zapiše
sporočilo ali naročilo in ga prikaže v programu. Vedno pove, da je umetna inteligenca.

## Zgradba repozitorija

| Mapa | Vsebina |
| --- | --- |
| `openline/` | Android aplikacija Lina (prevzem klicev in asistentka na telefonu) ter strežnik OpenLine |
| `src/`, `server/`, `scripts/`, `public/`, `skili/` | Računalniška Lina za Linux in Windows (TanStack Start + Nitro, strežnik samo na 127.0.0.1) |
| `lupina/` | Electron lupina računalniške Line (okno, ikona v pladnju, zagon lokalnega strežnika) |
| `orodja/` | Meritve in pomožne skripte |

Pravila za pomočnike: `AGENTS.md` (OpenLine, Android) in `AGENTS-RACUNALNIK.md` (računalniška Lina).

## Gradnja

Gradnje tečejo v GitHub Actions, ne na računalniku razvijalca:

- `.github/workflows/gradnja.yml`: Android (APK),
- `.github/workflows/racunalnik.yml`: računalniška Lina in paket `deb` za Linux (zagon ročno, ena gradnja na sklop sprememb).

## Stanje obnove (21. 11. 2026)

Izvorna koda računalniške Line je bila 20. 11. 2026 po pomoti izbrisana z diska; obnovljena je iz nameščenega programa,
iz neobjavljenih kopij in z neposrednim branjem diska. Del datotek je rekonstrukcija iz prevedene kode (v glavi imajo
oznako `// @ts-nocheck`), del preizkusov pa preverja starejše specifikacije in zato ne uspe. Ob vsaki gradnji se
rezultat preverbe tipov in preizkusov zapiše v povzetek teka (`racunalnik.yml`).

## Licenca

PolyForm Noncommercial 1.0.0 (datoteka `LICENSE`): nekomercialna raba je brezplačna, komercialna zahteva dogovor z avtorjem.
