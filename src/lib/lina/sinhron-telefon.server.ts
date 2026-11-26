import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { MEJA_SPOROCIL, vVrstiPogovora, type SporociloAsistenta } from "./asistent-pogovor.server.ts";
import { nastaviNavodilaIzTelefona } from "./pravila.server.ts";
import { praviUnicode } from "./kanal-claude.ts";
import { MEJA_DOBESEDNO } from "./dobesedno-meja.ts";
import { SEJA_ASISTENTA } from "./spomin-pogovor.server.ts";
import { zapisiObrat } from "./spomin-baza.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { preberi as preberiImenik } from "./imenik.server.ts";
import { imeVImeniku, klicIzTelefona, potekelKlicTelefona, type IzmenjavaSinhron, type KlicSinhron } from "./klici-telefon.ts";
import { loadPravila } from "./pravila.server.ts";
import type { CallSession } from "./types.ts";
import { vsebinaZapiska } from "./zapiski.ts";
import { ZAPISEK_V_MAPI, izbrisiMapoKlica, mapaKlicaZaPosnetek, mapaZaPisanje, zapisiZapisekKlica } from "./zapiski.server.ts";

/**
 * Sinhronizacija telefona z racunalnikom (lastnik 20. 11. 2026): zapisi klicev (ime, stevilka, podjetje, sporocilo; od 0.2.14 tudi
 * celoten prepis pogovora, naloga 17), pogovor in navodila lastnika. Racunalnik steje REVIZIJE (po zgledu Codync: vsaka sprememba dobi narascajoco stevilko, naprava se po
 * ponovni povezavi nadaljuje od zadnje, ki jo pozna): ni primerjanja ur in ni izgube ob prekinitvi. Zapisi klicev so nespremenljivi
 * (isti id = isti zapis), zato dvojnikov ni.
 */
export const DATOTEKA_SINHRON = "sinhron-telefon.json";
/**
 * Mape klicev s telefona (naloga 17): id klica -> id zapiska (zapiski.server.ts); "" = iz zapisa mape ni bilo mogoce narediti.
 * Locena majhna datoteka: velikega stanja sinhronizacije ni treba prepisati, ko nastane mapa, in k ostane enak, kot ga je poslal telefon.
 */
export const DATOTEKA_MAP = "sinhron-telefon-mape.json";
export const MEJA_KLICEV = 1000;
export const MEJA_ODGOVORA = 300;
/** Odgovor telefona sme imeti najvec 64 KiB (AsistentProtokol.NAJVEC_ODGOVORA): vnosi se dodajajo do te meje, ostalo v naslednjem krogu. */
export const MEJA_ODGOVORA_B = 48 * 1024;
export const MEJA_BESEDILA = 2000;
export { MEJA_DOBESEDNO };
export const MEJA_NAVODIL = 1500;
export const MEJA_VNOSOV_ZAHTEVE = 300;
const ID_KLICA = /^[A-Za-z0-9._-]{1,80}$/;
/**
 * Prepis klica s telefona (naloga 17; pogodba POROCILO-17-telefon.md): najvec 400 izmenjav, prepis <= 24 KiB JSON UTF-8 in cel zapis
 * <= 46 KiB. Zapis gre telefonu nazaj v odgovoru (MEJA_ODGOVORA_B, vsaj en vnos vedno), telefon sprejme najvec 64 KiB: vecji zapis bi
 * sinhronizacijo za vedno zataknil. Meje v bajtih, ne v znakih (3-bajtni znaki).
 */
export const MEJA_IZMENJAV = 400;
export const MEJA_PREPISA_B = 24 * 1024;
export const MEJA_ZAPISA_B = 46 * 1024;
/**
 * Najvec novih map klicev v enem krogu sinhronizacije (stari zapisi dobijo mapo postopoma): vsaka mapa je zapis s fsync v vrsti
 * sinhronizacije, zato vec map podaljsa odgovor telefonu (50 na krog je v preizkusu s 305 klici preseglo 5 s).
 */
const NAJVEC_MAP_NA_KROG = 10;
/**
 * Kaj racunalnik zna (pogodba s telefonom 0.2.14, POROCILO-17t-popravki.md): prepis-v1 = prepisPogovora sprejme in shrani, tudi za znan
 * id brez prepisa; izbris-v1 = klice s seznama izbrisani izbrise (zapis, prepis, mapa) in jih ne vrne vec. Telefon na izbris-v1 izbrise
 * svojo vrsto izbrisov, zato se javi samo, ko so vsi izbrisi te zahteve res opravljeni.
 */
