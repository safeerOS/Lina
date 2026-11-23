/**
 * Izenacenje glasu (G4l, lastnik 11. 11. 2026: »vse se more slisati enako, da ne govori vec razlicnih oseb«).
 * Vsak stalni stavek je ZASEBNA sinteza Gemini TTS, zato visina, glasnost in tempo od stavka do stavka nihajo
 * (meritev 11. 11. 2026, 19 stavkov x 3 ponovitve: mediana f0 std 1,25 pt, razpon 5 pt; glasnost std 0,74 LU;
 * ponovitve ISTEGA stavka se razlikujejo za 1,0 pt, torej to ni stalen znacaj stavka, ampak sum sinteze).
 * Zato vsak posnetek pred shranjevanjem potegnemo na isto glasnost in isto osnovno frekvenco.
 * Cisti JS (kot pcm24VWav8): enako na Linuxu in Windows, brez ffmpeg; rezultat je odvisen samo od vhoda.
 * Del kljuca posnetka (OBDELAVA_ZVOKA): ob spremembi obdelave se stari posnetki pripravijo znova.
 */

export const OBDELAVA_ZVOKA = "izenacenje-2"; // 14. 11. 2026: obrez tisine na robovih velja samo za nove posnetke (kljuc ostane: nove sinteze med klicem ob omejitvi 429 so tvegane); 12. 11. 2026: ocistiTisino8k (vrata v pavzah, brum); stari posnetki se pripravijo znova

/** Ciljna osnovna frekvenca: povprecje izmerjenih stavkov glasu Kore (214 Hz, 11. 11. 2026). */
export const CILJ_F0_HZ = 214;
/** Najvecji premik visine v polovicah tona. Resampling premakne tudi tempo za isti faktor, zato ozka meja. */
export const MEJA_PREMIKA_PT = 2;
/** Ciljna glasnost govora: RMS aktivnih delov v dBFS (izmerjeno: -19,5 dBFS RMS je pri teh posnetkih ~ -20 LUFS). */
export const CILJ_RMS_DB = -19.5;
const NAJVEC_VRH = 0.98;

const FREKVENCA = 24_000;
const OKNO_MS = 10;
const TISINA_DB = 32;

function vVzorce(pcm: Uint8Array): Float32Array {
  const dolzina = Math.floor(pcm.byteLength / 2);
  const pogled = new DataView(pcm.buffer, pcm.byteOffset, dolzina * 2);
  const ven = new Float32Array(dolzina);
  for (let i = 0; i < dolzina; i += 1) ven[i] = pogled.getInt16(i * 2, true) / 32768;
  return ven;
}

function vPcm(vzorci: Float32Array): Buffer {
  const ven = Buffer.alloc(vzorci.length * 2);
  for (let i = 0; i < vzorci.length; i += 1) {
    ven.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(vzorci[i] * 32768))), i * 2);
  }
  return ven;
}

/** Okna (10 ms) z energijo najvec 32 dB pod najglasnejsim oknom so govor; ostalo je tisina. */
function aktivnaOkna(x: Float32Array): { okno: number; aktivna: boolean[] } {
  const okno = Math.round((FREKVENCA * OKNO_MS) / 1000);
  const n = Math.floor(x.length / okno);
  const rms: number[] = [];
  for (let k = 0; k < n; k += 1) {
    let vsota = 0;
    for (let i = k * okno; i < (k + 1) * okno; i += 1) vsota += x[i] * x[i];
    rms.push(Math.sqrt(vsota / okno));
  }
  let vrh = 0;
  for (const r of rms) vrh = Math.max(vrh, r);
  const prag = vrh * 10 ** (-TISINA_DB / 20);
  return { okno, aktivna: rms.map((r) => vrh > 0 && r >= prag) };
}

/** RMS aktivnih oken v dBFS ali null, ce govora ni. */
export function rmsGovoraDb(pcm: Uint8Array): number | null {
  const x = vVzorce(pcm);
  const { okno, aktivna } = aktivnaOkna(x);
  let vsota = 0;
  let stevilo = 0;
  aktivna.forEach((a, k) => {
    if (!a) return;
    for (let i = k * okno; i < (k + 1) * okno; i += 1) vsota += x[i] * x[i];
    stevilo += okno;
  });
  return stevilo ? 10 * Math.log10(vsota / stevilo + 1e-12) : null;
}

