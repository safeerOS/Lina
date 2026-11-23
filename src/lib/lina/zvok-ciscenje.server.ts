/**
 * Nastavitev cistenja zvoka klicev (zvok-ciscenje.ts): stikalo v zvok.json, PRIVZETO VKLOPLJENO (lastnikov ukaz 21. 11. 2026:
 * "Privzeto naj bo ciscenje zvoka vklopljeno"). Korist za razumevanje na pravih klicih je NEPREVERJENA (sinteticni
 * preizkusi dokazujejo samo, da stalni sum pade in govor ostane); zato je stikalo za izklop vedno na voljo.
 * Stikalo velja za pot SIP (RTP, zvok klicatelja). Branje za klic ne zahteva zetona (notranja pot); manjkajoca ali pokvarjena
 * datoteka pomeni privzeto (vklopljeno); samo izrecni false izklopi. Spreminjanje samo lastnik. Komentarji so brez sumnikov.
 */
import { requireOwner } from "./auth.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_ZVOKA = "zvok.json";

export type ZvokNastavitve = { ciscenjeKlicev: boolean };

/** Za klic (brez zetona): true, razen ce je v datoteki izrecno false (manjkajoca ali pokvarjena datoteka = privzeto vklopljeno). */
export async function ciscenjeKlicevVklopljeno(dir?: string): Promise<boolean> {
  try {
    const s = await readJsonFile<{ ciscenjeKlicev?: unknown }>(resolveDataDir(dir), DATOTEKA_ZVOKA);
    return s?.ciscenjeKlicev !== false;
  } catch {
    return true;
  }
}

export async function preberiNastavitveZvoka(token: string | null, dir?: string): Promise<ZvokNastavitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return { ciscenjeKlicev: await ciscenjeKlicevVklopljeno(root) };
}

/** Stikalo mora biti izrecno true ali false; vse drugo vrze in datoteke ne spremeni. */
export async function nastaviCiscenjeKlicev(vklop: unknown, token: string | null, dir?: string): Promise<ZvokNastavitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof vklop !== "boolean") throw new Error("Neveljavna nastavitev.");
  await writeJson(root, DATOTEKA_ZVOKA, { ciscenjeKlicev: vklop });
  return { ciscenjeKlicev: vklop };
}
