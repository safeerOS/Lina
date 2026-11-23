/**
 * Cista enota za eno vrstico klica v datoteki Klici.txt (naloga #18):
 * brez uvozov streznika, brez node:fs, brez node:crypto.
 */
import { t } from "./besedila.ts";
import type { CallSession } from "./types.ts";
import { casZaIme, imeKlicatelja } from "./zapiski.ts";

export const NAJVEC_VRSTIC_KLICEV = 2000;
export const NAJVEC_ZNAKOV_VRSTICE = 300;

const KONTROLNI_IN_LOCILA = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff|]/g;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Prvih 8 sestnajstiskih znakov SHA-256 (FIPS 180-4) brez uvoza node:crypto. */
function sha256Kratek(vhod: string): string {
  const bajti = new TextEncoder().encode(vhod);
  const dolzina = bajti.length;
  const polno = Math.ceil((dolzina + 9) / 64) * 64;
  const blok = new Uint8Array(polno);
  blok.set(bajti);
  blok[dolzina] = 0x80;
  const bitov = dolzina * 8;
  const pogled = new DataView(blok.buffer);
  pogled.setUint32(polno - 8, Math.floor(bitov / 0x100000000), false);
  pogled.setUint32(polno - 4, bitov >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < polno; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = pogled.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return (h0 >>> 0).toString(16).padStart(8, "0");
}

/** Skrci presledke, odstrani prelome, kontrolne znake in navpicnice (locilo stolpcev). */
function vVrstico(vrednost: unknown): string {
  if (typeof vrednost !== "string") return "";
  return vrednost.replace(KONTROLNI_IN_LOCILA, " ").replace(/\s+/g, " ").trim();
}

function skrajsaj(besedilo: string, najvec: number): string {
  const znaki = [...besedilo];
  if (znaki.length <= najvec) return besedilo;
  if (najvec <= 1) return znaki.slice(0, Math.max(0, najvec)).join("");
  return `${znaki.slice(0, najvec - 1).join("").trimEnd()}…`;
}

/** Trajanje klica v obliki m:ss (updatedAt - startedAt; negativno ali neveljavno = 0:00). */
function trajanjeKlica(startedAt: string, updatedAt: string): string {
  const zacetek = Date.parse(startedAt);
  const konec = Date.parse(updatedAt);
  if (!Number.isFinite(zacetek) || !Number.isFinite(konec) || konec <= zacetek) return "0:00";
  const sekunde = Math.floor((konec - zacetek) / 1000);
  const minute = Math.floor(sekunde / 60);
  const ostanek = sekunde % 60;
  return `${minute}:${String(ostanek).padStart(2, "0")}`;
}

function sporociloAliRazlog(call: CallSession): string {
  const o = call.order;
  const sporociloTajnice = vVrstico(o?.tajnica?.sporocilo);
  if (sporociloTajnice) return sporociloTajnice;

  // V osebnem nacinu ne beremo podjetniskih polj (izdelek, povprasevanje, opombe).
  if (call.nacin !== "osebna" && o) {
    const izdelek = vVrstico(o.productName || o.requestedProduct || o.povprasevanje);
    const material = vVrstico(o.materialName || o.requestedMaterial);
    const kolicina = o.quantity ? String(o.quantity) : "";
    const skupaj = [izdelek, material, kolicina].filter(Boolean).join(", ");
    if (skupaj) return skupaj;
    const opombe = vVrstico(o.notes);
    if (opombe) return opombe;
  }

  if (call.kratek) return t("kratekOznaka").toLowerCase();
  const imaKlicatelja = (call.transcript ?? []).some((v) => v.role === "stranka" && vVrstico(v.text).length > 0);
  return imaKlicatelja ? t("klicBrezSporocila") : t("klicBrezPogovora");
}

function ocistiId(id: string | undefined, callSid: string): string {
  const podan = typeof id === "string" ? id.trim().toLowerCase() : "";
  if (/^[0-9a-f]{8}$/.test(podan)) return podan;
  return sha256Kratek(callSid ?? "");
}

/**
 * Ena vrstica za Klici.txt:
 * <datum ura (casZaIme z ":")> | <kdo> | <trajanje m:ss> | <sporocilo ali razlog> | id:<8 znakov>
 */
export function vrsticaKlica(call: CallSession, id?: string): string {
  const cas = vVrstico(casZaIme(call.startedAt, ":"));
  const kdo = vVrstico(imeKlicatelja(call, true)) || t("zapisekNeznan");
  const trajanje = trajanjeKlica(call.startedAt, call.updatedAt);
  const kratekId = ocistiId(id, call.callSid);
  const predpona = `${cas} | ${kdo} | ${trajanje} | `;
  const pripona = ` | id:${kratekId}`;
  const naVoljo = Math.max(20, NAJVEC_ZNAKOV_VRSTICE - [...predpona].length - [...pripona].length);
  const vsebina = skrajsaj(sporociloAliRazlog(call), naVoljo);
  return `${predpona}${vsebina}${pripona}`;
}

function imaOznakoId(vrstica: string, id: string): boolean {
  return vrstica.trimEnd().endsWith(`| id:${id}`);
}

/**
 * Posodobi obstojeco vsebino Klici.txt: ce vrstica z id:<id> ze obstaja, jo zamenja na istem mestu;
 * sicer jo doda na konec. Prazne vrstice ignorira, obdrzi najvec `najvec` zadnjih vrstic, vrne z zakljucnim `\n`.
 */
export function dopolniKlici(obstojeca: string, vrstica: string, id: string, najvec = NAJVEC_VRSTIC_KLICEV): string {
  const cistId = id.trim().toLowerCase();
  const cistaVrstica = vrstica.replace(/[\r\n]+/g, " ").trim();
  const vrstice = obstojeca
    .split(/\r?\n/)
    .map((v) => v.trimEnd())
    .filter((v) => v.trim().length > 0);

  let zamenjano = false;
  const rezultat: string[] = [];
  for (const v of vrstice) {
    if (cistId && imaOznakoId(v, cistId)) {
      if (!zamenjano) {
        rezultat.push(cistaVrstica);
        zamenjano = true;
      }
    } else {
      rezultat.push(v);
    }
  }
  if (!zamenjano) rezultat.push(cistaVrstica);

  const meja = Math.max(1, Math.floor(najvec));
  const obdrzane = rezultat.length > meja ? rezultat.slice(-meja) : rezultat;
  return `${obdrzane.join("\n")}\n`;
}
