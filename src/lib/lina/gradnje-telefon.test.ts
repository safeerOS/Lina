/**
 * Gradnje na GitHubu s telefona (24. 11. 2026): podpisane poti /gradnje, /gradnja/predlog, /gradnja/potrdi, /gradnja/apk na strezniku
 * asistentke (pravi TLS, pravi kljuci P-256). Zaledje je lazno: preizkus preveri, da streznik pred klicem zaledja preveri podpis
 * naprave ozjega kroga in da podpis veze vsebino (tok, veja, id, zgostitev). Dobesedni nizi so vektor za Kotlin.
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { closeSync, constants, openSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Izvajalec } from "./asistent.server.ts";
import { AsistentStreznik, POT, POTI_ODDALJENO, potrdiloAsistenta } from "./asistent-streznik.server.ts";
import { idIzKljuca, nizApkGradnje, nizPotrditveGradnje, nizPredlogaGradnje, nizStanjaGradenj, type Dokaz } from "./kanal-claude.ts";
import { pripraviKanal } from "./kanal-claude.server.ts";

type Naprava = { id: string; kljuc: string; zasebni: KeyObject };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { id: idIzKljuca(kljuc), kljuc, zasebni: privateKey };
}
const ANA = naprava();
const TUJA = naprava();
const enkratni = () => randomBytes(16).toString("base64url");
function podpisi(d: Naprava, niz: (c: number, e: string) => string, cas = Date.now(), e = enkratni()): Dokaz {
  return { cas, enkratni: e, podpis: sign("sha256", Buffer.from(niz(cas, e)), d.zasebni).toString("base64") };
}

type Odgovor = { status: number; glave: Record<string, string | string[] | undefined>; telo: Buffer };
function zahteva(vrata: number, cert: string, odtis: string, metoda: string, pot: string, telo?: unknown): Promise<Odgovor> {
  return new Promise((ok, ne) => {
    const r = request({
      host: "127.0.0.1", port: vrata, method: metoda, path: pot, ca: cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis")),
      headers: telo === undefined ? {} : { "content-type": "application/json" },
    }, (res) => {
      const k: Buffer[] = [];
      res.on("data", (d) => k.push(d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, glave: res.headers, telo: Buffer.concat(k) }));
    });
    r.on("error", ne);
    r.end(telo === undefined ? undefined : JSON.stringify(telo));
  });
}
const json = (o: Odgovor) => JSON.parse(o.telo.toString("utf8"));

const neIzvajalec: Izvajalec = { ime: "lazni", razpolozljiv: async () => true, zacni: async () => {}, odobri: async () => {}, ustavi: async () => {} };

async function streznik(o: { gradnje?: boolean; apk?: () => Promise<{ id: string; pot: string; sha256: string; velikost: number; paket: string } | null> } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-grad-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const apk = path.join(dir, "app.apk");
  writeFileSync(apk, "APK-VSEBINA");
  const sha = createHash("sha256").update("APK-VSEBINA").digest("hex");
  const klici: string[] = [];
  let imaApk = true;
  const s = new AsistentStreznik({
    root: dir, izvajalec: neIzvajalec, dnevnik: () => {},
    gradnje: o.gradnje === false ? undefined : {
      stanje: async () => { klici.push("stanje"); return { gradnje: [] }; },
      predlog: async (tok, veja) => {
        klici.push(`predlog ${String(tok)} ${String(veja)}`);
        if (tok !== "gradnja.yml") throw Object.assign(new Error("tok"), { razlog: "tok" });
        return { id: "0123456789abcdef", zgostitev: "z".repeat(64) };
      },
      potrdi: async (id, z) => { klici.push(`potrdi ${String(id)} ${String(z)}`); },
      apk: o.apk ?? (async () => (imaApk ? { id: "0123456789abcdef", pot: apk, sha256: sha, velikost: 11, paket: "si.safeer.lina" } : null)),
    },
  });
  const { vrata, odtis } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  return {
    z: (metoda: string, pot: string, telo?: unknown) => zahteva(vrata, cert, odtis, metoda, pot, telo),
    klici, sha, apkPot: apk, vrata, cert, odtis,
    brezApk: () => { imaApk = false; },
    ustavi: () => s.ustavi(),
  };
}
const q = (pot: string, d: Naprava, p: Dokaz) => `${POT}${pot}?posiljatelj=${d.id}&cas=${p.cas}&enkratni=${p.enkratni}&podpis=${encodeURIComponent(p.podpis)}`;

test("vektor nizov za Kotlin (dobesedno)", () => {
  assert.equal(nizStanjaGradenj("n-0123456789abcdef", 1, "e".repeat(16)), "safeer-lina-gradnje-stanje-v1\nn-0123456789abcdef\n1\neeeeeeeeeeeeeeee");
  assert.equal(nizPredlogaGradnje("n-0123456789abcdef", "gradnja.yml", "main", 1, "e".repeat(16)), "safeer-lina-gradnja-predlog-v1\nn-0123456789abcdef\ngradnja.yml\nmain\n1\neeeeeeeeeeeeeeee");
  assert.equal(nizPotrditveGradnje("n-0123456789abcdef", "0123456789abcdef", "f".repeat(64), 1, "e".repeat(16)), `safeer-lina-gradnja-potrdi-v1\nn-0123456789abcdef\n0123456789abcdef\n${"f".repeat(64)}\n1\neeeeeeeeeeeeeeee`);
  assert.equal(nizApkGradnje("n-0123456789abcdef", 1, "e".repeat(16)), "safeer-lina-gradnja-apk-v1\nn-0123456789abcdef\n1\neeeeeeeeeeeeeeee");
});

test("stanje in predlog: samo podpisana naprava ozjega kroga; tuja 403, brez podpisa 400; napaka zaledja = 409 s kodo", async () => {
  const s = await streznik();
  try {
    assert.equal((await s.z("GET", q("/gradnje", ANA, podpisi(ANA, (c, e) => nizStanjaGradenj(ANA.id, c, e))))).status, 200);
    assert.equal((await s.z("GET", q("/gradnje", TUJA, podpisi(TUJA, (c, e) => nizStanjaGradenj(TUJA.id, c, e))))).status, 403);
    assert.equal((await s.z("GET", `${POT}/gradnje?posiljatelj=${ANA.id}`)).status, 400);
    const p = podpisi(ANA, (c, e) => nizPredlogaGradnje(ANA.id, "gradnja.yml", "main", c, e));
    const r = await s.z("POST", `${POT}/gradnja/predlog`, { posiljatelj: ANA.id, tok: "gradnja.yml", veja: "main", ...p });
    assert.equal(r.status, 202);
    assert.equal(json(r).id, "0123456789abcdef");
    // podpis za main, poslana druga veja: 403, zaledje ne dobi nicesar
    const p2 = podpisi(ANA, (c, e) => nizPredlogaGradnje(ANA.id, "gradnja.yml", "main", c, e));
    assert.equal((await s.z("POST", `${POT}/gradnja/predlog`, { posiljatelj: ANA.id, tok: "gradnja.yml", veja: "dev", ...p2 })).status, 403);
    const p3 = podpisi(ANA, (c, e) => nizPredlogaGradnje(ANA.id, "deploy.yml", "main", c, e));
    const r3 = await s.z("POST", `${POT}/gradnja/predlog`, { posiljatelj: ANA.id, tok: "deploy.yml", veja: "main", ...p3 });
    assert.equal(r3.status, 409);
    assert.equal(json(r3).napaka, "tok");
    assert.deepEqual(s.klici, ["stanje", "predlog gradnja.yml main", "predlog deploy.yml main"]);
  } finally {
    await s.ustavi();
  }
});

test("potrditev s telefona: podpis veze id in zgostitev; ponovitev enkratnega niza 403", async () => {
  const s = await streznik();
  try {
    const z = "a".repeat(64);
    const p = podpisi(ANA, (c, e) => nizPotrditveGradnje(ANA.id, "0123456789abcdef", z, c, e));
    assert.equal((await s.z("POST", `${POT}/gradnja/potrdi`, { posiljatelj: ANA.id, id: "0123456789abcdef", zgostitev: "b".repeat(64), ...p })).status, 403);
    const p2 = podpisi(ANA, (c, e) => nizPotrditveGradnje(ANA.id, "0123456789abcdef", z, c, e));
    assert.equal((await s.z("POST", `${POT}/gradnja/potrdi`, { posiljatelj: ANA.id, id: "0123456789abcdef", zgostitev: z, ...p2 })).status, 202);
    assert.equal((await s.z("POST", `${POT}/gradnja/potrdi`, { posiljatelj: ANA.id, id: "0123456789abcdef", zgostitev: z, ...p2 })).status, 403);
    assert.deepEqual(s.klici, [`potrdi 0123456789abcdef ${z}`]);
  } finally {
    await s.ustavi();
  }
});

test("APK: podpisana naprava dobi datoteko z glavami sha256, velikost, paket, id; brez gradnje 404; tuja naprava 403", async () => {
  const s = await streznik();
  try {
    const r = await s.z("GET", q("/gradnja/apk", ANA, podpisi(ANA, (c, e) => nizApkGradnje(ANA.id, c, e))));
    assert.equal(r.status, 200);
    assert.equal(r.telo.toString(), "APK-VSEBINA");
    assert.equal(r.glave["content-type"], "application/vnd.android.package-archive");
    assert.equal(r.glave["x-lina-sha256"], s.sha);
    assert.equal(r.glave["content-length"], "11");
    assert.equal(r.glave["x-lina-paket"], "si.safeer.lina");
    assert.equal(r.glave["x-lina-gradnja"], "0123456789abcdef");
    assert.equal((await s.z("GET", q("/gradnja/apk", TUJA, podpisi(TUJA, (c, e) => nizApkGradnje(TUJA.id, c, e))))).status, 403);
    // podpis stanja ne odpre APK
    assert.equal((await s.z("GET", q("/gradnja/apk", ANA, podpisi(ANA, (c, e) => nizStanjaGradenj(ANA.id, c, e))))).status, 403);
    s.brezApk();
    assert.equal((await s.z("GET", q("/gradnja/apk", ANA, podpisi(ANA, (c, e) => nizApkGradnje(ANA.id, c, e))))).status, 404);
  } finally {
    await s.ustavi();
  }
});

test("APK, spremenjen po gradnji (enaka velikost, druga vsebina): 409 vsota, telo se ne poslje", async () => {
  const s = await streznik();
  try {
    writeFileSync(s.apkPot, "APK-PODTAKN");
    const r = await s.z("GET", q("/gradnja/apk", ANA, podpisi(ANA, (c, e) => nizApkGradnje(ANA.id, c, e))));
    assert.equal(r.status, 409);
    assert.equal(json(r).napaka, "vsota");
  } finally {
    await s.ustavi();
  }
});

test("brez zaledja poti ne obstajajo (404); poti gradenj niso na seznamu oddaljenih poti (samo domace omrezje)", async () => {
  const s = await streznik({ gradnje: false });
  try {
    assert.equal((await s.z("GET", q("/gradnje", ANA, podpisi(ANA, (c, e) => nizStanjaGradenj(ANA.id, c, e))))).status, 404);
    assert.equal((await s.z("GET", q("/gradnja/apk", ANA, podpisi(ANA, (c, e) => nizApkGradnje(ANA.id, c, e))))).status, 404);
  } finally {
    await s.ustavi();
  }
  for (const p of ["/gradnje", "/gradnja/predlog", "/gradnja/potrdi", "/gradnja/apk"]) assert.equal(POTI_ODDALJENO.has(`${POT}${p}`), false, p);
});

// ---- Pregled A (zdruzitev 0225): A-11, A-16 ----
/** Odprti deskriptorji tega procesa, ki kazejo na dano pot (Linux /proc). */
function odprtiNa(pot: string): number {
  let n = 0;
  for (const fd of readdirSync("/proc/self/fd")) {
    try {
      if (readlinkSync(`/proc/self/fd/${fd}`) === pot) n++;
    } catch {
      /* deskriptor se je medtem zaprl */
    }
  }
  return n;
}