/**
 * Mediana osnovne frekvence (Hz) z normirano avtokorelacijo na 8 kHz (okna 40 ms, korak 10 ms), samo zvocni deli.
 * Preprosto, a dovolj za izenacenje: primerjava s pyin (librosa) je v porocilu G4l. Null, ce zvocnih delov ni.
 */
export function medianaF0(pcm: Uint8Array): number | null {
  const x24 = vVzorce(pcm);
  const n8 = Math.floor(x24.length / 3);
  const x = new Float32Array(n8);
  for (let i = 0; i < n8; i += 1) x[i] = (x24[i * 3] + x24[i * 3 + 1] + x24[i * 3 + 2]) / 3;
  const sr = FREKVENCA / 3;
  const okno = 320;
  const korak = 80;
  const lagMin = Math.floor(sr / 400);
  const lagMax = Math.ceil(sr / 75);
  const energije: number[] = [];
  for (let s = 0; s + okno + lagMax <= n8; s += korak) {
    let e = 0;
    for (let i = s; i < s + okno; i += 1) e += x[i] * x[i];
    energije.push(e);
  }
  let najvecja = 0;
  for (const e of energije) najvecja = Math.max(najvecja, e);
  const frekvence: number[] = [];
  energije.forEach((e, k) => {
    if (e < najvecja * 10 ** (-TISINA_DB / 10)) return;
    const s = k * korak;
    const r: number[] = [];
    let najR = 0;
    for (let lag = lagMin; lag <= lagMax; lag += 1) {
      let ab = 0;
      let bb = 0;
      for (let i = s; i < s + okno; i += 1) {
        ab += x[i] * x[i + lag];
        bb += x[i + lag] * x[i + lag];
      }
      const v = ab / Math.sqrt(e * bb + 1e-12);
      r.push(v);
      if (v > najR) najR = v;
    }
    // Najkrajsi lag, ki je lokalni vrh z vsaj 85 % najvecje korelacije: najvecji vrh je pogosto dvojna perioda
    // (oktavna napaka, izmerjeno proti pyin 11. 11. 2026: JS je bil za 0,7 pt prenizek).
    let najLag = 0;
    for (let k = 1; k < r.length - 1; k += 1) {
      if (r[k] >= najR * 0.85 && r[k] >= r[k - 1] && r[k] >= r[k + 1]) {
        najLag = lagMin + k;
        break;
      }
    }
    // Zvocno samo, ce je korelacija visoka; sicer je okno sumnik ali sum.
    if (najR >= 0.7 && najLag > 0) frekvence.push(sr / najLag);
  });
  // Manj kot 8 zvocnih oken (80 ms) je prekratko za zanesljivo mediano: raje brez premika visine.
  if (frekvence.length < 8) return null;
  frekvence.sort((a, b) => a - b);
  return frekvence[Math.floor(frekvence.length / 2)];
}

/** Resampling s faktorjem f (kubicna interpolacija, Catmull-Rom): f > 1 poviša visino in skrajša trajanje. */
function premakni(x: Float32Array, f: number): Float32Array {
  const n = Math.floor((x.length - 1) / f);
  const ven = new Float32Array(Math.max(0, n));
  for (let i = 0; i < ven.length; i += 1) {
    const t = i * f;
    const k = Math.floor(t);
    const u = t - k;
    const p0 = x[Math.max(0, k - 1)];
    const p1 = x[k];
    const p2 = x[Math.min(x.length - 1, k + 1)];
    const p3 = x[Math.min(x.length - 1, k + 2)];
    ven[i] = p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
  }
  return ven;
}

/**
 * PCM 16-bit mono 24 kHz iz sinteze -> isti zapis z izenaceno visino (mediana f0 proti CILJ_F0_HZ, najvec
 * +-MEJA_PREMIKA_PT) in glasnostjo (RMS govora proti CILJ_RMS_DB; ojacenje ne sme preseci NAJVEC_VRH).
 * Kratek ali neslisen posnetek (ni zvocnih delov) vrnemo nespremenjen: raje neizenacen kot popacen.
 */
