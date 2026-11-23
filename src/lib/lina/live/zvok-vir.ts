/**
 * Vir zvoka klicatelja za lokalni prepis (RSDO) ob Gemini (lastnik 19. 11. 2026: »Gemini z RSDO namigom je zelo dober rezultat«).
 * Isti vmesnik za vse poti klica: openline-ws (PCM 16 kHz), twilio-stream (mu-law 8 kHz), pozneje sip-rtp. Izhod je vedno
 * PCM 16-bit mono 16 kHz v kosih po 20 ms (320 vzorcev), kot ga pricakuje prepoznavalnik. Cista koda brez omrezja in sistema.
 * Simulacija iz WAV omogoca preizkus brez pravega klica (koncna tocka zvoka klicatelja se ni izmerjena).
 */
import { bajtiVPcm, Prevzorcevalnik, VhodTwilioVLive, wavVPcm } from "./zvok.ts";

export type ZvokVirId = "openline-ws" | "twilio-stream" | "sip-rtp" | "wav-simulacija";

/** 20 ms pri 16 kHz. */
export const KOS_VZORCEV_16K = 320;

export interface ZvokVir {
  readonly id: ZvokVirId;
  /** Kosi PCM 16-bit mono 16 kHz po KOS_VZORCEV_16K vzorcev; zadnji kos je lahko krajsi. Konec toka = konec klica. */
  kosi(): AsyncIterable<Int16Array>;
  /** Zapri vir; nadaljnji kosi se zavrnejo, cakajoci bralec dobi konec. */
  zapri(): void;
}

/** Vrsta kosov s potiskom (adapterji za Twilio in OpenLine); omejena, da pocasen prepoznavalnik ne polni pomnilnika. */
export class PotisniVir implements ZvokVir {
  private readonly vrsta: Int16Array[] = [];
  private ostanek = new Int16Array(0);
  private caka: ((v: IteratorResult<Int16Array>) => void) | null = null;
  private konec = false;
  private zavrzeno = 0;

  readonly id: ZvokVirId;
  private readonly najvecKosov: number;

  // Brez parametrskih lastnosti: Node v nacinu strip-types jih ne podpira.
  constructor(id: ZvokVirId, najvecKosov = 3000 /* 60 s zvoka */) {
    this.id = id;
    this.najvecKosov = najvecKosov;
  }

  /** Stevilo kosov, zavrzenih zaradi polne vrste (najstarejsi gre ven: pomembnejsi je zadnji del klica). */
  get zavrzenih(): number {
    return this.zavrzeno;
  }

  potisni(pcm16k: Int16Array): void {
    if (this.konec) return;
    const vse = new Int16Array(this.ostanek.length + pcm16k.length);
    vse.set(this.ostanek, 0);
    vse.set(pcm16k, this.ostanek.length);
    let i = 0;
    for (; i + KOS_VZORCEV_16K <= vse.length; i += KOS_VZORCEV_16K) this.dodaj(vse.slice(i, i + KOS_VZORCEV_16K));
    this.ostanek = vse.slice(i);
  }

  private dodaj(kos: Int16Array): void {
    if (this.caka) {
      const k = this.caka;
      this.caka = null;
      k({ value: kos, done: false });
      return;
    }
    if (this.vrsta.length >= this.najvecKosov) {
      this.vrsta.shift();
      this.zavrzeno += 1;
    }
    this.vrsta.push(kos);
  }

  zapri(): void {
    if (this.konec) return;
    if (this.ostanek.length > 0) {
      const zadnji = this.ostanek;
      this.ostanek = new Int16Array(0);
      this.dodaj(zadnji);
    }
    this.konec = true;
    if (this.caka) {
      const k = this.caka;
      this.caka = null;
      k({ value: undefined, done: true });
    }
  }

  kosi(): AsyncIterable<Int16Array> {
    const vir = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Int16Array>> {
            const kos = vir.vrsta.shift();
            if (kos) return Promise.resolve({ value: kos, done: false });
            if (vir.konec) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => {
              vir.caka = resolve;
            });
          },
        };
      },
    };
  }
}

/** Adapter Twilio Media Streams: okvirji mu-law 8 kHz -> PCM 16 kHz. Ena instanca na klic. */
export class ZvokVirTwilio extends PotisniVir {
  private readonly pretvornik = new VhodTwilioVLive();

  constructor() {
    super("twilio-stream");
  }

  potisniMulaw(mulaw: Uint8Array): void {
    this.potisni(bajtiVPcm(this.pretvornik.process(mulaw)));
  }
}

/** Simulacija klica iz posnetka WAV (16-bit mono PCM, poljubna frekvenca); vrne null, ce oblika ni podprta. */
export function zvokVirIzWav(wav: Uint8Array): ZvokVir | null {
  const w = wavVPcm(wav);
  if (!w) return null;
  const pcm16k = w.frekvenca === 16000 ? w.pcm : new Prevzorcevalnik(w.frekvenca, 16000).process(w.pcm);
  const vir = new PotisniVir("wav-simulacija", Math.ceil(pcm16k.length / KOS_VZORCEV_16K) + 1);
  vir.potisni(pcm16k);
  vir.zapri();
  return vir;
}
