/**
 * Zvok za most Twilio Media Streams <-> Gemini Live. Cista koda brez omrezja in sistema (Linux in Windows enako).
 * - G.711 mu-law (ITU-T G.711): Twilio poslje in sprejme mu-law 8 kHz, 20 ms = 160 bajtov.
 * - Live sprejme PCM 16-bit 16 kHz in vrne PCM 16-bit 24 kHz.
 * Pretvorba izhoda je dvostopenjska 24 -> 16 -> 8 kHz z nizkim sitom pred vsakim zmanjsanjem frekvence, da visoki toni
 * ne zrcalijo v govor (aliasing). Pri stalnih posnetkih Line (pcm24VWav8) ostane preprosta decimacija, ki jo je lastnik
 * izbral s posluhom; tu je pot Live, kjer je merilo preizkus brez aliasinga.
 */

import { CiscenjeZvoka8k } from "../zvok-ciscenje.ts";

const BIAS = 0x84;
const CLIP = 32635;

/** Linearni vzorec 16-bit -> mu-law bajt po ITU G.711 (zgoscevanje na 8 bitov, bias 0x84, odrez 32635). */
export function linearVMulaw(vzorec: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(vzorec)));
  const predznak = (s >> 8) & 0x80;
  if (predznak) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let eksponent = 7;
  for (let maska = 0x4000; (s & maska) === 0 && eksponent > 0; eksponent -= 1, maska >>= 1);
  const mantisa = (s >> (eksponent + 3)) & 0x0f;
  return ~(predznak | (eksponent << 4) | mantisa) & 0xff;
}

/** mu-law bajt -> linearni vzorec 16-bit (ITU G.711). */
export function mulawVLinear(bajt: number): number {
  const u = ~bajt & 0xff;
  const predznak = u & 0x80;
  const eksponent = (u >> 4) & 0x07;
  const mantisa = u & 0x0f;
  const vzorec = (((mantisa << 3) + BIAS) << eksponent) - BIAS;
  return predznak ? 0 - vzorec : vzorec;
}

export function mulawVPcm(mulaw: Uint8Array): Int16Array {
  const ven = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i += 1) ven[i] = mulawVLinear(mulaw[i]);
  return ven;
}

export function pcmVMulaw(pcm: Int16Array): Uint8Array {
  const ven = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) ven[i] = linearVMulaw(pcm[i]);
  return ven;
}

/** Tisina v mu-law (linearna 0). */
export const MULAW_TISINA = 0xff;

/** Okvir Twilio: 20 ms pri 8 kHz = 160 bajtov mu-law. */
export const OKVIR_BAJTOV = 160;

/**
 * Vbrizgan cistilnik PCM (npr. RNNoise iz zvok-rnnoise.server.ts): vrne natanko toliko vzorcev, kot jih je dobil; unici() sprosti
 * vire. Ta datoteka ga NE uvaza (WASM ~5 MB ostane samo na strezniku).
 */
export type CistilnikPcm = { obdelaj(pcm: Int16Array): Int16Array; unici(): void };

/**
 * Tokovni prevzorcevalnik z oknastim sincom (Hann). Meja sita je 0,95 manjse od frekvenc Nyquista (pri zmanjsanju
 * izhodne, pri povecanju vhodne); vsak izhodni vzorec je normaliziran z vsoto tez (enosmerna komponenta ostane 1).
 * Zgodovina vzorcev se ohrani med klici process(), zato kosi poljubne dolzine dajo isti izhod kot celota.
 */
export class Prevzorcevalnik {
  private readonly razmerje: number;
  private readonly meja: number;
  private readonly pol: number;
  private zgodovina: number[] = [];
  /** Absolutni indeks vzorca zgodovina[0]. */
  private zacetek: number;
  /** Absolutni (ulomljeni) indeks vhoda, kamor pade naslednji izhodni vzorec. */
  private polozaj = 0;

  readonly vhodnaFrekvenca: number;
  readonly izhodnaFrekvenca: number;

