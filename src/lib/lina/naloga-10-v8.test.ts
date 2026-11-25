/**
 * Naloga 10, V8 (ostanek naloge 9): racunalnik.yml (gradnja deb) namesti jazz-paket in lupino z zaklenjenimi odvisnostmi
 * (npm ci iz package-lock.json v repozitoriju), enako kot windows.yml po 9bc8696. Skladnost lock datotek preverja naloga-9-v8.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const beri = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** Koraki toka kot besedilo: ime koraka -> blok do naslednjega koraka. */
function korak(tok: string, imeKoraka: string): string {
  const i = tok.indexOf(`- name: ${imeKoraka}`);
  assert.ok(i >= 0, `korak »${imeKoraka}« manjka`);
  const j = tok.indexOf("\n      - name:", i + 1);
  return tok.slice(i, j < 0 ? undefined : j);
}

describe("V8: racunalnik.yml z zaklenjenimi odvisnostmi", () => {
  const tok = beri("../../../.github/workflows/racunalnik.yml");

  it("nobenega »npm install« v toku; jazz-paket in lupina z npm ci", () => {
    assert.doesNotMatch(tok.split("\n").filter((v) => !v.trim().startsWith("#")).join("\n"), /npm install\b/);
    const jazz = korak(tok, "Paket modulov");
    assert.match(jazz, /working-directory: jazz-paket/);
    assert.match(jazz, /npm ci --omit=dev --no-audit --no-fund/);
    assert.doesNotMatch(jazz, /> *jazz-paket\/package\.json|echo .*package\.json/, "package.json iz repozitorija, ne ustvarjen v toku");
    const lupina = korak(tok, "Namestitev lupine");
    assert.match(lupina, /working-directory: lupina/);
    assert.match(lupina, /npm ci --no-audit --no-fund/);
  });

  it("sprememba jazz-paket sprozi gradnjo deb", () => {
    assert.match(tok, /^\s*- "jazz-paket\/\*\*"$/m);
  });
});
