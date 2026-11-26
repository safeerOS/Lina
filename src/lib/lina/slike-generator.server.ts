/**
 * Linin generator slik (lastnik 21. 11. 2026: »sposodimo si samo idejo [Muse4AI] in naredimo svoj generator brez potrebnega racuna«).
 * Ideja iz Muse4AI (MIT, kode NE kopiramo): agent da opis, generator vrne sliko, vse ustvarjeno ostane v lokalni knjiznici z ID-jem,
 * da lahko asistentka nadaljuje niz (»serija«). Uporabimo obstojeci projekt Vertex, ki ga Lina ze ima za mozgane - nov racun ni
 * potreben. Samo lastnik (zeton seje) ali orodje orkestratorja (ustvariSliko), nikoli v klicih tajnice. Krediti Vertex so po lastniku
 * brezplacni.
 * Naloga 20 (26. 11. 2026): Imagen je ugasnjen (Google 24. 6. 2026; na Vertex 404). Zamenjava: modeli Gemini image prek generateContent
 * na lokaciji global. Prave zahteve 26. 11. 2026 (dnevniki naloge 20): ena slika na zahtevo (candidateCount > 1 = 400), slika je del
 * inlineData (PNG ali JPEG), pro in nano-banana najprej vrneta se »miselno« sliko (thought: true), ki se ne shrani.
 * NEPREVERJENO: oblika pravega odgovora ob zavrnitvi (filter) - obravnavano kot »ni slike«. Komentarji brez sumnikov.
 */
import { randomBytes } from "node:crypto";
import { chmod, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { vertexAccessToken } from "./adc.server.ts";
import { requireOwner } from "./auth.server.ts";
import { prevajalnikPoZahtevnosti, pripraviPoziv, teloZMejo, type Prevajalnik } from "./mediji-opis.server.ts";
import { activeBrain } from "./keys.server.ts";
import {
  DATOTEKA_SLIK, MAPA_SLIK, NAJVEC_BAJTOV_SLIKE, NAJVEC_V_KNJIZNICI, dodajVKnjiznico, mapaKnjiznice, preberiKnjiznico, type Knjiznica, type ZapisSlike,
} from "./slike-knjiznica.server.ts";
import { resolveDataDir } from "./store.server.ts";

// Knjiznica je v slike-knjiznica.server.ts (pot telefona jo bere brez generatorja); ponovni izvoz za obstojece klicatelje.
export { DATOTEKA_SLIK, MAPA_SLIK, NAJVEC_BAJTOV_SLIKE, NAJVEC_V_KNJIZNICI, dodajVKnjiznico, mapaKnjiznice, preberiKnjiznico, teloZMejo, type Knjiznica, type ZapisSlike };
/** Datum, ko je vsak model spodaj odgovoril na pravo zahtevo generateContent s sliko (projekt lastnika, lokacija global). */
export const MODELI_PREVERJENI = "2026-11-26";
/** Cas odgovora 26. 11. 2026: flash-lite 4,2 s (JPEG), 2.5-flash 5,8 s, flash 11,6 s, nano-banana-2.1 12,6 s, pro 16,4 s. */
export const MODELI_SLIK = ["gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image", "gemini-nano-banana-2.1", "gemini-2.5-flash-image"] as const;
export type ModelSlike = (typeof MODELI_SLIK)[number];
export const PRIVZETI_MODEL_SLIK: ModelSlike = "gemini-3.1-flash-image";
export const KAKOVOSTI_SLIK = ["hitri", "standard", "ultra"] as const;
export type KakovostSlike = (typeof KAKOVOSTI_SLIK)[number];
export const MODEL_PO_KAKOVOSTI: Record<KakovostSlike, ModelSlike> = { hitri: "gemini-3.1-flash-lite-image", standard: "gemini-3.1-flash-image", ultra: "gemini-3-pro-image" };
export const NAJVEC_ZNAKOV_OPISA = 2000;
/** B9 (lastnik 26. 11. 2026): neuspel prevod prek Googla - opis ne gre drugam in slike ni (orodje ustvari_sliko vrne ta stavek). */
export const PREVOD_SLIKE_NI_USPEL = "Prevod opisa ni uspel, slika ni ustvarjena.";
export const NAJVEC_SLIK_NA_ZAHTEVO = 4;
export const ROK_ZAHTEVE_MS = 60_000;
export const RAZMERJA_SLIK = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;

export type IzidGeneriranja = { slike: ZapisSlike[]; zavrnjenih: number };

export type MoznostiGeneriranja = {
  model?: unknown;
  stevilo?: unknown;
  razmerje?: unknown;
  serija?: unknown;
  /** Za preizkuse: lazni fetch, zeton, projekt, ura in nakljucni ID. */
  fetch?: typeof fetch;
  zeton?: () => Promise<string>;
  projekt?: string;
  /** Prekinitev od klicatelja (orodje orkestratorja: rok in ustavitev naloge). */
  signal?: AbortSignal;
  zdaj?: () => Date;
  nakljucno?: () => string;
  /** Prevod slovenskega opisa v angleski poziv (privzeto Google v lastnikovem projektu; mediji-opis.server.ts). */
  prevedi?: Prevajalnik;
  /** Drugi prepis govorjenega opisa iz lokalnega RSDO; Googlov prevajalnik ga ne uporablja (naloga 30: mozganov ni vec v verigi). */
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
  if (m.razmerje !== undefined && !RAZMERJA_SLIK.includes(m.razmerje as (typeof RAZMERJA_SLIK)[number])) return "Neznano razmerje slike.";
  if (m.serija !== undefined && (typeof m.serija !== "string" || !ID.test(m.serija))) return "Neveljavna serija.";
  return null;
}

/** Naslov generateContent na lokaciji global (izmerjeno 26. 11. 2026). Projekt je omejen na varne znake (brez vrivanja poti). */
export function naslovSlik(projekt: string, model: ModelSlike): string {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projekt)) throw new Error("Neveljaven projekt Vertex.");
  return `https://aiplatform.googleapis.com/v1/projects/${projekt}/locations/global/publishers/google/models/${model}:generateContent`;
}

