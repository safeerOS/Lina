/**
 * Branje ustvarjene slike ali videa za vmesnik (okno Slike in video, Lina 2.0). Samo lastnik (zeton seje). ID mora biti iz knjiznice
 * (slike.json), ime datoteke mora ustrezati vzorcu <12 znakov>.(png|jpg|mp4), datoteka mora biti navadna (ne povezava) in znotraj
 * meje velikosti. Vrne data URL, zato ni nove poti streznika. Komentarji so brez sumnikov.
 */
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { MAPA_SLIK, NAJVEC_BAJTOV_SLIKE, knjiznicaSlik } from "./slike-generator.server.ts";
import { resolveDataDir } from "./store.server.ts";
import { NAJVEC_BAJTOV_VIDEA } from "./video-generator.server.ts";

const ID = /^[a-z0-9]{12}$/;
const DATOTEKA = /^[a-z0-9]{12}\.(png|jpg|mp4)$/;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", mp4: "video/mp4" };

export type MedijPodatki = { id: string; mime: string; podatki: string };

export async function preberiMedij(id: unknown, token: string | null, dir?: string): Promise<MedijPodatki> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Neveljaven ID.");
  const zapis = (await knjiznicaSlik(token, root)).slike.find((s) => s.id === id);
  if (!zapis || typeof zapis.datoteka !== "string" || !DATOTEKA.test(zapis.datoteka)) throw new Error("Medija ni v knjiznici.");
  const pripona = zapis.datoteka.split(".")[1] ?? "";
  const pot = path.join(root, MAPA_SLIK, zapis.datoteka);
  const st = await lstat(pot);
  if (!st.isFile()) throw new Error("Datoteka ni navadna.");
  if (st.size > (pripona === "mp4" ? NAJVEC_BAJTOV_VIDEA : NAJVEC_BAJTOV_SLIKE)) throw new Error("Datoteka je prevelika.");
  const mime = MIME[pripona] ?? "application/octet-stream";
  return { id, mime, podatki: `data:${mime};base64,${(await readFile(pot)).toString("base64")}` };
}
