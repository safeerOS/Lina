import assert from "node:assert/strict";
import { test } from "node:test";
import { NASLOV_PROJEKTOV, naslovObracuna, preberiProjekteRest, razberiObracun, razberiProjekteRest, razvrstiProjekte, samodejniProjekt } from "./google-projekti.ts";

const odg = (status: number, telo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => telo });

test("razbere aktivne projekte z veljavnim ID-jem", () => {
  const p = razberiProjekteRest({
    projects: [
      { projectId: "lina-glas-123", name: "Lina glas", lifecycleState: "ACTIVE" },
      { projectId: "BAD_ID", name: "x" },
      { projectId: "star-projekt-1", name: "Star", lifecycleState: "DELETE_REQUESTED" },
      { projectId: "brez-imena-1" },
    ],
  });
  assert.deepEqual(p, [
    { id: "lina-glas-123", ime: "Lina glas" },
    { id: "brez-imena-1", ime: "brez-imena-1" },
  ]);
  assert.deepEqual(razberiProjekteRest({}), []);
  assert.deepEqual(razberiProjekteRest(null), []);
});

test("obracun: true, false, prazen odgovor z imenom = brez, drugo = neznano", () => {
  assert.equal(razberiObracun({ name: "projects/a/billingInfo", billingEnabled: true }), true);
  assert.equal(razberiObracun({ name: "projects/a/billingInfo", billingEnabled: false }), false);
  assert.equal(razberiObracun({ name: "projects/a/billingInfo", projectId: "a" }), false);
  assert.equal(razberiObracun({ error: { code: 403 } }), null);
});

test("samodejna izbira samo, ko je odlocitev enoznacna", () => {
  assert.equal(samodejniProjekt([{ id: "a-1234", ime: "A", obracun: true }, { id: "b-1234", ime: "B", obracun: false }]), "a-1234");
  assert.equal(samodejniProjekt([{ id: "a-1234", ime: "A", obracun: true }, { id: "b-1234", ime: "B", obracun: true }]), null);
  assert.equal(samodejniProjekt([{ id: "a-1234", ime: "A", obracun: null }]), "a-1234");
  assert.equal(samodejniProjekt([{ id: "a-1234", ime: "A", obracun: false }]), null);
  assert.equal(samodejniProjekt([]), null);
});

test("razvrstitev: z obracunom, neznano, brez", () => {
  const r = razvrstiProjekte([
    { id: "c-1234", ime: "C", obracun: false },
    { id: "b-1234", ime: "B", obracun: null },
    { id: "a-1234", ime: "A", obracun: true },
  ]);
  assert.deepEqual(r.map((x) => x.id), ["a-1234", "b-1234", "c-1234"]);
});

test("REST: zeton v glavi, ne v naslovu; napaka obracuna ne izgubi projekta; napaka seznama da prazno", async () => {
  const klici: string[] = [];
  const f = async (url: string, init: RequestInit) => {
    klici.push(url);
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer ZETON");
    assert.ok(!url.includes("ZETON"));
    if (url === NASLOV_PROJEKTOV) return odg(200, { projects: [{ projectId: "lina-a-1", name: "A" }, { projectId: "lina-b-1", name: "B" }] });
    if (url === naslovObracuna("lina-a-1")) return odg(200, { name: "x", billingEnabled: true });
    return odg(403, { error: { code: 403 } });
  };
  const p = await preberiProjekteRest("ZETON", f);
  assert.deepEqual(p, [
    { id: "lina-a-1", ime: "A", obracun: true },
    { id: "lina-b-1", ime: "B", obracun: null },
  ]);
  assert.equal(klici.length, 3);
  assert.deepEqual(await preberiProjekteRest("ZETON", async () => odg(401, {})), []);
  assert.deepEqual(await preberiProjekteRest("ZETON", async () => { throw new Error("omrezje"); }), []);
  assert.throws(() => naslovObracuna("../x"));
});
