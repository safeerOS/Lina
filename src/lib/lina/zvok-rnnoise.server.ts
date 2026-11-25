/**
 * RNNoise (Xiph, BSD-3; WASM iz @shiguredo/rnnoise-wasm 2025.1.5, Apache-2.0; vendor/rnnoise-wasm/NOTICE) pred prepoznavo govora.
 * Naloga 17a (lastnik 25. 11. 2026: »popolnoma vgradimo«): odstranjevanje hrupa tiskarne pred RSDO in Gemini Live.
 * - RNNoise dela pri 48 kHz v okvirjih po 480 vzorcev (10 ms); vhod 8 ali 16 kHz se prevzorci gor (PolifazniPrevzorcevalnik, isto
 *   jedro kot Prevzorcevalnik v live/zvok.ts) in po ciscenju nazaj. RNNoise pricakuje vzorce v obsegu int16 (ne -1..1).
 * - Mesanica: izhod = mesanica * ocisceno + (1 - mesanica) * surovo. Surovi del je zakasnjen za ZAMIK_RNNOISE_48K (= 2 okvirja,
 *   izmerjeno s korelacijo in zaklenjeno s preizkusom), sicer bi mesanica delovala kot glavnikasti filter.
 * - Tokovno: vsak klic obdelaj() vrne natanko toliko vzorcev, kot jih je dobil; zakasnitev je stalna (zakasnitev vzorcev).
 * - Ena instanca na klic ali posnetek; unici() sprosti pomnilnik WASM. Brez omrezja, brez diska, brez stanja med klici.
 * - Zgradba paketa je samo za brskalnik (preveri window/WorkerGlobalScope): med SINHRONIM zacetkom nalaganja zacasno nastavimo
 *   globalThis.WorkerGlobalScope in ga takoj odstranimo (koda paketa je nespremenjena). Napaka nalaganja = null (stara pot).
 * Komentarji so brez sumnikov.
 */
import { setImmediate as naslednjiKrog } from "node:timers/promises";
import { Prevzorcevalnik } from "./live/zvok.ts";
import { CiscenjeZvoka8k, ZAKASNITEV_VZORCEV } from "./zvok-ciscenje.ts";

export type StanjeRnnoise = { processFrame(okvir: Float32Array): number; destroy(): void };
export type RnnoiseModul = { readonly frameSize: number; createDenoiseState(): StanjeRnnoise };
type PaketRnnoise = { Rnnoise: { load(): Promise<RnnoiseModul> } };

export const HITROST_RNNOISE = 48_000;
export const OKVIR_RNNOISE = 480;
/** Notranja zakasnitev RNNoise pri 48 kHz (izmerjena s korelacijo na govoru: 960 = 2 okvirja = 20 ms). */
export const ZAMIK_RNNOISE_48K = 960;
/** Zapolnitev izhodne vrste (vzorci pri vhodni frekvenci): zgornja meja zaostanka stetja (okvir 480 + oba prevzorcevalnika) z rezervo. */
const ZAPOLNITEV: Record<number, number> = { 8000: 120, 16000: 200 };
export const PRIVZETA_MESANICA = 0.5;

const uvozPrivzeti = (): Promise<PaketRnnoise> => import("../../../vendor/rnnoise-wasm/rnnoise.js") as Promise<PaketRnnoise>;

/** Nalozi RNNoise iz danega uvoza; ob kakrsni koli napaki null. Zacasni nadomestek WorkerGlobalScope ne ostane. */
export async function nalozRnnoiseIz(uvoz: () => Promise<PaketRnnoise>): Promise<RnnoiseModul | null> {
  try {
    const paket = await uvoz();
    const g = globalThis as { WorkerGlobalScope?: unknown };
    const imel = "WorkerGlobalScope" in g;
    let nalaganje: Promise<RnnoiseModul>;
    if (!imel) g.WorkerGlobalScope = function WorkerGlobalScope() {};
    try {
      // Preverba okolja v paketu tece sinhrono ob klicu load(), pred prvim await; zato nadomestek odstranimo takoj po klicu.
      nalaganje = paket.Rnnoise.load();
    } finally {
      if (!imel) delete g.WorkerGlobalScope;
    }
    const modul = await nalaganje;
    return modul && modul.frameSize === OKVIR_RNNOISE ? modul : null;
  } catch {
    return null;
  }
}

