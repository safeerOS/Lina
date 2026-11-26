/**
 * Linin generator videa (lastnik 22. 11. 2026: »Video« - ob generatorju slik iz ideje Muse4AI, brez novega racuna). Vertex Veo prek
 * obstojecega projekta: predictLongRunning vrne ime operacije, fetchPredictOperation jo preverja, dokler ni koncana. Slovenski opis
 * prevedejo Linini mozgani (mediji-opis.server.ts). Video gre v isto knjiznico (slike.json, mapa slike/), samo lastnik, nikoli v klicih.
 * Vir API: Vertex AI Veo (durationSeconds za Veo 3: 4, 6 ali 8; generateAudio obvezen za Veo 3).
 * Naloga 20 (26. 11. 2026): Veo 3.1 NI opuscen - prava kratka zahteva (4 s, brez zvoka, us-central1) je uspela za oba modela:
 * fast 23,8 s / 470 kB, standard 56,2 s / 562 kB. Oblika odgovora operacije izmerjena: {name, done, response: {@type,
 * raiMediaFilteredCount, videos: [{bytesBase64Encoded, mimeType: "video/mp4"}]}} brez storageUri; ime operacije ima UUID.
 * Metapodatki modela (GET publishers/google/models/veo-*) vrnejo 404 tudi za delujoc model - merilo je samo prava zahteva.
 * NEPREVERJENO: poraba kreditov na sekundo videa. Komentarji brez sumnikov.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { vertexAccessToken } from "./adc.server.ts";
import { requireOwner } from "./auth.server.ts";
import { activeBrain } from "./keys.server.ts";
import { prevajalnikPoZahtevnosti, pripraviPoziv, type Prevajalnik } from "./mediji-opis.server.ts";
import { DATOTEKA_SLIK, MAPA_SLIK, NAJVEC_V_KNJIZNICI, NAJVEC_ZNAKOV_OPISA } from "./slike-generator.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/** Oba modela sta 26. 11. 2026 vrnila MP4 na pravo zahtevo (projekt lastnika, us-central1). */
export const MODELI_VIDEA_PREVERJENI = "2026-11-26";
export const MODELI_VIDEA = ["veo-3.1-fast-generate-001", "veo-3.1-generate-001"] as const;
export type ModelVidea = (typeof MODELI_VIDEA)[number];
export const PRIVZETI_MODEL_VIDEA: ModelVidea = "veo-3.1-fast-generate-001";
export const DOLZINE_VIDEA = [4, 6, 8] as const;
export { NAJVEC_BAJTOV_VIDEA } from "./slike-knjiznica.server.ts";
import { NAJVEC_BAJTOV_VIDEA } from "./slike-knjiznica.server.ts";
export const ROK_VIDEA_MS = 6 * 60_000;
export const PREMOR_POIZVEDBE_MS = 10_000;

export type ZapisVidea = { id: string; serija: string; cas: string; opis: string; poziv: string; prevedeno: boolean; model: ModelVidea; datoteka: string; bajtov: number; vrsta: "video"; sekund: number };

export type MoznostiVidea = {
  model?: unknown;
  sekund?: unknown;
  razmerje?: unknown;
  zvok?: unknown;
  serija?: unknown;
  fetch?: typeof fetch;
  zeton?: () => Promise<string>;
  projekt?: string;
  regija?: string;
  zdaj?: () => Date;
  nakljucno?: () => string;
  prevedi?: Prevajalnik;
  /** Drugi prepis govorjenega opisa iz lokalnega RSDO (dodatno mnenje); samo ko je opis narekovan. */
  namigRsdo?: string;
  /** Za preizkuse: cakanje med poizvedbami in skupni rok. */
  cakaj?: (ms: number) => Promise<void>;
  rokMs?: number;
  premorMs?: number;
};

const ID = /^[a-z0-9]{12}$/;

