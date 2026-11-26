/**
 * Naloga 17r2: racunalniski del najdb slepega pregleda 17t (slepi-17t/NAJDBE.md; pogodba POROCILO-17t-popravki.md »POGODBA ZA RACUNALNIK«).
 * N1: odgovor javi zmoznost prepis-v1 in znan klic brez prepisa dopolni s prepisom; N3: izbris klica s telefona izbrise zapis, prepis in mapo
 * klica in ga ne vrne vec; N4: podjetniski klic po roku izgubi tudi mapo, osebni ostane; N2: prevelik vnos v stanju ne ustavi sinhronizacije.
 * Zahteve gredo skozi preveriZahtevo iz JSON, kot ga zapise telefon (Kotlin encodeDefaults: prazen prepisPogovora, epoha null). Vrednosti izmisljene.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { MEJA_ODGOVORA_B, izmenjajSinhron, kliciTelefona, preveriZahtevo, type KlicSinhron } from "./sinhron-telefon.server.ts";

process.env.LINA_LLM = "0";
const KOREN = mkdtempSync(path.join(tmpdir(), "lina-n17r2-"));
process.on("exit", () => rmSync(KOREN, { recursive: true, force: true }));
const novaMapa = () => mkdtemp(path.join(KOREN, "d-"));

const CAS = Date.parse("2026-11-24T09:15:00.000Z");
const DAN = 86_400_000;
const klic = (id: string, extra: Partial<KlicSinhron> = {}): KlicSinhron => ({
  id, casZacetka: CAS, stevilka: "+38640111222", trajanjeS: 42, nujno: false, povzetek: "Miha Primer prosi za povratni klic.",
  nacin: "osebna", klicatelj: "Miha Primer", podjetje: "", sporocilo: "Naj ga poklicete nazaj.", sporociloDobesedno: "", brezSporocilaRazlog: "",
  prepisPogovora: [], prepisOkrnjen: false, ...extra,
});
const prepis = [
  { govorec: "lina", cas: CAS + 1000, besedilo: "Tukaj Lina, pomočnica z umetno inteligenco." },
  { govorec: "klicatelj", cas: CAS + 4000, besedilo: "Tukaj Miha, naj me pokliče nazaj." },
] as const;
/** Zahteva, kot jo zapise telefon (SinhronLine.zahteva, encodeDefaults = true). */
const zTelefona = (o: { rev?: number; epoha?: string | null; klici?: unknown[]; izbrisani?: string[] }) =>
  preveriZahtevo(JSON.parse(JSON.stringify({ rev: o.rev ?? 0, klici: o.klici ?? [], pogovor: [], navodila: null, epoha: o.epoha ?? null, izbrisani: o.izbrisani ?? [] })));
const bajti = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

