import { nastaviOsvezevanjeZetona, zagrejZeton } from "./adc.server.ts";
import { activeBrain } from "./keys.server.ts";
import { llmOn } from "./llm.server.ts";
import { OSEBNI_MODELI } from "./osebna-razumevanje.server.ts";
import { callProvider } from "./providers.ts";
import { loadPravila } from "./pravila.server.ts";
import { nastaviToplePovezave, ogrej } from "./povezave.server.ts";
import { resolveDataDir } from "./store.server.ts";

/**
 * Ogrevanje ob zacetku klica (odlocitev vodje 12. 11. 2026: odzivnost je glavna; izmerjeno: hladen ADC zeton ~3,2 s,
 * nova povezava do Googla 160-320 ms na zahtevo). Poklicejo ga vsi vhodi: zagon Line, webhook glasu, testni klic, vaja klica.
 * Ogreva samo, ce je stikalo »toplePovezave« vklopljeno (privzeto) IN je za Lino nastavljen racun Google Cloud (mozgani Vertex).
 * Ne pošilja vsebine klica; napake ne vrze (ogrevanje nikoli ne sme zaviti klica).
 */
export type OpisOgrevanja = { vklop: boolean; vertex: boolean };

async function privzeto(opis: OpisOgrevanja): Promise<void> {
  nastaviToplePovezave(opis.vklop);
  // Periodicno osvezevanje zetona ob 80 % veljavnosti, dokler Lina tece in ima racun; izklop stikala ga ustavi.
  nastaviOsvezevanjeZetona(opis.vklop && opis.vertex, undefined, true);
  if (!opis.vklop || !opis.vertex) return;
  ogrej();
  // Zeton ne sme biti hladen ob klicu: pridobi ga takoj (ob zagonu in ob zacetku klica), ne caka prvega obrata.
  void zagrejZeton();
}

/**
 * Ogrevanje modela ob prihodu klica (ukrep D, izmerjeno 14. 11. 2026: gemini-3.1-flash-lite, global, 4 izreki x 10, izmenicno, nova povezava):
 * hladno mediana 1034 ms; ogreta povezava (HEAD x2 kot ogrej) 817 ms; ogreta povezava + kratek pravi klic modela 698 ms (p95 1361 | 1184 | 1025 ms).
 * Kratek klic (brez vsebine klica, 8 zetonov) se po pozdravu ne ponavlja prej kot po MODEL_OGREJ_MS; napake se ne vrzejo.
 */
export const MODEL_OGREJ_MS = 40_000;
let zadnjeOgrevanjeModela = 0;
let klicOgrevanja: typeof callProvider = callProvider;
export function nastaviOgrevanjeModelaZaPreizkus(f: typeof callProvider | null, ponastavi = false): void {
  klicOgrevanja = f ?? callProvider;
  if (ponastavi) zadnjeOgrevanjeModela = 0;
}
export async function ogrejModel(dir: string, zdaj: number = Date.now()): Promise<boolean> {
  if (!llmOn() || zdaj - zadnjeOgrevanjeModela < MODEL_OGREJ_MS) return false;
  try {
    const brain = await activeBrain(dir);
    if (!brain || brain.provider !== "vertex") return false;
    zadnjeOgrevanjeModela = zdaj;
    await klicOgrevanja({ ...brain, model: OSEBNI_MODELI[0], location: "global", text: "a", system: "Odgovori z eno besedo.", maxTokens: 8, timeoutMs: 4_000 });
    return true;
  } catch {
    return false;
  }
}

let izvedi: (opis: OpisOgrevanja) => Promise<void> = privzeto;

/** Samo za preizkuse: nadomesti izvedbo (null povrne privzeto). */
export function nastaviOgrevanjeZaPreizkus(f: ((opis: OpisOgrevanja) => Promise<void>) | null): void {
  izvedi = f ?? privzeto;
}

export async function ogrejZaKlic(dir?: string): Promise<void> {
  try {
    const root = resolveDataDir(dir);
    const pravila = await loadPravila(root);
    const brain = await activeBrain(root).catch(() => null);
    await izvedi({ vklop: pravila.toplePovezave !== false, vertex: brain?.provider === "vertex" });
    if (pravila.toplePovezave !== false && brain?.provider === "vertex") void ogrejModel(root);
  } catch {
    /* Ogrevanje je pomoc, ne pogoj za klic. */
  }
}
