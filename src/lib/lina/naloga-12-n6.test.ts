/**
 * Naloga 12, #6 (slepi pregled 11): zetona lupine se iz okolja prevzameta ENKRAT (ob zagonu); kasnejsa vrednost v process.env (nalaganje
 * okolja, vticnik, orodje) zetona v pomnilniku ne prepise, iz okolja se samo odstrani. Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { prevzemiZetone, zetonKoncaja, zetonLupine } from "./zetoni-lupine.server.ts";

const L = "l".repeat(48);
const K = "k".repeat(48);
const X = "x".repeat(48);
const KLJUC = Symbol.for("lina.zetoni.lupine");
const ponastavi = () => { delete (globalThis as Record<symbol, unknown>)[KLJUC]; };

describe("#6: zeton prebran enkrat", () => {
  it("drugi prevzem z drugo vrednostjo v okolju vrne prvo vrednost in okolje pocisti", () => {
    ponastavi();
    try {
      assert.deepEqual(prevzemiZetone({ LINA_LUPINA_ZETON: L, LINA_KONCAJ_ZETON: K }), { lupina: L, koncaj: K });
      const env: NodeJS.ProcessEnv = { LINA_LUPINA_ZETON: X, LINA_KONCAJ_ZETON: X, HOME: "/h" };
      assert.deepEqual(prevzemiZetone(env), { lupina: L, koncaj: K });
      assert.deepEqual(env, { HOME: "/h" });
    } finally {
      ponastavi();
    }
  });

  it("zetonLupine/zetonKoncaja po zagonu ne bereta nove vrednosti iz process.env", () => {
    ponastavi();
    process.env.LINA_LUPINA_ZETON = L;
    process.env.LINA_KONCAJ_ZETON = K;
    try {
      assert.equal(zetonLupine(), L);
      process.env.LINA_LUPINA_ZETON = X;
      process.env.LINA_KONCAJ_ZETON = X;
      assert.equal(zetonLupine(), L);
      assert.equal(zetonKoncaja(), K);
      assert.equal(process.env.LINA_LUPINA_ZETON, undefined);
    } finally {
      delete process.env.LINA_LUPINA_ZETON;
      delete process.env.LINA_KONCAJ_ZETON;
      ponastavi();
    }
  });

  it("brez zetona ob zagonu: kasnejsa vrednost v okolju ne postane zeton", () => {
    ponastavi();
    try {
      assert.equal(prevzemiZetone({}).lupina, undefined);
      assert.equal(prevzemiZetone({ LINA_LUPINA_ZETON: X }).lupina, undefined);
    } finally {
      ponastavi();
    }
  });

  it("vticnik zagona prevzame samo enkrat in oznaci prevzem (isti kljuc)", () => {
    const vticnik = readFileSync(path.join(import.meta.dirname, "../../../server/plugins/lina-zagon.ts"), "utf8");
    assert.match(vticnik, /if \(!z\.prevzeto\)/);
    assert.match(vticnik, /z\.prevzeto = true/);
  });
});
