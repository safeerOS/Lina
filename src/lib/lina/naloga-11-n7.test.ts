/**
 * Naloga 11, N7: prisilni konec streznika na Windows (taskkill po PID) samo, ce proces se tece - tudi otrok, ki ga je ubil signal
 * (exitCode null, signalCode nastavljen), ni vec ziv in njegov PID je lahko ze tuj. Izid taskkill gre v dnevnik. Platforma je lazna.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

type Otrok = { pid?: number; exitCode: number | null; signalCode?: string | null; kill(s: string): unknown };
type Zazeni = (ukaz: string, arg: string[], moznosti: object, cb: (napaka: (Error & { code?: unknown }) | null) => void) => unknown;
const zahtevaj = createRequire(import.meta.url);
const { prisilniKonec } = zahtevaj("../../../lupina/pomocniki.js") as {
  prisilniKonec: (otrok: Otrok, platforma: string, zazeni?: Zazeni, dnevnik?: (vrstica: string) => void) => void;
};

describe("N7: taskkill samo za zivega otroka, izid v dnevnik", () => {
  it("otrok, ki ga je koncal signal (exitCode null, signalCode SIGTERM): brez taskkill in brez kill", () => {
    const klici: string[] = [];
    const signali: string[] = [];
    prisilniKonec({ pid: 4321, exitCode: null, signalCode: "SIGTERM", kill: (s) => signali.push(s) }, "win32", (u) => klici.push(u));
    prisilniKonec({ pid: 4321, exitCode: null, signalCode: "SIGTERM", kill: (s) => signali.push(s) }, "linux", (u) => klici.push(u));
    assert.equal(klici.length, 0);
    assert.equal(signali.length, 0);
  });

  it("izid taskkill (uspeh in napaka) gre v dnevnik s PID", () => {
    const vrstice: string[] = [];
    prisilniKonec({ pid: 4321, exitCode: null, signalCode: null, kill: () => undefined }, "win32", (_u, _a, _m, cb) => cb(null), (v) => vrstice.push(v));
    prisilniKonec({ pid: 4322, exitCode: null, signalCode: null, kill: () => undefined }, "win32", (_u, _a, _m, cb) => cb(Object.assign(new Error("ni procesa"), { code: 128 })), (v) => vrstice.push(v));
    assert.equal(vrstice.length, 2, JSON.stringify(vrstice));
    assert.match(vrstice[0]!, /taskkill.*4321.*uspeh/);
    assert.match(vrstice[1]!, /taskkill.*4322.*napaka.*128/);
  });
});