export const ZMOZNOST_PREPIS = "prepis-v1";
export const ZMOZNOST_IZBRIS = "izbris-v1";
/** Izbrisani klici (kot telefon MEJA_IZBRISANIH): zapis z id s tega seznama se ne sprejme vec. */
export const MEJA_IZBRISANIH = 1000;

export type { IzmenjavaSinhron, KlicSinhron };
export type PogovorSinhron = { vloga: "lastnik" | "lina"; besedilo: string; cas: string };
export type NavodilaSinhron = { besedilo: string; cas: number };

type Stanje = {
  /** Nakljucni id stanja: ce se stanje na racunalniku ponastavi, telefon opazi novo epoho in zacne pri reviziji 0. */
  epoha: string;
  rev: number;
  klici: Array<{ rev: number; k: KlicSinhron }>;
  pogovor: Array<{ rev: number; id: string; p: PogovorSinhron }>;
  navodila: { rev: number; n: NavodilaSinhron } | null;
  /** Id klicev, izbrisanih na telefonu ali po roku hrambe (naloga 17r2): ne sprejmejo se vec, mapa klica se izbrise. */
  izbrisani: string[];
};

export type ZahtevaSinhron = {
  rev: number;
  epoha?: string;
  klici: KlicSinhron[];
  pogovor: PogovorSinhron[];
  navodila: NavodilaSinhron | null;
  /** Id klicev, ki jih je uporabnik izbrisal na telefonu (telefon 0.2.14). */
  izbrisani?: string[];
  /** Stevilo zapisov klicev, preskocenih zaradi casZacetka v prihodnosti (21r A8; za dnevnik, brez vsebine). */
  preskoceniPrihodnost?: number;
};
export type OdgovorSinhron = {
  epoha: string;
  rev: number;
  klici: KlicSinhron[];
  pogovor: PogovorSinhron[];
  navodila: NavodilaSinhron | null;
  /** true = je se novejsih vnosov od meje enega odgovora: naprava naj takoj poizve znova od vrnjene revizije. */
  ostane: boolean;
  zmoznosti: string[];
  /** Rok hrambe podjetniskih zapisov v dneh (pravila, celo stevilo 1..3650): telefon ga uporabi za svoj dnevnik (21t A7). Brez polja = pravila neberljiva. */
  rokHrambeDni?: number;
};

/** Zapis klica z zacetkom vec kot dan za uro racunalnika se ne sprejme (21t A8, kot telefon DnevnikKlicev DAN_MS). */
export const PRIHODNOST_KLICA_MS = 86_400_000;

export class NapakaSinhron extends Error {}

const prazno = (): Stanje => ({ epoha: randomBytes(8).toString("hex"), rev: 0, klici: [], pogovor: [], navodila: null, izbrisani: [] });
const imaPrepis = (k: KlicSinhron) => Array.isArray(k.prepisPogovora) && k.prepisPogovora.length > 0;

function besedilo(v: unknown, meja: number, ime: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > meja || !praviUnicode(v)) throw new NapakaSinhron(`Polje ${ime} ni veljavno besedilo do ${meja} znakov.`);
  return v;
}

const bajtov = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

function izmenjava(v: unknown): IzmenjavaSinhron | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.govorec !== "klicatelj" && o.govorec !== "lina") return null;
  if (!Number.isSafeInteger(o.cas) || (o.cas as number) < 0) return null;
  if (typeof o.besedilo !== "string" || o.besedilo.length > MEJA_BESEDILA || !praviUnicode(o.besedilo)) return null;
  return { govorec: o.govorec, cas: o.cas as number, besedilo: o.besedilo };
}

