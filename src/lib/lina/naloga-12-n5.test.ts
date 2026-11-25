/**
 * Naloga 12, #5 (slepi pregled 11): arhiv dnevnikov orkestratorja. Brez sledenja simbolni povezavi (arhiv mora biti prava mapa
 * lastnika), napaka sredi ciscenja ne izgubi dnevnika (najprej arhiv, sele nato izbris stanja), obstojec arhiviran dnevnik se ne
 * prepise, rocni izbris dnevnik tudi arhivira. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ustvariOrkestrator, type KlicModela } from "./orkestrator.server.ts";

const mapa = () => mkdtemp(path.join(tmpdir(), "lina-n12-n5-"));
const brez = { oceni: null, ucenje: null, imaGeslo: async () => true } as const;
const koncni: KlicModela = async () => ({ ok: true, besedilo: "Koncano z dokazom.", klici: [], usage: null, razlogKonca: "konec" });
const DAN = 24 * 60 * 60_000;
const T0 = Date.parse("2026-10-01T10:00:00.000Z");

/** Stara koncana naloga (z dnevnikom) in orkestrator 31 dni pozneje, ki jo pri novi nalogi pocisti. */
async function staraNaloga(root: string) {
  const o1 = ustvariOrkestrator(root, { ...brez, klicModela: koncni, zdaj: () => T0 });
  const n = await o1.nova({ cilj: "stara naloga" });
  assert.equal((await o1.teci(n.id)).faza, "koncano");
  const dnevnik = await readFile(path.join(root, "orkestrator", `${n.id}.dnevnik.jsonl`), "utf8");
  const o2 = ustvariOrkestrator(root, { ...brez, klicModela: koncni, zdaj: () => T0 + 31 * DAN });
  return { id: n.id, dnevnik, pocisti: () => o2.nova({ cilj: "nova" }), o2 };
}

describe("#5: arhiv dnevnikov", () => {
  it("arhiv kot simbolna povezava: dnevnik ne gre v tujo mapo, stanje in dnevnik ostaneta", { skip: process.platform === "win32" }, async () => {
    const root = await mapa();
    const tuja = await mapa();
    const n = await staraNaloga(root);
    await symlink(tuja, path.join(root, "orkestrator", "arhiv"));
    await n.pocisti();
    assert.deepEqual(await readdir(tuja), []);
    assert.equal(await readFile(path.join(root, "orkestrator", `${n.id}.dnevnik.jsonl`), "utf8"), n.dnevnik);
    assert.ok(await n.o2.preberi(n.id), "stanje ni izbrisano brez arhiva dnevnika");
  });

  it("arhiv kot navadna datoteka: napaka ne izbrise stanja in ne osiroti dnevnika", async () => {
    const root = await mapa();
    const n = await staraNaloga(root);
    await writeFile(path.join(root, "orkestrator", "arhiv"), "ni mapa");
    await n.pocisti();
    assert.ok(await n.o2.preberi(n.id));
    assert.equal(await readFile(path.join(root, "orkestrator", `${n.id}.dnevnik.jsonl`), "utf8"), n.dnevnik);
  });

  it("obstojec arhiviran dnevnik z istim imenom se ne prepise", async () => {
    const root = await mapa();
    const n = await staraNaloga(root);
    await mkdir(path.join(root, "orkestrator", "arhiv"), { mode: 0o700 });
    await writeFile(path.join(root, "orkestrator", "arhiv", `${n.id}.dnevnik.jsonl`), "staro\n");
    await n.pocisti();
    const arhiv = path.join(root, "orkestrator", "arhiv");
    assert.equal(await readFile(path.join(arhiv, `${n.id}.dnevnik.jsonl`), "utf8"), "staro\n");
    const vsebine = await Promise.all((await readdir(arhiv)).map((f) => readFile(path.join(arhiv, f), "utf8")));
    assert.ok(vsebine.includes(n.dnevnik), "novi dnevnik je v arhivu pod drugim imenom");
    assert.equal(await n.o2.preberi(n.id), null);
  });

  it("rocni izbris koncane naloge dnevnik arhivira", async () => {
    const root = await mapa();
    const o = ustvariOrkestrator(root, { ...brez, klicModela: koncni });
    const n = await o.nova({ cilj: "naloga" });
    await o.teci(n.id);
    const dnevnik = await readFile(path.join(root, "orkestrator", `${n.id}.dnevnik.jsonl`), "utf8");
    await o.izbrisi(n.id);
    assert.equal(await readFile(path.join(root, "orkestrator", "arhiv", `${n.id}.dnevnik.jsonl`), "utf8"), dnevnik);
  });
});
