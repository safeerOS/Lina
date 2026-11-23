/**
 * SPAKE2 (RFC 9382) nad P-256 za seznanjanje telefona s 6-mestno kodo. PREPIS Safeer Linka: core/spake2.py (Safeer-linux)
 * in Spake2.kt (Android-tv) - isti zapis tock, isti PBKDF2 kode, isti transkript in potrditve. Ujemanje bajt za bajtom
 * drzita vektor RFC 9382 (dodatek C) in vektor iz Pythona s kodo 482913 (spake2.test.ts, izracunan 14. 11. 2026).
 *
 * Koda ne potuje po omrezju; kdor je ne pozna, iz izmenjanih sporocil ne izve nic in je ne more ugibati brez povezave -
 * vsak poskus je nov krog s streznikom, ki ga steje (varovalka-kode.ts). Brez zunanjih paketov: aritmetika z BigInt.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const A = P - 3n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
export const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;
// Tocki M in N iz RFC 9382, razdelek 6 (P-256), enaki kot v core/spake2.py.
const M_HEX = "02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f";
const N_HEX = "03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49";

export type Tocka = { x: bigint; y: bigint } | null; // null = tocka v neskoncnosti

const mod = (a: bigint, m = P) => ((a % m) + m) % m;
function potenca(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inv = (a: bigint) => potenca(mod(a), P - 2n, P);

function sestej(p1: Tocka, p2: Tocka): Tocka {
  if (!p1) return p2;
  if (!p2) return p1;
  let lam: bigint;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y) === 0n) return null;
    lam = mod((3n * p1.x * p1.x + A) * inv(2n * p1.y));
  } else {
    lam = mod((p2.y - p1.y) * inv(p2.x - p1.x));
  }
  const x3 = mod(lam * lam - p1.x - p2.x);
  return { x: x3, y: mod(lam * (p1.x - x3) - p1.y) };
}

/** Afina razlicica (inverz pri vsakem sestevanju): ostane kot referenca preizkusov, ne pa v krogu protokola. */
export function pomnoziAfino(k: bigint, t: Tocka): Tocka {
  k = mod(k, N);
  let r: Tocka = null;
  let o = t;
  while (k > 0n) {
    if (k & 1n) r = sestej(r, o);
    o = sestej(o, o);
    k >>= 1n;
  }
  return r;
}

// Jacobijeve koordinate (X, Y, Z): x = X/Z^2, y = Y/Z^3; Z = 0 je tocka v neskoncnosti. Samo en inverz na mnozenje namesto
// ~380 (T1-S2: krog SPAKE2 je sinhron in je s afino aritmetiko blokiral zanko dogodkov ~145 ms, kjer tecejo tudi klici).
type Jac = [bigint, bigint, bigint];
const JNIC: Jac = [1n, 1n, 0n];

function jPodvoji([x, y, z]: Jac): Jac {
  if (z === 0n || y === 0n) return JNIC;
  const delta = (z * z) % P;
  const gama = (y * y) % P;
  const beta = (x * gama) % P;
  const alfa = (3n * mod(x - delta) * (x + delta)) % P; // a = -3: 3 (X - Z^2)(X + Z^2)
  const x3 = mod(alfa * alfa - 8n * beta);
  const z3 = mod((y + z) * (y + z) - gama - delta);
  const y3 = mod(alfa * (4n * beta - x3) - 8n * gama * gama);
  return [x3, y3, z3];
}

/** Jacobijeva tocka + afina tocka (mesano sestevanje). */
function jSestej(p: Jac, q: { x: bigint; y: bigint }): Jac {
  const [x1, y1, z1] = p;
  if (z1 === 0n) return [q.x, q.y, 1n];
  const z1z1 = (z1 * z1) % P;
  const u2 = (q.x * z1z1) % P;
  const s2 = (q.y * z1 % P) * z1z1 % P;
  const h = mod(u2 - x1);
  const r2 = mod(2n * (s2 - y1));
  if (h === 0n) return r2 === 0n ? jPodvoji(p) : JNIC;
  const hh = (h * h) % P;
  const i = 4n * hh;
  const j = (h * i) % P;
  const v = (x1 * i) % P;
  const x3 = mod(r2 * r2 - j - 2n * v);
  const y3 = mod(r2 * (v - x3) - 2n * y1 * j);
  const z3 = mod((z1 + h) * (z1 + h) - z1z1 - hh);
  return [x3, y3, z3];
}

