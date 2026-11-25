// Global Link za Lino (naloga 22, 25. 11. 2026): telefon zunaj doma -> rele (link.safeer.si) -> Lina na racunalniku.
// Lazen rele v preizkusu govori isti protokol kot core/link_rele.py (Safeer OS): /v1/presence, /v1/listen, /v1/connect, /v1/accept,
// glave X-Safeer-Key/Time/Signature (SHA256withECDSA nad METODA\nPOT\nCAS\nsha256(telo)). Skozi kanal tece TLS LININEGA potrdila
// (telefon pripne odtis kot doma); rele vidi samo sifrirane bajte.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign, verify, createPublicKey, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request, type RequestOptions } from "node:https";
import { createServer as tlsServer, connect as tlsConnect, type TLSSocket, type Server as TlsServer } from "node:tls";
import { tmpdir } from "node:os";
import path from "node:path";
import { Duplex } from "node:stream";
import { test } from "node:test";
import type { Dogodek, Izvajalec, Naloga } from "./asistent.server.ts";
import { AsistentStreznik, POT, potrdiloAsistenta, ustvariPotrdilo } from "./asistent-streznik.server.ts";
import { idIzKljuca, nizNaloge, nizOdgovoraVprasanja, nizStanja, nizStanjaVprasanj } from "./kanal-claude.ts";
// samo konstante, ki obstajajo tudi na izvirniku: rdeci tek pade na trditvi, ne na uvozu
import { NAJVEC_ZAVRNITEV_NA_MINUTO, type MoznostiStreznika } from "./asistent-streznik.server.ts";
import { pripraviKanal } from "./kanal-claude.server.ts";
import { NASTAVITVE_ASISTENTA, globalLinkVklopljen, ponastaviAsistenta, registrirajRele, shraniAsistenta, stanjeAsistenta } from "./asistent-telefon.server.ts";
import { setupOwner } from "./auth.server.ts";
import net from "node:net";
import { writeFile } from "node:fs/promises";
import {
  AgentReleja, Razclenjevalec, dovoljeniIzKanala, kotDuplex, kljucReleja, odpriWs, okvir, podpisaneGlave, type KljucReleja, type MoznostiPovezave,
} from "./rele-lina.server.ts";

const premor = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function caka(pogoj: () => boolean, ms = 5000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error("rok cakanja potekel");
    await premor(20);
  }
}

type Naprava = { id: string; kljuc: string; zasebni: KeyObject; rele: KljucReleja };
function naprava(): Naprava {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kljuc = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const id = idIzKljuca(kljuc);
  return { id, kljuc, zasebni: privateKey, rele: { javni: kljuc, id, podpisi: (d) => sign("sha256", d, privateKey).toString("base64") } };
}
const ANA = naprava();
const TUJEC = naprava();
const enkratni = () => randomBytes(16).toString("base64url");

// ------------------------------------------------------------------ lazen rele (samo za preizkus)

type Glave = Record<string, string>;
function preveriPodpis(metoda: string, pot: string, telo: Buffer, g: Glave): string | null {
  const kljuc = g["x-safeer-key"];
  const cas = g["x-safeer-time"];
  const podpis = g["x-safeer-signature"];
  if (!kljuc || !cas || !podpis) return null;
  const sporocilo = Buffer.from(`${metoda}\n${pot}\n${cas}\n${createHash("sha256").update(telo).digest("hex")}`);
  try {
    const ok = verify("sha256", sporocilo, createPublicKey({ key: Buffer.from(kljuc, "base64"), format: "der", type: "spki" }), Buffer.from(podpis, "base64"));
    return ok ? idIzKljuca(kljuc) : null;
  } catch {
    return null;
  }
}

/** WS stran releja: okvirji od odjemalca so maskirani, rele poslje nemaskirane. */
class StranReleja {
  readonly s: TLSSocket;
  private readonly r = new Razclenjevalec(true);
  naSporocilo: (op: number, p: Buffer) => void = () => undefined;
  constructor(s: TLSSocket, ostanek: Buffer) {
    this.s = s;
    s.on("data", (b: Buffer) => this.hrani(b));
    if (ostanek.length) queueMicrotask(() => this.hrani(ostanek));
  }
  private hrani(b: Buffer): void {
    try {
      for (const m of this.r.dodaj(b)) {
        if (m.op === 8) { this.s.destroy(); return; }
        this.naSporocilo(m.op, m.podatki);
      }
    } catch {
      this.s.destroy();
    }
  }
  poslji(op: number, p: Buffer): void {
    if (!this.s.destroyed) this.s.write(okvir(op, p, null));
  }
}

