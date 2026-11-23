import assert from "node:assert/strict";
import test from "node:test";
import { en2, sl2, t2 } from "./besedila.ts";

test("sl in en imata natanko iste kljuce in nobeno besedilo ni prazno", () => {
  assert.deepEqual(Object.keys(en2).sort(), Object.keys(sl2).sort());
  for (const [k, v] of Object.entries(sl2)) assert.ok(v.trim() !== "", `sl: ${k}`);
  for (const [k, v] of Object.entries(en2)) assert.ok(v.trim() !== "", `en: ${k}`);
});

test("t2 je privzeto slovensko in vrne anglesko na zahtevo", () => {
  assert.equal(t2("navTelefon"), "Poveži telefon");
  assert.equal(t2("navTelefon", "en"), "Connect phone");
});