export function preveriVhodVidea(opis: unknown, m: Pick<MoznostiVidea, "model" | "sekund" | "razmerje" | "zvok" | "serija"> = {}): string | null {
  if (typeof opis !== "string" || !opis.trim()) return "Opis videa je prazen.";
  if (opis.length > NAJVEC_ZNAKOV_OPISA) return `Opis je predolg (najvec ${NAJVEC_ZNAKOV_OPISA} znakov).`;
  if (m.model !== undefined && !MODELI_VIDEA.includes(m.model as ModelVidea)) return "Neznan model videa.";
  if (m.sekund !== undefined && !DOLZINE_VIDEA.includes(m.sekund as 4)) return "Dolzina videa je lahko 4, 6 ali 8 sekund.";
  if (m.razmerje !== undefined && m.razmerje !== "16:9" && m.razmerje !== "9:16") return "Razmerje videa je lahko 16:9 ali 9:16.";
  if (m.zvok !== undefined && typeof m.zvok !== "boolean") return "Neveljavna nastavitev zvoka.";
  if (m.serija !== undefined && (typeof m.serija !== "string" || !ID.test(m.serija))) return "Neveljavna serija.";
  return null;
}

export function naslovVidea(projekt: string, regija: string, model: ModelVidea, dejanje: "predictLongRunning" | "fetchPredictOperation"): string {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projekt)) throw new Error("Neveljaven projekt Vertex.");
  if (!/^[a-z]+-[a-z]+[0-9]$/.test(regija)) throw new Error("Neveljavna regija Vertex.");
  return `https://${regija}-aiplatform.googleapis.com/v1/projects/${projekt}/locations/${regija}/publishers/google/models/${model}:${dejanje}`;
}

export function teloVidea(poziv: string, sekund: number, razmerje: string, zvok: boolean): unknown {
  return { instances: [{ prompt: poziv }], parameters: { sampleCount: 1, durationSeconds: sekund, aspectRatio: razmerje, generateAudio: zvok } };
}

/** Ime operacije mora pripadati istemu projektu, regiji in modelu (odgovor ponudnika ne sme preusmeriti poizvedbe drugam). */
export function veljavnaOperacija(ime: unknown, projekt: string, regija: string, model: ModelVidea): ime is string {
  if (typeof ime !== "string" || ime.length > 300) return false;
  const pred = `projects/${projekt}/locations/${regija}/publishers/google/models/${model}/operations/`;
  return ime.startsWith(pred) && /^[A-Za-z0-9-]{1,80}$/.test(ime.slice(pred.length));
}

/** Iz koncane operacije vzame MP4 (podpis »ftyp« na bajtih 4-8) ali null; napaka operacije vrze. */
export function razberiVideo(op: unknown): Buffer | null {
  const o = op as { done?: unknown; error?: { message?: unknown }; response?: { videos?: Array<{ bytesBase64Encoded?: unknown; mimeType?: unknown }> } };
  if (o?.error) throw new Error("Ponudnik videa je javil napako.");
  if (o?.done !== true) return null;
  const v = o.response?.videos?.[0];
  if (!v || typeof v.bytesBase64Encoded !== "string") throw new Error("Video ni bil ustvarjen (morda ga je zavrnil filter vsebine).");
  if (v.bytesBase64Encoded.length > Math.ceil((NAJVEC_BAJTOV_VIDEA * 4) / 3) + 4) throw new Error("Video je prevelik.");
  const b = Buffer.from(v.bytesBase64Encoded, "base64");
  if (b.length < 12 || b.subarray(4, 8).toString("latin1") !== "ftyp" || (v.mimeType !== undefined && v.mimeType !== "video/mp4")) throw new Error("Ponudnik ni vrnil videa MP4.");
  return b;
}

const nakljucniId = (): string => randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "a").slice(0, 12).padEnd(12, "a");

