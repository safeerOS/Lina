/**
 * Cista logika levega menija okvirja Line 2.0 (brez Reacta, da jo preizkusi node:test).
 * V osebnem nacinu ("osebna") skrije razdelek Znanje (en vir: razdelekViden iz osebni-nacin.ts)
 * in preimenuje vnos "narocila" v "Sporočila" / "Messages" (zavihekSporocila iz lib/lina/besedila.ts).
 * Podjetje in nedolocen nacin ostaneta nespremenjena: vseh 12 vnosov v starem vrstnem redu in z istimi oznakami.
 */
import { jezikVmesnika, t, type Jezik } from "../../lib/lina/besedila.ts";
import { fold } from "../../lib/lina/guards.ts";
import { jeOsebniNacin, razdelekViden, type NacinKlica } from "../../lib/lina/osebni-nacin.ts";
import type { RazdelekLine } from "../../lib/lina/ui-videz.ts";
import { t2, type Beseda2 } from "./besedila.ts";

export type Stran = "domov" | "pogovor" | "koledar" | "imenik" | "novice" | "mediji" | "kontrola" | "racunalnik" | RazdelekLine;

export type VnosMenija = { id: Stran; ikona: string; oznaka: string };

const OSNOVNI_MENI: ReadonlyArray<{ id: Stran; ikona: string; oznaka: Beseda2 }> = [
  { id: "domov", ikona: "domov", oznaka: "navDomov" },
  { id: "pogovor", ikona: "pogovor", oznaka: "navPogovor" },
  { id: "koledar", ikona: "koledar", oznaka: "navKoledar" },
  { id: "imenik", ikona: "imenik", oznaka: "navImenik" },
  { id: "novice", ikona: "novice", oznaka: "navNovice" },
  { id: "mediji", ikona: "mediji", oznaka: "navMediji" },
  { id: "klic", ikona: "klic", oznaka: "navKlici" },
  { id: "narocila", ikona: "narocila", oznaka: "navNarocila" },
  { id: "znanje", ikona: "znanje", oznaka: "navZnanje" },
  { id: "dnevnik", ikona: "dnevnik", oznaka: "navDnevnik" },
  { id: "zapiski", ikona: "zapiski", oznaka: "navZapiski" },
  { id: "telefon", ikona: "telefon", oznaka: "navTelefon" },
  { id: "linija", ikona: "linija", oznaka: "navLinija" },
  { id: "kontrola", ikona: "kontrola", oznaka: "navKontrola" },
  { id: "racunalnik", ikona: "racunalnik", oznaka: "navRacunalnik" },
  { id: "nastavitve", ikona: "nastavitve", oznaka: "navNastavitve" },
];

/** Vidni vnosi levega menija za izbrani nacin in jezik. */
export function menijStrani(
  nacin: NacinKlica | string | undefined,
  jezik: Jezik = jezikVmesnika(),
): VnosMenija[] {
  const osebno = jeOsebniNacin(nacin);
  const izid: VnosMenija[] = [];
  for (const vnos of OSNOVNI_MENI) {
    if (vnos.id === "znanje" && !razdelekViden("znanje", nacin)) continue;
    // Kontrola tiska je orodje podjetja (tiskarna); v osebnem nacinu je ni.
    if (vnos.id === "kontrola" && osebno) continue;
    const oznaka =
      vnos.id === "narocila" && osebno
        ? t("zavihekSporocila", jezik)
        : t2(vnos.oznaka, jezik);
    izid.push({ id: vnos.id, ikona: vnos.ikona, oznaka });
  }
  return izid;
}

/** Preveri, ali je oznaka veljavna in vidna stran v trenutnem nacinu. */
/** Pregled 0213 B7: koliko vprasanj agenta caka lastnika (znacka na Racunalniku in obvestilo namizja, ne glede na odprt zavihek). */
export function cakajocaVprasanja(st: { vprasanja?: ReadonlyArray<{ stanje: string }> } | null | undefined): number {
  return st?.vprasanja?.filter((v) => v.stanje === "caka").length ?? 0;
}

export function jeStran(v: string, nacin: NacinKlica | string | undefined): v is Stran {
  return menijStrani(nacin).some((n) => n.id === v);
}

/** Stran, ki je v tem nacinu skrita (npr. Znanje v osebnem nacinu), preklopi na »klic«. */
export function veljavnaStran(stran: Stran, nacin: NacinKlica | string | undefined): Stran {
  return menijStrani(nacin).some((n) => n.id === stran) ? stran : "klic";
}

/** Poisce stran v vidnem meniju po prijazni oznaki (brez velikih crk in stresic). */
export function najdiStran(
  poizvedba: string,
  nacin: NacinKlica | string | undefined,
  jezik: Jezik = jezikVmesnika(),
): Stran | undefined {
  const f = fold(poizvedba);
  if (!f) return undefined;
  return menijStrani(nacin, jezik).find((n) => fold(n.oznaka).includes(f))?.id;
}
