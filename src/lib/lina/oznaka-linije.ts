/**
 * Naloga 16 (lastnik 25. 11. 2026 23:12: »Čeprav je telefon povezan je Linija zaprta in to me jezi«): ena oznaka linije za vse
 * zaslone (vrh okvirja, stranski meni, Domov, znacka v lina-desk). Pove, ali Lina sprejema klice KJERKOLI, ne samo na racunalniku.
 * Racunalnik ne ve, ali Lina na telefonu klice sprejema (telefon tega ne javi): ziv telefon je »Telefon povezan«, dodan telefon brez
 * zive povezave je »Telefon seznanjen«, nikoli »zaprta«. »Linija zaprta« samo, ko ni ne odprte linije racunalnika ne telefona;
 * takrat klik odpre zaslon Linija (en klik).
 */
import type { Beseda } from "./besedila.ts";

/** Isto kot TelefonLinije v asistent-telefon.server.ts (tip je prepisan, da odjemalec ne uvaza streznika). null = se ne vemo. */
export type TelefonLinije = "povezan" | "seznanjen" | "ne";

export type OznakaLinije = {
  kljuc: Extract<Beseda, `linOznaka_${string}`>;
  /** ok: klici se sprejemajo ali telefon tece; neznano: telefon dodan, stanje ni znano; zaprta: nihce ne sprejema. */
  ton: "ok" | "neznano" | "zaprta";
  /** Klik na oznako odpre zaslon Linija (samo pri »zaprta«). */
  odpreLinijo: boolean;
};

export function oznakaLinije(racunalnik: boolean, telefon: TelefonLinije | null): OznakaLinije {
  if (racunalnik && telefon === "povezan") return { kljuc: "linOznaka_odprta", ton: "ok", odpreLinijo: false };
  if (racunalnik) return { kljuc: "linOznaka_racunalnik", ton: "ok", odpreLinijo: false };
  if (telefon === "povezan") return { kljuc: "linOznaka_telefon", ton: "ok", odpreLinijo: false };
  if (telefon === "seznanjen") return { kljuc: "linOznaka_seznanjen", ton: "neznano", odpreLinijo: false };
  // stanja telefona se ne vemo (nalaganje, napaka poizvedbe): raje nevtralno kot napacno »zaprta«
  if (telefon === null) return { kljuc: "linOznaka_neznano", ton: "neznano", odpreLinijo: false };
  return { kljuc: "linOznaka_zaprta", ton: "zaprta", odpreLinijo: true };
}
