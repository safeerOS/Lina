/**
 * Naloga 11, N8: vse akcije v VSEH tokovih .github/workflows/*.yml (tudi gradnja.yml za APK) pripete na celoten sha z oznako
 * razlicice v komentarju; ista akcija ima v vseh tokovih isti sha. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const mapa = path.join(import.meta.dirname, "../../../.github/workflows");
const tokovi = readdirSync(mapa).filter((f) => /\.ya?ml$/.test(f));
const uses = (t: string) => [...t.matchAll(/^\s*(?:- )?uses: (\S+)(.*)$/gm)].map((m) => ({ ref: m[1]!, opomba: m[2]!.trim() }));

describe("N8: akcije v vseh tokovih pripete na sha", () => {
  it("najdeni so vsi tokovi, tudi gradnja.yml", () => {
    assert.ok(tokovi.includes("gradnja.yml") && tokovi.includes("racunalnik.yml") && tokovi.includes("windows.yml"), tokovi.join(","));
  });

  for (const f of tokovi) {
    it(`${f}: vsaka akcija @<40 hex> # vX.Y.Z`, () => {
      for (const u of uses(readFileSync(path.join(mapa, f), "utf8"))) {
        if (u.ref.startsWith("./")) continue; // lokalna akcija v repozitoriju
        assert.match(u.ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: ${u.ref}`);
        assert.match(u.opomba, /^# v\d+\.\d+\.\d+$/, `${f}: ${u.ref}`);
      }
    });
  }

  it("ista akcija ima v vseh tokovih isti sha", () => {
    const shaji = new Map<string, Set<string>>();
    for (const f of tokovi) for (const u of uses(readFileSync(path.join(mapa, f), "utf8"))) {
      const [ime, sha] = u.ref.split("@");
      shaji.set(ime!, (shaji.get(ime!) ?? new Set()).add(sha!));
    }
    for (const [ime, s] of shaji) assert.equal(s.size, 1, `${ime}: ${[...s].join(", ")}`);
  });
});