/** Telo zahteve: ena slika (candidateCount 1; vec vrne 400), razmerje v imageConfig. */
export function teloSlik(poziv: string, razmerje: string): unknown {
  return {
    contents: [{ role: "user", parts: [{ text: poziv }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], candidateCount: 1, imageConfig: { aspectRatio: razmerje } },
  };
}

const B64_SLIKE = Math.ceil((NAJVEC_BAJTOV_SLIKE * 4) / 3) + 4;
/** Najvecji odgovor ene zahteve: miselna in koncna slika (base64) ter besedilo. */
const NAJVEC_ZNAKOV_ODGOVORA = 2 * B64_SLIKE + 65_536;

/**
 * Iz odgovora generateContent vzame prvo koncno sliko PNG/JPEG (del inlineData brez thought). Besedilo modela se zavrze. Brez veljavne
 * slike (filter, samo besedilo, ne-slika, napacen mime, prevelika) je zahteva zavrnjena (zavrnjenih 1).
 */
export function razberiSlike(odgovor: unknown): { slike: Array<{ bajti: Buffer; mime: string }>; zavrnjenih: number } {
  const kandidati = (odgovor as { candidates?: unknown } | null)?.candidates;
  for (const k of Array.isArray(kandidati) ? kandidati : []) {
    const deli = (k as { content?: { parts?: unknown } } | null)?.content?.parts;
    for (const d of Array.isArray(deli) ? deli : []) {
      const del = d as { thought?: unknown; inlineData?: { mimeType?: unknown; data?: unknown } } | null;
      if (!del?.inlineData || del.thought === true) continue;
      const { mimeType: mime, data: b64 } = del.inlineData;
      if (typeof b64 !== "string" || !b64 || b64.length > B64_SLIKE) continue;
      const bajti = Buffer.from(b64, "base64");
      const png = bajti.length > 8 && bajti.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const jpg = bajti.length > 3 && bajti[0] === 0xff && bajti[1] === 0xd8 && bajti[2] === 0xff;
      if (!(png || jpg) || bajti.length > NAJVEC_BAJTOV_SLIKE || (mime !== undefined && mime !== "image/png" && mime !== "image/jpeg")) continue;
      return { slike: [{ bajti, mime: png ? "image/png" : "image/jpeg" }], zavrnjenih: 0 };
    }
  }
  return { slike: [], zavrnjenih: 1 };
}

export type IzbiraGeneratorja = { ok: true; projekt: string; model: ModelSlike; razlog: string } | { ok: false; sporocilo: string };
const NASTAVI = "Za slike nastavi Nastavitve > Mozgani > Google Vertex AI s svojim projektom (prijava Google); krediti gredo na tvoj projekt.";

/**
 * Naloga 20, »poisci generator«: Lina izbere generator samo iz nastavljenega - Vertex s projektom. Drug ponudnik (s kljucem) se za slike
 * ne uporabi samodejno (B9: nic samodejno tretjim, tudi opis slike ne); brez nastavitve pove, kaj nastaviti.
 */
export function izberiGeneratorSlik(mozgani: { provider?: unknown; project?: unknown } | null | undefined, kakovost: KakovostSlike = "standard"): IzbiraGeneratorja {
  const model = MODEL_PO_KAKOVOSTI[kakovost] ?? PRIVZETI_MODEL_SLIK;
  if (mozgani?.provider === "vertex" && typeof mozgani.project === "string" && mozgani.project) {
    return { ok: true, projekt: mozgani.project, model, razlog: `Generator: Google Vertex AI (tvoj projekt iz Nastavitve > Mozgani), model ${model} (${kakovost}); drugih ponudnikov za slike ne uporabljam samodejno.` };
  }
  if (typeof mozgani?.provider === "string" && mozgani.provider !== "vertex") {
    return { ok: false, sporocilo: `Imas nastavljenega ponudnika ${mozgani.provider.slice(0, 40)}, a slik prek njega ne posiljam samodejno (opis bi sel tretjemu). ${NASTAVI}` };
  }
  return { ok: false, sporocilo: `Ni nastavljenega generatorja slik. ${NASTAVI}` };
}

const nakljucniId = (): string => randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "a").slice(0, 12).padEnd(12, "a");

