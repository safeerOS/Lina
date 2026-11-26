/**
 * Naloga 20: branje Linine knjiznice slik in videov BREZ generatorja. Pot telefona (asistent-streznik.server.ts) ga uvaza, generator pa
 * ne sme biti dosegljiv s poti telefona (prek mediji-opis vleče live/ = pot klica; zaklep v kanal-claude.test.ts 4.4).
 * Preverbo lastnika ali naprave naredi klicatelj. Komentarji brez sumnikov.
 */
import { readJsonFile } from "./store.server.ts";

export const DATOTEKA_SLIK = "slike.json";
export const MAPA_SLIK = "slike";
export const NAJVEC_BAJTOV_SLIKE = 10 * 1024 * 1024;
export const NAJVEC_BAJTOV_VIDEA = 60 * 1024 * 1024;

const ID = /^[a-z0-9]{12}$/;

/** model je oznaka (string): starejsi zapisi v knjiznici imajo se modele Imagen. Video ima se vrsta in sekund. */
export type ZapisSlike = { id: string; serija: string; cas: string; opis: string; poziv: string; prevedeno: boolean; model: string; datoteka: string; bajtov: number };
export type Knjiznica = { slike: ZapisSlike[] };

/** Branje knjiznice BREZ preverbe lastnika: samo za klicatelje, ki so lastnika ali napravo ze preverili. Pokvarjena = prazna. */
export async function preberiKnjiznico(root: string): Promise<Knjiznica> {
  try {
    const k = await readJsonFile<Knjiznica>(root, DATOTEKA_SLIK, { premakniPokvarjen: true });
    return { slike: Array.isArray(k?.slike) ? k.slike.filter((s) => s && typeof s.id === "string" && ID.test(s.id)) : [] };
  } catch {
    return { slike: [] };
  }
}
