/**
 * Osebni nacin (osebna tajnica) in odsotnost v novem zaslonu Line (src/components/lina-desk.tsx).
 * Preveri, da je novi zaslon povezan z obstojecima moduloma osebni-nacin.ts in odsotnost.ts,
 * obdrzi nove gradnike (Razdelek/Podrazdelek, TABS za podjetje, GooglePrijava) ter brez sprememb pade.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RAZLOGI_KATALOG, razlogOdsotnosti } from "./odsotnost.ts";
import { obveznoBesedilo, prazenSeznamBesedilo, razdelekViden, vajaNamigBesedilo, veljavenZavihek, zavihki } from "./osebni-nacin.ts";

const beri = (pot: string) => readFileSync(new URL(pot, import.meta.url), "utf8");
const telo = (vir: string, ime: string) => {
  const zacetek = vir.search(new RegExp(`\\n(?:export )?(?:async )?function ${ime}\\(`));
  assert.ok(zacetek >= 0, `funkcija ${ime} ne obstaja`);
  const naprej = vir.slice(zacetek + 1).search(/\n(?:export )?(?:async )?function /);
  return naprej < 0 ? vir.slice(zacetek) : vir.slice(zacetek, zacetek + 1 + naprej);
};

test("lina-desk.tsx uvaza vse potrebne funkcije iz osebni-nacin.ts in odsotnost.ts", () => {
  const desk = beri("../../components/lina-desk.tsx");
  const uvozOsebni = desk.match(/import\s*\{([^}]+)\}\s*from\s*"@\/lib\/lina\/osebni-nacin\.ts";/);
  assert.ok(uvozOsebni, "manjka uvoz iz osebni-nacin.ts");
  for (const ime of ["zavihki", "veljavenZavihek", "razdelekViden", "obveznoBesedilo", "prazenSeznamBesedilo", "vajaNamigBesedilo"]) {
    assert.match(uvozOsebni[1], new RegExp(`\\b${ime}\\b`), `manjka uvoz ${ime} iz osebni-nacin.ts`);
  }

  const uvozOdsotnost = desk.match(/import\s*\{([^}]+)\}\s*from\s*"@\/lib\/lina\/odsotnost\.ts";/);
  assert.ok(uvozOdsotnost, "manjka uvoz iz odsotnost.ts");
  for (const ime of ["RAZLOGI_KATALOG", "razlogOdsotnosti"]) {
    assert.match(uvozOdsotnost[1], new RegExp(`\\b${ime}\\b`), `manjka uvoz ${ime} iz odsotnost.ts`);
  }
});

test("navigacija uporablja zavihki() in veljavenZavihek(), a obdrzi TABS za podjetje", () => {
  const desk = beri("../../components/lina-desk.tsx");
  const glavni = telo(desk, "LinaDesk");
  assert.match(desk, /\{ id: "klic", label: "uiTabKlic" \},\s*\{ id: "telefon", label: "uiTabTelefon" \}/);
  assert.match(glavni, /veljavenZavihek\(/);
  assert.match(glavni, /zavihki\(pravila\.nacinKlica\)/);
  assert.match(glavni, /const sporocila\s*=\s*useMemo/);
  assert.match(glavni, /prazenSeznamBesedilo\(pravila\.nacinKlica\)/);
  assert.match(glavni, /tab === "narocila" && pravila\.nacinKlica === "osebna"/);
  assert.match(glavni, /<VajaKlica[^>]*nacin=\{pravila\.nacinKlica\}/);
});

test("NastavitveVsebina skrije poslovne razdelke in vsebuje polja odsotnosti", () => {
  const desk = beri("../../components/lina-desk.tsx");
  const pravilaFn = telo(desk, "NastavitveVsebina");
  assert.match(pravilaFn, /obveznoBesedilo\(pravila\.nacinKlica\)/);
  for (const r of ["tema", "garancija", "dostava", "potrditevEposta"]) {
    assert.match(pravilaFn, new RegExp(`razdelekViden\\("${r}",`), `manjka razdelekViden("${r}", ...)`);
  }
  assert.match(pravilaFn, /razlogShranjenNeveljaven/);
  assert.match(pravilaFn, /odsotnostVklop/);
  assert.match(pravilaFn, /odsotnostRazlog/);
  assert.match(pravilaFn, /odsotnostDo/);
  assert.match(pravilaFn, /odsotnostCasovniPas/);
  assert.match(pravilaFn, /<OdsotnostRazlog\b/);
});

test("OdsotnostRazlog in casovne pomozne funkcije so v lina-desk.tsx", () => {
  const desk = beri("../../components/lina-desk.tsx");
  assert.match(desk, /const DRUGI_KRAJ\s*=\s*"__kraj__"/);
  const razlogFn = telo(desk, "OdsotnostRazlog");
  assert.match(razlogFn, /RAZLOGI_KATALOG/);
  assert.match(razlogFn, /razlogOdsotnosti\(/);
  assert.match(razlogFn, /odsotnostRazlogShranjenNeveljaven/);
  assert.ok(telo(desk, "casovniPasUporabnika").includes("Europe/Ljubljana"));
  assert.ok(telo(desk, "isoVLokalnoUro").includes("getFullYear"));
  assert.ok(telo(desk, "lokalnoUroVIso").includes("toISOString"));
});

test("Slip, VrsticaKlica in VajaKlica upostevajo osebni nacin in povedano odsotnost", () => {
  const desk = beri("../../components/lina-desk.tsx");
  const slipFn = telo(desk, "Slip");
  assert.match(slipFn, /call\?\.nacin === "osebna"/);
  assert.match(slipFn, /odsotnostPovedana/);
  assert.match(slipFn, /t\("zapisekOdsotnost"\)/);

  const vrsticaFn = telo(desk, "VrsticaKlica");
  assert.match(vrsticaFn, /call\.nacin === "osebna"/);
  assert.match(vrsticaFn, /dnevnikSporocilo/);
  assert.match(vrsticaFn, /dnevnikBrezSporocila/);

  const vajaFn = telo(desk, "VajaKlica");
  assert.match(vajaFn, /\bnacin\b/);
  assert.match(vajaFn, /vajaNamigBesedilo\(nacin\)/);
});

test("nedotakljivi deli (GooglePrijava, brez @ts-nocheck) in cisti moduli delujejo", () => {
  const desk = beri("../../components/lina-desk.tsx");
  assert.match(desk, /import \{ (?:PrijavaStub as )?GooglePrijava \} from "@\/components\/(?:prijava-stub|google-prijava)\.tsx";/);
  // 22. 11. 2026: GooglePrijava ima samodejno izbiro projekta (vec atributov), zato je JSX v oklepaju cez vec vrstic; pomen ostane: samo pri Vertexu.
  assert.match(desk, /vertex \? \(?\s*<GooglePrijava\s/);
  assert.doesNotMatch(desk, /@ts-nocheck/);

  assert.equal(veljavenZavihek("znanje", "osebna"), "klic");
  assert.equal(veljavenZavihek("znanje", "podjetje"), "znanje");
  assert.equal(zavihki("osebna").some((z) => z.id === "znanje"), false);
  assert.equal(razdelekViden("dostava", "osebna"), false);
  assert.equal(razdelekViden("dostava", "podjetje"), true);
  assert.notEqual(obveznoBesedilo("osebna"), obveznoBesedilo("podjetje"));
  assert.notEqual(prazenSeznamBesedilo("osebna"), prazenSeznamBesedilo("podjetje"));
  assert.notEqual(vajaNamigBesedilo("osebna"), vajaNamigBesedilo("podjetje"));
  assert.ok(RAZLOGI_KATALOG.includes("v službi"));
  assert.equal(razlogOdsotnosti("v službi"), null);
  assert.notEqual(razlogOdsotnosti("pokličem ob 15h"), null);
});
