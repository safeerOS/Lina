/**
 * Oglas DNS-SD (mDNS, RFC 6762/6763) za seznanitev s kodo: telefon brez QR najde naslov Line. Vzorec Safeer Linka
 * (_safeercast._tcp v core/link_hub_streznik.py, iskanje core/link_hub.py), a brez paketa zeroconf: lasten majhen odzivnik
 * prek node:dgram, ista koda na Linuxu in Windows (avahi-publish obstaja samo na Linuxu; meritev v AGENTS.md).
 *
 * Kaj oglas pove: samo storitev _safeer-lina._tcp, vrata, naslov in TXT "v=1". Brez odtisa, imena racunalnika ali
 * uporabnika - ime je »Lina <4 hex>«, gostitelj lina-<4 hex>.local, pripona je nakljucna ob vsakem odprtju okna.
 * Oglas tece SAMO, dokler je okno kode odprto (asistent-telefon.server.ts), samo na zasebnem naslovu asistentke in odgovarja
 * samo posiljateljem iz istega omrezja (Linux z IP_MULTICAST_ALL socketu da tudi pakete z drugih vmesnikov).
 */
import { createSocket, type Socket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";

export const SKUPINA = "224.0.0.251";
export const VRATA_MDNS = 5353;
export const STORITEV = "_safeer-lina._tcp.local";
const NAJVEC_PAKET = 1500;
const [A, PTR, TXT, SRV, ANY] = [1, 12, 16, 33, 255];

export type Vticnica = Pick<Socket, "on" | "send" | "close"> & {
  bind(o: { port: number; address: string }, cb: () => void): unknown;
  addMembership(skupina: string, vmesnik: string): void;
  setMulticastInterface(vmesnik: string): void;
  setMulticastTTL(ttl: number): void;
};

function ime(n: string): Buffer {
  const deli: Buffer[] = [];
  for (const l of n.split(".")) {
    const b = Buffer.from(l, "utf8");
    if (b.length < 1 || b.length > 63) throw new Error("neveljavno ime DNS");
    deli.push(Buffer.from([b.length]), b);
  }
  deli.push(Buffer.from([0]));
  return Buffer.concat(deli);
}

function zapis(n: string, tip: number, razred: number, ttl: number, podatki: Buffer): Buffer {
  const g = Buffer.alloc(10);
  g.writeUInt16BE(tip, 0);
  g.writeUInt16BE(razred, 2);
  g.writeUInt32BE(ttl, 4);
  g.writeUInt16BE(podatki.length, 8);
  return Buffer.concat([ime(n), g, podatki]);
}

/** Ime iz paketa (s kazalci stiskanja, omejeno stevilo skokov); null = pokvarjen paket. */
function beriIme(p: Buffer, i: number): { ime: string; konec: number } | null {
  const deli: string[] = [];
  let konec = -1;
  for (let skokov = 0; skokov < 64; skokov++) {
    if (i >= p.length) return null;
    const d = p[i];
    if (d === 0) return { ime: deli.join(".").toLowerCase(), konec: konec < 0 ? i + 1 : konec };
    if ((d & 0xc0) === 0xc0) {
      if (i + 1 >= p.length) return null;
      if (konec < 0) konec = i + 2;
      i = ((d & 0x3f) << 8) | p[i + 1];
      continue;
    }
    if (d > 63 || i + 1 + d > p.length) return null;
    deli.push(p.subarray(i + 1, i + 1 + d).toString("utf8"));
    i += 1 + d;
  }
  return null;
}

/** Vprasanja iz poizvedbe mDNS; odgovori (bit QR) in pokvarjeni paketi vrnejo []. */
export function vprasanja(p: Buffer): Array<{ ime: string; tip: number; unicast: boolean }> {
  if (p.length < 12 || p.length > 9000 || p[2] & 0x80) return [];
  const st = p.readUInt16BE(4);
  const izid: Array<{ ime: string; tip: number; unicast: boolean }> = [];
  let i = 12;
  for (let k = 0; k < Math.min(st, 32); k++) {
    const r = beriIme(p, i);
    if (!r || r.konec + 4 > p.length) return izid;
    izid.push({ ime: r.ime, tip: p.readUInt16BE(r.konec), unicast: (p.readUInt16BE(r.konec + 2) & 0x8000) !== 0 });
    i = r.konec + 4;
  }
  return izid;
}

function ipv4(n: string): number | null {
  const d = n.split(".").map(Number);
  if (d.length !== 4 || d.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
}

/** Ali je posiljatelj v istem omrezju IPv4 kot nas naslov (maska vmesnika). */
export function istoOmrezje(vir: string, naslov: string, maska: string): boolean {
  const [v, n, m] = [ipv4(vir), ipv4(naslov), ipv4(maska)];
  if (v === null || n === null || m === null || m === 0) return false;
  return ((v & m) >>> 0) === ((n & m) >>> 0);
}

export function maskaNaslova(naslov: string, vmesniki = networkInterfaces()): string | null {
  for (const v of Object.values(vmesniki)) for (const e of v ?? []) if (e.family === "IPv4" && e.address === naslov) return e.netmask;
  return null;
}

export type MoznostiOglasa = {
  naslov: string;
  vrata: number;
  /** Za preizkuse: lazno omrezje namesto prave vticnice in maska namesto networkInterfaces(). */
  vticnica?: () => Vticnica;
  maska?: string;
  platforma?: NodeJS.Platform;
  pripona?: string;
};

export class OglasMdns {
  readonly primerek: string;
  readonly gostitelj: string;
  private s: Vticnica | null = null;
  private casovniki: ReturnType<typeof setTimeout>[] = [];
  private readonly m: MoznostiOglasa;
  private readonly maska: string;

  constructor(m: MoznostiOglasa) {
    if (ipv4(m.naslov) === null || m.naslov.startsWith("127.")) throw new Error("Oglas samo na zasebnem naslovu IPv4 domacega omrezja.");
    const maska = m.maska ?? maskaNaslova(m.naslov);
    if (!maska) throw new Error("Naslova ni na nobenem vmesniku.");
    this.m = m;
    this.maska = maska;
    const p = m.pripona ?? randomBytes(2).toString("hex");
    this.primerek = `Lina ${p}`;
    this.gostitelj = `lina-${p}.local`;
  }

  /** Zapisi odgovora; ttl 0 = slovo (RFC 6762, 10.1). */
  odgovor(ttl = 120, id = 0, vprasanje?: Buffer): Buffer {
    const inst = `${this.primerek}.${STORITEV}`;
    const flush = id ? 1 : 0x8001; // klasicni unicast odgovor brez bita cache-flush
    const t = id ? Math.min(ttl, 10) : ttl;
    const srv = Buffer.alloc(6);
    srv.writeUInt16BE(this.m.vrata, 4);
    const ip = Buffer.alloc(4);
    ip.writeUInt32BE(ipv4(this.m.naslov) as number);
    const an = [
      zapis(STORITEV, PTR, 1, id ? t : ttl === 0 ? 0 : 4500, ime(inst)),
      zapis(inst, SRV, flush, t, Buffer.concat([srv, ime(this.gostitelj)])),
      zapis(inst, TXT, flush, id ? t : ttl === 0 ? 0 : 4500, Buffer.from([3, ...Buffer.from("v=1")])),
      zapis(this.gostitelj, A, flush, t, ip),
    ];
    const g = Buffer.alloc(12);
    g.writeUInt16BE(id, 0);
    g.writeUInt16BE(0x8400, 2);
    g.writeUInt16BE(vprasanje ? 1 : 0, 4);
    g.writeUInt16BE(an.length, 6);
    return Buffer.concat([g, ...(vprasanje ? [vprasanje] : []), ...an]);
  }

  private zame(v: { ime: string; tip: number }): boolean {
    const inst = `${this.primerek}.${STORITEV}`.toLowerCase();
    if (v.ime === STORITEV) return v.tip === PTR || v.tip === ANY;
    if (v.ime === inst) return v.tip === SRV || v.tip === TXT || v.tip === ANY;
    if (v.ime === this.gostitelj) return v.tip === A || v.tip === ANY;
    return false;
  }

  private paket(p: Buffer, vir: { address: string; port: number }): void {
    if (!this.s || p.length > 9000 || !istoOmrezje(vir.address, this.m.naslov, this.maska)) return;
    const vpr = vprasanja(p).filter((v) => this.zame(v));
    if (!vpr.length) return;
    if (vir.port !== VRATA_MDNS) {
      // klasicna poizvedba (RFC 6762, 6.7): odgovor samo posiljatelju, z isto stevilko in vprasanjem
      const prvo = vpr[0];
      const q = Buffer.concat([ime(prvo.ime), Buffer.from([0, prvo.tip, 0, 1])]);
      this.poslji(this.odgovor(120, p.readUInt16BE(0) || 1, q), vir.address, vir.port);
      return;
    }
    if (vpr.some((v) => v.unicast)) this.poslji(this.odgovor(), vir.address, vir.port);
    else this.poslji(this.odgovor(), SKUPINA, VRATA_MDNS);
  }

  private poslji(b: Buffer, naslov: string, vrata: number): void {
    if (b.length > NAJVEC_PAKET) return;
    try { this.s?.send(b, vrata, naslov); } catch { /* omrezje ni dosegljivo: oglas ni pogoj za seznanitev */ }
  }

  async zacni(): Promise<void> {
    if (this.s) return;
    const s = this.m.vticnica ? this.m.vticnica() : (createSocket({ type: "udp4", reuseAddr: true }) as unknown as Vticnica);
    s.on("error", () => undefined);
    s.on("message", (p: Buffer, r: { address: string; port: number }) => this.paket(p, r));
    // Linux: multicast dobi samo vticnica na skupini ali 0.0.0.0 - vezemo na skupino (ne 0.0.0.0); Windows: na nas naslov.
    const naslov = (this.m.platforma ?? process.platform) === "win32" ? this.m.naslov : SKUPINA;
    await new Promise<void>((ok, ne) => {
      s.on("error", ne);
      s.bind({ port: VRATA_MDNS, address: naslov }, () => ok());
    });
    s.addMembership(SKUPINA, this.m.naslov);
    s.setMulticastInterface(this.m.naslov);
    s.setMulticastTTL(255);
    this.s = s;
    // napoved ob zacetku (RFC 6762, 8.3): dvakrat, sekundo narazen
    this.poslji(this.odgovor(), SKUPINA, VRATA_MDNS);
    const c = setTimeout(() => this.poslji(this.odgovor(), SKUPINA, VRATA_MDNS), 1000);
    c.unref?.();
    this.casovniki.push(c);
  }

  /** Slovo (TTL 0), nato vticnica zaprta - telefon storitve ne vidi vec. */
  ustavi(): void {
    for (const c of this.casovniki) clearTimeout(c);
    this.casovniki = [];
    const s = this.s;
    if (!s) return;
    this.s = null;
    const zapri = () => { try { s.close(); } catch { /* ze zaprta */ } };
    // zapremo sele, ko je slovo poslano (close pred tem bi ga lahko zavrgel)
    try { s.send(this.odgovor(0), VRATA_MDNS, SKUPINA, zapri); } catch { zapri(); }
  }

  tece(): boolean {
    return !!this.s;
  }
}