/** Knjiznica slik (samo lastnik). */
export async function knjiznicaSlik(token: string | null, dir?: string): Promise<Knjiznica> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return preberiKnjiznico(root);
}

/** Ustvari slike iz opisa in jih shrani v knjiznico (podatki/slike/<id>.png, 0600). Samo lastnik. */
export async function generirajSliko(opis: unknown, token: string | null, dir?: string, m: MoznostiGeneriranja = {}): Promise<IzidGeneriranja> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return ustvariSliko(root, opis, m);
}

/**
 * Jedro generatorja BREZ preverbe lastnika: klice ga generirajSliko (po requireOwner) in orodje orkestratorja ustvari_sliko (naloga
 * lastnika). Ni izpostavljeno kot strezniska funkcija. Vse zahteve se izvedejo PRED zapisom: napaka katere koli = nic na disku.
 */
export async function ustvariSliko(root: string, opis: unknown, m: MoznostiGeneriranja = {}): Promise<IzidGeneriranja> {
  const napaka = preveriVhodSlike(opis, m);
  if (napaka) throw new Error(napaka);
  const besedilo = (opis as string).trim();
  const model = (m.model as ModelSlike | undefined) ?? PRIVZETI_MODEL_SLIK;
  const stevilo = (m.stevilo as number | undefined) ?? 1;
  const razmerje = (m.razmerje as string | undefined) ?? "1:1";
  let projekt = m.projekt;
  if (!projekt) {
    const izbira = izberiGeneratorSlik(await activeBrain(root));
    if (!izbira.ok) throw new Error(izbira.sporocilo);
    projekt = izbira.projekt;
  }
  const url = naslovSlik(projekt, model);
  // mapa, ki ni navadna mapa, zavrne PRED placljivimi zahtevami (pred zapisom se preveri se enkrat)
  await mapaKnjiznice(root);
  m.signal?.throwIfAborted();
  const { poziv, prevedeno } = await pripraviPoziv(besedilo, root, m.prevedi ?? prevajalnikPoZahtevnosti(projekt, { fetch: m.fetch, zeton: m.zeton }), m.namigRsdo);
  if (!prevedeno) throw new Error(PREVOD_SLIKE_NI_USPEL);
  const zeton = await (m.zeton ?? (() => vertexAccessToken()))();
  const slike: Array<{ bajti: Buffer; mime: string }> = [];
  let zavrnjenih = 0;
  // Ena slika na zahtevo (candidateCount > 1 vrne 400, izmerjeno 26. 11. 2026); zaporedno, da kvota ne pade na 429.
  for (let i = 0; i < stevilo; i++) {
    m.signal?.throwIfAborted();
    const rok = AbortSignal.timeout(ROK_ZAHTEVE_MS);
    const odg = await (m.fetch ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${zeton}`, "content-type": "application/json" },
      body: JSON.stringify(teloSlik(poziv, razmerje)),
      signal: m.signal ? AbortSignal.any([rok, m.signal]) : rok,
    });
    if (!odg.ok) throw new Error(`Ponudnik slik je zavrnil zahtevo (${odg.status}).`);
    const besediloOdg = await teloZMejo(odg, NAJVEC_ZNAKOV_ODGOVORA, "Odgovor ponudnika slik je prevelik.");
    let json: unknown;
    try {
      json = JSON.parse(besediloOdg);
    } catch {
      throw new Error("Ponudnik slik je vrnil neveljaven odgovor.");
    }
    const r = razberiSlike(json);
    slike.push(...r.slike);
    zavrnjenih += r.zavrnjenih;
  }
  // ustavljena naloga ne objavi slike (prekinitev med zadnjo zahtevo in zapisom ali med cakanjem na mapo)
  m.signal?.throwIfAborted();
  const mapa = await mapaKnjiznice(root);
  m.signal?.throwIfAborted();
  const nov = m.nakljucno ?? nakljucniId;
  const serija = (m.serija as string | undefined) ?? nov();
  const cas = (m.zdaj ?? (() => new Date()))().toISOString();
  const zapisi: ZapisSlike[] = [];
  try {
    for (const s of slike) {
      const id = nov();
      const datoteka = `${id}${s.mime === "image/png" ? ".png" : ".jpg"}`;
      const pot = path.join(mapa, datoteka);
      await writeFile(pot, s.bajti, { mode: 0o600, flag: "wx" }).catch(async (e: unknown) => {
        // delno zapisana LASTNA datoteka (ENOSPC, EIO) ne ostane; EEXIST = datoteka ni od tega klica
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") await unlink(pot).catch(() => undefined);
        throw e;
      });
      zapisi.push({ id, serija, cas, opis: besedilo, poziv, prevedeno, model, datoteka, bajtov: s.bajti.length });
      await chmod(pot, 0o600);
    }
    if (zapisi.length) await dodajVKnjiznico(root, zapisi, m.signal);
  } catch (e) {
    // napaka ali prekinitev pred objavo: odstrani SAMO datoteke, ki jih je ustvaril ta klic (wx), da ni slik brez zapisa
    await Promise.all(zapisi.map((z) => unlink(path.join(mapa, z.datoteka)).catch(() => undefined)));
    throw e;
  }
  return { slike: zapisi, zavrnjenih };
}
