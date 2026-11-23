import assert from "node:assert/strict";
import { test } from "node:test";
import { stavekPotrditve } from "./eposta.ts";

// Lastnik 22. 11. 2026: »Za podjetja more Lina se prositi, da klicatelj poslje narocilo na elektronsko posto, ki jo podjetje vnese«.
test("podjetje: prosnja za narocilo po e-posti z izgovorjenim naslovom", () => {
  const s = stavekPotrditve({ potrditevEposta: true, potrditevNaslov: "info@primer.si", nacinKlica: "podjetje" });
  assert.equal(s, "Prosim, pošljite naročilo še po elektronski pošti na naslov info, afna, primer, pika, si.");
});

test("osebni nacin nikoli ne prosi za e-posto; brez veljavnega naslova ni prosnje", () => {
  assert.equal(stavekPotrditve({ potrditevEposta: true, potrditevNaslov: "info@primer.si", nacinKlica: "osebna" }), "");
  assert.equal(stavekPotrditve({ potrditevEposta: true, potrditevNaslov: "ni-naslov", nacinKlica: "podjetje" }), "");
  assert.equal(stavekPotrditve({ potrditevEposta: false, potrditevNaslov: "info@primer.si", nacinKlica: "podjetje" }), "");
});
