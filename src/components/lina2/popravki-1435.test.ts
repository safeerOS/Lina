// Popravki najdb slepega pregleda vmesnika 24. 11. 2026 (pregled-vecer-1405/vmesnik/NAJDBE.md, N1-N5).
// Pas sistema je namenoma UTC: ure in datumi morajo kljub temu biti ljubljanski (N1).
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
// Uvoz z imenskim prostorom in await import(): na izvirniku (brez popravkov) pade vsak preizkus posebej, ne cela datoteka.
import * as B from "../../lib/lina/besedila.ts";
import * as V from "../../lib/lina/ui-videz.ts";
import * as K from "../../lib/lina/koledar.ts";
const { besedila, nastaviJezikVmesnika, t } = B;
const { casKlica, datumDanes, datumGlave, datumInUra, uraGlave } = V;
const vLjubljani = (d: Date): Date => (V as unknown as { vLjubljani: (d: Date) => Date }).vLjubljani(d);
const sporociloStreznika = (s: string): string => (B as unknown as { sporociloStreznika: (s: string) => string }).sporociloStreznika(s);
const ocistiVnos = K.ocistiVnos;
const razlogVnosa = (s: string): Parameters<typeof t>[0] | null => (K as unknown as { razlogVnosa: (s: string) => Parameters<typeof t>[0] | null }).razlogVnosa(s);
const jezikStreznik = () => import("../../lib/lina/jezik.server.ts" as string) as Promise<{ preberiIzbiroJezika: (dir?: string) => Promise<string | null>; shraniIzbiroJezika: (i: unknown, tok: string | null, dir?: string) => Promise<string> }>;
import { sl2, en2 } from "./besedila.ts";
import { besedilaDatotek } from "../../lib/lina/znanje-datoteke-besedila.ts";
import { setupOwner } from "../../lib/lina/auth.server.ts";
import { dodajZapis } from "../../lib/lina/koledar.server.ts";

const koda = (pot: string) => readFileSync(new URL(pot, import.meta.url), "utf8");
// 24. 11. 2026 23:30 UTC = 25. 11. 2026 00:30 v Ljubljani (CET): drug dan in druga ura kot v UTC.
const T = new Date("2026-11-24T23:30:00Z");
const KOREN = await mkdtemp(path.join(tmpdir(), "lina-1435-"));
after(() => rm(KOREN, { recursive: true, force: true }));

test("N1: pas sistema je res UTC (sicer preizkus nic ne dokaze)", () => {
  assert.equal(T.getHours(), 23);
});

test("N1: ura in datum v glavi sta ljubljanska tudi v pasu UTC", () => {
  assert.equal(uraGlave(T, "en"), "00:30");
  assert.equal(uraGlave(T, "sl"), "00:30");
  assert.match(datumGlave(T, "en"), /Wed/);
  assert.match(datumGlave(T, "en"), /25/);
  assert.match(datumGlave(T, "sl"), /sre/);
});

test("N1: ocena konca (uraGlave) in cas gradnje (datumInUra) kazeta isti pas", () => {
  assert.match(datumInUra(T, "en"), /00:30/);
  assert.equal(uraGlave(T, "en"), "00:30");
});

test("N1: cas klica je ljubljanski", () => {
  assert.equal(casKlica(T.toISOString(), "sl"), "25. 11. 2026, 00:30");
  assert.match(casKlica(T.toISOString(), "en"), /25\/11\/2026, 00:30/);
});

test("N1: trenutek -> ljubljanski stenski cas za kartico Danes; stenski cas koledarja ostane nespremenjen", () => {
  assert.equal(datumDanes(vLjubljani(T), "sl"), "sreda, 25. november");
  assert.match(datumDanes(vLjubljani(T), "en"), /Wednesday 25 November/);
  // stenski cas (razberiCas koledarja) se ne premika
  assert.equal(datumDanes(new Date(2026, 10, 24, 23, 30), "sl"), "torek, 24. november");
});