let nalozen: Promise<RnnoiseModul | null> | null = null;
let pripravljen: RnnoiseModul | null = null;

/** RNNoise za ta proces (nalozi se enkrat, ~5 MB pomnilnika); null, ce ga ni mogoce naloziti. */
export function nalozRnnoise(): Promise<RnnoiseModul | null> {
  if (!nalozen) {
    nalozen = nalozRnnoiseIz(uvozPrivzeti).then((m) => {
      pripravljen = m;
      return m;
    });
  }
  return nalozen;
}

/** Ze nalozen modul (sinhrono, za zvocno pot klica) ali null. */
export function rnnoisePripravljen(): RnnoiseModul | null {
  return pripravljen;
}

function omejiMesanico(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PRIVZETA_MESANICA;
}

const vInt16 = (v: number): number => {
  const r = Math.round(v);
  return r > 32767 ? 32767 : r < -32768 ? -32768 : r;
};

/**
 * Tokovni prevzorcevalnik za celostevilsko razmerje (8/16 kHz <-> 48 kHz) z istim jedrom kot Prevzorcevalnik v live/zvok.ts
 * (oknasti sinc s Hannom, 8 nicel, meja 0,95 manjse Nyquistove frekvence, normalizacija z vsoto tez), a s polifaznimi utezmi,
 * izracunanimi enkrat: Prevzorcevalnik racuna sin/cos za vsak odcep, kar pri 48 kHz porabi vec casa kot RNNoise sam.
 * Polozaj izhodnega vzorca j je tocno j * vhod / izhod (brez kopicenja napake plavajoce vejice).
 */
export class PolifazniPrevzorcevalnik {
  private readonly vhod: number;
  private readonly izhod: number;
  private readonly korak: number;
  private readonly pol: number;
  private readonly faze: { od: number; w: Float64Array }[] = [];
  private zgodovina: Float64Array;
  /** Absolutni indeks vzorca zgodovina[0] in stevilo vzorcev v zgodovini. */
  private zacetek: number;
  private dolzina: number;
  private j = 0;

  constructor(vhod: number, izhod: number, nicleSinca = 8) {
    const g = ((a: number, b: number): number => {
      while (b) [a, b] = [b, a % b];
      return a;
    })(vhod, izhod);
    if (!Number.isInteger(vhod) || !Number.isInteger(izhod) || (vhod % izhod !== 0 && izhod % vhod !== 0)) throw new Error("Razmerje mora biti celo.");
    this.vhod = vhod;
    this.izhod = izhod;
    this.korak = g;
    const meja = 0.95 * Math.min(1, izhod / vhod);
    const pol = nicleSinca / meja;
    this.pol = pol;
    const utez = (t: number): number => {
      if (Math.abs(t) >= pol) return 0;
      const x = Math.PI * meja * t;
      const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
      return meja * sinc * (0.5 * (1 + Math.cos((Math.PI * t) / pol)));
    };
    for (let r = 0; r < izhod; r += g) {
      const frac = r / izhod;
      const od = Math.ceil(frac - pol);
      const do_ = Math.floor(frac + pol);
      const w = new Float64Array(do_ - od + 1);
      let vsota = 0;
      for (let k = od; k <= do_; k++) vsota += (w[k - od] = utez(frac - k));
      for (let i = 0; i < w.length; i++) w[i] = vsota === 0 ? 0 : (w[i] as number) / vsota;
      this.faze.push({ od, w });
    }
    const uvod = Math.ceil(pol);
    this.zgodovina = new Float64Array(Math.max(4096, uvod * 4));
    this.zacetek = -uvod;
    this.dolzina = uvod;
  }

