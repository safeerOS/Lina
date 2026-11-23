/**
 * Povzetek spremembe poslovnega znanja za revizijsko verigo (naloga #44 + #45). Zapise vsebine NE shranimo (ime podjetja,
 * telefon, besedilo znanja ostanejo samo v katalogu): v verigo gredo samo imena razdelkov, stevilo znakov znanja in
 * kratka zgoscena vrednost besedila (da se vsebina pozneje lahko preveri, ne pa prebere iz dnevnika).
 * Komentarji so brez sumnikov.
 */
import { createHash } from "node:crypto";
import type { VhodVnosa } from "./revizija.ts";
import type { Catalog } from "./types.ts";

const NAZIVI: Array<[string, string]> = [
  ["podjetje", "podjetje"],
  ["izdelki", "izdelki"],
  ["materiali", "materiali"],
  ["zapiski", "zapiski"],
  ["znanje", "znanje"],
];

function enako(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function kratkaZgoscena(besedilo: string): string {
  return createHash("sha256").update(besedilo, "utf8").digest("hex").slice(0, 16);
}

/** Razlika dveh katalogov, ali null, ce se vsebina ni spremenila. */
export function povzetekSpremembeKataloga(prej: Catalog, potem: Catalog): VhodVnosa | null {
  const spremenjeno: string[] = [];
  const znanjePrej = prej.znanje ?? "";
  const znanjePotem = potem.znanje ?? "";
  const razlike: Record<string, boolean> = {
    podjetje: !enako(prej.company, potem.company),
    izdelki: !enako(prej.products, potem.products),
    materiali: !enako(prej.materials, potem.materials),
    zapiski: !enako(prej.zapiski ?? [], potem.zapiski ?? []),
    znanje: znanjePrej !== znanjePotem,
  };
  for (const [kljuc, ime] of NAZIVI) if (razlike[kljuc]) spremenjeno.push(ime);
  if (spremenjeno.length === 0) return null;
  const podatki: Record<string, string | number> = { razdelki: spremenjeno.join(","), znanjeZnakov: znanjePotem.length };
  if (razlike.znanje) podatki.znanjeSha16 = kratkaZgoscena(znanjePotem);
  return { vrsta: "katalog.sprememba", opis: `Spremenjeno poslovno znanje: ${spremenjeno.join(", ")}.`, podatki };
}
