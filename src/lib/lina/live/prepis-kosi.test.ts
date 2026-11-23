import assert from "node:assert/strict";
import { test } from "node:test";
import { dodajKosPrepisa } from "./most.ts";

test("nov stavek z veliko zacetnico se ne zlepi z zadnjo besedo", () => {
  assert.equal(dodajKosPrepisa("Dober dan", "Ana Novak tukaj"), "Dober dan Ana Novak tukaj");
  assert.equal(dodajKosPrepisa("Hvala.", "Lep dan"), "Hvala. Lep dan");
  assert.equal(dodajKosPrepisa("Res?", "Ja"), "Res? Ja");
});

test("nadaljevanje besede, kos s presledkom in prvi kos ostanejo nespremenjeni", () => {
  assert.equal(dodajKosPrepisa("Dob", "er dan"), "Dober dan");
  assert.equal(dodajKosPrepisa("Dober", " Dan"), "Dober Dan");
  assert.equal(dodajKosPrepisa("", "Ana"), "Ana");
  // Za stevko ni presledka (enako kot telefon): narek stevilke se ne razbije.
  assert.equal(dodajKosPrepisa("stevilka 041", "A"), "stevilka 041A");
  assert.equal(dodajKosPrepisa("Šola", "Čas"), "Šola Čas");
});
