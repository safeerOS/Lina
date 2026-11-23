/**
 * Revizijska veriga na disku (naloga #45): datoteka revizija.jsonl v podatkovni mapi lastnika (dovoljenja 600), en vnos
 * na vrstico, samo dodajanje. Zapisi so zaporedni (vrsta po mapi), pred vsakim zapisom se cela veriga preveri: pokvarjena
 * veriga ZAVRNE nov zapis (nic se ne prepise, nic se ne premakne), lastnik pa jo vidi pri branju.
 * Zapis nikoli ne vrze: klicatelj (npr. shranjevanje kataloga) zaradi dnevnika ne sme odpovedati.
 * Branje je samo za lastnika. Komentarji so brez sumnikov.
 */
import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { preveriVerigo, sestaviVnos, sidroIzVerige, type IzidPreverbe, type Sidro, type VhodVnosa, type Vnos } from "./revizija.ts";
import { resolveDataDir } from "./store.server.ts";

export const DATOTEKA_REVIZIJE = "revizija.jsonl";
export const NAJVEC_BAJTOV_REVIZIJE = 5_000_000;
export const PRIVZETO_STEVILO_VNOSOV = 50;
export const NAJVEC_STEVILO_VNOSOV = 500;

export type IzidZapisa = { ok: true; n: number; zgoscena: string } | { ok: false; razlog: string };

const vrste = new Map<string, Promise<unknown>>();

async function vVrsti<T>(kljuc: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(kljuc) ?? Promise.resolve();
  const to = prej.then(delo, delo);
  const rep = to.catch(() => undefined);
  vrste.set(kljuc, rep);
  try {
    return await to;
  } finally {
    if (vrste.get(kljuc) === rep) vrste.delete(kljuc);
  }
}

type Prebrano = { ok: true; vnosi: Vnos[] } | { ok: false };

/** Vsaka vrstica mora biti veljaven JSON; prazna vrstica sredi datoteke ali nedokoncana zadnja vrstica je pokvarjena. */
async function preberiVnose(root: string): Promise<Prebrano> {
  let besedilo: string;
  try {
    besedilo = await readFile(path.join(root, DATOTEKA_REVIZIJE), "utf8");
  } catch (napaka) {
    if ((napaka as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, vnosi: [] };
    return { ok: false };
  }
  if (besedilo === "") return { ok: true, vnosi: [] };
  if (!besedilo.endsWith("\n")) return { ok: false };
  const vrstice = besedilo.slice(0, -1).split("\n");
  const vnosi: Vnos[] = [];
  for (const vrstica of vrstice) {
    try {
      vnosi.push(JSON.parse(vrstica) as Vnos);
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, vnosi };
}

/** Doda vnos na konec verige. Ne vrze; razlog ob zavrnitvi: veriga-pokvarjena, polna, zapis ali razlog sestave. */
export async function zapisiRevizijo(
  root: string,
  vhod: VhodVnosa,
  zdaj: Date = new Date(),
  moznosti: { najvecBajtov?: number } = {},
): Promise<IzidZapisa> {
  const meja = moznosti.najvecBajtov ?? NAJVEC_BAJTOV_REVIZIJE;
  try {
    return await vVrsti(root, async (): Promise<IzidZapisa> => {
      const pot = path.join(root, DATOTEKA_REVIZIJE);
      const velikost = await stat(pot).then((s) => s.size).catch(() => 0);
      if (velikost > meja) return { ok: false, razlog: "polna" };
      const prebrano = await preberiVnose(root);
      if (!prebrano.ok || !preveriVerigo(prebrano.vnosi).ok) return { ok: false, razlog: "veriga-pokvarjena" };
      const izid = sestaviVnos(prebrano.vnosi[prebrano.vnosi.length - 1] ?? null, vhod, zdaj);
      if (!izid.ok) return { ok: false, razlog: izid.razlog };
      await appendFile(pot, `${JSON.stringify(izid.vnos)}\n`, { encoding: "utf8", mode: 0o600 });
      return { ok: true, n: izid.vnos.n, zgoscena: izid.vnos.zgoscena };
    });
  } catch {
    return { ok: false, razlog: "zapis" };
  }
}

export type PregledRevizije = { preverba: IzidPreverbe; vnosi: Vnos[]; sidro: Sidro | null };

/**
 * Samo lastnik. Vrne preverbo cele verige (po potrebi proti sidru, ki ga je lastnik izvozil prej), zadnjih n vnosov
 * (najnovejsi prvi) in trenutno sidro za izvoz.
 */
export async function preberiRevizijo(
  token: string | null,
  dir?: string,
  moznosti: { n?: number; sidro?: Sidro } = {},
): Promise<PregledRevizije> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const prebrano = await preberiVnose(root);
  if (!prebrano.ok) return { preverba: { ok: false, n: 0, razlog: "oblika" }, vnosi: [], sidro: null };
  const zeljeno = moznosti.n !== undefined && Number.isFinite(moznosti.n) ? Math.trunc(moznosti.n) : PRIVZETO_STEVILO_VNOSOV;
  const st = Math.min(NAJVEC_STEVILO_VNOSOV, Math.max(1, zeljeno));
  return {
    preverba: preveriVerigo(prebrano.vnosi, moznosti.sidro),
    vnosi: prebrano.vnosi.slice(-st).reverse(),
    sidro: sidroIzVerige(prebrano.vnosi),
  };
}