/** Prepis je nezaupan: neveljavna izmenjava se preskoci (ne cel klic), cez mejo ostane zacetek in prepisOkrnjen = true. */
function sPrepisom(klic: KlicSinhron, o: Record<string, unknown>): KlicSinhron {
  if (bajtov({ ...klic, prepisPogovora: [], prepisOkrnjen: false }) > MEJA_ZAPISA_B) throw new NapakaSinhron("Zapis klica je prevelik.");
  if (!Array.isArray(o.prepisPogovora)) return klic;
  let okrnjen = o.prepisOkrnjen === true;
  const meja = Math.min(MEJA_PREPISA_B, MEJA_ZAPISA_B - bajtov({ ...klic, prepisPogovora: [], prepisOkrnjen: false }));
  const prepis: IzmenjavaSinhron[] = [];
  let b = 2;
  for (const v of o.prepisPogovora) {
    const x = izmenjava(v);
    if (!x) {
      okrnjen = true; // prepis ima vrzel: ne sme biti videti popoln
      continue;
    }
    const d = bajtov(x) + 1;
    if (prepis.length >= MEJA_IZMENJAV || b + d > meja) {
      okrnjen = true;
      break;
    }
    prepis.push(x);
    b += d;
  }
  return { ...klic, prepisPogovora: prepis, prepisOkrnjen: okrnjen };
}

/**
 * Preveri zapis klica; neveljaven vrze NapakaSinhron. Z uro `zdaj` vrne null za zapis s casZacetka > zdaj + 1 dan (21t A8): ta se
 * preskoci, ne zavrne, da en zapis z napacno uro ne zatakne vrste telefona.
 */
export function preveriKlic(v: unknown): KlicSinhron;
export function preveriKlic(v: unknown, zdaj: number): KlicSinhron | null;
export function preveriKlic(v: unknown, zdaj?: number): KlicSinhron | null {
  const k = preveriObliko(v);
  return zdaj !== undefined && k.casZacetka > zdaj + PRIHODNOST_KLICA_MS ? null : k;
}

function preveriObliko(v: unknown): KlicSinhron {
  if (!v || typeof v !== "object") throw new NapakaSinhron("Zapis klica ni objekt.");
  const o = v as Record<string, unknown>;
  const id = besedilo(o.id, 80, "id");
  if (!ID_KLICA.test(id)) throw new NapakaSinhron("Neveljaven id klica.");
  const cas = o.casZacetka;
  const trajanje = o.trajanjeS;
  // trajanje je na telefonu Int (ZapisKlicaSinhronizacija.trajanjeS): vecje bi telefon zavrnil skupaj s celim odgovorom (slepi pregled 17r2 N2)
  if (!Number.isSafeInteger(cas) || (cas as number) < 0 || !Number.isSafeInteger(trajanje) || (trajanje as number) < 0 || (trajanje as number) > 2 ** 31 - 1) {
    throw new NapakaSinhron("Neveljaven cas ali trajanje klica.");
  }
  const stevilka = besedilo(o.stevilka, 60, "stevilka");
  if (!stevilka.trim()) throw new NapakaSinhron("Stevilka klica je prazna.");
  return sPrepisom({
    id,
    casZacetka: cas as number,
    stevilka,
    trajanjeS: trajanje as number,
    nujno: o.nujno === true,
    povzetek: besedilo(o.povzetek, MEJA_BESEDILA, "povzetek"),
    nacin: o.nacin === "podjetje" ? "podjetje" : "osebna",
    klicatelj: besedilo(o.klicatelj, 240, "klicatelj"),
    podjetje: besedilo(o.podjetje, 240, "podjetje"),
    sporocilo: besedilo(o.sporocilo, MEJA_BESEDILA, "sporocilo"),
    sporociloDobesedno: besedilo(o.sporociloDobesedno, MEJA_DOBESEDNO, "sporociloDobesedno"),
    brezSporocilaRazlog: besedilo(o.brezSporocilaRazlog, MEJA_BESEDILA, "brezSporocilaRazlog"),
  }, o);
}

export function preveriPogovor(v: unknown): PogovorSinhron {
  if (!v || typeof v !== "object") throw new NapakaSinhron("Sporocilo pogovora ni objekt.");
  const o = v as Record<string, unknown>;
  if (o.vloga !== "lastnik" && o.vloga !== "lina") throw new NapakaSinhron("Neveljavna vloga sporocila.");
  const b = besedilo(o.besedilo, MEJA_BESEDILA, "besedilo");
  const cas = besedilo(o.cas, 40, "cas");
  if (!b.trim() || Number.isNaN(Date.parse(cas))) throw new NapakaSinhron("Sporocilo pogovora je prazno ali brez veljavnega casa.");
  return { vloga: o.vloga, besedilo: b, cas };
}

