/**
 * Novice v Lini: strezniski del. Viri (RSS/Atom, Reddit, YouTube, Hacker News) se berejo SAMO prek varnega prenosa:
 * samo https na vratih 443, zasebni in lokalni naslovi so zavrnjeni (tudi po DNS in po vsaki preusmeritvi), najvec 3 preusmeritve,
 * rok 8 s na zahtevo, najvec 1 MB, nikoli piskotkov ali prijave. Vsebina virov so PODATKI: model jih dobi oznacene,
 * njegov izhod se razbere samo kot stevila in kratek povzetek, novica nikoli ne sproži dejanja.
 *
 * Datoteke (lokalno, samo lastnik): novice.json (viri, zanimanja, nastavitve), novice-predpomnilnik.json, novice-ocene.json.
 * Komentarji so brez sumnikov.
 */
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { requireOwner } from "./auth.server.ts";
import { t } from "./besedila.ts";
import { pogovorBrain, razlogBrezAsistentke } from "./keys.server.ts";
import {
  MEJA_HN,
  MEJA_POSTAVK,
  MEJA_POSTAVK_NA_VIR,
  MEJA_VIROV,
  NAVODILO_OCENE,
  PRIVZETE_NASTAVITVE,
  besediloOcene,
  idjiHn,
  naslovVira,
  ocistiNastavitve,
  ocistiPostavke,
  ocistiVire,
  ocistiZanimanja,
  osnovnaOcena,
  postavkaIzHn,
  pregled,
  pripraviVir,
  razberiFeed,
  razberiOceneModela,
  uveljaviOcene,
  zdruzi,
  type NoviceNastavitve,
  type Postavka,
  type Vir,
} from "./novice.ts";
import { NOVIC_V_ODGOVORU, PRIVZETI_VIRI_NOVIC, izmenicnoPoVirih, odgovorNovic, poTemi, type NovicaOdgovora } from "./novice-pogovor.ts";
import { callProvider, hideSecret } from "./providers.ts";
import { MEJA_BAJTOV, MEJA_SKOKOV, jeZasebniIp, razberiNaslov, type SpletOdgovor, type SpletPovezava, type SpletZahteva } from "./splet.ts";
import { poveziHttps, razresiDns } from "./splet-povezava.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

const D_NASTAVITVE = "novice.json";
const D_PREDPOMNILNIK = "novice-predpomnilnik.json";
const D_OCENE = "novice-ocene.json";

export const ROK_PREDPOMNILNIKA_MS = 10 * 60_000;
const ROK_VIRA_MS = 8_000;
const HKRATI_VIROV = 4;
const HKRATI_HN = 6;
const AGENT = "Lina/1.0 (bralnik novic)";
const SPREJMI = "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, application/json;q=0.8, */*;q=0.5";
const HN_SEZNAM = "https://hacker-news.firebaseio.com/v0/topstories.json";
const hnZgodba = (id: number) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

export const MEJA_OCENJEVANJA = 40;
const PAKET_OCEN = 10;
const HKRATI_OCEN = 2;
const MEJA_SHRANJENIH_OCEN = 800;

/* ------------------------------------------------------------------ napake */

export type KodaNapake = "naslov" | "zasebno" | "rok" | "status" | "oblika" | "omrezje" | "skoki";
const KODE: readonly KodaNapake[] = ["naslov", "zasebno", "rok", "status", "oblika", "omrezje", "skoki"];
export type NapakaVira = { virId: string; ime: string; koda: KodaNapake; status?: number };

class NapakaPrenosa extends Error {
  readonly koda: KodaNapake;
  readonly status?: number;
  // Brez lastnosti parametrov: preizkusi tecejo z node --experimental-strip-types, ki jih ne podpira.
  constructor(koda: KodaNapake, status?: number) {
    super(koda);
    this.koda = koda;
    this.status = status;
  }
}

