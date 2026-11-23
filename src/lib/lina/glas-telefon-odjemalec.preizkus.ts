// Skupni pomocnik preizkusov glasu telefona: odjemalec kot telefon (TLS s pripetim odtisom + rocni WebSocket z maskami).
// Uporabljata ga glas-telefon.test.ts (L2) in naloga-glas-telefon-most.test.ts (L3); ni preizkus (brez .test.ts).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import tls from "node:tls";
import { POT_TELEFON } from "./glas-telefon.server.ts";
import { OP_BESEDILO, OP_DVOJISKO, OP_ZAPRI } from "./glas-telefon-ws.ts";

export const ZETON = randomBytes(32).toString("base64url");
export const premor = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function caka(pogoj: () => boolean, ms = 4000): Promise<void> {
  const konec = Date.now() + ms;
  while (!pogoj()) {
    if (Date.now() > konec) throw new Error("rok cakanja potekel");
    await premor(10);
  }
}

export type Odziv = { status: number; glave: Record<string, string>; telo: string };
function razberiOdziv(b: Buffer): { odziv: Odziv; ostanek: Buffer } | null {
  const i = b.indexOf("\r\n\r\n");
  if (i < 0) return null;
  const vrstice = b.subarray(0, i).toString("latin1").split("\r\n");
  const status = Number(/^HTTP\/1\.\d (\d{3})/.exec(vrstice[0] ?? "")?.[1] ?? 0);
  const glave: Record<string, string> = {};
  for (const v of vrstice.slice(1)) { const k = v.indexOf(":"); if (k > 0) glave[v.slice(0, k).toLowerCase()] = v.slice(k + 1).trim(); }
  return { odziv: { status, glave, telo: "" }, ostanek: b.subarray(i + 4) };
}

export class Odjemalec {
  readonly kosi: Buffer[] = [];
  odziv: Odziv | null = null;
  zaprta = false;
  zaprtoKoncno: Promise<void>;
  private ostanek: Buffer = Buffer.alloc(0);
  private sprejeto: Buffer = Buffer.alloc(0);
  readonly okvirji: Array<{ op: number; podatki: Buffer }> = [];
  readonly v: tls.TLSSocket;
  constructor(v: tls.TLSSocket) {
    this.v = v;
    this.zaprtoKoncno = new Promise((ok) => v.once("close", () => { this.zaprta = true; ok(); }));
    v.on("error", () => undefined);
    v.on("data", (k: Buffer) => this.naPodatkih(k));
  }
  private naPodatkih(k: Buffer): void {
    if (!this.odziv) {
      this.sprejeto = Buffer.concat([this.sprejeto, k]);
      const r = razberiOdziv(this.sprejeto);
      if (!r) return;
      this.odziv = r.odziv;
      this.ostanek = r.ostanek;
      this.sprejeto = Buffer.alloc(0);
      if (r.odziv.status !== 101) return;
      k = Buffer.alloc(0);
    }
    this.ostanek = Buffer.concat([this.ostanek, k]);
    for (;;) {
      const o = this.ostanek;
      if (o.length < 2) return;
      let d = o[1] & 0x7f;
      let g = 2;
      if (d === 126) { if (o.length < 4) return; d = o.readUInt16BE(2); g = 4; }
      else if (d === 127) { if (o.length < 10) return; d = Number(o.readBigUInt64BE(2)); g = 10; }
      if (o.length < g + d) return;
      this.okvirji.push({ op: o[0] & 0x0f, podatki: Buffer.from(o.subarray(g, g + d)) });
      this.ostanek = o.subarray(g + d);
    }
  }
  /** Okvir odjemalec -> streznik z masko (ali brez, z RSV ali brez FIN za napadalne preizkuse). */
  poslji(op: number, vsebina: Buffer, moznosti: { brezMaske?: boolean; rsv?: number; brezFin?: boolean; lazniDolzina?: bigint } = {}): void {
    const n = vsebina.length;
    const maska = randomBytes(4);
    const b0 = (moznosti.brezFin ? 0 : 0x80) | (moznosti.rsv ?? 0) | op;
    const m = moznosti.brezMaske ? 0 : 0x80;
    let glava: Buffer;
    if (moznosti.lazniDolzina !== undefined) { glava = Buffer.alloc(10); glava[0] = b0; glava[1] = m | 127; glava.writeBigUInt64BE(moznosti.lazniDolzina, 2); }
    else if (n < 126) glava = Buffer.from([b0, m | n]);
    else if (n < 65536) glava = Buffer.from([b0, m | 126, n >> 8, n & 0xff]);
    else { glava = Buffer.alloc(10); glava[0] = b0; glava[1] = m | 127; glava.writeBigUInt64BE(BigInt(n), 2); }
    const maskirano = Buffer.from(vsebina);
    if (!moznosti.brezMaske) for (let i = 0; i < n; i++) maskirano[i] ^= maska[i & 3];
    this.v.write(Buffer.concat([glava, moznosti.brezMaske ? Buffer.alloc(0) : maska, maskirano]));
  }
  besedilo(x: unknown): void { this.poslji(OP_BESEDILO, Buffer.from(typeof x === "string" ? x : JSON.stringify(x))); }
  dvojisko(b: Buffer): void { this.poslji(OP_DVOJISKO, b); }
  /** Koda zapiranja, ki jo je poslal streznik (1005 = brez kode). */
  koda(): number | null {
    const z = this.okvirji.find((o) => o.op === OP_ZAPRI);
    return z ? (z.podatki.length >= 2 ? z.podatki.readUInt16BE(0) : 1005) : null;
  }
  async cakajZaprtje(ms = 4000): Promise<void> {
    await Promise.race([this.zaprtoKoncno, premor(ms).then(() => { throw new Error("povezava ni bila zaprta"); })]);
  }
  zapri(): void { this.v.destroy(); }
}

