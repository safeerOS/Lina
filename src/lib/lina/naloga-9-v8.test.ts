/**
 * Naloga 9, V8: windows.yml namesti jazz-paket in lupino z zaklenjenimi odvisnostmi (npm ci iz package-lock.json v repozitoriju),
 * ne z »npm install« (nezaklenjene prehodne odvisnosti v .exe). Lock jazz-paketa mora biti enak korenskemu (ime, razlicica,
 * integriteta, vir) - posodobitev korenskega locka (npr. unpdf) brez jazz-paketa preizkus ujame.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const beri = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
type Lock = { lockfileVersion: number; packages: Record<string, { version?: string; integrity?: string; resolved?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> };
const lock = (p: string) => JSON.parse(beri(p)) as Lock;
const ime = (p: string) => p.slice(p.lastIndexOf("node_modules/") + "node_modules/".length);

/** Koraki toka kot besedilo: ime koraka -> blok do naslednjega koraka. */
function korak(tok: string, imeKoraka: string): string {
  const i = tok.indexOf(`- name: ${imeKoraka}`);
  assert.ok(i >= 0, `korak »${imeKoraka}« manjka`);
  const j = tok.indexOf("\n      - name:", i + 1);
  return tok.slice(i, j < 0 ? undefined : j);
}

describe("V8: windows.yml z zaklenjenimi odvisnostmi", () => {
  const tok = beri("../../../.github/workflows/windows.yml");

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

  it("lock datoteke so v repozitoriju (lockfileVersion 3) in koren locka = package.json", () => {
    for (const mapa of ["jazz-paket", "lupina"]) {
      assert.ok(existsSync(new URL(`../../../${mapa}/package-lock.json`, import.meta.url)), mapa);
      const l = lock(`../../../${mapa}/package-lock.json`);
      const p = JSON.parse(beri(`../../../${mapa}/package.json`)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      assert.equal(l.lockfileVersion, 3);
      assert.deepEqual(l.packages[""]!.dependencies ?? {}, p.dependencies ?? {}, mapa);
      assert.deepEqual(l.packages[""]!.devDependencies ?? {}, p.devDependencies ?? {}, mapa);
      for (const [pot, v] of Object.entries(l.packages)) {
        if (!pot) continue;
        assert.match(v.resolved ?? "", /^https:\/\/registry\.npmjs\.org\//, pot);
        assert.match(v.integrity ?? "", /^sha512-/, pot);
      }
    }
    // neposredne odvisnosti natancne (brez ^ in ~), da lock ostane edini vir razlicic
    const jp = JSON.parse(beri("../../../jazz-paket/package.json")) as { dependencies: Record<string, string> };
    for (const [n, r] of Object.entries(jp.dependencies)) assert.match(r, /^\d+\.\d+\.\d+$/, n);
  });

  it("jazz-paket: vsak paket enak vnosu v korenskem locku (ime, razlicica, integriteta, vir)", () => {
    const koren = lock("../../../package-lock.json").packages;
    const jazz = lock("../../../jazz-paket/package-lock.json").packages;
    const vKorenu = new Map<string, Array<(typeof koren)[string]>>();
    for (const [p, v] of Object.entries(koren)) if (p) vKorenu.set(ime(p), [...(vKorenu.get(ime(p)) ?? []), v]);
    const razlike = Object.entries(jazz).filter(([p, v]) => p && !(vKorenu.get(ime(p)) ?? []).some((k) => k.version === v.version && k.integrity === v.integrity && k.resolved === v.resolved));
    assert.deepEqual(razlike.map(([p]) => p), []);
    for (const n of ["jazz-tools", "cojson", "cojson-transport-ws", "unpdf"]) assert.equal(jazz[`node_modules/${n}`]?.version, koren[`node_modules/${n}`]?.version, n);
  });
});