export function izenaciGovor(pcm: Uint8Array): Buffer {
  const original = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
  const rms = rmsGovoraDb(original);
  if (rms === null) return original;
  let x = vVzorce(original);
  const f0 = medianaF0(original);
  if (f0 !== null) {
    const pt = Math.max(-MEJA_PREMIKA_PT, Math.min(MEJA_PREMIKA_PT, 12 * Math.log2(CILJ_F0_HZ / f0)));
    x = premakni(x, 2 ** (pt / 12));
  }
  let vrh = 0;
  for (let i = 0; i < x.length; i += 1) vrh = Math.max(vrh, Math.abs(x[i]));
  const ojacenje = Math.min(10 ** ((CILJ_RMS_DB - rms) / 20), vrh > 0 ? NAJVEC_VRH / vrh : 1);
  for (let i = 0; i < x.length; i += 1) x[i] *= ojacenje;
  return vPcm(x);
}

/**
 * Sum sinteze v pavzah in brum (12. 11. 2026, lastnik: »sum v ozadju«; poslusal 4 razlicice, izbral 3). Gemini TTS ima med
 * besedami tiho podlago (izmerjeno 49-62 dBFS pod polno lestvico, govor ~16 dBFS). Delamo na WAV 8 kHz 16-bit mono:
 * (1) vrata: okna 10 ms, okno pod pragom (30 dB pod 95. percentilom oken) dobi -25 dB; odpre takoj in 20 ms vnaprej, zapre
 * pocasi (12 % koraka na okno), da ne pocijo soglasniki in ni sunkov; (2) visoko sito 90 Hz (Butterworth 2. reda) odreze brum.
 * Kratek posnetek (pod 10 oken) ali neveljavna glava: vrnemo nespremenjeno.
 */
const VRATA_OKNO = 80; // 10 ms pri 8 kHz
const VRATA_PRAG_DB = 30;
const VRATA_ZNIZANJE = 10 ** (-25 / 20);
const VRATA_ZAPIRANJE = 0.12;
const HP_B = [0.9512454211989966, -1.9024908423979932, 0.9512454211989966];
const HP_A = [-1.9001124192197263, 0.9048692655762602];

export function ocistiTisino8k(wav: Buffer): Buffer {
  if (wav.length < 44 + 2 * VRATA_OKNO * 10 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.readUInt32LE(24) !== 8000) return wav;
  const n = Math.floor((wav.length - 44) / 2);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) x[i] = wav.readInt16LE(44 + i * 2);
  const oken = Math.floor(n / VRATA_OKNO);
  const rms = new Float64Array(oken);
  for (let k = 0; k < oken; k += 1) {
    let v = 0;
    for (let i = k * VRATA_OKNO; i < (k + 1) * VRATA_OKNO; i += 1) v += x[i] * x[i];
    rms[k] = Math.sqrt(v / VRATA_OKNO) + 1e-9;
  }
  const urejeno = Array.from(rms).sort((a, b) => a - b);
  const polozaj = 0.95 * (oken - 1);
  const spodaj = Math.floor(polozaj);
  const ref = urejeno[spodaj] + (urejeno[Math.min(oken - 1, spodaj + 1)] - urejeno[spodaj]) * (polozaj - spodaj);
  const prag = ref * 10 ** (-VRATA_PRAG_DB / 20);
  const gs = new Float64Array(oken);
  let tekoce = 1;
  for (let k = 0; k < oken; k += 1) {
    const cilj = rms[k] >= prag ? 1 : VRATA_ZNIZANJE;
    tekoce = cilj > tekoce ? cilj : tekoce + (cilj - tekoce) * VRATA_ZAPIRANJE;
    gs[k] = tekoce;
  }
  const ven = Buffer.from(wav);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i += 1) {
    const k = Math.floor(i / VRATA_OKNO);
    const g = k < oken ? Math.max(gs[k], k + 2 < oken ? gs[k + 2] : gs[k]) : 1;
    const vhod = x[i] * g;
    const izhod = HP_B[0] * vhod + HP_B[1] * x1 + HP_B[2] * x2 - HP_A[0] * y1 - HP_A[1] * y2;
    x2 = x1;
    x1 = vhod;
    y2 = y1;
    y1 = izhod;
    ven.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(izhod))), 44 + i * 2);
  }
  return ven;
}

