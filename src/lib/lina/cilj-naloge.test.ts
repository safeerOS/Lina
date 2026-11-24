/**
 * Cilj naloge agenta (zamisel iz DeerFlow »Session Goals«, MIT; koda ni prevzeta): po vsakem obratu ocena cilja odloci, ali
 * Lina nalogo nadaljuje sama, ali se ustavi in zakaj. Cisto pravilo, brez izvajalca.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAJVEC_NADALJEVANJ, NAJVEC_BREZ_NAPREDKA, odlociNadaljevanje, razberiOceno, zacetnoStanje } from "./cilj-naloge.ts";

test("nadaljuje samo ob 'cilj-se-ni-dosezen' z dokazom", () => {
  const s = zacetnoStanje();
  const o = razberiOceno('{"ovira":"cilj-se-ni-dosezen","dokaz":"test pade v vrstici 3"}')!;
  assert.deepEqual(odlociNadaljevanje(s, o, "izid A").odlocitev, { vrsta: "nadaljuj" });
});

test("potrebuje lastnika, zunanje cakanje, padec: nikoli samodejno naprej", () => {
  for (const ovira of ["potrebuje-lastnika", "zunanje-cakanje", "napaka-izvedbe", "manjka-dokaz"] as const) {
    const d = odlociNadaljevanje(zacetnoStanje(), { ovira, dokaz: "x" }, "izid").odlocitev;
    assert.deepEqual(d, { vrsta: "ustavi", razlog: ovira });
  }
});

test("dosezeno brez dokaza ni dosezeno", () => {
  assert.equal(razberiOceno('{"ovira":"dosezeno","dokaz":""}'), null);
  assert.deepEqual(odlociNadaljevanje(zacetnoStanje(), { ovira: "dosezeno", dokaz: "184 datotek, 0 padlih" }, "izid: 184 datotek, 0 padlih").odlocitev, { vrsta: "koncano" });
  // A8 (pregled RAC-A): dokaz, ki ga v izidu ni, ni dokaz
  assert.deepEqual(odlociNadaljevanje(zacetnoStanje(), { ovira: "dosezeno", dokaz: "184 datotek, 0 padlih" }, "izid").odlocitev, { vrsta: "ustavi", razlog: "manjka-dokaz" });
});

test("strop nadaljevanj in zavora brez napredka", () => {
  let s = zacetnoStanje();
  const o = { ovira: "cilj-se-ni-dosezen" as const, dokaz: "x" };
  for (let i = 0; i < NAJVEC_NADALJEVANJ; i++) s = odlociNadaljevanje(s, o, `izid ${i}`).stanje;
  assert.deepEqual(odlociNadaljevanje(s, o, "nov").odlocitev, { vrsta: "ustavi", razlog: "strop" });
  let t = zacetnoStanje();
  let d;
  for (let i = 0; i <= NAJVEC_BREZ_NAPREDKA; i++) ({ stanje: t, odlocitev: d } = odlociNadaljevanje(t, o, "isti izid"));
  assert.deepEqual(d, { vrsta: "ustavi", razlog: "brez-napredka" });
});

test("neveljavna ocena modela je null (nikoli nadaljevanje)", () => {
  for (const v of ["", "nadaljuj", '{"ovira":"nadaljuj","dokaz":"x"}', '{"ovira":"cilj-se-ni-dosezen"}', "[1]"]) assert.equal(razberiOceno(v), null);
});
