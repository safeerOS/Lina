/**
 * Glas Line na strezniku: sinteza prek Vertex, predpomnilnik posnetkov na disku in javna pot zvoka.
 * Deluje samo, ko so mozgani nastavljeni na prijavo Google Cloud (vertex); sicer klic govori z rezervo <Say>.
 * Zeton prijave ne gre ne v dnevnik, ne v napako, ne v datoteko.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants as FS, readdirSync, unlinkSync } from "node:fs";
import { chmod, link, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { ADC_MANJKA, pozabiZeton, vertexAccessToken } from "./adc.server.ts";
import {
  cistoBesedilo,
  jeKljucZvoka,
  kljucIzPoti,
  kljucZvoka,
  GLAS_IME,
  GLAS_MODEL,
  MEJA_SINTEZE,
  NAJVEC_POSKUSOV_STALNEGA,
  naslovGlasu,
  NAVODILO_SLOGA_HITREJE,
  oceniPosnetek,
  pcm24VWav8,
  pcmIzOdgovora,
  razdeliZaGlas,
  semeZaBesedilo,
  teloGlasu,
  VHODNA_FREKVENCA,
} from "./glas.ts";
import { izenaciGovor, meriTisine8k, ocistiTisino8k, PREMOR_NAJVEC_MS, skrciTisine8k, TISINA_KONEC_MS, TISINA_ZACETEK_MS } from "./glas-izenacenje.ts";
import { activeBrain } from "./keys.server.ts";
import { llmOn } from "./llm.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { merjeno, zabeleziOdgovor } from "./meritve.server.ts";
import { topliFetch } from "./povezave.server.ts";
import type { KodaGlasu, StanjeGlasu } from "./types.ts";

export type { KodaGlasu, StanjeGlasu } from "./types.ts";


/** Napaka brez vsebine: samo koda razloga in stanje HTTP. Besedila odgovora ali zetona ne nosi. */
export class NapakaGlasu extends Error {
  readonly koda: KodaGlasu;
  readonly status: number | null;
  /** Kratka oznaka vzroka za dnevnik (npr. »rok«, »omrezje«, »kakovost«); brez vsebine. */
  readonly vzrok: string | null;
  constructor(koda: KodaGlasu, status: number | null = null, vzrok: string | null = null) {
    super(koda);
    this.koda = koda;
    this.status = status;
    this.vzrok = vzrok;
  }
}

function kodaNapake(error: unknown): KodaGlasu {
  return error instanceof NapakaGlasu ? error.koda : "glasNapaka";
}

/** Ura in premor sta vbrizgana, da preizkusi rokov ne cakajo pravega casa. */
let ura: () => number = () => Date.now();
let premor: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Samo za preizkuse. Null vrne pravo uro oziroma pravi premor. */
export function nastaviUroGlasuZaPreizkus(nova: (() => number) | null, novPremor: ((ms: number) => Promise<void>) | null = null): void {
  ura = nova ?? (() => Date.now());
  premor = novPremor ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
}

/** Sinteza vrne PCM 16-bit mono 24 kHz. navodilo: slog (privzeto NAVODILO_SLOGA; hitrejsi samo za pozdrav osebnega nacina). seme: seme sinteze. */
export type Sinteza = (besedilo: string, root: string, navodilo?: string, seme?: number) => Promise<Buffer>;

/**
 * Slog glasu po mapi podatkov (lastnik 14. 11. 2026: vse v hitrejsem tempu). Slog je del kljuca posnetka. Hitrejsi slog velja SAMO, ce je zapisan v
 * glas-slog.json (zapise ga scripts/pripravi-slog.mts po pripravi VSEH stalnih posnetkov) IN so ob pripravi stalnih vsi stalni posnetki novega sloga
 * ze na disku; sicer ostane prejsnji slog. Tako med klicem ni ponovne sinteze stalnih stavkov (tveganje 429).
 */
export const DATOTEKA_SLOGA = "glas-slog.json";
const slogi = new Map<string, string>();
export function slogZa(root: string): string | undefined {
  return slogi.get(root);
}
/** Samo za preizkuse: pozabi stanje priprave stalnih (kot ponovni zagon Line). */
export function pozabiStalneZaPreizkus(dir?: string): void {
  const root = resolveDataDir(dir);
  stalnaStanja.delete(root);
  slogi.delete(root);
}
export function nastaviSlogZaPreizkus(root: string, navodilo: string | undefined): void {
  if (navodilo) slogi.set(root, navodilo);
  else slogi.delete(root);
}
async function zeleniSlog(root: string): Promise<string | undefined> {
  const zapis = await readJsonFile<{ slog?: string }>(root, DATOTEKA_SLOGA).catch(() => null);
  return zapis?.slog === "hitreje" ? NAVODILO_SLOGA_HITREJE : undefined;
}
/**
 * Priprava stalnih posnetkov v novem slogu VNAPREJ (izven klica): po en zahtevek naenkrat s premorom med njimi, ob 429 narascajoci zamiki in
 * krog po minuti premora. Zeleni slog zapise sele, ko so pripravljeni VSI (zapisiSlog); do takrat Lina govori v prejsnjem slogu.
 */
export async function pripraviSlogVnaprej(
  root: string,
  stavki: readonly string[],
  navodilo: string,
  moznosti: { premorMs?: number; premorOmejitveMs?: number; krogov?: number; obNapredku?: (pripravljenih: number, vseh: number) => void } = {},
): Promise<{ pripravljenih: number; vseh: number }> {
  const seznam = [...new Set(stavki.map(cistoBesedilo).filter(Boolean))];
  let cakajo = [...seznam];
  for (let krog = 0; krog < (moznosti.krogov ?? NAJVEC_KROGOV_PRIPRAVE) && cakajo.length > 0; krog += 1) {
    if (krog > 0) await premor(moznosti.premorOmejitveMs ?? PREMOR_OMEJITVE_MS);
    const neuspeli: string[] = [];
    const sol = await solZvoka(root);
    for (const st of cakajo) {
      // Ze pripravljen posnetek: brez zahtevka in brez premora.
      if (await obstaja(potOznake(root, kljucZvoka(sol, st, undefined, undefined, "", navodilo)))) {
        moznosti.obNapredku?.(seznam.length - cakajo.length + (cakajo.indexOf(st) + 1) - neuspeli.length, seznam.length);
        continue;
      }
      try {
        await pripraviZvok(st, root, { stalno: true, navodilo, zamiki: ZAMIKI_PRIPRAVE_MS });
      } catch {
        neuspeli.push(st);
      }
      moznosti.obNapredku?.(seznam.length - cakajo.length + (cakajo.indexOf(st) + 1) - neuspeli.length, seznam.length);
      await premor(moznosti.premorMs ?? 1_500);
    }
    cakajo = neuspeli;
  }
  return pripravljenihVSlogu(root, seznam, navodilo);
}

/** Zapise zeleni slog; velja ob naslednji pripravi stalnih (zagon Line), ce so vsi posnetki pripravljeni. */
export async function zapisiSlog(root: string, slog: "hitreje" | "obicajno"): Promise<void> {
  await writeJson(root, DATOTEKA_SLOGA, { slog, at: new Date().toISOString() });
}

/** Koliko stalnih stavkov je v danem slogu ze pripravljenih (brez sinteze). */
export async function pripravljenihVSlogu(root: string, stavki: readonly string[], navodilo: string): Promise<{ pripravljenih: number; vseh: number }> {
  const sol = await solZvoka(root);
  const seznam = [...new Set(stavki.map(cistoBesedilo).filter(Boolean))];
  let pripravljenih = 0;
  for (const st of seznam) if (await obstaja(potOznake(root, kljucZvoka(sol, st, undefined, undefined, "", navodilo)))) pripravljenih += 1;
  return { pripravljenih, vseh: seznam.length };
}

let sintezaPreizkusa: Sinteza | null = null;

/** Samo za preizkuse: lazni izvajalec namesto Vertex (v preizkusih ni pravega omrezja). Null vrne pravega. */
export function nastaviSintezoZaPreizkus(sinteza: Sinteza | null): void {
  sintezaPreizkusa = sinteza;
}

