/**
 * Nastavitve obvestil (obvestila.json, samo lastnik). Privzeto vse vklopljeno (lastnikove ideje), novice in misel dneva »pomembno«.
 * Odlocitev je v obvestila-odlocitev.ts (cista funkcija). Komentarji so brez sumnikov.
 */
import { requireOwner } from "./auth.server.ts";
import { nastavitveIzShrambe, zdruziNastavitveObvestil, type NastavitveObvestil } from "./obvestila-odlocitev.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_OBVESTIL = "obvestila.json";

async function beri(root: string): Promise<NastavitveObvestil> {
  try {
    return nastavitveIzShrambe(await readJsonFile<unknown>(root, DATOTEKA_OBVESTIL));
  } catch {
    return nastavitveIzShrambe(null);
  }
}

export async function preberiNastavitveObvestil(token: string | null, dir?: string): Promise<NastavitveObvestil> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return beri(root);
}

/**
 * Shranjevanja v vrsti po mapi podatkov: hitra zaporedna klika (Ne moti, nato Ure miru) sta brez vrste prebrala isto datoteko in drugi
 * zapis je prepisal prvega (meritev 22. 11. 2026, izgubljena sprememba). Zdaj vsak popravek bere stanje po prejsnjem zapisu.
 */
const vrste = new Map<string, Promise<unknown>>();
function vVrsti<T>(kljuc: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(kljuc) ?? Promise.resolve();
  const to = prej.then(delo, delo);
  const rep = to.catch(() => undefined);
  vrste.set(kljuc, rep);
  void rep.then(() => {
    if (vrste.get(kljuc) === rep) vrste.delete(kljuc);
  });
  return to;
}

export async function shraniNastavitveObvestil(popravek: unknown, token: string | null, dir?: string): Promise<NastavitveObvestil> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(root, async () => {
    const nove = zdruziNastavitveObvestil(await beri(root), popravek);
    if (!nove) throw new Error("Neveljavna nastavitev obvestil.");
    await writeJson(root, DATOTEKA_OBVESTIL, nove);
    return nove;
  });
}
