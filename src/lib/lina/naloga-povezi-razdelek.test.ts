/**
 * Povezava telefona (lastnik 18. 11. 2026: »na racunalniku ne najdem QR kode, katero naj skeniram«). Zaslon »Poveži telefon«
 * (QR in 6-mestna koda) je bil vgrajen v polje za branje spletnih strani v razdelku Znanje, zato ga ni bilo mogoče najti.
 * Brez popravka padejo vsi trije preizkusi: razdelka Telefon ni, PoveziTelefon je v SpletPanel, besede uiTabTelefon ni.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en, sl } from "./besedila.ts";

const beri = (pot: string) => readFileSync(new URL(pot, import.meta.url), "utf8");
const telo = (vir: string, ime: string) => {
  const zacetek = vir.search(new RegExp(`\\n(?:export )?(?:async )?function ${ime}\\(`));
  assert.ok(zacetek >= 0, `funkcija ${ime} ne obstaja`);
  const naprej = vir.slice(zacetek + 1).search(/\n(?:export )?(?:async )?function /);
  return naprej < 0 ? vir.slice(zacetek) : vir.slice(zacetek, zacetek + 1 + naprej);
};

test("Poveži telefon je samostojen razdelek takoj za Klicem, ne del polja za splet", () => {
  const desk = beri("../../components/lina-desk.tsx");
  assert.match(desk, /\{ id: "klic", label: "uiTabKlic" \},\s*\{ id: "telefon", label: "uiTabTelefon" \}/);
  assert.match(desk, /tab === "telefon" \? \([\s\S]*?<PoveziTelefon onError=\{setError\} \/>/);
  assert.doesNotMatch(telo(desk, "SpletPanel"), /PoveziTelefon/);
  assert.match(beri("./ui-videz.ts"), /RazdelekLine =\s*"klic" \| "telefon"/);
});

test("napis razdelka Telefon je v slovenscini in anglescini", () => {
  assert.equal(sl.uiTabTelefon, "Telefon");
  assert.equal(en.uiTabTelefon, "Phone");
});
