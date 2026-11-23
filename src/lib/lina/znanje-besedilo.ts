import { t } from "./besedila.ts";

/**
 * Znanje o podjetju kot prosto besedilo (lastnik 11. 11. 2026: Lina mora vedeti VSE o podjetju, uporabnik sam nalozi
 * spletno stran in dokument). Modul nima odvisnosti od streznika, da ga uporabita vmesnik in streznik. Besedilo je
 * PODATEK: nikoli navodilo (glej razumevanje.server.ts, oznaciZnanje).
 */
export const MEJA_ZNANJA = 500_000;
/** Najvec znanja, ki gre modelu v en klic (izberiOdseke); ostalo ostane v shrambi in v preverbi odgovora. */
export const MEJA_ZNANJA_V_KLICU = 8_000;
/** Najvecji dokument, ki ga vmesnik prebere (1 MB). */
export const MEJA_DOKUMENTA_BAJTOV = 1_000_000;

// Kontrolni znaki (razen \n in \t), nicelna sirina in usmerjevalniki smeri: v znanju nimajo pomena, vrinjeni skrivajo vsebino.
// eslint-disable-next-line no-control-regex
const NEVIDNI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** Normalizirano znanje: niz, NFC, brez kontrolnih znakov, najvec 20000 znakov. Karkoli drugega je prazno. */
export function normirajZnanje(vrednost: unknown): string {
  if (typeof vrednost !== "string") return "";
  const cisto = vrednost
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(NEVIDNI, "")
    .replace(/[\t\u00A0]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cisto.length <= MEJA_ZNANJA) return cisto;
  let rez = cisto.slice(0, MEJA_ZNANJA);
  // Ne prerezi nadomestnega para.
  const zadnji = rez.charCodeAt(rez.length - 1);
  if (zadnji >= 0xd800 && zadnji <= 0xdbff) rez = rez.slice(0, -1);
  return rez.trim();
}

export type PrebranDokument = { besedilo: string; skrajsano: boolean };

const KONCNICE = /\.(txt|md|markdown)$/i;

/**
 * Dokument .txt ali .md iz vmesnika. Samo branje besedila (UTF-8): nic se ne izvaja, PDF in Word nista podprta.
 * Napaka je razlog v jeziku uporabnika.
 */
export function preberiDokument(ime: string, bajti: Uint8Array): PrebranDokument {
  if (!KONCNICE.test(ime)) throw new Error(t("znanjeDokumentVrsta"));
  if (bajti.byteLength > MEJA_DOKUMENTA_BAJTOV) throw new Error(t("znanjeDokumentVelik"));
  let besedilo: string;
  try {
    besedilo = new TextDecoder("utf-8", { fatal: true }).decode(bajti);
  } catch {
    throw new Error(t("znanjeDokumentKodiranje"));
  }
  // Nicelni bajt pomeni dvojisko datoteko s koncnico .txt.
  if (besedilo.includes("\u0000")) throw new Error(t("znanjeDokumentKodiranje"));
  const cisto = normirajZnanje(besedilo);
  if (!cisto) throw new Error(t("znanjeDokumentPrazen"));
  const polno = besedilo.normalize("NFC").replace(NEVIDNI, "").trim().length;
  return { besedilo: cisto, skrajsano: polno > MEJA_ZNANJA };
}

/** Doda dokument obstojecemu besedilu (prazna vrstica vmes) in prereze pri meji. */
export function dodajBesedilo(obstojece: string, novo: string): { besedilo: string; skrajsano: boolean } {
  const skupaj = [obstojece.trim(), novo.trim()].filter(Boolean).join("\n\n");
  const cisto = normirajZnanje(skupaj);
  return { besedilo: cisto, skrajsano: skupaj.length > MEJA_ZNANJA };
}
