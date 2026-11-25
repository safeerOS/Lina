/**
 * Naloga 11, N5: samodejno ciscenje koncanih nalog orkestratorja. Cas »posodobljeno« v prihodnosti ali neberljiv ne steje kot novejsi
 * (sicer podtaknjene naloge izrinejo prave), dnevnik dejanj se ob ciscenju arhivira (orkestrator/arhiv/), ne brise.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { podpisStanja, ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n11-n5-"));
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
const koncni: KlicModela = async () => ({ ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });
const DAN = 24 * 60 * 60_000;

/** Koncana naloga s podanim casom posodobitve (podpisana, kot bi jo zapisala Lina). */
async function koncana(root: string, posodobljeno: string): Promise<string> {
  const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
  const n = await o.nova({ cilj: "x" });
  const pot = path.join(root, "orkestrator", `${n.id}.json`);
  const s = JSON.parse(await readFile(pot, "utf8")) as Record<string, unknown>;
  Object.assign(s, { faza: "koncano", posodobljeno });
  await writeFile(pot, JSON.stringify({ ...s, podpis: await podpisStanja(root, s) }), { mode: 0o600 });
  return n.id;
}

describe("N5: ciscenje koncanih nalog", () => {
  it("50 nalog s casom v prihodnosti in neberljivim casom ne izrine prave koncane naloge", async () => {
    const root = await mapa();
    const prava = await koncana(root, new Date(Date.now() - 60_000).toISOString());
    for (let i = 0; i < 49; i++) await koncana(root, "9999-12-31T00:00:00.000Z");
    await koncana(root, "ni datum");
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nova({ cilj: "nova naloga sprozi ciscenje" });
    assert.ok(await o.preberi(prava), "prava koncana naloga ostane");
  });

  it("naloga s casom malo v prihodnosti (ura premaknjena nazaj) ni stara: ob manj kot 50 koncanih ostane", async () => {
    const root = await mapa();
    const id = await koncana(root, new Date(Date.now() + 5000).toISOString());
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    await o.nova({ cilj: "nova naloga sprozi ciscenje" });
    assert.ok(await o.preberi(id), "ni pociscena samo zaradi casa v prihodnosti");
  });

  it("dnevnik dejanj stare naloge se ob ciscenju premakne v arhiv (vsebina ohranjena), stanje se izbrise", async () => {
    const root = await mapa();
    const t0 = Date.parse("2026-10-01T10:00:00.000Z");
    const o1 = ustvariOrkestrator(root, { ...brez, klicModela: koncni, zdaj: () => t0 });
    const n = await o1.nova({ cilj: "stara naloga" });
    assert.equal((await o1.teci(n.id)).faza, "koncano");
    const dnevnik = path.join(root, "orkestrator", `${n.id}.dnevnik.jsonl`);
    const prej = await readFile(dnevnik, "utf8");
    const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni, zdaj: () => t0 + 31 * DAN });
    await o2.nova({ cilj: "nova" });
    assert.equal(await o2.preberi(n.id), null, "stara naloga je pociscena");
    assert.equal((await readdir(path.join(root, "orkestrator"))).includes(`${n.id}.dnevnik.jsonl`), false);
    assert.equal(await readFile(path.join(root, "orkestrator", "arhiv", `${n.id}.dnevnik.jsonl`), "utf8"), prej);
  });
});