export function preveriZahtevo(v: unknown, zdaj: number = Date.now()): ZahtevaSinhron {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new NapakaSinhron("Vsebina ni objekt.");
  const o = v as Record<string, unknown>;
  const rev = o.rev === undefined ? 0 : o.rev;
  if (!Number.isSafeInteger(rev) || (rev as number) < 0) throw new NapakaSinhron("Neveljavna revizija.");
  const sez = (x: unknown, ime: string): unknown[] => {
    if (x === undefined) return [];
    if (!Array.isArray(x) || x.length > MEJA_VNOSOV_ZAHTEVE) throw new NapakaSinhron(`Seznam ${ime} je neveljaven ali predolg.`);
    return x;
  };
  let navodila: NavodilaSinhron | null = null;
  if (o.navodila !== undefined && o.navodila !== null) {
    const n = o.navodila as Record<string, unknown>;
    if (typeof n !== "object" || !Number.isSafeInteger(n.cas) || (n.cas as number) < 0) throw new NapakaSinhron("Neveljavna navodila.");
    navodila = { besedilo: besedilo(n.besedilo, MEJA_NAVODIL, "navodila").trim(), cas: n.cas as number };
  }
  let preskoceniPrihodnost = 0;
  // Posamezen neveljaven vnos se PRESKOCI (ne zavrne cele zahteve): zastrupljen zapis ne sme za vedno zatakniti sinhronizacije.
  const klici = sez(o.klici, "klici").flatMap((k) => {
    let p: KlicSinhron | null;
    try {
      p = preveriKlic(k, zdaj);
    } catch {
      return [];
    }
    if (!p) preskoceniPrihodnost += 1;
    return p ? [p] : [];
  });
  return {
    rev: rev as number,
    epoha: typeof o.epoha === "string" && /^[0-9a-f]{16}$/.test(o.epoha) ? o.epoha : undefined,
    klici,
    preskoceniPrihodnost,
    pogovor: sez(o.pogovor, "pogovor").flatMap((p) => { try { return [preveriPogovor(p)]; } catch { return []; } }),
    navodila,
    izbrisani: sez(o.izbrisani, "izbrisani").filter((x): x is string => typeof x === "string" && ID_KLICA.test(x)),
  };
}

/** Id sporocila pogovora: ista vloga, cas in besedilo = isto sporocilo (brez dvojnikov med napravama). */
export function idPogovora(p: PogovorSinhron): string {
  return createHash("sha256").update(`${p.vloga}\n${p.cas}\n${p.besedilo}`).digest("hex").slice(0, 24);
}

let vrsta: Promise<unknown> = Promise.resolve();
/** Zapisi stanja se izvajajo drug za drugim (dva telefona ob istem casu ne smeta izgubiti revizij). */
function zaporedno<T>(f: () => Promise<T>): Promise<T> {
  const r = vrsta.then(f, f);
  vrsta = r.catch(() => undefined);
  return r;
}

async function preberiStanje(root: string): Promise<Stanje> {
  let s: Stanje | null;
  try {
    s = await readJsonFile<Stanje>(root, DATOTEKA_SINHRON);
  } catch {
    // vsebine datoteke (stevilke, imena) ne smemo izpisati v dnevnik napake
    throw new Error(`${DATOTEKA_SINHRON} ni berljiva.`);
  }
  if (!s || typeof s !== "object" || !Number.isSafeInteger(s.rev) || !Array.isArray(s.klici) || !Array.isArray(s.pogovor)) return prazno();
  // pokvarjen vnos (null, brez k/p ali rev) bi ob vsaki izmenjavi vrgel izjemo in za vedno ustavil sinhronizacijo: preskoci ga
  const vnos = (x: unknown, polje: "k" | "p") => !!x && typeof x === "object" && Number.isSafeInteger((x as { rev?: unknown }).rev) && !!(x as Record<string, unknown>)[polje] && typeof (x as Record<string, unknown>)[polje] === "object";
  const klici = s.klici.filter((x) => vnos(x, "k") && typeof x.k.id === "string");
  const pogovor = s.pogovor.filter((x) => vnos(x, "p") && typeof x.id === "string" && typeof x.p.cas === "string");
  const izbrisani = Array.isArray(s.izbrisani) ? s.izbrisani.filter((x): x is string => typeof x === "string" && ID_KLICA.test(x)).slice(-MEJA_IZBRISANIH) : [];
  return { epoha: typeof s.epoha === "string" && /^[0-9a-f]{16}$/.test(s.epoha) ? s.epoha : randomBytes(8).toString("hex"), rev: s.rev, klici, pogovor, navodila: s.navodila ?? null, izbrisani };
}

