/**
 * Zasedenost linije (lastnik 11. 11. 2026: »socasnih klicev ne sprejemamo«). Cista logika brez ure in sistema.
 * Aktivni klic je tisti, ki ga Lina vodi in od katerega je v zadnjem casu prisla zahteva; drugi klic dobi sporocilo
 * »zasedeno« in se konca, stanje prvega klica se ne dotakne.
 */

/** Brez zahteve prvega klica toliko casa (ms) velja klic za prekinjenega (omrezje, Twilio ni poklical statusa). */
export const ZASEDENOST_IZTEK_MS = 120_000;

export type AktivniKlic = { sid: string; zadnji: number } | null;

export function jeLinijaZasedena(input: {
  aktivni: AktivniKlic;
  sid: string;
  /** Zapis aktivnega klica je ze zakljucen (Lina se je poslovila). */
  aktivniZakljucen: boolean;
  now: number;
  iztekMs?: number;
}): boolean {
  const { aktivni } = input;
  if (!aktivni || !input.sid) return false;
  if (aktivni.sid === input.sid) return false;
  if (input.aktivniZakljucen) return false;
  return input.now - aktivni.zadnji < (input.iztekMs ?? ZASEDENOST_IZTEK_MS);
}