export type Glave = Record<string, string | undefined>;
/** Odpre TLS (pripet odtis), poslje zahtevo za nadgradnjo; vrne odjemalca, ko je odgovor prebran. */
export async function odpri(z: { vrata: number; cert: string; odtis: string }, o: { pot?: string; glave?: Glave; metoda?: string; zeton?: string | null; odtis?: string; nadgradnja?: boolean } = {}): Promise<Odjemalec> {
  const v = tls.connect({
    host: "127.0.0.1", port: z.vrata, ca: z.cert, rejectUnauthorized: true,
    checkServerIdentity: (_h, c) => (c.fingerprint256.replace(/:/g, "").toLowerCase() === (o.odtis ?? z.odtis) ? undefined : new Error("odtis se ne ujema")),
  });
  await new Promise<void>((ok, ne) => { v.once("secureConnect", () => ok()); v.once("error", ne); });
  const od = new Odjemalec(v);
  const glave: Glave = {
    Host: "127.0.0.1",
    ...(o.nadgradnja === false ? {} : { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64") }),
    ...(o.zeton === null ? {} : { Authorization: `Bearer ${o.zeton ?? ZETON}` }),
    ...o.glave,
  };
  let zahteva = `${o.metoda ?? "GET"} ${o.pot ?? POT_TELEFON} HTTP/1.1\r\n`;
  for (const [k, vr] of Object.entries(glave)) if (vr !== undefined) zahteva += `${k}: ${vr}\r\n`;
  v.write(zahteva + "\r\n");
  await Promise.race([caka(() => od.odziv !== null || od.zaprta), premor(4000)]);
  return od;
}
export const odpriWs = async (z: { vrata: number; cert: string; odtis: string }, o: Parameters<typeof odpri>[1] = {}): Promise<Odjemalec> => {
  const od = await odpri(z, o);
  assert.equal(od.odziv?.status, 101, `pricakovan 101, dobljeno ${od.odziv?.status}`);
  return od;
};
