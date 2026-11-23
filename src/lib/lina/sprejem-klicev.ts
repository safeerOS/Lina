/** Sprejem klicev (lastnik 12. 11. 2026): ali je izbrana stevilka Twilio povezana z Lino (naslov klicev = javni naslov Line). */
export type StanjeSprejema = "vklopljen" | "izklopljen" | "drug";

function brezKonca(naslov: string): string {
  return naslov.trim().replace(/\/+$/, "");
}

export function stanjeSprejema(glasUrl: string, naslovKlicev: string): StanjeSprejema {
  const a = brezKonca(glasUrl);
  if (!a) return "izklopljen";
  const b = brezKonca(naslovKlicev);
  return b !== "" && a === b ? "vklopljen" : "drug";
}

/**
 * Sprejem klicev SAMO po neposredni poti (lastnik 12. 11. 2026: brez Cloudflara, kot pri testnem klicu).
 * Hitri tunel Cloudflare (trycloudflare.com) je rezerva za preizkuse in za klice ni dovoljen.
 */
export function jeTunelskiNaslov(naslov: string): boolean {
  try {
    const gostitelj = new URL(naslov.trim()).hostname.toLowerCase();
    return gostitelj === "trycloudflare.com" || gostitelj.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}