export function pomnozi(k: bigint, t: Tocka): Tocka {
  k = mod(k, N);
  if (!t || k === 0n) return null;
  let r: Jac = JNIC;
  for (let i = k.toString(2).length - 1; i >= 0; i--) {
    r = jPodvoji(r);
    if ((k >> BigInt(i)) & 1n) r = jSestej(r, t);
  }
  if (r[2] === 0n) return null;
  const zi = inv(r[2]);
  const zi2 = (zi * zi) % P;
  return { x: (r[0] * zi2) % P, y: (r[1] * zi2 % P) * zi % P };
}

const negiraj = (t: Tocka): Tocka => (t ? { x: t.x, y: mod(-t.y) } : null);

function naKrivulji(t: Tocka): boolean {
  if (!t) return false;
  return t.x >= 0n && t.x < P && t.y >= 0n && t.y < P && mod(t.y * t.y - (t.x * t.x * t.x + A * t.x + B)) === 0n;
}

const vBajte = (v: bigint, n = 32) => Buffer.from(v.toString(16).padStart(n * 2, "0"), "hex");
const izBajtov = (b: Buffer) => BigInt("0x" + (b.toString("hex") || "0"));

export function kodiraj(t: Tocka): Buffer {
  if (!t) throw new Error("tocke v neskoncnosti ni mogoce kodirati");
  return Buffer.concat([Buffer.from([4]), vBajte(t.x), vBajte(t.y)]);
}

/** Nestisnjena (65 B) ali stisnjena (33 B) tocka; vse, kar ni na krivulji, je napaka (kofaktor P-256 je 1). */
export function dekodiraj(b: Buffer): Tocka {
  let t: Tocka;
  if (b.length === 65 && b[0] === 4) {
    t = { x: izBajtov(b.subarray(1, 33)), y: izBajtov(b.subarray(33, 65)) };
  } else if (b.length === 33 && (b[0] === 2 || b[0] === 3)) {
    const x = izBajtov(b.subarray(1));
    if (x >= P) throw new Error("tocka ni na krivulji");
    const y2 = mod(x * x * x + A * x + B);
    let y = potenca(y2, (P + 1n) / 4n, P);
    if (mod(y * y - y2) !== 0n) throw new Error("tocka ni na krivulji");
    if ((y & 1n) !== BigInt(b[0] & 1)) y = P - y;
    t = { x, y };
  } else {
    throw new Error("neveljaven zapis tocke");
  }
  if (!naKrivulji(t)) throw new Error("tocka ni na krivulji");
  return t;
}

const G: Tocka = { x: GX, y: GY };
const TM = dekodiraj(Buffer.from(M_HEX, "hex"));
const TN = dekodiraj(Buffer.from(N_HEX, "hex"));

function dolz(b: Buffer): Buffer {
  const d = Buffer.alloc(8);
  d.writeBigUInt64LE(BigInt(b.length));
  return Buffer.concat([d, b]);
}

/** w = PBKDF2-SHA256(koda, sol = id seznanitve, 20000, 48 B) mod n - kot w_iz_kode v core/spake2.py. */
export function wIzKode(koda: string, sol: Buffer): bigint {
  const surovo = pbkdf2Sync(Buffer.from(koda.trim(), "utf8"), sol.length ? sol : Buffer.from([0]), 20000, 48, "sha256");
  return izBajtov(surovo) % N;
}

