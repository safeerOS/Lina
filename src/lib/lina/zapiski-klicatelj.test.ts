import assert from "node:assert/strict";
import { test } from "node:test";
import { klicateljIzNaslova, klicateljIzVsebine, kljucStevilke } from "./zapiski.ts";

// Lastnik 22. 11. 2026: Lina prepozna sporocila istega klicatelja (isti postopek kot telefon, KlicateljiSkupineTest.kt).
test("ista stevilka v razlicnih zapisih da isti kljuc", () => {
  assert.equal(kljucStevilke("041 123 456"), "041123456");
  assert.equal(kljucStevilke("+386 41 123 456"), "041123456");
  assert.equal(kljucStevilke("00386-41-123-456"), "041123456");
  assert.equal(kljucStevilke("+43 699 12345"), "+4369912345");
  assert.equal(kljucStevilke("anonymous"), "");
});

test("kljuc iz glave zapiska; brez oznake iz naslova", () => {
  assert.equal(klicateljIzVsebine("# A\n<!-- lina-cas: 2026-11-11T06:45:00.000Z -->\n<!-- lina-klicatelj: st:041123456 -->\n"), "st:041123456");
  assert.equal(klicateljIzVsebine("# A\n<!-- lina-klicatelj: st:041 123 -->"), null);
  assert.equal(klicateljIzVsebine("# A"), null);
  assert.equal(klicateljIzNaslova("Ana Novak - 2026-11-11 07-45"), `ime:${encodeURIComponent("ana novak")}`);
  assert.equal(klicateljIzNaslova("+386 41 123 456 - 2026-11-11 07-45"), "st:041123456");
});
