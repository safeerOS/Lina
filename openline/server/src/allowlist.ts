/**
 * Seznam dovoljenih stevilk na strezniku.
 * Prazen seznam ne dovoli nobenega dohodnega klica. Klici v sili so vedno zavrnjeni.
 * Primerjava je ista kot v aplikaciji: samo stevke, ujemanje v celoti ali zadnjih 8.
 */

const EMERGENCY = new Set([
  "112",
  "911",
  "999",
  "000",
  "110",
  "113",
  "114",
  "118",
  "119",
  "100",
  "101",
  "102",
  "103",
  "108",
  "122",
  "133",
  "144",
  "155",
]);

export function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isEmergencyNumber(value: string): boolean {
  const raw = digits(value);
  if (!raw) return false;
  if (EMERGENCY.has(raw)) return true;
  const stripped = raw.replace(/^0+/, "");
  return stripped !== raw && EMERGENCY.has(stripped);
}

export function numbersMatch(a: string, b: string): boolean {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return da.length >= 8 && db.length >= 8 && da.slice(-8) === db.slice(-8);
}

/** Prazen seznam ali klic v sili vrne false. */
export function isAllowlisted(number: string | null | undefined, list: readonly string[]): boolean {
  if (!number || isEmergencyNumber(number)) return false;
  if (list.length === 0) return false;
  return list.some((entry) => entry.trim().length > 0 && numbersMatch(number, entry));
}

export type AllowlistMode = "on" | "off";

/** Privzeto vklopljeno. Samo izrecni off izklopi seznam. */
export function parseAllowlistMode(raw: string | undefined | null): AllowlistMode {
  return raw?.trim().toLowerCase() === "off" ? "off" : "on";
}

/**
 * Ena odlocitev za prevzem po stevilki.
 * Ob off velja tudi prazna in neznana stevilka. Stevilka v sili nikoli.
 * Smer, rocni dvig in drug klic se preverijo pred tem klicem.
 */
export function mayTakeOver(
  number: string | null | undefined,
  list: readonly string[],
  mode: AllowlistMode = "on",
): boolean {
  if (isEmergencyNumber(number ?? "")) return false;
  if (mode === "off") return true;
  return isAllowlisted(number, list);
}

export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
