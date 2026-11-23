/**
 * Preizkusi vezave revizijske verige (naloga #45 + #44): shranjevanje kataloga (publishLine) in potrditev spletnega
 * znanja (potrdiPredlog) zapisujeta v revizija.jsonl BREZ vsebine. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { formaCatalog } from "./catalog.ts";
import { kratkaZgoscena } from "./revizija-katalog.ts";
import { DATOTEKA_REVIZIJE, preberiRevizijo } from "./revizija.server.ts";
import type { Vnos } from "./revizija.ts";
import { loadLine, publishLine } from "./service.server.ts";
import { potrdiPredlog } from "./splet.server.ts";
import { writeJson } from "./store.server.ts";
import type { Catalog, Predlog } from "./types.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-revizija-vezava-"));
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

const datoteka = (dir: string) => path.join(dir, DATOTEKA_REVIZIJE);
const surovo = (dir: string) => (existsSync(datoteka(dir)) ? readFileSync(datoteka(dir), "utf8") : "");

async function katalog(dir: string): Promise<Catalog> {
  return JSON.parse(JSON.stringify((await loadLine(dir)).catalog)) as Catalog;
}

/** Privzet katalog nima imena (obvezno polje): najprej shranimo osnovno ime, nato merimo naslednje spremembe. */
async function osnova(dir: string, token: string): Promise<void> {
  const k = await katalog(dir);
  k.company.name = "Osnova d.o.o.";
  await publishLine({ catalog: k }, { token }, dir);
}

/** Vnosi po vrsti nastanka (preberiRevizijo jih vrne najnovejsega prvega). */
async function kronolosko(token: string, dir: string): Promise<{ vnosi: Vnos[]; zadnja: string; ok: boolean; stevilo: number }> {
  const izpis = await preberiRevizijo(token, dir);
  const p = izpis.preverba;
  return { vnosi: [...izpis.vnosi].reverse(), zadnja: p.ok ? p.zadnja : "", ok: p.ok, stevilo: p.ok ? p.stevilo : -1 };
}

describe("revizija: shranjevanje kataloga", () => {
  it("sprememba podjetja zapise vnos brez vsebine", async () => {
    const { dir, token } = await nova();
    const k = await katalog(dir);
    k.company.name = "Mizarstvo Preizkus";
    k.company.phone = "+38640123456";
    await publishLine({ catalog: k }, { token }, dir);
    const izpis = await preberiRevizijo(token, dir);
    assert.equal(izpis.preverba.ok, true);
    assert.equal(izpis.vnosi.length, 1);
    assert.equal(izpis.vnosi[0].vrsta, "katalog.sprememba");
    assert.equal(izpis.vnosi[0].podatki?.razdelki, "podjetje");
    const besedilo = surovo(dir);
    assert.equal(besedilo.includes("Mizarstvo Preizkus"), false, "ime podjetja ni v dnevniku");
    assert.equal(besedilo.includes("40123456"), false, "telefon ni v dnevniku");
  });

  it("sprememba znanja zapise razdelek, stevilo znakov in 16-mestno zgoscevalno kodo, ne besedila", async () => {
    const { dir, token } = await nova();
    await osnova(dir, token);
    const k = await katalog(dir);
    const znanje = "Delovni cas zbirnega centra je zaupen podatek stranke.";
    k.znanje = znanje;
    await publishLine({ catalog: k }, { token }, dir);
    const { vnosi } = await kronolosko(token, dir);
    assert.equal(vnosi.length, 2);
    assert.equal(vnosi[1].podatki?.razdelki, "znanje");
    assert.equal(vnosi[1].podatki?.znanjeZnakov, znanje.length);
    assert.equal(vnosi[1].podatki?.znanjeSha16, kratkaZgoscena(znanje));
    assert.equal(surovo(dir).includes("zbirnega centra"), false, "besedilo znanja ni v dnevniku");
  });

  it("enak katalog: nov vnos se ne zapise", async () => {
    const { dir, token } = await nova();
    await osnova(dir, token);
    const prej = surovo(dir);
    assert.notEqual(prej, "");
    await publishLine({ catalog: await katalog(dir) }, { token }, dir);
    assert.equal(surovo(dir), prej);
  });

  it("samo odprtje linije (brez kataloga): vnosa ni", async () => {
    const { dir, token } = await nova();
    await publishLine({ open: false }, { token }, dir);
    assert.equal(surovo(dir), "");
  });

  it("zaporedne spremembe tvorijo veljavno verigo", async () => {
    const { dir, token } = await nova();
    for (const ime of ["Prvo", "Drugo", "Tretje"]) {
      const k = await katalog(dir);
      k.company.name = ime;
      await publishLine({ catalog: k }, { token }, dir);
    }
    const { vnosi, ok, stevilo, zadnja } = await kronolosko(token, dir);
    assert.equal(vnosi.length, 3);
    assert.equal(ok, true);
    assert.equal(stevilo, 3);
    assert.equal(zadnja, vnosi[2].zgoscena);
  });

  it("pokvarjena veriga ne prepreci shranjevanja kataloga", async () => {
    const { dir, token } = await nova();
    writeFileSync(datoteka(dir), "to ni veriga\n");
    const k = await katalog(dir);
    k.company.name = "Kljub pokvarjeni verigi";
    await publishLine({ catalog: k }, { token }, dir);
    assert.equal((await loadLine(dir)).catalog.company.name, "Kljub pokvarjeni verigi");
    assert.equal(surovo(dir), "to ni veriga\n", "pokvarjena datoteka ostane nespremenjena");
  });
});