/** null = pravil ni mogoce prebrati (pokvarjen pravila.json): zasilnih 90 dni ne posljemo telefonu, da po njih ne brise (slepi pregled 21r #1). */
async function rokIzPravil(root: string): Promise<number | null> {
  try {
    // CRR6: veljaven JSON, ki ni objekt (null, [], stevilo), loadPravila tiho zamenja s privzetimi - to ni znan rok (manjkajoca datoteka je)
    const surovo = await readFile(path.join(root, "pravila.json"), "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (surovo !== null) {
      const j: unknown = JSON.parse(surovo);
      if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    }
    return (await loadPravila(root)).zapiskiHrambaDni;
  } catch {
    return null;
  }
}

/**
 * Mapa klica (lastnik 22. 11. 2026) za klice s telefona, ki je se nimajo: nov klic in stari zapisi (postopoma). Mapa nastane enkrat;
 * ce jo uporabnik izbrise, se ne vrne. Napaka mape zapiskov (ni pisljiva) ne podre sinhronizacije: poskusi znova v naslednjem krogu.
 */
/** null = datoteke ni mogoce prebrati (pokvarjena): brez nje ne vemo, kateri klici ze imajo mapo. */
async function preberiMape(root: string): Promise<Record<string, string> | null> {
  let m: unknown;
  try {
    m = await readJsonFile<unknown>(root, DATOTEKA_MAP);
  } catch {
    return null;
  }
  const izid: Record<string, string> = Object.create(null);
  if (m && typeof m === "object" && !Array.isArray(m)) for (const [id, v] of Object.entries(m)) if (typeof v === "string") izid[id] = v;
  return izid;
}

async function zapisiMapeKlicev(root: string, st: Stanje): Promise<void> {
  const mape = await preberiMape(root);
  if (!mape) return; // nove mape bi podvojile obstojece (tudi izbrisane): raje nic
  const brez = st.klici.filter((x) => x && typeof x === "object" && typeof x.k?.id === "string" && !(x.k.id in mape)).slice(0, NAJVEC_MAP_NA_KROG);
  if (brez.length === 0) return;
  try {
    await mapaZaPisanje(root);
  } catch {
    return; // mapa zapiskov ni pisljiva: nobenega klica ne oznacimo, poskus v naslednjem krogu
  }
  const stiki = await preberiImenik(root).catch(() => []);
  // samo klici, ki so se v stanju (po roku hrambe ali meji odstranjeni ne ostanejo v datoteki)
  const ostali = new Set(st.klici.map((x) => x?.k?.id));
  const izbrisani = new Set(st.izbrisani);
  for (const x of brez) {
    const c = klicIzTelefona(x.k, imeVImeniku(stiki, x.k.stevilka));
    try {
      mape[x.k.id] = c ? await zapisiZapisekKlica(c, root) : "";
    } catch {
      continue; // napaka enega zapisa ne ustavi ostalih; zapis ostane brez oznake in se poskusi znova
    }
    // oznaka takoj po mapi: ce kasnejsi zapis pade, ta mapa ob naslednjem krogu ne nastane se enkrat; oznaka izbrisanega klica, cigar
    // mape se ni bilo mogoce izbrisati, ostane (izbrisiMapeKlicev jo poskusi znova)
    await writeJson(root, DATOTEKA_MAP, Object.fromEntries(Object.entries(mape).filter(([id]) => ostali.has(id) || izbrisani.has(id))));
  }
}

/**
 * Mape izbrisanih klicev (izbris na telefonu, rok hrambe): izbrise jih in odstrani oznako. Vrne id, katerih mape ni bilo mogoce izbrisati
 * (null = datoteka oznak ni berljiva, ne vemo nic). Oznaka neuspelega ostane za naslednji krog.
 */
async function izbrisiMapeKlicev(root: string, izbrisani: Iterable<string>): Promise<Set<string> | null> {
  const mape = await preberiMape(root);
  if (!mape) return null;
  const neuspeli = new Set<string>();
  let sprememba = false;
  for (const id of izbrisani) {
    if (!(id in mape)) continue;
    if (await izbrisiMapoKlica(mape[id], root)) {
      delete mape[id];
      sprememba = true;
    } else neuspeli.add(id);
  }
  if (sprememba) await writeJson(root, DATOTEKA_MAP, { ...mape });
  return neuspeli;
}

