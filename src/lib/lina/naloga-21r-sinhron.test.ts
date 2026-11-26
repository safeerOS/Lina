/**
 * Naloga 21r: racunalniski del naloge 21t (POROCILO-21t.md »Za vodjo: racunalnik«).
 * A8: zapis klica s casZacetka vec kot dan v prihodnosti se PRESKOCI (ne vrze), ostali zapisi iste zahteve so sprejeti; ura je argument.
 * A7: odgovor nosi rokHrambeDni (celo stevilo 1..3650), ki ga telefon bere strpno (SinhronLine.kt, NajdbeA0214Test »A7«).
 * A3: zapis, ki ga telefon pripravi do meje (izvoz dokaz-21t/a3-zeleni.json, a3b-meja.json), racunalnik sprejme brez okrnitve.
 * Vrednosti izmisljene.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { izmenjajSinhron, preveriZahtevo, type KlicSinhron } from "./sinhron-telefon.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n21r-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const novaMapa = () => mkdtemp(path.join(KOREN, "d-"));

const ZDAJ = Date.parse("2026-11-26T09:00:00.000Z");
const DAN = 86_400_000;
const klic = (id: string, extra: Partial<KlicSinhron> = {}): KlicSinhron => ({
  id, casZacetka: ZDAJ - 3_600_000, stevilka: "+38640111222", trajanjeS: 42, nujno: false, povzetek: "Miha Primer prosi za povratni klic.",
  nacin: "osebna", klicatelj: "Miha Primer", podjetje: "", sporocilo: "Naj ga poklicete nazaj.", sporociloDobesedno: "", brezSporocilaRazlog: "",
  prepisPogovora: [], prepisOkrnjen: false, ...extra,
});
/** Zahteva, kot jo zapise telefon (SinhronLine.zahteva, encodeDefaults = true). */
const zTelefona = (klici: unknown[], zdaj = ZDAJ) =>
  preveriZahtevo(JSON.parse(JSON.stringify({ rev: 0, klici, pogovor: [], navodila: null, epoha: null, izbrisani: [] })), zdaj);

describe("21r A8: zapis iz prihodnosti se preskoci, ne zatakne vrste", () => {
  it("vec kot dan naprej = preskocen in prestet; tocno dan naprej in ostali zapisi iste zahteve so sprejeti", () => {
    const z = zTelefona([
      klic("klic-1"),
      klic("klic-prihodnost", { casZacetka: ZDAJ + DAN + 1 }),
      klic("klic-meja", { casZacetka: ZDAJ + DAN }),
      klic("klic-dalec", { casZacetka: ZDAJ + 400 * DAN }),
      klic("klic-2"),
    ]);
    assert.deepEqual(z.klici.map((k) => k.id), ["klic-1", "klic-meja", "klic-2"]);
    assert.equal(z.preskoceniPrihodnost, 2);
  });

  it("ura je argument: isti zapis je ob drugi uri sprejet", () => {
    const k = klic("klic-x", { casZacetka: ZDAJ + 10 * DAN });
    assert.equal(zTelefona([k]).klici.length, 0);
    assert.deepEqual(zTelefona([k], ZDAJ + 10 * DAN).klici.map((x) => x.id), ["klic-x"]);
    assert.equal(zTelefona([k], ZDAJ + 10 * DAN).preskoceniPrihodnost, 0);
  });

  it("preskocen zapis ne pride v stanje ali odgovor, sosednji da", async () => {
    const dir = await novaMapa();
    const o = await izmenjajSinhron(zTelefona([klic("klic-1"), klic("klic-prihodnost", { casZacetka: ZDAJ + 2 * DAN })]), dir, { zdaj: () => ZDAJ });
    assert.deepEqual(o.klici.map((k) => k.id), ["klic-1"]);
  });
});

/** Vektor iz telefonskega preizkusa (NajdbeA0214Test.izmenjajZRokom): telefon bere rokHrambeDni samo kot JSON stevilo, ne niz. */
const VEKTOR_TELEFONA = `{"epoha":"00112233aabbccdd","rev":1,"zmoznosti":["prepis-v1"],"rokHrambeDni":30}`;