/**
 * Tisina na robovih posnetka (14. 11. 2026): pozdrav lastnika je trajal 12,07 s, od tega 0,27 s tisine na zacetku in
 * 0,45 s na koncu (izmerjeno na WAV 8 kHz, prag 300). Tisina nad 0,3 s na robu se skrajsa na 0,15 s; do 0,3 s ostane.
 * Govor in pavze znotraj posnetka se ne spremenijo. Prag kot pri vratih: 30 dB pod 95. percentilom oken 10 ms.
 */
export const NAJVEC_TISINE_NA_ROBU_S = 0.3;
export const OSTANEK_TISINE_NA_ROBU_S = 0.15;

export function obreziTisinoNaRobovih8k(wav: Buffer): Buffer {
  if (wav.length < 44 + 2 * VRATA_OKNO * 10 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.readUInt32LE(24) !== 8000) return wav;
  const n = Math.floor((wav.length - 44) / 2);
  const oken = Math.floor(n / VRATA_OKNO);
  const rms = new Float64Array(oken);
  for (let k = 0; k < oken; k += 1) {
    let v = 0;
    for (let i = k * VRATA_OKNO; i < (k + 1) * VRATA_OKNO; i += 1) {
      const x = wav.readInt16LE(44 + i * 2);
      v += x * x;
    }
    rms[k] = Math.sqrt(v / VRATA_OKNO);
  }
  const urejeno = Array.from(rms).sort((a, b) => a - b);
  const ref = urejeno[Math.min(oken - 1, Math.floor(0.95 * (oken - 1)))];
  const prag = ref * 10 ** (-VRATA_PRAG_DB / 20);
  let prvo = rms.findIndex((r) => r >= prag);
  if (prvo < 0) return wav;
  let zadnje = oken - 1;
  while (zadnje > prvo && rms[zadnje] < prag) zadnje -= 1;
  const okenNaSekundo = 8000 / VRATA_OKNO;
  const ostanek = Math.round(OSTANEK_TISINE_NA_ROBU_S * okenNaSekundo);
  const meja = Math.round(NAJVEC_TISINE_NA_ROBU_S * okenNaSekundo);
  const zacetnaTisina = prvo;
  const koncnaTisina = oken - 1 - zadnje;
  const od = zacetnaTisina > meja ? (prvo - ostanek) * VRATA_OKNO : 0;
  const doVzorca = koncnaTisina > meja ? (zadnje + 1 + ostanek) * VRATA_OKNO : n;
  if (od === 0 && doVzorca === n) return wav;
  const podatki = wav.subarray(44 + od * 2, 44 + doVzorca * 2);
  const glava = Buffer.from(wav.subarray(0, 44));
  glava.writeUInt32LE(36 + podatki.length, 4);
  glava.writeUInt32LE(podatki.length, 40);
  return Buffer.concat([glava, podatki]);
}

/**
 * Krajsanje tisin ob pripravi posnetka (lastnik 14. 11. 2026, klic K7: pozdrav 12,07 s, vsaka fraza 210-270 ms tisine na zacetku in
 * 150-450 ms na koncu, notranji premori > 400 ms). Cilj (svetovalec): zacetek ~30 ms, konec ~100 ms, notranji premor > 350 ms skrajsan na ~250 ms;
 * premori do 350 ms (med zlogi in besedami) ostanejo. Stiki imajo preliv 8 ms (brez klikov). Prag kot pri vratih: 30 dB pod 95. percentilom oken 10 ms.
 * Funkcija je idempotentna (ponovni klic posnetka ne spremeni vec), zato se sme uporabiti tudi na ze pripravljenih stalnih posnetkih.
 */
export const TISINA_ZACETEK_MS = 30;
export const TISINA_KONEC_MS = 100;
export const PREMOR_NAJVEC_MS = 350;
export const PREMOR_OSTANE_MS = 250;
export const PRELIV_MS = 8;

function oknaRms8k(wav: Buffer): { n: number; rms: Float64Array; prag: number } | null {
  if (wav.length < 44 + 2 * VRATA_OKNO * 10 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.readUInt32LE(24) !== 8000) return null;
  const n = Math.floor((wav.length - 44) / 2);
  const oken = Math.floor(n / VRATA_OKNO);
  const rms = new Float64Array(oken);
  for (let k = 0; k < oken; k += 1) {
    let v = 0;
    for (let i = k * VRATA_OKNO; i < (k + 1) * VRATA_OKNO; i += 1) {
      const x = wav.readInt16LE(44 + i * 2);
      v += x * x;
    }
    rms[k] = Math.sqrt(v / VRATA_OKNO);
  }
  const urejeno = Array.from(rms).sort((a, b) => a - b);
  const ref = urejeno[Math.min(oken - 1, Math.floor(0.95 * (oken - 1)))];
  return { n, rms, prag: ref * 10 ** (-VRATA_PRAG_DB / 20) };
}