/**
 * Znan klic je dobil prepis (telefon 0.2.14 ga poslje znova po posodobitvi racunalnika): obstojeci zapisek v mapi klica se prepise s
 * prepisom. Mapa, ki je uporabnik izbrisal, se ne vrne; klic brez mape dobi mapo s prepisom v zapisiMapeKlicev.
 */
async function dopolniMape(root: string, klici: Array<{ prej: KlicSinhron; k: KlicSinhron }>): Promise<void> {
  if (klici.length === 0) return;
  const mape = await preberiMape(root);
  if (!mape) return;
  const stiki = await preberiImenik(root).catch(() => []);
  for (const { prej, k } of klici) {
    const zapisek = mape[k.id];
    if (!zapisek) continue;
    try {
      const mapa = await mapaKlicaZaPosnetek({ zapisek } as CallSession, root);
      const pot = mapa && path.join(mapa, ZAPISEK_V_MAPI);
      if (!pot || !(await lstat(pot)).isFile()) continue;
      const ime = imeVImeniku(stiki, k.stevilka);
      // zapisek, ki ga je uporabnik spremenil (ali je drugacen od zapiska brez prepisa), ostane (slepi pregled 17r2 N6)
      const star = klicIzTelefona(prej, ime, zapisek);
      if (!star || (await readFile(pot, "utf8")) !== vsebinaZapiska(star)) continue;
      const c = klicIzTelefona(k, ime, zapisek);
      if (c) await zapisiZapisekKlica(c, root);
    } catch {
      // zapisek ostane brez prepisa (prepis je v stanju in na zaslonu Klici); ponovnega poskusa ni
    }
  }
}

/** Klici s telefona za zaslon Klici (samo branje). Pokvarjen ali neberljiv zapis se preskoci; seznam klicev racunalnika ostane. */
export async function kliciTelefona(dir?: string, odv: { zdaj?: () => number } = {}): Promise<CallSession[]> {
  const root = resolveDataDir(dir);
  let st: Stanje;
  try {
    st = await preberiStanje(root);
  } catch {
    return [];
  }
  const rok = await rokIzPravil(root); // null = rok ni znan: nic ne skrijemo (slepi pregled 24b)
  const zdaj = (odv.zdaj ?? Date.now)();
  const stiki = await preberiImenik(root).catch(() => []);
  const mape = (await preberiMape(root)) ?? {};
  return st.klici.flatMap((x) => {
    if (!x || typeof x !== "object" || (rok !== null && potekelKlicTelefona(x.k, rok, zdaj))) return [];
    const c = klicIzTelefona(x.k, imeVImeniku(stiki, x.k?.stevilka), (typeof x.k?.id === "string" && mape[x.k.id]) || undefined);
    return c ? [c] : [];
  });
}

