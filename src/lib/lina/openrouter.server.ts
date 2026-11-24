/**
 * Stanje racuna OpenRouter in seznam modelov (lastnik 24. 11. 2026, naloga C3/C8). Samo openrouter.ai, kljuc samo v glavi
 * Authorization, nikoli v naslovu, dnevniku ali sporocilu. Polja po dokumentaciji OpenRouter (api-reference/limits), kot jih navaja
 * lastnikova naloga: is_free_tier, limit_remaining, free_model_daily_requests {used, limit, remaining}. Oblika odgovora (ovoj »data«
 * ali ne) NI preverjena s pravim racunom, zato razclenjevanje sprejme obe. GET /api/v1/credits NI uporabljen (ni preverjeno, ali
 * deluje z navadnim kljucem); dobroimetje se presodi po is_free_tier in po napaki 402 med delom. Komentarji so brez sumnikov.
 */
import { hideSecret, httpsFetch } from "./providers.ts";
import { jeTocnoBrezplacen } from "./types.ts";

const OSNOVA = "https://openrouter.ai/api/v1";
const ROK_MS = 8_000;
const NAJVEC_MODELOV = 400;

export type StanjeOpenRouter = {
  /** true = uporabnik ni nikoli kupil kredita (samo brezplacni modeli); null = neznano. */
  brezplacniRacun: boolean | null;
  preostaloKreditov: number | null;
  dnevno: { porabljeno: number | null; meja: number | null; preostalo: number | null } | null;
};

function stevilo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function predmet(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Razclenitev odgovora GET /api/v1/key (z ovojem »data« ali brez). Neznana polja ostanejo null. */
export function razberiStanjeKljuca(json: unknown): StanjeOpenRouter {
  const zunanji = predmet(json) ?? {};
  const d = predmet(zunanji.data) ?? zunanji;
  const dn = predmet(d.free_model_daily_requests);
  return {
    brezplacniRacun: typeof d.is_free_tier === "boolean" ? d.is_free_tier : null,
    preostaloKreditov: stevilo(d.limit_remaining),
    dnevno: dn ? { porabljeno: stevilo(dn.used), meja: stevilo(dn.limit), preostalo: stevilo(dn.remaining) } : null,
  };
}

export async function stanjeOpenRouter(
  kljuc: string,
  f: typeof httpsFetch = httpsFetch,
): Promise<{ ok: true; stanje: StanjeOpenRouter } | { ok: false; sporocilo: string }> {
  if (!kljuc) return { ok: false, sporocilo: "Ključ ni nastavljen." };
  try {
    const odg = await f(`${OSNOVA}/key`, { method: "GET", headers: { authorization: `Bearer ${kljuc}` } }, ROK_MS, ROK_MS);
    if (odg.status === 401) return { ok: false, sporocilo: "OpenRouter: ključ ni veljaven." };
    if (!odg.ok) return { ok: false, sporocilo: `OpenRouter: stanja računa ni mogoče prebrati (${odg.status}).` };
    return { ok: true, stanje: razberiStanjeKljuca(JSON.parse(await odg.text())) };
  } catch (error) {
    return { ok: false, sporocilo: hideSecret(error instanceof Error && error.name === "TimeoutError" ? "OpenRouter ni odgovoril pravočasno." : "OpenRouter ni dosegljiv.", kljuc) };
  }
}

function jeNic(v: unknown): boolean {
  return (typeof v === "string" || typeof v === "number") && Number(v) === 0;
}

/**
 * Razclenitev javnega seznama GET /api/v1/models. samoBrezplacni: samo modeli s ceno 0 (prompt in completion), z "tools" v
 * supported_parameters in s tocnim ID-jem :free (C3, C7). Sicer vsi veljavni ID-ji. Brez dvojnikov, najvec 400.
 */
export function razberiModele(json: unknown, samoBrezplacni: boolean): string[] {
  const seznam = predmet(json)?.data;
  if (!Array.isArray(seznam)) return [];
  const izid = new Set<string>();
  for (const m of seznam) {
    const o = predmet(m);
    const id = typeof o?.id === "string" ? o.id : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/.test(id)) continue;
    if (samoBrezplacni) {
      const cena = predmet(o?.pricing);
      const parametri = Array.isArray(o?.supported_parameters) ? o.supported_parameters : [];
      if (!jeTocnoBrezplacen(id) || !cena || !jeNic(cena.prompt) || !jeNic(cena.completion) || !parametri.includes("tools")) continue;
    }
    izid.add(id);
    if (izid.size >= NAJVEC_MODELOV) break;
  }
  return [...izid];
}

/** Javni seznam (brez kljuca). Napaka = prazen seznam z razlogom; rocni vnos modela ostane. */
export async function modeliOpenRouter(
  samoBrezplacni: boolean,
  f: typeof httpsFetch = httpsFetch,
): Promise<{ ok: true; modeli: string[] } | { ok: false; sporocilo: string }> {
  try {
    const odg = await f(`${OSNOVA}/models`, { method: "GET" }, ROK_MS, ROK_MS);
    if (!odg.ok) return { ok: false, sporocilo: `OpenRouter: seznama modelov ni mogoče prebrati (${odg.status}).` };
    return { ok: true, modeli: razberiModele(JSON.parse(await odg.text()), samoBrezplacni) };
  } catch {
    return { ok: false, sporocilo: "OpenRouter ni dosegljiv." };
  }
}
