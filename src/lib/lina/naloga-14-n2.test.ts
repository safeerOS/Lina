/**
 * Naloga 14 N2 (slepi pregled 12): indeks verzij nalog (orkestrator/indeks.json) se ob napaki ali neveljavnem podpisu ne sme tiho
 * izprazniti, sicer stara podpisana kopija stanja velja in se nadaljuje, prvi zapis pa indeks trajno prepise.
 * - preberi doda prebrano (podpisano) verzijo v indeks v pomnilniku;
 * - ENOENT je locen od drugih napak: druga napaka branja ne izprazni indeksa (zavrnitev, nic se ne zapise);
 * - manjkajoc (ob obstojecih podpisanih stanjih) ali neveljaven indeks se zgradi iz najvisjih verzij veljavnih stanj, te naloge so
 *   samo za branje (oznaka se hrani v podpisanem indeksu) in vmesnik dobi opozorilo.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { podpisStanja, ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n14-n2-"));
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
const datoteka = (root: string, id: string) => path.join(root, "orkestrator", `${id}.json`);
const indeks = (root: string) => path.join(root, "orkestrator", "indeks.json");

function model(): { klicModela: KlicModela; n: () => number } {
  let n = 0;
  return { klicModela: async () => (n++, { ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" }), n: () => n };
}

/** Naloga A, koncana; na disku je nato njena STARA podpisana kopija (faza tece, verzija 1), kot bi jo vrnil napadalec. */
async function vrnjenaKopija(root: string): Promise<string> {
  const m = model();
  const o = ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela });
  const n = await o.nova({ cilj: "Poslji racun." });
  const stara = await readFile(datoteka(root, n.id), "utf8");
  assert.equal((await o.teci(n.id)).faza, "koncano");
  await writeFile(datoteka(root, n.id), stara);
  return n.id;
}

async function preveriSamoBranje(root: string, id: string): Promise<void> {
  const m = model();
  const o2 = ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela });
  assert.deepEqual(await o2.nadaljujPoZagonu(), [], "stara kopija se ne nadaljuje");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(m.n(), 0, "model ni poklican");
  const s = await o2.preberi(id);
  assert.equal(s?.faza, "tece", "vidna, a ...");
  assert.equal(s?.nepreverjeno, true, "... samo za branje");
  assert.equal(o2.indeksObnovljen(), true, "opozorilo v vmesniku");
  // prvi zapis (nova naloga) oznako shrani v podpisan indeks: po zagonu ostane
  const b = await o2.nova({ cilj: "Nova naloga." });
  const o3 = ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela });
  assert.equal((await o3.preberi(id))?.nepreverjeno, true, "po zagonu se vedno samo branje");
  assert.equal((await o3.preberi(b.id))?.nepreverjeno, undefined, "nova naloga ni oznacena");
  assert.equal(o3.indeksObnovljen(), true);
  // izbris nepreverjene: opozorilo izgine, kopija se ne vrne
  const kopija = await readFile(datoteka(root, id), "utf8");
  await o3.izbrisi(id);
  assert.equal(o3.indeksObnovljen(), false);
  await writeFile(datoteka(root, id), kopija);
  assert.equal(await ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela }).preberi(id), null, "kopija izbrisane se ne vrne");
}

describe("N2: indeks verzij ob napaki in neveljavnem podpisu", () => {
  it("izbrisan indeks + stara podpisana kopija: ne nadaljuje se, samo za branje, opozorilo", async () => {
    const root = await mapa();
    const id = await vrnjenaKopija(root);
    await unlink(indeks(root));
    await preveriSamoBranje(root, id);
  });

  it("indeks z napacnim podpisom + stara kopija: enako", async () => {
    const root = await mapa();
    const id = await vrnjenaKopija(root);
    const x = JSON.parse(await readFile(indeks(root), "utf8")) as Record<string, unknown>;
    await writeFile(indeks(root), JSON.stringify({ ...x, podpis: "0".repeat(64) }));
    await preveriSamoBranje(root, id);
  });

  it("pokvarjen indeks (ni JSON) + stara kopija: enako", async () => {
    const root = await mapa();
    const id = await vrnjenaKopija(root);
    await writeFile(indeks(root), "{");
    await preveriSamoBranje(root, id);
  });

  it("prehodna napaka branja indeksa (EISDIR) ne izprazni indeksa: zavrnitev, nic zapisano, po odpravi zascita velja", async () => {
    const root = await mapa();
    const id = await vrnjenaKopija(root);
    const shranjen = path.join(root, "indeks-shranjen.json");
    await rename(indeks(root), shranjen);
    await mkdir(indeks(root));
    const m = model();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela });
    await assert.rejects(o.seznam());
    await assert.rejects(o.nova({ cilj: "Nova naloga." }));
    await rename(indeks(root), path.join(root, "indeks-mapa"));
    await rename(shranjen, indeks(root));
    assert.equal(await o.preberi(id), null, "stara kopija zavrnjena z verzijo iz nespremenjenega indeksa");
    assert.equal(o.indeksObnovljen(), false);
  });

  it("preberi doda prebrano verzijo v indeks: zapis druge naloge ne zniza verzije prebrane", async () => {
    const root = await mapa();
    const m = model();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela });
    const a = await o.nova({ cilj: "Naloga A." });
    const kopija = await readFile(datoteka(root, a.id), "utf8");
    await o.teci(a.id);
    // prekinitev med zapisoma stanja in indeksa: indeks zaostaja (A: 1), stanje je novejse
    const telo = { verzije: { [a.id]: 1 } };
    await writeFile(indeks(root), JSON.stringify({ ...telo, podpis: await podpisStanja(root, telo, "orkestrator-indeks") }));
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela });
    assert.equal((await o2.preberi(a.id))?.faza, "koncano");
    await o2.nova({ cilj: "Naloga B." });
    await writeFile(datoteka(root, a.id), kopija);
    assert.equal(await ustvariOrkestrator(root, { ...brez, klicModela: m.klicModela }).preberi(a.id), null);
  });

  it("kontrola: prva uporaba brez indeksa in brez stanj - ni opozorila, nova naloga ni oznacena", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: model().klicModela });
    const n = await o.nova({ cilj: "Naloga." });
    assert.equal(o.indeksObnovljen(), false);
    assert.equal((await o.preberi(n.id))?.nepreverjeno, undefined);
  });

  it("vmesnik: opozorilo indeksa v sl in en, kartica ga prikaze", async () => {
    const { en, sl } = await import("./besedila.ts");
    assert.match(sl.orkIndeksObnovljen, /samo za branje/);
    assert.match(en.orkIndeksObnovljen, /read-only/);
    const kartica = await readFile(path.join(import.meta.dirname, "../../components/lina2/orkestrator-kartica.tsx"), "utf8");
    assert.match(kartica, /st\.indeksObnovljen \?[^\n]*orkIndeksObnovljen/);
    const streznik = await readFile(path.join(import.meta.dirname, "orkestrator.server.ts"), "utf8");
    assert.match(streznik, /indeksObnovljen: orkestrator\(dir\)\.indeksObnovljen\(\)/);
  });
});
