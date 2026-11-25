/**
 * Lahek stevec porabe zetonov v pomnilniku za vse klice modelov (callProvider in callProviderZOrodji).
 * Zapisuje SAMO stevila zetonov, ponudnika, model, nacin in cas zadnjega klica — NIKOLI vsebine sporocil,
 * odgovorov, argumentov orodij ali kljucev. Izvoz posnetekPorabe() je pripravljen za vmesnik.
 * Komentarji so brez sumnikov.
 */
import type { BrainProvider } from "./types.ts";

export type PorabaZetonov = {
  /** Vhodni zetoni (prompt / input). */
  vhod: number;
  /** Izhodni zetoni (completion / output / candidates). */
  izhod: number;
  /** Predpomnjeni vhodni zetoni (cached / cache_read). */
  predpomnjeni: number;
  /** Zetoni, zapisani v predpomnilnik (Claude cache_creation_input_tokens), ce so prisotni. */
  zapisPredpomnilnika?: number;
};

export type NacinKlicaPorabe = "pogovor" | "orodja";

export type ZapisPorabe = {
  provider: BrainProvider;
  model: string;
  nacin: NacinKlicaPorabe;
  klici: number;
  vhod: number;
  izhod: number;
  predpomnjeni: number;
  zapisPredpomnilnika: number;
  zadnjiKlic: string;
};

export type PosnetekPorabe = {
  od: string;
  skupaj: {
    klici: number;
    vhod: number;
    izhod: number;
    predpomnjeni: number;
    zapisPredpomnilnika: number;
  };
  poModelu: ZapisPorabe[];
};

const NAJVEC_VRSTIC_PORABE = 200;

function jeObjekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function nenegativnoCelo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/**
 * Razbere porabo zetonov iz surovega JSON odgovora ponudnika:
 * - Gemini / Vertex: usageMetadata { promptTokenCount, candidatesTokenCount, cachedContentTokenCount }
 * - OpenAI-zdruzljivi (OpenAI, Grok, OpenRouter, OmniRoute, custom): usage { prompt_tokens, completion_tokens, prompt_tokens_details.cached_tokens }
 * - Claude: usage { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
 * Vrne null, ce odgovor ne vsebuje polja usage/usageMetadata.
 */
export function razberiPorabo(json: unknown): PorabaZetonov | null {
  if (!jeObjekt(json)) return null;

  if (jeObjekt(json.usageMetadata)) {
    const m = json.usageMetadata;
    const vhod = nenegativnoCelo(m.promptTokenCount);
    const izhod = nenegativnoCelo(m.candidatesTokenCount);
    const predpomnjeni = nenegativnoCelo(m.cachedContentTokenCount);
    if (vhod === null && izhod === null && predpomnjeni === null) return null;
    return {
      vhod: vhod ?? 0,
      izhod: izhod ?? 0,
      predpomnjeni: predpomnjeni ?? 0,
    };
  }

  if (jeObjekt(json.usage)) {
    const u = json.usage;
    const vhod = nenegativnoCelo(u.prompt_tokens) ?? nenegativnoCelo(u.input_tokens);
    const izhod = nenegativnoCelo(u.completion_tokens) ?? nenegativnoCelo(u.output_tokens);
    const podrobnosti = jeObjekt(u.prompt_tokens_details) ? u.prompt_tokens_details : null;
    const predpomnjeni =
      nenegativnoCelo(u.cache_read_input_tokens) ??
      nenegativnoCelo(podrobnosti?.cached_tokens) ??
      nenegativnoCelo(u.cached_tokens);
    const zapis = nenegativnoCelo(u.cache_creation_input_tokens);
    if (vhod === null && izhod === null && predpomnjeni === null && zapis === null) return null;
    return {
      vhod: vhod ?? 0,
      izhod: izhod ?? 0,
      predpomnjeni: predpomnjeni ?? 0,
      ...(zapis !== null && zapis > 0 ? { zapisPredpomnilnika: zapis } : {}),
    };
  }

  return null;
}

/** Varno razbere porabo iz JSON niza (vrne null, ce niz ni JSON ali nima polja usage). */
export function razberiPoraboIzBesedila(surovo: string): PorabaZetonov | null {
  try {
    return razberiPorabo(JSON.parse(surovo) as unknown);
  } catch {
    return null;
  }
}

let zacetekPorabe = new Date().toISOString();
const poKljucu = new Map<string, ZapisPorabe>();

/**
 * Zabelezi porabo enega uspesnega klica v stevec v pomnilniku.
 * Brez polja poraba ne naredi nicesar. Nikoli ne shrani vsebine sporocil.
 */
export function zabeleziPorabo(
  provider: BrainProvider,
  model: string,
  poraba: PorabaZetonov | null | undefined,
  nacin: NacinKlicaPorabe = "pogovor",
  zdaj: Date = new Date(),
): void {
  if (!poraba) return;
  const vhod = nenegativnoCelo(poraba.vhod) ?? 0;
  const izhod = nenegativnoCelo(poraba.izhod) ?? 0;
  const predpomnjeni = nenegativnoCelo(poraba.predpomnjeni) ?? 0;
  const zapis = nenegativnoCelo(poraba.zapisPredpomnilnika) ?? 0;
  const cistModel = model.trim().slice(0, 80) || "neznan";
  const kljuc = `${provider}|${cistModel}|${nacin}`;
  const cas = zdaj.toISOString();

  const obstojec = poKljucu.get(kljuc);
  if (obstojec) {
    obstojec.klici += 1;
    obstojec.vhod += vhod;
    obstojec.izhod += izhod;
    obstojec.predpomnjeni += predpomnjeni;
    obstojec.zapisPredpomnilnika += zapis;
    obstojec.zadnjiKlic = cas;
    return;
  }

  if (poKljucu.size >= NAJVEC_VRSTIC_PORABE) {
    const najstarejsi = poKljucu.keys().next().value;
    if (najstarejsi !== undefined) poKljucu.delete(najstarejsi);
  }

  poKljucu.set(kljuc, {
    provider,
    model: cistModel,
    nacin,
    klici: 1,
    vhod,
    izhod,
    predpomnjeni,
    zapisPredpomnilnika: zapis,
    zadnjiKlic: cas,
  });
}

/** Nepromenljiv posnetek porabe zetonov za vmesnik (brez vsebine sporocil in brez kljucev). */
export function posnetekPorabe(): PosnetekPorabe {
  const poModelu: ZapisPorabe[] = [];
  const skupaj = { klici: 0, vhod: 0, izhod: 0, predpomnjeni: 0, zapisPredpomnilnika: 0 };
  for (const z of poKljucu.values()) {
    poModelu.push({ ...z });
    skupaj.klici += z.klici;
    skupaj.vhod += z.vhod;
    skupaj.izhod += z.izhod;
    skupaj.predpomnjeni += z.predpomnjeni;
    skupaj.zapisPredpomnilnika += z.zapisPredpomnilnika;
  }
  return { od: zacetekPorabe, skupaj, poModelu };
}

/** Ponastavi stevec porabe v pomnilniku. */
export function pocistiPorabo(zdaj: Date = new Date()): void {
  poKljucu.clear();
  zacetekPorabe = zdaj.toISOString();
}
