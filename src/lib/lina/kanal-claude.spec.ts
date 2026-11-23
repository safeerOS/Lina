import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nizSinhron, zgostitevSinhron } from "./kanal-claude.ts";
import { MEJA_ODGOVORA, MEJA_ODGOVORA_B, NapakaSinhron, izmenjajSinhron, preveriKlic, preveriZahtevo, type KlicSinhron } from "./sinhron-telefon.server.ts";
import { loadPravila } from "./pravila.server.ts";

const klic = (id: string, extra: Partial<KlicSinhron> = {}): KlicSinhron => ({
  id, casZacetka: 1000, stevilka: "+38640111222", trajanjeS: 42, nujno: false, povzetek: "Miha Horvat se oglasi.",
  nacin: "osebna", klicatelj: "Miha Horvat", podjetje: "", sporocilo: "Naj ga pokličete nazaj.", sporociloDobesedno: "pokličite me nazaj", brezSporocilaRazlog: "", ...extra,
});

let dir = "";
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "sinhron-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("sinhronizacija telefona", () => {
  it("podpisni niz je vezan na zgostitev", () => {
    expect(nizSinhron("n-ab", 5, "e", zgostitevSinhron("{}"))).toBe(`safeer-lina-sinhron-v1\nn-ab\n5\ne\n${zgostitevSinhron("{}")}`);
    expect(zgostitevSinhron("{}")).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
  });
  it("brez dvojnikov in z revizijami", async () => {
    const a = await izmenjajSinhron({ rev: 0, klici: [klic("klic-1"), klic("klic-1")], pogovor: [], navodila: null }, dir);
    expect(a.klici).toHaveLength(1);
    const b = await izmenjajSinhron({ rev: a.rev, klici: [klic("klic-1")], pogovor: [], navodila: null }, dir);
    expect(b.klici).toHaveLength(0);
    expect(b.rev).toBe(a.rev);
    const c = await izmenjajSinhron({ rev: 0, klici: [], pogovor: [], navodila: null }, dir);
    expect(c.klici.map((k) => k.id)).toEqual(["klic-1"]);
  });
  it("pogovor in navodila gredo na racunalnik", async () => {
    const o = await izmenjajSinhron({ rev: 0, klici: [], pogovor: [{ vloga: "lastnik", besedilo: "Zdravo", cas: "2026-11-20T10:00:00.000Z" }], navodila: { besedilo: "Bodi kratka.", cas: 10 } }, dir);
    expect(o.pogovor).toHaveLength(1);
    expect((await loadPravila(dir)).navodila).toBe("Bodi kratka.");
    const drug = await izmenjajSinhron({ rev: 0, klici: [], pogovor: [], navodila: null }, dir);
    expect(drug.navodila?.besedilo).toBe("Bodi kratka.");
  });
  it("novejsa navodila z istim besedilom premaknejo verzijo, starejsa se zavrnejo", async () => {
    await izmenjajSinhron({ rev: 0, klici: [], pogovor: [], navodila: { besedilo: "A", cas: 10 } }, dir);
    const b = await izmenjajSinhron({ rev: 0, klici: [], pogovor: [], navodila: { besedilo: "A", cas: 30 } }, dir);
    expect(b.navodila?.cas).toBe(30);
    await izmenjajSinhron({ rev: 0, klici: [], pogovor: [], navodila: { besedilo: "B", cas: 20 } }, dir);
    expect((await loadPravila(dir)).navodila).toBe("A");
  });
  it("manjkajoc asistent.json se ob ponovnem poskusu popravi brez nove revizije", async () => {
    const a = await izmenjajSinhron({ rev: 0, klici: [], pogovor: [{ vloga: "lastnik", besedilo: "Zdravo", cas: "2026-11-20T10:00:00.000Z" }], navodila: null }, dir);
    await rm(path.join(dir, "asistent.json"), { force: true });
    const b = await izmenjajSinhron({ rev: a.rev, klici: [], pogovor: [], navodila: null }, dir);
    expect(b.rev).toBe(a.rev);
    expect(JSON.parse(await readFile(path.join(dir, "asistent.json"), "utf8"))).toHaveLength(1);
  });
  it("omeji odgovor in pove, da je se vnosov", async () => {
    const klici = Array.from({ length: MEJA_ODGOVORA + 5 }, (_, i) => klic(`klic-${i}`));
    const prvi = await izmenjajSinhron({ rev: 0, klici: klici.slice(0, 250), pogovor: [], navodila: null }, dir);
    await izmenjajSinhron({ rev: prvi.rev, klici: klici.slice(250), pogovor: [], navodila: null }, dir);
    let rev = 0; let skupaj = 0; let prvic = true;
    for (let krog = 0; krog < 50; krog++) {
      const o = await izmenjajSinhron({ rev, klici: [], pogovor: [], navodila: null }, dir);
      expect(o.klici.length).toBeLessThanOrEqual(MEJA_ODGOVORA);
      if (prvic) { expect(o.ostane).toBe(true); prvic = false; }
      skupaj += o.klici.length; rev = o.rev;
      if (!o.ostane) break;
    }
    expect(skupaj).toBe(MEJA_ODGOVORA + 5);
  });
  it("odgovor nikoli ne preseze 64 KiB telefona", async () => {
    const debel = (i: number) => klic(`klic-${i}`, { sporociloDobesedno: "č".repeat(2900), povzetek: "š".repeat(1900) });
    for (let i = 0; i < 4; i++) await izmenjajSinhron({ rev: 0, klici: Array.from({ length: 30 }, (_, j) => debel(i * 30 + j)), pogovor: [], navodila: null }, dir);
    let rev = 0; let skupaj = 0; let krogov = 0;
    for (;;) {
      const o = await izmenjajSinhron({ rev, klici: [], pogovor: [], navodila: null }, dir);
      expect(Buffer.byteLength(JSON.stringify(o), "utf8")).toBeLessThan(64 * 1024);
      skupaj += o.klici.length; rev = o.rev; krogov++;
      if (!o.ostane) break;
      expect(krogov).toBeLessThan(100);
    }
    expect(skupaj).toBe(120);
    expect(MEJA_ODGOVORA_B).toBeLessThan(64 * 1024);
  });
  it("zavrne neveljavne vnose", () => {
    expect(() => preveriKlic({ ...klic("a b") })).toThrow(NapakaSinhron);
    expect(() => preveriKlic({ ...klic("ok"), stevilka: "" })).toThrow(NapakaSinhron);
    expect(() => preveriZahtevo({ rev: -1 })).toThrow(NapakaSinhron);
    expect(() => preveriZahtevo({ klici: new Array(301).fill(klic("x")) })).toThrow(NapakaSinhron);
    expect(() => preveriKlic({ ...klic("ok"), povzetek: "\ud800" })).toThrow(NapakaSinhron);
    // en zastrupljen vnos ne zavrne cele zahteve
    const z = preveriZahtevo({ rev: 0, klici: [klic("dober-1"), { ...klic("slab"), povzetek: "x".repeat(5000) }, klic("dober-2")], pogovor: [{ vloga: "tuja", besedilo: "a", cas: "x" }] });
    expect(z.klici.map((k) => k.id)).toEqual(["dober-1", "dober-2"]);
    expect(z.pogovor).toHaveLength(0);
  });
  it("ponastavljeno stanje: nova epoha vrne vse, odgovor nosi epoho", async () => {
    const a = await izmenjajSinhron({ rev: 0, klici: [klic("klic-1")], pogovor: [], navodila: null }, dir);
    expect(a.epoha).toMatch(/^[0-9a-f]{16}$/);
    const ista = await izmenjajSinhron({ rev: a.rev, epoha: a.epoha, klici: [], pogovor: [], navodila: null }, dir);
    expect(ista.klici).toHaveLength(0);
    const druga = await izmenjajSinhron({ rev: 999, epoha: "0123456789abcdef", klici: [], pogovor: [], navodila: null }, dir);
    expect(druga.klici.map((k) => k.id)).toEqual(["klic-1"]);
  });
  it("hkratna klica ne izgubita revizij", async () => {
    const [a, b] = await Promise.all([
      izmenjajSinhron({ rev: 0, klici: [klic("klic-a")], pogovor: [], navodila: null }, dir),
      izmenjajSinhron({ rev: 0, klici: [klic("klic-b")], pogovor: [], navodila: null }, dir),
    ]);
    const vsi = await izmenjajSinhron({ rev: 0, klici: [], pogovor: [], navodila: null }, dir);
    expect(vsi.klici.map((k) => k.id).sort()).toEqual(["klic-a", "klic-b"]);
    expect(new Set([a.rev, b.rev]).size).toBe(2);
  });
});
