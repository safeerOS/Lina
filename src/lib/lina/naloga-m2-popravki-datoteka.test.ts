/**
 * Lina M2 popravki (slepi pregled 2, 15. 11. 2026): F7 (kopija pokvarjene spomin.json ostane z vso vsebino) in
 * F8 (spomin.json kot simbolna povezava, mapa ali prevelika datoteka). Vsi vzorci so izmisljeni; preizkusna mapa je mkdtemp in se pobrise.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { dejstvaZaModel, dodajDejstvo, izbrisiVsaDejstva, nastaviSpomin, preberiSpomin } from "./spomin.server.ts";

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function okolje(): Promise<{ dir: string; token: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-m2p-spomin-"));
  temps.push(dir);
  return { dir, token: await setupOwner("geslo-test-1234", dir) };
}
const tiho = async <T>(f: () => Promise<T>): Promise<T> => {
  const w = console.warn;
  const i = console.info;
  console.warn = () => {};
  console.info = () => {};
  try {
    return await f();
  } finally {
    console.warn = w;
    console.info = i;
  }
};
const kopije = async (dir: string): Promise<string[]> => (await readdir(dir)).filter((f) => /^spomin\.pokvarjen-.*\.json$/.test(f));
const TUJA = JSON.stringify({ vklopljen: true, dejstva: [{ id: "tuj1", besedilo: "Tuje dejstvo iz druge datoteke o delavnici.", klicatelju: true, ustvarjeno: "" }] });

describe("M2 popravki F7: kopija pokvarjene datoteke", () => {
  it("»izbrisi vsa dejstva« izbrise tudi kopije pokvarjenih datotek", async () => {
    const { dir, token } = await okolje();
    await writeFile(path.join(dir, "spomin.json"), '{ "vklopljen": true, "dejstva": [ {"besedilo": "ZASEBNO-DEJSTVO-O-LASTNIKU"');
    await tiho(() => dodajDejstvo({ besedilo: "Delavnica je zaprta med prazniki." }, token, dir));
    assert.equal((await kopije(dir)).length, 1, "kopija je nastala");
    await tiho(() => izbrisiVsaDejstva(token, dir));
    assert.deepEqual(await kopije(dir), [], "po izbrisu vseh dejstev ni kopij");
    const vse = (await Promise.all((await readdir(dir)).map((f) => readFile(path.join(dir, f), "utf8").catch(() => "")))).join("\n");
    assert.equal(vse.includes("ZASEBNO-DEJSTVO"), false, "vsebine ni nikjer v mapi");
  });
  it("kopija ima pravice 0600 tudi, ce je bil izvirnik 0644", { skip: process.platform === "win32" }, async () => {
    const { dir, token } = await okolje();
    const f = path.join(dir, "spomin.json");
    await writeFile(f, "{ pokvarjeno", { mode: 0o644 });
    await chmod(f, 0o644);
    await tiho(() => nastaviSpomin(true, token, dir));
    const k = await kopije(dir);
    assert.equal(k.length, 1);
    assert.equal((await stat(path.join(dir, k[0]))).mode & 0o777, 0o600);
  });
  it("ponavljajoce pokvarjanje ne kopici kopij (najvec 3)", async () => {
    const { dir, token } = await okolje();
    for (let i = 0; i < 6; i++) {
      await writeFile(path.join(dir, "spomin.json"), `{ pokvarjeno ${i}`);
      await new Promise((r) => setTimeout(r, 3));
      await tiho(() => nastaviSpomin(i % 2 === 0, token, dir));
    }
    assert.ok((await kopije(dir)).length <= 3, String((await kopije(dir)).length));
  });
});

describe("M2 popravki F8: spomin.json ni obicajna datoteka ali je prevelika", () => {
  it("simbolna povezava na tujo JSON datoteko ni spomin (prej je dejstvaZaModel vrnil tuja dejstva)", async () => {
    const { dir, token } = await okolje();
    const tujaMapa = await mkdtemp(path.join(tmpdir(), "lina-m2p-tuja-"));
    temps.push(tujaMapa);
    const tuja = path.join(tujaMapa, "tuja.json");
    await writeFile(tuja, TUJA);
    try {
      await symlink(tuja, path.join(dir, "spomin.json"));
    } catch {
      return; // brez pravice za povezave (Windows)
    }
    assert.deepEqual(await tiho(() => dejstvaZaModel(dir)), []);
    assert.deepEqual((await tiho(() => preberiSpomin(token, dir))).dejstva, []);
    // zapis povezave ne spremeni tuje datoteke
    await tiho(() => dodajDejstvo({ besedilo: "Delavnica je zaprta med prazniki." }, token, dir));
    assert.equal(await readFile(tuja, "utf8"), TUJA, "tuja datoteka je nedotaknjena");
    assert.equal((await stat(path.join(dir, "spomin.json"))).isFile(), true);
  });
  it("spomin.json kot mapa ne zaklene operacij (preberi, nastavi, dejstvaZaModel)", async () => {
    const { dir, token } = await okolje();
    await mkdir(path.join(dir, "spomin.json"));
    assert.deepEqual(await tiho(() => dejstvaZaModel(dir)), []);
    assert.deepEqual((await tiho(() => preberiSpomin(token, dir))).dejstva, []);
    const p = await tiho(() => nastaviSpomin(true, token, dir));
    assert.equal(p.vklopljen, true);
    assert.equal((await stat(path.join(dir, "spomin.json"))).isFile(), true);
  });
  it("prevelika veljavna datoteka (2 MB) se ne razclenja in ne gre v model", async () => {
    const { dir } = await okolje();
    await writeFile(path.join(dir, "spomin.json"), TUJA.slice(0, -1) + " ".repeat(2_000_000) + "}");
    const t0 = process.hrtime.bigint();
    assert.deepEqual(await tiho(() => dejstvaZaModel(dir)), []);
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 200);
  });
  it("obicajna datoteka z dejstvi se se vedno bere", async () => {
    const { dir } = await okolje();
    await writeFile(path.join(dir, "spomin.json"), TUJA);
    const d = await tiho(() => dejstvaZaModel(dir));
    assert.equal(d.length, 1);
  });
});
