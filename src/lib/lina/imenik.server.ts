import { randomUUID } from "node:crypto";
import { requireOwner } from "./auth.server.ts";
import { MEJA_STIKOV, normalizirajTelefon, ocistiStik, type StikImenik, type VhodStika } from "./imenik.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/** Imenik uporabnika: samo lokalno (imenik.json); vsak klic zahteva prijavo lastnika. */
const DATOTEKA = "imenik.json";

let veriga: Promise<unknown> = Promise.resolve();
function vVrsti<T>(delo: () => Promise<T>): Promise<T> {
  const rezultat = veriga.then(delo, delo);
  veriga = rezultat.catch(() => undefined);
  return rezultat;
}

async function preberi(root: string): Promise<StikImenik[]> {
  const s = await readJsonFile<unknown>(root, DATOTEKA);
  if (!Array.isArray(s)) return [];
  return s
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).id === "string" && typeof (x as Record<string, unknown>).ime === "string" && typeof (x as Record<string, unknown>).telefon === "string")
    .map((x) => ({
      id: String(x.id),
      ime: String(x.ime),
      telefon: normalizirajTelefon(String(x.telefon)),
      opomba: typeof x.opomba === "string" ? x.opomba : "",
      ustvarjeno: typeof x.ustvarjeno === "string" ? x.ustvarjeno : new Date(0).toISOString(),
    }));
}

const urejen = (a: StikImenik[]) => a.slice().sort((x, y) => x.ime.localeCompare(y.ime, "sl"));

export async function imenikSeznam(token: string | null, dir?: string): Promise<StikImenik[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return urejen(await preberi(root));
}

type Izid = { ok: true; stiki: StikImenik[] } | { ok: false; sporocilo: string };

/** Shrani stik; ista stevilka posodobi obstojeci stik (brez podvojenih). */
export async function imenikShrani(vhod: VhodStika, token: string | null, dir?: string): Promise<Izid> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const o = ocistiStik(vhod);
    if (typeof o === "string") return { ok: false as const, sporocilo: o };
    const stiki = await preberi(root);
    const i = stiki.findIndex((s) => s.telefon === o.telefon);
    if (i >= 0) stiki[i] = { ...stiki[i], ...o };
    else if (stiki.length >= MEJA_STIKOV) return { ok: false as const, sporocilo: `V imeniku je največ ${MEJA_STIKOV} stikov.` };
    else stiki.push({ id: randomUUID(), ...o, ustvarjeno: new Date().toISOString() });
    await writeJson(root, DATOTEKA, stiki);
    return { ok: true as const, stiki: urejen(stiki) };
  });
}

export async function imenikIzbrisi(id: string, token: string | null, dir?: string): Promise<Izid> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return vVrsti(async () => {
    const stiki = (await preberi(root)).filter((s) => s.id !== id);
    await writeJson(root, DATOTEKA, stiki);
    return { ok: true as const, stiki: urejen(stiki) };
  });
}