  constructor(vhodnaFrekvenca: number, izhodnaFrekvenca: number, nicleSinca = 8) {
    this.vhodnaFrekvenca = vhodnaFrekvenca;
    this.izhodnaFrekvenca = izhodnaFrekvenca;
    this.razmerje = vhodnaFrekvenca / izhodnaFrekvenca;
    this.meja = 0.95 * Math.min(1, izhodnaFrekvenca / vhodnaFrekvenca);
    this.pol = nicleSinca / this.meja;
    this.zacetek = -Math.ceil(this.pol);
    this.zgodovina = new Array<number>(Math.ceil(this.pol)).fill(0);
  }

  private utez(t: number): number {
    if (Math.abs(t) >= this.pol) return 0;
    const x = Math.PI * this.meja * t;
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
    return this.meja * sinc * (0.5 * (1 + Math.cos((Math.PI * t) / this.pol)));
  }

  process(vhod: Int16Array): Int16Array {
    for (let i = 0; i < vhod.length; i += 1) this.zgodovina.push(vhod[i]);
    const ven: number[] = [];
    const konec = this.zacetek + this.zgodovina.length;
    while (this.polozaj + this.pol < konec) {
      const od = Math.ceil(this.polozaj - this.pol);
      const do_ = Math.floor(this.polozaj + this.pol);
      let vsota = 0;
      let utezi = 0;
      for (let k = od; k <= do_; k += 1) {
        const w = this.utez(this.polozaj - k);
        vsota += this.zgodovina[k - this.zacetek] * w;
        utezi += w;
      }
      const y = utezi === 0 ? 0 : vsota / utezi;
      ven.push(Math.max(-32768, Math.min(32767, Math.round(y))));
      this.polozaj += this.razmerje;
    }
    // Zgodovina, ki je nobena nadaljnja izhodna tocka ne potrebuje, gre ven.
    const odrezi = Math.floor(this.polozaj - this.pol) - this.zacetek;
    if (odrezi > 0) {
      this.zgodovina.splice(0, odrezi);
      this.zacetek += odrezi;
    }
    return Int16Array.from(ven);
  }
}

/** Little-endian PCM 16-bit bajti <-> Int16Array. Lih bajt na koncu se zavrze. */
export function bajtiVPcm(bajti: Uint8Array): Int16Array {
  const n = Math.floor(bajti.length / 2);
  const ven = new Int16Array(n);
  const pogled = new DataView(bajti.buffer, bajti.byteOffset, bajti.byteLength);
  for (let i = 0; i < n; i += 1) ven[i] = pogled.getInt16(i * 2, true);
  return ven;
}

export function pcmVBajte(pcm: Int16Array): Uint8Array {
  const ven = new Uint8Array(pcm.length * 2);
  const pogled = new DataView(ven.buffer);
  for (let i = 0; i < pcm.length; i += 1) pogled.setInt16(i * 2, pcm[i], true);
  return ven;
}

/**
 * Vhod: mu-law 8 kHz (Twilio in SIP prek mosta) -> PCM 16-bit 16 kHz (Live). Ena instanca na klic.
 * Ciscenje stalnega suma (zvok-ciscenje.ts, zakasnitev 32 ms) je privzeto IZKLOPLJENO v tem razredu, da ostanejo drugi uporabniki
 * (zvok-vir, preizkusi) nespremenjeni; most klicev ga vklopi izrecno (privzeto vklopljeno za klice, lastnik 21. 11. 2026).
 */
export class VhodTwilioVLive {
  private readonly gor = new Prevzorcevalnik(8000, 16000);
  private readonly cistilnik: CiscenjeZvoka8k | null;
  private readonly dodatno: CistilnikPcm | null;

  /** dodatno: vbrizgan cistilnik 8 kHz (RNNoise, naloga 17a) za Wienerjem; null = kot prej. */
  constructor(ciscenje = false, dodatno: CistilnikPcm | null = null) {
    this.cistilnik = ciscenje ? new CiscenjeZvoka8k() : null;
    this.dodatno = dodatno;
  }