/** Meritev posnetka 8 kHz: trajanje, tisina na zacetku in koncu ter najdaljsi notranji premor (ms, okna 10 ms). */
export function meriTisine8k(wav: Buffer): { trajanjeMs: number; zacetekMs: number; konecMs: number; najdaljsiPremorMs: number } | null {
  const o = oknaRms8k(wav);
  if (!o) return null;
  const ms = (vzorcev: number) => Math.round((vzorcev / 8000) * 1000);
  const prvo = o.rms.findIndex((r) => r >= o.prag);
  if (prvo < 0) return { trajanjeMs: ms(o.n), zacetekMs: ms(o.n), konecMs: 0, najdaljsiPremorMs: 0 };
  let zadnje = o.rms.length - 1;
  while (zadnje > prvo && o.rms[zadnje] < o.prag) zadnje -= 1;
  let najdaljsi = 0;
  let tek = 0;
  for (let k = prvo; k <= zadnje; k += 1) {
    tek = o.rms[k] < o.prag ? tek + 1 : 0;
    najdaljsi = Math.max(najdaljsi, tek);
  }
  return { trajanjeMs: ms(o.n), zacetekMs: ms(prvo * VRATA_OKNO), konecMs: ms(o.n - (zadnje + 1) * VRATA_OKNO), najdaljsiPremorMs: najdaljsi * 10 };
}

/** robMs: tesen rob (kosi ponovitve, 14. 11. 2026: stik ne sme zveneti kot vejica) - tisina na zacetku in koncu najvec robMs. */
export function skrciTisine8k(wav: Buffer, robMs?: number): Buffer {
  const o = oknaRms8k(wav);
  if (!o) return wav;
  const { n, rms, prag } = o;
  const prvo = rms.findIndex((r) => r >= prag);
  if (prvo < 0) return wav;
  let zadnje = rms.length - 1;
  while (zadnje > prvo && rms[zadnje] < prag) zadnje -= 1;
  const vz = (ms: number) => Math.round((ms / 1000) * 8000);
  const deli: Array<[number, number]> = [];
  let od = Math.max(0, prvo * VRATA_OKNO - vz(robMs ?? TISINA_ZACETEK_MS));
  // Notranji premori daljsi od PREMOR_NAJVEC_MS: ostane polovica PREMOR_OSTANE_MS na vsaki strani.
  let k = prvo;
  while (k <= zadnje) {
    if (rms[k] >= prag) {
      k += 1;
      continue;
    }
    let konec = k;
    while (konec <= zadnje && rms[konec] < prag) konec += 1;
    if ((konec - k) * 10 > PREMOR_NAJVEC_MS) {
      deli.push([od, k * VRATA_OKNO + vz(PREMOR_OSTANE_MS / 2)]);
      od = konec * VRATA_OKNO - vz(PREMOR_OSTANE_MS / 2);
    }
    k = konec;
  }
  deli.push([od, Math.min(n, (zadnje + 1) * VRATA_OKNO + vz(robMs ?? TISINA_KONEC_MS))]);
  const skupaj = deli.reduce((v, [a, b]) => v + (b - a), 0);
  if (skupaj >= n) return wav;
  const podatki = Buffer.alloc(skupaj * 2);
  const preliv = vz(PRELIV_MS);
  let p = 0;
  for (const [a, b] of deli) {
    const dolzina = b - a;
    for (let i = 0; i < dolzina; i += 1) {
      let g = 1;
      if (i < preliv) g = Math.min(g, i / preliv);
      if (dolzina - 1 - i < preliv) g = Math.min(g, (dolzina - 1 - i) / preliv);
      podatki.writeInt16LE(Math.round(wav.readInt16LE(44 + (a + i) * 2) * g), p * 2);
      p += 1;
    }
  }
  const glava = Buffer.from(wav.subarray(0, 44));
  glava.writeUInt32LE(36 + podatki.length, 4);
  glava.writeUInt32LE(podatki.length, 40);
  return Buffer.concat([glava, podatki]);
}
