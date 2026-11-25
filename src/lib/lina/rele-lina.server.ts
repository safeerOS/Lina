/**
 * Global Link za Lino (naloga 22, lastnik 25. 11. 2026: »tudi global link mora delovati«; pravilo 06:45: Lina deluje tudi BREZ
 * drugih Safeer izdelkov). Lina sama (v svojem procesu, brez Safeer OS) poslusa na releju link.safeer.si z LASTNIM kljucem in
 * dovoli samo naprave, ki jih je lastnik seznanil z Lino (kanal-claude: id iz kljuca, kot clani kroga v Safeer Linku).
 *
 * Protokol je isti kot core/link_rele.py (AgentHuba v Safeer OS): POST /v1/presence {allow, ttl}, WS /v1/listen, ob
 * {"type":"incoming","kanal"} WS /v1/accept?kanal=...; telefon odpre WS /v1/connect?to=<id Line>&kanal=... in pocaka »ready«.
 * Glave X-Safeer-Key/Time/Signature: SHA256withECDSA (DER, base64) nad METODA\nPOT\nCAS\nhex(sha256(telo)).
 *
 * Varnost: skozi kanal tece TLS potrdila asistentke (telefon pripne odtis kot doma), zato rele vidi samo sifrirane bajte.
 * Kanal se preda AsistentStreznik.sprejmiOddaljeno: tam velja beli seznam poti (POTI_ODDALJENO), podpis naprave, okno casa
 * in enkratni niz kot doma; seznanjanje (/seznani, /koda/*) nikoli. Lina ne odpre nobenih vrat: povezava je odhodna (443).
 * Nastavitev globalLink: privzeto VKLOPLJENA (lastnik 25. 11. 2026 »da«, NALOGA-B.md); agent tece samo, ce ga registrira zagon programa.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { constants as fsKonstante } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { Duplex } from "node:stream";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { idIzKljuca } from "./kanal-claude.ts";
import { preveriKoren } from "./kanal-claude.server.ts";
import { imaPosixDovoljenja } from "./platforma.server.ts";

export const GOSTITELJ_RELEJA = "link.safeer.si";
export const PING_MS = 30_000;
/** Brez okvirja releja toliko casa je poslusalec mrtev (link_rele.MRTEV_PO_S). */
export const MRTEV_PO_PINGIH = 2.5;
/** Poslusalca obnovimo tudi, ce pong prihaja (link_rele: rele je klice dostavil le svezemu poslusalcu). */
export const OBNOVI_MS = 10 * 60_000;
export const OBJAVA_MS = 60_000;
export const NAJVEC_KANALOV = 8;
export const NAJVEC_SPOROCILO = 4 * 1024 * 1024;
const NAJVEC_GLAVA = 16 * 1024;
/** Najvec okvirjev enega razdeljenega sporocila. */
const NAJVEC_DELOV = 1024;
const ROK_ROKOVANJA_MS = 15_000;
const UA = "SafeerLink/1.0";
const KANAL = /^[0-9a-f]{32}$/;
export const ID_RELEJA = /^n-[0-9a-f]{16}$/;

export type KljucReleja = { javni: string; id: string; podpisi: (d: Buffer) => string };
/** Kam se Lina poveze (privzeto link.safeer.si:443 s sistemskimi korenskimi potrdili in preverbo imena); drugo samo za preizkuse. */
export type MoznostiPovezave = { host?: string; port?: number; servername?: string; ca?: string | Buffer };

// ------------------------------------------------------------------ kljuc Line za rele

