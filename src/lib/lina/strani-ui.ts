import { normirajIzvor } from "./strani-dovoljenja.ts";
import type { DovoljenaStran, IzidNormiranjaIzvora } from "./strani-dovoljenja.ts";

export function razvrstiStrani(seznam: readonly DovoljenaStran[]): DovoljenaStran[] {
  return [...seznam].sort((a, b) => {
    if (a.obcutljiva !== b.obcutljiva) {
      return a.obcutljiva ? -1 : 1;
    }
    return a.izvor.localeCompare(b.izvor);
  });
}

export function preveriVnos(vnos: string): IzidNormiranjaIzvora {
  const obrezan = vnos.trim();
  return normirajIzvor(obrezan);
}

export function povzetekStrani(seznam: readonly DovoljenaStran[]): { skupaj: number; obcutljivih: number } {
  return {
    skupaj: seznam.length,
    obcutljivih: seznam.filter((s) => s.obcutljiva).length,
  };
}