type LazenRele = {
  vrata: number; cert: string; prisotnost: Map<string, string[]>; poslusalci: Map<string, StranReleja>; sprejeti: StranReleja[];
  /** false = rele ne preverja seznama allow (obramba v globino: streznik mora vseeno zavrniti). */
  strog: boolean; zavrnjeni: number; ustavi: () => Promise<void>;
};
async function lazenRele(): Promise<LazenRele> {
  const { cert, key } = ustvariPotrdilo();
  const prisotnost = new Map<string, string[]>();
  const poslusalci = new Map<string, StranReleja>();
  const cakajo = new Map<string, StranReleja>();
  const vse = new Set<TLSSocket>();
  const sprejeti: StranReleja[] = [];
  const st: LazenRele = { vrata: 0, cert, prisotnost, poslusalci, sprejeti, strog: true, zavrnjeni: 0, ustavi: async () => undefined };
  const srv: TlsServer = tlsServer({ cert, key }, (s) => {
    vse.add(s);
    s.on("close", () => vse.delete(s));
    s.on("error", () => s.destroy());
    let buf = Buffer.alloc(0);
    const glava = (b: Buffer) => {
      buf = Buffer.concat([buf, b]);
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return;
      s.off("data", glava);
      const vrstice = buf.subarray(0, i).toString("latin1").split("\r\n");
      const [metoda, pot] = vrstice[0].split(" ");
      const g: Glave = {};
      for (const v of vrstice.slice(1)) { const k = v.indexOf(":"); g[v.slice(0, k).trim().toLowerCase()] = v.slice(k + 1).trim(); }
      const ostanek = buf.subarray(i + 4);
      void obravnavaj(s, metoda, pot, g, ostanek);
    };
    s.on("data", glava);
  });
  const odgovor = (s: TLSSocket, status: number, telo = "") => { s.end(`HTTP/1.1 ${status} X\r\ncontent-length: ${Buffer.byteLength(telo)}\r\nconnection: close\r\n\r\n${telo}`); };
  const nadgradi = (s: TLSSocket, g: Glave, ostanek: Buffer): StranReleja => {
    const sprejmi = createHash("sha1").update(g["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    s.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${sprejmi}\r\n\r\n`);
    return new StranReleja(s, ostanek);
  };
  async function obravnavaj(s: TLSSocket, metoda: string, pot: string, g: Glave, ostanek: Buffer): Promise<void> {
    if (metoda === "POST" && pot === "/v1/presence") {
      let telo = ostanek;
      const n = Number(g["content-length"] ?? 0);
      while (telo.length < n) telo = Buffer.concat([telo, await new Promise<Buffer>((ok) => s.once("data", ok))]);
      const id = preveriPodpis("POST", pot, telo, g);
      if (!id) return odgovor(s, 401);
      prisotnost.set(id, (JSON.parse(telo.toString("utf8")) as { allow: string[] }).allow);
      return odgovor(s, 200, "{}");
    }
    const id = preveriPodpis("GET", pot, Buffer.alloc(0), g);
    if (!id || (g.upgrade ?? "").toLowerCase() !== "websocket") { st.zavrnjeni++; return odgovor(s, 401); }
    const u = new URL(pot, "https://rele.invalid");
    if (u.pathname === "/v1/listen") { poslusalci.set(id, nadgradi(s, g, ostanek)); return; }
    if (u.pathname === "/v1/connect") {
      const cilj = u.searchParams.get("to") ?? "";
      const kanal = u.searchParams.get("kanal") ?? "";
      const p = poslusalci.get(cilj);
      if (!p || (st.strog && !(prisotnost.get(cilj) ?? []).includes(id))) { st.zavrnjeni++; return odgovor(s, 403); }
      const odj = nadgradi(s, g, ostanek);
      cakajo.set(kanal, odj);
      p.poslji(1, Buffer.from(JSON.stringify({ type: "incoming", kanal })));
      return;
    }
    if (u.pathname === "/v1/accept") {
      const kanal = u.searchParams.get("kanal") ?? "";
      const odj = cakajo.get(kanal);
      if (!odj || !poslusalci.has(id)) return odgovor(s, 404);
      cakajo.delete(kanal);
      const hub = nadgradi(s, g, ostanek);
      sprejeti.push(hub);
      odj.naSporocilo = (op, p) => { if (op === 2) hub.poslji(2, p); };
      hub.naSporocilo = (op, p) => { if (op === 2) odj.poslji(2, p); };
      odj.s.once("close", () => hub.s.destroy());
      hub.s.once("close", () => odj.s.destroy());
      odj.poslji(1, Buffer.from("ready"));
      return;
    }
    odgovor(s, 404);
  }
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  st.vrata = (srv.address() as { port: number }).port;
  st.ustavi = () => new Promise<void>((ok) => { for (const s of vse) s.destroy(); srv.close(() => ok()); });
  return st;
}

// ------------------------------------------------------------------ Lina + agent releja

function lazniIzvajalec() {
  const klici: Naloga[] = [];
  const iz: Izvajalec = {
    ime: "lazni",
    razpolozljiv: async () => true,
    zacni: async (n: Naloga, _cb: (d: Dogodek) => void) => { klici.push(n); },
    odobri: async () => undefined,
    ustavi: async () => undefined,
  };
  return { iz, klici };
}

async function linaZRelejem(rele: LazenRele, o: { oddaljeno?: boolean; vprasanjaAgentov?: MoznostiStreznika["vprasanjaAgentov"] } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-rele-"));
  await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
  const l = lazniIzvajalec();
  const kljuc = await kljucReleja(dir);
  const s = new AsistentStreznik({ root: dir, izvajalec: l.iz, dnevnik: () => {}, omogociOddaljeno: o.oddaljeno ?? true, rele: () => kljuc.id, vprasanjaAgentov: o.vprasanjaAgentov });
  const { odtis, vrata } = await s.zazeni();
  const { cert } = await potrdiloAsistenta(dir);
  const povezava: MoznostiPovezave = { host: "127.0.0.1", port: rele.vrata, servername: "localhost", ca: rele.cert };
  const agent = new AgentReleja({ kljuc, dovoljeni: async () => [ANA.id], sprejmi: (d) => s.sprejmiOddaljeno(d, "rele"), povezava, dnevnik: () => {} });
  agent.zazeni();
  await caka(() => agent.stanje === "povezan" && rele.poslusalci.has(kljuc.id));
  return {
    dir, s, l, kljuc, agent, cert, odtis, povezava, vrata,
    pospravi: async () => { agent.ustavi(); await s.ustavi(); await rm(dir, { recursive: true, force: true }); },
  };
}

type Odgovor = { status: number; telo: any };
/** Telefon zunaj doma: kanal releja (podpisan z njegovim kljucem), nato TLS do Line s pripetim odtisom kot doma. */
async function prekoReleja(rele: LazenRele, lina: { kljuc: KljucReleja; cert: string; odtis: string; povezava: MoznostiPovezave },
  kdo: Naprava, metoda: string, pot: string, telo?: unknown, odtis = lina.odtis, glave: Record<string, string> = {}): Promise<Odgovor> {
  const k = `/v1/connect?to=${lina.kljuc.id}&kanal=${randomBytes(16).toString("hex")}`;
  const ws = await odpriWs(k, podpisaneGlave("GET", k, Buffer.alloc(0), kdo.rele), lina.povezava);
  await new Promise<void>((ok, ne) => {
    const t = setTimeout(() => ne(new Error("ni ready")), 5000);
    ws.naSporocilo = (op, p) => { if (op === 1 && p.toString() === "ready") { clearTimeout(t); ok(); } };
    ws.naKoncu = () => { clearTimeout(t); ne(new Error("kanal zaprt")); };
  });
  const kanal: Duplex = kotDuplex(ws);
  return new Promise((ok, ne) => {
    const moznosti: RequestOptions = {
      // brez agent: http uporabi createConnection samo, ce agenta ni (agent: false bi ga prezrl)
      method: metoda, path: pot,
      headers: { ...(telo === undefined ? {} : { "content-type": "application/json" }), ...glave },
      createConnection: () => tlsConnect({
        socket: kanal, ca: lina.cert, rejectUnauthorized: true,
        checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === odtis ? undefined : new Error("odtis se ne ujema")),
      }),
    };
    const r = request(moznosti, (res) => {
      const d: Buffer[] = [];
      res.on("data", (x) => d.push(x));
      res.on("end", () => {
        let j: unknown = Buffer.concat(d).toString("utf8");
        try { j = JSON.parse(j as string); } catch { /* ni JSON */ }
        ok({ status: res.statusCode ?? 0, telo: j });
      });
    });
    r.on("error", ne);
    r.end(telo === undefined ? undefined : JSON.stringify(telo));
  });
}

function podpisanoStanje(d: Naprava): string {
  const cas = Date.now();
  const e = enkratni();
  const podpis = sign("sha256", Buffer.from(nizStanja(d.id, cas, e)), d.zasebni).toString("base64");
  return `${POT}/stanje?posiljatelj=${d.id}&cas=${cas}&enkratni=${e}&podpis=${encodeURIComponent(podpis)}`;
}
function podpisanaNaloga(d: Naprava, besedilo: string) {
  const id = randomBytes(18).toString("base64url");
  const cas = Date.now();
  const e = enkratni();
  return { id, posiljatelj: d.id, besedilo, cas, enkratni: e, podpis: sign("sha256", Buffer.from(nizNaloge(id, d.id, besedilo, cas, e)), d.zasebni).toString("base64") };
}

// ------------------------------------------------------------------ preizkusi

test("telefon zunaj doma: LAN ni dosegljiv, rele je - podpisana naloga in stanje uspeta prek releja, TLS je Linin (pripet odtis)", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    // LAN pot telefona: domaci naslov ni dosegljiv (zaprta vrata) - zahteva tja ne uspe
    await assert.rejects(new Promise((ok, ne) => { const s = tlsConnect({ host: "127.0.0.1", port: 9, rejectUnauthorized: false }, () => ok(s)); s.on("error", ne); }));
    // prisotnost na releju: dovoljene so samo seznanjene naprave
    assert.deepEqual(rele.prisotnost.get(lina.kljuc.id), [ANA.id]);
    const st = await prekoReleja(rele, lina, ANA, "GET", podpisanoStanje(ANA));
    assert.equal(st.status, 200, JSON.stringify(st.telo));
    assert.equal(st.telo.rele, lina.kljuc.id, "telefon izve id releja iz podpisanega stanja");
    const n = podpisanaNaloga(ANA, "pokazi datum");
    const r = await prekoReleja(rele, lina, ANA, "POST", `${POT}/naloga`, n);
    assert.equal(r.status, 202, JSON.stringify(r.telo));
    assert.equal(lina.l.klici.length, 1);
    assert.equal(lina.l.klici[0].posiljatelj, ANA.id);
    // ponovitev istega podpisa prek releja ne uspe (enkratni niz velja tudi za oddaljeno pot)
    assert.equal((await prekoReleja(rele, lina, ANA, "POST", `${POT}/naloga`, n)).status, 403);
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("prek releja: seznanjanje, koda, poti izven belega seznama in glave prehoda so zavrnjene; napacen odtis ne vzpostavi TLS", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    assert.equal((await prekoReleja(rele, lina, ANA, "GET", `${POT}/seznani?koda=${"a".repeat(22)}`)).status, 403);
    assert.equal((await prekoReleja(rele, lina, ANA, "POST", `${POT}/koda/zacni`, { x: 1 })).status, 403);
    assert.equal((await prekoReleja(rele, lina, ANA, "POST", `${POT}/seznani`, { x: 1 })).status, 403);
    // Pot izven belega seznama ostane zavrnjena; agent-naloge je od 25. 11. 2026 (lastnik »da«) dovoljena, a brez podpisa nikoli 200.
    assert.equal((await prekoReleja(rele, lina, ANA, "GET", `${POT}/ni-na-seznamu`)).status, 403);
    assert.notEqual((await prekoReleja(rele, lina, ANA, "GET", `${POT}/agent-naloge`)).status, 200);
    assert.equal((await prekoReleja(rele, lina, ANA, "GET", podpisanoStanje(ANA), undefined, lina.odtis, { "x-lina-prehod": "x", "x-lina-vir": "ana" })).status, 403);
    await assert.rejects(prekoReleja(rele, lina, ANA, "GET", podpisanoStanje(ANA), undefined, "0".repeat(64)), /odtis/);
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("naprava, ki ni seznanjena: rele jo zavrne po seznamu allow; tudi ce rele ne preverja, Lina zavrne nepodpisano in tuje", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    await assert.rejects(prekoReleja(rele, lina, TUJEC, "GET", podpisanoStanje(TUJEC)));
    assert.ok(rele.zavrnjeni >= 1);
    rele.strog = false; // rele brez seznama allow: obramba v globino
    assert.equal((await prekoReleja(rele, lina, TUJEC, "GET", podpisanoStanje(TUJEC))).status, 403);
    assert.equal((await prekoReleja(rele, lina, TUJEC, "POST", `${POT}/naloga`, podpisanaNaloga(TUJEC, "x"))).status, 403);
    assert.equal(lina.l.klici.length, 0);
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("oddaljena pot izklopljena: kanal se zavrze, stanje ne izda id releja; ustavitev agenta zapre poslusalca", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele, { oddaljeno: false });
  try {
    const d = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
    assert.equal(lina.s.sprejmiOddaljeno(d, "rele"), false);
    assert.ok(d.destroyed);
    await assert.rejects(prekoReleja(rele, lina, ANA, "GET", podpisanoStanje(ANA)));
    // doma (LAN) stanje uspe, a brez id-ja releja: telefon rele pozabi, ko je Global Link izklopljen
    const lan = await new Promise<{ status: number; telo: any }>((ok, ne) => {
      const q = request({ host: "127.0.0.1", port: lina.vrata, path: podpisanoStanje(ANA), method: "GET", ca: lina.cert,
        checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === lina.odtis ? undefined : new Error("odtis")) }, (res) => {
        const d: Buffer[] = []; res.on("data", (x) => d.push(x)); res.on("end", () => ok({ status: res.statusCode ?? 0, telo: JSON.parse(Buffer.concat(d).toString("utf8")) }));
      });
      q.on("error", ne); q.end();
    });
    assert.equal(lan.status, 200);
    assert.equal(lan.telo.rele, undefined);
    const p = rele.poslusalci.get(lina.kljuc.id)!;
    lina.agent.ustavi();
    await caka(() => p.s.destroyed);
    assert.equal(lina.agent.stanje, "izklopljen");
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

// ------------------------------------------------------------------ pregled 0213 (A2, A10)

/** En kanal releja s TLS do Line; vec zahtev zaporedno po isti vticnici (HTTP/1.1 cevovod), da omejitve kanala res veljajo za kanal. */
async function kanalReleja(rele: LazenRele, lina: { kljuc: KljucReleja; cert: string; odtis: string; povezava: MoznostiPovezave }, kdo: Naprava): Promise<TLSSocket> {
  const k = `/v1/connect?to=${lina.kljuc.id}&kanal=${randomBytes(16).toString("hex")}`;
  const ws = await odpriWs(k, podpisaneGlave("GET", k, Buffer.alloc(0), kdo.rele), lina.povezava);
  await new Promise<void>((ok, ne) => {
    const t = setTimeout(() => ne(new Error("ni ready")), 5000);
    ws.naSporocilo = (op, p) => { if (op === 1 && p.toString() === "ready") { clearTimeout(t); ok(); } };
    ws.naKoncu = () => { clearTimeout(t); ne(new Error("kanal zaprt")); };
  });
  return new Promise((ok, ne) => {
    const s = tlsConnect({
      socket: kotDuplex(ws), ca: lina.cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === lina.odtis ? undefined : new Error("odtis")),
    }, () => ok(s));
    s.on("error", ne);
  });
}
/** Zahteve ZAPOREDNO po isti vticnici (naslednja sele po odgovoru; cevovod bi Node obdelal hkrati, pred zapisom zavrnitev). */
async function zahteveNaKanalu(s: TLSSocket, zahteve: { metoda: string; pot: string; telo?: unknown }[]): Promise<number[]> {
  let b = "";
  let cakam: (() => void) | null = null;
  s.setEncoding("utf8");
  s.on("data", (d: string) => { b += d; cakam?.(); });
  const st: number[] = [];
  for (const z of zahteve) {
    const telo = z.telo === undefined ? "" : JSON.stringify(z.telo);
    s.write(`${z.metoda} ${z.pot} HTTP/1.1\r\nhost: lina\r\n${telo ? `content-type: application/json\r\ncontent-length: ${Buffer.byteLength(telo)}\r\n` : ""}\r\n${telo}`);
    await new Promise<void>((ok, ne) => {
      const t = setTimeout(() => ne(new Error(`rok: ${b.slice(0, 200)}`)), 10_000);
      const preveri = () => {
        // odgovor je cel, ko je prebrana glava in telo dolzine content-length
        const m = /^HTTP\/1\.1 (\d{3})[\s\S]*?content-length: (\d+)\r\n[\s\S]*?\r\n\r\n/i.exec(b);
        if (!m || b.length < m[0].length + Number(m[2])) return;
        clearTimeout(t);
        st.push(Number(m[1]));
        b = b.slice(m[0].length + Number(m[2]));
        cakam = null;
        ok();
      };
      cakam = preveri;
      preveri();
    });
  }
  return st;
}
/** Naloga v imenu ANE, podpisana s tujim kljucem: podpis ne velja (403, steje med zavrnitve). */
function slabaNaloga() {
  const n = podpisanaNaloga(TUJEC, "x");
  return { ...n, posiljatelj: ANA.id };
}

test("pregled 0213 A2: kanal releja s slabimi podpisi dobi 429, drug kanal z veljavnim podpisom pa uspe (omejitve po kanalu)", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    const napadalec = await kanalReleja(rele, lina, ANA);
    const slabe = Array.from({ length: NAJVEC_ZAVRNITEV_NA_MINUTO + 1 }, () => ({ metoda: "POST", pot: `${POT}/naloga`, telo: slabaNaloga() }));
    const st = await zahteveNaKanalu(napadalec, slabe);
    assert.deepEqual(st.slice(0, NAJVEC_ZAVRNITEV_NA_MINUTO), Array(NAJVEC_ZAVRNITEV_NA_MINUTO).fill(403));
    assert.equal(st[NAJVEC_ZAVRNITEV_NA_MINUTO], 429, "kanal, ki je presegel mejo zavrnitev, je omejen");
    napadalec.destroy();
    const r = await prekoReleja(rele, lina, ANA, "GET", podpisanoStanje(ANA));
    assert.equal(r.status, 200, `drug kanal ne sme dobiti 429 zaradi tujih zavrnitev: ${JSON.stringify(r.telo)}`);
    assert.equal(lina.l.klici.length, 0);
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("pregled 0213 A2: menjava kanalov ne obide skupne meje zavrnitev releja (5x meja kanala)", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    const skupaj = 5 * NAJVEC_ZAVRNITEV_NA_MINUTO;
    for (let i = 0; i < skupaj; i++) assert.equal((await prekoReleja(rele, lina, ANA, "POST", `${POT}/naloga`, slabaNaloga())).status, 403, `zahteva ${i}`);
    assert.equal((await prekoReleja(rele, lina, ANA, "GET", podpisanoStanje(ANA))).status, 429, "skupna meja releja velja tudi za nov kanal");
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("pregled 0213 A10: vprasanja agenta prek releja - stanje in odgovor samo s podpisom naprave ozjega kroga", async () => {
  const rele = await lazenRele();
  const odgovori: string[][] = [];
  const lina = await linaZRelejem(rele, {
    vprasanjaAgentov: {
      stanje: async () => ({ vprasanja: [], teki: [] }),
      odgovori: async (id, odl, zg, nap) => { odgovori.push([id, odl, zg, nap]); },
    },
  });
  try {
    const cas = Date.now();
    const e = enkratni();
    const pd = sign("sha256", Buffer.from(nizStanjaVprasanj(ANA.id, cas, e)), ANA.zasebni).toString("base64");
    const st = await prekoReleja(rele, lina, ANA, "GET", `${POT}/agent-vprasanja?posiljatelj=${ANA.id}&cas=${cas}&enkratni=${e}&podpis=${encodeURIComponent(pd)}`);
    assert.equal(st.status, 200, JSON.stringify(st.telo));
    const id = "0123456789abcdef";
    const zg = "a".repeat(64);
    const telo = (kdo: Naprava) => {
      const c = Date.now();
      const n = enkratni();
      return { posiljatelj: ANA.id, id, odlocitev: "zavrni", zgostitev: zg, cas: c, enkratni: n, podpis: sign("sha256", Buffer.from(nizOdgovoraVprasanja(ANA.id, id, "zavrni", zg, c, n)), kdo.zasebni).toString("base64") };
    };
    assert.equal((await prekoReleja(rele, lina, ANA, "POST", `${POT}/agent-vprasanje/odgovor`, telo(TUJEC))).status, 403, "podpis tujega kljuca");
    assert.equal(odgovori.length, 0);
    const r = await prekoReleja(rele, lina, ANA, "POST", `${POT}/agent-vprasanje/odgovor`, telo(ANA));
    assert.equal(r.status, 202, JSON.stringify(r.telo));
    assert.deepEqual(odgovori, [[id, "zavrni", zg, ANA.id]]);
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("pregled 0213 A12: AgentReleja.ustavi zapre tudi ze sprejete kanale (ne samo poslusalca)", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    const kanal = await kanalReleja(rele, lina, ANA);
    assert.deepEqual(await zahteveNaKanalu(kanal, [{ metoda: "GET", pot: podpisanoStanje(ANA) }]), [200]);
    lina.agent.ustavi();
    await caka(() => kanal.destroyed || kanal.closed, 3000);
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("kljuc releja Line: EC P-256, id kot v Safeer Linku, datoteka 0600, ob drugem branju isti", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-rk-"));
  try {
    const a = await kljucReleja(dir);
    const b = await kljucReleja(dir);
    assert.equal(a.id, b.id);
    assert.match(a.id, /^n-[0-9a-f]{16}$/);
    assert.equal(a.id, idIzKljuca(a.javni));
    const g = podpisaneGlave("GET", "/v1/listen", Buffer.alloc(0), a, 1763130000);
    assert.equal(g["X-Safeer-Time"], "1763130000");
    assert.equal(preveriPodpis("GET", "/v1/listen", Buffer.alloc(0), { "x-safeer-key": g["X-Safeer-Key"], "x-safeer-time": g["X-Safeer-Time"], "x-safeer-signature": g["X-Safeer-Signature"] }), a.id);
    if (process.platform !== "win32") {
      const { statSync } = await import("node:fs");
      assert.equal(statSync(path.join(dir, "rele-lina", "kljuc.pem")).mode & 0o777, 0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("okvirji WS: maskiran okvir od releja, prevelik okvir in nadaljevanje brez zacetka so napaka; razdeljeno sporocilo se zdruzi", () => {
  const r = new Razclenjevalec(false);
  const del1 = okvir(2, Buffer.from("ab"), null);
  del1[0] &= 0x7f; // FIN=0
  const del2 = okvir(0, Buffer.from("cd"), null);
  assert.deepEqual(r.dodaj(Buffer.concat([del1, del2.subarray(0, 2)])), []);
  const m = r.dodaj(del2.subarray(2));
  assert.equal(m.length, 1);
  assert.equal(m[0].podatki.toString(), "abcd");
  assert.throws(() => new Razclenjevalec(false).dodaj(okvir(2, Buffer.from("x"), randomBytes(4))));
  assert.throws(() => new Razclenjevalec(false).dodaj(okvir(0, Buffer.from("x"), null)));
  const velik = Buffer.alloc(10);
  velik[0] = 0x82; velik[1] = 127; velik.writeBigUInt64BE(BigInt(5 * 1024 * 1024), 2);
  assert.throws(() => new Razclenjevalec(false).dodaj(velik));
  // maskiran okvir odjemalca rele razbere
  assert.equal(new Razclenjevalec(true).dodaj(okvir(1, Buffer.from("ping"), randomBytes(4)))[0].podatki.toString(), "ping");
});

test("pregled 1: prazni nadaljevalni okvirji brez konca so napaka (ne neomejena rast pomnilnika)", () => {
  const r = new Razclenjevalec(false);
  const zacetek = okvir(2, Buffer.from("a"), null);
  zacetek[0] &= 0x7f; // FIN=0
  const prazen = okvir(0, Buffer.alloc(0), null);
  prazen[0] &= 0x7f;
  r.dodaj(zacetek);
  assert.throws(() => { for (let i = 0; i < 5000; i++) r.dodaj(prazen); }, /okvir/);
});

test("pregled 2: zavrnjene poti izven belega seznama prek releja ne zaklenejo releja za podpisane zahteve", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    for (let i = 0; i < 25; i++) assert.equal((await prekoReleja(rele, lina, ANA, "GET", `${POT}/seznani?koda=${"a".repeat(22)}`)).status, 403);
    assert.equal((await prekoReleja(rele, lina, ANA, "GET", podpisanoStanje(ANA))).status, 200);
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("pregled 3: ustavitev Line zapre odprt kanal tudi na strani releja (mesto se sprosti)", async () => {
  const rele = await lazenRele();
  const lina = await linaZRelejem(rele);
  try {
    const k = `/v1/connect?to=${lina.kljuc.id}&kanal=${randomBytes(16).toString("hex")}`;
    const ws = await odpriWs(k, podpisaneGlave("GET", k, Buffer.alloc(0), ANA.rele), lina.povezava);
    await new Promise<void>((ok) => { ws.naSporocilo = (op, p) => { if (op === 1 && p.toString() === "ready") ok(); }; });
    const tls = tlsConnect({ socket: kotDuplex(ws), ca: lina.cert, rejectUnauthorized: true,
      checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === lina.odtis ? undefined : new Error("odtis")) });
    await new Promise<void>((ok, ne) => { tls.once("secureConnect", () => ok()); tls.once("error", ne); });
    await caka(() => rele.sprejeti.length === 1);
    await lina.s.ustavi();
    await caka(() => rele.sprejeti[0].s.destroyed, 3000);
    tls.destroy();
  } finally {
    await lina.pospravi();
    await rele.ustavi();
  }
});

test("allow iz kanala: samo id, izpeljan iz shranjenega kljuca; Global Link privzeto VKLOPLJEN (lastnik 25. 11. 2026), izklopi ga samo izrecni false", async () => {
  assert.deepEqual(dovoljeniIzKanala(new Map([[ANA.id, ANA.kljuc], [TUJEC.id, ANA.kljuc], ["n-zzzz", "x"]])), [ANA.id]);
  const dir = await mkdtemp(path.join(tmpdir(), "lk-gl-"));
  try {
    assert.equal(await globalLinkVklopljen(dir), true);
    await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), "{ni json");
    assert.equal(await globalLinkVklopljen(dir), true);
    await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ globalLink: false }));
    assert.equal(await globalLinkVklopljen(dir), false);
    await writeFile(path.join(dir, NASTAVITVE_ASISTENTA), JSON.stringify({ globalLink: true }));
    assert.equal(await globalLinkVklopljen(dir), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vezava v programu: brez registracije ob zagonu (preizkusi) agent releja ne tece; z registracijo se poveze in objavi samo seznanjene", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lk-vez-"));
  const vrata = await new Promise<number>((ok) => { const x = net.createServer(); x.listen(0, "127.0.0.1", () => { const p = (x.address() as net.AddressInfo).port; x.close(() => ok(p)); }); });
  const rele = await lazenRele();
  try {
    const token = await setupOwner("geslo-test-1234", dir, { address: "127.0.0.1" });
    await pripraviKanal([{ id: ANA.id, kljuc: ANA.kljuc }], dir);
    registrirajRele(null);
    let st = await shraniAsistenta(token, { vklop: true, naslov: "127.0.0.1", vrata }, dir);
    assert.equal(st.tece, true);
    assert.equal(st.globalLink, true);              // privzeto vklopljeno (lastnik 25. 11. 2026)
    assert.equal(st.globalLinkStanje, "izklopljen"); // a brez registracije zagona ni nobene povezave na rele
    assert.equal(rele.prisotnost.size, 0);
    await ponastaviAsistenta();
    registrirajRele({ host: "127.0.0.1", port: rele.vrata, servername: "localhost", ca: rele.cert });
    st = await shraniAsistenta(token, { vklop: true, naslov: "127.0.0.1", vrata }, dir);
    await caka(() => rele.prisotnost.size === 1);
    assert.deepEqual([...rele.prisotnost.values()][0], [ANA.id]);
    assert.equal((await stanjeAsistenta(token, dir)).globalLinkStanje === "izklopljen", false);
  } finally {
    registrirajRele(null);
    await ponastaviAsistenta();
    await rele.ustavi();
    await rm(dir, { recursive: true, force: true });
  }
});