/** Kljuc Line za rele: <mapa podatkov>/rele-lina/kljuc.pem (mapa 0700, datoteka 0600); ce ga ni, nov EC P-256. Ni kljuc TLS. */
export async function kljucReleja(root: string): Promise<KljucReleja> {
  await preveriKoren(root);
  const mapa = path.join(root, "rele-lina");
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const st = await lstat(mapa);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Mapa kljuca releja ni navadna mapa.");
  if (imaPosixDovoljenja()) await chmod(mapa, 0o700);
  const pot = path.join(mapa, "kljuc.pem");
  let zasebni: KeyObject;
  try {
    const f = await open(pot, fsKonstante.O_RDONLY | (fsKonstante.O_NOFOLLOW ?? 0));
    try {
      const s = await f.stat();
      if (!s.isFile() || s.size > 4096) throw new Error("Kljuc releja ni navadna datoteka.");
      zasebni = createPrivateKey(await f.readFile("utf8"));
    } finally {
      await f.close();
    }
    if (zasebni.asymmetricKeyType !== "ec" || zasebni.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Kljuc releja ni EC P-256.");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    zasebni = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    // wx: nikoli ne prepise obstojece datoteke (tekma dveh zagonov: drugi pade in prebere prvega ob naslednjem zagonu)
    const f = await open(pot, "wx", 0o600);
    try { await f.writeFile(zasebni.export({ format: "pem", type: "pkcs8" }) as string); } finally { await f.close(); }
  }
  if (imaPosixDovoljenja()) await chmod(pot, 0o600);
  const javni = (createPublicKey(zasebni).export({ format: "der", type: "spki" }) as Buffer).toString("base64");
  return { javni, id: idIzKljuca(javni), podpisi: (d) => sign("sha256", d, zasebni).toString("base64") };
}

/** Glave X-Safeer-* kot link_rele.podpisane_glave (cas v sekundah). */
export function podpisaneGlave(metoda: string, pot: string, telo: Buffer, k: KljucReleja, cas = Math.floor(Date.now() / 1000)): Record<string, string> {
  const t = String(cas);
  const sporocilo = Buffer.from(`${metoda}\n${pot}\n${t}\n${createHash("sha256").update(telo).digest("hex")}`, "utf8");
  return { "X-Safeer-Key": k.javni, "X-Safeer-Time": t, "X-Safeer-Signature": k.podpisi(sporocilo) };
}

// ------------------------------------------------------------------ najmanjsi WebSocket (RFC 6455)

/** Okvir s FIN=1; [maska] = null za nemaskiran okvir (strezniska stran), sicer 4 bajti (odjemalec mora maskirati). */
export function okvir(op: number, podatki: Buffer, maska: Buffer | null = randomBytes(4)): Buffer {
  const n = podatki.length;
  const dolzina = n < 126 ? Buffer.from([n]) : n < 65536 ? Buffer.from([126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(9); b[0] = 127; b.writeBigUInt64BE(BigInt(n), 1); return b; })();
  if (maska) dolzina[0] |= 0x80;
  const telo = maska ? Buffer.from(podatki.map((x, i) => x ^ maska[i & 3])) : podatki;
  return Buffer.concat([Buffer.from([0x80 | (op & 0x0f)]), dolzina, ...(maska ? [maska] : []), telo]);
}

export type Sporocilo = { op: number; podatki: Buffer };
/**
 * Razclenjevalec okvirjev. [maskirano] = kaj pricakujemo (rele -> Lina: nemaskirano; maskiran okvir je napaka po RFC 6455 5.1).
 * Zdruzi razdeljena sporocila (nadaljevanje brez zacetka = napaka); vsako sporocilo najvec NAJVEC_SPOROCILO.
 */
export class Razclenjevalec {
  private buf: Buffer = Buffer.alloc(0);
  private deli: Buffer[] = [];
  private opDela = -1;
  private velikostDela = 0;
  private steviloDelov = 0;
  private readonly maskirano: boolean;
  constructor(maskirano: boolean) {
    this.maskirano = maskirano;
  }

  dodaj(b: Buffer): Sporocilo[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, b]) : b;
    const izhod: Sporocilo[] = [];
    for (;;) {
      if (this.buf.length < 2) return izhod;
      const fin = (this.buf[0] & 0x80) !== 0;
      const op = this.buf[0] & 0x0f;
      if ((this.buf[0] & 0x70) !== 0) throw new Error("ws: rezervirani biti");
      const m = (this.buf[1] & 0x80) !== 0;
      if (m !== this.maskirano) throw new Error("ws: napacno maskiranje");
      let n = this.buf[1] & 0x7f;
      let i = 2;
      if (n === 126) { if (this.buf.length < 4) return izhod; n = this.buf.readUInt16BE(2); i = 4; }
      else if (n === 127) {
        if (this.buf.length < 10) return izhod;
        const v = this.buf.readBigUInt64BE(2);
        if (v > BigInt(NAJVEC_SPOROCILO)) throw new Error("ws: prevelik okvir");
        n = Number(v); i = 10;
      }
      if (n > NAJVEC_SPOROCILO) throw new Error("ws: prevelik okvir");
      const maska = m ? this.buf.subarray(i, i + 4) : null;
      if (m) i += 4;
      if (this.buf.length < i + n) return izhod;
      let p = this.buf.subarray(i, i + n);
      if (maska) p = Buffer.from(p.map((x, j) => x ^ maska[j & 3]));
      this.buf = this.buf.subarray(i + n);
      if (op >= 8) {
        if (!fin || n > 125) throw new Error("ws: nadzorni okvir");
        izhod.push({ op, podatki: Buffer.from(p) });
        continue;
      }
      if (op === 0) { if (this.opDela < 0) throw new Error("ws: nadaljevanje brez zacetka"); }
      else if (this.opDela >= 0) throw new Error("ws: novo sporocilo med delnim");
      else this.opDela = op;
      this.velikostDela += n;
      // pregled 1: tudi prazni nadaljevalni okvirji stejejo (sicer neomejeno stevilo kosov v pomnilniku)
      if (++this.steviloDelov > NAJVEC_DELOV) throw new Error("ws: prevec okvirjev");
      if (this.velikostDela > NAJVEC_SPOROCILO) throw new Error("ws: prevelik okvir");
      this.deli.push(Buffer.from(p));
      if (fin) {
        izhod.push({ op: this.opDela, podatki: Buffer.concat(this.deli) });
        this.deli = []; this.opDela = -1; this.velikostDela = 0; this.steviloDelov = 0;
      }
    }
  }
}

