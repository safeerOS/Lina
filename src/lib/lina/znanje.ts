import { t } from "./besedila.ts";
import { MEJA_IZREKA } from "./brain.ts";
import { fold, vprasaPoCeni } from "./guards.ts";
import type { Catalog, Zapisek } from "./types.ts";

const NAJKRAJSA_FRAZA = 8;

function ujemanjeFraze(haystack: string, needle: string): boolean {
  const phrase = needle.trim();
  if (phrase.length < 3) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u").test(haystack);
}

function vsebine(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
}

/**
 * Zapis lastnika. Vse vsebinske besede vprasanja morajo biti v izreku.
 * Delni kljuc, na primer samo «dostavljate», ne zadene zapiska o Ptuju.
 */
export function najdiZapisek(text: string, catalog: Catalog): Zapisek | null {
  const key = fold(text.slice(0, MEJA_IZREKA));
  if (key.length < 4) return null;
  const notes = catalog.zapiski ?? [];
  return (
    notes.find((note) => {
      const question = fold(note.vprasanje);
      if (question.length < NAJKRAJSA_FRAZA) return false;
      const besede = vsebine(question);
      if (besede.length === 0) return false;
      return besede.every((w) => ujemanjeFraze(key, w));
    }) ?? null
  );
}

/**
 * Odgovor, ki je dobesedno v katalogu: zapis, naslov, ure ali telefon.
 * Cene tu ni.
 */
export function odgovorIzKataloga(text: string, catalog: Catalog): string | null {
  const note = najdiZapisek(text, catalog);
  if (note) return note.odgovor;
  const key = fold(text);
  if (/\b(naslov|kje ste|kje se nahaj\w*)\b/.test(key) && catalog.company.address.trim()) {
    return `${t("naslovJe")} ${catalog.company.address}.`;
  }
  if (/\b(delovni cas|odprti|kdaj ste odprti|urne)\b/.test(key) && catalog.company.hours.trim()) {
    return `${t("ureSo")} ${catalog.company.hours}.`;
  }
  const vprasaPoTelefonu = vprasanjePoTelefonu(text);
  if (vprasaPoTelefonu && catalog.company.phone.trim()) {
    return `${t("telefonJe")} ${catalog.company.phone}.`;
  }
  return null;
}

/** Telefonska stevilka podjetja samo v obliki vprasanja, ne v izjavi klicatelja. */
function vprasanjePoTelefonu(text: string): boolean {
  const key = fold(text);
  const oTelefonu = /\btelefonsk\w*\b/.test(key) || /\bklicna stevilka\b/.test(key) || /\btelefon\b/.test(key);
  if (!oTelefonu) return false;
  if (/\d/.test(text)) return false;
  if (/\b(moj|moja|moje|me|klicite)\b/.test(key)) return false;
  if (text.includes("?")) return true;
  if (/\b(ali|kaks\w*|kater\w*|prosim|lahko|kje)\b/.test(key)) return true;
  const ostanek = key
    .replace(/\b(telefonska|telefonsko|telefonski|stevilka|stevilko|klicna|telefon|prosim|vas|katera|je|kaj)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ostanek.length === 0;
}

const VPRASALNICA = /\b(ali|kdaj|kje|kako|zakaj|koliko|kaks\w*|kater\w*|kam|kaj|kolk)\b/i;

/**
 * Iz vrzeli ostane samo stavek z vprasalno besedo, brez stevk, e-poste, imen in stikov.
 */
export function besediloVrzel(text: string): string {
  const brezPoste = text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, " ");
  const kosi = brezPoste
    .split(/[,;\n]+|(?<=[.!?])\s+/)
    .map((k) => k.trim())
    .filter(Boolean);
  const vprasanja = kosi.filter((k) => k.includes("?") || VPRASALNICA.test(fold(k)));
  let out = (vprasanja.length ? vprasanja : []).join(" ");
  out = out.replace(/\d+/g, " ");
  return out
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+/, "")
    .replace(/[\s,.;:-]+$/, "")
    .replace(/\s+([,.?])/g, "$1")
    .trim();
}
export function jeVprasanje(text: string): boolean {
  const key = fold(text);
  if (!key) return false;
  if (text.includes("?") && key.replace(/\?/g, "").trim().length >= 3) return true;
  if (key.length < 8) return false;
  return /\b(ali|kdaj|kje|kako|zakaj|koliko|kaks|kater|kam|dostav|parkir|garanci)\b/.test(key);
}

/** True, ce katalog na to vprasanje nima odgovora. Cene ne stejemo med vrzeli. */
export function niOdgovoraVKatalogu(text: string, catalog: Catalog, facts: string): boolean {
  if (!jeVprasanje(text) || vprasaPoCeni(text)) return false;
  if (odgovorIzKataloga(text, catalog)) return false;
  return facts.includes("Povejte izdelek in material");
}
