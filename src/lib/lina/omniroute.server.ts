import { rm } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { veljavenNaslovPrehoda, type PrehodNastavitve } from "./omniroute.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Neobvezen prehod OmniRoute (lastnikov ukaz 19. 11. 2026). PRIVZETO IZKLOPLJEN. Kljuc prehoda je sifriran na disku (kot kljuc
 * Brave), nikoli ne gre nazaj odjemalcu in ni v dnevniku. Vklop zahteva veljaven naslov in shranjen kljuc.
 */
const KLJUC = "omniroute.json";
const NASTAVITVE = "omniroute-nastavitve.json";

type Shranjeno = { iv: string; tag: string; ciphertext: string };
export type StanjeOmniroute = { povezan: boolean; vklop: boolean; naslov: string; klici: boolean };
export type VnosOmniroute = { vklop?: unknown; naslov?: unknown; klici?: unknown; kljuc?: unknown };

export function jeVeljavenKljucPrehoda(k: string): boolean {
  return k.length >= 8 && k.length <= 300 && /^[\x21-\x7e]+$/.test(k);
}

async function preberiNastavitve(root: string): Promise<{ vklop: boolean; naslov: string; klici: boolean }> {
  const n = await readJsonFile<{ vklop?: unknown; naslov?: unknown; klici?: unknown }>(root, NASTAVITVE);
  const naslov = typeof n?.naslov === "string" && veljavenNaslovPrehoda(n.naslov) ? n.naslov : "";
  // Samo izrecen true vklopi (privzeto izklopljeno).
  return { vklop: n?.vklop === true && naslov !== "", naslov, klici: n?.klici === true };
}

async function preberiKljuc(root: string): Promise<string | null> {
  const f = await readJsonFile<Shranjeno>(root, KLJUC);
  return f?.ciphertext ? odsifrirajSkrivnost(f, root) : null;
}

export async function stanjeOmniroute(token: string | null, dir?: string): Promise<StanjeOmniroute> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = await preberiNastavitve(root);
  return { povezan: (await preberiKljuc(root)) !== null, ...n };
}

export async function shraniOmniroute(token: string | null, vnos: VnosOmniroute, dir?: string): Promise<StanjeOmniroute> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const prej = await preberiNastavitve(root);
  let naslov = prej.naslov;
  if (vnos.naslov !== undefined) {
    if (typeof vnos.naslov !== "string" || !veljavenNaslovPrehoda(vnos.naslov)) {
      throw new Error("Naslov prehoda ni veljaven: http samo za ta racunalnik, sicer https (tudi domace omrezje), brez gesla in parametrov.");
    }
    naslov = vnos.naslov.trim();
  }
  if (vnos.kljuc !== undefined) {
    const k = typeof vnos.kljuc === "string" ? vnos.kljuc.trim() : "";
    if (!jeVeljavenKljucPrehoda(k)) throw new Error("Kljuc prehoda ni veljaven.");
    await writeJson(root, KLJUC, await sifrirajSkrivnost(k, root));
  }
  const imaKljuc = (await preberiKljuc(root)) !== null;
  const vklop = vnos.vklop === undefined ? prej.vklop : vnos.vklop === true;
  if (vklop && (!naslov || !imaKljuc)) throw new Error("Za vklop vpisi veljaven naslov in kljuc prehoda.");
  const klici = vnos.klici === undefined ? prej.klici : vnos.klici === true;
  await writeJson(root, NASTAVITVE, { vklop, naslov, klici });
  return stanjeOmniroute(token, dir);
}

export async function pozabiOmniroute(token: string | null, dir?: string): Promise<StanjeOmniroute> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await rm(path.join(root, KLJUC), { force: true });
  await writeJson(root, NASTAVITVE, { vklop: false, naslov: (await preberiNastavitve(root)).naslov, klici: false });
  return stanjeOmniroute(token, dir);
}

/** Nastavitve za klicatelje callProvider (samo na streznikovi strani; null = izklopljeno ali brez kljuca). */
export async function prehodZaKlic(dir?: string): Promise<(PrehodNastavitve & { kljuc: string }) | undefined> {
  const root = resolveDataDir(dir);
  const n = await preberiNastavitve(root);
  if (!n.vklop) return undefined;
  const kljuc = await preberiKljuc(root);
  return kljuc ? { ...n, kljuc } : undefined;
}
