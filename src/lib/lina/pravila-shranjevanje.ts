import type { Pravila } from "./types.ts";

/**
 * Polja pravila.json, ki jih pise tudi kdo drug kot namizje: telefon (navodila, dodatki), tunel (javniNaslov), izbira mape (mapaZapiskov).
 * Pregled 0225 B3: namizje ta polja poslje SAMO, ce jih je lastnik spremenil glede na posnetek streznika, dodatke pa po kljucih
 * (streznik jih spoji s stanjem na disku). Ostala polja gredo cela kot doslej, ker strezniska preverba nekatere privzete vrednosti
 * izpelje iz tega, ali je polje podano (tisina, potrditev e-poste).
 */
const POLJA_DRUGIH_PISCEV = ["navodila", "javniNaslov", "mapaZapiskov"] as const;

export function zaShranjevanje<T extends Partial<Pravila>>(osnova: T, next: T): Partial<T> {
  const izhod: Partial<T> = { ...next };
  for (const k of POLJA_DRUGIH_PISCEV) if (next[k] === osnova[k]) delete izhod[k];
  const dodatki: Record<string, boolean> = {};
  const prej = (osnova.dodatki ?? {}) as Record<string, boolean | undefined>;
  for (const [k, v] of Object.entries(next.dodatki ?? {})) if (prej[k] !== v) dodatki[k] = v;
  if (Object.keys(dodatki).length) izhod.dodatki = dodatki as T["dodatki"];
  else delete izhod.dodatki;
  return izhod;
}