function predlog(gostitelj: string): Predlog {
  return {
    gostitelj,
    strani: 1,
    prazno: false,
    sporocilo: "",
    podjetje: { id: "podjetje", izbrano: true, ime: "Zlatnik Skrivni d.o.o.", opis: "", material: "", ure: "", stik: "" },
    vrstice: [],
  };
}

describe("revizija: potrditev znanja s spletne strani", () => {
  async function potrdi(gostitelj: string): Promise<{ dir: string; token: string }> {
    const { dir, token } = await nova();
    await writeJson(dir, "predlog.json", predlog(gostitelj));
    await potrdiPredlog(["podjetje"], token, dir);
    return { dir, token };
  }

  it("zapise znanje.iz-strani z gostiteljem in stevilom izbranih, brez vsebine", async () => {
    const { dir, token } = await potrdi("Primer.SI");
    const { vnosi, ok } = await kronolosko(token, dir);
    assert.deepEqual(
      vnosi.map((v) => v.vrsta),
      ["katalog.sprememba", "znanje.iz-strani"],
    );
    assert.deepEqual(vnosi[1].podatki, { gostitelj: "primer.si", izbranih: 1, idn: 0 });
    assert.equal(ok, true);
    assert.equal(surovo(dir).includes("Zlatnik Skrivni"), false, "vsebina predloga ni v dnevniku");
  });

  it("nepravilen gostitelj se zapise kot nepravilen", async () => {
    const { dir, token } = await potrdi("slab gostitelj/pot?x=1");
    const { vnosi } = await kronolosko(token, dir);
    assert.deepEqual(vnosi[1].podatki, { gostitelj: "nepravilen", izbranih: 1, idn: 0 });
    assert.equal(surovo(dir).includes("slab gostitelj"), false);
  });

  it("gostitelj z xn-- (punycode) je oznacen z idn 1", async () => {
    const { dir, token } = await potrdi("xn--zlatnik-1db.si");
    const { vnosi } = await kronolosko(token, dir);
    assert.deepEqual(vnosi[1].podatki, { gostitelj: "xn--zlatnik-1db.si", izbranih: 1, idn: 1 });
  });
});
