/**
 * Naloga 14 (25. 11. 2026, lastnikov posnetek ob 04:06: »Dober večer!« in misel »Jutro«): pozdrav po ljubljanski uri
 * (0-5 noc, 5-10 jutro, 10-17 dan, 17-24 vecer) iz istega vira kot misel dneva; izklopljena misel = ni kartice;
 * drobno besedilo na Domovu >= 13 px; okno odgovora ne sega cez desni stolpec. Komentarji so brez sumnikov.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { delDneva, delPozdrava, kljucDneva } from "../../lib/lina/motivacija.ts";

// Ljubljana: pozimi UTC+1, poleti UTC+2.
const zima = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 25, h - 1, m));
const poletje = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 15, h - 2, m));

test("pozdrav po ljubljanski uri, z vbrizgano uro (tudi ob 04:06 s posnetka)", () => {
  assert.equal(delPozdrava(zima(4, 6)), "noc");
  assert.equal(delPozdrava(new Date(Date.UTC(2026, 10, 24, 23, 0))), "noc"); // 00:00
  assert.equal(delPozdrava(zima(4, 59)), "noc");
  assert.equal(delPozdrava(zima(5, 0)), "jutro");
  assert.equal(delPozdrava(zima(9, 59)), "jutro");
  assert.equal(delPozdrava(zima(10, 0)), "dan");
  assert.equal(delPozdrava(zima(16, 59)), "dan");
  assert.equal(delPozdrava(zima(17, 0)), "vecer");
  assert.equal(delPozdrava(zima(23, 59)), "vecer");
  assert.equal(delPozdrava(poletje(4, 59)), "noc");
  assert.equal(delPozdrava(poletje(17, 0)), "vecer");
  // drug pas samo ob izrecni zahtevi
  assert.equal(delPozdrava(zima(17, 0), "UTC"), "dan");
});

test("en vir ure: vecerni pozdrav natanko tedaj, ko je misel vecerna; privzeti pas je ljubljanski, ne pas sistema", () => {
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 59]) {
      const t = zima(h, m);
      assert.equal(delPozdrava(t) === "vecer", delDneva(t) === "vecer", `ura ${h}:${m}`);
    }
  }
  assert.equal(delDneva(zima(17, 0)), "vecer");
  assert.equal(delDneva(zima(16, 59)), "jutro");
  assert.equal(kljucDneva(new Date(Date.UTC(2026, 10, 24, 23, 30))), "2026-11-25"); // 00:30 v Ljubljani
});

const beri = (pot: string) => readFileSync(new URL(pot, import.meta.url), "utf8");

test("Domov: pozdrav iz delPozdrava (ne iz ure sistema), besedilo za noc v sl in en", () => {
  const domov = beri("./domov.tsx");
  assert.doesNotMatch(domov, /getHours\(\)/);
  assert.match(domov, /POZDRAV\[delPozdrava\(zdaj\)\]/);
  const besedila = beri("../../lib/lina/besedila.ts");
  assert.equal(besedila.match(/\n {2}d2LahkoNoc: "/g)?.length, 2);
});

test("izklopljena misel dneva: kartica vrne null; vklop je v Nastavitvah", () => {
  const mediji = beri("./mediji.tsx");
  const kartica = mediji.slice(mediji.indexOf("export function MotivacijaBesedilo"));
  const telo = kartica.slice(0, kartica.indexOf("\n}\n"));
  assert.match(telo, /if \(pogled && !pogled\.nastavitve\.vklopljena\) return null;/);
  assert.match(telo, /<aside className="lina-karta lina-majhni">/, "ovoj kartice je v komponenti, da ga izklop lahko skrije");
  assert.doesNotMatch(beri("./domov.tsx"), /lina-majhni/);
  assert.match(beri("../lina-desk.tsx"), /<MotivacijaStikalo razred=\{IZBIRA\} \/>/);
});

test("lina2.css: okno odgovora samo cez stolpca 1-2, drobno besedilo Domova >= 13 px", () => {
  const css = beri("./lina2.css");
  const pravilo = (sel: string) => {
    const i = css.indexOf(`\n${sel} {`);
    assert.ok(i >= 0, sel);
    return css.slice(i, css.indexOf("}", i));
  };
  assert.match(pravilo(".lina-odgovor"), /grid-column: 1 \/ 3;/);
  for (const sel of [".lina-karta-datum", ".lina-zadnji-cas", ".lina-zadnji-tel", ".lina-mot small", ".lina-mot-gumb"]) {
    const px = Number(/font-size: ([\d.]+)rem;/.exec(pravilo(sel))?.[1]) * 16;
    assert.ok(px >= 13, `${sel}: ${px} px`);
  }
});
