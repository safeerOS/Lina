// Pregled sklopa 0.2.13: regex NADZORNI v vprasanja-agentov.ts je imel PRAVE nevidne in smerne znake (U+200B..U+200F, U+202A..U+202E,
// U+2066..U+2069) namesto ubeznih zapisov - izvorna koda s skritimi znaki (Trojan Source). Vedenje cisto() mora ostati enako.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cisto } from "./vprasanja-agentov.ts";

const SKRITI = /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/u;

describe("vprasanja-agentov: brez skritih znakov v izvoru", () => {
  it("izvorna datoteka nima surovih nevidnih ali smernih znakov", () => {
    const izvor = readFileSync(new URL("./vprasanja-agentov.ts", import.meta.url), "utf8");
    const vrstice = izvor.split("\n").flatMap((v, i) => (SKRITI.test(v) ? [i + 1] : []));
    assert.ok(vrstice.length === 0, `skriti znaki v vrsticah ${vrstice.join(", ")}`);
  });

  it("cisto() odstrani vsako kodno tocko razreda in pusti sosednje", () => {
    const odstrani: number[] = [];
    for (let c = 0x0; c <= 0x08; c++) odstrani.push(c);
    for (let c = 0x0b; c <= 0x1f; c++) odstrani.push(c);
    odstrani.push(0x7f);
    for (let c = 0x200b; c <= 0x200f; c++) odstrani.push(c);
    for (let c = 0x202a; c <= 0x202e; c++) odstrani.push(c);
    for (let c = 0x2066; c <= 0x2069; c++) odstrani.push(c);
    for (const c of odstrani) assert.equal(cisto(`a${String.fromCodePoint(c)}b`), "ab", `U+${c.toString(16)}`);
    // meje razreda in obicajni znaki ostanejo (tab in nova vrstica nista v razredu)
    for (const c of [0x09, 0x0a, 0x200a, 0x2010, 0x2029, 0x202f, 0x2065, 0x206a, 0x20ac, 0x10d]) {
      assert.equal(cisto(`a${String.fromCodePoint(c)}b`), `a${String.fromCodePoint(c)}b`, `U+${c.toString(16)}`);
    }
    assert.equal(cisto("x\u001b[31mrdece\u001b[0my"), "xrdecey");
  });
});
