/**
 * Naloga 20: branje Linine knjiznice slik in videov BREZ generatorja. Pot telefona (asistent-streznik.server.ts) ga uvaza, generator pa
 * ne sme biti dosegljiv s poti telefona (prek mediji-opis vleče live/ = pot klica; zaklep v kanal-claude.test.ts 4.4).
 * Preverbo lastnika ali naprave naredi klicatelj. Komentarji brez sumnikov.
 */
import { randomBytes } from "node:crypto";
import { lstat, mkdir, rename } from "node:fs/promises";
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

/**
 * Naloga 21 (N9): pokvarjena knjiznica gre v slike.json.pokvarjen-<cas>-<nakljucno> - vsaka pokvarjenost svojo kopijo, prejsnja se ne prepise
 * (skupni readJsonFile bi pisal vedno v isto .pokvarjen).
 */
async function odloziPokvarjeno(root: string): Promise<void> {
  await rename(path.join(root, DATOTEKA_SLIK), path.join(root, `${DATOTEKA_SLIK}.pokvarjen-${Date.now()}-${randomBytes(3).toString("hex")}`));
}

/** Branje slike.json: JSON, ki ni objekt, ali neveljaven JSON = pokvarjen (ob premakni se odlozi); napaka branja gre klicatelju. */
async function beriKnjiznico(root: string, premakni: boolean): Promise<{ slike?: unknown } | null> {
  let k: unknown;
  try {
    k = await readJsonFile<unknown>(root, DATOTEKA_SLIK);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    k = "pokvarjeno";
  }
  if (k === null) return null;
  if (typeof k === "object" && !Array.isArray(k) && Array.isArray((k as { slike?: unknown }).slike)) return k as { slike?: unknown };
  if (premakni) await odloziPokvarjeno(root); // neuspel premik = napaka (zapis ne prepise edine kopije)
  return null;
}

/** Branje knjiznice BREZ preverbe lastnika: samo za klicatelje, ki so lastnika ali napravo ze preverili. Pokvarjena = prazna. */
export async function preberiKnjiznico(root: string, { premakniPokvarjen = true } = {}): Promise<Knjiznica> {
  try {
    const k = (await beriKnjiznico(root, premakniPokvarjen)) as Knjiznica | null;
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
export function dodajVKnjiznico(root: string, novi: unknown[], signal?: AbortSignal): Promise<void> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.catch(() => undefined).then(async () => {
    // Napaka branja (EACCES, EIO, EMFILE) gre klicatelju: prazna knjiznica bi ob zapisu tiho izbrisala stare zapise.
    const k = await beriKnjiznico(root, true);
    const stari = Array.isArray(k?.slike) ? k.slike : [];
    // ustavljena naloga ne objavi (tudi ce je prekinitev prisla med cakanjem v vrsti)
    signal?.throwIfAborted();
    // Najnovejse na vrhu; knjiznica ima mejo (stare datoteke ostanejo na disku - brisanje samo po ukazu lastnika).
    await writeJson(root, DATOTEKA_SLIK, { slike: [...novi, ...stari].slice(0, NAJVEC_V_KNJIZNICI) });
  });
  vrste.set(root, zdaj);
  void zdaj.finally(() => vrste.get(root) === zdaj && vrste.delete(root)).catch(() => undefined);
  return zdaj;
}