export type NoviceOdv = {
  razresi: (gostitelj: string) => Promise<string[]>;
  povezava: SpletPovezava;
  zdaj?: () => Date;
  /** Rok ene zahteve v ms (privzeto 8 s); samo za preizkus. */
  rokMs?: number;
};

/* ------------------------------------------------------------------ varen prenos */

async function poklici(odv: NoviceOdv, zahteva: SpletZahteva): Promise<{ odg: SpletOdgovor; signal: AbortSignal }> {
  const signal = AbortSignal.timeout(zahteva.rokMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rok = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NapakaPrenosa("rok")), zahteva.rokMs);
  });
  rok.catch(() => undefined);
  try {
    const odg = await Promise.race([odv.povezava(zahteva, signal), rok]);
    return { odg, signal };
  } catch (error) {
    if (error instanceof NapakaPrenosa) throw error;
    throw new NapakaPrenosa(signal.aborted ? "rok" : "omrezje");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Telo do meje; po izteku roka ali ob napaki toka konca z napako. Predolgo telo se tiho odreze (razclenjevalnik prenese okrnjen XML). */
async function preberiTelo(odg: SpletOdgovor, signal: AbortSignal): Promise<Buffer> {
  const kosi: Buffer[] = [];
  let n = 0;
  const it = odg.telo[Symbol.asyncIterator]();
  let sprozilec: (() => void) | undefined;
  const prekinjeno = new Promise<never>((_, reject) => {
    sprozilec = () => reject(new NapakaPrenosa("rok"));
    if (signal.aborted) sprozilec();
    else signal.addEventListener("abort", sprozilec, { once: true });
  });
  prekinjeno.catch(() => undefined);
  try {
    while (n < MEJA_BAJTOV) {
      const korak = await Promise.race([it.next(), prekinjeno]);
      if (korak.done) break;
      const buf = Buffer.from(korak.value);
      const ostane = MEJA_BAJTOV - n;
      kosi.push(buf.length > ostane ? buf.subarray(0, ostane) : buf);
      n += Math.min(buf.length, ostane);
    }
  } catch (error) {
    if (error instanceof NapakaPrenosa) throw error;
    throw new NapakaPrenosa(signal.aborted ? "rok" : "omrezje");
  } finally {
    if (sprozilec) signal.removeEventListener("abort", sprozilec);
    odg.prekini();
    try {
      await it.return?.();
    } catch {
      /* tok je ze zaprt */
    }
  }
  return Buffer.concat(kosi);
}

/** Znakovni nabor iz glave ali XML deklaracije; neznan nabor pade na utf-8. */
export function odkodirajTelo(buf: Buffer, glave: Record<string, string>): string {
  const tip = glave["content-type"] ?? "";
  let oznaka = /charset\s*=\s*["']?([\w.:-]+)/i.exec(tip)?.[1];
  if (!oznaka) oznaka = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(buf.subarray(0, 200).toString("latin1"))?.[1];
  try {
    return new TextDecoder(oznaka || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/**
 * Prenese besedilo vira. Vsak skok (tudi preusmeritev na drug gostitelj) znova preveri: https, vrata 443, brez gesla,
 * ime ni lokalno in NOBEN naslov iz DNS ni zaseben. Povezava gre na preverjeni IP (SNI ostane ime), zato DNS ne more
 * med preverbo in povezavo podtakniti zasebnega naslova.
 */
export async function prenesiBesedilo(naslov: string, odv: Pick<NoviceOdv, "razresi" | "povezava" | "rokMs">): Promise<{ besedilo: string; url: string }> {
  let trenutni = naslov;
  for (let skok = 0; skok <= MEJA_SKOKOV; skok++) {
    let url: URL;
    try {
      url = razberiNaslov(trenutni);
    } catch (error) {
      throw new NapakaPrenosa(error instanceof Error && error.message === t("spletZasebno") ? "zasebno" : "naslov");
    }
    const gostitelj = url.hostname.replace(/^\[|\]$/g, "");
    const naslovi = isIP(gostitelj) ? [gostitelj] : await odv.razresi(gostitelj).catch(() => [] as string[]);
    if (!naslovi.length) throw new NapakaPrenosa("omrezje");
    if (naslovi.some((ip) => jeZasebniIp(ip))) throw new NapakaPrenosa("zasebno");
    const { odg, signal } = await poklici(odv, {
      ip: naslovi[0],
      vrata: 443,
      gostitelj: url.hostname,
      pot: `${url.pathname}${url.search}` || "/",
      rokMs: odv.rokMs ?? ROK_VIRA_MS,
      agent: AGENT,
      sprejmi: SPREJMI,
    });
    const glave: Record<string, string> = {};
    for (const [k, v] of Object.entries(odg.glave)) glave[k.toLowerCase()] = v;
    if (odg.status >= 300 && odg.status < 400) {
      odg.prekini();
      if (skok === MEJA_SKOKOV) throw new NapakaPrenosa("skoki");
      try {
        trenutni = new URL(glave.location || "", url).href;
      } catch {
        throw new NapakaPrenosa("naslov");
      }
      continue;
    }
    if (odg.status < 200 || odg.status >= 300) {
      odg.prekini();
      throw new NapakaPrenosa("status", odg.status);
    }
    const telo = await preberiTelo(odg, signal);
    return { besedilo: odkodirajTelo(telo, glave), url: url.href };
  }
  throw new NapakaPrenosa("skoki");
}

/* ------------------------------------------------------------------ branje virov */

const ZNACKE_FEEDA = /<(rss|feed|rdf:rdf)[\s>]/i;

async function preberiHn(vir: Vir, odv: NoviceOdv, zdaj: Date): Promise<Postavka[]> {
  const seznam = await prenesiBesedilo(HN_SEZNAM, odv);
  let json: unknown;
  try {
    json = JSON.parse(seznam.besedilo);
  } catch {
    throw new NapakaPrenosa("oblika");
  }
  const idji = idjiHn(json, MEJA_HN);
  if (!idji.length) throw new NapakaPrenosa("oblika");
  const ven: Postavka[] = [];
  let naslednji = 0;
  const delavec = async (): Promise<void> => {
    while (naslednji < idji.length) {
      const id = idji[naslednji++];
      try {
        const o = await prenesiBesedilo(hnZgodba(id), odv);
        const p = postavkaIzHn(JSON.parse(o.besedilo), vir, zdaj);
        if (p) ven.push(p);
      } catch {
        /* ena zgodba ne podre celega vira */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(HKRATI_HN, idji.length) }, delavec));
  if (!ven.length) throw new NapakaPrenosa("omrezje");
  return ven;
}

export async function preberiVir(vir: Vir, odv: NoviceOdv, zdaj: Date): Promise<Postavka[]> {
  if (vir.vrsta === "hn") return preberiHn(vir, odv, zdaj);
  const naslov = naslovVira(vir);
  if (!naslov) throw new NapakaPrenosa("naslov");
  const { besedilo, url } = await prenesiBesedilo(naslov, odv);
  if (!ZNACKE_FEEDA.test(besedilo.slice(0, 4000))) throw new NapakaPrenosa("oblika");
  return razberiFeed(besedilo, vir, zdaj, url).slice(0, MEJA_POSTAVK_NA_VIR);
}

async function vSkupinah<T, R>(elementi: T[], hkrati: number, delo: (e: T) => Promise<R>): Promise<R[]> {
  const ven: R[] = new Array(elementi.length);
  let naslednji = 0;
  const delavec = async (): Promise<void> => {
    while (naslednji < elementi.length) {
      const i = naslednji++;
      ven[i] = await delo(elementi[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(hkrati, elementi.length) }, delavec));
  return ven;
}

/* ------------------------------------------------------------------ shramba */

type Shranjeno = { viri: Vir[]; zanimanja: string; nastavitve: NoviceNastavitve };
type Predpomnilnik = { cas: string | null; viri: string[]; postavke: Postavka[]; napake: NapakaVira[] };
type ZapisOcene = { o: number; p: string; cas: string };

async function preberiShranjeno(root: string): Promise<Shranjeno> {
  const raw = await readJsonFile<Record<string, unknown>>(root, D_NASTAVITVE, { premakniPokvarjen: true });
  const o = raw && typeof raw === "object" ? raw : {};
  return { viri: ocistiVire(o.viri), zanimanja: ocistiZanimanja(o.zanimanja), nastavitve: ocistiNastavitve(o.nastavitve) };
}

async function preberiPredpomnilnik(root: string): Promise<Predpomnilnik> {
  const raw = await readJsonFile<Record<string, unknown>>(root, D_PREDPOMNILNIK, { premakniPokvarjen: true });
  const o = raw && typeof raw === "object" ? raw : {};
  const cas = typeof o.cas === "string" && Number.isFinite(Date.parse(o.cas)) ? o.cas : null;
  const viri = Array.isArray(o.viri) ? o.viri.filter((x): x is string => typeof x === "string").slice(0, MEJA_VIROV) : [];
  const napake: NapakaVira[] = [];
  if (Array.isArray(o.napake)) {
    for (const x of o.napake.slice(0, MEJA_VIROV)) {
      if (!x || typeof x !== "object") continue;
      const n = x as Record<string, unknown>;
      const koda = KODE.find((k) => k === n.koda);
      if (typeof n.virId !== "string" || typeof n.ime !== "string" || !koda) continue;
      napake.push({ virId: n.virId, ime: n.ime.slice(0, 60), koda, ...(typeof n.status === "number" && Number.isFinite(n.status) ? { status: n.status } : {}) });
    }
  }
  return { cas, viri, postavke: ocistiPostavke(o.postavke), napake };
}

async function preberiOcene(root: string): Promise<Record<string, ZapisOcene>> {
  const raw = await readJsonFile<Record<string, unknown>>(root, D_OCENE, { premakniPokvarjen: true });
  // Zapisi v Map in sele nato v objekt: kljuc __proto__ ali constructor ne sme zadeti prototipa.
  const zbrano = new Map<string, ZapisOcene>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  for (const [kljuc, v] of Object.entries(raw).slice(0, MEJA_SHRANJENIH_OCEN * 2)) {
    if (!v || typeof v !== "object") continue;
    const z = v as Record<string, unknown>;
    if (typeof z.o !== "number" || !Number.isFinite(z.o) || z.o < 0 || z.o > 10) continue;
    zbrano.set(kljuc.slice(0, 500), {
      o: z.o,
      p: typeof z.p === "string" ? z.p.replace(/[<>]/g, "").slice(0, 160) : "",
      cas: typeof z.cas === "string" && Number.isFinite(Date.parse(z.cas)) ? z.cas : new Date(0).toISOString(),
    });
  }
  return Object.fromEntries(zbrano);
}

/** En pisalec naenkrat: spremembe nastavitev, predpomnilnika in ocen se ne prepisujejo med seboj. */
let veriga: Promise<unknown> = Promise.resolve();
function vVrsti<T>(delo: () => Promise<T>): Promise<T> {
  const rezultat = veriga.then(delo, delo);
  veriga = rezultat.catch(() => undefined);
  return rezultat;
}

/* ------------------------------------------------------------------ pogled za zaslon */

export type NovicePogled = {
  viri: Vir[];
  zanimanja: string;
  nastavitve: NoviceNastavitve;
  /** Vse novice, najnovejse prve. */
  postavke: Postavka[];
  /** Dnevni pregled: nad pragom, uravnotezen po kategorijah. */
  pregled: Postavka[];
  napake: NapakaVira[];
  osvezeno: string | null;
  ocenjenih: number;
};

function poCasu(a: Postavka, b: Postavka): number {
  return (b.cas ?? "").localeCompare(a.cas ?? "") || a.naslov.localeCompare(b.naslov, "sl");
}

export function sestaviPogled(shranjeno: Shranjeno, predpomnilnik: Predpomnilnik, ocene: Record<string, ZapisOcene>, zdaj: Date): NovicePogled {
  const poId = new Map(shranjeno.viri.map((v) => [v.id, v]));
  // Ime in kategorija veljata taksna, kot sta zdaj pri viru (preimenovanje se pozna brez novega prenosa).
  const vse = uveljaviOcene(
    predpomnilnik.postavke
      .filter((p) => poId.has(p.virId))
      .map((p) => ({ ...p, vir: poId.get(p.virId)!.ime, kategorija: poId.get(p.virId)!.kategorija })),
    ocene,
  );
  return {
    viri: shranjeno.viri,
    zanimanja: shranjeno.zanimanja,
    nastavitve: shranjeno.nastavitve,
    postavke: vse.slice().sort(poCasu),
    pregled: pregled(vse, zdaj, shranjeno.nastavitve),
    napake: predpomnilnik.napake.filter((n) => poId.has(n.virId)),
    osvezeno: predpomnilnik.cas,
    ocenjenih: vse.filter((p) => p.ocena !== null).length,
  };
}

async function trenutniPogled(root: string, zdaj: Date): Promise<NovicePogled> {
  return sestaviPogled(await preberiShranjeno(root), await preberiPredpomnilnik(root), await preberiOcene(root), zdaj);
}

/* ------------------------------------------------------------------ javne funkcije */

export type IzidNovic = { ok: true; pogled: NovicePogled } | { ok: false; sporocilo: string };

const odvPrivzeto = (odv?: Partial<NoviceOdv>): NoviceOdv => ({
  razresi: odv?.razresi ?? razresiDns,
  povezava: odv?.povezava ?? poveziHttps,
  zdaj: odv?.zdaj ?? (() => new Date()),
  rokMs: odv?.rokMs,
});

/** Brez omrezja: samo shranjeno stanje. */
export async function noviceBeri(token: string | null, dir?: string, odv?: Partial<NoviceOdv>): Promise<NovicePogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return trenutniPogled(root, odvPrivzeto(odv).zdaj!());
}

const letece = new Map<string, Promise<NovicePogled>>();

async function osveziNotranje(root: string, sila: boolean, odv: NoviceOdv): Promise<NovicePogled> {
  const zdaj = odv.zdaj!();
  const shranjeno = await preberiShranjeno(root);
  const staro = await preberiPredpomnilnik(root);
  const ocene = await preberiOcene(root);
  const svez =
    staro.cas !== null &&
    zdaj.getTime() - Date.parse(staro.cas) < ROK_PREDPOMNILNIKA_MS &&
    shranjeno.viri.every((v) => staro.viri.includes(v.id));
  if ((!sila && svez) || !shranjeno.viri.length) return sestaviPogled(shranjeno, staro, ocene, zdaj);

  type Rezultat = { vir: Vir; postavke: Postavka[] } | { vir: Vir; napaka: NapakaPrenosa };
  const rezultati = await vSkupinah(shranjeno.viri, HKRATI_VIROV, async (vir): Promise<Rezultat> => {
    try {
      return { vir, postavke: await preberiVir(vir, odv, zdaj) };
    } catch (error) {
      return { vir, napaka: error instanceof NapakaPrenosa ? error : new NapakaPrenosa("omrezje") };
    }
  });
  const nove: Postavka[] = [];
  const napake: NapakaVira[] = [];
  for (const r of rezultati) {
    if ("postavke" in r) {
      nove.push(...r.postavke);
    } else {
      napake.push({ virId: r.vir.id, ime: r.vir.ime, koda: r.napaka.koda, ...(r.napaka.status ? { status: r.napaka.status } : {}) });
      // Prehodna napaka ne izprazni kartice: novice tega vira ostanejo iz prejsnjega prenosa.
      nove.push(...staro.postavke.filter((p) => p.virId === r.vir.id));
    }
  }
  const postavke = zdruzi(nove).sort(poCasu).slice(0, MEJA_POSTAVK);
  const novo: Predpomnilnik = { cas: zdaj.toISOString(), viri: shranjeno.viri.map((v) => v.id), postavke, napake };
  await vVrsti(() => writeJson(root, D_PREDPOMNILNIK, novo));
  return sestaviPogled(shranjeno, novo, ocene, zdaj);
}

/** Osvezi vire (samo ce je predpomnilnik star ali sila). Hkratni klici dobijo isti prenos. */
export async function noviceOsvezi(sila: boolean, token: string | null, dir?: string, odv?: Partial<NoviceOdv>): Promise<NovicePogled> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return osveziEnkrat(root, sila, odvPrivzeto(odv));
}

function osveziEnkrat(root: string, sila: boolean, odv: NoviceOdv): Promise<NovicePogled> {
  const obstojece = letece.get(root);
  if (obstojece) return obstojece;
  const delo = osveziNotranje(root, sila, odv).finally(() => letece.delete(root));
  letece.set(root, delo);
  return delo;
}

/* ------------------------------------------------------------------ novice v pogovoru (naloga 32) */

export type NovicePogovorOdv = Partial<NoviceOdv> & {
  /** Iskanje Brave za »novice o X« (preizkus); privzeto iskanjeBrave z lastnikovim kljucem. */
  isci?: (poizvedba: string) => Promise<{ url: string; naslov: string; izvlecki: string[] }[] | null>;
  imaBrave?: () => Promise<boolean>;
};

/** Privzeti javni viri: en prenos na 10 min za cel proces (vsebina je javna, enaka za vse); shrani se samo uspeh vsaj enega vira. */
let privzetePostavke: { cas: number; postavke: Postavka[]; viri: string[] } | null = null;
let privzetoLeti: Promise<{ postavke: Postavka[]; viri: string[] }> | null = null;

/** Za preizkuse: pozabi predpomnilnik privzetih virov. */
export function pozabiPrivzeteNovice(): void {
  privzetePostavke = null;
  privzetoLeti = null;
}

async function preberiPrivzete(odv: NoviceOdv): Promise<{ postavke: Postavka[]; viri: string[] }> {
  const zdaj = odv.zdaj!();
  const starost = privzetePostavke ? zdaj.getTime() - privzetePostavke.cas : -1;
  // slepi pregled N3: ura nazaj (negativna starost) ni svez predpomnilnik
  if (privzetePostavke && starost >= 0 && starost < ROK_PREDPOMNILNIKA_MS) return privzetePostavke;
  if (privzetoLeti) return privzetoLeti;
  privzetoLeti = (async () => {
    const izidi = await Promise.all(PRIVZETI_VIRI_NOVIC.map((v) => preberiVir(v, odv, zdaj).then((p) => ({ vir: v.ime, p }), () => null)));
    const uspeli = izidi.filter((x): x is { vir: string; p: Postavka[] } => x !== null && x.p.length > 0);
    const izid = { postavke: zdruzi(uspeli.flatMap((x) => x.p)).sort(poCasu), viri: uspeli.map((x) => x.vir) };
    if (uspeli.length) privzetePostavke = { cas: zdaj.getTime(), ...izid };
    return izid;
  })().finally(() => {
    privzetoLeti = null;
  });
  return privzetoLeti;
}

/**
 * Odgovor na vprasanje o novicah v pogovoru (asistentPogovor po requireOwner, orodje orkestratorja preberi_novice). Lastnikovi viri
 * (zaslon Novice, predpomnilnik 10 min) ali privzeti javni viri; za temo brez zadetkov iskanje Brave, ce ima lastnik kljuc (ven gre samo
 * tema, B9). Besedilo sestavi koda (novice-pogovor.ts), model ga ne vidi.
 */
export async function noviceZaPogovor(tema: string | null, dir?: string, odv: NovicePogovorOdv = {}): Promise<string> {
  const root = resolveDataDir(dir);
  const o = odvPrivzeto(odv);
  const shranjeno = await preberiShranjeno(root);
  let vse: NovicaOdgovora[];
  let viri: string[];
  const privzeti = !shranjeno.viri.length;
  if (privzeti) {
    const p = await preberiPrivzete(o);
    vse = p.postavke;
    viri = p.viri.length ? p.viri : PRIVZETI_VIRI_NOVIC.map((v) => v.ime);
  } else {
    const pogled = await osveziEnkrat(root, false, o);
    // dnevni pregled (ocene, zanimanja) ima prednost; brez ocen ostanejo najnovejse
    vse = tema ? pogled.postavke : pogled.pregled.length ? pogled.pregled : pogled.postavke;
    viri = shranjeno.viri.map((v) => v.ime);
  }
  const splosne = izmenicnoPoVirih(vse);
  let postavke: NovicaOdgovora[] = tema ? izmenicnoPoVirih(poTemi(vse, tema)) : splosne;
  let izIskanja = false;
  const brave = await (odv.imaBrave ?? (async () => (await import("./brave.server.ts")).imaKljucBrave(root)))().catch(() => false);
  if (tema && !postavke.length && brave) {
    const isci = odv.isci ?? (async (q: string) => (await import("./brave.server.ts")).iskanjeBrave(q, root));
    const zadetki = (await isci(`novice ${tema}`).catch(() => null)) ?? [];
    postavke = zadetki.slice(0, NOVIC_V_ODGOVORU).map((z) => ({ naslov: z.naslov, povezava: z.url, vir: "splet" }));
    izIskanja = postavke.length > 0;
  }
  return odgovorNovic({ tema, postavke, splosne, viri, privzeti, izIskanja, brave });
}

export async function noviceDodajVir(
  vhod: { vrsta?: unknown; vnos?: unknown; ime?: unknown; kategorija?: unknown },
  token: string | null,
  dir?: string,
  odv?: Partial<NoviceOdv>,
): Promise<IzidNovic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const p = pripraviVir(vhod);
  if (!p.ok) return { ok: false, sporocilo: p.razlog };
  const izid = await vVrsti(async () => {
    const shranjeno = await preberiShranjeno(root);
    if (shranjeno.viri.length >= MEJA_VIROV) return `Virov je lahko največ ${MEJA_VIROV}.`;
    if (shranjeno.viri.some((v) => v.vrsta === p.vir.vrsta && v.vnos.toLowerCase() === p.vir.vnos.toLowerCase())) return "Ta vir že imate.";
    shranjeno.viri.push({ id: randomUUID(), ...p.vir });
    await writeJson(root, D_NASTAVITVE, shranjeno);
    return null;
  });
  if (izid) return { ok: false, sporocilo: izid };
  return { ok: true, pogled: await trenutniPogled(root, odvPrivzeto(odv).zdaj!()) };
}

export async function noviceOdstraniVir(id: string, token: string | null, dir?: string, odv?: Partial<NoviceOdv>): Promise<IzidNovic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await vVrsti(async () => {
    const shranjeno = await preberiShranjeno(root);
    shranjeno.viri = shranjeno.viri.filter((v) => v.id !== id);
    await writeJson(root, D_NASTAVITVE, shranjeno);
  });
  return { ok: true, pogled: await trenutniPogled(root, odvPrivzeto(odv).zdaj!()) };
}

/** Zanimanja in nastavitve pregleda (vsako polje se cisti, neznana polja se zavrzejo). */
export async function noviceShrani(
  vhod: { zanimanja?: unknown; nastavitve?: unknown },
  token: string | null,
  dir?: string,
  odv?: Partial<NoviceOdv>,
): Promise<IzidNovic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await vVrsti(async () => {
    const shranjeno = await preberiShranjeno(root);
    if (vhod.zanimanja !== undefined) shranjeno.zanimanja = ocistiZanimanja(vhod.zanimanja);
    if (vhod.nastavitve !== undefined) shranjeno.nastavitve = ocistiNastavitve({ ...PRIVZETE_NASTAVITVE, ...(vhod.nastavitve as object) });
    await writeJson(root, D_NASTAVITVE, shranjeno);
  });
  return { ok: true, pogled: await trenutniPogled(root, odvPrivzeto(odv).zdaj!()) };
}

/**
 * Ocena z modelom, ki ga je uporabnik izbral za pogovor (njegov ponudnik in kljuc; Safeer ne placa nicesar).
 * Najvec 40 se neocenjenih novic, v paketih po 10; ukaz v naslovu ne more nicesar sprozit, ker iz odgovora beremo samo stevila.
 */
export async function noviceOceni(token: string | null, dir?: string, odv?: Partial<NoviceOdv>): Promise<IzidNovic> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const o = odvPrivzeto(odv);
  const zdaj = o.zdaj!();
  const brain = await pogovorBrain(root);
  if (!brain) return { ok: false, sporocilo: await razlogBrezAsistentke(root) };
  const shranjeno = await preberiShranjeno(root);
  const predpomnilnik = await preberiPredpomnilnik(root);
  const ocene = await preberiOcene(root);
  const poId = new Map(shranjeno.viri.map((v) => [v.id, v]));
  const kandidati = predpomnilnik.postavke
    .filter((p) => poId.has(p.virId) && !Object.hasOwn(ocene, p.kljuc))
    .map((p) => ({ ...p, vir: poId.get(p.virId)!.ime }))
    .sort((a, b) => osnovnaOcena(b, zdaj) - osnovnaOcena(a, zdaj))
    .slice(0, MEJA_OCENJEVANJA);
  if (!kandidati.length) return { ok: true, pogled: sestaviPogled(shranjeno, predpomnilnik, ocene, zdaj) };

  const paketi: Postavka[][] = [];
  for (let i = 0; i < kandidati.length; i += PAKET_OCEN) paketi.push(kandidati.slice(i, i + PAKET_OCEN));
  let napaka = "";
  let uspelih = 0;
  const nove = new Map<string, ZapisOcene>();
  await vSkupinah(paketi, HKRATI_OCEN, async (paket) => {
    const odgovor = await callProvider({
      ...brain,
      text: besediloOcene(shranjeno.zanimanja, paket),
      system: NAVODILO_OCENE,
      maxTokens: 1500,
      najvecZnakov: 4000,
      timeoutMs: 24_000,
      vsebinaKlica: false,
      // naloga 11 N3 (B9): postavke novic so vsebina s spleta, ne pogovor lastnika - OpenRouter vedno z deny
      vednoDeny: true,
    });
    if (!odgovor.ok) {
      napaka = napaka || hideSecret(odgovor.sporocilo, brain.key);
      return;
    }
    const razbrane = razberiOceneModela(odgovor.text, paket.length);
    if (!razbrane.length) return;
    uspelih += 1;
    for (const r of razbrane) nove.set(paket[r.i].kljuc, { o: r.ocena, p: r.povzetek, cas: zdaj.toISOString() });
  });
  if (!uspelih) return { ok: false, sporocilo: napaka || "Model ni vrnil uporabljivih ocen. Poskusite znova." };

  const zdruzene = await vVrsti(async () => {
    const vse = { ...(await preberiOcene(root)), ...Object.fromEntries(nove) };
    // Shranimo najnovejse; ocene novic, ki jih ni vec v predpomnilniku, se sčasoma izpraznijo.
    const obdrzane = Object.entries(vse)
      .sort((a, b) => b[1].cas.localeCompare(a[1].cas))
      .slice(0, MEJA_SHRANJENIH_OCEN);
    const ven = Object.fromEntries(obdrzane);
    await writeJson(root, D_OCENE, ven);
    return ven;
  });
  return { ok: true, pogled: sestaviPogled(shranjeno, predpomnilnik, zdruzene, zdaj) };
}
