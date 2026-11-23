/**
 * Sinteticni signali za preizkuse cistenja zvoka (8 kHz, 16-bitni PCM): govoru podoben signal (harmoniki z oblikovalnimi
 * poudarki in zlogi s presledki), beli sum, brnenje 50 Hz, ventilator (nizkopasovni sum) in mesanje na dani SNR.
 * Deterministicno (seme). To NI pravi govor: dokazuje obnasanje filtra, ne razumevanja pri Gemini.
 * Komentarji so brez sumnikov.
 */

export const HITROST = 8000;

export function nakljucni(seme: number): () => number {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Govoru podoben signal: zlogi po 250 ms s presledki po 150 ms, osnovna frekvenca 95 do 145 Hz, vrh 6000. */
export function sinteticniGovor(vzorcev: number): Int16Array {
  const izhod = new Float64Array(vzorcev);
  const formanti = [
    [600, 150],
    [1400, 200],
    [2500, 300],
  ] as const;
  let faza = 0;
  for (let i = 0; i < vzorcev; i++) {
    const t = i / HITROST;
    const f0 = 120 + 15 * Math.sin(2 * Math.PI * 0.7 * t) + 10 * Math.sin(2 * Math.PI * 0.23 * t);
    faza += (2 * Math.PI * f0) / HITROST;
    const v = t % 0.4;
    let ovojnica = 0;
    if (v < 0.25) ovojnica = Math.min(1, v / 0.03, (0.25 - v) / 0.03) ** 2;
    if (ovojnica <= 0) continue;
    let vsota = 0;
    for (let h = 1; h * f0 < 3600; h++) {
      const f = h * f0;
      let amp = 0.05 / h;
      for (const [fc, bw] of formanti) amp += Math.exp(-0.5 * ((f - fc) / bw) ** 2);
      vsota += amp * Math.sin(h * faza);
    }
    izhod[i] = vsota * ovojnica;
  }
  let vrh = 0;
  for (const v of izhod) vrh = Math.max(vrh, Math.abs(v));
  const faktor = vrh > 0 ? 6000 / vrh : 0;
  return Int16Array.from(izhod, (v) => Math.round(v * faktor));
}

export function belSum(vzorcev: number, seme = 7): Float64Array {
  const r = nakljucni(seme);
  return Float64Array.from({ length: vzorcev }, () => gauss(r));
}

/** Ventilator: beli sum skozi enopolni nizki filter (poudarek pod ~600 Hz). */
export function ventilator(vzorcev: number, seme = 11): Float64Array {
  const b = belSum(vzorcev, seme);
  let y = 0;
  for (let i = 0; i < vzorcev; i++) {
    y = 0.75 * y + 0.25 * (b[i] as number);
    b[i] = y;
  }
  return b;
}

/** Brnenje 50 Hz z lihimi harmoniki do 450 Hz. */
export function brnenje(vzorcev: number): Float64Array {
  return Float64Array.from({ length: vzorcev }, (_v, i) => {
    const t = i / HITROST;
    let s = 0;
    for (const [h, a] of [
      [1, 1],
      [3, 0.5],
      [5, 0.3],
      [7, 0.2],
      [9, 0.1],
    ] as const)
      s += a * Math.sin(2 * Math.PI * 50 * h * t);
    return s;
  });
}

/** Mesanje: sum se prilagodi, da je SNR (po vsem signalu) tocno snrDb. */
export function zmesaj(cisto: Int16Array, sum: ArrayLike<number>, snrDb: number): Int16Array {
  let es = 0;
  let en = 0;
  for (let i = 0; i < cisto.length; i++) {
    es += (cisto[i] as number) ** 2;
    en += (sum[i] as number) ** 2;
  }
  const faktor = en > 0 ? Math.sqrt(es / en / 10 ** (snrDb / 10)) : 0;
  return Int16Array.from(cisto, (c, i) => Math.max(-32768, Math.min(32767, Math.round(c + faktor * (sum[i] as number)))));
}