/**
 * Rok ene sinteze. S pretokom je 150 znakov koncanih v ~4,5 s (10. 11. 2026); kos ima najvec 600 znakov.
 * Cakanje klica je skupaj najvec 1,5 + 4 x 3,5 s, zato daljsi rok nima smisla.
 */
export const ROK_SINTEZE_MS = 15_000;
/** 60 s zvoka je 2,9 MB PCM, v base64 3,8 MB. Vecji odgovor ni govor enega kosa. */
const NAJVEC_ODGOVORA = 24 * 1024 * 1024;

async function omejenoBesedilo(odgovor: Response): Promise<string> {
  if (!odgovor.body) return "";
  const dek = new TextDecoder();
  let ven = "";
  let bajtov = 0;
  for await (const kos of odgovor.body as unknown as AsyncIterable<Uint8Array>) {
    bajtov += kos.byteLength;
    if (bajtov > NAJVEC_ODGOVORA) throw new NapakaGlasu("glasNapaka", null, "predolg_odgovor");
    ven += dek.decode(kos, { stream: true });
  }
  return ven + dek.decode();
}

/**
 * Samo za meritve in posluh (scripts/posluh-pozdrava.mts, tocka E 14. 11. 2026): sinteza z drugim navodilom sloga. Linin odgovor je ne uporablja.
 */
export function sintetizirajZaPosluh(besedilo: string, projekt: string, navodilo: string): Promise<Buffer> {
  return sintetizirajVertexJedro(besedilo, projekt, { navodilo });
}

/**
 * Ena sinteza prek Vertex s pretokom (ista oblika zahteve kot meritev 10. 11. 2026: brez pretoka 9,0 s
 * za 150 znakov, s pretokom konec po ~4,5 s). fetch in zeton sta vbrizgana za preizkus.
 */
async function sintetizirajVertexJedro(
  besedilo: string,
  projekt: string,
  odvisnosti: { fetch?: typeof fetch; zeton?: () => Promise<string>; rokMs?: number; navodilo?: string; seme?: number } = {},
): Promise<Buffer> {
  const cisto = cistoBesedilo(besedilo);
  if (!cisto || cisto.length > MEJA_SINTEZE) throw new NapakaGlasu("glasNapaka", null, "neveljavno_besedilo");
  const naslov = naslovGlasu(projekt, true);
  let zeton = "";
  try {
    zeton = await merjeno("zeton", () => (odvisnosti.zeton ?? (() => vertexAccessToken()))());
  } catch (error) {
    throw new NapakaGlasu(error instanceof Error && error.message === ADC_MANJKA ? "glasNiPrijave" : "glasNapaka", null, "zeton");
  }
  if (!zeton) throw new NapakaGlasu("glasNiPrijave");
  let odgovor: Response;
  const zacetekZahteve = performance.now();
  try {
    odgovor = await (odvisnosti.fetch ?? topliFetch)(naslov, {
      method: "POST",
      headers: { authorization: `Bearer ${zeton}`, "content-type": "application/json" },
      body: JSON.stringify(
        odvisnosti.navodilo !== undefined || odvisnosti.seme !== undefined
          ? teloGlasu(cisto, odvisnosti.navodilo, odvisnosti.seme)
          : teloGlasu(cisto),
      ),
      redirect: "error",
      signal: AbortSignal.timeout(odvisnosti.rokMs ?? ROK_SINTEZE_MS),
    });
  } catch (napakaZahteve) {
    // Izvirnega sporocila ne prenasamo naprej: napaka nosi samo kodo in kratko oznako vzroka.
    throw new NapakaGlasu("glasNapaka", null, napakaZahteve instanceof Error && napakaZahteve.name === "TimeoutError" ? "rok" : "omrezje");
  }
  zabeleziOdgovor(odgovor.status, performance.now() - zacetekZahteve);
  if (odgovor.status === 401) pozabiZeton();
  if (!odgovor.ok) {
    await odgovor.body?.cancel().catch(() => undefined);
    // 429 je omejitev ponudnika (meritev vodje 10. 11. 2026): svoja koda, da jo priprava ponovi in dnevnik pokaze.
    throw new NapakaGlasu(odgovor.status === 429 ? "glasOmejitev" : "glasNapaka", odgovor.status);
  }
  let teloOdgovora: string;
  try {
    teloOdgovora = await omejenoBesedilo(odgovor);
  } catch (error) {
    if (error instanceof NapakaGlasu) throw error;
    // Povezava se je prekinila med branjem telesa (po glavah 200): to je omrezje ali rok, ne odgovor brez zvoka.
    throw new NapakaGlasu("glasNapaka", odgovor.status, error instanceof Error && error.name === "TimeoutError" ? "rok" : "omrezje");
  }
  try {
    return pcmIzOdgovora(teloOdgovora);
  } catch (error) {
    if (error instanceof NapakaGlasu) throw error;
    // Odgovor 200 brez zvoka (npr. besedilo namesto govora): stanje 200 v dnevniku ga loci od zavrnitve in omrezja.
    throw new NapakaGlasu("glasNapaka", odgovor.status, "brez_zvoka");
  }
}

/** Meritev: stopnja »tts« je cas ene sinteze (vkljucuje zeton); pri vzporednih kosih velja najdaljsi. */
export function sintetizirajVertex(
  besedilo: string,
  projekt: string,
  odvisnosti: { fetch?: typeof fetch; zeton?: () => Promise<string>; rokMs?: number; navodilo?: string; seme?: number } = {},
): Promise<Buffer> {
  return merjeno("tts", () => sintetizirajVertexJedro(besedilo, projekt, odvisnosti), "najvec");
}

/** Izvajalec ali razlog, zakaj glasu ni. Drugi ponudniki mozganov glasu Gemini v tej izdaji nimajo. */
async function izvajalec(root: string): Promise<Sinteza | KodaGlasu> {
  if (sintezaPreizkusa) return sintezaPreizkusa;
  if (!llmOn()) return "glasNiVertex";
  try {
    const brain = await activeBrain(root);
    if (brain?.provider !== "vertex" || !brain.project) return "glasNiVertex";
    const projekt = brain.project;
    return (besedilo, _root, navodilo, seme) =>
      sintetizirajVertex(besedilo, projekt, {
        ...(navodilo ? { navodilo } : {}),
        ...(seme !== undefined ? { seme } : {}),
      });
  } catch {
    return "glasNiVertex";
  }
}

/** Ali ima ta namestitev Linin glas (prijava Google Cloud). Brez omrezja. */
export async function glasNaVoljo(dir?: string): Promise<boolean> {
  return typeof (await izvajalec(resolveDataDir(dir))) !== "string";
}

export function mapaZvoka(root: string): string {
  return path.join(root, "zvok");
}

const SOL_DATOTEKA = ".sol-zvoka";
const soli = new Map<string, Promise<Buffer>>();

async function zakleni(file: string): Promise<void> {
  // Na Windows chmod ne velja; mapa podatkov je v profilu uporabnika.
  if (process.platform === "win32") return;
  await chmod(file, 0o600);
}