/** Izmenja zapise: sprejme, kar je novega od naprave, vrne vse z revizijo nad `zahteva.rev`. */
export function izmenjajSinhron(zahteva: ZahtevaSinhron, dir?: string, odv: { zdaj?: () => number } = {}): Promise<OdgovorSinhron> {
  const root = resolveDataDir(dir);
  return zaporedno(async () => {
    const st = await preberiStanje(root);
    let sprememba = false;
    // Telefon pozna drugo epoho (stanje na racunalniku je bilo ponastavljeno): vse novejse od 0, telefon si zapomni novo epoho.
    const revTelefona = zahteva.epoha !== undefined && zahteva.epoha !== st.epoha ? 0 : zahteva.rev;
    // Izbris na telefonu (17r2, N3): id gre na seznam izbrisanih (zadnji na konec), zapis s prepisom iz stanja, mapa klica spodaj.
    const izbrisani = new Set(st.izbrisani);
    const dodajIzbrisan = (id: string) => {
      izbrisani.delete(id);
      izbrisani.add(id);
      sprememba = true;
    };
    for (const id of zahteva.izbrisani ?? []) dodajIzbrisan(id);
    const znaniKlici = new Map(st.klici.map((x) => [x.k.id, x]));
    const dopolnjeni: Array<{ prej: KlicSinhron; k: KlicSinhron }> = [];
    for (const k of zahteva.klici) {
      if (izbrisani.has(k.id)) continue;
      const znan = znaniKlici.get(k.id);
      if (znan) {
        // Racunalnik 0.2.13 je klic shranil brez prepisa (17r2, N1): prepis se dopolni, ostala polja ostanejo, kot jih je prvic poslal telefon.
        if (!imaPrepis(znan.k) && imaPrepis(k)) {
          const { prepisPogovora: _p, prepisOkrnjen: _o, ...brez } = znan.k;
          const prej = znan.k;
          try {
            znan.k = sPrepisom(brez, k as unknown as Record<string, unknown>);
            dopolnjeni.push({ prej, k: znan.k });
            sprememba = true;
          } catch {
            // obstojeci zapis je ze sam prevelik: ostane brez prepisa
          }
        }
        continue;
      }
      st.rev += 1;
      const vnos = { rev: st.rev, k };
      st.klici.push(vnos);
      znaniKlici.set(k.id, vnos);
      sprememba = true;
    }
    if (st.klici.length > MEJA_KLICEV) st.klici = st.klici.slice(-MEJA_KLICEV);
    // Rok hrambe podjetniskih zapisov (lastnik 22. 11. 2026, privzeto 90 dni): zapis s prepisom gre iz sinhronizacije, mapa klica z njim (N4).
    // slepi pregled 24b: neberljiva pravila = rok ni znan -> nic ne izbrisemo (zasilnih 90 dni bi trajno izbrisalo zapise 90-365 dni, tudi na telefonu)
    const rokPravil = await rokIzPravil(root);
    const zdaj = (odv.zdaj ?? Date.now)();
    if (rokPravil !== null) for (const x of st.klici) if (x && typeof x === "object" && potekelKlicTelefona(x.k, rokPravil, zdaj)) dodajIzbrisan(x.k.id);
    const pred = st.klici.length;
    st.klici = st.klici.filter((x) => !izbrisani.has(x.k.id));
    if (st.klici.length !== pred) sprememba = true;
    st.izbrisani = [...izbrisani].slice(-MEJA_IZBRISANIH);

    const znaniPogovor = new Set(st.pogovor.map((x) => x.id));
    const dodajPogovor = (p: PogovorSinhron): boolean => {
      const id = idPogovora(p);
      if (znaniPogovor.has(id)) return false;
      st.rev += 1;
      st.pogovor.push({ rev: st.rev, id, p });
      znaniPogovor.add(id);
      sprememba = true;
      return true;
    };
    // Pogovor na racunalniku (asistent.json) gre k telefonu, pogovor s telefona na racunalnik: skupen pogovor.
    // Branje in zapis asistent.json v skupni vrsti pogovora (pregled 0225 B5): vmesni zapis pogovora ali sporocila o gradnji se ne izgubi.
    const noviIzTelefona: PogovorSinhron[] = [];
    await vVrstiPogovora(root, async () => {
      const lokalni = await readJsonFile<SporociloAsistenta[]>(root, "asistent.json");
      for (const s of Array.isArray(lokalni) ? lokalni : []) {
        try {
          dodajPogovor(preveriPogovor({ vloga: s.vloga, besedilo: String(s.besedilo).slice(0, MEJA_BESEDILA), cas: s.cas }));
        } catch {
          // pokvarjen vnos na racunalniku se preskoci, sinhronizacija ne odpove
        }
      }
      const najstarejsi = st.pogovor.length >= MEJA_SPOROCIL ? Math.min(...st.pogovor.map((x) => Date.parse(x.p.cas))) : -Infinity;
      // Spomin pogovorov (22. 11. 2026: Lina dela tudi brez racunalnika): sporocila, ki so s telefona prisla NA NOVO, gredo tudi v spomin
      // racunalnika (spomin.sqlite); racunalniska sporocila je zapisal ze asistentPogovor, zato jih tu ne podvajamo.
      for (const p of zahteva.pogovor) if (Date.parse(p.cas) >= najstarejsi && dodajPogovor(p)) noviIzTelefona.push(p);
      st.pogovor.sort((a, b) => Date.parse(a.p.cas) - Date.parse(b.p.cas) || a.rev - b.rev);
      if (st.pogovor.length > MEJA_SPOROCIL) st.pogovor = st.pogovor.slice(-MEJA_SPOROCIL);

      const n = zahteva.navodila;
      if (n && (!st.navodila || n.cas > st.navodila.n.cas)) {
        if (await nastaviNavodilaIzTelefona(n.besedilo, root)) {
          st.rev += 1;
          st.navodila = { rev: st.rev, n };
          sprememba = true;
        }
      }

      if (sprememba) await writeJson(root, DATOTEKA_SINHRON, st);
      // Racunalniski pogovor dobi sporocila s telefona (zadnjih MEJA_SPOROCIL, po casu). Preverimo tudi brez spremembe,
      // da neuspel prejsnji zapis asistent.json ob ponovnem poskusu popravimo (brez nove revizije).
      const zeljen = st.pogovor.map((x) => x.p);
      if (sprememba || JSON.stringify(Array.isArray(lokalni) ? lokalni : []) !== JSON.stringify(zeljen)) await writeJson(root, "asistent.json", zeljen);
    });
    // Mape izbrisanih klicev (po zapisu stanja: zapisa ni vec, tudi ce mapa ne uspe; oznaka ostane za ponovni poskus).
    const neuspeliIzbrisi = await izbrisiMapeKlicev(root, st.izbrisani).catch(() => null);
    const izbrisOpravljen = neuspeliIzbrisi !== null && !(zahteva.izbrisani ?? []).some((id) => neuspeliIzbrisi.has(id));
    await dopolniMape(root, dopolnjeni).catch(() => undefined);
    // Mapa klica za nove in stare klice (po zapisu stanja: klic je ze sprejet, ce mapa ne uspe).
    await zapisiMapeKlicev(root, st).catch(() => undefined);
    for (const p of noviIzTelefona) {
      try {
        await zapisiObrat({ seja: SEJA_ASISTENTA, vloga: p.vloga === "lina" ? "lina" : "uporabnik", besedilo: p.besedilo, cas: p.cas }, { dir: root });
      } catch {
        // napaka spomina ne podre sinhronizacije
      }
    }

    type Vnos = { rev: number; k?: KlicSinhron; p?: PogovorSinhron; n?: NavodilaSinhron };
    const vnosi: Vnos[] = [
      ...st.klici.filter((x) => x.rev > revTelefona).map((x) => ({ rev: x.rev, k: x.k })),
      ...st.pogovor.filter((x) => x.rev > revTelefona).map((x) => ({ rev: x.rev, p: x.p })),
      ...(st.navodila && st.navodila.rev > revTelefona ? [{ rev: st.navodila.rev, n: st.navodila.n }] : []),
    ].sort((a, b) => a.rev - b.rev);
    const vzeti: Vnos[] = [];
    let bajti = 512;
    for (const v of vnosi) {
      let vnos = v;
      // Vnos nad mejo zapisa (star ali podtaknjen v stanju; 17r2, N2) bi presegel 64 KiB telefona in za vedno ustavil sinhronizacijo:
      // gre brez prepisa z oznako okrnjenosti; ce je prevelik tudi tako, se preskoci, revizija pa gre naprej.
      if (v.k && bajtov(v.k) > MEJA_ZAPISA_B) {
        const brez = { ...v.k, prepisPogovora: [], prepisOkrnjen: true };
        vnos = bajtov(brez) > MEJA_ZAPISA_B ? { rev: v.rev } : { rev: v.rev, k: brez };
      }
      const vsebina = vnos.k ?? vnos.p ?? vnos.n;
      const velikost = vsebina ? bajtov(vsebina) + 2 : 0;
      if (vzeti.length >= MEJA_ODGOVORA || (vzeti.length > 0 && bajti + velikost > MEJA_ODGOVORA_B)) break;
      vzeti.push(vnos);
      bajti += velikost;
    }
    const ostane = vnosi.length > vzeti.length;
    return {
      epoha: st.epoha,
      rev: ostane ? vzeti[vzeti.length - 1].rev : st.rev,
      klici: vzeti.flatMap((x) => (x.k ? [x.k] : [])),
      pogovor: vzeti.flatMap((x) => (x.p ? [x.p] : [])),
      navodila: vzeti.find((x) => x.n)?.n ?? null,
      ostane,
      zmoznosti: izbrisOpravljen ? [ZMOZNOST_PREPIS, ZMOZNOST_IZBRIS] : [ZMOZNOST_PREPIS],
      ...(rokPravil === null ? {} : { rokHrambeDni: rokPravil }),
    };
  });
}
