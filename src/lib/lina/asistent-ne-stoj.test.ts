// Pravilo lastnika (21. 11. 2026): Lina ne sme cakati ali stati, ce ima delo; varnostna pravila ostanejo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NAVODILO_ASISTENTA, sestaviAsistenta } from "./asistent-pogovor.server.ts";

test("navodilo asistentke vsebuje pravilo ne stoj in ne cakaj", () => {
  assert.match(NAVODILO_ASISTENTA, /Ne stoj in ne čakaj/);
  assert.match(NAVODILO_ASISTENTA, /v ISTEM odgovoru/);
  assert.match(NAVODILO_ASISTENTA, /naj začnem\?/);
  assert.match(NAVODILO_ASISTENTA, /ovire ne vračaš lastniku/);
});

test("pravilo ne stoj ne razveljavi varnosti", () => {
  assert.match(NAVODILO_ASISTENTA, /Pred pošiljanjem e-pošte, brisanjem datotek/);
  assert.match(NAVODILO_ASISTENTA, /ne trdiš, da si naredila, česar nisi/);
  assert.match(NAVODILO_ASISTENTA, /izrecne potrditve/);
});

test("sistemsko navodilo gre v model skupaj s pravilom", () => {
  const vhod = sestaviAsistenta([], "Pozdravljena", undefined, undefined);
  assert.ok(vhod.system.includes("Ne stoj in ne čakaj"));
});
