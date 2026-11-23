/**
 * Strezniska shramba dovoljenih spletnih strani (strani-dovoljenja.json, pravice 0600).
 * - Brez privzetega seznama: na zacetku je prazen.
 * - Dodajanje in preklic zahtevata overjenega lastnika (requireOwner).
 * - Najvec 200 vnosov, brez podvojitev, atomarni zapis prek writeJson.
 * - Poskodovana datoteka (ni objekt, napacne vrste, neveljaven JSON) ne podre branja in se ne prepise,
 *   dokler uporabnik nicesar ne spremeni.
 */
import { requireOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import {
  jeObcutljivaStran,
  normirajIzvor,
  odlocitev,
  type DovoljenaStran,
  type OdlocitevStrani,
} from "./strani-dovoljenja.ts";

export const STRANI_DATOTEKA = "strani-dovoljenja.json";
export const STRANI_NAJVEC = 200;

type ShranjeneStrani = {
  strani: DovoljenaStran[];
};

function jeObjekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const vrste = new Map<string, Promise<unknown>>();

/** Zaporedno izvajanje zapisov po mapi, da dva hkratna klica ne izgubita sprememb. */
function vVrsti<T>(kljuc: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(kljuc) ?? Promise.resolve();
  const tek = prej.then(delo, delo);
  vrste.set(
    kljuc,
    tek.then(
      () => undefined,
      () => undefined,
    ),
  );
  return tek;
}

function razcleniSeznam(surovo: unknown): DovoljenaStran[] {
  if (!jeObjekt(surovo) || !Array.isArray(surovo.strani)) return [];
  const izid: DovoljenaStran[] = [];
  const videni = new Set<string>();
  for (const vnos of surovo.strani) {
    if (izid.length >= STRANI_NAJVEC) break;
    if (!jeObjekt(vnos)) continue;
    if (typeof vnos.izvor !== "string" || typeof vnos.dodano !== "string" || typeof vnos.obcutljiva !== "boolean") {
      continue;
    }
    const norm = normirajIzvor(vnos.izvor);
    if (!norm.ok || videni.has(norm.izvor)) continue;
    videni.add(norm.izvor);
    // Obcutljivost vedno preracunamo iz izvora: rocen poseg v datoteko je ne more izklopiti.
    izid.push({
      izvor: norm.izvor,
      dodano: vnos.dodano,
      obcutljiva: jeObcutljivaStran(norm.izvor),
    });
  }
  return izid;
}

async function preberiSeznam(root: string): Promise<DovoljenaStran[]> {
  let surovo: unknown;
  try {
    surovo = await readJsonFile<unknown>(root, STRANI_DATOTEKA);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  return razcleniSeznam(surovo);
}

/** Vrne seznam dovoljenih spletnih strani. Poskodovana datoteka vrne prazen seznam brez prepisa. */
export async function seznamStrani(dir?: string): Promise<DovoljenaStran[]> {
  const root = resolveDataDir(dir);
  const seznam = await preberiSeznam(root);
  return seznam.map((v) => ({ ...v }));
}

/**
 * Doda izvor med dovoljene strani (samo lastnik).
 * Isti izvor drugic ne podvoji vnosa. Najvec 200 vnosov, nato zavrne z razlogom.
 */
export async function dovoliStran(vnos: unknown, token: string | null, dir?: string): Promise<DovoljenaStran> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const norm = normirajIzvor(vnos);
  if (!norm.ok) throw new Error(norm.razlog);

  return vVrsti(root, async () => {
    const seznam = await preberiSeznam(root);
    const obstojeci = seznam.find((x) => x.izvor === norm.izvor);
    if (obstojeci) return { ...obstojeci };
    if (seznam.length >= STRANI_NAJVEC) throw new Error(t("straniMeja"));

    const nov: DovoljenaStran = {
      izvor: norm.izvor,
      dodano: new Date().toISOString(),
      obcutljiva: jeObcutljivaStran(norm.izvor),
    };
    const naslednji: ShranjeneStrani = { strani: [...seznam, nov] };
    await writeJson(root, STRANI_DATOTEKA, naslednji);
    return { ...nov };
  });
}

/** Odstrani izvor s seznama dovoljenih strani (samo lastnik). Vrne true, ce je bil odstranjen, sicer false. */
export async function preklicStran(izvor: unknown, token: string | null, dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const norm = normirajIzvor(izvor);
  if (!norm.ok) return false;

  return vVrsti(root, async () => {
    const seznam = await preberiSeznam(root);
    const ostali = seznam.filter((x) => x.izvor !== norm.izvor);
    if (ostali.length === seznam.length) return false;
    const naslednji: ShranjeneStrani = { strani: ostali };
    await writeJson(root, STRANI_DATOTEKA, naslednji);
    return true;
  });
}

/** Prebere shrambo in vrne odlocitev za podani izvor. */
export async function odlocitevZaStran(izvor: string, dir?: string): Promise<OdlocitevStrani> {
  const root = resolveDataDir(dir);
  const seznam = await preberiSeznam(root);
  return odlocitev(seznam, izvor);
}