describe("21r A7: odgovor nosi rok hrambe za telefon", () => {
  const odgovorZRokom = async (rok?: unknown) => {
    const dir = await novaMapa();
    if (rok !== undefined) await writeFile(path.join(dir, "pravila.json"), JSON.stringify({ zapiskiHrambaDni: rok }));
    return JSON.parse(JSON.stringify(await izmenjajSinhron(zTelefona([]), dir, { zdaj: () => ZDAJ }))) as Record<string, unknown>;
  };

  it("pogodba: polja in tipi odgovora pokrijejo vektor telefona", async () => {
    const v = JSON.parse(VEKTOR_TELEFONA) as Record<string, unknown>;
    const o = await odgovorZRokom(30);
    for (const kljuc of Object.keys(v)) assert.equal(typeof o[kljuc], typeof v[kljuc], kljuc);
    assert.equal(o.rokHrambeDni, v.rokHrambeDni);
    assert.match(JSON.stringify(o), /"rokHrambeDni":30[,}]/);
  });

  it("vrednost je celo stevilo 1..3650 iz pravil (privzeto 90)", async () => {
    for (const [rok, pricakovano] of [[undefined, 90], [365, 365], [3651, 3650], [30.5, 31], [0, 90], ["abc", 90]] as const) {
      const o = await odgovorZRokom(rok);
      assert.equal(o.rokHrambeDni, pricakovano, `rok ${String(rok)}`);
      assert.ok(Number.isInteger(o.rokHrambeDni));
    }
  });

  it("neberljiva pravila (pokvarjen pravila.json): polja ni, telefon obdrzi zadnji znani rok (slepi pregled 21r #1)", async () => {
    const dir = await novaMapa();
    await writeFile(path.join(dir, "pravila.json"), "{ pokvarjen");
    const o = await izmenjajSinhron(zTelefona([]), dir, { zdaj: () => ZDAJ });
    assert.equal("rokHrambeDni" in o, false, JSON.stringify(o));
  });
});

describe("21r A3: racunalnik ne okrni zapisa, ki ga je telefon poslal v mejah (navzkrizno s telefonom 21t)", () => {
  // Zapisa izvoza telefona (dokaz-21t/*.json), sestavljena znova; vsota in velikost dokazeta, da je vektor bajt za bajtom isti.
  const zapis = (id: string, dolzine: number[], okrnjen: boolean) => JSON.stringify({
    id, casZacetka: 1_800_000_000_000, stevilka: "+99955501003", trajanjeS: 30, nujno: false, povzetek: "č".repeat(2000), nacin: "podjetje",
    klicatelj: "č".repeat(240), podjetje: "č".repeat(240), sporocilo: "č".repeat(2000), sporociloDobesedno: "č".repeat(6000), brezSporocilaRazlog: "č".repeat(2000),
    prepisPogovora: dolzine.map((n) => ({ govorec: "klicatelj", cas: 1_800_000_000_000, besedilo: "a".repeat(n) })), prepisOkrnjen: okrnjen,
  });
  const primeri = [
    { ime: "a3-zeleni (okrnjen na telefonu)", surovo: zapis("klic-meja-1", new Array(20).fill(1000), true), b: 46388, sha: "9524cb4a54110af1bf1103f39e1a806d904f768b967a85ca43188caa88f85e6a" },
    { ime: "a3b-meja (tocno do meje)", surovo: zapis("klic-meja-2", [...new Array(20).fill(1000), 654], false), b: 47101, sha: "7a68a6563f142e2fdc74159979c3b0a87d3cd504d7fca521814bc63d4e5f3971" },
  ];
  for (const p of primeri) {
    it(p.ime, () => {
      assert.equal(Buffer.byteLength(p.surovo), p.b);
      assert.equal(createHash("sha256").update(p.surovo).digest("hex"), p.sha);
      const poslan = JSON.parse(p.surovo) as KlicSinhron;
      const z = preveriZahtevo({ rev: 0, klici: [poslan], pogovor: [], navodila: null }, poslan.casZacetka);
      assert.equal(z.klici.length, 1);
      const k = z.klici[0];
      assert.equal(k.prepisPogovora?.length, poslan.prepisPogovora?.length);
      assert.equal(k.prepisOkrnjen, poslan.prepisOkrnjen);
      assert.equal(JSON.stringify(k), p.surovo);
    });
  }
});
