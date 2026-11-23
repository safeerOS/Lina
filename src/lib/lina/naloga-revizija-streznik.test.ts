/**
 * Preizkusi revizija.server.ts (naloga #45): zapis na disk, zaporedje pri vzporednih zapisih, zavrnitev pokvarjene verige,
 * sidro proti okrnitvi, samo lastnik bere. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { DATOTEKA_REVIZIJE, preberiRevizijo, zapisiRevizijo } from "./revizija.server.ts";
import { NICELNA_ZGOSCENA, preveriVerigo, type Vnos } from "./revizija.ts";

const KOREN = mkdtempSync(path.join(tmpdir(), "lina-revizija-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const staroOkolje = process.env.LINA_DATA;
afterEach(() => {
  if (staroOkolje === undefined) delete process.env.LINA_DATA;
  else process.env.LINA_DATA = staroOkolje;
});

async function nova(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(KOREN, "d-"));
  process.env.LINA_DATA = dir;
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}

const T = (s: number) => new Date(Date.UTC(2026, 10, 21, 9, 0, s));
const datoteka = (dir: string) => path.join(dir, DATOTEKA_REVIZIJE);
const vrstice = (dir: string) => readFileSync(datoteka(dir), "utf8").split("\n").filter(Boolean);

async function zapisi3(dir: string): Promise<void> {
  for (let i = 1; i <= 3; i++) {
    const izid = await zapisiRevizijo(dir, { vrsta: "preizkus", opis: `vnos ${i}`, podatki: { i } }, T(i));
    assert.equal(izid.ok, true);
  }
}

describe("revizija na disku: zapis", () => {
  it("prvi zapis ustvari datoteko z dovoljenji 600 in eno veljavno vrstico", async () => {
    const { dir } = await nova();
    const izid = await zapisiRevizijo(dir, { vrsta: "preizkus", opis: "prvi", podatki: { a: 1 } }, T(0));
    assert.equal(izid.ok, true);
    assert.equal(statSync(datoteka(dir)).mode & 0o777, 0o600);
    const v = vrstice(dir);
    assert.equal(v.length, 1);
    const vnos = JSON.parse(v[0]) as Vnos;
    assert.equal(vnos.n, 1);
    assert.equal(vnos.prejsnja, NICELNA_ZGOSCENA);
    assert.deepEqual(izid, { ok: true, n: 1, zgoscena: vnos.zgoscena });
    assert.equal(readFileSync(datoteka(dir), "utf8").endsWith("\n"), true);
  });

  it("trije zapisi tvorijo veljavno verigo v datoteki", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    const vnosi = vrstice(dir).map((v) => JSON.parse(v) as Vnos);
    assert.equal(vnosi.length, 3);
    assert.equal(preveriVerigo(vnosi).ok, true);
    assert.deepEqual(vnosi.map((v) => v.n), [1, 2, 3]);
    assert.equal(vnosi[2].prejsnja, vnosi[1].zgoscena);
  });

  it("25 vzporednih zapisov: vsi uspejo, zaporedje 1..25, veriga veljavna", async () => {
    const { dir } = await nova();
    const izidi = await Promise.all(Array.from({ length: 25 }, (_, i) => zapisiRevizijo(dir, { vrsta: "vzporedno", opis: `vnos ${i}` }, T(i))));
    assert.ok(izidi.every((i) => i.ok));
    const vnosi = vrstice(dir).map((v) => JSON.parse(v) as Vnos);
    assert.equal(vnosi.length, 25);
    assert.deepEqual(vnosi.map((v) => v.n), Array.from({ length: 25 }, (_, i) => i + 1));
    assert.equal(preveriVerigo(vnosi).ok, true);
  });

  it("dve mapi sta neodvisni, tudi ce pisemo vzporedno", async () => {
    const a = await nova();
    const b = await nova();
    await Promise.all(Array.from({ length: 5 }, (_, i) => Promise.all([zapisiRevizijo(a.dir, { vrsta: "x", opis: `a${i}` }, T(i)), zapisiRevizijo(b.dir, { vrsta: "x", opis: `b${i}` }, T(i))])));
    for (const dir of [a.dir, b.dir]) {
      const vnosi = vrstice(dir).map((v) => JSON.parse(v) as Vnos);
      assert.equal(vnosi.length, 5);
      assert.equal(preveriVerigo(vnosi).ok, true);
    }
  });

  it("ura nazaj: cas ostane enak prejsnjemu", async () => {
    const { dir } = await nova();
    await zapisiRevizijo(dir, { vrsta: "x", opis: "a" }, T(30));
    await zapisiRevizijo(dir, { vrsta: "x", opis: "b" }, T(10));
    const vnosi = vrstice(dir).map((v) => JSON.parse(v) as Vnos);
    assert.equal(vnosi[1].cas, vnosi[0].cas);
    assert.equal(preveriVerigo(vnosi).ok, true);
  });

  it("skrivnost se zavrne in v datoteko ne pride nic", async () => {
    const { dir } = await nova();
    const izid = await zapisiRevizijo(dir, { vrsta: "x", opis: `kljuc freellmapi-${"A".repeat(24)}` }, T(0));
    assert.deepEqual(izid, { ok: false, razlog: "skrivnost" });
    assert.equal(existsSync(datoteka(dir)), false);
    assert.deepEqual(await zapisiRevizijo(dir, { vrsta: "x", opis: "pravi" }, T(1)), { ok: true, n: 1, zgoscena: (JSON.parse(vrstice(dir)[0]) as Vnos).zgoscena });
  });

  it("neveljaven vnos: razlog sestave, datoteka nespremenjena", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    const prej = readFileSync(datoteka(dir), "utf8");
    assert.deepEqual(await zapisiRevizijo(dir, { vrsta: "Velika", opis: "x" }, T(9)), { ok: false, razlog: "vrsta" });
    assert.equal(readFileSync(datoteka(dir), "utf8"), prej);
  });

  it("prazna datoteka velja za prazno verigo", async () => {
    const { dir } = await nova();
    writeFileSync(datoteka(dir), "");
    assert.equal((await zapisiRevizijo(dir, { vrsta: "x", opis: "prvi" }, T(0))).ok, true);
    assert.equal(vrstice(dir).length, 1);
  });

  it("zapis v neobstojeco mapo ne vrze, ampak vrne razlog zapis", async () => {
    const izid = await zapisiRevizijo(path.join(KOREN, "ni-te-mape"), { vrsta: "x", opis: "a" }, T(0));
    assert.deepEqual(izid, { ok: false, razlog: "zapis" });
  });

  it("meja velikosti: natancno na meji se se zapise, nad njo ne", async () => {
    const { dir } = await nova();
    await zapiseOdd(dir);
    const velikost = statSync(datoteka(dir)).size;
    assert.equal((await zapisiRevizijo(dir, { vrsta: "x", opis: "na meji" }, T(5), { najvecBajtov: velikost })).ok, true);
    const nova2 = statSync(datoteka(dir)).size;
    assert.deepEqual(await zapisiRevizijo(dir, { vrsta: "x", opis: "preko" }, T(6), { najvecBajtov: nova2 - 1 }), { ok: false, razlog: "polna" });
    assert.equal(statSync(datoteka(dir)).size, nova2);
  });
});

async function zapiseOdd(dir: string): Promise<void> {
  await zapisiRevizijo(dir, { vrsta: "x", opis: "prvi" }, T(0));
}

describe("revizija na disku: pokvarjena veriga zavrne nov zapis", () => {
  async function zavrne(dir: string): Promise<void> {
    const prej = readFileSync(datoteka(dir), "utf8");
    assert.deepEqual(await zapisiRevizijo(dir, { vrsta: "x", opis: "nov" }, T(50)), { ok: false, razlog: "veriga-pokvarjena" });
    assert.equal(readFileSync(datoteka(dir), "utf8"), prej, "datoteka se ne spremeni");
  }

  it("spremenjena vsebina vnosa", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    const v = vrstice(dir);
    const vnos = JSON.parse(v[1]) as Vnos;
    v[1] = JSON.stringify({ ...vnos, opis: "ponarejeno" });
    writeFileSync(datoteka(dir), `${v.join("\n")}\n`);
    await zavrne(dir);
  });

  it("vrstica, ki ni JSON", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    writeFileSync(datoteka(dir), `${readFileSync(datoteka(dir), "utf8")}to ni json\n`);
    await zavrne(dir);
  });

  it("prazna vrstica sredi datoteke", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    const v = vrstice(dir);
    writeFileSync(datoteka(dir), `${v[0]}\n\n${v[1]}\n${v[2]}\n`);
    await zavrne(dir);
  });

  it("nedokoncana zadnja vrstica (brez znaka za novo vrstico)", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    writeFileSync(datoteka(dir), vrstice(dir).join("\n"));
    await zavrne(dir);
  });

  it("veljavna veriga in presledek za zadnjo vrstico (brez nove vrstice)", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    writeFileSync(datoteka(dir), `${readFileSync(datoteka(dir), "utf8").slice(0, -1)} `);
    await zavrne(dir);
  });

  it("izbrisan vnos v sredini", async () => {
    const { dir } = await nova();
    await zapisi3(dir);
    const v = vrstice(dir);
    writeFileSync(datoteka(dir), `${v[0]}\n${v[2]}\n`);
    await zavrne(dir);
  });

  it("datoteka je mapa (branje ne uspe)", async () => {
    const { dir } = await nova();
    mkdirSync(datoteka(dir));
    assert.deepEqual(await zapisiRevizijo(dir, { vrsta: "x", opis: "nov" }, T(1)), { ok: false, razlog: "veriga-pokvarjena" });
  });
});

describe("revizija na disku: branje (samo lastnik)", () => {
  it("brez datoteke: prazna veljavna veriga", async () => {
    const { dir, token } = await nova();
    assert.deepEqual(await preberiRevizijo(token, dir), { preverba: { ok: true, stevilo: 0, zadnja: NICELNA_ZGOSCENA }, vnosi: [], sidro: null });
  });

  it("brez prijave ali z napacnim zetonom zavrne", async () => {
    const { dir } = await nova();
    await assert.rejects(preberiRevizijo(null, dir));
    await assert.rejects(preberiRevizijo("t".repeat(64), dir));
  });

  it("vnosi najnovejsi prvi, preverba in sidro", async () => {
    const { dir, token } = await nova();
    await zapisi3(dir);
    const pregled = await preberiRevizijo(token, dir);
    assert.deepEqual(pregled.vnosi.map((v) => v.n), [3, 2, 1]);
    assert.equal(pregled.preverba.ok, true);
    assert.deepEqual(pregled.sidro, { n: 3, zgoscena: pregled.vnosi[0].zgoscena });
  });

  it("stevilo vnosov: omejitve", async () => {
    const { dir, token } = await nova();
    await zapisi3(dir);
    const n = async (st: number | undefined) => (await preberiRevizijo(token, dir, { n: st })).vnosi.map((v) => v.n);
    assert.deepEqual(await n(2), [3, 2]);
    assert.deepEqual(await n(2.9), [3, 2]);
    assert.deepEqual(await n(0), [3]);
    assert.deepEqual(await n(-5), [3]);
    assert.deepEqual(await n(1000), [3, 2, 1]);
    assert.deepEqual(await n(Number.NaN), [3, 2, 1]);
    assert.deepEqual(await n(undefined), [3, 2, 1]);
  });

  it("omejitev 500 vnosov", async () => {
    const { dir, token } = await nova();
    const vnosi: Vnos[] = [];
    for (let i = 0; i < 510; i++) {
      const izid = await zapisiRevizijo(dir, { vrsta: "x", opis: `v${i}` }, T(0));
      assert.ok(izid.ok);
    }
    for (const v of vrstice(dir)) vnosi.push(JSON.parse(v) as Vnos);
    const pregled = await preberiRevizijo(token, dir, { n: 100000 });
    assert.equal(pregled.vnosi.length, 500);
    assert.equal(pregled.vnosi[0].n, 510);
    assert.equal(pregled.vnosi[499].n, 11);
    assert.equal(vnosi.length, 510);
    assert.equal((await preberiRevizijo(token, dir)).vnosi.length, 50, "privzeto 50 vnosov");
    assert.equal((await preberiRevizijo(token, dir, { n: Number.NaN })).vnosi.length, 50, "NaN = privzeto");
    assert.equal((await preberiRevizijo(token, dir, { n: 7 })).vnosi.length, 7);
  });

  it("poseg v vsebino se pokaze pri branju (zgoscena, vnos 2)", async () => {
    const { dir, token } = await nova();
    await zapisi3(dir);
    const v = vrstice(dir);
    v[1] = JSON.stringify({ ...(JSON.parse(v[1]) as Vnos), opis: "ponarejeno" });
    writeFileSync(datoteka(dir), `${v.join("\n")}\n`);
    const pregled = await preberiRevizijo(token, dir);
    assert.deepEqual(pregled.preverba, { ok: false, n: 2, razlog: "zgoscena" });
  });

  it("okrnitev: brez sidra neopazna, s sidrom opazna", async () => {
    const { dir, token } = await nova();
    await zapisi3(dir);
    const sidro = (await preberiRevizijo(token, dir)).sidro;
    assert.ok(sidro);
    const v = vrstice(dir);
    writeFileSync(datoteka(dir), `${v[0]}\n${v[1]}\n`);
    assert.equal((await preberiRevizijo(token, dir)).preverba.ok, true);
    assert.deepEqual((await preberiRevizijo(token, dir, { sidro: sidro ?? undefined })).preverba, { ok: false, n: 3, razlog: "sidro" });
  });

  it("nerazumljiva datoteka: preverba oblika, brez vnosov in sidra", async () => {
    const { dir, token } = await nova();
    writeFileSync(datoteka(dir), "to ni json\n");
    assert.deepEqual(await preberiRevizijo(token, dir), { preverba: { ok: false, n: 0, razlog: "oblika" }, vnosi: [], sidro: null });
  });
});
