import assert from "node:assert/strict";
import { test } from "node:test";
import { jeKoledarskaNamera, vprasanjeDneva } from "./koledar.ts";

// Napaka 21. 11. 2026: koledar.ts je uporabljal fold(), a ga ni uvozil (rekonstrukcija iz prevoda),
// zato je vsako vprasanje v Linin pogovor koncalo z »fold is not defined«.
test("vprasanjeDneva ne pade in prepozna vprasanje o sporedu", () => {
  assert.equal(vprasanjeDneva("Kaj imam danes na urniku in kaj naj naredim najprej?"), 0);
  assert.equal(vprasanjeDneva("Kaj imam jutri?"), 1);
  assert.equal(vprasanjeDneva("Kakšno vreme bo?"), null);
});

test("jeKoledarskaNamera ne pade in prepozna ukaz za opomnik", () => {
  assert.equal(jeKoledarskaNamera("Opomni me jutri ob 9 na zobozdravnika"), true);
  assert.equal(jeKoledarskaNamera("Kako si?"), false);
});