test("A-11: odjemalec prekine pred posiljanjem APK: deskriptor se zapre, zahteva ne visi", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-grad-a11-"));
  const apk = path.join(dir, "zakasnjen.apk");
  writeFileSync(apk, "APK-VSEBINA");
  const sha = createHash("sha256").update("APK-VSEBINA").digest("hex");
  let poklicano = false;
  const s = await streznik({ apk: async () => { poklicano = true; await new Promise((r) => setTimeout(r, 300)); return { id: "0123456789abcdef", pot: apk, sha256: sha, velikost: 11, paket: "si.safeer.lina" }; } });
  try {
    const p = podpisi(ANA, (c, e) => nizApkGradnje(ANA.id, c, e));
    await new Promise<void>((ok) => {
      const r = request({
        host: "127.0.0.1", port: s.vrata, method: "GET", path: q("/gradnja/apk", ANA, p), ca: s.cert, rejectUnauthorized: true,
        checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === s.odtis ? undefined : new Error("odtis")),
      });
      r.on("error", () => ok());
      r.end();
      const t = setInterval(() => { if (poklicano) { clearInterval(t); r.destroy(); ok(); } }, 5);
    });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(odprtiNa(apk), 0, "deskriptor APK ostane odprt (obljuba visi)");
  } finally {
    await s.ustavi();
  }
});

test("A-16: pot APK, ki ni navadna datoteka (FIFO), se zavrne takoj, brez branja", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-grad-a16-"));
  const fifo = path.join(dir, "cev.apk");
  execFileSync("mkfifo", [fifo]);
  const s = await streznik({ apk: async () => ({ id: "0123456789abcdef", pot: fifo, sha256: "a".repeat(64), velikost: 11, paket: "si.safeer.lina" }) });
  try {
    const p = podpisi(ANA, (c, e) => nizApkGradnje(ANA.id, c, e));
    const izid = await Promise.race([s.z("GET", q("/gradnja/apk", ANA, p)).then((r) => r.status), new Promise<string>((r) => setTimeout(() => r("visi"), 2000))]);
    assert.notEqual(izid, "visi", "branje FIFO obvisi");
    assert.notEqual(izid, 200);
  } finally {
    // ce je streznik obvisel na odpiranju FIFO, ga sprosti pisec (sicer proces preizkusa ne konca)
    try { closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)); } catch { /* ni bralca */ }
    await s.ustavi();
  }
});
