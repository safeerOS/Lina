// Naloga 16 (lastnik 25. 11. 2026 23:12: »Čeprav je telefon povezan je Linija zaprta in to me jezi«): oznaka linije uposteva telefon.
// Pravi TLS streznik (izmisljen OpenLine z GET /v1/devices) samo na 127.0.0.1, nakljucna vrata; zacasne mape, izmisljene vrednosti.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { test } from "node:test";
import { telefonZaLinijo } from "./asistent-telefon.server.ts";
import { setupOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { telefoniOpenLine, zapisiOpenLineNotranje } from "./openline-povabilo.server.ts";
import { oznakaLinije } from "./oznaka-linije.ts";
import { potrdiloVMapi } from "./zasebno-omrezje.server.ts";

const KLJUC = "k".repeat(43);

async function mapa() {
  const dir = await mkdtemp(path.join(tmpdir(), "lina-n16-linija-"));
  return { dir, zapri: () => rm(dir, { recursive: true, force: true }) };
}

/** Izmisljen OpenLine: GET /v1/devices z danim telesom in statusom; zapise prejete glave. */
async function lazniOpenLine(dir: string, status: number, telo: string) {
  const p = await potrdiloVMapi(dir, "ol", "Preizkus OpenLine");
  const glave: string[] = [];
  const s = tls.createServer({ cert: p.cert, key: p.key }, (v) => {
    let sprejeto = "";
    v.on("error", () => undefined);
    v.on("data", (k) => {
      sprejeto += k.toString("utf8");
      if (!sprejeto.includes("\r\n\r\n")) return;
      glave.push(sprejeto.split("\r\n\r\n")[0]);
      v.end(`HTTP/1.1 ${status} X\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(telo)}\r\nconnection: close\r\n\r\n${telo}`);
    });
  });
  await new Promise<void>((ok, ne) => { s.once("error", ne); s.listen(0, "127.0.0.1", ok); });
  const vrata = (s.address() as import("node:net").AddressInfo).port;
  await zapisiOpenLineNotranje(dir, { vrata, odtis: p.odtis, kljuc: KLJUC });
  return { glave, zapri: () => new Promise<void>((ok) => s.close(() => ok())) };
}

test("oznaka linije: odprta kjerkoli; »zaprta« samo, ko nihce ne sprejema, in takrat klik odpre Linijo", () => {
  assert.deepEqual(oznakaLinije(true, "povezan"), { kljuc: "linOznaka_odprta", ton: "ok", odpreLinijo: false });
  assert.deepEqual(oznakaLinije(true, "ne"), { kljuc: "linOznaka_racunalnik", ton: "ok", odpreLinijo: false });
  assert.deepEqual(oznakaLinije(true, null), { kljuc: "linOznaka_racunalnik", ton: "ok", odpreLinijo: false });
  // lastnikov primer: racunalnikova linija zaprta, telefon povezan -> ne »zaprta«
  assert.deepEqual(oznakaLinije(false, "povezan"), { kljuc: "linOznaka_telefon", ton: "ok", odpreLinijo: false });
  assert.deepEqual(oznakaLinije(false, "seznanjen"), { kljuc: "linOznaka_seznanjen", ton: "neznano", odpreLinijo: false });
  assert.deepEqual(oznakaLinije(false, null), { kljuc: "linOznaka_neznano", ton: "neznano", odpreLinijo: false });
  assert.deepEqual(oznakaLinije(false, "ne"), { kljuc: "linOznaka_zaprta", ton: "zaprta", odpreLinijo: true });
  for (const k of ["linOznaka_odprta", "linOznaka_racunalnik", "linOznaka_telefon", "linOznaka_seznanjen", "linOznaka_neznano", "linOznaka_zaprta", "linOznakaOdpri"] as const) {
    assert.ok(t(k, "sl") && t(k, "en") && t(k, "sl") !== t(k, "en"), `${k} v sl in en`);
  }
});

test("telefoniOpenLine: ziva vticnica (connected) iz GET /v1/devices s kljucem API; napaka ali tuj odgovor = null (ne vemo)", async () => {
  const m = await mapa();
  try {
    assert.equal(await telefoniOpenLine(m.dir), null, "OpenLine ni nastavljen");
    const l = await lazniOpenLine(m.dir, 200, JSON.stringify({ devices: [{ id: "a", connected: true }, { id: "b", connected: false }, null] }));
    try {
      assert.deepEqual(await telefoniOpenLine(m.dir), { naprav: 3, povezanih: 1 });
      assert.match(l.glave[0]!, /^GET \/v1\/devices HTTP\/1\.1/);
      assert.match(l.glave[0]!, new RegExp(`x-api-key: ${KLJUC}`));
    } finally { await l.zapri(); }
  } finally { await m.zapri(); }
  for (const [status, telo] of [[401, "{}"], [200, "ni json"], [200, '{"devices":{}}']] as const) {
    const n = await mapa();
    const l = await lazniOpenLine(n.dir, status, telo);
    try {
      assert.equal(await telefoniOpenLine(n.dir), null, `${status} ${telo}`);
    } finally { await l.zapri(); await n.zapri(); }
  }
});

test("telefonZaLinijo: povezan (ziva pot klicev), seznanjen (dodan, brez zive povezave ali ne vemo), ne (ni telefona)", async () => {
  const m = await mapa();
  try {
    const tok = await setupOwner("geslo-test-1234", m.dir, { address: "127.0.0.1" });
    await assert.rejects(telefonZaLinijo(null, m.dir, async () => ({ naprav: 1, povezanih: 1 })), /Prijava/, "samo lastnik");
    assert.equal(await telefonZaLinijo(tok, m.dir, async () => ({ naprav: 1, povezanih: 1 })), "povezan");
    assert.equal(await telefonZaLinijo(tok, m.dir, async () => ({ naprav: 1, povezanih: 0 })), "seznanjen");
    assert.equal(await telefonZaLinijo(tok, m.dir, async () => ({ naprav: 0, povezanih: 0 })), "ne");
    assert.equal(await telefonZaLinijo(tok, m.dir, async () => null), "ne");
  } finally { await m.zapri(); }
});

test("vsa stiri mesta (vrh okvirja, stranski meni, Domov, znacka lina-desk) uporabljajo skupno oznako, ne samo line.open", () => {
  const beri = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const okvir = beri("../../components/lina2/okvir.tsx");
  assert.match(okvir, /const oznaka = oznakaLinije\(props\.line\.open, telefon\);/);
  assert.doesNotMatch(okvir, /odprta \? t2\("linijaOdprta"\) : t2\("linijaZaprta"\)/);
  assert.doesNotMatch(okvir, /odprta \? t2\("online"\) : t2\("offline"\)/);
  assert.equal(okvir.split('onClick={() => pojdi("linija")}').length - 1, 2, "vrh in stranski meni: »zaprta« odpre Linijo");
  assert.match(okvir, /linija=\{oznaka\}/);
  assert.match(okvir, /telefonLinije=\{telefon\}/);
  const domov = beri("../../components/lina2/domov.tsx");
  assert.doesNotMatch(domov, /linijaOdprta \? t\("d2HitreOdprta"\)/);
  assert.match(domov, /onClick=\{\(\) => onOdpri\("linija"\)\}/);
  const desk = beri("../../components/lina-desk.tsx");
  assert.match(desk, /const oznaka = oznakaLinije\(open, telefonLinije\);/);
  assert.doesNotMatch(desk, /\{open \? t\("uiLinijaOdprta"\) : t\("uiLinijaZaprta"\)\}/);
});