async function veljavnaSol(file: string): Promise<Buffer | null> {
  try {
    const obstojeca = await readFile(file);
    return obstojeca.length === 32 ? obstojeca : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

/**
 * Sol nastane atomarno: zacasna datoteka ('wx') s celo vsebino, nato trda povezava na koncno ime. Drug proces
 * zato nikoli ne vidi napol zapisane soli in je ne zamenja (pregled G2, N3: dva procesa sta dobila razlicni soli,
 * ker je drugi okrnjeno datoteko prvega pobrisal). Vrnemo vedno to, kar je PO ustvarjanju na disku.
 */
export async function preberiAliUstvariSol(root: string): Promise<Buffer> {
  await mkdir(root, { recursive: true });
  const file = path.join(root, SOL_DATOTEKA);
  for (let poskus = 0; poskus < 5; poskus += 1) {
    const obstojeca = await veljavnaSol(file);
    if (obstojeca) {
      await zakleni(file).catch(() => undefined);
      return obstojeca;
    }
    const tmp = path.join(root, `${SOL_DATOTEKA}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    const rocaj = await open(tmp, "wx", 0o600);
    try {
      await rocaj.writeFile(randomBytes(32));
      await rocaj.sync();
    } finally {
      await rocaj.close();
    }
    try {
      await link(tmp, file);
    } catch (error) {
      const koda = (error as NodeJS.ErrnoException).code;
      if (koda !== "EEXIST") {
        await unlink(tmp).catch(() => undefined);
        throw error;
      }
      // Ime ze obstaja: ce je sol veljavna, velja ta. Okrnjen ostanek stare izdaje zamenjamo sele po zadnjem cakanju.
      // Zamenjava okrnjene datoteke je edini korak, ki med dvema procesoma ni atomaren; nova izdaja okrnjene soli
      // ne ustvari vec, zato se zgodi kvecjemu enkrat po nadgradnji.
      if (poskus >= 3 && !(await veljavnaSol(file))) await rename(tmp, file).catch(() => undefined);
      else if (!(await veljavnaSol(file))) await premor(20 * (poskus + 1));
    }
    await unlink(tmp).catch(() => undefined);
  }
  const koncna = await veljavnaSol(file);
  if (!koncna) throw new Error("Soli zvoka ni mogoce ustvariti.");
  await zakleni(file).catch(() => undefined);
  return koncna;
}

/** Nakljucna sol namestitve (32 bajtov), ustvarjena ob prvi rabi, v mapi podatkov z dovoljenji 0600. */
export function solZvoka(root: string): Promise<Buffer> {
  let tek = soli.get(root);
  if (!tek) {
    tek = preberiAliUstvariSol(root);
    soli.set(root, tek);
    tek.catch(() => soli.delete(root));
  }
  return tek;
}

/**
 * Nestalni posnetek lahko vsebuje ime klicatelja: pobrisemo ga ob koncu klica, najkasneje po 10 minutah
 * (lastnik 10. 11. 2026). Po roku ga tudi javna pot ne vrne vec, ce datoteka se obstaja.
 */
export const STAROST_NESTALNIH_MS = 10 * 60 * 1000;
/** Posnetek, ki bo v dveh minutah pobrisan, ni vec »pripravljen«: Twilio ga mora se utegniti prebrati. */
const SVEZINA_MS = 8 * 60 * 1000;
/** Po Lininem slovesu Twilio posnetek slovesa se bere; brisanje pocaka toliko, ce status klica ne pride prej. */
export const ODLOG_PO_SLOVESU_MS = 60_000;
export const INTERVAL_CISCENJA_MS = 60_000;
export const MEJA_MAPE_BAJTOV = 50 * 1024 * 1024;
/** 600 znakov govora je pod 1 MB WAV 8 kHz; vecja datoteka ni nas posnetek. */
const NAJVEC_POSNETKA = 8 * 1024 * 1024;

function potWav(root: string, kljuc: string): string {
  if (!jeKljucZvoka(kljuc)) throw new Error("Neveljaven kljuc zvoka.");
  return path.join(mapaZvoka(root), `${kljuc}.wav`);
}

function potOznake(root: string, kljuc: string): string {
  if (!jeKljucZvoka(kljuc)) throw new Error("Neveljaven kljuc zvoka.");
  return path.join(mapaZvoka(root), `${kljuc}.stalno`);
}

async function obstaja(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function oznaciStalno(root: string, kljuc: string): Promise<void> {
  const rocaj = await open(potOznake(root, kljuc), "a", 0o600);
  await rocaj.close();
}

async function jePripravljen(root: string, kljuc: string, zdaj = ura()): Promise<boolean> {
  try {
    const info = await stat(potWav(root, kljuc));
    if (!info.isFile() || info.size < 44) return false;
    // Stalni stavek velja brez roka; nestalni samo, dokler ga Twilio se utegne prebrati.
    if (await obstaja(potOznake(root, kljuc))) return true;
    return zdaj - info.mtimeMs < SVEZINA_MS;
  } catch {
    return false;
  }
}

async function zapisiAtomarno(root: string, kljuc: string, vsebina: Buffer): Promise<void> {
  const mapa = mapaZvoka(root);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const tmp = path.join(mapa, `.${kljuc}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const rocaj = await open(tmp, "wx", 0o600);
  try {
    await rocaj.writeFile(vsebina);
    await rocaj.sync();
  } catch (error) {
    await rocaj.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  await rocaj.close();
  try {
    await rename(tmp, potWav(root, kljuc));
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/**
 * Ciscenje mape zvoka: nestalni posnetki, starejsi od 10 minut, gredo ven; ce je mapa vecja od meje,
 * gredo ven najstarejsi nestalni. Stalnih stavkov ne brise.
 */
export async function pocistiZvok(
  root: string,
  moznosti: { zdaj?: number; mejaBajtov?: number } = {},
): Promise<{ pobrisanih: number; bajtov: number }> {
  const zdaj = moznosti.zdaj ?? ura();
  const meja = moznosti.mejaBajtov ?? MEJA_MAPE_BAJTOV;
  const mapa = mapaZvoka(root);
  let imena: string[];
  try {
    imena = await readdir(mapa);
  } catch {
    return { pobrisanih: 0, bajtov: 0 };
  }
  const stalni = new Set(imena.filter((ime) => ime.endsWith(".stalno")).map((ime) => ime.slice(0, -7)));
  const posnetki: Array<{ kljuc: string; velikost: number; cas: number; stalno: boolean }> = [];
  let pobrisanih = 0;
  for (const ime of imena) {
    const file = path.join(mapa, ime);
    if (ime.endsWith(".tmp")) {
      // Ostanek prekinjenega zapisa.
      const info = await stat(file).catch(() => null);
      if (info && zdaj - info.mtimeMs > STAROST_NESTALNIH_MS) await unlink(file).catch(() => undefined);
      continue;
    }
    if (!ime.endsWith(".wav")) continue;
    const kljuc = ime.slice(0, -4);
    if (!jeKljucZvoka(kljuc)) continue;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    const stalno = stalni.has(kljuc);
    if (!stalno && zdaj - info.mtimeMs >= STAROST_NESTALNIH_MS) {
      await unlink(file).catch(() => undefined);
      pobrisanih += 1;
      continue;
    }
    posnetki.push({ kljuc, velikost: info.size, cas: info.mtimeMs, stalno });
  }
  let bajtov = posnetki.reduce((vsota, p) => vsota + p.velikost, 0);
  for (const posnetek of posnetki.filter((p) => !p.stalno).sort((a, b) => a.cas - b.cas)) {
    if (bajtov <= meja) break;
    await unlink(potWav(root, posnetek.kljuc)).catch(() => undefined);
    bajtov -= posnetek.velikost;
    pobrisanih += 1;
  }
  return { pobrisanih, bajtov };
}

/** Nestalni posnetki po klicu: ob koncu klica jih pobrisemo, ne da bi cakali rok. */
const posnetkiKlicev = new Map<string, Set<string>>();
const odlozenaBrisanja = new Map<string, ReturnType<typeof setTimeout>>();

/** Za preizkus: koliko klicev ima se zabelezene nestalne posnetke. */
export function steviloKlicevZZvokom(): number {
  return posnetkiKlicev.size;
}

/**
 * Konec klica: pobrise nestalne posnetke tega klica. Z odlogom (Lina se je poslovila sama) brisanje pocaka,
 * da Twilio se prebere posnetek slovesa; status »completed« ali rok 10 minut ga pobriseta prej oziroma vsekakor.
 */
export async function pobrisiZvokKlica(dir: string | undefined, klic: string, odlogMs = 0): Promise<number> {
  const root = resolveDataDir(dir);
  const oznaka = `${root}\n${klic}`;
  const cakajoce = odlozenaBrisanja.get(oznaka);
  if (odlogMs > 0) {
    if (cakajoce || !posnetkiKlicev.has(oznaka)) return 0;
    const casovnik = setTimeout(() => void pobrisiZvokKlica(root, klic).catch(() => undefined), odlogMs);
    casovnik.unref?.();
    odlozenaBrisanja.set(oznaka, casovnik);
    return 0;
  }
  if (cakajoce) clearTimeout(cakajoce);
  odlozenaBrisanja.delete(oznaka);
  const kljuci = posnetkiKlicev.get(oznaka);
  posnetkiKlicev.delete(oznaka);
  let pobrisanih = 0;
  for (const kljuc of kljuci ?? []) {
    // Stalnega stavka ne brisemo, tudi ce bi kljuc po pomoti prisel sem.
    if (await obstaja(potOznake(root, kljuc))) continue;
    try {
      await unlink(potWav(root, kljuc));
      pobrisanih += 1;
    } catch {
      /* Ze pobrisan (rok) ali nikoli zapisan. */
    }
  }
  return pobrisanih;
}

/** Ob zaustavitvi: vsi nestalni posnetki gredo ven, stalni ostanejo. Sinhrono, ker tece v obdelavi izhoda procesa. */
export function pobrisiNestalneSinhrono(dir?: string): number {
  const mapa = mapaZvoka(resolveDataDir(dir));
  let imena: string[];
  try {
    imena = readdirSync(mapa);
  } catch {
    return 0;
  }
  const stalni = new Set(imena.filter((ime) => ime.endsWith(".stalno")).map((ime) => ime.slice(0, -7)));
  let pobrisanih = 0;
  for (const ime of imena) {
    const nestalni = ime.endsWith(".wav") && jeKljucZvoka(ime.slice(0, -4)) && !stalni.has(ime.slice(0, -4));
    if (!nestalni && !ime.endsWith(".tmp")) continue;
    try {
      unlinkSync(path.join(mapa, ime));
      pobrisanih += 1;
    } catch {
      /* Datoteke ni vec. */
    }
  }
  return pobrisanih;
}

const casovniki = new Map<string, ReturnType<typeof setInterval>>();
let izhodPrijavljen = false;

/**
 * Casovnik ciscenja za mapo podatkov: takoj (zagon programa) in nato vsako minuto. Pregled G2 (V2): ciscenje je
 * teklo samo po novi sintezi, zato je 5 ur star posnetek z imenom ostal na disku. Casovnik procesa ne drzi pri zivljenju.
 */
export function zazeniCiscenjeZvoka(dir?: string, intervalMs = INTERVAL_CISCENJA_MS): void {
  const root = resolveDataDir(dir);
  if (casovniki.has(root)) return;
  const casovnik = setInterval(() => void pocistiZvok(root).catch(() => undefined), intervalMs);
  casovnik.unref?.();
  casovniki.set(root, casovnik);
  void pocistiZvok(root).catch(() => undefined);
  if (!izhodPrijavljen) {
    izhodPrijavljen = true;
    process.once("exit", () => {
      for (const mapa of casovniki.keys()) pobrisiNestalneSinhrono(mapa);
    });
  }
}

/** Zaustavitev (in preizkusi): ustavi casovnike in pobrise nestalne posnetke. */
export function ustaviCiscenjeZvoka(dir?: string): void {
  const samo = dir === undefined ? null : resolveDataDir(dir);
  for (const [root, casovnik] of casovniki) {
    if (samo && root !== samo) continue;
    clearInterval(casovnik);
    casovniki.delete(root);
    pobrisiNestalneSinhrono(root);
  }
  for (const [oznaka, casovnik] of odlozenaBrisanja) {
    if (samo && !oznaka.startsWith(`${samo}\n`)) continue;
    clearTimeout(casovnik);
    odlozenaBrisanja.delete(oznaka);
  }
  for (const oznaka of posnetkiKlicev.keys()) if (!samo || oznaka.startsWith(`${samo}\n`)) posnetkiKlicev.delete(oznaka);
}

/** Sinteze v teku: dve socasni zahtevi za isto besedilo cakata isto opravilo. */
const vTeku = new Map<string, Promise<string>>();

/** Za preizkus: koliko sintez tece. */
export function steviloSintezVTeku(): number {
  return vTeku.size;
}

/** Zamiki ponovitve ob 429 med pripravo stalnih stavkov (narascajoce) in en kratek med klicem. */
export const ZAMIKI_PRIPRAVE_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
// Ob 429 med klicem: 0,4 + 1 + 2 s (11. 11. 2026 je en sam zamik 0,3 s pustil klicatelja z Twilio <Say>, ki ga ni razumel).
export const ZAMIKI_KLICA_MS = [400, 1_000, 2_000];

async function sintezaSPonovitvijo(sinteza: Sinteza, besedilo: string, root: string, zamiki: readonly number[], navodilo?: string, seme?: number): Promise<Buffer> {
  for (let poskus = 0; ; poskus += 1) {
    try {
      return await (seme !== undefined
        ? sinteza(besedilo, root, navodilo, seme)
        : navodilo
          ? sinteza(besedilo, root, navodilo)
          : sinteza(besedilo, root));
    } catch (error) {
      const omejitev = error instanceof NapakaGlasu && error.status === 429;
      if (!omejitev || poskus >= zamiki.length) throw error;
      await premor(zamiki[poskus]);
    }
  }
}

/**
 * Vrne kljuc posnetka za besedilo; ce ga se ni, ga sintetizira in atomarno zapise.
 * Napaka sinteze je NapakaGlasu s kodo; klicatelj odloci o rezervi.
 * klic: CallSid za nestalni posnetek (gre v kljuc in v seznam za brisanje ob koncu klica).
 */
export async function pripraviZvok(
  besedilo: string,
  root: string,
  moznosti: { stalno?: boolean; klic?: string; zamiki?: readonly number[]; navodilo?: string; robMs?: number } = {},
): Promise<string> {
  const cisto = cistoBesedilo(besedilo);
  if (!cisto || cisto.length > MEJA_SINTEZE) throw new NapakaGlasu("glasNapaka", null, "neveljavno_besedilo");
  const klic = moznosti.stalno ? "" : (moznosti.klic ?? "");
  const navodilo = moznosti.navodilo ?? slogZa(root);
  const kljuc = kljucZvoka(await solZvoka(root), cisto, undefined, undefined, klic, navodilo);
  if (klic) {
    const oznakaKlica = `${root}\n${klic}`;
    const seznam = posnetkiKlicev.get(oznakaKlica) ?? new Set<string>();
    seznam.add(kljuc);
    posnetkiKlicev.set(oznakaKlica, seznam);
  }
  if (await jePripravljen(root, kljuc)) {
    if (moznosti.stalno) {
      await skrciObstojeci(root, kljuc);
      await oznaciStalno(root, kljuc);
    }
    return kljuc;
  }
  const oznaka = `${root}\n${kljuc}`;
  let tek = vTeku.get(oznaka);
  if (!tek) {
    tek = (async () => {
      const sinteza = await izvajalec(root);
      if (typeof sinteza === "string") throw new NapakaGlasu(sinteza);
      let pcm: Buffer | null = null;
      if (moznosti.stalno) {
        const osnovnoSeme = semeZaBesedilo(cisto);
        for (let poskus = 0; poskus < NAJVEC_POSKUSOV_STALNEGA; poskus += 1) {
          const seme = osnovnoSeme + poskus;
          const kandidat = await sintezaSPonovitvijo(sinteza, cisto, root, moznosti.zamiki ?? ZAMIKI_KLICA_MS, navodilo, seme);
          const ocena = oceniPosnetek(kandidat, cisto, VHODNA_FREKVENCA);
          if (ocena.sprejemljiv) {
            pcm = kandidat;
            break;
          }
        }
        if (!pcm) {
          mnozice.get(root)?.delete(cisto);
          await unlink(potOznake(root, kljuc)).catch(() => undefined);
          await unlink(potWav(root, kljuc)).catch(() => undefined);
          if (!stalnaStanja.get(root)?.stanje.vTeku) await zapisiRazlogGlasu(root, "glasNapaka", null, "priprava", "kakovost");
          throw new NapakaGlasu("glasNapaka", null, "kakovost");
        }
      } else {
        pcm = await sintezaSPonovitvijo(sinteza, cisto, root, moznosti.zamiki ?? ZAMIKI_KLICA_MS, navodilo);
      }
      await merjeno("zapisWav", async () => zapisiAtomarno(root, kljuc, skrciTisine8k(ocistiTisino8k(pcm24VWav8(izenaciGovor(pcm))), moznosti.robMs)), "najvec");
      return kljuc;
    })().finally(() => vTeku.delete(oznaka));
    vTeku.set(oznaka, tek);
    // Ciscenje ne zadrzuje odgovora klicu.
    void tek.then(() => pocistiZvok(root)).catch(() => undefined);
  }
  const ven = await tek;
  if (moznosti.stalno) await oznaciStalno(root, kljuc);
  return ven;
}

/**
 * Ze pripravljen stalni posnetek (pred 14. 11. 2026) dobi isto krajsanje tisin brez nove sinteze (brez omrezja in brez tveganja 429; kljuc
 * OBDELAVA_ZVOKA ostane). Samo ce je nad pragovi; skrciTisine8k je idempotentna. Napaka ne podre priprave.
 */
// Toleranca: prag tisine se po krajsanju izracuna znova (95. percentil se premakne), zato meritev izhoda lahko pokaze nekaj 10 ms vec.
export const PRAG_ZACETEK_MS = TISINA_ZACETEK_MS + 20;
export const PRAG_KONEC_MS = TISINA_KONEC_MS + 40;
/** Notranji premor do PREMOR_NAJVEC_MS ostane (med zlogi in besedami); daljsi se skrajsa na PREMOR_OSTANE_MS. */
export const PRAG_PREMOR_MS = PREMOR_NAJVEC_MS + 10;
export function nadPragovi(m: { zacetekMs: number; konecMs: number; najdaljsiPremorMs: number }): boolean {
  return m.zacetekMs > PRAG_ZACETEK_MS || m.konecMs > PRAG_KONEC_MS || m.najdaljsiPremorMs > PRAG_PREMOR_MS;
}
async function skrciObstojeci(root: string, kljuc: string): Promise<void> {
  try {
    const wav = await readFile(potWav(root, kljuc));
    const m = meriTisine8k(wav);
    if (!m || !nadPragovi(m)) return;
    const skrcen = skrciTisine8k(wav);
    if (skrcen.length < wav.length) await zapisiAtomarno(root, kljuc, skrcen);
  } catch {
    /* posnetek ostane, kot je */
  }
}

/**
 * En <Play> na odgovor (tocka B, 14. 11. 2026: odgovor K7 sta bili dve datoteki, Twilio ju prenese locceno): ze pripravljeni kosi
 * istega odgovora se zlepijo v en nestalni posnetek klica (PCM 8 kHz brez nove sinteze; kosi ze imajo kratko tisino na robovih). Ob kakrsni koli
 * nepravilnosti ostanejo locceni kosi (nic se ne poslabsa). Merilnik verige (zvokPrislo) velja tudi za zlepek.
 */
export async function zlepiPosnetke(kljuci: readonly string[], root: string, klic: string): Promise<string[]> {
  if (kljuci.length < 2 || !klic) return [...kljuci];
  try {
    const kljuc = kljucZvoka(await solZvoka(root), `zlepek|${kljuci.join("|")}`, undefined, undefined, klic);
    if (!(await jePripravljen(root, kljuc))) {
      const deli = await Promise.all(kljuci.map((k) => readFile(potWav(root, k))));
      const pravilen = (d: Buffer) =>
        d.length > 44 && d.toString("ascii", 0, 4) === "RIFF" && d.toString("ascii", 36, 40) === "data" && d.readUInt16LE(20) === 1 && d.readUInt16LE(22) === 1 && d.readUInt32LE(24) === 8000 && d.readUInt16LE(34) === 16;
      if (!deli.every(pravilen)) return [...kljuci];
      const podatki = Buffer.concat(deli.map((d) => d.subarray(44)));
      if (44 + podatki.length > NAJVEC_POSNETKA) return [...kljuci];
      const glava = Buffer.from(deli[0].subarray(0, 44));
      glava.writeUInt32LE(36 + podatki.length, 4);
      glava.writeUInt32LE(podatki.length, 40);
      await zapisiAtomarno(root, kljuc, Buffer.concat([glava, podatki]));
    }
    const oznakaKlica = `${root}\n${klic}`;
    const seznam = posnetkiKlicev.get(oznakaKlica) ?? new Set<string>();
    seznam.add(kljuc);
    posnetkiKlicev.set(oznakaKlica, seznam);
    const priprava = pripravljeniKosi.get(kljuci[0]);
    if (priprava) pripravljeniKosi.set(kljuc, priprava);
    return [kljuc];
  } catch {
    return [...kljuci];
  }
}

/** Trenutna mnozica stalnih stavkov po mapi podatkov (za razrez odgovora na kose). */
const mnozice = new Map<string, Set<string>>();

function stalniZa(root: string): Set<string> {
  return mnozice.get(root) ?? new Set();
}

/** Kljuci kosov, ce so VSI ze na disku; sicer null. Nicesar ne sintetizira (za takojsen odgovor). */
export async function pripravljeniKljuci(besedilo: string, root: string, posebni: readonly string[] = [], klic = ""): Promise<string[] | null> {
  const stalni = stalniZa(root);
  const kosi = razdeliZaGlas(besedilo, stalni, undefined, posebni);
  if (kosi.length === 0) return null;
  try {
    const sol = await solZvoka(root);
    // Posebni kosi (ponovitev) so posnetki klica: kljuc s CallSid, kot pri sintezi.
    const kljuci = kosi.map((kos) => kljucZvoka(sol, kos, undefined, undefined, klic && !stalni.has(cistoBesedilo(kos)) && posebni.includes(kos) ? klic : "", slogZa(root)));
    for (const kljuc of kljuci) if (!(await jePripravljen(root, kljuc))) return null;
    return kljuci;
  } catch {
    return null;
  }
}

/**
 * Odklopnik sinteze med klicem (pregled G2, S1): po napaki ali zamudi sinteze odgovora gre naslednjih
 * ODKLOP_MS vsak odgovor, ki se nima posnetka, takoj v rezervo - brez 4x »Trenutek« na vsak obrat.
 * Napaka med PRIPRAVO stalnih stavkov ga ne sprozi (meritev vodje 10. 11. 2026: 429 pri pripravi ne sme
 * izklopiti glasu za odgovore).
 */
export const ODKLOP_MS = 60_000;
const odklopi = new Map<string, number>();

export function sproziOdklopnik(dir?: string): void {
  odklopi.set(resolveDataDir(dir), ura() + ODKLOP_MS);
}

export function odklopnikOdprt(dir?: string): boolean {
  const root = resolveDataDir(dir);
  const do_ = odklopi.get(root);
  if (do_ === undefined) return false;
  if (ura() < do_) return true;
  odklopi.delete(root);
  return false;
}

/** Samo za preizkuse: odklopnik nazaj v zacetno stanje. */
export function ponastaviOdklopnik(dir?: string): void {
  if (dir === undefined) odklopi.clear();
  else odklopi.delete(resolveDataDir(dir));
}

export type IzidZvoka = { kljuci: string[] } | { razlog: KodaGlasu; status?: number | null };

export type KosiZvoka = { kosi: string[]; obljube: Array<Promise<string>> } | { razlog: KodaGlasu };

/**
 * Sinteza odgovora po kosih: vsak kos ima svojo obljubo kljuca, da klic prvi stavek predvaja takoj, ko je
 * pripravljen, in ne caka celega odgovora (meritev vodje 10. 11. 2026). Kosi tecejo vzporedno, vrstni red je v
 * seznamu. Padec kosa, ki ni stalni stavek, sprozi odklopnik. klic: CallSid za nestalne posnetke.
 */
/** robPosebnihMs: tesen rob za posebne kose (ponovitev po kosih), da stik med kosi ni slisen kot premor. */
export async function zvokPoKosih(besedilo: string, root: string, klic = "", posebni: readonly string[] = [], robPosebnihMs?: number): Promise<KosiZvoka> {
  const na = await izvajalec(root);
  if (typeof na === "string") return { razlog: na };
  const stalni = stalniZa(root);
  const kosi = razdeliZaGlas(besedilo, stalni, undefined, posebni);
  if (kosi.length === 0) return { razlog: "glasNapaka" };
  if (odklopnikOdprt(root)) {
    // Kar je ze na disku (stalni stavki), se vseeno predvaja; nove sinteze v oknu odklopa ni.
    const sol = await solZvoka(root);
    const kljuci = kosi.map((kos) => kljucZvoka(sol, kos, undefined, undefined, stalni.has(kos) ? "" : klic, slogZa(root)));
    for (const kljuc of kljuci) if (!(await jePripravljen(root, kljuc))) return { razlog: "glasOdklop" };
    return { kosi, obljube: kljuci.map((kljuc) => Promise.resolve(kljuc)) };
  }
  const obljube = kosi.map((kos) => {
    const obljuba = pripraviZvok(kos, root, { stalno: stalni.has(kos), klic, ...(robPosebnihMs !== undefined && posebni.includes(kos) ? { robMs: robPosebnihMs } : {}) });
    // Stalni stavek, ki mu priprava ni uspela, ni znak, da sinteza odgovorov ne dela.
    obljuba.catch(() => {
      if (!stalni.has(kos)) sproziOdklopnik(root);
    });
    return obljuba;
  });
  return { kosi, obljube };
}

/** Predpriprava po klicu: naslednja se zacne, ko se prejsnja konca (en klic ne poslje vec kot ena sinteza naenkrat). */
const predpriprave = new Map<string, Promise<void>>();

/**
 * Predpriprava stavkov povzetka (G4b): ko je podatek zbran, se njegov stavek sintetizira ze med pogovorom, da
 * povzetek na koncu klica ne caka na sintezo. Stavki so nestalni posnetki tega klica (ime, telefon): brisejo se ob
 * koncu klica ali po 10 minutah kot vsak nestalni posnetek. Ena sinteza naenkrat na klic, brez ponovitve ob 429 in
 * brez odklopnika: napaka predpriprave samo pomeni, da se stavek sintetizira ob povzetku, kot prej.
 */
export function predpripraviStavke(stavki: readonly string[], root: string, klic: string): Promise<void> {
  const oznaka = `${root}\n${klic}`;
  const prejsnja = predpriprave.get(oznaka) ?? Promise.resolve();
  const tek = prejsnja.then(async () => {
    if (!klic || odklopnikOdprt(root)) return;
    for (const stavek of stavki) {
      try {
        await pripraviZvok(stavek, root, { klic, zamiki: [] });
      } catch {
        return;
      }
    }
  });
  predpriprave.set(oznaka, tek);
  void tek.finally(() => {
    if (predpriprave.get(oznaka) === tek) predpriprave.delete(oznaka);
  });
  return tek;
}

/**
 * Predpriprava celega odgovora (osebna: »Zapisala sem: ...« takoj po zapisu sporocila, lastnik 14. 11. 2026): isti kosi kot pozneje v odgovoru
 * (razdeliZaGlas), stalni stavki se ne sintetizirajo znova. Ozadje; napake se ne vrzejo.
 */
/** Rob kosa ponovitve (lastnik 14. 11. 2026): tisina na zacetku in koncu kosa najvec 30 ms, da stik ne zveni kot vejica. */
export const ROB_KOSA_PONOVITVE_MS = 30;
/**
 * tudiCelo (ponovitev, 14. 11. 2026): poleg kosov se HKRATI sintetizira celo besedilo kot ena sinteza (en tok govora, brez meje med kosi); ena zahteva vec na zapis.
 */
export function predpripraviOdgovor(besedilo: string, root: string, klic: string, posebni: readonly string[] = [], tudiCelo = false): Promise<void> {
  const stalni = stalniZa(root);
  const deli = razdeliZaGlas(besedilo, stalni, undefined, posebni).filter((kos) => !stalni.has(kos));
  const celo = cistoBesedilo(besedilo);
  const kosi = tudiCelo && posebni.length > 1 && celo.length <= MEJA_SINTEZE && !deli.includes(celo) ? [...deli, celo] : deli;
  // S posebnimi kosi (ponovitev): vsi kosi HKRATI (izmerjeno p95 2952 ms proti 6667 ms za en zahtevek); sicer zaporedno kot prej.
  if (posebni.length > 0 && klic && !odklopnikOdprt(root)) return Promise.all(kosi.map((kos) => pripraviZvok(kos, root, { klic, zamiki: [], robMs: ROB_KOSA_PONOVITVE_MS }).catch(() => undefined))).then(() => undefined);
  return predpripraviStavke(kosi, root, klic).catch(() => undefined);
}

/** Koda razloga in stanje HTTP iz napake sinteze (brez vsebine). */
export function razlogNapakeGlasu(error: unknown): { razlog: KodaGlasu; status: number | null } {
  return { razlog: kodaNapake(error), status: error instanceof NapakaGlasu ? error.status : null };
}

/**
 * Posnetki za cel odgovor. Brez glasu ali ob napaki vrne razlog za rezervo.
 * klic: CallSid, da nestalni kosi dobijo svoj naslov in se ob koncu klica pobrisejo.
 */
export async function zvokZaBesedilo(besedilo: string, root: string, klic = ""): Promise<IzidZvoka> {
  const zvok = await zvokPoKosih(besedilo, root, klic);
  if ("razlog" in zvok) return zvok;
  const izidi = await Promise.allSettled(zvok.obljube);
  const padel = izidi.find((izid) => izid.status === "rejected");
  if (padel && padel.status === "rejected") return razlogNapakeGlasu(padel.reason);
  return { kljuci: izidi.map((izid) => (izid.status === "fulfilled" ? izid.value : "")) };
}

type ZapisStalnih = { podpis: string; stanje: StanjeGlasu; tek: Promise<void>; ob: number; poKoncu: Array<() => Promise<void>> };
const stalnaStanja = new Map<string, ZapisStalnih>();
export const SOCASNIH_PRIPRAV = 2;
/** Po omejitvi 429 pocakamo minuto (kvota ponudnika je na minuto) in manjkajoce stavke pripravimo znova. */
export const PREMOR_OMEJITVE_MS = 60_000;
export const NAJVEC_KROGOV_PRIPRAVE = 10;
/** Po neuspehu ne poskusamo ob vsaki zahtevi klica znova. */
const PREMOR_PO_NAPAKI_MS = 60_000;

export function stanjeGlasu(dir?: string): StanjeGlasu {
  const zapis = stalnaStanja.get(resolveDataDir(dir));
  return zapis ? { ...zapis.stanje } : { pripravljen: false, vTeku: false, razlog: "", pripravljenih: 0, vseh: 0 };
}

/** Pocaka pripravo stalnih stavkov, ki tece v ozadju (preizkusi in zaustavitev). Nikoli ne vrze. */
export async function pocakajGlas(dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  for (;;) {
    const zapis = stalnaStanja.get(root);
    if (!zapis) return;
    const tek = zapis.tek;
    await tek.catch(() => undefined);
    if (stalnaStanja.get(root) === zapis && zapis.tek === tek) return;
  }
}

async function odznaciStare(root: string, veljavni: Set<string>): Promise<void> {
  const imena = await readdir(mapaZvoka(root)).catch(() => [] as string[]);
  for (const ime of imena) {
    if (!ime.endsWith(".stalno")) continue;
    const kljuc = ime.slice(0, -7);
    if (jeKljucZvoka(kljuc) && !veljavni.has(kljuc)) await unlink(potOznake(root, kljuc)).catch(() => undefined);
  }
}

function podpisStavkov(stavki: string[]): { seznam: string[]; podpis: string } {
  const seznam = [...new Set(stavki.map(cistoBesedilo).filter(Boolean))];
  // Glas in model sta del podpisa: po njuni menjavi se stavki pripravijo znova.
  return { seznam, podpis: createHash("sha256").update(`${GLAS_MODEL}|${GLAS_IME}\n${seznam.join("\n")}`).digest("hex") };
}

/** Ali so natanko ti stavki pripravljeni (pogoj za odprtje linije z glasom). */
export function glasPripravljenZa(dir: string | undefined, stavki: string[]): boolean {
  const zapis = stalnaStanja.get(resolveDataDir(dir));
  return Boolean(zapis && zapis.stanje.pripravljen && zapis.podpis === podpisStavkov(stavki).podpis);
}

/** Po koncu trenutne priprave (uspeh ali ne) pozene delo, npr. odprtje linije, ki caka na glas. */
export function poPripraviGlasu(dir: string | undefined, delo: () => Promise<void>): void {
  const zapis = stalnaStanja.get(resolveDataDir(dir));
  if (!zapis) return;
  if (zapis.stanje.vTeku) zapis.poKoncu.push(delo);
  else zapis.tek = zapis.tek.then(delo).catch(() => undefined);
}

/**
 * Pripravi stalne stavke poteka klica. Nikoli ne vrze: napaka ostane v stanju (»glas ni pripravljen + razlog«),
 * odprtje linije pa uspe. Ista mnozica stavkov se ne pripravlja dvakrat.
 */
export function pripraviStalne(dir: string | undefined, stavki: string[], moznosti: { odznaci?: boolean } = {}): Promise<void> {
  // odznaci=false: delna mnozica (zaprta linija rabi en stavek) ne odznaci ostalih stalnih stavkov (pregled G2, N9).
  const odznaci = moznosti.odznaci ?? true;
  const root = resolveDataDir(dir);
  const { seznam, podpis } = podpisStavkov(stavki);
  zazeniCiscenjeZvoka(root);
  const prej = stalnaStanja.get(root);
  if (prej && prej.podpis === podpis) {
    if (prej.stanje.vTeku || prej.stanje.pripravljen) return prej.tek;
    if (prej.stanje.razlog === "glasNiVertex") {
      // Brez prijave Google Cloud samo preverimo (brez omrezja), ali je prijava medtem nastavljena;
      // stanje za vmesnik ostane, dokler glasu res ni.
      prej.tek = prej.tek.then(async () => {
        if (stalnaStanja.get(root) !== prej || typeof (await izvajalec(root)) === "string") return;
        if (stalnaStanja.get(root) === prej) await zazeniStalne(root, seznam, podpis, odznaci);
      });
      return prej.tek;
    }
    // Po napaki sinteze ne poskusamo ob vsaki zahtevi klica znova.
    if (ura() - prej.ob < PREMOR_PO_NAPAKI_MS) return prej.tek;
  }
  return zazeniStalne(root, seznam, podpis, odznaci);
}

function zazeniStalne(root: string, seznam: string[], podpis: string, odznaci: boolean): Promise<void> {
  mnozice.set(root, new Set(seznam));
  const stanje: StanjeGlasu = { pripravljen: false, vTeku: true, razlog: "", pripravljenih: 0, vseh: seznam.length };
  const zapis: ZapisStalnih = { podpis, stanje, tek: Promise.resolve(), ob: ura(), poKoncu: [] };
  stalnaStanja.set(root, zapis);
  zapis.tek = (async () => {
    const na = await izvajalec(root);
    if (typeof na === "string") {
      stanje.razlog = na;
      return;
    }
    const kljuci = new Set<string>();
    // Slog: hitrejsi samo, ce je zelen IN so vsi stalni posnetki v njem ze pripravljeni (brez sinteze med klicem); sicer prejsnji slog.
    const zelen = await zeleniSlog(root).catch(() => undefined);
    if (zelen) {
      const p = await pripravljenihVSlogu(root, seznam, zelen).catch(() => ({ pripravljenih: 0, vseh: 1 }));
      slogi.delete(root);
      if (p.pripravljenih === p.vseh) slogi.set(root, zelen);
      // Posnetki zelenega sloga ostanejo oznaceni kot stalni tudi, ce ga se ne uporabljamo (pripravljeni vnaprej).
      const sol = await solZvoka(root);
      for (const st of seznam) kljuci.add(kljucZvoka(sol, st, undefined, undefined, "", zelen));
    } else slogi.delete(root);
    const izid: { napaka: KodaGlasu | ""; status: number | null } = { napaka: "", status: null };
    let cakajo = [...seznam];
    let zapisano = false;
    for (let krog = 0; ; krog += 1) {
      const vrsta = [...cakajo];
      const neuspeli: Array<{ stavek: string; error: unknown }> = [];
      // Dva hkrati in ponovitev ob 429 z narascajocim zamikom: meritev vodje 10. 11. 2026 je s tremi hkrati
      // dobila 429 in stavki so ostali brez posnetka.
      const delavec = async (): Promise<void> => {
        for (;;) {
          const stavek = vrsta.shift();
          if (stavek === undefined || stalnaStanja.get(root) !== zapis) return;
          try {
            kljuci.add(await pripraviZvok(stavek, root, { stalno: true, zamiki: ZAMIKI_PRIPRAVE_MS }));
            stanje.pripravljenih += 1;
          } catch (error) {
            neuspeli.push({ stavek, error });
          }
        }
      };
      await Promise.all(Array.from({ length: SOCASNIH_PRIPRAV }, () => delavec()));
      if (stalnaStanja.get(root) !== zapis) return;
      if (neuspeli.length === 0) break;
      const prva = razlogNapakeGlasu(neuspeli[0].error);
      // Omejitev ponudnika (429) mine sama: stavke, ki so jo dobili, po premoru pripravimo znova, da vrstica
      // »Glas« ne ostane za vedno pri 24 od 25 (meritev vodje 10. 11. 2026). Druge napake ostanejo v stanju.
      const samoOmejitev = neuspeli.every(({ error }) => error instanceof NapakaGlasu && error.status === 429);
      if (!zapisano) {
        zapisano = true;
        const napaka0 = neuspeli[0].error;
        const vzrok = napaka0 instanceof NapakaGlasu ? (napaka0.vzrok ?? "ponudnik") : `izjema:${napaka0 instanceof Error ? napaka0.name : typeof napaka0}`;
        await zapisiRazlogGlasu(root, prva.razlog, prva.status, "priprava", vzrok);
      }
      if (!samoOmejitev || krog >= NAJVEC_KROGOV_PRIPRAVE) {
        izid.napaka = prva.razlog;
        izid.status = prva.status;
        break;
      }
      stanje.razlog = prva.razlog;
      await premor(PREMOR_OMEJITVE_MS);
      if (stalnaStanja.get(root) !== zapis) return;
      stanje.razlog = "";
      cakajo = neuspeli.map(({ stavek }) => stavek);
    }
    if (izid.napaka) {
      stanje.razlog = izid.napaka;
      return;
    }
    if (odznaci) await odznaciStare(root, kljuci);
    await pocistiZvok(root);
    stanje.pripravljen = true;
  })()
    .catch(() => {
      if (!stanje.razlog) stanje.razlog = "glasNapaka";
    })
    .finally(() => {
      stanje.vTeku = false;
      zapis.ob = ura();
    })
    .then(async () => {
      for (const delo of zapis.poKoncu.splice(0)) await delo().catch(() => undefined);
    });
  return zapis.tek;
}

/** V ozadju: zahteva (odprtje linije, shranjevanje pozdrava, klic) ne caka na sintezo. */
export function pripraviStalneVOzadju(dir: string | undefined, stavki: string[]): void {
  void pripraviStalne(dir, stavki).catch(() => undefined);
}

const DNEVNIK_GLASU = "glas-dnevnik.json";
const NAJVEC_ZAPISOV = 50;
const ISTI_RAZLOG_MS = 10 * 60 * 1000;
/** Kje je glas odpovedal: priprava stalnih stavkov, pozdrav ali odgovor v klicu. Brez vsebine. */
export type MestoGlasu = "priprava" | "pozdrav" | "odgovor";
/** vzrok: »kakovost« (posnetek po vseh poskusih ni prestal ocene), »ponudnik« (NapakaGlasu brez stanja) ali »izjema:<ime>« (nepricakovana napaka); NapakaGlasu lahko nosi svojo oznako (rok, omrezje, zeton, brez_zvoka, predolg_odgovor, neveljavno_besedilo); brez vsebine. */
type ZapisDnevnika = { at: string; razlog: KodaGlasu; status?: number; kje?: MestoGlasu; vzrok?: string };
const vrsteDnevnika = new Map<string, Promise<void>>();

/**
 * Razlog, zakaj je klic govoril z rezervo. V dnevniku je samo cas, koda razloga, stanje HTTP in mesto:
 * nobene vsebine pogovora, stevilke, kljuca ali zetona. Vsak odgovor v rezervi dobi svoj zapis (meritev vodje
 * 10. 11. 2026: en sam zapis je skril, da nobeden od odgovorov ni dobil glasu); samo »ni prijave Google Cloud«
 * se v 10 minutah ne ponavlja, ker velja za vsak obrat.
 */
export function zapisiRazlogGlasu(
  dir: string | undefined,
  razlog: KodaGlasu,
  status: number | null = null,
  kje: MestoGlasu = "odgovor",
  vzrok?: string,
): Promise<void> {
  const root = resolveDataDir(dir);
  const prej = vrsteDnevnika.get(root) ?? Promise.resolve();
  const tek = prej
    .then(async () => {
      const zapisi = (await readJsonFile<ZapisDnevnika[]>(root, DNEVNIK_GLASU).catch(() => null)) ?? [];
      const seznam = Array.isArray(zapisi) ? zapisi : [];
      const zadnji = seznam[seznam.length - 1];
      const ponovljiv = razlog === "glasNiVertex";
      if (ponovljiv && zadnji && zadnji.razlog === razlog && ura() - Date.parse(zadnji.at) < ISTI_RAZLOG_MS) return;
      seznam.push({ at: new Date(ura()).toISOString(), razlog, ...(status ? { status } : {}), kje, ...(vzrok ? { vzrok } : {}) });
      await writeJson(root, DNEVNIK_GLASU, seznam.slice(-NAJVEC_ZAPISOV));
    })
    .catch(() => undefined);
  vrsteDnevnika.set(root, tek);
  return tek;
}

/** Pocaka zapise dnevnika glasu, ki se tecejo (preizkusi). */
export function pocakajDnevnikGlasu(dir?: string): Promise<void> {
  return vrsteDnevnika.get(resolveDataDir(dir)) ?? Promise.resolve();
}

function niNajdeno(): Response {
  return new Response("Ni najdeno", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Najvec zahtev na javno pot zvoka v oknu. Klic prebere nekaj posnetkov na obrat; vec je ugibanje kljucev. */
export const ZVOK_OKNO_MS = 10_000;
export const ZVOK_NAJVEC_ZAHTEV = 120;
let oknoZvoka = { od: 0, zahtev: 0 };

function prevecZahtev(zdaj: number): boolean {
  if (zdaj - oknoZvoka.od >= ZVOK_OKNO_MS) oknoZvoka = { od: zdaj, zahtev: 0 };
  oknoZvoka.zahtev += 1;
  return oknoZvoka.zahtev > ZVOK_NAJVEC_ZAHTEV;
}

/** Samo za preizkuse. */
export function ponastaviOmejitevZvoka(): void {
  oknoZvoka = { od: 0, zahtev: 0 };
}

/**
 * Merilnik verige (lastnik 14. 11. 2026: »kje je cas«): ob pripravljenem prvem posnetku obrata voice.server zabelezi (kljuc, klic, obrat, ura);
 * ob prvem GET /zvok za ta kljuc se izmeri, koliko je trajalo od pripravljenosti do zahteve (TwiML po tunelu + Twilio prenos) in koliko strezba.
 * Samo stevila, nobene vsebine; zapis v ozadju (ne zadrzuje odgovora). Najvec 64 vnosov, vnos se porabi ob prvem GET.
 */
type Priprava = { sid: string; obrat: number; t: number };
const pripravljeniKosi = new Map<string, Priprava>();
let javiPrenos: ((sid: string, obrat: number, prislo: number, poslan: number, dir: string) => void) | null = null;
export function nastaviJavljanjePrenosa(f: typeof javiPrenos): void {
  javiPrenos = f;
}
export function zabeleziPripravoKosa(kljuc: string, sid: string, obrat: number): void {
  if (!kljuc || !sid) return;
  if (pripravljeniKosi.size >= 64) pripravljeniKosi.delete(pripravljeniKosi.keys().next().value as string);
  pripravljeniKosi.set(kljuc, { sid, obrat, t: ura() });
}

/**
 * Javna pot GET /api/voice/zvok/<kljuc>.wav. Brez prijave, ker jo Twilio bere brez nase seje;
 * varuje jo kljuc (128 bitov HMAC z nakljucno soljo namestitve). V pot na disku gre samo kljuc,
 * ki je prestal regex - nikoli niz iz zahteve. Vse drugo je 404 brez razlike med »ni« in »ni dovoljeno«.
 * Nestalni posnetek po roku 10 minut je 404, tudi ce datoteka se obstaja (pregled G2, V2).
 */
export async function handleZvokRequest(request: Request, dir?: string, moznosti: { najvecBajtov?: number } = {}): Promise<Response> {
  if (request.method !== "GET") return niNajdeno();
  let kljuc: string | null = null;
  try {
    kljuc = kljucIzPoti(new URL(request.url).pathname);
  } catch {
    return niNajdeno();
  }
  const zdaj = ura();
  if (prevecZahtev(zdaj)) {
    return new Response("Prevec zahtev", {
      status: 429,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "10" },
    });
  }
  if (!kljuc) return niNajdeno();
  const root = resolveDataDir(dir);
  const file = potWav(root, kljuc);
  let rocaj: Awaited<ReturnType<typeof open>> | null = null;
  try {
    // Mapa zvok ne sme biti simbolna povezava drugam (pregled G2, N2): prava pot mape je pod pravo potjo podatkov.
    const pravaMapa = await realpath(mapaZvoka(root));
    if (pravaMapa !== path.join(await realpath(root), "zvok")) return niNajdeno();
    // O_NOFOLLOW in fstat na ISTEM rocaju: med preverbo in branjem datoteke ni mogoce zamenjati s povezavo.
    // Na Windows zastavice ni (vrednost 0); tam navaden uporabnik simbolnih povezav ne ustvarja.
    rocaj = await open(file, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
    const info = await rocaj.stat();
    if (!info.isFile() || info.size < 44 || info.size > (moznosti.najvecBajtov ?? NAJVEC_POSNETKA)) return niNajdeno();
    if (zdaj - info.mtimeMs >= STAROST_NESTALNIH_MS && !(await obstaja(potOznake(root, kljuc)))) return niNajdeno();
    const telo = await rocaj.readFile();
    const priprava = pripravljeniKosi.get(kljuc);
    if (priprava) {
      pripravljeniKosi.delete(kljuc);
      javiPrenos?.(priprava.sid, priprava.obrat, zdaj - priprava.t, ura() - zdaj, root);
    }
    return new Response(new Uint8Array(telo), {
      status: 200,
      headers: {
        "content-type": "audio/wav",
        "content-length": String(telo.length),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return niNajdeno();
  } finally {
    await rocaj?.close().catch(() => undefined);
  }
}

/**
 * Surovi WAV posnetka po kljucu (pot Gemini Live: stalni stavki gredo v Twilio kot mu-law okvirji, ne kot <Play>).
 * Isti varnostni pogoji kot pri handleZvokRequest: kljuc je 32 hex znakov, O_NOFOLLOW, fstat na istem rocaju, meja velikosti.
 * Null, ce posnetka ni ali ni veljaven.
 */
export async function preberiWavPosnetka(root: string, kljuc: string): Promise<Uint8Array | null> {
  if (!jeKljucZvoka(kljuc)) return null;
  let rocaj: Awaited<ReturnType<typeof open>> | null = null;
  try {
    rocaj = await open(potWav(root, kljuc), FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
    const info = await rocaj.stat();
    if (!info.isFile() || info.size < 44 || info.size > NAJVEC_POSNETKA) return null;
    return new Uint8Array(await rocaj.readFile());
  } catch {
    return null;
  } finally {
    await rocaj?.close().catch(() => undefined);
  }
}

/**
 * Trajanje WAV posnetka v ms iz glave (byteRate + velikost bloka »data«). 0, ce glave ni mogoce prebrati.
 * Osebna tajnica po tem presodi, ali je govor prisel med pozdravom (voice.server, okno pozdrava).
 */
export function trajanjeWavMs(wav: Uint8Array): number {
  if (wav.byteLength < 44) return 0;
  const pogled = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const znak = (od: number) => String.fromCharCode(wav[od] ?? 0, wav[od + 1] ?? 0, wav[od + 2] ?? 0, wav[od + 3] ?? 0);
  if (znak(0) !== "RIFF" || znak(8) !== "WAVE") return 0;
  const bajtovNaSekundo = pogled.getUint32(28, true);
  if (bajtovNaSekundo <= 0) return 0;
  let od = 12;
  while (od + 8 <= wav.byteLength) {
    const velikost = pogled.getUint32(od + 4, true);
    if (znak(od) === "data") return Math.round((Math.min(velikost, wav.byteLength - od - 8) / bajtovNaSekundo) * 1000);
    od += 8 + velikost + (velikost % 2);
  }
  return 0;
}
