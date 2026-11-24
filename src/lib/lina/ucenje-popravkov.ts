/**
 * Ucenje iz popravkov lastnika (ideja: Task Observer, rebelytics/one-skill-to-rule-them-all, CC-BY-4.0; lastna koda po ideji).
 * Cista logika brez diska in omrezja.
 *
 * Pravila:
 * - Zazna, kadar lastnik Lino popravi ali opomni (»spet«, »zakaj nisi«, »sem te moral spomniti«, »ne tako« ...).
 * - Zapise SAMO kandidata za pravilo (kaj narobe, lastnikove besede dobesedno, predlog pravila, stanje »caka«).
 * - Brez lastnikovega izrecnega »Shrani« se trajna navodila/pravila NIKOLI ne spremenijo.
 * - Skrivnosti (jeSkrivnost) se zavrnejo; krmilni znaki in ukazne oznake [[...]] se odstranijo.
 * - Uporablja se samo v pogovoru asistentke z lastnikom, nikoli v klicih tajnice.
 */
import { randomUUID } from "node:crypto";
import { fold } from "./guards.ts";
import { jeSkrivnost } from "./spomin.ts";

export const POPRAVKI_NAJVEC_KANDIDATOV = 50;
export const POPRAVKI_NAJVEC_PRAVIL = 50;
export const POPRAVKI_NAJVEC_ZNAKOV_PRAVILA = 300;
export const POPRAVKI_NAJVEC_ZNAKOV_BESED = 500;
export const POPRAVKI_NAJVEC_ZNAKOV_KONTEKSTA = 300;

export type StanjeKandidata = "caka" | "shranjeno" | "zavrnjeno";

export type KandidatPravila = {
  id: string;
  cas: string;
  kajNarobe: string;
  besedeLastnika: string;
  predlogPravila: string;
  stanje: StanjeKandidata;
  /** Stevilo ponovitev istega opomina (Task Observer: pri 2+ ponovitvah je potreben mocnejsi ukrep). */
  ponovitev: number;
};

export type ShranjenoPravilo = {
  id: string;
  besedilo: string;
  izvorKandidata?: string;
  ustvarjeno: string;
};

/** Odstrani krmilne znake, smerne znake in ukazne oznake [[...]]; omeji dolzino. */
export function ocistiVnosPopravka(surovo: unknown, najvec: number): string {
  if (typeof surovo !== "string") return "";
  return surovo
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\[\[|\]\]/g, " ")
    .replace(/[«»]/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, najvec);
}

/**
 * Vzorci popravka ali opomina lastnika (slovensko, brez diakritike prek fold).
 * Izogiba se obicajnim vprasanjem brez popravka (npr. »kaj je spet na sporedu«, »kdaj pride spet«).
 */
const VZORCI_POPRAVKA: readonly RegExp[] = [
  /\b(?:ze\s+spet|spet\s+(?:si|nisi|pozab\w*|delas|pises|govoris|ponavlj\w*|isto|narobe|napacno|brez)|si\s+spet|nisi\s+spet)\b/,
  /\bzakaj\s+(?:si\s+)?(?:nisi|spet|ne\s+(?:upostev\w*|naredis|pises|preveris|poves|pomnis))\b/,
  /\b(?:sem\s+te\s+moral\w*|moral\w*\s+sem\s+te)\s+(?:ze\s+|spet\s+)?(?:spomnit\w*|opomnit\w*|popravit\w*|opozorit\w*)\b/,
  /\b(?:ne\s+tako|ni\s+tako|ne\s+delaj\s+tako|ne\s+pisi\s+tako|ne\s+govori\s+tako)\b/,
  /\b(?:sem\s+ti\s+ze\s+(?:rekel|rekla|povedal\w*|napisal\w*)|ze\s+(?:veckrat|enkrat)\s+sem\s+(?:ti\s+)?(?:rekel|rekla|povedal\w*))\b/,
  /\b(?:drugic\s+(?:ne|vedno|nikoli|pazi|najprej|upostev\w*)|od\s+zdaj\s+naprej\s+(?:ne|vedno|nikoli|pisi|govori|upostev\w*))\b/,
  /\b(?:narobe\s+si|napacno\s+si|nisi\s+uposteval\w*|pozabila\s+si\s+na\s+pravilo|spet\s+pozabila)\b/,
  /^popravek\s*:/,
];

/** Ali lastnikovo sporocilo vsebuje popravek ali opomin Lini. */
export function jePopravekLastnika(besedilo: string): boolean {
  if (typeof besedilo !== "string") return false;
  const f = fold(besedilo).replace(/[^a-z0-9:]+/g, " ").trim();
  if (f.length < 5) return false;
  return VZORCI_POPRAVKA.some((re) => re.test(f));
}

