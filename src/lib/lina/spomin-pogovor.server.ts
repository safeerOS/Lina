/**
 * Spomin pogovorov asistentke (Lina Memory Engine, korak 1 in 2; lastnik 22. 11. 2026: »More biti vklopljeno da si lina zapomni
 * pogovore«, brez potrjevanja). Vsaka izmenjava lastnik-Lina gre v spomin.sqlite (spomin-baza.server.ts: FTS5, 0600, meja 50 MB,
 * brez skrivnosti); pred odgovorom Lina poisce sorodne STAREJSE obrate in jih modelu da kot podatek (ne navodilo). Spomin je locen od
 * modela (isti za vse ponudnike). Klici tajnice ga ne dobijo (seja »asistent«). Napaka spomina nikoli ne podre pogovora.
 * V dnevnik gredo samo stevila. Komentarji so brez sumnikov.
 */
import { requireOwner } from "./auth.server.ts";
import { isci, izbrisiVse, jeSpominBazeVklopljen, nastaviSpominBaze, zapisiObrat, type ObratZapis } from "./spomin-baza.server.ts";
import { resolveDataDir } from "./store.server.ts";

export const SEJA_ASISTENTA = "asistent";
export const NAJVEC_PRIKLICANIH = 6;
const NAJVEC_ZNAKOV_OBRATA = 300;

/** Zapise izmenjavo (najprej lastnik, nato Lina). Vrne stevilo zapisanih obratov; napaka = 0. */
export async function zapisiIzmenjavo(root: string, lastnik: string, lina: string, cas: Date = new Date()): Promise<number> {
  let zapisanih = 0;
  try {
    for (const [vloga, besedilo] of [["uporabnik", lastnik], ["lina", lina]] as const) {
      const r = await zapisiObrat({ seja: SEJA_ASISTENTA, vloga, besedilo, cas }, { dir: root });
      if (r.zapisano) zapisanih += 1;
    }
  } catch {
    console.warn(`lina spomin-pogovor: zapis ni uspel (zapisanih=${zapisanih})`);
  }
  return zapisanih;
}

/** Ena vrstica za model: datum, kdo, besedilo (ena vrstica, omejena dolzina). */
export function vrsticaSpomina(o: ObratZapis): string {
  const datum = Number.isFinite(o.cas) ? new Date(o.cas).toISOString().slice(0, 10) : "";
  const kdo = o.vloga === "lina" ? "Lina" : "Lastnik";
  const besedilo = o.besedilo.replace(/\s+/g, " ").trim().slice(0, NAJVEC_ZNAKOV_OBRATA);
  return `- ${datum} ${kdo}: ${besedilo}`;
}

/**
 * Priklic: sorodni obrati iz preteklih pogovorov, ki NISO ze v zadnjih sporocilih (te model dobi tako ali tako).
 * Prazen niz, ce ni zadetkov ali je spomin izklopljen ali je prislo do napake.
 */
export async function prikliciSpomin(root: string, vprasanje: string, zeVKontekstu: Iterable<string> = []): Promise<string> {
  try {
    const ze = new Set([...zeVKontekstu].map((s) => s.replace(/\s+/g, " ").trim()));
    const zadetki = await isci(vprasanje, NAJVEC_PRIKLICANIH * 3, { dir: root, seja: SEJA_ASISTENTA, katerakoli: true });
    const izbrani = zadetki.filter((o) => !ze.has(o.besedilo.replace(/\s+/g, " ").trim())).slice(0, NAJVEC_PRIKLICANIH);
    if (izbrani.length === 0) return "";
    izbrani.sort((a, b) => a.cas - b.cas);
    return izbrani.map(vrsticaSpomina).join("\n");
  } catch {
    console.warn("lina spomin-pogovor: priklic ni uspel");
    return "";
  }
}

/** Stikalo v Nastavitvah (samo lastnik): privzeto vklopljeno. */
export async function stanjeSpominaPogovorov(token: string | null, dir?: string): Promise<{ vklopljen: boolean }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return { vklopljen: await jeSpominBazeVklopljen(root) };
}

export async function nastaviSpominPogovorov(vklop: unknown, token: string | null, dir?: string): Promise<{ vklopljen: boolean }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
  return { vklopljen: await nastaviSpominBaze(vklop, root) };
}

/** »Izbriši vse pogovore iz spomina« (gumb uporabnika v Nastavitvah, s potrditvijo v vmesniku). Stikalo ostane, kot je. */
export async function izbrisiSpominPogovorov(token: string | null, dir?: string): Promise<{ izbrisanih: number }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return { izbrisanih: (await izbrisiVse({ dir: root })).izbrisanihDatotek };
}
