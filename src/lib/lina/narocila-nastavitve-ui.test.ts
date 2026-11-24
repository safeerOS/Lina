/**
 * Nastavitve > Narocila podjetja: streznik funkciji (seja lastnika, skupni modul dovoljenj), podokno, besedila sl/en in komponenta
 * (izbira mape, Uvozi, potrditev z »Velja tudi za vse podobne« privzeto obkljukano, stevilo narocil, opozorila).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { en, sl } from "./besedila.ts";
import { enN, slN } from "./besedila-narocila.ts";
import { NASTAVITVE } from "./podokna-definicije.ts";

const SRC = path.resolve(import.meta.dirname, "..", "..");
const beri = (p: string) => readFileSync(path.join(SRC, p), "utf8");

describe("Nastavitve > Narocila podjetja", () => {
  it("functions.ts: stanje in uvoz gresta prek seje lastnika v uvoziNarocilaLastnik/stanjeNarocil", () => {
    const f = beri("lib/lina/functions.ts");
    const uvoz = f.slice(f.indexOf("export const uvoziNarocilaFn"), f.indexOf("export const uvoziNarocilaFn") + 700);
    assert.match(uvoz, /createServerFn\(\{ method: "POST" \}\)/);
    assert.match(uvoz, /uvoziNarocilaLastnik\(await sessionToken\(\), \{ mapa: data\?\.mapa, potrjeno: data\?\.potrjeno, podobne: data\?\.podobne \}\)/);
    const stanje = f.slice(f.indexOf("export const stanjeNarocilFn"), f.indexOf("export const stanjeNarocilFn") + 400);
    assert.match(stanje, /stanjeNarocil\(await sessionToken\(\)\)/);
  });

  it("podokno »narocila« z razdelkom nast-narocila je v tabeli in v lina-desk.tsx; oznaka v sl in en", () => {
    assert.ok(NASTAVITVE.podokna.some((p) => p.id === "narocila" && p.oznaka === "nastPodNarocila" && p.razdelki.includes("nast-narocila")));
    const desk = beri("components/lina-desk.tsx");
    assert.match(desk, /"nast-narocila": \(/);
    assert.match(desk, /<NarocilaNastavitve onError=\{onError\} \/>/);
    assert.ok(sl.nastPodNarocila && en.nastPodNarocila && sl.nastPodNarocila !== en.nastPodNarocila);
  });

  it("besedila narocil: enaki kljuci v sl in en, brez praznih", () => {
    assert.deepEqual(Object.keys(enN).sort(), Object.keys(slN).sort());
    for (const [k, v] of [...Object.entries(slN), ...Object.entries(enN)]) assert.ok(v.trim(), k);
  });

  it("komponenta: polje mape, gumb Uvozi, potrditev s »Velja tudi za vse podobne« (privzeto obkljukano), stevilo in opozorila", () => {
    const k = beri("components/narocila-nastavitve.tsx");
    assert.match(k, /id="narocila-mapa"/);
    assert.match(k, /uvoziNarocilaFn/);
    assert.match(k, /stanjeNarocilFn/);
    assert.match(k, /useState\(true\)/); // podobne privzeto obkljukano
    assert.match(k, /tD\("izbira"\)/);
    assert.match(k, /potrjeno: true, podobne/);
    assert.match(k, /tN\("stevilo"\)/);
    assert.match(k, /tN\("opozorila"\)/);
    // brez nevarnih vzorcev vmesnika
    assert.doesNotMatch(k, /dangerouslySetInnerHTML/);
  });
});
