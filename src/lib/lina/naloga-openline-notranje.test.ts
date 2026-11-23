// #17 OpenLine v racunalniski aplikaciji: Lina sama zapise nastavitve OpenLine (vrata, odtis, kljuc API, naslov), uporabnik iz OpenLine ne vpise nic.
// Pravi TLS strezniki (izmisljen OpenLine) samo na 127.0.0.x, nakljucna vrata. Zacasne mape z nakljucnim imenom, brez osebnih podatkov.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { test } from "node:test";
import { NASTAVITVE_OPENLINE, nastavitveOpenLine, povabiloOpenLine, stanjeOpenLine, zapisiOpenLineNotranje } from "./openline-povabilo.server.ts";
import { odtisPotrdila, potrdiloVMapi } from "./zasebno-omrezje.server.ts";

const KLJUC = "k".repeat(43);
const KODA = "ABCDEFGH";

async function mapa(): Promise<{ dir: string; zapri: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "openline-notr-"));
  return { dir, zapri: async () => { await rm(dir, { recursive: true, force: true }); } };
}

type Lazni = { vrata: number; odtis: string; glave: string[]; zapri: () => Promise<void> };
/** Izmisljen OpenLine: sprejme POST /v1/pairing z ustreznim kljucem in vrne kodo; poslusa SAMO na danem naslovu. */
async function lazniOpenLine(naslov: string, dir: string, ime: string, javniNaslov: (vrata: number) => string): Promise<Lazni> {
  const p = await potrdiloVMapi(dir, ime, "Preizkus OpenLine");
  const glave: string[] = [];
  let vrata = 0;
  const s = tls.createServer({ cert: p.cert, key: p.key }, (v) => {
    let sprejeto = "";
    v.on("error", () => undefined);
    v.on("data", (k) => {
      sprejeto += k.toString("utf8");
      if (!sprejeto.includes("\r\n\r\n")) return;
      glave.push(sprejeto.split("\r\n\r\n")[0]);
      const telo = JSON.stringify({ code: KODA, publicUrl: javniNaslov(vrata), certSha256: p.odtis });
      v.end(`HTTP/1.1 201 Created\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(telo)}\r\nconnection: close\r\n\r\n${telo}`);
    });
  });
  await new Promise<void>((ok, ne) => { s.once("error", ne); s.listen(0, naslov, ok); });
  vrata = (s.address() as import("node:net").AddressInfo).port;
  return { vrata, odtis: p.odtis, glave, zapri: () => new Promise<void>((ok) => s.close(() => ok())) };
}

test("notranji zapis: nastavitve preberemo nazaj (vrata, odtis, kljuc, naslov), kljuc v datoteki ni v cistem besedilu", async () => {
  const m = await mapa();
  try {
    await zapisiOpenLineNotranje(m.dir, { vrata: 8787, odtis: "AB:".repeat(31) + "AB", kljuc: KLJUC, naslov: "192.168.1.5" });
    const n = await nastavitveOpenLine(m.dir);
    assert.deepEqual(n, { vrata: 8787, odtis: "ab".repeat(32), kljuc: KLJUC, naslov: "192.168.1.5" });
    const surovo = readFileSync(path.join(m.dir, NASTAVITVE_OPENLINE), "utf8");
    assert.equal(surovo.includes(KLJUC), false, "kljuc API je v datoteki sifriran");
    assert.deepEqual(await stanjeOpenLine(m.dir), { povezan: true, vrata: 8787, odtis: "ab".repeat(32) });
  } finally { await m.zapri(); }
});

test("notranji zapis: neveljavni vnosi se zavrnejo in nic se ne zapise", async () => {
  const m = await mapa();
  try {
    const dober = { vrata: 8787, odtis: "ab".repeat(32), kljuc: KLJUC };
    const slabi: Array<[string, Parameters<typeof zapisiOpenLineNotranje>[1]]> = [
      ["vrata 0", { ...dober, vrata: 0 }],
      ["vrata 65536", { ...dober, vrata: 65536 }],
      ["vrata ni celo", { ...dober, vrata: 80.5 }],
      ["odtis prekratek", { ...dober, odtis: "ab".repeat(31) }],
      ["kljuc prekratek", { ...dober, kljuc: "k".repeat(15) }],
      ["kljuc s presledkom", { ...dober, kljuc: "k".repeat(20) + " x" }],
      ["javni naslov", { ...dober, naslov: "8.8.8.8" }],
      ["vsi vmesniki", { ...dober, naslov: "0.0.0.0" }],
      ["ime gostitelja", { ...dober, naslov: "localhost" }],
      ["naslov z vodilno niclo", { ...dober, naslov: "192.168.001.005" }],
    ];
    for (const [ime, vnos] of slabi) await assert.rejects(zapisiOpenLineNotranje(m.dir, vnos), Error, ime);
    assert.equal(await nastavitveOpenLine(m.dir), null, "po zavrnitvah ni nastavitev");
  } finally { await m.zapri(); }
});

test("povabiloOpenLine se poveze na SHRANJENI naslov (OpenLine veze samo zasebni naslov racunalnika, ne 127.0.0.1)", async () => {
  const m = await mapa();
  const l = await lazniOpenLine("127.0.0.2", m.dir, "ol-a", (v) => `https://127.0.0.2:${v}`);
  try {
    await zapisiOpenLineNotranje(m.dir, { vrata: l.vrata, odtis: l.odtis, kljuc: KLJUC, naslov: "127.0.0.2" });
    const p = await povabiloOpenLine(m.dir, `https://127.0.0.2:${l.vrata}`);
    assert.deepEqual(p, { url: `https://127.0.0.2:${l.vrata}`, koda: KODA, odtis: l.odtis });
    assert.equal(l.glave.length, 1);
    assert.match(l.glave[0], new RegExp(`x-api-key: ${KLJUC}`), "kljuc API je sel v glavi");
  } finally { await l.zapri(); await m.zapri(); }
});

test("zapis brez naslova (kot rocni vnos iz konzole) ostane na 127.0.0.1 in deluje kot prej", async () => {
  const m = await mapa();
  const l = await lazniOpenLine("127.0.0.1", m.dir, "ol-b", (v) => `https://192.168.1.5:${v}`);
  try {
    await zapisiOpenLineNotranje(m.dir, { vrata: l.vrata, odtis: l.odtis, kljuc: KLJUC });
    assert.equal((await nastavitveOpenLine(m.dir))?.naslov, "127.0.0.1");
    const p = await povabiloOpenLine(m.dir, `https://192.168.1.5:${l.vrata}`);
    assert.equal(p.koda, KODA);
  } finally { await l.zapri(); await m.zapri(); }
});

test("povabiloOpenLine: odtis potrdila drugega streznika se zavrne PRED posiljanjem kljuca", async () => {
  const m = await mapa();
  const l = await lazniOpenLine("127.0.0.2", m.dir, "ol-c", (v) => `https://127.0.0.2:${v}`);
  try {
    const tuj = odtisPotrdila((await potrdiloVMapi(m.dir, "tuj", "Drug")).cert);
    await zapisiOpenLineNotranje(m.dir, { vrata: l.vrata, odtis: tuj, kljuc: KLJUC, naslov: "127.0.0.2" });
    await assert.rejects(povabiloOpenLine(m.dir, `https://127.0.0.2:${l.vrata}`), /Odtis potrdila OpenLine se ne ujema/);
    assert.equal(l.glave.length, 0, "kljuc API ni bil poslan");
  } finally { await l.zapri(); await m.zapri(); }
});
