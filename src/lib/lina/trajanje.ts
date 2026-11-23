/**
 * Ura pogovora. Steje koda od prvega obrata, ne model.
 * Opozorilo je 30 sekund pred iztekom, na naslednjem koncanem obratu.
 * Ce obrata v oknu ni bilo, opozorilo vseeno pride pred slovo.
 */

export type FazaTrajanja = "brez" | "opozorilo" | "potek";

export function fazaTrajanja(startedAt: string, now: string, minute: number | null): FazaTrajanja {
  if (minute == null || !(minute > 0)) return "brez";
  const zacetek = Date.parse(startedAt);
  const trenutno = Date.parse(now);
  if (!Number.isFinite(zacetek) || !Number.isFinite(trenutno)) return "brez";
  const ostane = minute * 60_000 - (trenutno - zacetek);
  if (ostane <= 0) return "potek";
  if (ostane <= 30_000) return "opozorilo";
  return "brez";
}

/**
 * Trda meja zbiranja. Naslednji obrat pride, preden preskocimo 30 s opozorila.
 * Najvec 20 s, da molk ne skoci iz faze brez naravnost v potek.
 */
export function rokZbira(startedAt: string, now: string, minute: number | null): number {
  const meja = 20;
  if (minute == null || !(minute > 0)) return meja;
  const zacetek = Date.parse(startedAt);
  const trenutno = Date.parse(now);
  if (!Number.isFinite(zacetek) || !Number.isFinite(trenutno)) return meja;
  const sek = Math.floor((minute * 60_000 - (trenutno - zacetek)) / 1000);
  if (sek <= 30) return Math.max(1, Math.min(meja, sek));
  return Math.max(1, Math.min(meja, sek - 30));
}
