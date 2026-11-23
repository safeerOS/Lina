import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { KATEGORIJE, type Kategorija } from "./izhodni-filter.ts";
import { resolveDataDir } from "./store.server.ts";

/**
 * Lokalni dnevnik izhodnega filtra (izhodni-filter.jsonl):
 * hrani SAMO cas in stevilo najdenih kategorij (nikoli vrednosti).
 * Omejitev: najvec 2000 vrstic; pri preseganju obdrzi zadnjih 1000 z atomarno zamenjavo nove datoteke.
 */
export const DATOTEKA_DNEVNIKA_FILTRA = "izhodni-filter.jsonl";
export const NAJVEC_VRSTIC_DNEVNIKA = 2000;
export const OBDRZI_VRSTIC_DNEVNIKA = 1000;

const vrste = new Map<string, Promise<unknown>>();

function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const naslednji = prej.catch(() => undefined).then(delo);
  const rep = naslednji.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return naslednji;
}

async function zapisiAtomarno(root: string, pot: string, vsebina: string): Promise<void> {
  const tmp = path.join(root, `.${DATOTEKA_DNEVNIKA_FILTRA}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const rocaj = await open(tmp, "w", 0o600);
  try {
    await rocaj.writeFile(vsebina, "utf8");
    await rocaj.sync();
  } catch (napaka) {
    await rocaj.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw napaka;
  }
  await rocaj.close();
  try {
    await rename(tmp, pot);
  } catch (napaka) {
    await unlink(tmp).catch(() => undefined);
    throw napaka;
  }
}

/**
 * Zapise vrstico {"cas": ISO, "kategorije": {...}} v izhodni-filter.jsonl samo, ce je vsaj ena kategorija > 0.
 * Dovoljena so izkljucno pozitivna cela stevila za znane kategorije; izvirne vrednosti nikoli ne pridejo v dnevnik.
 */
export async function zapisiDnevnikFiltra(
  kategorije: Partial<Record<Kategorija, number>>,
  dir?: string,
  zdaj: Date = new Date(),
): Promise<boolean> {
  const ciste: Partial<Record<Kategorija, number>> = {};
  let imaNajdbo = false;
  for (const k of KATEGORIJE) {
    const vrednost = kategorije[k];
    if (typeof vrednost === "number" && Number.isFinite(vrednost) && vrednost > 0) {
      ciste[k] = Math.floor(vrednost);
      imaNajdbo = true;
    }
  }
  if (!imaNajdbo) return false;

  const root = resolveDataDir(dir);
  const vrstica = JSON.stringify({ cas: zdaj.toISOString(), kategorije: ciste });
  await vVrsti(root, async () => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const pot = path.join(root, DATOTEKA_DNEVNIKA_FILTRA);
    await appendFile(pot, `${vrstica}\n`, { encoding: "utf8", mode: 0o600 });
    const vsebina = await readFile(pot, "utf8");
    const vrstice = vsebina.split("\n").filter((v) => v.length > 0);
    if (vrstice.length > NAJVEC_VRSTIC_DNEVNIKA) {
      const obdrzane = vrstice.slice(-OBDRZI_VRSTIC_DNEVNIKA);
      await zapisiAtomarno(root, pot, `${obdrzane.join("\n")}\n`);
    }
  });
  return true;
}