async function mapeKlicev(dir: string): Promise<string[]> {
  try {
    return (await readdir(path.join(dir, "zapiski"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
const stanje = async (dir: string) => JSON.parse(await readFile(path.join(dir, "sinhron-telefon.json"), "utf8")) as { epoha: string; klici: Array<{ rev: number; k: KlicSinhron }> };

describe("17r2 N1: racunalnik sprejme prepis in to javi", () => {
  it("odgovor nosi zmoznosti prepis-v1 in izbris-v1", async () => {
    const o = await izmenjajSinhron(zTelefona({}), await novaMapa());
    assert.deepEqual([...((o as { zmoznosti?: string[] }).zmoznosti ?? [])].sort(), ["izbris-v1", "prepis-v1"]);
  });

  it("znan id brez prepisa (racunalnik 0.2.13) se ob ponovnem posiljanju dopolni s prepisom; ostala polja ostanejo", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1")] }), dir);
    const [mapa] = await mapeKlicev(dir);
    assert.ok(mapa, "mapa klica nastane ze brez prepisa");
    // telefon po posodobitvi racunalnika poslje isti id s prepisom (drug povzetek ne sme prepisati obstojecega)
    await izmenjajSinhron(zTelefona({ rev: 1, klici: [klic("klic-1", { prepisPogovora: [...prepis], povzetek: "PONAREJEN" })] }), dir);
    const k = (await stanje(dir)).klici.find((x) => x.k.id === "klic-1")!.k;
    assert.deepEqual(k.prepisPogovora, prepis);
    assert.equal(k.povzetek, "Miha Primer prosi za povratni klic.");
    // isti zapisek, ne nova mapa; v njem je zdaj prepis
    assert.deepEqual(await mapeKlicev(dir), [mapa]);
    const zapisek = await readFile(path.join(dir, "zapiski", mapa, "zapisek.md"), "utf8");
    assert.match(zapisek, /Tukaj Miha, naj me pokliče nazaj\./);
    // seznam (zaslon) kaze prepis
    assert.equal((await kliciTelefona(dir))[0].transcript.length, 2);
  });

  it("znan id, ki prepis ze ima, se ne prepise", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1", { prepisPogovora: [...prepis] })] }), dir);
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1", { prepisPogovora: [{ govorec: "klicatelj", cas: CAS, besedilo: "DRUGO" }] })] }), dir);
    assert.deepEqual((await stanje(dir)).klici[0].k.prepisPogovora, prepis);
  });

  it("dopolnitev ne vrne mape, ki jo je uporabnik izbrisal", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1")] }), dir);
    const [mapa] = await mapeKlicev(dir);
    await import("node:fs/promises").then((f) => f.rm(path.join(dir, "zapiski", mapa), { recursive: true }));
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1", { prepisPogovora: [...prepis] })] }), dir);
    assert.deepEqual(await mapeKlicev(dir), []);
    assert.deepEqual((await stanje(dir)).klici[0].k.prepisPogovora, prepis);
  });
});

describe("17r2 N3: izbris klica na telefonu izbrise zapis, prepis in mapo na racunalniku", () => {
  it("izbrisani id: ni ga v stanju, ne na seznamu, mapa klica je izbrisana; drugi klici ostanejo", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1", { prepisPogovora: [...prepis] }), klic("klic-2", { casZacetka: CAS + 60_000 })] }), dir);
    assert.equal((await mapeKlicev(dir)).length, 2);
    const o = await izmenjajSinhron(zTelefona({ rev: 2, izbrisani: ["klic-1"] }), dir);
    assert.ok((o as { zmoznosti?: string[] }).zmoznosti?.includes("izbris-v1"));
    assert.deepEqual((await stanje(dir)).klici.map((x) => x.k.id), ["klic-2"]);
    assert.deepEqual((await kliciTelefona(dir)).map((c) => c.callSid), ["s-telefona-klic-2"]);
    assert.equal((await mapeKlicev(dir)).length, 1);
    assert.doesNotMatch(JSON.stringify(await stanje(dir)), /Tukaj Miha/);
  });

  it("izbrisan klic se ne sprejme znova (drug telefon, star telefon) in se ne vrne ob novi epohi", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1")] }), dir);
    await izmenjajSinhron(zTelefona({ rev: 1, izbrisani: ["klic-1"] }), dir);
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1", { prepisPogovora: [...prepis] })] }), dir);
    assert.deepEqual((await stanje(dir)).klici, []);
    const o = await izmenjajSinhron(zTelefona({ rev: 0, epoha: "ffffffffffffffff" }), dir);
    assert.deepEqual(o.klici, []);
    assert.deepEqual(await mapeKlicev(dir), []);
  });

  it("v mapi klica je tudi uporabnikova datoteka: zapisek gre, mapa in uporabnikova datoteka ostaneta", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1")] }), dir);
    const [mapa] = await mapeKlicev(dir);
    await writeFile(path.join(dir, "zapiski", mapa, "moja-opomba.txt"), "moje");
    await izmenjajSinhron(zTelefona({ rev: 1, izbrisani: ["klic-1"] }), dir);
    assert.deepEqual((await readdir(path.join(dir, "zapiski", mapa))).sort(), ["moja-opomba.txt"]);
  });

  it("neveljaven id v seznamu izbrisanih ne podre zahteve; predolg seznam je zavrnjen", async () => {
    const z = zTelefona({ izbrisani: ["../zapiski", "klic-1", "x".repeat(200)] });
    assert.deepEqual((z as { izbrisani?: string[] }).izbrisani, ["klic-1"]);
    assert.throws(() => zTelefona({ izbrisani: Array.from({ length: 301 }, (_, i) => `k${i}`) }));
  });

  it("izbris-v1 se ne javi, ce mape klica ni bilo mogoce izbrisati (telefon izbris poslje znova)", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-1")] }), dir);
    await writeFile(path.join(dir, "sinhron-telefon-mape.json"), "{pokvarjeno");
    const o = await izmenjajSinhron(zTelefona({ rev: 1, izbrisani: ["klic-1"] }), dir);
    assert.equal((o as { zmoznosti?: string[] }).zmoznosti?.includes("izbris-v1"), false);
    assert.ok((o as { zmoznosti?: string[] }).zmoznosti?.includes("prepis-v1"));
  });
});

