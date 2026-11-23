/**
 * UI-1 (videz, 16. 11. 2026): ciste funkcije za zaslone (prvi koraki, stanje klica, vstavljanje vrednosti v besedilo).
 * Brez Reacta, da jih preizkusi node:test. Nic ne izmislja: vsak korak in vsaka oznaka izhaja iz podatkov, ki jih program ze ima.
 */
import type { Beseda } from "./besedila.ts";
import type { CallSession, Catalog } from "./types.ts";

/** Vstavi vrednosti v besedilo z oznakami {ime}. Manjkajoca vrednost ostane kot oznaka (napaka je vidna, ne tiha). */
export function vstavi(besedilo: string, vrednosti: Record<string, string | number>): string {
  return besedilo.replace(/\{(\w+)\}/g, (cel, ime: string) =>
    ime in vrednosti ? String(vrednosti[ime]) : cel,
  );
}

export type RazdelekLine =
  "klic" | "telefon" | "znanje" | "narocila" | "dnevnik" | "zapiski" | "linija" | "nastavitve";

export type KorakNastavitve = {
  id: "mozgani" | "znanje" | "vaja" | "linija";
  naslov: Beseda;
  opis: Beseda;
  gumb: Beseda;
  cilj: RazdelekLine;
  koncan: boolean;
};

/**
 * Prvi koraki (AGENTS.md »Nastavitev mora biti zelo enostavna«: vsak korak en gumb in en stavek). Stanje vsakega koraka je iz
 * pravih podatkov: možgani (shranjen ponudnik ali kljuc iz okolja), znanje (podjetje, izdelek ali besedilo znanja), vaja (vsaj
 * en klic v dnevniku, enako kot kazatiNamigZaVajo) in odprta linija.
 */
export function korakiNastavitve(stanje: {
  mozganiNastavljeni: boolean;
  catalog: Catalog;
  steviloKlicev: number;
  odprta: boolean;
}): KorakNastavitve[] {
  const c = stanje.catalog;
  const imaZnanje =
    Boolean(c.company.name?.trim()) || c.products.length > 0 || Boolean(c.znanje?.trim());
  return [
    {
      id: "mozgani",
      naslov: "uiKorakMozganiNaslov",
      opis: "uiKorakMozganiOpis",
      gumb: "uiKorakMozganiGumb",
      cilj: "nastavitve",
      koncan: stanje.mozganiNastavljeni,
    },
    {
      id: "znanje",
      naslov: "uiKorakZnanjeNaslov",
      opis: "uiKorakZnanjeOpis",
      gumb: "uiKorakZnanjeGumb",
      cilj: "znanje",
      koncan: imaZnanje,
    },
    {
      id: "vaja",
      naslov: "uiKorakVajaNaslov",
      opis: "uiKorakVajaOpis",
      gumb: "uiKorakVajaGumb",
      cilj: "linija",
      koncan: stanje.steviloKlicev > 0,
    },
    {
      id: "linija",
      naslov: "uiKorakLinijaNaslov",
      opis: "uiKorakLinijaOpis",
      gumb: "uiKorakLinijaGumb",
      cilj: "linija",
      koncan: stanje.odprta,
    },
  ];
}

export type StanjeKlica = { oznaka: Beseda; ton: "signal" | "moss" | "brass" };

/** Oznaka stanja klica: vedno napis, barva je samo dodatek (dostopnost, crno-beli izpis). */
export function stanjeKlica(call: Pick<CallSession, "status" | "order">): StanjeKlica {
  if (call.status === "v-teku") return { oznaka: "uiStanjeVTeku", ton: "signal" };
  return call.order.confirmed
    ? { oznaka: "uiStanjePotrjeno", ton: "moss" }
    : { oznaka: "uiStanjeOsnutek", ton: "brass" };
}

/** Cas klica za cloveka: »10. 11. 2026, 14:35« (slog besedil, razdelek 3). Neveljaven cas da prazen niz. */
export function casKlica(iso: string, jezik: "sl" | "en" = "sl"): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const loc = jezik === "sl" ? "sl-SI" : "en-GB";
  return `${d.toLocaleDateString(loc, { day: "numeric", month: "numeric", year: "numeric" })}, ${d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}`;
}
