/**
 * Naloga 11, N2: streznik ob zagonu prebere zetona lupine (LINA_LUPINA_ZETON) in konca (LINA_KONCAJ_ZETON) v pomnilnik in ju odstrani
 * iz process.env, zato ju otroci (RSDO, docker, namestitve, skripte) ne podedujejo; skripta posodobitve dobi zeton konca samo izrecno.
 * Komentarji brez sumnikov.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { okoljeSkripte } from "./posodobitev.server.ts";
import { prevzemiZetone } from "./zetoni-lupine.server.ts";

const L = "l".repeat(48);
const K = "k".repeat(48);
const koren = path.join(import.meta.dirname, "../../..");

describe("N2: zetona nista v okolju streznika", () => {
  it("prevzem prebere oba zetona in ju odstrani iz okolja; drugi prevzem vrne iste vrednosti", () => {
    const env: NodeJS.ProcessEnv = { LINA_LUPINA_ZETON: L, LINA_KONCAJ_ZETON: K, HOME: "/h" };
    const kljuc = Symbol.for("lina.zetoni.lupine");
    delete (globalThis as Record<symbol, unknown>)[kljuc];
    assert.deepEqual(prevzemiZetone(env), { lupina: L, koncaj: K });
    assert.deepEqual(env, { HOME: "/h" });
    assert.deepEqual(prevzemiZetone(env), { lupina: L, koncaj: K });
    delete (globalThis as Record<symbol, unknown>)[kljuc];
  });

  it("otrok, zagnan brez env (kot rsdo, docker, namestitev), po prevzemu zetonov nima", () => {
    const kljuc = Symbol.for("lina.zetoni.lupine");
    delete (globalThis as Record<symbol, unknown>)[kljuc];
    process.env.LINA_LUPINA_ZETON = L;
    process.env.LINA_KONCAJ_ZETON = K;
    try {
      prevzemiZetone();
      const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.env.LINA_LUPINA_ZETON ?? '') + String(process.env.LINA_KONCAJ_ZETON ?? ''))"], { encoding: "utf8" });
      assert.equal(r.stdout, "");
      const r2 = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).filter((k) => /ZETON/.test(k))))"], { encoding: "utf8", env: { ...process.env } });
      assert.equal(r2.stdout, "[]", "tudi {...process.env} (posodobitev.server) jih nima");
    } finally {
      delete process.env.LINA_LUPINA_ZETON;
      delete process.env.LINA_KONCAJ_ZETON;
      delete (globalThis as Record<symbol, unknown>)[kljuc];
    }
  });

  it("skripta posodobitve: zeton konca samo izrecno, nikoli iz podedovanega okolja; zetona lupine nikoli", () => {
    assert.deepEqual(okoljeSkripte({ LINA_KONCAJ_ZETON: K, LINA_LUPINA_ZETON: L, HOME: "/h" }), { HOME: "/h", PATH: "/usr/bin:/bin" });
    assert.deepEqual(okoljeSkripte({ HOME: "/h" }, K), { HOME: "/h", LINA_KONCAJ_ZETON: K, PATH: "/usr/bin:/bin" });
  });

  it("vticnik ob zagonu prevzame zetona; koda streznika ju ne bere vec iz process.env", () => {
    const vticnik = readFileSync(path.join(koren, "server/plugins/lina-zagon.ts"), "utf8");
    assert.match(vticnik, /definePlugin\(\(nitroApp\) => \{\n(\s*\/\/.*\n)*\s*prevzemiZetone\(\);/, "prvi ukaz vticnika");
    assert.match(vticnik, /Symbol\.for\("lina\.zetoni\.lupine"\)/, "isti kljuc kot zetoni-lupine.server.ts");
    assert.match(vticnik, /delete process\.env\.LINA_LUPINA_ZETON;\n\s*delete process\.env\.LINA_KONCAJ_ZETON;/);
    const mapa = path.join(koren, "src/lib/lina");
    const krsitve = readdirSync(mapa).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "zetoni-lupine.server.ts")
      .filter((f) => /process\.env\.LINA_(LUPINA|KONCAJ)_ZETON|process\.env\[["']LINA_(LUPINA|KONCAJ)_ZETON/.test(readFileSync(path.join(mapa, f), "utf8")));
    assert.deepEqual(krsitve, []);
  });
});
