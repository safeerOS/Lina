// Naloga 34 (lastnik 26. 11. 2026): telefon razdeli nalogo med vec racunalnikov po obremenitvi. Racunalnik v PODPISANEM /stanje
// pove svojo obremenitev (5-min load, jedra, prost RAM) in ime; neznana vrednost se izpusti (nikoli 0 - telefon bi ga imel za praznega).
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Izvajalec } from "./asistent.server.ts";
import { AsistentStreznik, POT, potrdiloAsistenta } from "./asistent-streznik.server.ts";
import { idIzKljuca, nizStanja } from "./kanal-claude.ts";
import { pripraviKanal } from "./kanal-claude.server.ts";
import { obremenitevRacunalnika } from "./obremenitev.server.ts";

type Naprava = { id: string; kljuc: string; zasebni: KeyObject };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc), kljuc, zasebni: privateKey };
}
const ANA = naprava();

function zahteva(vrata: number, cert: string, odtis: string, pot: string): Promise<{ status: number; telo: any }> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: "GET", path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis")),
    }, (res) => {
      const k: Buffer[] = [];
      res.on("data", (d) => k.push(d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, telo: JSON.parse(Buffer.concat(k).toString("utf8")) }));
    });
    r.on("error", ne);
    r.end();
  });
}

function podpisanoStanje(d: Naprava): string {
  const cas = Date.now();
  const e = randomBytes(16).toString("base64url");
  const podpis = sign("sha256", Buffer.from(nizStanja(d.id, cas, e)), d.zasebni).toString("base64");
  return `${POT}/stanje?posiljatelj=${d.id}&cas=${cas}&enkratni=${e}&podpis=${encodeURIComponent(podpis)}`;
}

const izvajalec: Izvajalec = { ime: "lazni", razpolozljiv: async () => true, zacni: async () => {}, odobri: async () => {}, ustavi: async () => {} };

async function stanje(obremenitev?: () => ReturnType<typeof obremenitevRacunalnika>) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-n34-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const s = new AsistentStreznik({ root: dir, izvajalec, dnevnik: () => {}, ...(obremenitev ? { obremenitev } : {}) });
  try {
    const { vrata, odtis } = await s.zazeni();
    const { cert } = await potrdiloAsistenta(dir);
    return await zahteva(vrata, cert, odtis, podpisanoStanje(ANA));
  } finally {
    await s.ustavi();
    await rm(dir, { recursive: true, force: true });
  }
}

test("podpisan /stanje nosi obremenitev in ime racunalnika (telefon izbere najmanj obremenjenega)", async () => {
  const r = await stanje(() => ({ ime: "Testni PC", jedra: 4, obremenitev5: 3.5, prostMb: 6000 }));
  assert.equal(r.status, 200, JSON.stringify(r.telo));
  assert.equal(r.telo.claudeCode, "odprta");
  assert.deepEqual(r.telo.racunalnik, { ime: "Testni PC", jedra: 4, obremenitev5: 3.5, prostMb: 6000 });
});

test("napaka pri branju obremenitve ne podre /stanje: polje izpusceno (telefon: neznano)", async () => {
  const r = await stanje(() => { throw new Error("os"); });
  assert.equal(r.status, 200);
  assert.equal(r.telo.claudeCode, "odprta");
  assert.equal("racunalnik" in r.telo, false);
});

test("privzeto: prava obremenitev tega racunalnika (jedra > 0, prost RAM > 0)", async () => {
  const r = await stanje();
  assert.equal(r.status, 200);
  assert.ok(r.telo.racunalnik.jedra >= 1);
  assert.ok(r.telo.racunalnik.prostMb > 0);
  assert.equal(typeof r.telo.racunalnik.ime, "string");
});

test("obremenitevRacunalnika: load 0,0,0 na Windows je NEZNAN - polje izpusceno, nikoli 0; na Linuxu je 0 prava vrednost", () => {
  const o = obremenitevRacunalnika({ loadavg: () => [0, 0, 0], jedra: () => 8, prostB: () => 4096 * 1024 * 1024, ime: () => "pc", windows: () => true });
  assert.equal("obremenitev5" in o, false);
  // slepi pregled 34: miren Linux ni »neznan« (sicer bi bil za bolj zasedenim)
  assert.equal(obremenitevRacunalnika({ loadavg: () => [0, 0, 0], jedra: () => 8, prostB: () => 1e9, ime: () => "pc", windows: () => false }).obremenitev5, 0);
  assert.equal(o.jedra, 8);
  assert.equal(o.prostMb, 4096);
});

test("obremenitevRacunalnika: srednja vrednost je 5-min load, zaokrozena; ime brez nadzornih znakov, najvec 60", () => {
  const o = obremenitevRacunalnika({ loadavg: () => [9, 2.3456, 1], jedra: () => 4, prostB: () => 1e9, ime: () => "pc\u0000‮" + "x".repeat(100) });
  assert.equal(o.obremenitev5, 2.35);
  assert.equal(o.ime, ("pc" + "x".repeat(100)).slice(0, 60));
  assert.equal(o.prostMb, Math.floor(1e9 / 1048576));
});

test("obremenitevRacunalnika: neveljavne vrednosti (NaN, negativno, prazno ime) se izpustijo ali dobijo varno privzeto", () => {
  const o = obremenitevRacunalnika({ loadavg: () => [Number.NaN, -1, 0], jedra: () => 0, prostB: () => -5, ime: () => "\u0007" });
  assert.equal(obremenitevRacunalnika({ loadavg: () => [1, 1, 1], jedra: () => 2, prostB: () => 1, ime: () => { throw new Error("x"); } }).ime, "Racunalnik");
  assert.equal("obremenitev5" in o, false);
  assert.equal("jedra" in o, false);
  assert.equal("prostMb" in o, false);
  assert.equal(o.ime, "Racunalnik");
});
