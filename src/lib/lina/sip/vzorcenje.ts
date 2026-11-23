/**
 * Prevzorcenje 8 kHz <-> 24 kHz (faktor 3) z nizkoprepustnim sitom FIR (okno Blackman, meja 3,7 kHz).
 * Stanje med okvirji (20 ms) ostane v objektu, zato na mejah okvirjev ni pokov. Brez odvisnosti.
 */

const STEVILO_KOEF = 63;
const MEJA_HZ = 3700;
const HITROST_VISOKA = 24000;
export const FAKTOR = 3;

function nacrtajSito(): Float64Array {
  const h = new Float64Array(STEVILO_KOEF);
  const fc = MEJA_HZ / HITROST_VISOKA;
  const sredina = (STEVILO_KOEF - 1) / 2;
  let vsota = 0;
  for (let n = 0; n < STEVILO_KOEF; n++) {
    const x = n - sredina;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const okno = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (STEVILO_KOEF - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (STEVILO_KOEF - 1));
    h[n] = sinc * okno;
    vsota += h[n] as number;
  }
  for (let n = 0; n < STEVILO_KOEF; n++) h[n] = (h[n] as number) / vsota;
  return h;
}

const SITO = nacrtajSito();

function omeji(v: number): number {
  const r = Math.round(v);
  return r > 32767 ? 32767 : r < -32768 ? -32768 : r;
}

/** 8 kHz -> 24 kHz (glas klicatelja za Gemini). */
export class Navzgor8v24 {
  private zgodovina = new Float64Array(Math.ceil(STEVILO_KOEF / FAKTOR));

  obdelaj(vhod: Int16Array): Int16Array {
    const L = this.zgodovina.length;
    const izid = new Int16Array(vhod.length * FAKTOR);
    for (let n = 0; n < vhod.length; n++) {
      this.zgodovina.copyWithin(1, 0, L - 1);
      this.zgodovina[0] = vhod[n] as number;
      for (let p = 0; p < FAKTOR; p++) {
        let y = 0;
        for (let j = 0; p + FAKTOR * j < STEVILO_KOEF; j++) y += (SITO[p + FAKTOR * j] as number) * (this.zgodovina[j] as number);
        izid[n * FAKTOR + p] = omeji(y * FAKTOR);
      }
    }
    return izid;
  }
}

/** 24 kHz -> 8 kHz (Linin glas za klicatelja); pred decimacijo nizkoprepustno sito proti prekrivanju. */
export class Navzdol24v8 {
  private zgodovina = new Float64Array(STEVILO_KOEF);
  private faza = 0;

  obdelaj(vhod: Int16Array): Int16Array {
    const izid: number[] = [];
    for (let i = 0; i < vhod.length; i++) {
      this.zgodovina.copyWithin(1, 0, STEVILO_KOEF - 1);
      this.zgodovina[0] = vhod[i] as number;
      if (this.faza === 0) {
        let y = 0;
        for (let k = 0; k < STEVILO_KOEF; k++) y += (SITO[k] as number) * (this.zgodovina[k] as number);
        izid.push(omeji(y));
      }
      this.faza = (this.faza + 1) % FAKTOR;
    }
    return Int16Array.from(izid);
  }
}

/** Brez stanja: en kos 8 kHz -> 24 kHz. */
export function prevzorci8v24(vhod: Int16Array): Int16Array {
  return new Navzgor8v24().obdelaj(vhod);
}

/** Brez stanja: en kos 24 kHz -> 8 kHz. */
export function prevzorci24v8(vhod: Int16Array): Int16Array {
  return new Navzdol24v8().obdelaj(vhod);
}