test("N1: zasloni trenutkov ne oblikujejo v pasu sistema", () => {
  const desk = koda("../lina-desk.tsx");
  assert.doesNotMatch(desk, /toLocaleString\(lokalizacija\(\)\)/, "lina-desk: toLocaleString brez pasu");
  assert.doesNotMatch(desk, /toLocaleTimeString\(lokalizacija\(\)/, "lina-desk: toLocaleTimeString brez pasu");
  const pogovor = koda("pogovor.tsx");
  assert.match(pogovor, /setZdaj\(vLjubljani\(new Date\(\)\)\)/, "pogovor: Danes v ljubljanskem casu");
  const domov = koda("domov.tsx");
  assert.match(domov.slice(domov.indexOf("function kdajBesedilo")), /vLjubljani\(/, "domov: kdajBesedilo v ljubljanskem casu");
});

test("N2: lina-desk in __root nimata slovenskih nizov mimo t()", () => {
  const desk = koda("../lina-desk.tsx");
  for (const niz of ['"deluje"', '"se zaganja …"', '"napaka pri zagonu"', '"še ni na voljo"', '"Ime materiala"', '"Opomba materiala"', '"Ime izdelka"', '"Vrsta izdelka"', '"vrsta, npr. jedilna miza"', '"pon-pet 07.00-15.00"']) {
    assert.ok(!desk.includes(`return ${niz}`) && !desk.includes(`aria-label=${niz}`) && !desk.includes(`placeholder=${niz}`), `lina-desk: ${niz} mimo t()`);
  }
  // aria-label in placeholder z dobesedno besedo (bralnik zaslona bi bral slovensko); naslovi URL in datumi so nevtralni
  assert.doesNotMatch(desk, /(aria-label|placeholder)="(?![^"]*:\/\/)[^"]*[a-zčšž]{3}[^"]*"/i, "lina-desk: dobesedno besedilo v aria-label/placeholder");
  // JSX besedilo s sumniki ali vrstica samih slovenskih besed med oznakama (npr. »Shrani znanje«, »Odstrani«, »Materiali«)
  assert.doesNotMatch(desk, />[^<{}]*[čšžČŠŽ][^<{}]*</, "lina-desk: JSX besedilo s sumniki mimo t()");
  assert.doesNotMatch(desk, /^\s+(\+ )?[A-ZČŠŽa-zčšž][a-zčšž]+( [a-zčšž]+)*\s*$/m, "lina-desk: JSX besedilo mimo t()");
  const koren = koda("../../routes/__root.tsx");
  assert.match(koren, /document\.title = t\("uiNaslovStrani"\)/, "__root: naslov strani po jeziku");
  assert.equal(t("uiNaslovStrani", "en"), "LINA · digital secretary");
});

test("N3: izbira jezika je na strezniku in prezivi nov izvor (nova vrata)", async () => {
  const { preberiIzbiroJezika, shraniIzbiroJezika } = await jezikStreznik();
  const dir = await mkdtemp(path.join(KOREN, "j-"));
  assert.equal(await preberiIzbiroJezika(dir), null);
  const token = await setupOwner("geslo-test-1234", dir);
  assert.equal(await shraniIzbiroJezika("en", token, dir), "en");
  assert.equal(await preberiIzbiroJezika(dir), "en");
});

test("N3: shranjevanje jezika brez lastnika ali z neveljavno vrednostjo je zavrnjeno", async () => {
  const { preberiIzbiroJezika, shraniIzbiroJezika } = await jezikStreznik();
  const dir = await mkdtemp(path.join(KOREN, "j-"));
  const token = await setupOwner("geslo-test-1234", dir);
  await assert.rejects(shraniIzbiroJezika("en", null, dir));
  await assert.rejects(shraniIzbiroJezika("en", "napacen", dir));
  await assert.rejects(shraniIzbiroJezika("de", token, dir));
  await assert.rejects(shraniIzbiroJezika("<script>", token, dir));
  assert.equal(await preberiIzbiroJezika(dir), null);
});

test("N3: preklop shrani na strezniku, zagon bere streznik pred localStorage", () => {
  const preklop = koda("../jezik-preklop.tsx");
  assert.match(preklop, /shraniJezikFn\(/);
  assert.match(preklop, /preberiJezikFn\(/);
});

test("N4: koren ne izrise zaslonov, dokler jezik ni razresen (en priklop, brez klicev v napacnem jeziku)", () => {
  const koren = koda("../../routes/__root.tsx");
  assert.match(koren, /useState<Jezik \| null>\(null\)/);
  assert.match(koren, /\{jezik \? <Outlet key=\{jezik\} \/> : null\}/);
});

test("N5: napake vnosa koledarja imajo kodo razloga, vmesnik jo prevede", async () => {
  const napaka = ocistiVnos({ vrsta: "opomnik", naslov: "x", cas: null });
  assert.equal(typeof napaka, "string");
  assert.equal(razlogVnosa(napaka as string), "kolNapOpomnikCas");
  for (const v of [{ vrsta: "x", naslov: "a" }, { vrsta: "zapisek", naslov: "" }, { vrsta: "zapisek", naslov: "a".repeat(201) }, { vrsta: "dogodek", naslov: "a", cas: "2026-02-31T10:00" }, { vrsta: "dogodek", naslov: "a" }]) {
    const s = ocistiVnos(v);
    assert.equal(typeof s, "string");
    const r = razlogVnosa(s as string);
    assert.ok(r, `brez kode: ${s}`);
    assert.equal(t(r!, "sl"), s, "slovensko besedilo je isto kot doslej");
    assert.doesNotMatch(t(r!, "en"), /[čšž]|Vpišite|Opomnik/);
  }
  const dir = await mkdtemp(path.join(KOREN, "k-"));
  const izid = await dodajZapis(dir, { vrsta: "opomnik", naslov: "x", cas: null });
  assert.equal(izid.ok, false);
  assert.equal(!izid.ok && (izid as { razlog?: string }).razlog, "kolNapOpomnikCas");
  assert.match(koda("koledar.tsx"), /izid\.razlog \? vstavi\(t\(izid\.razlog\)/);
});

test("N5: sporocila streznika v angleskem vmesniku dobijo angleski uvod; slovenski vmesnik ostane dobeseden", () => {
  nastaviJezikVmesnika("sl");
  assert.equal(sporociloStreznika("Ključ ni nastavljen."), "Ključ ni nastavljen.");
  nastaviJezikVmesnika("en");
  try {
    const s = sporociloStreznika("Ključ ni nastavljen.");
    assert.ok(s.startsWith(t("uiNapakaStreznika", "en")), s);
    assert.equal(sporociloStreznika(""), t("uiNapakaSplosna", "en"));
    // ze prevedeno besedilo vmesnika in napake brskalnika nimajo uvoda »Lina replied (in Slovenian)«
    assert.equal(sporociloStreznika(t("znanjeDokumentVelik", "en")), t("znanjeDokumentVelik", "en"));
    const napake = (B as unknown as { sporociloNapake: (c: unknown) => string }).sporociloNapake;
    assert.equal(napake(new TypeError("Failed to fetch")), t("uiNapakaSplosna", "en"));
    assert.equal(napake(new DOMException("Permission denied", "NotAllowedError")), t("uiNapakaSplosna", "en"));
    assert.ok(napake(new Error("Neveljavna nastavitev.")).startsWith(t("uiNapakaStreznika", "en")));
  } finally {
    nastaviJezikVmesnika("sl");
  }
  for (const pot of ["pogovor.tsx", "../lina-desk.tsx", "koledar.tsx"]) {
    const k = koda(pot);
    assert.doesNotMatch(k, /setNapaka\(izid\.sporocilo\)|setNote\(result\.sporocilo\)|cause\.message : t\(|e\.message : t\(/, `${pot}: sporocilo streznika dobesedno`);
  }
});

test("vsak kljuc ima neprazen prevod v sl in en", () => {
  for (const [ime, a, b] of [["besedila", besedila.sl, besedila.en], ["lina2", sl2, en2], ["datoteke", besedilaDatotek.sl, besedilaDatotek.en]] as const) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    assert.deepEqual(ka.filter((k) => !kb.includes(k)), [], `${ime}: manjka v en`);
    assert.deepEqual(kb.filter((k) => !ka.includes(k)), [], `${ime}: manjka v sl`);
    for (const k of kb) assert.ok(String((b as Record<string, string>)[k]).trim(), `${ime}.en.${k} prazen`);
  }
});
