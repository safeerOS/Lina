/**
 * Linin generator slik (lastnik 21. 11. 2026: »sposodimo si samo idejo [Muse4AI] in naredimo svoj generator brez potrebnega racuna«).
 * Ideja iz Muse4AI (MIT, kode NE kopiramo): agent da opis, generator vrne sliko, vse ustvarjeno ostane v lokalni knjiznici z ID-jem,
 * da lahko asistentka nadaljuje niz (»serija«). Namesto tuje prijavljene seje uporabimo obstojeci projekt Vertex (Imagen), ki ga Lina
 * ze ima za mozgane - nov racun ni potreben. Samo lastnik (zeton), nikoli v klicih tajnice. Krediti Vertex so po lastniku brezplacni.
 * Vir API: Vertex AI Imagen API (predict, instances[].prompt, parameters.sampleCount, predictions[].bytesBase64Encoded).
 * NEPREVERJENO: regija (privzeto us-central1) in kakovost slovenskih opisov; prava zahteva se ni bila poslana. Komentarji brez sumnikov.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { vertexAccessToken } from "./adc.server.ts";
import { requireOwner } from "./auth.server.ts";
import { prevajalnikPoZahtevnosti, pripraviPoziv, type Prevajalnik } from "./mediji-opis.server.ts";
import { activeBrain } from "./keys.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_SLIK = "slike.json";
export const MAPA_SLIK = "slike";
export const MODELI_SLIK = ["imagen-4.0-generate-001", "imagen-4.0-fast-generate-001", "imagen-4.0-ultra-generate-001"] as const;
export type ModelSlike = (typeof MODELI_SLIK)[number];
export const PRIVZETI_MODEL_SLIK: ModelSlike = "imagen-4.0-fast-generate-001";
export const NAJVEC_ZNAKOV_OPISA = 2000;
export const NAJVEC_SLIK_NA_ZAHTEVO = 4;
export const NAJVEC_BAJTOV_SLIKE = 10 * 1024 * 1024;
export const NAJVEC_V_KNJIZNICI = 500;
export const ROK_ZAHTEVE_MS = 60_000;
const RAZMERJA = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;

export type ZapisSlike = { id: string; serija: string; cas: string; opis: string; poziv: string; prevedeno: boolean; model: ModelSlike; datoteka: string; bajtov: number };
export type Knjiznica = { slike: ZapisSlike[] };
export type IzidGeneriranja = { slike: ZapisSlike[]; zavrnjenih: number };

export type MoznostiGeneriranja = {
  model?: unknown;
  stevilo?: unknown;
  razmerje?: unknown;
  serija?: unknown;
  /** Za preizkuse: lazni fetch, zeton, projekt, regija, ura in nakljucni ID. */
  fetch?: typeof fetch;
  zeton?: () => Promise<string>;
  projekt?: string;
  regija?: string;
  zdaj?: () => Date;
  nakljucno?: () => string;
  /** Prevod slovenskega opisa v angleski poziv (privzeto Linini mozgani; mediji-opis.server.ts). */
  prevedi?: Prevajalnik;
  /** Drugi prepis govorjenega opisa iz lokalnega RSDO (dodatno mnenje); samo ko je opis narekovan. */
  namigRsdo?: string;
};

const ID = /^[a-z0-9]{12}$/;

/** Ciste preverbe vhoda (brez diska in omrezja). Vrne napako v slovenscini ali null. */
export function preveriVhodSlike(opis: unknown, m: Pick<MoznostiGeneriranja, "model" | "stevilo" | "razmerje" | "serija"> = {}): string | null {
  if (typeof opis !== "string" || !opis.trim()) return "Opis slike je prazen.";
  if (opis.length > NAJVEC_ZNAKOV_OPISA) return `Opis je predolg (najvec ${NAJVEC_ZNAKOV_OPISA} znakov).`;
  if (m.model !== undefined && !MODELI_SLIK.includes(m.model as ModelSlike)) return "Neznan model slik.";
  if (m.stevilo !== undefined && !(Number.isInteger(m.stevilo) && (m.stevilo as number) >= 1 && (m.stevilo as number) <= NAJVEC_SLIK_NA_ZAHTEVO)) {
    return `Stevilo slik mora biti od 1 do ${NAJVEC_SLIK_NA_ZAHTEVO}.`;
  }
  if (m.razmerje !== undefined && !RAZMERJA.includes(m.razmerje as (typeof RAZMERJA)[number])) return "Neznano razmerje slike.";
  if (m.serija !== undefined && (typeof m.serija !== "string" || !ID.test(m.serija))) return "Neveljavna serija.";
  return null;
}

/** Naslov zahteve Imagen (regionalni predict). Projekt in regija sta omejena na varne znake (brez vrivanja poti). */
export function naslovSlik(projekt: string, regija: string, model: ModelSlike): string {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projekt)) throw new Error("Neveljaven projekt Vertex.");
  if (!/^[a-z]+-[a-z]+[0-9]$/.test(regija)) throw new Error("Neveljavna regija Vertex.");
  return `https://${regija}-aiplatform.googleapis.com/v1/projects/${projekt}/locations/${regija}/publishers/google/models/${model}:predict`;
}

/** Telo zahteve Imagen. */
export function teloSlik(opis: string, stevilo: number, razmerje: string): unknown {
  return { instances: [{ prompt: opis }], parameters: { sampleCount: stevilo, aspectRatio: razmerje } };
}

