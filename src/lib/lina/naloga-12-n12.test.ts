/**
 * Naloga 12, #12 (slepi pregled 11): »potrjeno« z diska shema dosledno prezre (polje se ob branju odstrani, ne glede na vrednost ali
 * orodje); potrditev v pomnilniku (potrjeniVProcesu) se ob koncu naloge pocisti, da je ne porabi kasnejse (vrnjeno) stanje.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { OrodjeOrkestratorja } from "./orkestrator.ts";
import { nastaviOrkestrator, podpisStanja, ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";
import { odgovoriNaVprasanje, stanjeVprasanjZaRoot } from "./vprasanja-agentov.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n12-n12-"));
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
const koncni: KlicModela = async () => ({ ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });

async function cakaj(fn: () => Promise<boolean> | boolean, ms = 3000): Promise<void> {
  const konec = Date.now() + ms;
  while (Date.now() < konec) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("pogoj ni izpolnjen");
}

function poslji(stevec: { n: number }): OrodjeOrkestratorja {
  return {
    razred: "zunanje",
    definicija: { ime: "poslji", opis: "poslji", parametri: { type: "object", properties: { komu: { type: "string" } } } },
    izvedi: async () => (stevec.n++, { ok: true, rezultat: "poslano" }),
  };
}

/** Napadalec s kljucem: prepise in podpise stanje (preverba pravil, ki ne slonijo na podpisu). */
async function podpisiNaDisk(root: string, id: string, s: Record<string, unknown>): Promise<void> {
  s.podpis = await podpisStanja(root, s);
  await writeFile(path.join(root, "orkestrator", `${id}.json`), JSON.stringify(s), { mode: 0o600 });
}

describe("#12: potrjeno z diska in potrditev v pomnilniku", () => {
  for (const [opis, odprt] of [
    ["potrjeno z nebolovo vrednostjo", { id: "k1-1", ime: "poslji", argumenti: {}, potrjeno: "da" }],
    ["potrjeno pri neznanem orodju", { id: "k1-1", ime: "neznano", argumenti: {}, potrjeno: true }],
  ] as const) {
    it(`${opis}: stanje ostane veljavno, polje je prezrto (odstranjeno)`, async () => {
      const root = await mapa();
      const st = { n: 0 };
      const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni, orodja: [poslji(st)] });
      const n = await o.nova({ cilj: "Poslji." });
      const s = JSON.parse(await readFile(path.join(root, "orkestrator", `${n.id}.json`), "utf8")) as Record<string, unknown>;
      (s.sporocila as unknown[]).push({ vloga: "asistent", klici: [{ id: "k1-1", ime: odprt.ime, argumenti: {} }] });
      s.odprti = [odprt];
      await podpisiNaDisk(root, n.id, s);
      const p = await o.preberi(n.id);
      assert.ok(p, "stanje je veljavno");
      assert.equal("potrjeno" in p!.odprti[0]!, false);
    });
  }

  it("potrditev, ki je ostala ob ustavitvi naloge, ne velja za vrnjeno stanje (vprasanje znova)", async () => {
    const root = await mapa();
    await nastaviOrkestrator(true, root);
    const st = { n: 0 };
    let i = 0;
    const model: KlicModela = async () => (i++ === 0
      ? { ok: true, besedilo: "", klici: [{ id: "k1-1", ime: "poslji", argumenti: { komu: "A" } }], usage: null, razlogKonca: "orodja" }
      : { ok: true, besedilo: "Koncano.", klici: [], usage: null, razlogKonca: "konec" });
    const o = ustvariOrkestrator(root, { ...brez, klicModela: model, orodja: [poslji(st)] });
    const n = await o.nova({ cilj: "Poslji A." });
    assert.equal((await o.teci(n.id)).faza, "caka-potrditev");
    const kopija = JSON.parse(await readFile(path.join(root, "orkestrator", `${n.id}.json`), "utf8")) as Record<string, unknown>;
    // stikalo izklopljeno: lastnik potrdi, zanka nalogo ustavi brez izvedbe (potrditev v pomnilniku ostane)
    await nastaviOrkestrator(false, root);
    await cakaj(() => stanjeVprasanjZaRoot(root).vprasanja.some((v) => v.naloga === n.id && v.stanje === "caka"));
    const v = stanjeVprasanjZaRoot(root).vprasanja.find((x) => x.naloga === n.id && x.stanje === "caka")!;
    await odgovoriNaVprasanje(root, v.id, "dovoli", v.zgostitev, "lastnik");
    await cakaj(async () => (await o.preberi(n.id))?.faza === "ustavljeno");
    assert.equal(st.n, 0);
    // vrnjeno stanje (napadalec s kopijo, verzija ni ovira za ta preizkus) z istim odprtim klicem
    await nastaviOrkestrator(true, root);
    Object.assign(kopija, { faza: "tece", cakanje: null, verzija: 1_000_000 });
    delete kopija.podpis;
    await podpisiNaDisk(root, n.id, kopija);
    const s = await o.teci(n.id);
    assert.equal(st.n, 0, "orodje ni izvedeno brez nove potrditve");
    assert.equal(s.faza, "caka-potrditev");
  });
});
