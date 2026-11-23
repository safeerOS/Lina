import { renderReply, type Draft } from "./brain.ts";
import { fold, varenOdgovor } from "./guards.ts";
import { sestaviPozdrav } from "./povzetek.ts";
import type { Catalog, GuardResult } from "./types.ts";
import { odgovorIzKataloga, niOdgovoraVKatalogu } from "./znanje.ts";

/** Dejstva iz kataloga, preden jih model sploh vidi. */
export function jedroOdgovora(
  text: string,
  catalog: Catalog,
  draft: Draft,
  guard: GuardResult,
): { facts: string; neznano: boolean; izKataloga: boolean } {
  const iz = odgovorIzKataloga(text, catalog);
  const facts = iz ?? renderReply(catalog, draft, guard, false);
  return {
    facts,
    neznano: niOdgovoraVKatalogu(text, catalog, facts),
    izKataloga: Boolean(iz),
  };
}

/**
 * Koncni govor. Na prvi repliki je obvezni pozdrav vedno spredaj.
 * Osnutek je vir resnice: model ne sme dodati stevilke, cene, brezplacnosti ali roka.
 * Vprasanje po ceni gre v sporocilo. Potrditev se izrece pred njim.
 */
export function sestaviOdgovor(input: {
  question: string;
  osnutek: string;
  inquiry: string;
  fresh: boolean;
  pozdrav: string;
  podjetje?: string;
  osnova?: string;
  potrditev?: string;
}): string {
  const osnova = input.osnova ?? "";
  const jedroPotrditve = (input.potrditev ?? "").trim();
  const varno = jedroPotrditve
    ? `${jedroPotrditve} ${varenOdgovor(input.question, input.inquiry, input.inquiry, osnova)}`
    : varenOdgovor(input.question, input.osnutek, input.inquiry, osnova);
  const jedro = input.fresh ? `${sestaviPozdrav(input.pozdrav, input.podjetje ?? "")} ${varno}` : varno;
  return jedro.replace(/\s+/g, " ").trim();
}

/** Pozdrav na zacetku stavka (»Pozdravljeni, ...«, »Dober dan.«): beseda, ne cel stavek. */
const POZDRAV_BESEDA = /^(dober dan|dober vecer|dobro jutro|pozdravljeni|pozdravljena|pozdrav|lep pozdrav|zdravo|zivjo|hej|halo)\b[\s,.!:;-]*/;
/** Stavek, ki se predstavi: »Tukaj Lina.«, »Lina pri telefonu.«, »Sem Lina, pomocnica ...«, »Sem AI asistentka.«. */
const PREDSTAVITEV =
  /\b(?:tukaj|tu|jaz sem|sem)\s+(?:je\s+)?lina\b|^lina\b.{0,40}\b(?:pri telefonu|pomocnic|asistentk|tajnic)|\bpomocnic\w*\s+z\s+umetno|\bsem\s+(?:ai|umetn)|\bumetn\w+\s+inteligenc/;

/**
 * Odgovor modela nikoli ne zacne s pozdravom ali predstavitvijo: Lina se predstavi samo enkrat, v pozdravu
 * (lastnik, 10. 11. 2026, drugi pravi klic: odgovor modela se je zacel z »Pozdravljeni, tukaj Lina.«).
 * Odreze uvodne stavke, ki so samo pozdrav ali predstavitev, in pozdravno besedo na zacetku stavka z vsebino.
 * Ce ostane prazno, vrne rezervo (preverjeno dejstvo).
 */
export function brezUvoda(odgovor: string, rezerva: string): string {
  const stavki = odgovor.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  while (stavki.length > 0) {
    const kljuc = fold(stavki[0]);
    if (PREDSTAVITEV.test(kljuc)) {
      stavki.shift();
      continue;
    }
    const pozdrav = POZDRAV_BESEDA.exec(kljuc);
    if (!pozdrav) break;
    const ostanek = stavki[0].slice(pozdrav[0].length).trim();
    if (!/[\p{L}\d]/u.test(ostanek)) {
      stavki.shift();
      continue;
    }
    // »Pozdravljeni, tukaj Lina.« je ze izpadel zgoraj; »Dober dan, zapisala sem ...« obdrzi samo vsebino.
    if (PREDSTAVITEV.test(fold(ostanek))) {
      stavki.shift();
      continue;
    }
    stavki[0] = ostanek.charAt(0).toLocaleUpperCase("sl") + ostanek.slice(1);
    break;
  }
  const ven = stavki.join(" ").trim();
  return ven || rezerva;
}
