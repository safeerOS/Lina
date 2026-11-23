/**
 * Model prepoznave govora v Twilio <Gather> (14. 11. 2026). Dovoljene vrednosti po dokumentaciji Twilio (speechModel);
 * prazno = brez atributa (kot doslej). Opomba: Google V2 ima sl-SI samo na chirp_3 (regija eu), chirp in chirp_2; ali
 * Twilio googlev2_chirp_3 sprejme sl-SI, je NEPREVERJENO in pokaze samo pravi klic (primerjaj zaupanje v zapisu klica).
 * Hints: najvec 500 vnosov po 100 znakov (meje Twilio); samo ob izbranem modelu.
 */
export const GOVOR_MODELI = [
  "googlev2_long",
  "googlev2_short",
  "googlev2_telephony",
  "googlev2_telephony_short",
  "googlev2_chirp_3",
  "deepgram_nova-2",
  "deepgram_nova-3",
] as const;

export const NAJVEC_HINTOV = 500;
export const NAJVEC_ZNAKOV_HINTA = 100;

export function veljavenGovorModel(vrednost: unknown): string {
  return typeof vrednost === "string" && (GOVOR_MODELI as readonly string[]).includes(vrednost.trim()) ? vrednost.trim() : "";
}

/** Vnosi loceni z vejico ali novo vrstico; vsak odrezan na 100 znakov, najvec 500; brez znakov, ki bi pokvarili atribut. */
export function normirajHints(vrednost: unknown): string {
  if (typeof vrednost !== "string") return "";
  const vnosi = vrednost
    .split(/[,\n]/)
    .map((v) => v.replace(/[<>"&]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAJVEC_ZNAKOV_HINTA).trim())
    .filter(Boolean)
    .slice(0, NAJVEC_HINTOV);
  return vnosi.join(", ");
}

/** Atributi za <Gather input="speech">: samo ob podprtem modelu (speechTimeout je ze celo stevilo). */
export function atributiGovora(pravila: { govorModel?: string; hintsGovor?: string }): string {
  const model = veljavenGovorModel(pravila.govorModel);
  if (!model) return "";
  const hints = normirajHints(pravila.hintsGovor);
  return `speechModel="${model}"${hints ? ` hints="${hints}"` : ""}`;
}