  process(x: Int16Array): Int16Array {
    if (this.dolzina + x.length > this.zgodovina.length) {
      const nova = new Float64Array(Math.max(this.zgodovina.length * 2, (this.dolzina + x.length) * 2));
      nova.set(this.zgodovina.subarray(0, this.dolzina));
      this.zgodovina = nova;
    }
    this.zgodovina.set(x, this.dolzina);
    this.dolzina += x.length;
    const konec = this.zacetek + this.dolzina;
    // Stevilo izhodnih vzorcev: vsi j s polozajem j*vhod/izhod + pol < konec.
    const ven: number[] = [];
    const z = this.zgodovina;
    for (;;) {
      const st = this.j * this.vhod;
      if (st / this.izhod + this.pol >= konec) break;
      const osnova = Math.floor(st / this.izhod);
      const faza = this.faze[(st - osnova * this.izhod) / this.korak] as { od: number; w: Float64Array };
      const zacni = osnova + faza.od - this.zacetek;
      let y = 0;
      const w = faza.w;
      for (let i = 0; i < w.length; i++) y += (z[zacni + i] as number) * (w[i] as number);
      ven.push(vInt16(y));
      this.j += 1;
    }
    // Zgodovina, ki je nobena nadaljnja izhodna tocka ne potrebuje, gre ven.
    const odrezi = Math.floor((this.j * this.vhod) / this.izhod - this.pol) - this.zacetek;
    if (odrezi > 0) {
      z.copyWithin(0, odrezi, this.dolzina);
      this.dolzina -= odrezi;
      this.zacetek += odrezi;
    }
    return Int16Array.from(ven);
  }
}

export class CiscenjeRnnoise {
  readonly frekvenca: number;
  readonly mesanica: number;
  /** Stalna zakasnitev izhoda v vzorcih pri vhodni frekvenci. */
  readonly zakasnitev: number;
  /** Stevilo vzorcev, ko izhodna vrsta ni imela dovolj vzorcev (mora ostati 0; preizkus). */
  podtekov = 0;
  private stanje: StanjeRnnoise | null;
  private readonly gor: PolifazniPrevzorcevalnik;
  private readonly dol: PolifazniPrevzorcevalnik;
  private readonly okvir = new Float32Array(OKVIR_RNNOISE);
  private polno = 0;
  /** Surova okvirja k-1 in k-2 (zamik 960 = 2 okvirja). */
  private surovo1 = new Float32Array(OKVIR_RNNOISE);
  private surovo2 = new Float32Array(OKVIR_RNNOISE);
  private vrsta: Int16Array;
  private beri = 0;
  private pisi: number;

  constructor(modul: RnnoiseModul, nastavitve: { frekvenca: 8000 | 16000; mesanica?: number }) {
    const fs = nastavitve.frekvenca;
    if (fs !== 8000 && fs !== 16000) throw new Error("RNNoise: frekvenca mora biti 8000 ali 16000 Hz.");
    this.frekvenca = fs;
    this.mesanica = omejiMesanico(nastavitve.mesanica);
    const zapolnitev = ZAPOLNITEV[fs] as number;
    this.zakasnitev = ZAMIK_RNNOISE_48K / (HITROST_RNNOISE / fs) + zapolnitev;
    this.gor = new PolifazniPrevzorcevalnik(fs, HITROST_RNNOISE);
    this.dol = new PolifazniPrevzorcevalnik(HITROST_RNNOISE, fs);
    this.vrsta = new Int16Array(Math.max(4096, zapolnitev * 4));
    this.pisi = zapolnitev;
    this.stanje = modul.createDenoiseState();
  }

  private vVrsto(v: Int16Array): void {
    if (this.pisi + v.length > this.vrsta.length) {
      const ostane = this.vrsta.subarray(this.beri, this.pisi);
      const nova = this.vrsta.length >= (ostane.length + v.length) * 2 ? this.vrsta : new Int16Array((ostane.length + v.length) * 2);
      nova.set(ostane, 0);
      this.vrsta = nova;
      this.pisi = ostane.length;
      this.beri = 0;
    }
    this.vrsta.set(v, this.pisi);
    this.pisi += v.length;
  }

