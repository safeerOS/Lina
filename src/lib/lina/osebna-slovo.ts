/**
 * Slovo po zapisu sporocila (osebna tajnica; pravilo C, lastnik 15. 11. 2026: »klic ne sme koncati z odgovorom brez slovesa«). Tri od desetih klicev
 * (14. 11. 09:35, 10:46 in 15. 11. 08:10) se je koncalo z Linim odgovorom brez zakljucnega stavka, ker je klicatelj odlozil med poslusanjem.
 * Pravilo je na EDNEM mestu (service.server.ts `odgovori`): vsak Linin odgovor po zapisanem sporocilu, ki ni vabilo ali vprasanje, dobi slovo.
 */
import { fold } from "./guards.ts";
import { VARIANTE_OSEBNE } from "./glas.ts";
import { t } from "./besedila.ts";
import type { CallSession } from "./types.ts";

type KljucVarijante = (typeof VARIANTE_OSEBNE)[number][0];

/** Fraza osebnega nacina z varianto (v istem klicu se ne ponovi, dokler niso porabljene vse; lastnik 14. 11. 2026). */
export function izberiVarianto(call: CallSession, kljuc: KljucVarijante): string {
  const sez = VARIANTE_OSEBNE.find((x) => x[0] === kljuc) ?? [kljuc];
  const st = call.osebnoVariante?.[kljuc] ?? 0;
  call.osebnoVariante = { ...(call.osebnoVariante ?? {}), [kljuc]: st + 1 };
  return t(sez[st % sez.length]);
}

/** Odgovor se konca s slovesom (»Hvala za klic, nasvidenje.«, »Ker vas ne slisim, se za zdaj poslavljam. Nasvidenje.«). */
export function imaSlovo(odgovor: string): boolean {
  return /(nasvidenje|poslavljam|goodbye)\W*$/.test(fold(odgovor));
}

/** Odgovor, ki je vabilo ali vprasanje (klicatelj mora spregovoriti): ne dobi slovesa. */
export function jeVabiloAliVprasanje(odgovor: string): boolean {
  const k = fold(odgovor).replace(/\s+/g, " ").trim();
  if (k.endsWith("?")) return true;
  const kratka = VARIANTE_OSEBNE.find((x) => x[0] === "osebnaIzvoliteKratko") ?? [];
  const vabila = [...kratka.map((kljuc) => t(kljuc)), t("osebnaIzvolite"), t("osebnaPonovitevVTrenutku")];
  return vabila.some((v) => k.endsWith(fold(v)));
}