describe("17r2 N4: rok hrambe (osebni do izbrisa, podjetniski 90 dni) velja tudi za mapo klica", () => {
  it("podjetniski klic po roku: ni ga v stanju in mapa klica je izbrisana; osebni klic in njegova mapa ostaneta", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-p", { nacin: "podjetje", prepisPogovora: [...prepis] }), klic("klic-o", { prepisPogovora: [...prepis] })] }), dir);
    assert.equal((await mapeKlicev(dir)).length, 2);
    await izmenjajSinhron(zTelefona({ rev: 2 }), dir, { zdaj: () => CAS + 91 * DAN });
    assert.deepEqual((await stanje(dir)).klici.map((x) => x.k.id), ["klic-o"]);
    const mape = await mapeKlicev(dir);
    assert.equal(mape.length, 1);
    assert.doesNotMatch(await readFile(path.join(dir, "zapiski", mape[0], "zapisek.md"), "utf8"), /lina-nacin: podjetje/);
  });

  it("osebni klic po 400 dneh ostane (zapis, prepis in mapa)", async () => {
    const dir = await novaMapa();
    await izmenjajSinhron(zTelefona({ klici: [klic("klic-o", { prepisPogovora: [...prepis] })] }), dir);
    await izmenjajSinhron(zTelefona({ rev: 1 }), dir, { zdaj: () => CAS + 400 * DAN });
    assert.deepEqual((await stanje(dir)).klici[0].k.prepisPogovora, prepis);
    assert.equal((await mapeKlicev(dir)).length, 1);
  });
});

describe("17r2 N2: prevelik vnos ne ustavi sinhronizacije", () => {
  it("vnos nad mejo zapisa v stanju (star ali podtaknjen) gre brez prepisa z oznako okrnjenosti; odgovor pod 64 KiB", async () => {
    const dir = await novaMapa();
    const velik = Array.from({ length: 60 }, (_, i) => ({ govorec: "klicatelj" as const, cas: CAS + i, besedilo: "\u0001".repeat(2000) }));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "sinhron-telefon.json"), JSON.stringify({ epoha: "0123456789abcdef", rev: 2, klici: [{ rev: 1, k: klic("klic-v", { prepisPogovora: velik }) }, { rev: 2, k: klic("klic-2") }], pogovor: [], navodila: null }));
    const o = await izmenjajSinhron(zTelefona({ rev: 0, epoha: "0123456789abcdef" }), dir);
    assert.ok(bajti(o) < 64 * 1024, `odgovor ${bajti(o)} B`);
    assert.ok(bajti(o) <= MEJA_ODGOVORA_B + 1024);
    const v = o.klici.find((k) => k.id === "klic-v");
    assert.ok(v, "vnos ni izpuscen");
    assert.deepEqual(v.prepisPogovora, []);
    assert.equal(v.prepisOkrnjen, true);
  });

  it("vnos, ki je prevelik tudi brez prepisa, se preskoci, revizija pa gre naprej (brez zastoja)", async () => {
    const dir = await novaMapa();
    const ogromno = "\u0001".repeat(20_000);
    await writeFile(path.join(dir, "sinhron-telefon.json"), JSON.stringify({ epoha: "0123456789abcdef", rev: 2, klici: [{ rev: 1, k: klic("klic-v", { povzetek: ogromno }) }, { rev: 2, k: klic("klic-2") }], pogovor: [], navodila: null }));
    const o = await izmenjajSinhron(zTelefona({ rev: 0, epoha: "0123456789abcdef" }), dir);
    assert.ok(bajti(o) < 64 * 1024, `odgovor ${bajti(o)} B`);
    assert.deepEqual(o.klici.map((k) => k.id), ["klic-2"]);
    assert.equal(o.rev, 2);
    assert.equal(o.ostane, false);
  });
});