/** Iz odgovora Imagen vzame slike PNG/JPEG; slika brez bajtov (filter odgovorne UI) ali prevelika se steje kot zavrnjena. */
export function razberiSlike(odgovor: unknown): { slike: Array<{ bajti: Buffer; mime: string }>; zavrnjenih: number } {
  const napovedi = (odgovor as { predictions?: unknown })?.predictions;
  if (!Array.isArray(napovedi)) return { slike: [], zavrnjenih: 0 };
  const slike: Array<{ bajti: Buffer; mime: string }> = [];
  let zavrnjenih = 0;
  for (const n of napovedi) {
    const b64 = (n as { bytesBase64Encoded?: unknown })?.bytesBase64Encoded;
    const mime = (n as { mimeType?: unknown })?.mimeType;
    if (typeof b64 !== "string" || !b64 || b64.length > Math.ceil((NAJVEC_BAJTOV_SLIKE * 4) / 3) + 4) {
      zavrnjenih += 1;
      continue;
    }
    const bajti = Buffer.from(b64, "base64");
    const png = bajti.length > 8 && bajti.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpg = bajti.length > 3 && bajti[0] === 0xff && bajti[1] === 0xd8 && bajti[2] === 0xff;
    if (!(png || jpg) || bajti.length > NAJVEC_BAJTOV_SLIKE || (mime !== undefined && mime !== "image/png" && mime !== "image/jpeg")) {
      zavrnjenih += 1;
      continue;
    }
    slike.push({ bajti, mime: png ? "image/png" : "image/jpeg" });
  }
  return { slike, zavrnjenih };
}

const nakljucniId = (): string => randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "a").slice(0, 12).padEnd(12, "a");

/** Knjiznica slik (samo lastnik). */
export async function knjiznicaSlik(token: string | null, dir?: string): Promise<Knjiznica> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return preberi(root);
}

async function preberi(root: string): Promise<Knjiznica> {
  try {
    const k = await readJsonFile<Knjiznica>(root, DATOTEKA_SLIK, { premakniPokvarjen: true });
    return { slike: Array.isArray(k?.slike) ? k.slike.filter((s) => s && typeof s.id === "string" && ID.test(s.id)) : [] };
  } catch {
    return { slike: [] };
  }
}

/** Ustvari slike iz opisa in jih shrani v knjiznico (podatki/slike/<id>.png, 0600). Samo lastnik. */
export async function generirajSliko(opis: unknown, token: string | null, dir?: string, m: MoznostiGeneriranja = {}): Promise<IzidGeneriranja> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const napaka = preveriVhodSlike(opis, m);
  if (napaka) throw new Error(napaka);
  const besedilo = (opis as string).trim();
  const model = (m.model as ModelSlike | undefined) ?? PRIVZETI_MODEL_SLIK;
  const stevilo = (m.stevilo as number | undefined) ?? 1;
  const razmerje = (m.razmerje as string | undefined) ?? "1:1";
  let projekt = m.projekt;
  if (!projekt) {
    const mozgani = await activeBrain(root);
    if (mozgani?.provider !== "vertex" || !mozgani.project) throw new Error("Za slike je potreben projekt Vertex (Nastavitve > Mozgani).");
    projekt = mozgani.project;
  }
  const url = naslovSlik(projekt, m.regija ?? "us-central1", model);
  const { poziv, prevedeno } = await pripraviPoziv(besedilo, root, m.prevedi ?? prevajalnikPoZahtevnosti(projekt, { fetch: m.fetch, zeton: m.zeton }), m.namigRsdo);
  const zeton = await (m.zeton ?? (() => vertexAccessToken()))();
  const odg = await (m.fetch ?? fetch)(url, {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${zeton}`, "content-type": "application/json" },
    body: JSON.stringify(teloSlik(poziv, stevilo, razmerje)),
    signal: AbortSignal.timeout(ROK_ZAHTEVE_MS),
  });
  if (!odg.ok) throw new Error(`Ponudnik slik je zavrnil zahtevo (${odg.status}).`);
  const besediloOdg = await odg.text();
  if (besediloOdg.length > NAJVEC_SLIK_NA_ZAHTEVO * Math.ceil((NAJVEC_BAJTOV_SLIKE * 4) / 3) + 65_536) throw new Error("Odgovor ponudnika slik je prevelik.");
  let json: unknown;
  try {
    json = JSON.parse(besediloOdg);
  } catch {
    throw new Error("Ponudnik slik je vrnil neveljaven odgovor.");
  }
  const { slike, zavrnjenih } = razberiSlike(json);
  const mapa = path.join(root, MAPA_SLIK);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const nov = m.nakljucno ?? nakljucniId;
  const serija = (m.serija as string | undefined) ?? nov();
  const cas = (m.zdaj ?? (() => new Date()))().toISOString();
  const zapisi: ZapisSlike[] = [];
  for (const s of slike) {
    const id = nov();
    const datoteka = `${id}${s.mime === "image/png" ? ".png" : ".jpg"}`;
    const pot = path.join(mapa, datoteka);
    await writeFile(pot, s.bajti, { mode: 0o600, flag: "wx" });
    await chmod(pot, 0o600);
    zapisi.push({ id, serija, cas, opis: besedilo, poziv, prevedeno, model, datoteka, bajtov: s.bajti.length });
  }
  if (zapisi.length) {
    const k = await preberi(root);
    // Najnovejse na vrhu; knjiznica ima mejo (stare datoteke ostanejo na disku - brisanje samo po ukazu lastnika).
    await writeJson(root, DATOTEKA_SLIK, { slike: [...zapisi, ...k.slike].slice(0, NAJVEC_V_KNJIZNICI) });
  }
  return { slike: zapisi, zavrnjenih };
}
