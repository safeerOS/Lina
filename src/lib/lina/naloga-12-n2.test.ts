/**
 * Naloga 12, #2 (slepi pregled 11): podpis ne veze svezine. Monotona »verzija« v podpisani vsebini in podpisan indeks zadnjih verzij
 * (orkestrator/indeks.json): starejsa podpisana kopija stanja je zavrnjena (v procesu in po zagonu), tudi kopija izbrisane naloge.
 * Nedokoncan klic, ki ni branje in ga ni odprl ta proces (stanje z diska po zagonu), vedno caka potrditev.
 * Meja: vrnjen indeks SKUPAJ s starim stanjem po ponovnem zagonu ostane veljaven (varuje pravilo potrditve). Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { OrodjeOrkestratorja } from "./orkestrator.ts";
import { podpisStanja, razlogNeveljavnegaStanja, ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n12-n2-"));
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
const koncni: KlicModela = async () => ({ ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });
const datoteka = (root: string, id: string) => path.join(root, "orkestrator", `${id}.json`);

async function cakaj(fn: () => Promise<boolean> | boolean, ms = 3000): Promise<void> {
  const konec = Date.now() + ms;
  while (Date.now() < konec) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("pogoj ni izpolnjen");
}

function pisi(stevec: { n: number }): OrodjeOrkestratorja {
  return {
    razred: "pisanje",
    potrditev: false,
    definicija: { ime: "pisi", opis: "pisi", parametri: { type: "object", properties: { pot: { type: "string" } } } },
    izvedi: async () => (stevec.n++, { ok: true, rezultat: "zapisano" }),
  };
}

describe("#2: verzija stanja in indeks", () => {
  it("v procesu: vrnjena starejsa podpisana kopija je zavrnjena", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    const n = await o.nova({ cilj: "Naloga." });
    const stara = await readFile(datoteka(root, n.id), "utf8");
    assert.equal((await o.teci(n.id)).faza, "koncano");
    await writeFile(datoteka(root, n.id), stara);
    assert.equal(await o.preberi(n.id), null);
  });

  it("po zagonu: indeks na disku zavrne starejso kopijo", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    const n = await o.nova({ cilj: "Naloga." });
    const stara = await readFile(datoteka(root, n.id), "utf8");
    await o.teci(n.id);
    await writeFile(datoteka(root, n.id), stara);
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    assert.equal(await o2.preberi(n.id), null);
  });

  it("kopija izbrisane naloge se po zagonu ne vrne", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    const n = await o.nova({ cilj: "Naloga." });
    await o.teci(n.id);
    const koncna = await readFile(datoteka(root, n.id), "utf8");
    await o.izbrisi(n.id);
    await writeFile(datoteka(root, n.id), koncna);
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    assert.equal(await o2.preberi(n.id), null);
  });

  it("kontrola: indeks, starejsi od stanja (prekinitev med zapisoma), stanja ne skrije", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    const n = await o.nova({ cilj: "Naloga." });
    const indeks = await readFile(path.join(root, "orkestrator", "indeks.json"), "utf8").catch(() => null);
    await o.teci(n.id);
    if (indeks !== null) await writeFile(path.join(root, "orkestrator", "indeks.json"), indeks);
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    assert.equal((await o2.preberi(n.id))?.faza, "koncano");
  });

  it("shema: verzija mora biti nenegativno celo stevilo", async () => {
    const root = await mapa();
    const n = await ustvariOrkestrator(root, { ...brez, klicModela: koncni }).nova({ cilj: "Naloga." });
    const s = JSON.parse(await readFile(datoteka(root, n.id), "utf8")) as Record<string, unknown>;
    delete s.podpis;
    assert.equal(razlogNeveljavnegaStanja(s, n.id, () => true), null, "kontrola");
    for (const v of [1.5, -1, "3"]) assert.equal(razlogNeveljavnegaStanja({ ...s, verzija: v }, n.id, () => true), "verzija", String(v));
  });

  it("po zagonu: nezacet klic, ki ni branje, caka potrditev (tudi orodje brez potrditve)", async () => {
    const root = await mapa();
    const st = { n: 0 };
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja: [pisi(st)] });
    const n = await o.nova({ cilj: "Pisi." });
    const s = JSON.parse(await readFile(datoteka(root, n.id), "utf8")) as Record<string, unknown>;
    (s.sporocila as unknown[]).push({ vloga: "asistent", klici: [{ id: "k1-1", ime: "pisi", argumenti: { pot: "/x" } }] });
    s.odprti = [{ id: "k1-1", ime: "pisi", argumenti: { pot: "/x" } }];
    delete s.podpis;
    s.podpis = await podpisStanja(root, s);
    await writeFile(datoteka(root, n.id), JSON.stringify(s));
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja: [pisi(st)] });
    await o2.nadaljujPoZagonu();
    await cakaj(async () => (await o2.preberi(n.id))?.faza !== "tece");
    assert.equal(st.n, 0);
    assert.equal((await o2.preberi(n.id))?.faza, "caka-potrditev");
  });

  it("kontrola: v istem procesu odprt klic orodja brez potrditve se izvede brez vprasanja", async () => {
    const root = await mapa();
    const st = { n: 0 };
    let i = 0;
    const model: KlicModela = async () => (i++ === 0
      ? { ok: true, besedilo: "", klici: [{ id: "x", ime: "pisi", argumenti: { pot: "/x" } }], usage: null, razlogKonca: "orodje" }
      : { ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });
    const o = ustvariOrkestrator(root, { ...brez, klicModela: model, orodja: [pisi(st)] });
    const n = await o.nova({ cilj: "Pisi." });
    assert.equal((await o.teci(n.id)).faza, "koncano");
    assert.equal(st.n, 1);
  });
});

describe("#2: zavrnjen kljuc ob branju indeksa", { skip: process.platform === "win32" }, () => {
  it("po popravku pravic .kljuc zapis deluje brez ponovnega zagona", async () => {
    const { chmod, mkdir } = await import("node:fs/promises");
    const root = await mapa();
    await mkdir(path.join(root, "orkestrator"), { recursive: true });
    await writeFile(path.join(root, "orkestrator", "indeks.json"), JSON.stringify({ verzije: {}, podpis: "x" }));
    await writeFile(path.join(root, ".kljuc"), Buffer.alloc(32, 4), { mode: 0o600 });
    await chmod(path.join(root, ".kljuc"), 0o644);
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await assert.rejects(o.nova({ cilj: "Naloga ob zavrnjenem kljucu." }));
    await chmod(path.join(root, ".kljuc"), 0o600);
    const n = await o.nova({ cilj: "Naloga." });
    assert.ok(await o.preberi(n.id));
  });
});