  /** Obdela kos PCM pri vhodni frekvenci; vrne natanko toliko vzorcev (zakasnjeno za zakasnitev). Po unici() vrne kopijo vhoda. */
  obdelaj(vhod: Int16Array): Int16Array {
    const stanje = this.stanje;
    if (!stanje) return Int16Array.from(vhod);
    const x48 = this.gor.process(vhod);
    const okvirjev = Math.floor((this.polno + x48.length) / OKVIR_RNNOISE);
    const mesano = new Int16Array(okvirjev * OKVIR_RNNOISE);
    let narejenih = 0;
    const m = this.mesanica;
    for (let i = 0; i < x48.length; i++) {
      this.okvir[this.polno++] = x48[i] as number;
      if (this.polno < OKVIR_RNNOISE) continue;
      this.polno = 0;
      const surov = this.okvir.slice();
      const ocisceno = this.okvir;
      stanje.processFrame(ocisceno);
      const zakasnjen = this.surovo2;
      const od = narejenih * OKVIR_RNNOISE;
      for (let n = 0; n < OKVIR_RNNOISE; n++) mesano[od + n] = vInt16(m * (ocisceno[n] as number) + (1 - m) * (zakasnjen[n] as number));
      this.surovo2 = this.surovo1;
      this.surovo1 = surov;
      narejenih += 1;
    }
    if (mesano.length > 0) this.vVrsto(this.dol.process(mesano));
    const izid = new Int16Array(vhod.length);
    const na_voljo = Math.min(vhod.length, this.pisi - this.beri);
    izid.set(this.vrsta.subarray(this.beri, this.beri + na_voljo), 0);
    this.beri += na_voljo;
    this.podtekov += vhod.length - na_voljo;
    return izid;
  }

  /** Sprosti stanje RNNoise (enkrat); nadaljnji obdelaj() vrne vhod nespremenjen. */
  unici(): void {
    const s = this.stanje;
    this.stanje = null;
    if (s) {
      try {
        s.destroy();
      } catch {
        /* ze sproscen */
      }
    }
  }
}

/** Cel posnetek naenkrat; izhod je poravnan z vhodom (zakasnitev odstranjena) in enako dolg. */
export function ocistiPosnetekRnnoise(modul: RnnoiseModul, pcm: Int16Array, frekvenca: 8000 | 16000, mesanica = PRIVZETA_MESANICA): Int16Array {
  const c = new CiscenjeRnnoise(modul, { frekvenca, mesanica });
  try {
    const dodatek = new Int16Array(pcm.length + c.zakasnitev);
    dodatek.set(pcm);
    return c.obdelaj(dodatek).subarray(c.zakasnitev);
  } finally {
    c.unici();
  }
}

/** Kot ocistiPosnetekRnnoise, a v kosih po 0,1 s z odstopom zanke dogodkov med kosi (dolg posnetek ne zadrzi klicev v teku). */
export async function ocistiPosnetekRnnoiseAsinhrono(
  modul: RnnoiseModul,
  pcm: Int16Array,
  frekvenca: 8000 | 16000,
  mesanica = PRIVZETA_MESANICA,
): Promise<Int16Array> {
  const c = new CiscenjeRnnoise(modul, { frekvenca, mesanica });
  try {
    const dodatek = new Int16Array(pcm.length + c.zakasnitev);
    dodatek.set(pcm);
    const izid = new Int16Array(dodatek.length);
    // Kos 0,1 s: kos 1 s je zadrzal zanko do 199 ms (meritev naloge 17a), klic v istem procesu ima okvir 20 ms.
    const kosVzorcev = frekvenca / 10;
    for (let i = 0; i < dodatek.length; i += kosVzorcev) {
      const kos = dodatek.subarray(i, Math.min(dodatek.length, i + kosVzorcev));
      izid.set(c.obdelaj(kos), i);
      await naslednjiKrog();
    }
    return izid.subarray(c.zakasnitev);
  } finally {
    c.unici();
  }
}

/** Delez ociscenega zvoka za posnetek asistentke pred RSDO (pot a); izbrano po meritvi WER (POROCILO.md naloge 17a). */
export const MESANICA_RNNOISE_POSNETEK = 0.5;
/** Rep tisine pred 16 -> 8 kHz (kot meritev 17c): prevzorcevalnika in zakasnitev 8 kHz verige ne odrezeta konca govora. */
const REP_OZKO = 1600;

/**
 * Naloga 17d, pot (a) (veriga w8_rnn50, najboljsa v vseh stolpcih meritve 17c): 16 -> 8 kHz, Wiener (CiscenjeZvoka8k), RNNoise
 * 8 kHz z mesanico, 8 -> 16 kHz (Prevzorcevalnik kot VhodTwilioVLive). Izhod poravnan z vhodom in enako dolg. Kosi po 0,1 s z
 * odstopom zanke dogodkov (Prevzorcevalnik racuna utezi sproti, dolg posnetek ne sme zadrzati klicev v teku).
 */
