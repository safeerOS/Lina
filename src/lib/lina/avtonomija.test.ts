/**
 * Meja zaupanja avtonomije Line (lastnik 15. 11. 2026): pravila, prejemnike in predloge lahko spremeni samo seja lastnika. Zato
 * nobena pot od klicatelja, SMS, e-poste, spleta ali asistentke ne sme uvoziti modulov avtonomije; izjema je nujni.server.ts, ki sme
 * uvoziti SAMO bralno stikalo jeUstavljenoNujno (»ustavi vse« ustavi tudi nujno obvestilo in prevezavo). Preizkus bere izvorno kodo.
 * Dodatno: vsak javni ukaz zacne z requireOwner, besedila vmesnika imajo vse jezike (sl, en, de, es, fr, it) z enakimi kljuci, v vmesniku ni »TODO«.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { IZIDI, NACINI, PREPOVEDANA_OPRAVILA, RAZLOGI, VRSTE_OPRAVIL, DOVOLJENI_IZVORI } from "./avtonomija.ts";
import { besedilaA, slA, tA, type JezikA } from "./besedila-avtonomija.ts";

const KOREN_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function izvornaKoda(mapa: string, izhod: string[] = []): string[] {
  for (const ime of readdirSync(mapa)) {
    const pot = path.join(mapa, ime);
    if (statSync(pot).isDirectory()) izvornaKoda(pot, izhod);
    else if (/\.(ts|tsx)$/.test(ime) && !/\.test\.(ts|tsx)$/.test(ime) && ime !== "routeTree.gen.ts") izhod.push(pot);
  }
  return izhod;
}

const UVOZ = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']*avtonomija[^"']*)["']/g;

function uvozeniModuliAvtonomije(vir: string): string[] {
  return [...vir.matchAll(UVOZ)].map((m) => path.basename(m[1])).sort();
}

describe("uvozi modulov avtonomije", { concurrency: 1 }, () => {
  it("samo znani moduli uvazajo avtonomijo; klic, splet, asistentka in zivi tok je ne", () => {
    const datoteke = izvornaKoda(KOREN_SRC);
    assert.ok(datoteke.length > 50, "preizkus mora res prebrati izvorno kodo");
    const najdeno: Record<string, string[]> = {};
    for (const d of datoteke) {
      const rel = path.relative(KOREN_SRC, d).split(path.sep).join("/");
      if (/(^|\/)avtonomija[^/]*\.(ts|tsx)$/.test(rel) || /(^|\/)besedila-avtonomija(\.[a-z]{2})?\.ts$/.test(rel)) continue;
      const u = uvozeniModuliAvtonomije(readFileSync(d, "utf8"));
      if (u.length) najdeno[rel] = u;
    }
    assert.deepEqual(najdeno, {
      "components/lina-desk.tsx": ["avtonomija.tsx"],
      "lib/lina/functions.ts": ["avtonomija.server.ts"],
      "lib/lina/nujni.server.ts": ["avtonomija-stanje.server.ts"],
      "lib/lina/zagon.server.ts": ["avtonomija-izvedba.server.ts"],
    });
  });

  it("nujni.server.ts uvozi samo jeUstavljenoNujno; zagon samo zazeniAvtonomijo", () => {
    const nujni = readFileSync(path.join(KOREN_SRC, "lib/lina/nujni.server.ts"), "utf8");
    const uvozi = [...nujni.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*avtonomija[^"']*["']/g)].map((m) => m[1].trim());
    assert.deepEqual(uvozi, ["jeUstavljenoNujno"]);
    const zagon = readFileSync(path.join(KOREN_SRC, "lib/lina/zagon.server.ts"), "utf8");
    const z = [...zagon.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*avtonomija[^"']*["']/g)].map((m) => m[1].trim());
    assert.deepEqual(z, ["zazeniAvtonomijo"]);
  });

  it("odjemalski del (vmesnik) ne uvozi strezniskih modulov avtonomije", () => {
    const tsx = readFileSync(path.join(KOREN_SRC, "components/avtonomija.tsx"), "utf8");
    // `import type` se pri prevajanju izbrise; vrednostni uvoz streznikskega modula bi potegnil streznisko kodo v odjemalca.
    const vrednostni = [...tsx.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]).filter((i) => /\.server\.ts$|^node:/.test(i));
    assert.deepEqual(vrednostni, []);
  });

  it("avtonomija.server.ts izvozi natanko tri funkcije in vsaka zacne z requireOwner", () => {
    const vir = readFileSync(path.join(KOREN_SRC, "lib/lina/avtonomija.server.ts"), "utf8");
    const izvozi = [...vir.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|let|var)\s+(\w+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(izvozi, ["dnevnikAvtonomije", "stanjeAvtonomije", "ukazAvtonomije"]);
    for (const ime of izvozi) {
      const zacetek = vir.indexOf(`export async function ${ime}(`);
      assert.ok(zacetek >= 0, ime);
      const konec = vir.indexOf("\nexport ", zacetek + 10);
      const telo = vir.slice(vir.indexOf("{\n", zacetek) + 2, konec < 0 ? undefined : konec);
      const ro = telo.indexOf("await requireOwner(token, root);");
      assert.ok(ro >= 0, `${ime}: manjka requireOwner`);
      assert.match(telo.slice(0, ro), /^\s*const root = resolveDataDir\(dir\);\s*$/, `${ime}: pred requireOwner ni nicesar drugega`);
    }
  });

  it("funkcije streznika v functions.ts kazejo samo na tri izvozene funkcije", () => {
    const vir = readFileSync(path.join(KOREN_SRC, "lib/lina/functions.ts"), "utf8");
    const imena = [...vir.matchAll(/import\(["'][^"']*avtonomija\.server\.ts["']\)/g)].length + [...vir.matchAll(/\{([^}]*)\}\s*from\s*["'][^"']*avtonomija\.server\.ts["']/g)].length;
    assert.ok(imena >= 1);
    for (const f of ["stanjeAvtonomijeFn", "dnevnikAvtonomijeFn", "ukazAvtonomijeFn"]) assert.ok(vir.includes(f), f);
  });
});

describe("kode in besedila", { concurrency: 1 }, () => {
  it("prepovedana opravila niso med dovoljenimi; dovoljeni izvori nikoli ne vsebujejo vhoda z druge strani", () => {
    for (const p of PREPOVEDANA_OPRAVILA) assert.ok(!(VRSTE_OPRAVIL as readonly string[]).includes(p), p);
    for (const v of VRSTE_OPRAVIL) {
      for (const izvor of DOVOLJENI_IZVORI[v]) assert.ok(["urnik", "dogodek", "uporabnik"].includes(izvor), `${v}: ${izvor}`);
    }
    assert.deepEqual([...NACINI], ["izklopljeno", "potrditev", "samodejno"]);
  });

  it("vsi jeziki imajo enaka kljuca kot sl; vsak opravilo, nacin, izid, razlog in napaka ima besedilo v vseh jezikih", () => {
    const jeziki = Object.keys(besedilaA) as JezikA[];
    assert.deepEqual([...jeziki].sort(), ["de", "en", "es", "fr", "it", "sl"]);
    for (const j of jeziki) assert.deepEqual(Object.keys(besedilaA[j]).sort(), Object.keys(slA).sort(), j);
    const potrebni: string[] = [];
    for (const v of VRSTE_OPRAVIL) potrebni.push(`opravilo_${v}`, `opis_${v}`);
    for (const n of NACINI) potrebni.push(`nacin_${n}`);
    for (const i of IZIDI) potrebni.push(`izid_${i}`);
    for (const r of RAZLOGI) potrebni.push(`razlog_${r}`);
    for (const k of ["ukaz", "vrsta", "nacin", "iztek", "meja", "okno", "ura", "prejemnik", "prejemnik-ime", "prejemnik-obstaja", "prejemnik-polno", "predloga-prazna", "predloga-dolga", "predloga-znaki", "predloga-povezava", "denar", "predloga-polna", "povezava-neveljavna", "povezava-polna", "povezava-obstaja", "ni-najdeno", "stanje", "geslo", "ponastavi-ni"]) potrebni.push(`napaka_${k}`);
    potrebni.push("gesloPotrebno", "omejitevDosezena", "povzetekPovezava", "povzetekEposta", "povzetekStevilka");
    for (const k of potrebni) {
      for (const j of jeziki) {
        const b = tA(k, j);
        assert.ok(typeof b === "string" && b.trim().length > 0 && b !== k, `${j}: ${k}`);
      }
    }
    for (const j of jeziki) for (const [k, v] of Object.entries(besedilaA[j])) assert.ok(!/\bTODO\b|\bFIXME\b|lorem ipsum/.test(v), `${j}: ${k}`); // brez /i: v spanscini je »Todo« navadna beseda
    // prevod mora biti res prevod: v tujem jeziku je enakih besedil kot v slovenscini najvec peterica (oznake, kot je [link])
    for (const j of jeziki.filter((x) => x !== "sl")) {
      const enaka = Object.keys(slA).filter((k) => (besedilaA[j] as Record<string, string>)[k] === (slA as Record<string, string>)[k]);
      assert.ok(enaka.length <= 5, `${j}: neprevedeno ${enaka.join(", ")}`);
    }
  });

  it("v vmesniku ni »TODO« ali zacasnih besedil", () => {
    const tsx = readFileSync(path.join(KOREN_SRC, "components/avtonomija.tsx"), "utf8");
    assert.ok(!/TODO|FIXME|lorem ipsum|placeholder text/i.test(tsx));
  });
});
