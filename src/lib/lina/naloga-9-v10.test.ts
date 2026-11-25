/**
 * Naloga 9, V10 (lupina): (1) prisilni konec streznika po 6 s na Windows ustavi CELO drevo (taskkill /pid <pid> /T /F, vzorec
 * tunel.server.ts in prijava-google.server.ts), sicer OpenLine, tunel in RSDO ostanejo brez starsa; (2) »lina-lupina --koncaj« zapre
 * Lino samo z zetonom, ki ga lupina da strezniku (LINA_KONCAJ_ZETON), ta pa samo skripti posodobitve. Platforma je lazna (win32):
 * na pravem Windows in v pravi Electron lupini NI preverjeno.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { okoljeSkripte } from "./posodobitev.server.ts";

const zahtevaj = createRequire(import.meta.url);
type Otrok = { pid?: number; exitCode: number | null; kill(s: string): unknown };
const { prisilniKonec, koncajDovoljen } = zahtevaj("../../../lupina/pomocniki.js") as {
  prisilniKonec: (otrok: Otrok, platforma: string, zazeni?: (ukaz: string, arg: string[], moznosti: object, cb: () => void) => unknown) => void;
  koncajDovoljen: (argv: string[], dodatno: unknown, zeton: string) => boolean;
};
const beri = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ZETON = "b".repeat(48);

function otrok(exitCode: number | null = null) {
  const signali: string[] = [];
  return { o: { pid: 4321, exitCode, kill: (s: string) => signali.push(s) }, signali };
}

describe("V10: prisilni konec streznika", () => {
  it("Windows: taskkill /pid <pid> /T /F (drevo), brez kill na otroku", () => {
    const { o, signali } = otrok();
    const klici: Array<[string, string[], object]> = [];
    prisilniKonec(o, "win32", (u, a, m, cb) => (klici.push([u, a, m]), cb()));
    assert.deepEqual(klici, [["taskkill", ["/pid", "4321", "/T", "/F"], { windowsHide: true }]]);
    assert.deepEqual(signali, []);
  });

  it("Linux: SIGKILL kot doslej, brez taskkill; koncan otrok: nic", () => {
    const { o, signali } = otrok();
    const klici: string[] = [];
    prisilniKonec(o, "linux", (u) => klici.push(u));
    assert.deepEqual(signali, ["SIGKILL"]);
    assert.equal(klici.length, 0); // deepEqual(klici, []) bi tip zozil na never[]
    const koncan = otrok(0);
    prisilniKonec(koncan.o, "win32", (u) => klici.push(u));
    assert.deepEqual(klici, []);
    assert.deepEqual(koncan.signali, []);
  });

  it("main.js: oba prisilna konca gresta skozi prisilniKonec, nobenega golega SIGKILL", () => {
    const m = beri("../../../lupina/main.js");
    assert.equal((m.match(/prisilniKonec\(s, process\.platform\)/g) ?? []).length, 2);
    assert.doesNotMatch(m, /kill\("SIGKILL"\)/);
  });
});

describe("V10: --koncaj samo z zetonom lastne lupine", () => {
  it("koncajDovoljen: samo --koncaj z enakim zetonom (dolzina >= 32)", () => {
    assert.equal(koncajDovoljen(["lina-lupina", "--koncaj"], { koncaj: ZETON }, ZETON), true);
    assert.equal(koncajDovoljen(["lina-lupina", "--koncaj"], {}, ZETON), false, "brez zetona (drug proces istega uporabnika)");
    assert.equal(koncajDovoljen(["lina-lupina", "--koncaj"], { koncaj: "c".repeat(48) }, ZETON), false);
    assert.equal(koncajDovoljen(["lina-lupina", "--koncaj"], { koncaj: ZETON.slice(1) }, ZETON), false);
    assert.equal(koncajDovoljen(["lina-lupina", "--koncaj"], null, ZETON), false);
    assert.equal(koncajDovoljen(["lina-lupina"], { koncaj: ZETON }, ZETON), false, "brez --koncaj ni konca");
    assert.equal(koncajDovoljen(["lina-lupina", "--koncaj"], { koncaj: "" }, ""), false, "prazen zeton nikoli");
  });

  it("main.js: zeton gre strezniku in drugi primerek ga poslje v additionalData; second-instance ga preveri", () => {
    const m = beri("../../../lupina/main.js");
    assert.match(m, /LINA_KONCAJ_ZETON: zetonKoncaja/);
    assert.match(m, /requestSingleInstanceLock\(\{ koncaj: process\.env\.LINA_KONCAJ_ZETON \|\| "" \}\)/);
    assert.match(m, /koncajDovoljen\(argv, dodatno, zetonKoncaja\)/);
  });

  it("streznik da zeton skripti posodobitve (seznam dovoljenega okolja), ostalo kot doslej", () => {
    // naloga 11 N2: zeton konca izrecno iz pomnilnika streznika, ne iz podedovanega okolja
    assert.deepEqual(okoljeSkripte({ LINA_LUPINA_ZETON: "x", HOME: "/h" }, ZETON), { LINA_KONCAJ_ZETON: ZETON, HOME: "/h", PATH: "/usr/bin:/bin" });
  });

  it("skripta: po --koncaj zeton odstrani, da ga nova Lina ne podeduje", () => {
    const s = beri("../../../scripts/lina-posodobi.sh");
    const koncaj = s.indexOf("/opt/Lina/lina-lupina --koncaj");
    const unset = s.indexOf("unset LINA_KONCAJ_ZETON");
    const zagon = s.indexOf("setsid /opt/Lina/lina-lupina");
    assert.ok(koncaj > 0 && unset > koncaj && zagon > unset, `${koncaj} ${unset} ${zagon}`);
  });
});
