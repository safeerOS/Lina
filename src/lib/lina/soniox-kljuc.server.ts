/**
 * Shramba API kljuca za izbirni dodatek Soniox (soniox.json, 0600, sifriran z glavno kljuco iz keys.server.ts).
 * Kljuc je samo lastnikov (brez privzetega kljuca in brez okolja) in nikoli ni v dnevniku, napaki ali odgovoru.
 */
import { chmod, unlink } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { loadPravila } from "./pravila.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

const DATOTEKA = "soniox.json";
const AAD = "soniox";
const MIN_DOLZINA = 8;
const MAX_DOLZINA = 200;

type ShranjenKljuc = {
  iv: string;
  tag: string;
  ciphertext: string;
};

export type StanjeSoniox = {
  vklop: boolean;
  kljucShranjen: boolean;
};

async function zakleni(datoteka: string): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(datoteka, 0o600);
}

function jeVeljavnaOblika(kljuc: string): boolean {
  // Brez presledkov, prelomov vrstic in nadzornih znakov; dolzina 8..200.
  return (
    kljuc.length >= MIN_DOLZINA &&
    kljuc.length <= MAX_DOLZINA &&
    // eslint-disable-next-line no-control-regex
    !/[\s\u0000-\u001f\u007f-\u009f]/.test(kljuc)
  );
}

/**
 * Shrani lastnikov kljuc Soniox (sifriran v soniox.json, 0600).
 * Zahteva veljavno sejo lastnika; napacen kljuc zavrne z besedilom iz besedila.ts (brez vrednosti kljuca).
 */
export async function shraniSonioxKljuc(
  kljuc: string,
  token: string | null,
  dir?: string,
): Promise<StanjeSoniox> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof kljuc !== "string") throw new Error(t("sonioxKljucOblika"));
  const cist = kljuc.trim();
  if (!jeVeljavnaOblika(cist)) throw new Error(t("sonioxKljucOblika"));
  const sifra = await sifrirajSkrivnost(cist, root, AAD);
  await writeJson(root, DATOTEKA, sifra satisfies ShranjenKljuc);
  await zakleni(path.join(root, DATOTEKA));
  const pravila = await loadPravila(root);
  return { vklop: pravila.sonioxVklop === true, kljucShranjen: true };
}

/**
 * Prebere sifriran kljuc za klicno pot. Nikoli ne izpise kljuca in nikoli ne vrze.
 * Uporablja izkljucno shranjen kljuc lastnika (nikoli spremenljivk okolja).
 */
export async function preberiSonioxKljuc(dir?: string): Promise<string | null> {
  try {
    const root = resolveDataDir(dir);
    const shranjeno = await readJsonFile<ShranjenKljuc>(root, DATOTEKA);
    if (
      !shranjeno ||
      typeof shranjeno !== "object" ||
      typeof shranjeno.iv !== "string" ||
      typeof shranjeno.tag !== "string" ||
      typeof shranjeno.ciphertext !== "string"
    ) {
      return null;
    }
    const kljuc = await odsifrirajSkrivnost(shranjeno, root, AAD);
    if (!kljuc || !jeVeljavnaOblika(kljuc)) return null;
    return kljuc;
  } catch {
    return null;
  }
}

/** Javno stanje dodatka Soniox za lastnika (BREZ kljuca). */
export async function stanjeSoniox(token: string | null, dir?: string): Promise<StanjeSoniox> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const [pravila, kljuc] = await Promise.all([loadPravila(root), preberiSonioxKljuc(root)]);
  return {
    vklop: pravila.sonioxVklop === true,
    kljucShranjen: kljuc !== null,
  };
}

/** Odstrani SAMO lastno datoteko soniox.json. Zahteva veljavno sejo lastnika. */
export async function pozabiSonioxKljuc(token: string | null, dir?: string): Promise<StanjeSoniox> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  try {
    await unlink(path.join(root, DATOTEKA));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const pravila = await loadPravila(root);
  return { vklop: pravila.sonioxVklop === true, kljucShranjen: false };
}
