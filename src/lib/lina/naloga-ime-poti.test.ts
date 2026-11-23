/**
 * Poti, kjer osebna tajnica pove uporabnikovo ime (lastnik 21. 11. 2026: »Poklicali ste Tomaža«, nikoli »podjetje / osebo / organizacijo /
 * drustvo«): stavek odsotnosti brez imena nima osebka »Oseba«, vhod modela razumevanja nosi tozilnik in ne besede »osebo«. Imena izmisljena.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PREPOVEDANO_ZA_POKLICALI } from "./ime-tozilnik.ts";
import { konecVMs, odsotnostStavek } from "./odsotnost.ts";
import { sestaviVhod } from "./osebna-razumevanje.server.ts";

function jutri(): { zdaj: Date; konec: string } {
  const dan = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const zdajMs = konecVMs(`${dan}T10:00`, "Europe/Ljubljana");
  assert.ok(zdajMs !== null);
  return { zdaj: new Date(zdajMs), konec: `${dan}T15:00` };
}

describe("ime v osebnih poteh", () => {
  it("odsotnost brez imena: brez »Oseba«, velika zacetnica; z imenom imenovalnik (osebek)", () => {
    const { zdaj, konec } = jutri();
    const osnova = { nacinKlica: "osebna" as const, odsotnostVklop: true, odsotnostRazlog: "v službi", odsotnostDo: konec, odsotnostCasovniPas: "Europe/Ljubljana" };
    const brez = odsotnostStavek({ ...osnova, imeLastnika: "" }, zdaj);
    assert.match(brez, /^Je do petnajste ure v službi in zato ne more odgovoriti na klic\.$/);
    assert.doesNotMatch(brez, /oseb|podjetj|organizacij|društv/i);
    assert.match(odsotnostStavek({ ...osnova, imeLastnika: "Ana" }, zdaj), /^Ana je do petnajste ure v službi/);
    const brezRazloga = odsotnostStavek({ ...osnova, imeLastnika: "", odsotnostRazlog: "", odsotnostDo: "" }, zdaj);
    assert.ok(brezRazloga === "" || /^[A-ZČŠŽ]/.test(brezRazloga), brezRazloga);
    assert.doesNotMatch(brezRazloga, /oseb/i);
  });

  it("vhod modela razumevanja: ime v tozilniku, imenovalnik zraven, brez besede »osebo«", () => {
    const vhod = sestaviVhod("kdo je to", "Kaj naj sporočim?", { imeLastnika: "Tomaž", imeTozilnik: "Tomaža", stevilkaBesedno: "", izrek: "", zapisano: false });
    assert.match(vhod, /Klicatelj je poklical \(tozilnik\): Tomaža; imenovalnik: Tomaž/);
    assert.doesNotMatch(vhod, /osebo/i);
    assert.doesNotMatch(vhod, PREPOVEDANO_ZA_POKLICALI);
    const brezImena = sestaviVhod("kdo je to", "Kaj naj sporočim?", { imeLastnika: "", stevilkaBesedno: "", izrek: "", zapisano: false });
    assert.match(brezImena, /Klicatelj je poklical \(tozilnik\): \(ime ni podano\)\n/);
  });
});