function hkdf(ikm: Buffer, sol: Buffer, info: Buffer, dolzina: number): Buffer {
  const prk = createHmac("sha256", sol.length ? sol : Buffer.alloc(32)).update(ikm).digest();
  const izhod: Buffer[] = [];
  let blok = Buffer.alloc(0);
  let skupaj = 0;
  for (let i = 1; skupaj < dolzina; i++) {
    blok = createHmac("sha256", prk).update(Buffer.concat([blok, info, Buffer.from([i])])).digest();
    izhod.push(blok);
    skupaj += blok.length;
  }
  return Buffer.concat(izhod).subarray(0, dolzina);
}

/** Ena stran protokola; streznik (Lina) je stran A z masko M, telefon stran B z N (RFC 9382). */
export class Spake2 {
  readonly moja: Tocka;
  ke: Buffer | null = null;
  private kca: Buffer | null = null;
  private kcb: Buffer | null = null;
  private tt: Buffer | null = null;
  private readonly w: bigint;
  private readonly x: bigint;
  private readonly jaz: Buffer;
  private readonly oni: Buffer;
  private readonly aad: Buffer;
  private readonly strezniska: boolean;

  constructor(w: bigint, jaz: Buffer, oni: Buffer, aad: Buffer, strezniska: boolean, x?: bigint) {
    this.w = w;
    this.jaz = jaz;
    this.oni = oni;
    this.aad = aad;
    this.strezniska = strezniska;
    this.x = x ?? (izBajtov(randomBytes(48)) % (N - 1n)) + 1n;
    this.moja = sestej(pomnozi(this.x, G), pomnozi(this.w, strezniska ? TM : TN));
  }

  /** `x` je samo za preizkus (skupni vektorji TS <-> Kotlin): znan skalar namesto nakljucnega. */
  static odjemalec(koda: string, jaz: string, hub: string, aad: Buffer = Buffer.alloc(0), sol: Buffer = Buffer.alloc(0), x?: bigint): Spake2 {
    return new Spake2(wIzKode(koda, sol), Buffer.from(jaz), Buffer.from(hub), aad, false, x);
  }

  static streznik(koda: string, jaz: string, odjemalec: string, aad: Buffer = Buffer.alloc(0), sol: Buffer = Buffer.alloc(0), x?: bigint): Spake2 {
    return new Spake2(wIzKode(koda, sol), Buffer.from(jaz), Buffer.from(odjemalec), aad, true, x);
  }

  sporocilo(): Buffer {
    return kodiraj(this.moja);
  }

  /** Skupni kljuc Ke in moja potrditev; neveljavna tocka je izjema. */
  zakljuci(njihovo: Buffer): { ke: Buffer; potrditev: Buffer } {
    const njihova = dekodiraj(njihovo);
    const k = pomnozi(this.x, sestej(njihova, negiraj(pomnozi(this.w, this.strezniska ? TN : TM))));
    if (!k) throw new Error("neveljaven skupni element");
    const [a, b, pa, pb] = this.strezniska ? [this.jaz, this.oni, this.moja, njihova] : [this.oni, this.jaz, njihova, this.moja];
    this.tt = Buffer.concat([dolz(a), dolz(b), dolz(kodiraj(pa)), dolz(kodiraj(pb)), dolz(kodiraj(k)), dolz(vBajte(mod(this.w, N)))]);
    const h = createHash("sha256").update(this.tt).digest();
    this.ke = h.subarray(0, 16);
    const kc = hkdf(h.subarray(16), Buffer.alloc(0), Buffer.concat([Buffer.from("ConfirmationKeys"), this.aad]), 32);
    this.kca = kc.subarray(0, 16);
    this.kcb = kc.subarray(16);
    const moj = this.strezniska ? this.kca : this.kcb;
    return { ke: this.ke, potrditev: createHmac("sha256", moj).update(this.tt).digest() };
  }

  preveri(njihovaPotrditev: Buffer): boolean {
    if (!this.tt) return false;
    const pricakovano = createHmac("sha256", (this.strezniska ? this.kcb : this.kca) as Buffer).update(this.tt).digest();
    return njihovaPotrditev.length === pricakovano.length && timingSafeEqual(pricakovano, njihovaPotrditev);
  }
}