export async function ocistiPosnetekOzkoAsinhrono(modul: RnnoiseModul, pcm: Int16Array, mesanica = MESANICA_RNNOISE_POSNETEK): Promise<Int16Array> {
  const dol = new Prevzorcevalnik(16000, 8000);
  const gor = new Prevzorcevalnik(8000, 16000);
  const wiener = new CiscenjeZvoka8k();
  const rnn = new CiscenjeRnnoise(modul, { frekvenca: 8000, mesanica });
  try {
    const vhod = new Int16Array(pcm.length + REP_OZKO);
    vhod.set(pcm);
    const izid = new Int16Array(pcm.length);
    let preskoci = ZAKASNITEV_VZORCEV + rnn.zakasnitev;
    let zapisano = 0;
    for (let i = 0; i < vhod.length && zapisano < izid.length; i += 1600) {
      let y8 = rnn.obdelaj(wiener.obdelaj(dol.process(vhod.subarray(i, Math.min(vhod.length, i + 1600)))));
      const odrezi = Math.min(preskoci, y8.length);
      y8 = y8.subarray(odrezi);
      preskoci -= odrezi;
      const y16 = gor.process(y8);
      const n = Math.min(y16.length, izid.length - zapisano);
      izid.set(y16.subarray(0, n), zapisano);
      zapisano += n;
      await naslednjiKrog();
    }
    return izid;
  } finally {
    rnn.unici();
  }
}
/** Najvec bajtov WAV za ciscenje (60 s pri 16 kHz = 1,92 MB; rezerva za glavo). */
const NAJVEC_WAV = 4 * 1024 * 1024;

/**
 * WAV 16 kHz mono 16-bit PCM (tudi z bloki LIST, kot ga zapise ffmpeg) -> ociscen WAV s preprosto 44-bajtno glavo.
 * Druga oblika, pokvarjena ali prevelika datoteka: null (klicatelj uporabi izvirnik). Asinhrono v kosih po 0,1 s.
 * ozko = false: RNNoise 16 kHz; ozko = true: veriga w8_rnn50 (ocistiPosnetekOzkoAsinhrono, pot a pred RSDO, naloga 17d).
 */
export async function ocistiWav16k(modul: RnnoiseModul, wav: Uint8Array, mesanica = MESANICA_RNNOISE_POSNETEK, ozko = false): Promise<Buffer | null> {
  if (wav.length < 12 || wav.length > NAJVEC_WAV) return null;
  const b = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
  let fmtOk = false;
  let pcm: Int16Array | null = null;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString("latin1", o, o + 4);
    const n = b.readUInt32LE(o + 4);
    const telo = o + 8;
    if (telo + n > b.length && id !== "data") return null;
    if (id === "fmt ") {
      if (n < 16) return null;
      fmtOk = b.readUInt16LE(telo) === 1 && b.readUInt16LE(telo + 2) === 1 && b.readUInt32LE(telo + 4) === 16000 && b.readUInt16LE(telo + 14) === 16;
      if (!fmtOk) return null;
    } else if (id === "data") {
      if (!fmtOk) return null;
      const dolzina = Math.floor(Math.min(n, b.length - telo) / 2);
      pcm = new Int16Array(dolzina);
      for (let i = 0; i < dolzina; i++) pcm[i] = b.readInt16LE(telo + i * 2);
      break;
    }
    o = telo + n + (n % 2);
  }
  if (!pcm) return null;
  const y = ozko ? await ocistiPosnetekOzkoAsinhrono(modul, pcm, mesanica) : await ocistiPosnetekRnnoiseAsinhrono(modul, pcm, 16000, mesanica);
  const izhod = Buffer.alloc(44 + y.length * 2);
  izhod.write("RIFF", 0, "latin1");
  izhod.writeUInt32LE(36 + y.length * 2, 4);
  izhod.write("WAVEfmt ", 8, "latin1");
  izhod.writeUInt32LE(16, 16);
  izhod.writeUInt16LE(1, 20);
  izhod.writeUInt16LE(1, 22);
  izhod.writeUInt32LE(16000, 24);
  izhod.writeUInt32LE(32000, 28);
  izhod.writeUInt16LE(2, 32);
  izhod.writeUInt16LE(16, 34);
  izhod.write("data", 36, "latin1");
  izhod.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) izhod.writeInt16LE(y[i] as number, 44 + i * 2);
  return izhod;
}
