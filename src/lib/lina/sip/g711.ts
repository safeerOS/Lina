/** G.711 (ITU-T G.711): mu-law (PCMU, PT 0) in A-law (PCMA, PT 8) <-> 16-bitni linearni PCM. Ciste funkcije. */

const BIAS = 0x84;

/** mu-law po referenci ITU-T G.191 (STL g711.c): negativni vzorci z eniskim komplementom (~x). */
export function linearVUlaw(vzorec: number): number {
  const x = Math.max(-32768, Math.min(32767, Math.trunc(vzorec)));
  let absno = x < 0 ? (~x >> 2) + 33 : (x >> 2) + 33;
  if (absno > 0x1fff) absno = 0x1fff;
  let segment = 1;
  for (let i = absno >> 6; i !== 0; i >>= 1) segment++;
  const visoki = 8 - segment;
  const nizki = 0x0f - ((absno >> segment) & 0x0f);
  return ((visoki << 4) | nizki | (x >= 0 ? 0x80 : 0)) & 0xff;
}

export function ulawVLinear(bajt: number): number {
  const u = ~bajt & 0xff;
  const znak = u & 0x80;
  const eksponent = (u >> 4) & 0x07;
  const mantisa = u & 0x0f;
  const t = (((mantisa << 3) + BIAS) << eksponent) - BIAS;
  return znak ? 0 - t : t;
}

const KONCI_SEGMENTOV_A = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];

export function linearVAlaw(vzorec: number): number {
  let pcm = Math.max(-32768, Math.min(32767, Math.trunc(vzorec))) >> 3;
  let maska: number;
  if (pcm >= 0) maska = 0xd5;
  else {
    maska = 0x55;
    pcm = -pcm - 1;
  }
  let segment = 0;
  while (segment < 8 && pcm > (KONCI_SEGMENTOV_A[segment] as number)) segment++;
  if (segment >= 8) return 0x7f ^ maska;
  let a = segment << 4;
  a |= segment < 2 ? (pcm >> 1) & 0x0f : (pcm >> segment) & 0x0f;
  return a ^ maska;
}

export function alawVLinear(bajt: number): number {
  const a = (bajt & 0xff) ^ 0x55;
  let t = (a & 0x0f) << 4;
  const segment = (a & 0x70) >> 4;
  if (segment === 0) t += 8;
  else if (segment === 1) t += 0x108;
  else {
    t += 0x108;
    t <<= segment - 1;
  }
  return a & 0x80 ? t : -t;
}

const TABELA_U = Int16Array.from({ length: 256 }, (_v, i) => ulawVLinear(i));
const TABELA_A = Int16Array.from({ length: 256 }, (_v, i) => alawVLinear(i));

export type G711 = "PCMU" | "PCMA";

export function dekodirajG711(kodek: G711, bajti: Uint8Array): Int16Array {
  const tabela = kodek === "PCMU" ? TABELA_U : TABELA_A;
  const izid = new Int16Array(bajti.length);
  for (let i = 0; i < bajti.length; i++) izid[i] = tabela[bajti[i] as number] as number;
  return izid;
}

export function kodirajG711(kodek: G711, pcm: Int16Array): Uint8Array {
  const f = kodek === "PCMU" ? linearVUlaw : linearVAlaw;
  const izid = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) izid[i] = f(pcm[i] as number);
  return izid;
}

/** Bajt tisine za kodek (mu-law 0xFF, A-law 0xD5). */
export function tisinaG711(kodek: G711): number {
  return kodek === "PCMU" ? 0xff : 0xd5;
}
