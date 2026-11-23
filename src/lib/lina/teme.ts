/**
 * Teme garancije, dostave in roka izdelave.
 * Sprozi se po korenu tudi v izjavi brez vprasalnice.
 * Cas izdelave, prevzem in posiljanje blaga (poslj, ne posiljam) so tema.
 * "Posiljam vam mail" ni dostava: koren je posilj, ne poslj.
 * Stikalo lastnika velja za obljubo, ne za vsako vprasanje s korenom.
 */
import { t } from "./besedila.ts";
import { fold } from "./guards.ts";
import type { Pravila } from "./types.ts";

export type TemaId = "garancija" | "dostava" | "rok";

const TEME: Array<{ id: TemaId; re: RegExp }> = [
  { id: "garancija", re: /\b(?:garanc\w*|jamstv\w*|jamc\w*|reklamacij\w*)/ },
  { id: "dostava", re: /\b(?:dostav\w*|dobav\w*|pripelj\w*|montaz\w*|prevoz\w*|poslj\w*|po\s+post\w*)/ },
  {
    id: "rok",
    re: /\brok\s+izdelav\w*|\bkdaj\s+bo\s+gotov\w*|\bmudi\b|\bizdelav\w*|\bnarejen\w*|\bnared\w*\s+do\s+petk\w*|\bprevzam\w*/,
  },
];

export type TemePravila = Pick<
  Pravila,
  | "temaOdgovor"
  | "garancijaVklop"
  | "garancijaBesedilo"
  | "dostavaVklop"
  | "dostavaBesedilo"
  | "rokVklop"
  | "rokBesedilo"
>;

export function temeVIzreku(text: string): TemaId[] {
  const kljuc = fold(text);
  const posta = /\b(?:mail|e-?post\w*|elektronsk\w*\s+post\w*)\b/.test(kljuc);
  const blago = /\b(?:dostav\w*|dobav\w*|pripelj\w*|montaz\w*|prevoz\w*|po\s+post\w*)/.test(kljuc);
  return TEME.filter((tema) => {
    if (!tema.re.test(kljuc)) return false;
    // "Posljem vam mail" ni dostava. Posiljanje blaga (po posti, prevoz) ostane.
    if (tema.id === "dostava" && posta && !blago) return false;
    return true;
  }).map((tema) => tema.id);
}

function privzetoBesedilo(pravila: TemePravila): string {
  const lastnik = pravila.temaOdgovor?.trim() ?? "";
  return lastnik || t("temaPrivzeto");
}

function besediloEne(id: TemaId, pravila: TemePravila): { besedilo: string; privzeto: boolean } {
  const lastnikovo =
    id === "garancija"
      ? pravila.garancijaVklop && pravila.garancijaBesedilo.trim()
        ? pravila.garancijaBesedilo.trim()
        : ""
      : id === "dostava"
        ? pravila.dostavaVklop && pravila.dostavaBesedilo.trim()
          ? pravila.dostavaBesedilo.trim()
          : ""
        : ""; // rok izdelave: NIKOLI svoje besedilo (lastnik 12. 11. 2026), vedno privzeto »obvestilo podjetje«
  if (lastnikovo) return { besedilo: lastnikovo, privzeto: false };
  return { besedilo: privzetoBesedilo(pravila), privzeto: true };
}

/** Null, ce v izreku ni teme. Ob vec temah so v odgovoru vsa besedila. */
export function odgovorTemeLastnika(
  text: string,
  pravila: TemePravila,
): { besedilo: string; neznano: boolean } | null {
  const teme = temeVIzreku(text);
  if (teme.length === 0) return null;
  const kosi = teme.map((id) => besediloEne(id, pravila));
  const videno = new Set<string>();
  const besedila: string[] = [];
  for (const kos of kosi) {
    if (videno.has(kos.besedilo)) continue;
    videno.add(kos.besedilo);
    besedila.push(kos.besedilo);
  }
  return { besedilo: besedila.join(" "), neznano: kosi.some((kos) => kos.privzeto) };
}
