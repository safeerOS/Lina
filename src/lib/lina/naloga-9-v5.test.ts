/**
 * Naloga 9, V5: koncane/preklicane naloge orkestratorja starejse od 30 dni in tiste cez mejo se samodejno pocistijo (samo lastne
 * datoteke stanja: <id>.json in <id>.dnevnik.jsonl veljavne koncane naloge); lastnik lahko koncano nalogo izbrise v kartici;
 * nova naloga nikoli ne zavrne zaradi starih koncanih.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setupOwner } from "./auth.server.ts";
import { OrkestratorNapaka, ustvariOrkestrator, ukazOrkestratorja, type KlicModela } from "./orkestrator.server.ts";

const DAN = 24 * 60 * 60_000;
const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n9-v5-"));
const visi: KlicModela = () => new Promise(() => undefined);
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true, klicModela: visi } as const;
const datoteke = async (root: string) => (await readdir(path.join(root, "orkestrator"))).sort();

function ura(zacetek = Date.parse("2026-11-25T10:00:00Z")) {
  let t = zacetek;
  return { zdaj: () => t, naprej: (ms: number) => { t += ms; } };
}

describe("V5: samodejno ciscenje koncanih nalog", () => {
  it("koncane starejse od 30 dni izginejo ob novi nalogi; aktivne, sveze in tuje datoteke ostanejo", async () => {
    const root = await mapa();
    const u = ura();
    const o = ustvariOrkestrator(root, { ...brez, zdaj: u.zdaj });
    const stara1 = await o.nova({ cilj: "stara 1" });
    await o.ustavi(stara1.id);
    const stara2 = await o.nova({ cilj: "stara 2" });
    await o.ustavi(stara2.id);
    const staraAktivna = await o.nova({ cilj: "stara, a se caka" });
    await writeFile(path.join(root, "orkestrator", "beleske.txt"), "tuje", { mode: 0o600 });
    await writeFile(path.join(root, "orkestrator", "o-00000000000000ff.json"), JSON.stringify({ faza: "koncano", posodobljeno: "2000-01-01T00:00:00Z" }), { mode: 0o600 });
    u.naprej(29 * DAN);
    const sveza = await o.nova({ cilj: "sveza" });
    await o.ustavi(sveza.id);
    u.naprej(2 * DAN);
    const nova = await o.nova({ cilj: "nova" });
    const ostale = await datoteke(root);
    for (const id of [stara1.id, stara2.id]) {
      assert.equal(ostale.includes(`${id}.json`), false, `${id} je star in koncan`);
      assert.equal(ostale.includes(`${id}.dnevnik.jsonl`), false, `dnevnik ${id}`);
    }
    for (const id of [staraAktivna.id, sveza.id, nova.id]) assert.ok(ostale.includes(`${id}.json`), id);
    assert.ok(ostale.includes("beleske.txt"), "tuja datoteka ostane");
    assert.ok(ostale.includes("o-00000000000000ff.json"), "neveljavna (podtaknjena) datoteka ostane - ni lastna veljavna naloga");
  });

  it("cez mejo koncanih se izbrisejo najstarejse; nova naloga ne zavrne zaradi koncanih", async () => {
    const root = await mapa();
    const u = ura();
    const o = ustvariOrkestrator(root, { ...brez, zdaj: u.zdaj });
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const n = await o.nova({ cilj: `naloga ${i}` });
      await o.ustavi(n.id);
      ids.push(n.id);
      u.naprej(60_000);
    }
    const nova = await o.nova({ cilj: "se ena" });
    const koncane = (await o.seznam()).filter((s) => s.id !== nova.id);
    assert.equal(koncane.length, 50, "najvec 50 koncanih");
    const ostali = new Set(koncane.map((s) => s.id));
    for (const id of ids.slice(0, 10)) assert.equal(ostali.has(id), false, `najstarejsa ${id} izbrisana`);
    for (const id of ids.slice(10)) assert.ok(ostali.has(id), `novejsa ${id} ostane`);
  });
});

describe("V5: izbris naloge (kartica)", () => {
  it("lastnik izbrise koncano nalogo (stanje in dnevnik); aktivne ne, neznane ne", async () => {
    const root = await mapa();
    const token = await setupOwner("geslo-test-1234", root);
    const o = ustvariOrkestrator(root, brez);
    const k = await o.nova({ cilj: "koncana" });
    await o.ustavi(k.id);
    const a = await o.nova({ cilj: "aktivna" });
    await o.izbrisi(k.id);
    const ostale = await datoteke(root);
    assert.equal(ostale.some((x) => x.startsWith(k.id)), false, ostale.join(","));
    await assert.rejects(o.izbrisi(a.id), (e: unknown) => e instanceof OrkestratorNapaka && e.koda === "faza");
    await assert.rejects(o.izbrisi("o-0123456789abcdef"), (e: unknown) => e instanceof OrkestratorNapaka && e.koda === "ni-naloge");
    await assert.rejects(o.izbrisi("../ponudniki"), (e: unknown) => e instanceof OrkestratorNapaka && e.koda === "ni-naloge");
    assert.ok((await datoteke(root)).includes(`${a.id}.json`));
    // ukaz iz kartice gre skozi isto pot (seja lastnika)
    const k2 = await o.nova({ cilj: "koncana 2" });
    await o.ustavi(k2.id);
    const st = await ukazOrkestratorja(token, { vrsta: "izbrisi", id: k2.id }, root);
    assert.equal(st.naloge.some((n) => n.id === k2.id), false);
  });

  it("kartica ima gumb Izbrisi za koncane naloge, besedilo v sl in en", async () => {
    const kartica = await readFile(path.join(import.meta.dirname, "../../components/lina2/orkestrator-kartica.tsx"), "utf8");
    assert.match(kartica, /vrsta: "izbrisi"/);
    assert.match(kartica, /t\("orkIzbrisi"\)/);
    const besedila = await readFile(path.join(import.meta.dirname, "besedila.ts"), "utf8");
    assert.equal((besedila.match(/\borkIzbrisi: "/g) ?? []).length, 2);
  });
});