/** Sestavi kratek predlog trajnega pravila iz lastnikovega popravka. */
export function predlagajPravilo(besedeLastnika: string): string {
  const cisto = ocistiVnosPopravka(besedeLastnika, POPRAVKI_NAJVEC_ZNAKOV_PRAVILA);
  if (!cisto) return "";
  // Odstrani uvodne opominske fraze, da je predlog pravila jedrnat in berljiv.
  const jedro = cisto
    .replace(/^(?:popravek\s*:\s*|že\s+spet[,!.: ]*|spet[,!.: ]*|ne\s+tako[,!.: ]*)/i, "")
    .trim();
  const osnova = jedro.length >= 12 ? jedro : cisto;
  const zVeliko = osnova.charAt(0).toUpperCase() + osnova.slice(1);
  return zVeliko.slice(0, POPRAVKI_NAJVEC_ZNAKOV_PRAVILA);
}

/** Normaliziran kljuc za prepoznavo ponovitve (Task Observer: ne podvajaj istega opazanja). */
export function kljucPopravka(besedilo: string): string {
  return fold(besedilo)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((b) => b.length >= 3)
    .slice(0, 12)
    .join(" ");
}

/** Ali dve besedili opisujeta isti popravek (isti kljuc ali vsaj 70 % prekrivanja besed). */
export function staPodobnaPopravka(a: string, b: string): boolean {
  const ka = kljucPopravka(a);
  const kb = kljucPopravka(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const sa = new Set(ka.split(" "));
  const sb = new Set(kb.split(" "));
  const skupnih = [...sa].filter((x) => sb.has(x)).length;
  const manjsa = Math.min(sa.size, sb.size);
  return manjsa >= 3 && skupnih / manjsa >= 0.7;
}

/**
 * Iz sporocila lastnika in prejsnjega odgovora Line sestavi kandidata za pravilo.
 * Vrne null, ce sporocilo ni popravek, je prazno ali vsebuje skrivnost (jeSkrivnost).
 */
export function pripraviKandidata(
  besediloLastnika: string,
  prejsnjiOdgovorLine = "",
  zdaj: Date = new Date(),
): KandidatPravila | null {
  if (!jePopravekLastnika(besediloLastnika)) return null;
  if (jeSkrivnost(besediloLastnika)) return null;
  const besedeLastnika = ocistiVnosPopravka(besediloLastnika, POPRAVKI_NAJVEC_ZNAKOV_BESED);
  if (!besedeLastnika) return null;
  const cistOdgovor = jeSkrivnost(prejsnjiOdgovorLine)
    ? ""
    : ocistiVnosPopravka(prejsnjiOdgovorLine, POPRAVKI_NAJVEC_ZNAKOV_KONTEKSTA);
  const kajNarobe = cistOdgovor
    ? `Predhodni odgovor Line: ${cistOdgovor}`
    : "Lastnik je opozoril na napako ali odstopanje v odgovoru.";
  const predlogPravila = predlagajPravilo(besedeLastnika);
  if (!predlogPravila) return null;
  return {
    id: randomUUID(),
    cas: zdaj.toISOString(),
    kajNarobe,
    besedeLastnika,
    predlogPravila,
    stanje: "caka",
    ponovitev: 1,
  };
}

export type PreverbaPravila =
  | { ok: true; besedilo: string }
  | { ok: false; razlog: "prazno" | "predolgo" | "skrivnost" };

/** Preveri besedilo trajnega pravila pred shranjevanjem (samo po lastnikovem »Shrani«). */
export function preveriPraviloPopravka(surovo: unknown): PreverbaPravila {
  if (typeof surovo !== "string") return { ok: false, razlog: "prazno" };
  const cisto = surovo
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\[\[|\]\]/g, " ")
    .replace(/[«»]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
  if (!cisto) return { ok: false, razlog: "prazno" };
  if (cisto.length > POPRAVKI_NAJVEC_ZNAKOV_PRAVILA) return { ok: false, razlog: "predolgo" };
  if (jeSkrivnost(cisto)) return { ok: false, razlog: "skrivnost" };
  return { ok: true, besedilo: cisto };
}

/**
 * Sestavi odsek potrjenih trajnih pravil iz popravkov lastnika za sistemsko navodilo asistentke.
 * Vkljuci samo pravila, ki jih je lastnik izrecno potrdil s »Shrani«; nikoli nepotrjenih kandidatov.
 */
export function oblikujTrajnaPravila(pravila: readonly ShranjenoPravilo[]): string {
  const veljavna = pravila
    .map((p) => ocistiVnosPopravka(p.besedilo, POPRAVKI_NAJVEC_ZNAKOV_PRAVILA))
    .filter((b) => b && !jeSkrivnost(b));
  if (veljavna.length === 0) return "";
  const vrstice = veljavna.map((b) => `- ${b}`).join("\n");
  return (
    "\n\nPotrjena pravila iz popravkov lastnika (veljajo za pogovor z lastnikom; ne razveljavijo varnosti, e-pošte, brisanja ali potrditev):\n" +
    vrstice
  );
}
