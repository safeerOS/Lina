/**
 * Klicatelj brez stevilke, ki kaze sum, da je bot (lastnik 12. 11. 2026: »ce je klicatelj resnicno brez stevilke in kaze sum,
 * da je bot, Lina to zavrne«). Prikrita stevilka NI brez stevilke: klicatelj jo ima, le prikaz je izklopljen (Twilio jo poda
 * kot anonymous ali kot kratko zaporedje stevk), zato taki klici gredo skozi kot vsi drugi.
 * Odlocitev vodi koda, ne model: zavrnitev samo ob obeh pogojih (resnicno brez stevilke IN znak bota).
 * Komentarji brez sumnikov.
 */
export const NAJVEC_TIHIH_ZAPORED = 2;
export const NAJVEC_ENAKIH_ZAPORED = 3;
const NAJVEC_KLICEV = 300;
const ROK_MS = 60 * 60_000;

/** Znacilne fraze avtomatskih klicev (robocall, IVR). Pogoj za zavrnitev je sele skupaj z manjkajoco stevilko. */
const FRAZE_BOTA = [
  /\bto\s+je\s+(avtomatsko|samodejno|posneto)\s+sporocilo\b/,
  /\bthis\s+is\s+an?\s+(automated|recorded)\b/,
  /\bextended\s+warranty\b/,
  /\bzadnje\s+(stiri|4)\s+stevilke\s+(vase\s+)?kartice\b/,
  /\bkod[ao]\s+iz\s+sms\b/,
  /\bgeslo\s+(za|od)\s+(banko|bancni|spletno)\b/,
];

/** Resnicno brez stevilke: prazno ali karkoli, kar ni stevilka (+ in stevke) in ni znana beseda za prikrito stevilko. */
export function jeBrezStevilke(from: string | undefined | null): boolean {
  const v = (from ?? "").trim().toLowerCase();
  if (!v) return true;
  if (/^\+\d{3,15}$/.test(v)) return false;
  if (/^(anonymous|restricted|unavailable|unknown|private|blocked|withheld)$/.test(v)) return false;
  return true;
}

function brezSumnikov(besedilo: string): string {
  return besedilo
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Stanje = { tihi: number; enaki: number; zadnji: string; rok: number };
const stanja = new Map<string, Stanje>();

export function pozabiSumKlicev(): void {
  stanja.clear();
}

function pocisti(zdaj: number): void {
  for (const [k, s] of stanja) if (s.rok <= zdaj) stanja.delete(k);
  if (stanja.size >= NAJVEC_KLICEV) stanja.clear();
}

/**
 * Ali naj Lina ta obrat zavrne. Klic za vsak obrat klica BREZ stevilke; klici s stevilko (tudi prikrito) nikoli ne.
 * izrek: kar je klicatelj rekel ali pritisnil v tem obratu (prazno = tisina).
 */
export function jeSumljivBot(kljucKlica: string, from: string | undefined | null, izrek: string, zdaj: number = Date.now()): boolean {
  if (!jeBrezStevilke(from)) return false;
  pocisti(zdaj);
  const s = stanja.get(kljucKlica) ?? { tihi: 0, enaki: 0, zadnji: "", rok: zdaj + ROK_MS };
  const besedilo = brezSumnikov(izrek);
  s.tihi = besedilo ? 0 : s.tihi + 1;
  s.enaki = besedilo && besedilo === s.zadnji ? s.enaki + 1 : besedilo ? 1 : 0;
  s.zadnji = besedilo;
  stanja.set(kljucKlica, s);
  if (s.tihi >= NAJVEC_TIHIH_ZAPORED) return true;
  if (s.enaki >= NAJVEC_ENAKIH_ZAPORED) return true;
  return FRAZE_BOTA.some((f) => f.test(besedilo));
}