  /** Vrne PCM 16-bit little-endian 16 kHz. */
  process(mulaw: Uint8Array): Uint8Array {
    let pcm8 = mulawVPcm(mulaw);
    if (this.cistilnik) pcm8 = this.cistilnik.obdelaj(pcm8);
    if (this.dodatno) pcm8 = this.dodatno.obdelaj(pcm8);
    return pcmVBajte(this.gor.process(pcm8));
  }

  /** Konec klica: sprosti vbrizgani cistilnik (pomnilnik WASM). */
  unici(): void {
    this.dodatno?.unici();
  }
}

/** Izhod: PCM 24 kHz (Live) -> 24->16->8 kHz -> mu-law -> okvirji po 160 bajtov (Twilio). Ena instanca na klic. */
export class IzhodLiveVTwilio {
  private readonly prva = new Prevzorcevalnik(24000, 16000);
  private readonly druga = new Prevzorcevalnik(16000, 8000);
  private ostanek = new Uint8Array(0);

  /** Vrne samo POLNE okvirje (160 bajtov); nepopoln ostanek caka na naslednji kos. */
  process(pcm24k: Uint8Array): Uint8Array[] {
    const mulaw = pcmVMulaw(this.druga.process(this.prva.process(bajtiVPcm(pcm24k))));
    const vse = new Uint8Array(this.ostanek.length + mulaw.length);
    vse.set(this.ostanek, 0);
    vse.set(mulaw, this.ostanek.length);
    const okvirji: Uint8Array[] = [];
    let i = 0;
    for (; i + OKVIR_BAJTOV <= vse.length; i += OKVIR_BAJTOV) okvirji.push(vse.slice(i, i + OKVIR_BAJTOV));
    this.ostanek = vse.slice(i);
    return okvirji;
  }

  /** Konec odgovora: nepopoln ostanek se dopolni s tisino in vrne kot zadnji okvir (ali nic). */
  izprazni(): Uint8Array[] {
    if (this.ostanek.length === 0) return [];
    const okvir = new Uint8Array(OKVIR_BAJTOV).fill(MULAW_TISINA);
    okvir.set(this.ostanek, 0);
    this.ostanek = new Uint8Array(0);
    return [okvir];
  }

  /** Prekinitev ali varovalka: ostanek odgovora gre ven; filtra ostaneta (ni preskoka na naslednjem odgovoru). */
  zavrzi(): void {
    this.ostanek = new Uint8Array(0);
  }
}

/** Posnetek mu-law razrezan na okvirje po 160 bajtov; zadnji okvir se dopolni s tisino. */
export function razrezi(mulaw: Uint8Array): Uint8Array[] {
  const okvirji: Uint8Array[] = [];
  for (let i = 0; i < mulaw.length; i += OKVIR_BAJTOV) {
    const kos = mulaw.slice(i, i + OKVIR_BAJTOV);
    if (kos.length === OKVIR_BAJTOV) okvirji.push(kos);
    else {
      const okvir = new Uint8Array(OKVIR_BAJTOV).fill(MULAW_TISINA);
      okvir.set(kos, 0);
      okvirji.push(okvir);
    }
  }
  return okvirji;
}

/** WAV 16-bit mono (glava RIFF, 44 bajtov) -> PCM vzorci in frekvenca. Null, ce oblika ni 16-bit mono PCM. */
export function wavVPcm(wav: Uint8Array): { pcm: Int16Array; frekvenca: number } | null {
  if (wav.length < 44) return null;
  const pogled = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const oznaka = (od: number) => String.fromCharCode(wav[od], wav[od + 1], wav[od + 2], wav[od + 3]);
  if (oznaka(0) !== "RIFF" || oznaka(8) !== "WAVE" || oznaka(12) !== "fmt ") return null;
  if (pogled.getUint16(20, true) !== 1 || pogled.getUint16(22, true) !== 1 || pogled.getUint16(34, true) !== 16) return null;
  const frekvenca = pogled.getUint32(24, true);
  if (oznaka(36) !== "data") return null;
  const dolzina = Math.min(pogled.getUint32(40, true), wav.length - 44);
  return { pcm: bajtiVPcm(wav.subarray(44, 44 + dolzina)), frekvenca };
}
