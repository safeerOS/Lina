import { AsyncLocalStorage } from "node:async_hooks";
import type { CallSession, ImeStopnje, MerjenjeObrata } from "./types.ts";

/**
 * Meritev casa po stopnjah obrata klica (lastnik 12. 11. 2026: Lina mora biti zelo odzivna, odloca meritev).
 * Zapise so SAMO stevila v ms in oznaka povezave: nikoli besedilo, ime, stevilka ali kljuc.
 * Zbiralnik tece skozi AsyncLocalStorage, zato stopnje globoko v kodi (TTS, zapis WAV, model) ne rabijo CallSid.
 */
export class Zbiralnik {
  private ms: Partial<Record<ImeStopnje, number>> = {};
  private pov: "hladna" | "topla" | undefined;
  private st429 = 0;
  private cas429 = 0;

  /** vsota: zaporedne zahteve v isti stopnji; najvec: vzporedni kosi (stena ure je najdaljsi kos). */
  dodaj(ime: ImeStopnje, ms: number, nacin: "vsota" | "najvec" = "vsota"): void {
    const m = Math.max(0, Math.round(ms));
    const prej = this.ms[ime] ?? 0;
    this.ms[ime] = nacin === "najvec" ? Math.max(prej, m) : prej + m;
  }

  /** Hladna prevlada: ce je bila ena zahteva na novi povezavi, je obrat placal rokovanje. */
  povezava(topla: boolean): void {
    if (!topla) this.pov = "hladna";
    else if (this.pov === undefined) this.pov = "topla";
  }

  /** Vzame meritev drugega zbiralnika (npr. uporabljen spekulativni klic): vsota ms, hladna prevlada, 429. */
  zdruzi(drug: MerjenjeObrata): void {
    for (const [ime, ms] of Object.entries(drug.ms)) if (typeof ms === "number") this.dodaj(ime as ImeStopnje, ms);
    if (drug.povezava) this.povezava(drug.povezava === "topla");
    this.st429 += drug.n429 ?? 0;
    this.cas429 += drug.ms429 ?? 0;
  }

  omejitev429(ms: number): void {
    this.st429 += 1;
    this.cas429 += Math.max(0, Math.round(ms));
  }

  posnetek(): MerjenjeObrata {
    const izid: MerjenjeObrata = { ms: { ...this.ms } };
    if (this.pov) izid.povezava = this.pov;
    if (this.st429 > 0) {
      izid.n429 = this.st429;
      izid.ms429 = this.cas429;
    }
    return izid;
  }
}

const shramba = new AsyncLocalStorage<Zbiralnik>();

export function vZbiralniku<T>(zbiralnik: Zbiralnik, delo: () => T): T {
  return shramba.run(zbiralnik, delo);
}

export function trenutniZbiralnik(): Zbiralnik | undefined {
  return shramba.getStore();
}

/** Izvede delo in cas doda trenutnemu zbiralniku (tudi ob napaki). Brez zbiralnika samo izvede. */
export async function merjeno<T>(
  ime: ImeStopnje,
  delo: () => Promise<T>,
  nacin: "vsota" | "najvec" = "vsota",
  ura: () => number = () => performance.now(),
): Promise<T> {
  const zb = shramba.getStore();
  if (!zb) return delo();
  const zacetek = ura();
  try {
    return await delo();
  } finally {
    zb.dodaj(ime, ura() - zacetek, nacin);
  }
}

/** Odgovor 429 (omejitev ponudnika) z ms te zahteve v zbiralnik trenutnega obrata. */
export function zabeleziOdgovor(status: number, ms: number): void {
  if (status === 429) shramba.getStore()?.omejitev429(ms);
}

/** Percentil po najblizjem rangu. Prazen seznam: null. */
export function percentil(vrednosti: number[], p: number): number | null {
  if (vrednosti.length === 0) return null;
  const urejene = [...vrednosti].sort((a, b) => a - b);
  const rang = Math.max(1, Math.ceil((p / 100) * urejene.length));
  return urejene[Math.min(urejene.length, rang) - 1];
}

export function merjenjaIzKlicev(klici: CallSession[]): MerjenjeObrata[] {
  const izid: MerjenjeObrata[] = [];
  for (const klic of klici) {
    for (const vrstica of klic.transcript ?? []) if (vrstica.merjenje) izid.push(vrstica.merjenje);
  }
  return izid;
}

export type PovzetekMeritev = {
  stopnje: Record<string, { n: number; p50: number; p95: number; najvec: number }>;
  povezava: { hladna: number; topla: number };
  omejitve429: { n: number; ms: number };
};

export function povzetekMeritev(merjenja: MerjenjeObrata[]): PovzetekMeritev {
  const poStopnji = new Map<string, number[]>();
  const izid: PovzetekMeritev = { stopnje: {}, povezava: { hladna: 0, topla: 0 }, omejitve429: { n: 0, ms: 0 } };
  for (const m of merjenja) {
    for (const [ime, ms] of Object.entries(m.ms)) {
      if (typeof ms !== "number" || !Number.isFinite(ms)) continue;
      poStopnji.set(ime, [...(poStopnji.get(ime) ?? []), ms]);
    }
    if (m.povezava) izid.povezava[m.povezava] += 1;
    izid.omejitve429.n += m.n429 ?? 0;
    izid.omejitve429.ms += m.ms429 ?? 0;
  }
  for (const [ime, vrednosti] of poStopnji) {
    izid.stopnje[ime] = {
      n: vrednosti.length,
      p50: percentil(vrednosti, 50) ?? 0,
      p95: percentil(vrednosti, 95) ?? 0,
      najvec: Math.max(...vrednosti),
    };
  }
  return izid;
}

/** Berljiv izpis za lastnika ali dnevnik: samo stevila. */
export function izpisPovzetka(p: PovzetekMeritev): string {
  const imena = Object.keys(p.stopnje);
  if (imena.length === 0) return "Ni meritev.";
  const vrstice = ["stopnja        n    p50 ms   p95 ms   najvec ms"];
  for (const ime of imena) {
    const s = p.stopnje[ime];
    vrstice.push(`${ime.padEnd(13)} ${String(s.n).padStart(3)} ${String(s.p50).padStart(8)} ${String(s.p95).padStart(8)} ${String(s.najvec).padStart(10)}`);
  }
  vrstice.push(`povezava: hladna ${p.povezava.hladna}, topla ${p.povezava.topla}; 429: ${p.omejitve429.n}x, ${p.omejitve429.ms} ms`);
  return vrstice.join("\n");
}