export type WsPovezava = {
  /** Podatkovna (1, 2) sporocila; ping in close obravnava povezava sama. */
  naSporocilo: (op: number, podatki: Buffer) => void;
  naKoncu: () => void;
  /** false = vticnica releja je polna (pocakaj »drain«). */
  poslji: (op: number, podatki: Buffer) => boolean;
  zapri: () => void;
  readonly vticnica: TLSSocket;
};

function tlsDoReleja(o: MoznostiPovezave): TLSSocket {
  const host = o.host ?? GOSTITELJ_RELEJA;
  // privzeto: sistemska korenska potrdila in preverba imena (rejectUnauthorized je v Nodu privzeto true)
  return tlsConnect({ host, port: o.port ?? 443, servername: o.servername ?? GOSTITELJ_RELEJA, minVersion: "TLSv1.2", rejectUnauthorized: true, ...(o.ca ? { ca: o.ca } : {}) });
}

/** WS odjemalec do releja: rokovanje HTTP/1.1 101 s preverbo Sec-WebSocket-Accept, nato okvirji. Napaka ali rok = zavrnitev. */
export function odpriWs(pot: string, glave: Record<string, string>, o: MoznostiPovezave = {}): Promise<WsPovezava> {
  return new Promise((ok, ne) => {
    const s = tlsDoReleja(o);
    const kljucWs = randomBytes(16).toString("base64");
    const pricakovano = createHash("sha1").update(kljucWs + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    let buf = Buffer.alloc(0);
    let odprto = false;
    const rok = setTimeout(() => { s.destroy(); ne(new Error("rele: rok rokovanja")); }, ROK_ROKOVANJA_MS);
    const r = new Razclenjevalec(false);
    let konec = false;
    const ws: WsPovezava = {
      naSporocilo: () => undefined,
      naKoncu: () => undefined,
      poslji: (op, p) => (!s.destroyed && !konec ? s.write(okvir(op, p)) : true),
      zapri: () => {
        if (konec) return;
        konec = true;
        try { if (!s.destroyed) s.end(okvir(8, Buffer.alloc(0))); } catch { /* ze zaprta */ }
        setTimeout(() => s.destroy(), 1000).unref?.();
      },
      vticnica: s,
    };
    const hrani = (b: Buffer) => {
      let m: Sporocilo[];
      try { m = r.dodaj(b); } catch { s.destroy(); return; }
      for (const x of m) {
        if (x.op === 9) ws.poslji(10, x.podatki);
        else if (x.op === 8) { ws.zapri(); s.destroy(); return; }
        else if (x.op === 1 || x.op === 2) ws.naSporocilo(x.op, x.podatki);
      }
    };
    s.on("data", (b: Buffer) => {
      if (odprto) return hrani(b);
      buf = Buffer.concat([buf, b]);
      if (buf.length > NAJVEC_GLAVA) { s.destroy(); return; }
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return;
      const vrstice = buf.subarray(0, i).toString("latin1").split("\r\n");
      const g = new Map<string, string>();
      for (const v of vrstice.slice(1)) { const k = v.indexOf(":"); if (k > 0) g.set(v.slice(0, k).trim().toLowerCase(), v.slice(k + 1).trim()); }
      if (!/^HTTP\/1\.1 101 /.test(vrstice[0]) || g.get("sec-websocket-accept") !== pricakovano || (g.get("upgrade") ?? "").toLowerCase() !== "websocket") {
        clearTimeout(rok);
        s.destroy();
        ne(new Error(`rele: ${vrstice[0].slice(0, 60).replace(/[^ -~]/g, "?")}`)); // pregled 6: brez nadzornih znakov v dnevnik
        return;
      }
      odprto = true;
      clearTimeout(rok);
      ok(ws);
      const ostanek = buf.subarray(i + 4);
      buf = Buffer.alloc(0);
      if (ostanek.length) queueMicrotask(() => hrani(ostanek));
    });
    s.once("secureConnect", () => {
      const vrstice = [`GET ${pot} HTTP/1.1`, `Host: ${GOSTITELJ_RELEJA}`, `User-Agent: ${UA}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${kljucWs}`, "Sec-WebSocket-Version: 13", ...Object.entries(glave).map(([k, v]) => `${k}: ${v}`)];
      s.write(vrstice.join("\r\n") + "\r\n\r\n");
    });
    s.on("error", () => s.destroy());
    s.once("close", () => {
      clearTimeout(rok);
      konec = true;
      if (!odprto) ne(new Error("rele: povezava zaprta"));
      else ws.naKoncu();
    });
  });
}

/** Kanal releja kot tok bajtov (za TLSSocket streznika): binarna sporocila v obe smeri, besedilna (»ready«) se ne prenasajo. */
export function kotDuplex(ws: WsPovezava): Duplex {
  const d = new Duplex({
    read() {},
    write(kos: Buffer, _k, cb) {
      try {
        let prosto = true;
        for (let i = 0; i < kos.length; i += 16 * 1024) prosto = ws.poslji(2, kos.subarray(i, i + 16 * 1024)) && prosto;
        // povratni pritisk: velik odgovor (npr. APK) se ne kopici v pomnilniku Line, ce je rele pocasnejsi
        if (prosto || ws.vticnica.destroyed) cb(); else ws.vticnica.once("drain", () => cb());
      } catch (e) { cb(e as Error); }
    },
    final(cb) { ws.zapri(); cb(); },
    destroy(napaka, cb) { ws.zapri(); ws.vticnica.destroy(); cb(napaka); },
  });
  ws.naSporocilo = (op, p) => { if (op === 2) d.push(p); };
  ws.naKoncu = () => { d.push(null); d.destroy(); };
  return d;
}

/** Allow za rele iz seznama naprav kanala (id -> kljuc): samo id, ki je res izpeljan iz shranjenega kljuca (kot v Safeer Linku). */
export function dovoljeniIzKanala(dovoljene: ReadonlyMap<string, string>): string[] {
  const izhod: string[] = [];
  for (const [id, kljuc] of dovoljene) {
    try {
      if (ID_RELEJA.test(id) && idIzKljuca(kljuc) === id) izhod.push(id);
    } catch { /* neveljaven kljuc se izpusti */ }
  }
  return izhod;
}

// ------------------------------------------------------------------ agent: Lina poslusa na releju

export type MoznostiAgenta = {
  kljuc: KljucReleja;
  /** Id-ji naprav, ki jih je lastnik seznanil z Lino (bere se ob vsaki objavi: umik velja ob naslednji objavi, zahteve pa takoj). */
  dovoljeni: () => Promise<string[]>;
  /** Preda kanal strezniku (AsistentStreznik.sprejmiOddaljeno); false = zavrnjen. */
  sprejmi: (d: Duplex) => boolean;
  povezava?: MoznostiPovezave;
  dnevnik?: (s: string) => void;
  pingMs?: number;
};
export type StanjeAgenta = "izklopljen" | "povezujem" | "povezan" | "napaka";

export class AgentReleja {
  stanje: StanjeAgenta = "izklopljen";
  private ustavljen = true;
  private ws: WsPovezava | null = null;
  private kanali = 0;
  /** Pregled 0213 A12: sprejeti kanali, da jih ustavi() zapre (ne samo poslusalca). */
  private readonly odprtiKanali = new Set<{ destroy(): void }>();
  private budilka: (() => void) | null = null;
  private readonly m: MoznostiAgenta;
  private readonly dnevnik: (s: string) => void;

  constructor(m: MoznostiAgenta) {
    this.m = m;
    this.dnevnik = m.dnevnik ?? ((s) => process.stderr.write(`[lina-rele] ${s}\n`));
  }

  zazeni(): void {
    if (!this.ustavljen) return;
    this.ustavljen = false;
    void this.zanka();
  }

  ustavi(): void {
    this.ustavljen = true;
    this.stanje = "izklopljen";
    this.ws?.zapri();
    this.ws?.vticnica.destroy();
    this.ws = null;
    for (const k of this.odprtiKanali) k.destroy();
    this.odprtiKanali.clear();
    this.budilka?.();
  }

  private premor(ms: number): Promise<void> {
    return new Promise((ok) => {
      const t = setTimeout(() => { this.budilka = null; ok(); }, ms);
      this.budilka = () => { clearTimeout(t); this.budilka = null; ok(); };
    });
  }

  private async dovoljeni(): Promise<string[]> {
    const ids = await this.m.dovoljeni();
    return [...new Set(ids.filter((x) => ID_RELEJA.test(x) && x !== this.m.kljuc.id))].slice(0, 256);
  }

  /** POST /v1/presence: kdo sme do Line (samo seznanjene naprave), ttl 120 s. */
  private async objavi(): Promise<void> {
    const telo = Buffer.from(JSON.stringify({ allow: await this.dovoljeni(), ttl: 120 }));
    const o = this.m.povezava ?? {};
    await new Promise<void>((ok, ne) => {
      const r = httpsRequest({
        host: o.host ?? GOSTITELJ_RELEJA, port: o.port ?? 443, servername: o.servername ?? GOSTITELJ_RELEJA, ...(o.ca ? { ca: o.ca } : {}),
        method: "POST", path: "/v1/presence", agent: false, timeout: 15_000, minVersion: "TLSv1.2",
        headers: { ...podpisaneGlave("POST", "/v1/presence", telo, this.m.kljuc), "Content-Type": "application/json", "User-Agent": UA, Host: GOSTITELJ_RELEJA, "Content-Length": telo.length },
      }, (res) => {
        res.resume();
        res.on("end", () => ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300 ? ok() : ne(new Error(`prisotnost ${res.statusCode}`))));
      });
      r.on("timeout", () => r.destroy(new Error("prisotnost: rok")));
      r.on("error", ne);
      r.end(telo);
    });
  }

  private kanal(kanal: string): void {
    if (this.kanali >= NAJVEC_KANALOV) { this.dnevnik("prevec kanalov hkrati - kanal zavrnjen"); return; }
    this.kanali++;
    const pot = `/v1/accept?kanal=${kanal}`;
    let sproscen = false;
    const sprosti = () => { if (!sproscen) { sproscen = true; this.kanali--; } };
    odpriWs(pot, podpisaneGlave("GET", pot, Buffer.alloc(0), this.m.kljuc), this.m.povezava).then((ws) => {
      ws.vticnica.once("close", sprosti);
      if (this.ustavljen) { ws.zapri(); return; }
      this.odprtiKanali.add(ws.vticnica);
      ws.vticnica.once("close", () => this.odprtiKanali.delete(ws.vticnica));
      const d = kotDuplex(ws);
      if (!this.m.sprejmi(d)) d.destroy();
    }, () => { sprosti(); this.dnevnik("kanala ni bilo mogoce odpreti"); });
  }

  private async zanka(): Promise<void> {
    let cakaj = 5_000;
    const ping = this.m.pingMs ?? PING_MS;
    while (!this.ustavljen) {
      this.stanje = "povezujem";
      try {
        await this.objavi();
        if (this.ustavljen) break;
        const ws = await odpriWs("/v1/listen", podpisaneGlave("GET", "/v1/listen", Buffer.alloc(0), this.m.kljuc), this.m.povezava);
        if (this.ustavljen) { ws.zapri(); break; }
        this.ws = ws;
        this.stanje = "povezan";
        cakaj = 5_000;
        let zadnji = Date.now();
        const zacetek = Date.now();
        let objava = Date.now();
        await new Promise<void>((konec) => {
          ws.naKoncu = konec;
          ws.naSporocilo = (op, p) => {
            zadnji = Date.now();
            if (op !== 1 || p[0] !== 0x7b) return; // samo JSON; »pong« samo osvezi zadnji okvir
            try {
              const s = JSON.parse(p.toString("utf8")) as { type?: unknown; kanal?: unknown };
              if (s.type === "incoming" && typeof s.kanal === "string" && KANAL.test(s.kanal)) this.kanal(s.kanal);
            } catch { /* neveljavno sporocilo releja se zavrze */ }
          };
          const t = setInterval(() => {
            if (this.ws !== ws) { clearInterval(t); return; }
            const zdaj = Date.now();
            if (zdaj - zadnji > ping * MRTEV_PO_PINGIH || zdaj - zacetek > OBNOVI_MS) {
              clearInterval(t);
              ws.zapri();
              ws.vticnica.destroy();
              return;
            }
            ws.poslji(1, Buffer.from("ping"));
            if (zdaj - objava > OBJAVA_MS) { objava = zdaj; this.objavi().catch(() => undefined); }
          }, ping);
          t.unref?.();
          ws.vticnica.once("close", () => clearInterval(t));
        });
        if (this.ws === ws) this.ws = null;
        // rele je zaprl poslusalca (ali obnova): kratek premor, da zaprtje takoj po prijavi ne postane vroca zanka
        if (!this.ustavljen) await this.premor(1_000);
      } catch (e) {
        if (this.ustavljen) break;
        this.stanje = "napaka";
        this.dnevnik(`rele: ${(e as Error).message.slice(0, 120)}; znova cez ${cakaj / 1000} s`);
        await this.premor(cakaj);
        cakaj = Math.min(cakaj * 2, 300_000);
      }
    }
    this.stanje = "izklopljen";
  }
}
