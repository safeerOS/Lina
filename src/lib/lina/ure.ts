/**
 * Delovni cas in prevzem. Cista funkcija, uporablja lokalna polja datuma,
 * zato je na Linuxu in Windows enaka za isti Date.
 */

export type NacinPrevzema = "vsi" | "neodgovorjeni" | "izven";

const DAN_RE = "pon|tor|sre|cet|pet|sob|ned";

const DAN: Record<string, number> = {
  ned: 0,
  pon: 1,
  tor: 2,
  sre: 3,
  cet: 4,
  pet: 5,
  sob: 6,
};

export type Delovnik = {
  startDay: number;
  endDay: number;
  startMin: number;
  endMin: number;
};

function foldHours(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Razbere niz kot »pon-pet 8.00-16.00«. Ob napaki vrne null. */
export function razberiDelovnik(hours: string): Delovnik | null {
  const all = razberiRazpone(hours);
  return all[0] ?? null;
}

const DAN_SEZNAM = `(?:${DAN_RE})(?:\\s*-\\s*(?:${DAN_RE}))?(?:\\s*,\\s*(?:${DAN_RE})(?:\\s*-\\s*(?:${DAN_RE}))?)*`;
const URA_RAZ = "\\d{1,2}[.:]\\d{2}\\s*-\\s*\\d{1,2}[.:]\\d{2}";

/**
 * Vsi odprti razponi. zaprto ne prevzame ure drugega razpona.
 * Minute nad 59 in nocna izmena (22.00-06.00) razveljavijo niz.
 * Nastevanje dni in deljen delovnik. Ostanek z uro ali dnevom je nerazumljiv.
 */
export function razberiRazpone(hours: string): Delovnik[] {
  const text = foldHours(hours);
  if (!text) return [];
  const kos = new RegExp(
    `\\b(${DAN_SEZNAM})\\s+(?:(zaprto)|((?:${URA_RAZ})(?:\\s+in\\s+(?:${URA_RAZ}))*))`,
    "gi",
  );
  const razponi: Delovnik[] = [];
  let zadnji = 0;
  let m: RegExpExecArray | null;
  while ((m = kos.exec(text))) {
    if (ostanekImaUroAliDan(text.slice(zadnji, m.index))) return [];
    zadnji = m.index + m[0].length;
    if (m[2]) continue;
    const dnevi = razberiDneve(m[1]);
    const ure = razberiUre(m[3] ?? "");
    if (!dnevi || !ure) return [];
    for (const dan of dnevi) {
      for (const ura of ure) {
        razponi.push({ startDay: dan.start, endDay: dan.end, startMin: ura.start, endMin: ura.end });
      }
    }
  }
  if (ostanekImaUroAliDan(text.slice(zadnji))) return [];
  return razponi;
}

function ostanekImaUroAliDan(text: string): boolean {
  if (new RegExp(`\\b(?:${DAN_RE})\\b`, "i").test(text)) return true;
  return /\d{1,2}[.:]\d{2}/.test(text);
}

function razberiDneve(seznam: string): { start: number; end: number }[] | null {
  const kosi = seznam.split(",").map((s) => s.trim()).filter(Boolean);
  const out: { start: number; end: number }[] = [];
  for (const kos of kosi) {
    const m = kos.match(new RegExp(`^(${DAN_RE})(?:\\s*-\\s*(${DAN_RE}))?$`, "i"));
    if (!m) return null;
    const start = DAN[m[1]];
    const end = DAN[m[2] ?? m[1]];
    if (start === undefined || end === undefined) return null;
    out.push({ start, end });
  }
  return out.length ? out : null;
}

function razberiUre(blok: string): { start: number; end: number }[] | null {
  const re = /(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/g;
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(blok))) {
    const start = minuti(m[1], m[2]);
    const end = minuti(m[3], m[4]);
    if (start === null || end === null || start >= end) return null;
    out.push({ start, end });
  }
  return out.length ? out : null;
}

function minuti(ura: string, min: string): number | null {
  if (!/^\d{1,2}$/.test(ura) || !/^\d{2}$/.test(min)) return null;
  const h = Number(ura);
  const m = Number(min);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  if (h === 24 && m !== 0) return null;
  const skupaj = h * 60 + m;
  if (skupaj > 24 * 60) return null;
  return skupaj;
}

/** True, ce je vsaj en odprt razpon. Prazen ali zmesnjan niz je nerazumljiv. */
export function ureSoRazumljive(hours: string): boolean {
  return razberiRazpone(hours).length > 0;
}

function danVRazponu(day: number, start: number, end: number): boolean {
  if (start <= end) return day >= start && day <= end;
  return day >= start || day <= end;
}

/**
 * Zacetek ure je znotraj, konec ure je ze zunaj.
 * Primer: 8.00 je delovni cas, 16.00 ni vec.
 * Ista lokalna polja datuma na Linuxu in Windows.
 */
export function znotrajDelovnika(now: Date, hours: string): boolean {
  const parsed = razberiRazpone(hours);
  if (parsed.length === 0) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return parsed.some((razpon) => {
    if (!danVRazponu(now.getDay(), razpon.startDay, razpon.endDay)) return false;
    return minute >= razpon.startMin && minute < razpon.endMin;
  });
}

export function najPrevzame(input: {
  nacin: NacinPrevzema;
  cakanjeSekund: number;
  zvonjenjeSekund: number;
  now: Date;
  hours: string;
}): boolean {
  if (input.nacin === "vsi") return true;
  if (input.nacin === "neodgovorjeni") return input.zvonjenjeSekund >= input.cakanjeSekund;
  return !znotrajDelovnika(input.now, input.hours);
}

export type OdlocitevLinije = "lina" | "cakaj" | "zasedeno" | "prekini";

/**
 * Cista odlocitev prevzema. Brez ure in brez sistema.
 * Po klicu cloveka (DialCallStatus) Lina prevzame samo, ce ni bilo odgovora.
 */
export function odlocitevLinije(input: {
  nacin: NacinPrevzema;
  cakanjeSekund: number;
  zvonjenjeSekund: number;
  now: Date;
  hours: string;
  dialStatus?: string;
}): OdlocitevLinije {
  const status = (input.dialStatus ?? "").trim().toLowerCase();
  if (status === "completed" || status === "answered") return "prekini";
  if (status === "no-answer" || status === "busy" || status === "failed" || status === "canceled") return "lina";
  if (najPrevzame(input)) return "lina";
  // Med delovnim casom v nacinu izven lastnika poklicemo. Ce se ne oglasi, prevzame Lina.
  return "cakaj";
}

/** Cakanje pred prevzemom (lastnik 11. 11. 2026): Lina se oglasi sele po 25-30 s zvonjenja, da uporabnik sam dvigne. */
export const CAKANJE_PRIVZETO_SEK = 28;
export const CAKANJE_MIN_SEK = 10;
export const CAKANJE_MAX_SEK = 60;

/** Cista meja nastavitve: neveljavno -> privzeto 28 s, sicer zaokrozeno v mejah 10-60 s. */
export function cakanjePredPrevzemom(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return CAKANJE_PRIVZETO_SEK;
  return Math.min(CAKANJE_MAX_SEK, Math.max(CAKANJE_MIN_SEK, Math.round(n)));
}
