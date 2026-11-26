/**
 * Naloga 20: branje Linine knjiznice slik in videov BREZ generatorja. Pot telefona (asistent-streznik.server.ts) ga uvaza, generator pa
 * ne sme biti dosegljiv s poti telefona (prek mediji-opis vleče live/ = pot klica; zaklep v kanal-claude.test.ts 4.4).
 * Preverbo lastnika ali naprave naredi klicatelj. Komentarji brez sumnikov.
 */
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJson } from "./store.server.ts";

export const DATOTEKA_SLIK = "slike.json";
export const MAPA_SLIK = "slike";
export const NAJVEC_BAJTOV_SLIKE = 10 * 1024 * 1024;
export const NAJVEC_BAJTOV_VIDEA = 60 * 1024 * 1024;
export const NAJVEC_V_KNJIZNICI = 500;

const ID = /^[a-z0-9]{12}$/;

/** model je oznaka (string): starejsi zapisi v knjiznici imajo se modele Imagen. Video ima se vrsta in sekund. */
export type ZapisSlike = { id: string; serija: string; cas: string; opis: string; poziv: string; prevedeno: boolean; model: string; datoteka: string; bajtov: number };
export type Knjiznica = { slike: ZapisSlike[] };

/** Branje knjiznice BREZ preverbe lastnika: samo za klicatelje, ki so lastnika ali napravo ze preverili. Pokvarjena = prazna. */
export async function preberiKnjiznico(root: string, { premakniPokvarjen = true } = {}): Promise<Knjiznica> {
  try {
    const k = await readJsonFile<Knjiznica>(root, DATOTEKA_SLIK, { premakniPokvarjen });
    return { slike: Array.isArray(k?.slike) ? k.slike.filter((s) => s && typeof s.id === "string" && ID.test(s.id)) : [] };
  } catch {
    return { slike: [] };
  }
}

/** Mapa medijev: ustvari jo (0700), ce je ni; povezava ali ne-mapa = napaka (pisanje in branje ne gresta drugam). */
export async function mapaKnjiznice(root: string): Promise<string> {
  const mapa = path.join(root, MAPA_SLIK);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const st = await lstat(mapa);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Mapa slik ni navadna mapa.");
  return mapa;
}

/** Pisanje v slike.json po vrsti za vsak koren: socasna generiranja (lastnik in naloga) ne izgubita zapisa. */
const vrste = new Map<string, Promise<unknown>>();
export function dodajVKnjiznico(root: string, novi: unknown[]): Promise<void> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.catch(() => undefined).then(async () => {
    const k = await readJsonFile<{ slike?: unknown[] }>(root, DATOTEKA_SLIK, { premakniPokvarjen: true }).catch(() => null);
    const stari = Array.isArray(k?.slike) ? k.slike : [];
    // Najnovejse na vrhu; knjiznica ima mejo (stare datoteke ostanejo na disku - brisanje samo po ukazu lastnika).
    await writeJson(root, DATOTEKA_SLIK, { slike: [...novi, ...stari].slice(0, NAJVEC_V_KNJIZNICI) });
  });
  vrste.set(root, zdaj);
  void zdaj.finally(() => vrste.get(root) === zdaj && vrste.delete(root)).catch(() => undefined);
  return zdaj;
}
