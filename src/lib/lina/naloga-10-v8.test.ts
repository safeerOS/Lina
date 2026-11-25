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

describe("Naloga 10 (2): akcije v racunalnik.yml pripete na celoten sha, enako kot windows.yml", () => {
  const uses = (t: string) => [...t.matchAll(/^\s*- uses: (\S+)(.*)$/gm)].map((m) => ({ ref: m[1]!, opomba: m[2]!.trim() }));
  const deb = uses(beri("../../../.github/workflows/racunalnik.yml"));
  const win = new Map(uses(beri("../../../.github/workflows/windows.yml")).map((u) => [u.ref.split("@")[0], u.ref]));

  it("vsaka akcija @<40 hex> z oznako razlicice v komentarju, isti sha kot windows.yml", () => {
    assert.ok(deb.length >= 6);
    for (const u of deb) {
      assert.match(u.ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, u.ref);
      assert.match(u.opomba, /^# v\d+\.\d+\.\d+$/, u.ref);
      assert.equal(u.ref, win.get(u.ref.split("@")[0]), `${u.ref} enako kot windows.yml`);
    }
  });
});
