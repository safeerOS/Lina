/**
 * Naloga 12, #3 (slepi pregled 11): po nadgradnji na podpisano stanje (naloga 11 N1) naloge iz prejsnje izdaje ne smejo tiho izginiti.
 * Enkratna selitev ob prvem zagonu: koncane -> »stare, nepreverjene« (samo branje, izbris mozen); nedokoncane -> ustavljene z razlogom
 * »nadgradnja«, vidne, brez izvedbe orodja. Stanje z napacnim podpisom ostane neveljavno; izbrisi dovoli izbris neveljavne datoteke.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { OrodjeOrkestratorja } from "./orkestrator.ts";
import { javnaNaloga, ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n12-n3-"));
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
const koncni: KlicModela = async () => ({ ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });

function pisi(stevec: { n: number }): OrodjeOrkestratorja {
  return {
    razred: "pisanje",
    potrditev: true,
    definicija: { ime: "pisi", opis: "pisi", parametri: { type: "object", properties: { pot: { type: "string" } } } },
    izvedi: async () => (stevec.n++, { ok: true, rezultat: "zapisano" }),
  };
}

/** Stanje, kot ga je zapisala izdaja pred podpisom: brez polja podpis (prava koda ga ustvari, polje se odstrani). */
async function staro(root: string, orodja: OrodjeOrkestratorja[], sprememba: (s: Record<string, unknown>) => void): Promise<string> {
  const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja });
  const n = await o.nova({ cilj: "Preberi datoteko." });
  const pot = path.join(root, "orkestrator", `${n.id}.json`);
  const s = JSON.parse(await readFile(pot, "utf8")) as Record<string, unknown>;
  delete s.podpis;
  sprememba(s);
  await writeFile(pot, JSON.stringify(s), { mode: 0o600 });
  return n.id;
}

const koncana = (s: Record<string, unknown>) => Object.assign(s, { faza: "koncano", razlog: "dosezeno", odgovor: "Stari odgovor." });
const sPisi = (s: Record<string, unknown>) => {
  (s.sporocila as unknown[]).push({ vloga: "asistent", klici: [{ id: "k1-1", ime: "pisi", argumenti: { pot: "/x" } }] });
  s.odprti = [{ id: "k1-1", ime: "pisi", argumenti: { pot: "/x" }, potrjeno: true }];
};

describe("#3: enkratna selitev nepodpisanih nalog", () => {
  it("koncana naloga iz prejsnje izdaje ostane vidna kot stara, nepreverjena", async () => {
    const root = await mapa();
    const id = await staro(root, [], koncana);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    const s = (await o.seznam()).find((x) => x.id === id);
    assert.ok(s, "naloga je na seznamu");
    assert.equal(s!.faza, "koncano");
    assert.equal(s!.odgovor, "Stari odgovor.");
    assert.equal(javnaNaloga(s!).nepreverjeno, true, "vmesnik dobi oznako");
  });

  it("nedokoncana naloga s podtaknjeno potrditvijo: ustavljena z razlogom nadgradnja, orodje ni poklicano", async () => {
    const root = await mapa();
    const st = { n: 0 };
    const id = await staro(root, [pisi(st)], sPisi);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja: [pisi(st)] });
    await o.nadaljujPoZagonu();
    await new Promise((r) => setTimeout(r, 50));
    const s = await o.preberi(id);
    assert.equal(st.n, 0, "orodje ni poklicano");
    assert.equal(s?.faza, "ustavljeno");
    assert.equal(s?.razlog, "nadgradnja");
    assert.equal(s?.nepreverjeno, true);
    assert.deepEqual(s?.odprti, []);
  });

  it("selitev je enkratna: kasneje podtaknjena nepodpisana datoteka ostane neveljavna", async () => {
    const root = await mapa();
    await staro(root, [], koncana);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    const id2 = await staro(root, [], koncana);
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o2.nadaljujPoZagonu();
    assert.equal(await o2.preberi(id2), null);
  });

  it("tudi ob izbrisani oznaki selitve podtaknjena nedokoncana naloga ne izvede orodja", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    const oznake = (await import("node:fs/promises")).readdir(path.join(root, "orkestrator"));
    for (const f of (await oznake).filter((x) => x.startsWith(".selitev"))) await unlink(path.join(root, "orkestrator", f));
    const st = { n: 0 };
    const id = await staro(root, [pisi(st)], sPisi);
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja: [pisi(st)] });
    await o2.nadaljujPoZagonu();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(st.n, 0);
    assert.notEqual((await o2.preberi(id))?.faza, "tece");
  });

  it("stanje z napacnim podpisom se ne preseli (ostane neveljavno)", async () => {
    const root = await mapa();
    const id = await staro(root, [], (s) => { koncana(s); s.podpis = "0".repeat(64); });
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    assert.equal(await o.preberi(id), null);
  });

  it("izbrisi odstrani neveljavno datoteko z veljavnim id", async () => {
    const root = await mapa();
    const id = await staro(root, [], (s) => { koncana(s); s.podpis = "0".repeat(64); });
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.izbrisi(id);
    await assert.rejects(access(path.join(root, "orkestrator", `${id}.json`)));
  });

  it("opozorilo v vmesniku: kljuc v sl in en, kartica ga prikaze", async () => {
    const { besedila } = await import("./besedila.ts") as unknown as { besedila: Record<string, Record<string, string>> };
    assert.match(besedila.sl?.orkNepreverjeno ?? "", /prejšnj/i);
    assert.match(besedila.en?.orkNepreverjeno ?? "", /previous/i);
    const kartica = await readFile(path.join(import.meta.dirname, "../../components/lina2/orkestrator-kartica.tsx"), "utf8");
    assert.match(kartica, /n\.nepreverjeno \?[^\n]*orkNepreverjeno/);
  });
});

describe("#3: selitev ob napaki ni porabljena", { skip: process.platform === "win32" }, () => {
  it("ce selitev datoteke pade (kljuc zavrnjen), se ob naslednjem zagonu ponovi", async () => {
    const { chmod, copyFile, mkdir } = await import("node:fs/promises");
    const vir = await mapa();
    const id = await staro(vir, [], koncana);
    const root = await mapa();
    await mkdir(path.join(root, "orkestrator"), { recursive: true });
    await copyFile(path.join(vir, "orkestrator", `${id}.json`), path.join(root, "orkestrator", `${id}.json`));
    await writeFile(path.join(root, ".kljuc"), Buffer.alloc(32, 4), { mode: 0o600 });
    await chmod(path.join(root, ".kljuc"), 0o644);
    await ustvariOrkestrator(root, { ...brez, klicModela: koncni }).nadaljujPoZagonu().catch(() => undefined);
    await chmod(path.join(root, ".kljuc"), 0o600);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nadaljujPoZagonu();
    assert.equal((await o.preberi(id))?.nepreverjeno, true);
  });
});
