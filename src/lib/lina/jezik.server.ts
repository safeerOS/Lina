/**
 * Izbira jezika vmesnika na strezniku (najdba N3, 24. 11. 2026): namizna lupina ob vsakem zagonu dobi nova vrata, zato localStorage
 * (loceno po izvoru) izbiro izgubi. Branje je brez prijave (vrednost je samo »sistem«/»sl«/»en«, zaslon prijave jo potrebuje),
 * zapis samo lastnik.
 */
import { requireOwner } from "./auth.server.ts";
import type { IzbiraJezika } from "./besedila.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_JEZIKA = "jezik-vmesnika.json";

function veljavna(v: unknown): v is IzbiraJezika {
  return v === "sistem" || v === "sl" || v === "en";
}

/** Shranjena izbira ali null (ni zapisa, pokvarjen zapis). */
export async function preberiIzbiroJezika(dir?: string): Promise<IzbiraJezika | null> {
  const zapis = await readJsonFile<{ izbira?: unknown }>(resolveDataDir(dir), DATOTEKA_JEZIKA).catch(() => null);
  return veljavna(zapis?.izbira) ? zapis.izbira : null;
}

export async function shraniIzbiroJezika(izbira: unknown, token: string | null, dir?: string): Promise<IzbiraJezika> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!veljavna(izbira)) throw new Error("Neveljaven jezik.");
  await writeJson(root, DATOTEKA_JEZIKA, { izbira });
  return izbira;
}