/** Ustvari video iz opisa (cakanje do nekaj minut) in ga shrani v knjiznico. Samo lastnik. */
export async function generirajVideo(opis: unknown, token: string | null, dir?: string, m: MoznostiVidea = {}): Promise<ZapisVidea> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const napaka = preveriVhodVidea(opis, m);
  if (napaka) throw new Error(napaka);
  const besedilo = (opis as string).trim();
  const model = (m.model as ModelVidea | undefined) ?? PRIVZETI_MODEL_VIDEA;
  const sekund = (m.sekund as number | undefined) ?? 8;
  const razmerje = (m.razmerje as string | undefined) ?? "16:9";
  const zvok = (m.zvok as boolean | undefined) ?? true;
  let projekt = m.projekt;
  if (!projekt) {
    const mozgani = await activeBrain(root);
    if (mozgani?.provider !== "vertex" || !mozgani.project) throw new Error("Za video je potreben projekt Vertex (Nastavitve > Mozgani).");
    projekt = mozgani.project;
  }
  const regija = m.regija ?? "us-central1";
  const zacetni = naslovVidea(projekt, regija, model, "predictLongRunning");
  const poizvedba = naslovVidea(projekt, regija, model, "fetchPredictOperation");
  const { poziv, prevedeno } = await pripraviPoziv(besedilo, root, m.prevedi ?? prevajalnikPoZahtevnosti(projekt, { fetch: m.fetch, zeton: m.zeton }), m.namigRsdo);
  const f = m.fetch ?? fetch;
  const zeton = await (m.zeton ?? (() => vertexAccessToken()))();
  const glave = { authorization: `Bearer ${zeton}`, "content-type": "application/json" };
  const odg = await f(zacetni, { method: "POST", redirect: "error", headers: glave, body: JSON.stringify(teloVidea(poziv, sekund, razmerje, zvok)), signal: AbortSignal.timeout(60_000) });
  if (!odg.ok) throw new Error(`Ponudnik videa je zavrnil zahtevo (${odg.status}).`);
  const ime = ((await odg.json().catch(() => null)) as { name?: unknown } | null)?.name;
  if (!veljavnaOperacija(ime, projekt, regija, model)) throw new Error("Ponudnik videa je vrnil neveljavno operacijo.");
  const cakaj = m.cakaj ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rok = Date.now() + (m.rokMs ?? ROK_VIDEA_MS);
  let video: Buffer | null = null;
  while (!video) {
    if (Date.now() > rok) throw new Error("Video ni bil pripravljen v roku.");
    await cakaj(m.premorMs ?? PREMOR_POIZVEDBE_MS);
    const p = await f(poizvedba, { method: "POST", redirect: "error", headers: glave, body: JSON.stringify({ operationName: ime }), signal: AbortSignal.timeout(60_000) });
    if (!p.ok) throw new Error(`Poizvedba videa je bila zavrnjena (${p.status}).`);
    const besediloOdg = await p.text();
    if (besediloOdg.length > Math.ceil((NAJVEC_BAJTOV_VIDEA * 4) / 3) + 65_536) throw new Error("Video je prevelik.");
    let op: unknown;
    try {
      op = JSON.parse(besediloOdg);
    } catch {
      throw new Error("Ponudnik videa je vrnil neveljaven odgovor.");
    }
    video = razberiVideo(op);
  }
  const mapa = path.join(root, MAPA_SLIK);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const nov = m.nakljucno ?? nakljucniId;
  const id = nov();
  const datoteka = `${id}.mp4`;
  const pot = path.join(mapa, datoteka);
  await writeFile(pot, video, { mode: 0o600, flag: "wx" });
  await chmod(pot, 0o600);
  const zapis: ZapisVidea = { id, serija: (m.serija as string | undefined) ?? nov(), cas: (m.zdaj ?? (() => new Date()))().toISOString(), opis: besedilo, poziv, prevedeno, model, datoteka, bajtov: video.length, vrsta: "video", sekund };
  let prej: unknown[] = [];
  try {
    const k = await readJsonFile<{ slike?: unknown[] }>(root, DATOTEKA_SLIK, { premakniPokvarjen: true });
    prej = Array.isArray(k?.slike) ? k.slike : [];
  } catch {
    prej = [];
  }
  await writeJson(root, DATOTEKA_SLIK, { slike: [zapis, ...prej].slice(0, NAJVEC_V_KNJIZNICI) });
  return zapis;
}
