/**
 * Naloga 12, #8 (slepi pregled 11): na Windows je kill("SIGTERM") TerminateProcess samo za streznik; ce je streznik ze koncan s
 * signalom, prisilniKonec taskkill /T ne poklice (PID je lahko tuj), mora pa v dnevnik zapisati, da so otroci (OpenLine, tunel, RSDO)
 * morda ostali brez starsa. Linux: brez vrstice (SIGTERM tam pospravi). Platforma je lazna. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

type Otrok = { pid?: number; exitCode: number | null; signalCode?: string | null; kill(s: string): unknown };
const zahtevaj = createRequire(import.meta.url);
const { prisilniKonec } = zahtevaj("../../../lupina/pomocniki.js") as {
  prisilniKonec: (otrok: Otrok, platforma: string, zazeni?: (...a: unknown[]) => unknown, dnevnik?: (vrstica: string) => void) => void;
};

describe("#8: trdi konec na Windows v dnevnik", () => {
  it("win32, streznik koncan s signalom: vrstica o otrocih brez starsa, brez taskkill", () => {
    const vrstice: string[] = [];
    const klici: unknown[] = [];
    prisilniKonec({ pid: 4321, exitCode: null, signalCode: "SIGTERM", kill: () => undefined }, "win32", (...a) => klici.push(a), (v) => vrstice.push(v));
    assert.equal(klici.length, 0);
    assert.equal(vrstice.length, 1);
    assert.match(vrstice[0]!, /4321/);
    assert.match(vrstice[0]!, /brez starsa/);
  });

  it("linux ali redni izhod (exitCode): brez vrstice", () => {
    const vrstice: string[] = [];
    prisilniKonec({ pid: 1, exitCode: null, signalCode: "SIGTERM", kill: () => undefined }, "linux", () => undefined, (v) => vrstice.push(v));
    prisilniKonec({ pid: 2, exitCode: 0, signalCode: null, kill: () => undefined }, "win32", () => undefined, (v) => vrstice.push(v));
    assert.deepEqual(vrstice, []);
  });
});
