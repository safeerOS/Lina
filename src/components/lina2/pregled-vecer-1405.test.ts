// Preizkusi slepega pregleda 24. 11. 2026 (samo v kopiji). Zagon s TZ=UTC pokaze odvisnost od casovnega pasu sistema.
process.env.TZ = "UTC"; // pas sistema UTC: brez tega preizkus v Ljubljani uspe tudi brez popravka
import assert from "node:assert/strict";
import test from "node:test";
import { besedila } from "../../lib/lina/besedila.ts";
import { datumInUra, uraGlave, casKlica } from "../../lib/lina/ui-videz.ts";
import { sl2, en2 } from "./besedila.ts";
import { besedilaDatotek } from "../../lib/lina/znanje-datoteke-besedila.ts";

// 24. 11. 2026 09:30 UTC = 10:30 v Ljubljani (CET)
const T = new Date("2026-11-24T09:30:00Z");

test("ura gradnje (ura) in ocena konca (uraGlave) v isti vrstici kazeta isti pas", () => {
  const ura = datumInUra(T, "en"); // Europe/Ljubljana
  const ocena = uraGlave(T, "en"); // pas sistema
  assert.match(ura, /10:30/);
  assert.equal(ocena, "10:30", `ocena konca v pasu sistema (${Intl.DateTimeFormat().resolvedOptions().timeZone}): ${ocena}`);
});

test("cas klica je v ljubljanskem casu", () => {
  assert.match(casKlica(T.toISOString(), "sl"), /10:30/);
});

test("vsak kljuc ima neprazen prevod v sl in en", () => {
  for (const [ime, a, b] of [["besedila", besedila.sl, besedila.en], ["lina2", sl2, en2], ["datoteke", besedilaDatotek.sl, besedilaDatotek.en]] as const) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    assert.deepEqual(ka.filter((k) => !kb.includes(k)), [], `${ime}: manjka v en`);
    assert.deepEqual(kb.filter((k) => !ka.includes(k)), [], `${ime}: manjka v sl`);
    for (const k of kb) assert.ok(String((b as Record<string, string>)[k]).trim(), `${ime}.en.${k} prazen`);
  }
});
