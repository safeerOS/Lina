/**
 * UI-1 (videz, 16. 11. 2026): ciste funkcije za zaslone (prvi koraki, stanje klica, vstavljanje vrednosti v besedilo).
 * Brez Reacta, da jih preizkusi node:test. Nic ne izmislja: vsak korak in vsaka oznaka izhaja iz podatkov, ki jih program ze ima.
 */
import { jezikVmesnika, lokalizacija, type Beseda, type Jezik } from "./besedila.ts";
import { datumBesedilo } from "./koledar.ts";

const CAS_PAS = "Europe/Ljubljana";
/** Glava Lina 2.0 v ljubljanskem casu (ne v pasu sistema): »tor., 24. nov.« / »Tue 24 Nov«. */
export function datumGlave(d: Date, j: Jezik = jezikVmesnika()): string {
  return d.toLocaleDateString(lokalizacija(j), { timeZone: CAS_PAS, weekday: "short", day: "numeric", month: "short" });
}
export function uraGlave(d: Date, j: Jezik = jezikVmesnika()): string {
  return d.toLocaleTimeString(lokalizacija(j), { timeZone: CAS_PAS, hour: "2-digit", minute: "2-digit", hour12: false });
}
/**
 * Trenutek -> Date, katerega LOKALNA polja so ljubljanski stenski cas. Za kartico Danes in pregled dneva: koledar hrani stenski cas
 * brez pasu (razberiCas), zato ga primerjamo z ljubljanskim »zdaj«. Samo za prikaz in primerjavo dneva, ne za racunanje trajanja.
 */
export function vLjubljani(d: Date): Date {
  const deli = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: CAS_PAS, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, Number(p.value)]),
  );
  return new Date(deli.year, deli.month - 1, deli.day, deli.hour, deli.minute, deli.second, d.getMilliseconds());
}
/** Kartica Danes/Today: slovensko kot doslej (»torek, 24. november«), angleško »Tuesday 24 November«. */
export function datumDanes(d: Date, j: Jezik = jezikVmesnika(), zLetom = false): string {
  if (j === "sl") return datumBesedilo(d, zLetom);
  return d.toLocaleDateString(lokalizacija(j), { weekday: "long", day: "numeric", month: "long", ...(zLetom ? { year: "numeric" } : {}) });
}
/** Datum in ura po jeziku vmesnika (opravila, gradnje). */
export function datumInUra(d: Date, j: Jezik = jezikVmesnika()): string {
  return d.toLocaleString(lokalizacija(j), { timeZone: CAS_PAS, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
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
export function casKlica(iso: string, jezik: Jezik = jezikVmesnika()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const loc = jezik === "sl" ? "sl-SI" : "en-GB";
  return `${d.toLocaleDateString(loc, { timeZone: CAS_PAS, day: "numeric", month: "numeric", year: "numeric" })}, ${d.toLocaleTimeString(loc, { timeZone: CAS_PAS, hour: "2-digit", minute: "2-digit" })}`;
}
