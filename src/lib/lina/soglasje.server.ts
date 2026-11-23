import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Soglasje ob prvem zagonu (lastnikov ukaz 19. 11. 2026): z namestitvijo Line uporabnik soglasa, da njegov racunalnik postane
 * lokalni streznik za Lino; brez soglasja se Lina ne more uporabljati (ne zaslon, ne sprejem klicev). Beleži se ob PRVEM
 * izrecnem »Soglasam«; verzija omogoca ponoven vprasaj, ce se besedilo spremeni.
 */
export const VERZIJA_SOGLASJA = 1;
const DATOTEKA = "soglasje.json";

export async function soglasjeDano(dir?: string): Promise<boolean> {
  const f = await readJsonFile<{ verzija?: unknown }>(resolveDataDir(dir), DATOTEKA);
  return f?.verzija === VERZIJA_SOGLASJA;
}

export async function daSoglasje(dir?: string, zdaj = new Date()): Promise<void> {
  await writeJson(resolveDataDir(dir), DATOTEKA, { verzija: VERZIJA_SOGLASJA, cas: zdaj.toISOString() });
}
