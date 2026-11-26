/**
 * Orkestrator agentov v Lini (lastnik 25. 11. 2026): zanka s stanjem, ki modelu poda orodja, jih izvaja po registru in porocа vmesne
 * izide, preden vrne koncni odgovor. Stanje naloge je na disku (<podatki>/orkestrator/<id>.json, 0600, atomarno) po VSAKEM koraku, zato
 * naloga prezivi ponovni zagon Line. Meje (koraki, zetoni, cas, ponovitve) vedno ustavijo z razlogom.
 *
 * Varnost: izid orodja je podatek (ovijPodatek); vbrizg v izidu naredi nalogo okuzeno - od tedaj vsa orodja razen branja cakajo lastnika.
 * Potrditev je vezana na en klic (vprasanje z zgostitvijo vnosa, enkratno, rok = zavrnitev) po isti poti kot vprasanja agentov, zato jo
 * vidita tudi znacka/obvestilo namizja in telefon. Prava orodja (naloga 19, F2: datoteke, splet, znanje, zapis, koledar) so v
 * orkestrator-orodja.server.ts in jih dobi primerek Line (orkestrator()); ukazov in brisanja ni. Tajnica (klici) te datoteke ne uvaza.
 * Komentarji brez sumnikov.
 */
import { access, appendFile, chmod, lstat, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { odlociNadaljevanje, zacetnoStanje, zakrijSkrivnosti, zakrijZnaneSkrivnosti, type Ocena, type StanjeCilja } from "./cilj-naloge.ts";
import { NAJVEC_ZNAKOV_NALOGE_LINE } from "./claude-naloge.ts";
import { oceniZModelom, type Oceni } from "./cilj-naloge.server.ts";
import {
  NAVODILO_ORKESTRATORJA,
  normirajProracun,
  ocenaZetonov,
  odtisKlica,
  ovijPodatek,
  ovijUcenje,
  preimenujKlice,
  presezenaMeja,
  preveriArgumente,
  ROK_ORODJA_MS,
  skrciZgodovino,
  ustvariRegister,
  vnosZaPotrditev,
  zahtevaPotrditev,
  type IzidOrodja,
  type OrodjeOrkestratorja,
  type Poraba,
  type Proracun,
  type RazlogUstavitve,
  type RegisterOrodij,
} from "./orkestrator.ts";
import { izberiUcenje, normirajTip, type UcenjeVmesnik } from "./orkestrator-ucenje.ts";
import { orodjaLine } from "./orkestrator-orodja.server.ts";
import { zaznajVbrizg } from "./vbrizg.ts";
import type { DefinicijaOrodja, KlicOrodja, MoznostiOrodij, RezultatOrodij, SporociloOrodja } from "./providers.ts";
import { imaPosixDovoljenja } from "./platforma.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { koncajTekVLini, odpriTekVLini, prekliciVprasanjeVLini, vrsticaTekaVLini, zastaviVprasanjeVLini, type OdgovorVLini } from "./vprasanja-agentov.server.ts";

export const MAPA_ORKESTRATORJA = "orkestrator";
export const NASTAVITVE_ORKESTRATORJA = "orkestrator-nastavitve.json";
const NAJVEC_DOGODKOV = 200;
const NAJVEC_ZNAKOV_CILJA = 4000;
/** Najvec NEKONCANIH nalog hkrati (koncane ne stejejo, sicer bi po 50 nalogah orkestrator za vedno zavracal nove). */
const NAJVEC_NALOG = 50;
/** Naloga 9 V5: koncane naloge se hranijo najvec 30 dni in najvec 50 (starejse se samodejno pocistijo ob novi nalogi in zagonu). */
const HRANI_KONCANE_MS = 30 * 24 * 60 * 60_000;
const NAJVEC_KONCANIH = 50;
/** Najdlje cakanje na pomocnika (predlog 15 min + naloga do 2 h v claude-naloge); nato izid »rok« in zanka tece naprej. */
export const ROK_POMOCNIKA_MS = 3 * 60 * 60_000;
const KONCNE_FAZE = ["koncano", "ustavljeno", "napaka"];
/** Najvec samopregledov, ki vrnejo »se ni dosezeno«, preden naloga konca z oceno (cilj-naloge.ts ima svoj strop). */
const NAJVEC_SAMOPREGLEDOV = 2;
const NAJVEC_KLICEV_NA_ODGOVOR = 8;

export type Faza = "tece" | "caka-potrditev" | "caka-lastnika" | "caka-pomocnika" | "koncano" | "ustavljeno" | "napaka";

export type VrstaDogodka = "nacrt" | "korak-zacet" | "korak-koncan" | "izid-orodja" | "vmesno" | "vprasanje" | "caka-potrditev" | "napaka" | "ucenje" | "samopregled" | "konec";
export type DogodekOrkestratorja = { st: number; cas: string; vrsta: VrstaDogodka; besedilo: string; orodje?: string; klicId?: string };

/** Klic, ki ga zanka obdeluje (paket klicev enega odgovora modela; vsak dobi izid pred naslednjim klicem modela). */
type OdprtKlic = KlicOrodja & { zacet?: boolean };

export type StanjeNaloge = {
  id: string;
  cilj: string;
  tip: string;
  faza: Faza;
  razlog: RazlogUstavitve | "dosezeno" | "neuspeh" | null;
  odgovor: string | null;
  ocena: Ocena | null;
  sporocila: SporociloOrodja[];
  odprti: OdprtKlic[];
  /** Cakajoca potrditev/vprasanje: klic in id vprasanja v skupni vrsti (po ponovnem zagonu se zastavi znova). */
  cakanje: { klicId: string; vprasanjeId: string | null; pomocnik?: string; vprasanje?: string; od?: string } | null;
  dogodki: DogodekOrkestratorja[];
  stDogodka: number;
  koraki: number;
  poraba: Poraba;
  casMs: number;
  proracun: Proracun;
  ponovitve: Record<string, number>;
  okuzeno: boolean;
  /** Naloga 12 #3: stanje iz izdaje pred podpisom (selitev ob nadgradnji): samo branje, vsebina ni preverjena. */
  nepreverjeno?: boolean;
  /** Naloga 12 #2: monotona verzija (podpisana); starejsa od znane (pomnilnik, indeks.json) = vrnjeno stanje. Brez polja = 0. */
  verzija?: number;
  ucenje: boolean;
  enoteUcenja: string[];
  cilja: StanjeCilja;
  samopregledov: number;
  gesloObZacetku: boolean;
  delovalo: string[];
  ni: string[];
  /** Naloga 19: skupni cas izvedbe po orodju (ms) za izkusnjo; brez polja (starejsa stanja) = 0. */
  casiOrodij?: Record<string, number>;
  zacetek: string;
  posodobljeno: string;
};

export type KlicModela = (sporocila: SporociloOrodja[], orodja: DefinicijaOrodja[], moznosti: MoznostiOrodij) => Promise<RezultatOrodij>;

export type OdvisnostiOrkestratorja = {
  /** Klic modela z orodji; privzeto Linin ponudnik za pogovor (pogovorBrain) prek callProviderZOrodji. */
  klicModela?: KlicModela;
  /** Samopregled proti cilju; privzeto oceniZModelom (cilj-naloge.server.ts). null = brez samopregleda. */
  oceni?: Oceni | null;
  /** Ucenje; undefined = izberiUcenje (ucenje-lh ali samoucenje), null = brez ucenja. */
  ucenje?: UcenjeVmesnik | null;
  /** Dodatna orodja (F2: datoteke, peskovnik). */
  orodja?: OrodjeOrkestratorja[];
  /** Predlog naloge pomocniku (privzeto predlagajClaudeNalogo: lastnik potrdi v zavihku Racunalnik). */
  predlagajPomocniku?: (mapa: string, besedilo: string, agent: string) => Promise<{ id: string } | null>;
  /** Stanje in porocilo naloge pomocnika (privzeto izidNalogePomocnika). */
  izidPomocnika?: (id: string) => Promise<{ koncano: boolean; stanje: string; porocilo: string | null } | null>;
  /** Ali je bilo geslo lastnika ob nastanku naloge (privzeto ownerExists). */
  imaGeslo?: () => Promise<boolean>;
  rokVprasanjaMs?: number;
  zdaj?: () => number;
};

export class OrkestratorNapaka extends Error {
  readonly koda: "izklopljeno" | "ni-naloge" | "oblika" | "polno" | "faza" | "geslo";
  constructor(koda: OrkestratorNapaka["koda"]) {
    super(koda);
    this.koda = koda;
    this.name = "OrkestratorNapaka";
  }
}

// --- nastavitve (stikalo privzeto vklopljeno: lastnikova ideja) -----------------------------------------------------

export async function jeOrkestratorVklopljen(dir?: string): Promise<boolean> {
  const n = await readJsonFile<{ vklopljen?: unknown }>(resolveDataDir(dir), NASTAVITVE_ORKESTRATORJA).catch(() => null);
  return n?.vklopljen !== false;
}

export async function nastaviOrkestrator(vklopljen: boolean, dir?: string): Promise<boolean> {
  await writeJson(resolveDataDir(dir), NASTAVITVE_ORKESTRATORJA, { vklopljen: vklopljen === true });
  return vklopljen === true;
}

// --- privzete odvisnosti --------------------------------------------------------------------------------------------

async function privzetiKlicModela(dir: string): Promise<KlicModela> {
  const { pogovorBrain } = await import("./keys.server.ts");
  const { callProviderZOrodji } = await import("./providers.ts");
  return async (sporocila, orodja, moznosti) => {
    const brain = await pogovorBrain(dir);
    if (!brain) return { ok: false, sporocilo: "Ni modela: dodajte ključ v Nastavitve > Možgani." };
    return callProviderZOrodji(brain, sporocila, orodja, { ...moznosti, vsebinaKlica: false });
  };
}

// --- vgrajena orodja ------------------------------------------------------------------------------------------------

function vgrajenaOrodja(d: { predlagajPomocniku: NonNullable<OdvisnostiOrkestratorja["predlagajPomocniku"]> }): OrodjeOrkestratorja[] {
  return [
    {
      razred: "branje",
      definicija: {
        ime: "porocaj_vmesno",
        opis: "Sporoci lastniku vmesni izid ali nacrt (en do tri stavki). Uporabi po vsakem pomembnem koraku.",
        parametri: { type: "object", properties: { besedilo: { type: "string", maxLength: 1000 } }, required: ["besedilo"] },
      },
      izvedi: async (a) => ({ vmesno: String(a.besedilo) }),
    },
    {
      razred: "branje",
      definicija: {
        ime: "vprasaj_lastnika",
        opis: "Vprasaj lastnika, ko brez njegove odlocitve ali podatka ne mores naprej. Naloga caka odgovor.",
        parametri: { type: "object", properties: { vprasanje: { type: "string", maxLength: 500 } }, required: ["vprasanje"] },
      },
      izvedi: async (a) => ({ caka: "lastnik", vprasanje: String(a.vprasanje) }),
    },
    {
      // Naloga gre v obstojeci mehanizem claude-naloge (predlog, ki ga lastnik VEDNO potrdi tam: dovoljenje podobnih za predloge
      // orkestratorja ne velja, pregled V2). Zato tu ni druge potrditve, razen ce je naloga okuzena (zahtevaPotrditev).
      razred: "zunanje",
      potrditev: false,
      // ko je model ze bral podatke (izid orodja), lahko vrinjeno navodilo obide zaznavo vzorcev - takrat potrdi tudi orkestrator
      potrditevPoPodatkih: true,
      // naloga 19b N3: porocilo pomocnika (dostop do projekta) je zasebni podatek - splet potem caka lastnika
      zasebniIzid: true,
      definicija: {
        ime: "dodeli_pomocniku",
        opis: "Za obsezno nalogo (vec delov, > 8 datotek ali > 45 min) dodeli del zunanjemu agentu na racunalniku. Lastnik predlog potrdi; izid pride nazaj.",
        parametri: {
          type: "object",
          properties: { mapa: { type: "string", maxLength: 500 }, naloga: { type: "string", maxLength: NAJVEC_ZNAKOV_NALOGE_LINE }, agent: { type: "string", enum: ["claude", "opencode", "agy", "pi", "grok"] } },
          required: ["mapa", "naloga"],
        },
      },
      izvedi: async (a) => {
        const p = await d.predlagajPomocniku(String(a.mapa), String(a.naloga), typeof a.agent === "string" ? a.agent : "claude");
        return p ? { caka: "pomocnik", nalogaId: p.id } : { ok: false, napaka: "Predlog naloge pomocniku ni bil sprejet (mapa, agent ali besedilo)." };
      },
    },
  ];
}

// --- orkestrator ----------------------------------------------------------------------------------------------------

export type Orkestrator = {
  nova(v: { cilj: unknown; tip?: unknown; proracun?: unknown }): Promise<StanjeNaloge>;
  /** Pozene zanko naloge do konca ali do cakanja; vrne stanje. */
  teci(id: string): Promise<StanjeNaloge>;
  ustavi(id: string, razlog?: "preklic" | "izklopljeno"): Promise<StanjeNaloge>;
  /** Preveri cakajoce pomocnike (samo enega ali vse): koncan, zavrnjen, izginil ali cez rok -> izid v zanko. */
  preveriPomocnike(samo?: string): Promise<void>;
  odgovorLastnika(id: string, besedilo: unknown): Promise<StanjeNaloge>;
  /** Izbris koncane naloge (stanje; dnevnik dejanj v arhiv/); nekoncana -> napaka »faza«. */
  izbrisi(id: string): Promise<void>;
  izidPomocnika(nalogaId: string): Promise<void>;
  /** Ob zagonu Line: nadaljuje tekoce naloge, znova zastavi cakajoca vprasanja, preveri pomocnike. */
  nadaljujPoZagonu(): Promise<string[]>;
  preberi(id: string): Promise<StanjeNaloge | null>;
  seznam(): Promise<StanjeNaloge[]>;
  /** Naloga 14 N2: indeks verzij je bil izgubljen ali neveljaven in je obnovljen; naloge, ki so takrat obstajale, so samo za branje. */
  indeksObnovljen(): boolean;
  /** Naloga 19: imena orodij v registru (vgrajena + dodana). */
  imenaOrodij(): string[];
};

const VELJAVEN_ID = /^o-[a-f0-9]{16}$/;
const FAZE: ReadonlyArray<Faza> = ["tece", "caka-potrditev", "caka-lastnika", "caka-pomocnika", "koncano", "ustavljeno", "napaka"];
/** Orodje, na katerega caka faza (caka-potrditev: katero koli orodje iz registra s potrditvijo). */
const ORODJE_CAKANJA: Partial<Record<Faza, string>> = { "caka-lastnika": "vprasaj_lastnika", "caka-pomocnika": "dodeli_pomocniku" };

/**
 * Naloga 9 V7: oblika stanja z diska (datoteko lahko podtakne ali pokvari kdor koli z dostopom do mape podatkov). Vrne razlog ali
 * null. Orodja: delovalo/ni, potrjen klic in klic, na katerega naloga caka, samo iz registra; odprt klic z izmisljenim imenom je
 * veljaven (dobi izid »ne obstaja«, pregled V1). Vsebine shema ne loci: zato podpis (podpisStanja) in potrjeno z diska ne velja (naloga 11 N1).
 */
export function razlogNeveljavnegaStanja(x: unknown, id: string, imaOrodje: (ime: string) => boolean): string | null {
  const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const niz = (v: unknown) => typeof v === "string";
  const st = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const nizi = (v: unknown) => Array.isArray(v) && v.every(niz);
  if (!obj(x)) return "ni objekt";
  if (x.id !== id) return "id";
  if (!niz(x.cilj) || !(x.cilj as string).trim() || (x.cilj as string).length > NAJVEC_ZNAKOV_CILJA) return "cilj";
  if (!niz(x.tip)) return "tip";
  if (!FAZE.includes(x.faza as Faza)) return "faza";
  if (x.razlog !== null && !niz(x.razlog)) return "razlog";
  if (x.odgovor !== null && !niz(x.odgovor)) return "odgovor";
  if (x.ocena !== null && !(obj(x.ocena) && niz(x.ocena.ovira) && niz(x.ocena.dokaz))) return "ocena";
  if (!Array.isArray(x.sporocila) || !x.sporocila.every((m) =>
    obj(m) && (m.vloga === "uporabnik" ? niz(m.besedilo)
      : m.vloga === "asistent" ? (m.besedilo === undefined || niz(m.besedilo)) && (m.klici === undefined || (Array.isArray(m.klici) && m.klici.every((k) => obj(k) && niz(k.id) && niz(k.ime))))
        : m.vloga === "orodje" && niz(m.id) && niz(m.ime) && (niz(m.rezultat) || obj(m.rezultat)) && (m.napaka === undefined || typeof m.napaka === "boolean")))) return "sporocila";
  // argumenti odprtega klica so model izbral (lahko ne-objekt): zavrne jih preveriArgumente ob izvedbi (izid »Napacni argumenti«)
  if (!Array.isArray(x.odprti) || !x.odprti.every((k) => obj(k) && niz(k.id) && niz(k.ime)
    && (k.zacet === undefined || typeof k.zacet === "boolean"))) return "odprti";
  const odprti = x.odprti as Array<{ id: string; ime: string }>;
  const cakajoca = x.faza === "caka-potrditev" || x.faza === "caka-lastnika" || x.faza === "caka-pomocnika";
  if (x.cakanje === null) {
    if (cakajoca) return "cakanje";
  } else {
    const c = x.cakanje;
    if (!obj(c) || !niz(c.klicId) || (c.vprasanjeId !== null && !niz(c.vprasanjeId))) return "cakanje";
    for (const p of ["pomocnik", "vprasanje", "od"]) if (c[p] !== undefined && !niz(c[p])) return "cakanje";
    if (!cakajoca) return "cakanje brez cakajoce faze";
    const k = odprti.find((o) => o.id === c.klicId);
    const pricakovano = ORODJE_CAKANJA[x.faza as Faza];
    if (!k || !imaOrodje(k.ime) || (pricakovano !== undefined && k.ime !== pricakovano)) return "cakanje: orodje";
    if (x.faza === "caka-pomocnika" && !niz(c.pomocnik)) return "cakanje: pomocnik";
  }
  if (!Array.isArray(x.dogodki) || !x.dogodki.every((d) => obj(d) && st(d.st) && niz(d.cas) && niz(d.vrsta) && niz(d.besedilo))) return "dogodki";
  for (const p of ["stDogodka", "koraki", "casMs", "samopregledov"]) if (!st(x[p])) return p;
  const por = x.poraba;
  if (!obj(por) || !st(por.vhod) || !st(por.izhod) || !st(por.klici) || typeof por.ocenjeno !== "boolean") return "poraba";
  const pr = x.proracun;
  if (!obj(pr) || !["najvecKorakov", "najvecZetonov", "rokMs", "najvecPonovitev"].every((p) => st(pr[p]))) return "proracun";
  if (!obj(x.ponovitve) || !Object.values(x.ponovitve).every(st)) return "ponovitve";
  for (const p of ["okuzeno", "ucenje", "gesloObZacetku"]) if (typeof x[p] !== "boolean") return p;
  if (x.nepreverjeno !== undefined && typeof x.nepreverjeno !== "boolean") return "nepreverjeno";
  if (x.verzija !== undefined && !(Number.isSafeInteger(x.verzija) && (x.verzija as number) >= 0)) return "verzija";
  if (!nizi(x.enoteUcenja)) return "enoteUcenja";
  const ci = x.cilja;
  if (!obj(ci) || !st(ci.nadaljevanj) || !st(ci.brezNapredka) || !niz(ci.zadnjiIzid)) return "cilja";
  if (!nizi(x.delovalo) || !nizi(x.ni) || ![...(x.delovalo as string[]), ...(x.ni as string[])].every(imaOrodje)) return "delovalo/ni";
  if (x.casiOrodij !== undefined && !(obj(x.casiOrodij) && Object.entries(x.casiOrodij).every(([k, v]) => imaOrodje(k) && st(v)))) return "casiOrodij";
  if (!niz(x.zacetek) || !niz(x.posodobljeno)) return "cas";
  return null;
}

/** Naloga 12 #12: potrjeno z diska nikoli ne velja (N1): polje se po preverbi podpisa odstrani, shema ga ne preverja (dosledno prezrto). */
function odstraniPotrjeno(x: object): void {
  const odprti = (x as { odprti?: unknown }).odprti;
  if (Array.isArray(odprti)) for (const k of odprti) if (k && typeof k === "object") delete (k as { potrjeno?: unknown }).potrjeno;
}

/** Kanonicni zapis (urejeni kljuci) za podpis: enak pred zapisom in po branju z diska. */
function kanonicno(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(kanonicno).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${kanonicno((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/**
 * Naloga 11 N1: podpis stanja naloge (HMAC-SHA256 s podkljucem iz glavnega kljuca Line, keys.server). Stanje brez veljavnega podpisa
 * je neveljavno; stanje BREZ polja podpis je samo za branje z oznako nepreverjeno (naloga 14 N3, nikoli podpisano). Meja: podpis NE varuje pred bralcem mape podatkov - kdor prebere .kljuc (mapa v
 * oblaku ali dostopna drugim), podpise sam; varuje samo pred tistim, ki sme pisati, a ne brati (naloga 12 #1).
 */
export async function podpisStanja(root: string, stanje: unknown, namen = "orkestrator"): Promise<string> {
  const { kljucCelovitosti } = await import("./keys.server.ts");
  const { podpis: _, ...brez } = JSON.parse(JSON.stringify(stanje)) as Record<string, unknown>;
  return createHmac("sha256", await kljucCelovitosti(namen, root)).update(kanonicno(brez)).digest("hex");
}

/** Podpis enak pricakovanemu (podpis je hex niz ali kar koli z diska). */
async function podpisVelja(root: string, x: object, namen?: string): Promise<boolean> {
  const podpis = "podpis" in x ? (x as { podpis: unknown }).podpis : undefined;
  const pricakovan = Buffer.from(await podpisStanja(root, x, namen));
  const dobljen = Buffer.from(typeof podpis === "string" ? podpis : "");
  return dobljen.length === pricakovan.length && timingSafeEqual(dobljen, pricakovan);
}

export function ustvariOrkestrator(dir?: string, o: OdvisnostiOrkestratorja = {}): Orkestrator {
  const root = resolveDataDir(dir);
  const mapa = path.join(root, MAPA_ORKESTRATORJA);
  const zdaj = o.zdaj ?? Date.now;
  const iso = () => new Date(zdaj()).toISOString();
  const rokVprasanja = o.rokVprasanjaMs;
  let klicModela: KlicModela | null = o.klicModela ?? null;
  let ucenje: UcenjeVmesnik | null | undefined = o.ucenje;
  // naloga 9 V11: samopregled dobi izid, sestavljen iz izidov orodij - OpenRouter vedno z deny (tudi :free s stikalom)
  const oceni: Oceni | null = o.oceni === undefined
    ? oceniZModelom(async () => {
        const b = await (await import("./keys.server.ts")).pogovorBrain(root);
        return b ? { ...b, vednoDeny: true } : null;
      })
    : o.oceni;
  const predlagajPomocniku = o.predlagajPomocniku ?? (async (m: string, b: string, agent: string) => {
    const { predlagajClaudeNalogo } = await import("./claude-naloge.server.ts");
    // pregled V2 (naloga 8): predlog vedno potrdi lastnik, tudi ob dovoljenju »podobne« (besedilo izbere model)
    const z = await predlagajClaudeNalogo(dir, m, b, {}, new Date(zdaj()), { agent, brezDovoljenjaPodobnih: true });
    return z ? { id: z.id } : null;
  });
  const izidPomocnikaBeri = o.izidPomocnika ?? (async (id: string) => (await import("./claude-naloge.server.ts")).izidNalogePomocnika(dir, id));
  const register: RegisterOrodij = ustvariRegister([...vgrajenaOrodja({ predlagajPomocniku }), ...(o.orodja ?? [])]);
  const definicije = [...register.values()].map((x) => x.definicija);
  const tecejo = new Map<string, Promise<StanjeNaloge>>();
  const prekinitve = new Map<string, AbortController>();
  const vrste = new Map<string, Promise<unknown>>();
  // naloga 11 N1: potrditev velja samo v procesu, ki jo je dobil od lastnika (zastavica z diska je lahko podtaknjena)
  const potrjeniVProcesu = new Set<string>();
  const kljucPotrditve = (s: StanjeNaloge, k: KlicOrodja) => `${s.id}/${k.id}`;
  // naloga 12 #2: klici, ki jih je odprl ta proces (odgovor modela); klic z diska (po zagonu, vrnjeno stanje), ki ni branje, caka potrditev
  const odprtiVProcesu = new Set<string>();

  const pot = (id: string) => {
    if (!VELJAVEN_ID.test(id)) throw new OrkestratorNapaka("ni-naloge");
    return `${id}.json`;
  };
  // naloga 12 #2: zadnja znana verzija vsake naloge (izbrisana: verzija vec od zadnje). Nalozi se enkrat iz podpisanega indeksa, nato
  // samo pomnilnik; indeks se zapise PO stanju (prekinitev med zapisoma: stanje je novejse od indeksa in velja, ker velja >= znana).
  // Meja: po ponovnem zagonu vrnjen indeks skupaj s starim stanjem ostane veljaven - zato klic z diska po zagonu caka potrditev.
  const INDEKS = "indeks.json";
  let verzije: Promise<Map<string, number>> | null = null;
  const znaneVerzije = () => (verzije ??= naloziVerzije().catch((e: unknown) => { verzije = null; throw e; }));
  // naloga 14 N2: naloge, katerih verzije ni bilo mogoce preveriti z veljavnim indeksom (samo za branje); hrani se v podpisanem indeksu
  const brezVnosa = new Set<string>();
  // naloga 14 N2: indeks je bil kdaj obnovljen (izbrisi pred tem so izgubljeni) - podpisana naloga brez vnosa je od tedaj samo za branje
  let obnovljen = false;
  /** Naloga 14 N2: najvisje verzije PODPISANIH stanj z veljavno shemo (surovo branje: preberi caka na indeks). */
  const verzijeIzStanj = async () => {
    const m = new Map<string, number>();
    for (const ime of (await readdir(mapa).catch(() => [])).filter((x) => /^o-[a-f0-9]{16}\.json$/.test(x))) {
      const id = ime.slice(0, -5);
      const x = await readJsonFile<unknown>(mapa, ime).catch(() => null);
      if (!x || typeof x !== "object" || Array.isArray(x) || !("podpis" in x) || !(await podpisVelja(root, x))) continue;
      const { podpis: _, ...stanje } = x as Record<string, unknown>;
      odstraniPotrjeno(stanje);
      if (razlogNeveljavnegaStanja(stanje, id, (i) => register.has(i)) !== null) continue;
      m.set(id, (stanje.verzija as number | undefined) ?? 0);
    }
    return m;
  };
  // zavrnitev (npr. .kljuc zavrnjen, naloga 12 #1, ali napaka branja indeksa) se ne shrani: po odpravi deluje brez ponovnega zagona
  const naloziVerzije = async () => {
    const m = new Map<string, number>();
    // naloga 14 N2: samo ENOENT (null) in pokvarjen JSON pomenita "ni veljavnega indeksa"; druga napaka (EACCES, EBUSY, EISDIR) zavrne
    const x = await readJsonFile<unknown>(mapa, INDEKS).catch((e: unknown) => { if (e instanceof SyntaxError) return undefined; throw e; });
    const veljaven = !!x && typeof x === "object" && !Array.isArray(x) && await podpisVelja(root, x, "orkestrator-indeks");
    if (veljaven) {
      const v = (x as { verzije?: unknown }).verzije;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [id, n] of Object.entries(v)) if (VELJAVEN_ID.test(id) && Number.isSafeInteger(n) && (n as number) >= 0) m.set(id, n as number);
      }
      const b = (x as { nepreverjene?: unknown }).nepreverjene;
      if (Array.isArray(b)) for (const id of b) if (typeof id === "string" && VELJAVEN_ID.test(id)) brezVnosa.add(id);
      obnovljen = (x as { obnovljen?: unknown }).obnovljen === true;
      return m;
    }
    // naloga 14 N2: indeks manjka (ob podpisanih stanjih) ali ni veljaven - zgradi ga iz najvisjih verzij veljavnih stanj; te naloge
    // so samo za branje (verzije ni mogoce preveriti: lahko je vrnjena kopija). Prva uporaba (ni indeksa, ni stanj): prazen indeks.
    const izStanj = await verzijeIzStanj();
    if (x === null && izStanj.size === 0) return m;
    for (const [id, n] of izStanj) {
      m.set(id, n);
      brezVnosa.add(id);
    }
    obnovljen = true;
    console.error("lina: indeks verzij nalog manjka ali ni veljaven; obnovljen iz stanj, obstojece naloge so samo za branje.");
    return m;
  };
  let zapisIndeksa: Promise<unknown> = Promise.resolve();
  /** En zapis indeksa naenkrat (vVrsti je po nalogi, indeks je skupen). */
  const shraniIndeks = async () => {
    const m = await znaneVerzije();
    const p = zapisIndeksa.catch(() => undefined).then(async () => {
      const telo = { verzije: Object.fromEntries(m), ...(brezVnosa.size > 0 ? { nepreverjene: [...brezVnosa].sort() } : {}), ...(obnovljen ? { obnovljen: true } : {}) };
      await writeJson(mapa, INDEKS, { ...telo, podpis: await podpisStanja(root, telo, "orkestrator-indeks") });
    });
    zapisIndeksa = p;
    await p;
  };
  const zeJavljeno = new Set<string>();
  const preberi = async (id: string): Promise<StanjeNaloge | null> => {
    if (!VELJAVEN_ID.test(id)) return null;
    const x = await readJsonFile<unknown>(mapa, pot(id)).catch(() => null);
    if (x === null) return null;
    // naloga 14 N3: brez polja podpis = samo za branje (nikoli podpisano, nikoli nadaljevano); napacen podpis = neveljavno
    const obj = typeof x === "object" && !Array.isArray(x);
    const brezPodpisa = obj && !("podpis" in x);
    const podpisan = obj && !brezPodpisa && await podpisVelja(root, x);
    if (podpisan) delete (x as { podpis?: unknown }).podpis;
    if (podpisan || brezPodpisa) odstraniPotrjeno(x);
    let razlog = podpisan || brezPodpisa ? razlogNeveljavnegaStanja(x, id, (ime) => register.has(ime)) : "podpis";
    const m = razlog === null ? await znaneVerzije() : null;
    if (m && ((x as StanjeNaloge).verzija ?? 0) < (m.get(id) ?? 0)) razlog = "verzija";
    if (m && razlog === null) {
      const s = x as StanjeNaloge;
      // naloga 14 N2: prebrana podpisana verzija gre v indeks v pomnilniku (naslednji zapis indeksa je ne zniza); nepodpisana nikoli
      if (podpisan && obnovljen && !m.has(id)) brezVnosa.add(id);
      if (podpisan) m.set(id, Math.max(m.get(id) ?? 0, s.verzija ?? 0));
      // oznaka se izracuna ob vsakem branju (ne velja iz datoteke kot false); true z diska (stara selitev) ostane
      if (brezPodpisa || brezVnosa.has(id) || s.nepreverjeno === true) s.nepreverjeno = true;
      else delete s.nepreverjeno;
      return s;
    }
    // pregled V7: neveljavno stanje se ne nadaljuje in ne pokaze; v dnevnik enkrat na nalogo (seznam bere ob vsakem osvezenju)
    if (!zeJavljeno.has(id)) {
      zeJavljeno.add(id);
      await vDnevnik({ id } as StanjeNaloge, { vrsta: "neveljavno-stanje", razlog });
    }
    return null;
  };
  /** Naloga 14 N3: stanje za spremembo (nadaljevanje, odgovor, ustavitev); nepreverjeno je samo za branje. */
  const beriZaPisanje = async (id: string): Promise<StanjeNaloge | null> => {
    const s = await preberi(id);
    return s && !s.nepreverjeno ? s : null;
  };
  const zapisi = async (s: StanjeNaloge) => {
    // naloga 14 N3: nepreverjeno stanje se nikoli ne podpise (podpis bi podtaknjeno vsebino opral v veljavno)
    if (s.nepreverjeno) throw new OrkestratorNapaka("faza");
    const m = await znaneVerzije();
    s.verzija = Math.max(s.verzija ?? 0, m.get(s.id) ?? 0) + 1;
    s.posodobljeno = iso();
    await writeJson(mapa, pot(s.id), { ...s, podpis: await podpisStanja(root, s) });
    m.set(s.id, s.verzija);
    await shraniIndeks();
  };
  /** Dnevnik naloge: samo metapodatki (vrsta, orodje, odtis argumentov, uspeh), nikoli vsebina izidov. */
  const vDnevnik = async (s: StanjeNaloge, zapis: Record<string, unknown>) => {
    const p = path.join(mapa, `${s.id}.dnevnik.jsonl`);
    await appendFile(p, JSON.stringify({ cas: iso(), ...zapis }) + "\n", { mode: 0o600 }).catch(() => undefined);
    await chmod(p, 0o600).catch(() => undefined);
  };
  const dogodek = (s: StanjeNaloge, vrsta: VrstaDogodka, besedilo0: string, dod: { orodje?: string; klicId?: string } = {}) => {
    // dogodki gredo na zaslon in telefon (vrstice teka): skrivnosti in domace poti zakrite
    const besedilo = zakrijSkrivnosti(besedilo0.slice(0, 2000));
    s.stDogodka += 1;
    s.dogodki.push({ st: s.stDogodka, cas: iso(), vrsta, besedilo: besedilo.slice(0, 600), ...dod });
    if (s.dogodki.length > NAJVEC_DOGODKOV) s.dogodki.splice(0, s.dogodki.length - NAJVEC_DOGODKOV);
    vrsticaTekaVLini(root, s.id, `${vrsta}${dod.orodje ? ` ${dod.orodje}` : ""}: ${besedilo.slice(0, 200)}`);
    void vDnevnik(s, { vrsta, ...(dod.orodje ? { orodje: dod.orodje } : {}), ...(dod.klicId ? { klic: dod.klicId } : {}) });
  };
  /** Ena operacija naenkrat na nalogo (odgovor lastnika, izid pomocnika, ustavitev, zanka). */
  const vVrsti = <T,>(id: string, delo: () => Promise<T>): Promise<T> => {
    const p = (vrste.get(id) ?? Promise.resolve()).catch(() => undefined).then(delo);
    vrste.set(id, p);
    void p.finally(() => { if (vrste.get(id) === p) vrste.delete(id); }).catch(() => undefined);
    return p;
  };

  const imaPodatke = (s: StanjeNaloge) => s.sporocila.some((x) => x.vloga === "orodje" && x.ime !== "porocaj_vmesno" && x.ime !== "vprasaj_lastnika");
  // naloga 19: naloga je ze prebrala zasebne lokalne podatke (izid orodja z zasebniIzid) - splet potem caka lastnika
  const imaZasebne = (s: StanjeNaloge) => s.sporocila.some((x) => x.vloga === "orodje" && register.get(x.ime)?.zasebniIzid === true);

  const ucenjeZa = async (s: StanjeNaloge): Promise<UcenjeVmesnik | null> => {
    if (!s.ucenje) return null;
    if (ucenje === undefined) ucenje = await izberiUcenje(dir).catch(() => null);
    return ucenje;
  };

  const koncaj = async (s: StanjeNaloge, faza: Faza, razlog: StanjeNaloge["razlog"], besedilo: string) => {
    s.faza = faza;
    s.razlog = razlog;
    s.odprti = [];
    s.cakanje = null;
    // naloga 12 #12: potrditev v pomnilniku ne prezivi konca naloge (vrnjeno stanje z istim klicem bi jo porabilo)
    for (const mn of [potrjeniVProcesu, odprtiVProcesu]) for (const k of mn) if (k.startsWith(`${s.id}/`)) mn.delete(k);
    dogodek(s, faza === "koncano" ? "konec" : "napaka", besedilo);
    koncajTekVLini(root, s.id, faza === "koncano");
    await zapisi(s);
    const u = await ucenjeZa(s);
    if (u) {
      const izid = faza === "koncano" && razlog === "dosezeno" ? "uspeh" : faza === "koncano" ? "nepopolno" : "neuspeh";
      // naloga 19: izkusnja vsakega orodja (uspehi, napake, cas) za LearnHarness
      const imena = [...new Set([...s.delovalo, ...s.ni])];
      const orodja = imena.map((ime) => ({ ime, ok: s.delovalo.filter((x) => x === ime).length, napak: s.ni.filter((x) => x === ime).length, ms: Math.round(s.casiOrodij?.[ime] ?? 0) }));
      await u.poNalogi({ tip: s.tip, izid, delovalo: [...new Set(s.delovalo)], ni: [...new Set(s.ni)], orodja, razlog: String(razlog ?? faza), koraki: s.koraki, naloga: s.id, cas: iso() }).catch(() => undefined);
    }
  };

  /** Izid klica gre v zgodovino kot podatek; vbrizg okuzi nalogo. */
  const dodajIzid = async (s: StanjeNaloge, k: KlicOrodja, izid: { ok: boolean; besedilo: string; odLastnika?: boolean }) => {
    // besedilo lastnika (odgovor na vprasanje) ni nezaupan podatek: brez ovojnice in brez zaznave (lastnik ne okuzi svoje naloge)
    const ovito = izid.odLastnika ? { besedilo: izid.besedilo, vbrizg: [] as string[] } : ovijPodatek(k.ime, izid.besedilo, zakrijZnaneSkrivnosti);
    if (ovito.vbrizg.length && !s.okuzeno) {
      s.okuzeno = true;
      dogodek(s, "napaka", `V izidu orodja je zaznano vrinjeno navodilo (${ovito.vbrizg.join(", ")}); od zdaj vsa tvegana orodja cakajo potrditev.`, { orodje: k.ime, klicId: k.id });
    }
    s.sporocila.push({ vloga: "orodje", id: k.id, ime: k.ime, rezultat: ovito.besedilo, ...(izid.ok ? {} : { napaka: true }) });
    // pregled V1: samo imena iz registra (ime neznanega orodja izbere model in bi sicer slo v trajno izkusnjo)
    if (register.has(k.ime)) (izid.ok ? s.delovalo : s.ni).push(k.ime);
    s.odprti = s.odprti.filter((x) => x.id !== k.id);
    dogodek(s, "izid-orodja", `${izid.ok ? "uspeh" : "napaka"}: ${izid.besedilo.slice(0, 200)}`, { orodje: k.ime, klicId: k.id });
    void vDnevnik(s, { vrsta: "klic", orodje: k.ime, klic: k.id, odtis: odtisKlica(k.ime, k.argumenti), ok: izid.ok, znakov: izid.besedilo.length });
    const u = await ucenjeZa(s);
    if (u) {
      const p = await u.poKoraku({ tip: s.tip, korak: s.koraki, orodje: k.ime, ok: izid.ok, dolzina: izid.besedilo.length }).catch(() => null);
      if (p?.razumevanje === "dvom") dogodek(s, "ucenje", `Preverba koraka: ${p.opomba.slice(0, 200)}`, { orodje: k.ime });
    }
  };

  /** Zastavi vprasanje v skupni vrsti in ob odgovoru nadaljuje (odgovor se obdela v vrsti naloge). */
  const zastavi = (s: StanjeNaloge, orodje: string, vnos: Record<string, unknown>) => {
    const { id, odgovor } = zastaviVprasanjeVLini(root, s.id, orodje, vnos, rokVprasanja);
    void odgovor.then((odg) => vVrsti(s.id, () => poOdgovoru(s.id, id, odg))).then((st) => { if (st && st.faza === "tece") void teci(s.id).catch(() => undefined); }).catch(() => undefined);
    return id;
  };

  const poOdgovoru = async (nalogaId: string, vprasanjeId: string, odg: OdgovorVLini): Promise<StanjeNaloge | null> => {
    const s = await beriZaPisanje(nalogaId);
    if (!s || !s.cakanje || s.cakanje.vprasanjeId !== vprasanjeId) return null;
    const k = s.odprti.find((x) => x.id === s.cakanje!.klicId);
    if (!k) return null;
    if (s.faza === "caka-potrditev") {
      s.cakanje = null;
      s.faza = "tece";
      if (odg.dovoli) {
        dogodek(s, "korak-zacet", `Lastnik je potrdil ${k.ime}.`, { orodje: k.ime, klicId: k.id });
        k.zacet = true;
        potrjeniVProcesu.add(kljucPotrditve(s, k));
        await zapisi(s);
      } else {
        await dodajIzid(s, k, { ok: false, besedilo: `Lastnik dejanja ni dovolil (${odg.kdo || "rok"}). ${odg.sporocilo}` });
        await zapisi(s);
      }
      return s;
    }
    if (s.faza === "caka-lastnika") {
      s.cakanje = null;
      s.faza = "tece";
      const besedilo = odg.dovoli ? "Lastnik je odgovoril: da." : odg.kdo === "lastnik" || odg.kdo.startsWith("naprava:") ? "Lastnik je odgovoril: ne." : "Lastnik ni odgovoril v roku.";
      await dodajIzid(s, k, { ok: true, besedilo, odLastnika: true });
      await zapisi(s);
      return s;
    }
    return null;
  };

  /** Izvede odprte klice po vrsti; vrne false, ce naloga caka ali je ustavljena. */
  const izvediOdprte = async (s: StanjeNaloge, signal: AbortSignal): Promise<boolean> => {
    while (s.odprti.length) {
      if (signal.aborted) return false;
      const k = s.odprti[0]!;
      const orodje = register.get(k.ime);
      if (!orodje) {
        await dodajIzid(s, k, { ok: false, besedilo: `Orodje ${k.ime.slice(0, 64)} ne obstaja. Dovoljena orodja: ${[...register.keys()].join(", ")}.` });
        continue;
      }
      const napaka = preveriArgumente(orodje.definicija.parametri, k.argumenti);
      if (napaka) {
        await dodajIzid(s, k, { ok: false, besedilo: `Napacni argumenti: ${napaka}.` });
        continue;
      }
      const odtis = odtisKlica(k.ime, k.argumenti);
      s.ponovitve[odtis] = (s.ponovitve[odtis] ?? 0) + (k.zacet ? 0 : 1);
      if (s.ponovitve[odtis]! > s.proracun.najvecPonovitev) {
        // paket ostane cel: vsi odprti klici dobijo izid, zgodovina je veljavna tudi po ustavitvi
        for (const x of [...s.odprti]) await dodajIzid(s, x, { ok: false, besedilo: "Ni izvedeno: naloga je ustavljena (ponovljen klic)." });
        await koncaj(s, "ustavljeno", "ponovitev", `Ustavljeno: isti klic ${k.ime} vec kot ${s.proracun.najvecPonovitev}-krat.`);
        return false;
      }
      const potrjeno = potrjeniVProcesu.delete(kljucPotrditve(s, k));
      const zDiska = !odprtiVProcesu.has(kljucPotrditve(s, k)) && orodje.razred !== "branje";
      if (!potrjeno && (zDiska || zahtevaPotrditev(orodje, s.okuzeno, imaPodatke(s), imaZasebne(s)))) {
        s.faza = "caka-potrditev";
        s.cakanje = { klicId: k.id, vprasanjeId: null };
        k.zacet = true;
        s.cakanje.vprasanjeId = zastavi(s, k.ime, vnosZaPotrditev(k.argumenti));
        dogodek(s, "caka-potrditev", `Caka potrditev: ${k.ime}`, { orodje: k.ime, klicId: k.id });
        await zapisi(s);
        return false;
      }
      // pisi naprej (write-ahead): po ponovnem zagonu Lina ve, da se je klic morda ze izvedel
      k.zacet = true;
      dogodek(s, "korak-zacet", k.ime, { orodje: k.ime, klicId: k.id });
      await zapisi(s);
      const t0 = zdaj();
      let izid: IzidOrodja;
      try {
        // rok orodja: signal se prekine (orodje naj ga uposteva), izid je napaka; zanka ne visi na obeseni izvedbi
        const ac = new AbortController();
        const naPrekinitev = () => ac.abort();
        signal.addEventListener("abort", naPrekinitev, { once: true });
        let rok: ReturnType<typeof setTimeout> | undefined;
        try {
          izid = await Promise.race([
            orodje.izvedi(k.argumenti, { nalogaId: s.id, signal: ac.signal }),
            new Promise<IzidOrodja>((r) => {
              rok = setTimeout(() => { ac.abort(); r({ ok: false, napaka: "Orodje ni koncalo v roku." }); }, orodje.rokMs ?? ROK_ORODJA_MS);
              rok.unref?.(); // rok ne drzi procesa Line pri zaustavitvi
            }),
          ]);
        } finally {
          clearTimeout(rok);
          signal.removeEventListener("abort", naPrekinitev);
        }
      } catch (e) {
        izid = { ok: false, napaka: `Orodje ni uspelo: ${e instanceof Error ? e.message.slice(0, 200) : "napaka"}` };
      }
      s.casMs += Math.max(0, zdaj() - t0);
      s.casiOrodij = { ...s.casiOrodij, [k.ime]: (s.casiOrodij?.[k.ime] ?? 0) + Math.max(0, zdaj() - t0) };
      if ("vmesno" in izid) {
        dogodek(s, "vmesno", izid.vmesno, { orodje: k.ime, klicId: k.id });
        await dodajIzid(s, k, { ok: true, besedilo: "Sporoceno lastniku." });
      } else if ("caka" in izid) {
        s.faza = izid.caka === "pomocnik" ? "caka-pomocnika" : "caka-lastnika";
        s.cakanje = izid.caka === "pomocnik" ? { klicId: k.id, vprasanjeId: null, pomocnik: izid.nalogaId, od: iso() } : { klicId: k.id, vprasanjeId: null, vprasanje: izid.vprasanje };
        if (izid.caka === "lastnik") s.cakanje.vprasanjeId = zastavi(s, "vprasaj_lastnika", { vprasanje: izid.vprasanje });
        dogodek(s, izid.caka === "pomocnik" ? "korak-koncan" : "vprasanje", izid.caka === "pomocnik" ? `Naloga pomocniku predlagana (${izid.nalogaId}); caka potrditev in izid.` : izid.vprasanje, { orodje: k.ime, klicId: k.id });
        await zapisi(s);
        return false;
      } else {
        await dodajIzid(s, k, izid.ok ? { ok: true, besedilo: izid.rezultat } : { ok: false, besedilo: izid.napaka });
        dogodek(s, "korak-koncan", k.ime, { orodje: k.ime, klicId: k.id });
      }
      await zapisi(s);
    }
    return true;
  };

  const zanka = async (id: string): Promise<StanjeNaloge> => {
    let s = await preberi(id);
    if (!s) throw new OrkestratorNapaka("ni-naloge");
    if (s.faza !== "tece" || s.nepreverjeno) return s;
    const ac = new AbortController();
    prekinitve.set(id, ac);
    odpriTekVLini(root, s.id, "", s.gesloObZacetku);
    try {
      for (;;) {
        // drug klic (ustavi, odgovor) je lahko stanje spremenil na disku
        const sveze = await preberi(id);
        if (!sveze || sveze.faza !== "tece" || sveze.nepreverjeno || ac.signal.aborted) return sveze ?? s;
        s = sveze;
        // stikalo velja za vse: tudi naloga, ki ze tece, se ustavi
        if (!(await jeOrkestratorVklopljen(dir).catch(() => false))) {
          for (const x of [...s.odprti]) await dodajIzid(s, x, { ok: false, besedilo: "Ni izvedeno: izvajanje nalog je izklopljeno." });
          await koncaj(s, "ustavljeno", "izklopljeno", "Ustavljeno: izvajanje nalog je izklopljeno v Nastavitvah.");
          return s;
        }
        if (!(await izvediOdprte(s, ac.signal))) return (await preberi(id)) ?? s;
        if (!(await jeOrkestratorVklopljen(dir).catch(() => false))) {
          await koncaj(s, "ustavljeno", "izklopljeno", "Ustavljeno: izvajanje nalog je izklopljeno v Nastavitvah.");
          return s;
        }
        const meja = presezenaMeja(s.proracun, s.poraba, s.casMs, s.koraki);
        if (meja) {
          await koncaj(s, "ustavljeno", meja, `Ustavljeno: dosezena meja (${meja}).`);
          return s;
        }
        const u = await ucenjeZa(s);
        if (u) {
          const enote = (await u.predKorakom({ tip: s.tip, cilj: s.cilj, korak: s.koraki }).catch(() => [])).filter((e) => !s!.enoteUcenja.includes(e.naslov)).slice(0, 5);
          if (enote.length) {
            // pregled V1: izkusnje in enote so na disku (lahko podtaknjene) - vbrizg v njih okuzi nalogo kot vbrizg v izidu orodja
            const v = zaznajVbrizg(enote.map((e) => `${e.naslov}\n${e.besedilo}`).join("\n"));
            if (v.nezaupano && !s.okuzeno) {
              s.okuzeno = true;
              dogodek(s, "napaka", `V izkusnjah ucenja je zaznano vrinjeno navodilo (${v.vzorci.join(", ")}); od zdaj vsa tvegana orodja cakajo potrditev.`);
            }
            s.enoteUcenja.push(...enote.map((e) => e.naslov));
            s.sporocila.push({ vloga: "uporabnik", besedilo: ovijUcenje(enote) });
            dogodek(s, "ucenje", `V kontekst: ${enote.length} izkusenj (${enote[0]!.vir}).`);
          }
        }
        if (!klicModela) klicModela = await privzetiKlicModela(root);
        s.koraki += 1;
        dogodek(s, "korak-zacet", `Klic modela ${s.koraki}`);
        await zapisi(s);
        const t0 = zdaj();
        const r = await klicModela(skrciZgodovino(s.sporocila), definicije, { system: NAVODILO_ORKESTRATORJA, signal: ac.signal, predpomniPredpono: true });
        s.casMs += Math.max(0, zdaj() - t0);
        if (ac.signal.aborted) return (await preberi(id)) ?? s;
        if (!r.ok) {
          s.poraba.klici += 1;
          await koncaj(s, "napaka", "napaka", `Klic modela ni uspel: ${r.sporocilo.slice(0, 200)}`);
          return s;
        }
        s.poraba.klici += 1;
        // poraba samo kot koncna nenegativna stevila (NaN bi obsel mejo zetonov in pokvaril stanje na disku - pregled naloge 9)
        const veljavna = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
        if (r.usage && veljavna(r.usage.vhod) && veljavna(r.usage.izhod)) {
          s.poraba.vhod += r.usage.vhod;
          s.poraba.izhod += r.usage.izhod;
        } else {
          s.poraba.ocenjeno = true;
          s.poraba.vhod += ocenaZetonov(JSON.stringify(s.sporocila).length);
          s.poraba.izhod += ocenaZetonov(r.besedilo.length + JSON.stringify(r.klici).length);
        }
        if (r.razlogKonca === "varnost") {
          await koncaj(s, "napaka", "varnost", "Ponudnik je odgovor zavrnil (varnostni filter).");
          return s;
        }
        if (r.razlogKonca === "dolzina") {
          // odrezani argumenti se ne izvedejo; zahteva za krajsi odgovor steje kot korak
          s.sporocila.push({ vloga: "uporabnik", besedilo: "Odgovor je bil odrezan (meja dolzine). Ponovi krajse, en klic orodja naenkrat." });
          dogodek(s, "napaka", "Odgovor modela je bil odrezan; prosnja za krajsega.");
          await zapisi(s);
          continue;
        }
        if (r.klici.length) {
          // pregled V4: najvec NAJVEC_KLICEV_NA_ODGOVOR klicev na odgovor (sicer tisoce zapisov stanja in rast datoteke pred preverbo meja);
          // v zgodovino gredo samo izvedeni klici, zato ima vsak klic izid (paket cel)
          const vsi = preimenujKlice(r.klici, s.koraki);
          const klici = vsi.slice(0, NAJVEC_KLICEV_NA_ODGOVOR);
          if (vsi.length > klici.length) dogodek(s, "napaka", `Model je v enem odgovoru poslal ${vsi.length} klicev orodij; izvedenih je prvih ${klici.length}.`);
          s.sporocila.push({ vloga: "asistent", ...(r.besedilo ? { besedilo: r.besedilo } : {}), klici });
          s.odprti = klici.map((k) => ({ ...k }));
          for (const k of s.odprti) odprtiVProcesu.add(kljucPotrditve(s, k));
          if (s.koraki === 1 && r.besedilo) dogodek(s, "nacrt", r.besedilo);
          await zapisi(s);
          continue;
        }
        if (!r.besedilo) {
          s.sporocila.push({ vloga: "uporabnik", besedilo: "Prazen odgovor. Nadaljuj z orodjem ali podaj koncni odgovor z dokazom." });
          await zapisi(s);
          continue;
        }
        s.sporocila.push({ vloga: "asistent", besedilo: r.besedilo });
        // samopregled proti cilju (obstojeca ocena cilja): koncni odgovor sele, ko je dosezeno ali ni vec smiselno nadaljevati
        let ocena: Ocena | null = null;
        let dosezeno = false;
        if (oceni) ocena = await oceni(s.cilj, r.besedilo).catch(() => null);
        if (ocena) {
          const { stanje, odlocitev } = odlociNadaljevanje(s.cilja, ocena, r.besedilo);
          s.cilja = stanje;
          s.ocena = ocena;
          dosezeno = odlocitev.vrsta === "koncano";
          dogodek(s, "samopregled", `${ocena.ovira}: ${ocena.dokaz.slice(0, 200)}`);
          // zanka ima orodja, zato tudi »manjka dokaz« (ali dokaz, ki ga v izidu ni) dobi en krog za dokaz, ne takojsnjega konca
          const seNi = odlocitev.vrsta === "nadaljuj" || (odlocitev.vrsta === "ustavi" && odlocitev.razlog === "manjka-dokaz");
          if (seNi && s.samopregledov < NAJVEC_SAMOPREGLEDOV) {
            s.samopregledov += 1;
            s.sporocila.push({ vloga: "uporabnik", besedilo: `Samopregled: cilj se ni dosezen (${ocena.ovira}). Nadaljuj in koncaj z dokazom.` });
            await zapisi(s);
            continue;
          }
        } else {
          dogodek(s, "samopregled", "Samopregled ni bil mogoc (brez ocene).");
        }
        s.odgovor = r.besedilo;
        await koncaj(s, "koncano", dosezeno ? "dosezeno" : ocena ? "neuspeh" : null, r.besedilo);
        return s;
      }
    } catch (e) {
      // izjema (zapis na disk, ponudnik, ucenje) ne pusti naloge v »tece« brez razloga: konec z napako, ce se da zapisati
      const zadnje = (await preberi(id).catch(() => null)) ?? s;
      if (!KONCNE_FAZE.includes(zadnje.faza)) {
        await koncaj(zadnje, "napaka", "napaka", `Notranja napaka: ${e instanceof Error ? e.message.slice(0, 200) : "neznano"}`).catch(() => undefined);
      }
      return zadnje;
    } finally {
      prekinitve.delete(id);
    }
  };

  const brezNapake = (e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; };
  const obstaja = (p: string) => lstat(p).then(() => true, () => false);
  /** Naloga 12 #5: arhiv mora biti prava mapa lastnika (ne simbolna povezava, ne datoteka); sicer napaka in nic se ne premakne. */
  const mapaArhiva = async () => {
    const a = path.join(mapa, "arhiv");
    await mkdir(a, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
    const st = await lstat(a);
    const tujLastnik = imaPosixDovoljenja() && typeof process.getuid === "function" && st.uid !== process.getuid();
    if (st.isSymbolicLink() || !st.isDirectory() || tujLastnik) throw new Error("orkestrator/arhiv ni prava mapa lastnika");
    return a;
  };
  /**
   * Samo lastni datoteki naloge (id preverjen z VELJAVEN_ID); manjkajoca datoteka ni napaka. Dnevnik dejanj vedno v arhiv/ (naloga 11 N5,
   * naloga 12 #5: tudi rocni izbris; zapis izvedenih dejanj ostane, AGENTS.md), NAJPREJ arhiv in sele nato izbris stanja: napaka vmes
   * (arhiv ni mapa, Windows EBUSY) pusti nalogo celo. Obstojec arhiviran dnevnik se ne prepise.
   */
  const izbrisiDatoteke = async (id: string, zadnja = 0) => {
    const dnevnik = `${id}.dnevnik.jsonl`;
    if (await obstaja(path.join(mapa, dnevnik))) {
      const a = await mapaArhiva();
      let cilj = path.join(a, dnevnik);
      if (await obstaja(cilj)) cilj = path.join(a, `${id}.${zdaj()}.${randomBytes(3).toString("hex")}.dnevnik.jsonl`);
      await rename(path.join(mapa, dnevnik), cilj);
    }
    await unlink(path.join(mapa, pot(id))).catch(brezNapake);
    // naloga 12 #2: verzija izbrisane naloge ostane v indeksu (vec od zadnje): kopija se ne vrne
    const m = await znaneVerzije();
    // naloga 14 N8: ostane varno celo stevilo (sicer ga branje indeksa zavrze in izbris izgine)
    m.set(id, Math.min(Number.MAX_SAFE_INTEGER, Math.max(m.get(id) ?? 0, zadnja) + 1));
    brezVnosa.delete(id);
    await shraniIndeks();
  };
  /** Naloga 11 N5: cas v prihodnosti ali neberljiv ne steje kot novejsi (na konec vrste), sicer podtaknjene naloge izrinejo prave. */
  const veljavenCas = (s: StanjeNaloge) => {
    const t = Date.parse(s.posodobljeno);
    return Number.isFinite(t) && t <= zdaj() ? t : null;
  };
  /** Pregled V5: koncane starejse od HRANI_KONCANE_MS in najstarejse cez NAJVEC_KONCANIH; neveljavne in tuje datoteke ostanejo. */
  const pocisti = async () => {
    // naloga 14 N3: nepreverjene (lahko podtaknjene, poljuben cas) ne stejejo v mejo in se ne brisejo same - izbrise jih lastnik
    const koncane = (await seznamVeljavnih()).filter((s) => KONCNE_FAZE.includes(s.faza) && !s.nepreverjeno)
      .sort((a, b) => (veljavenCas(b) ?? 0) - (veljavenCas(a) ?? 0));
    for (const [i, s] of koncane.entries()) {
      // star samo po berljivem preteklem casu: ura, premaknjena nazaj, ne pocisti pravih nalog takoj (te gredo le cez mejo stevila)
      const t = veljavenCas(s);
      const star = t !== null && zdaj() - t > HRANI_KONCANE_MS;
      if (!star && i < NAJVEC_KONCANIH) continue;
      // naloga 12 #5: napaka pri eni nalogi ne ustavi ciscenja ostalih
      await vVrsti(s.id, async () => {
        const sveze = await preberi(s.id);
        if (sveze && KONCNE_FAZE.includes(sveze.faza)) await izbrisiDatoteke(s.id, sveze.verzija);
      }).catch(() => undefined);
    }
  };
  const seznamVeljavnih = async () => {
    const imena = (await readdir(mapa).catch(() => [])).filter((x) => /^o-[a-f0-9]{16}\.json$/.test(x));
    const vse = await Promise.all(imena.map((x) => preberi(x.slice(0, -5))));
    return vse.filter((x): x is StanjeNaloge => !!x).sort((a, b) => b.zacetek.localeCompare(a.zacetek));
  };

  const teci = (id: string): Promise<StanjeNaloge> => {
    const tece = tecejo.get(id);
    if (tece) return tece;
    const p = vVrsti(id, () => zanka(id)).finally(() => tecejo.delete(id));
    tecejo.set(id, p);
    return p;
  };

  return {
    async nova(v) {
      if (!(await jeOrkestratorVklopljen(dir))) throw new OrkestratorNapaka("izklopljeno");
      const cilj = typeof v.cilj === "string" ? v.cilj.normalize("NFC").trim() : "";
      if (!cilj || cilj.length > NAJVEC_ZNAKOV_CILJA || !(cilj as string & { isWellFormed(): boolean }).isWellFormed()) throw new OrkestratorNapaka("oblika");
      await mkdir(mapa, { recursive: true, mode: 0o700 });
      await pocisti().catch(() => undefined);
      // naloga 14 N3: nepreverjene (samo branje) ne stejejo - nikoli ne tecejo
      if ((await this.seznam()).filter((x) => !KONCNE_FAZE.includes(x.faza) && !x.nepreverjeno).length >= NAJVEC_NALOG) throw new OrkestratorNapaka("polno");
      const imaGeslo = o.imaGeslo ?? (async () => (await import("./auth.server.ts")).ownerExists(root));
      const s: StanjeNaloge = {
        id: `o-${randomBytes(8).toString("hex")}`, cilj, tip: normirajTip(v.tip), faza: "tece", razlog: null, odgovor: null, ocena: null,
        sporocila: [{ vloga: "uporabnik", besedilo: `NALOGA LASTNIKA:\n${cilj}` }], odprti: [], cakanje: null, dogodki: [], stDogodka: 0, koraki: 0,
        poraba: { vhod: 0, izhod: 0, klici: 0, ocenjeno: false }, casMs: 0, proracun: normirajProracun(v.proracun), ponovitve: {}, okuzeno: false,
        ucenje: ucenje !== null, enoteUcenja: [], cilja: zacetnoStanje(), samopregledov: 0, gesloObZacetku: await imaGeslo().catch(() => false),
        delovalo: [], ni: [], zacetek: iso(), posodobljeno: iso(),
      };
      odpriTekVLini(root, s.id, "", s.gesloObZacetku);
      dogodek(s, "korak-zacet", "Naloga sprejeta.");
      await zapisi(s);
      return s;
    },
    teci,
    async ustavi(id, razlog = "preklic") {
      prekinitve.get(id)?.abort();
      return vVrsti(id, async () => {
        const s = await preberi(id);
        if (!s) throw new OrkestratorNapaka("ni-naloge");
        if (KONCNE_FAZE.includes(s.faza)) return s;
        if (s.nepreverjeno) throw new OrkestratorNapaka("faza");
        if (s.cakanje?.vprasanjeId) prekliciVprasanjeVLini(root, s.cakanje.vprasanjeId);
        const zakaj = razlog === "izklopljeno" ? "izvajanje nalog je izklopljeno" : "lastnik je ustavil nalogo";
        for (const x of [...s.odprti]) await dodajIzid(s, x, { ok: false, besedilo: `Ni izvedeno: ${zakaj}.` });
        await koncaj(s, "ustavljeno", razlog, `Ustavljeno: ${zakaj}.`);
        return s;
      });
    },
    async odgovorLastnika(id, besedilo) {
      const st = await vVrsti(id, async () => {
        const s = await preberi(id);
        if (!s) throw new OrkestratorNapaka("ni-naloge");
        if (s.faza !== "caka-lastnika" || !s.cakanje || s.nepreverjeno) throw new OrkestratorNapaka("faza");
        const b = typeof besedilo === "string" ? besedilo.trim().slice(0, 2000) : "";
        if (!b) throw new OrkestratorNapaka("oblika");
        const k = s.odprti.find((x) => x.id === s.cakanje!.klicId);
        const vprasanje = s.cakanje.vprasanjeId;
        s.cakanje = null;
        s.faza = "tece";
        if (k) await dodajIzid(s, k, { ok: true, besedilo: `Lastnik je odgovoril: ${b}`, odLastnika: true });
        await zapisi(s);
        if (vprasanje) prekliciVprasanjeVLini(root, vprasanje);
        return s;
      });
      void teci(id).catch(() => undefined);
      return st;
    },
    async izidPomocnika(nalogaId) {
      await this.preveriPomocnike(nalogaId);
    },
    async preveriPomocnike(samo) {
      for (const s0 of await this.seznam()) {
        const pomocnik = s0.cakanje?.pomocnik;
        if (s0.faza !== "caka-pomocnika" || !pomocnik || s0.nepreverjeno || (samo !== undefined && pomocnik !== samo)) continue;
        // ni dogodka, ko lastnik predlog zavrne, ta potece ali izgine: preverba po id (ob dogodku, ob zagonu in periodicno) in rok
        const i = await izidPomocnikaBeri(pomocnik).catch(() => undefined);
        const od = Date.parse(s0.cakanje?.od ?? s0.posodobljeno);
        const potekel = Number.isFinite(od) && zdaj() - od > ROK_POMOCNIKA_MS;
        if (i === undefined && !potekel) continue;
        if (i && !i.koncano && !potekel) continue;
        const besedilo = i === null ? "Pomocnik: naloge ni (zavrnjena ali odstranjena)."
          : i && i.koncano ? `Pomocnik: stanje ${i.stanje}.\nPorocilo:\n${i.porocilo ?? "(brez porocila)"}`
            : "Pomocnik ni koncal v roku; nadaljuj brez njega ali vprasaj lastnika.";
        const ok = !!i && i.koncano && i.stanje === "koncano";
        await vVrsti(s0.id, async () => {
          const s = await beriZaPisanje(s0.id);
          if (!s || s.faza !== "caka-pomocnika" || !s.cakanje || s.cakanje.pomocnik !== pomocnik) return;
          const k = s.odprti.find((x) => x.id === s.cakanje!.klicId);
          s.cakanje = null;
          s.faza = "tece";
          if (k) await dodajIzid(s, k, { ok, besedilo });
          await zapisi(s);
        });
        void teci(s0.id).catch(() => undefined);
      }
    },
    async izbrisi(id) {
      pot(id);
      await vVrsti(id, async () => {
        const s = await preberi(id);
        if (!s) {
          // naloga 12 #3: neveljavna datoteka (napacen podpis, pokvarjena) z veljavnim id se lahko izbrise; tekoca ne
          const obstaja = await access(path.join(mapa, pot(id))).then(() => true, () => false);
          if (!obstaja) throw new OrkestratorNapaka("ni-naloge");
          if (tecejo.has(id)) throw new OrkestratorNapaka("faza");
          // naloga 14 N8: verzija iz surove datoteke (ce je celo stevilo), da izbris ne zniza znane verzije, ko indeks nima vnosa
          const surovo = await readJsonFile<unknown>(mapa, pot(id)).catch(() => null);
          const v = surovo && typeof surovo === "object" && !Array.isArray(surovo) ? (surovo as { verzija?: unknown }).verzija : undefined;
          return void (await izbrisiDatoteke(id, Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0));
        }
        // naloga 14 N3: nepreverjena (samo branje) se nikoli ne konca sama - izbris mozen v vsaki fazi, razen ce tece
        if (!KONCNE_FAZE.includes(s.faza) && !(s.nepreverjeno && !tecejo.has(id))) throw new OrkestratorNapaka("faza");
        await izbrisiDatoteke(id, s.verzija);
      });
    },
    async nadaljujPoZagonu() {
      await pocisti().catch(() => undefined);
      const nadaljevane: string[] = [];
      const vklopljen = await jeOrkestratorVklopljen(dir).catch(() => false);
      for (const s0 of await this.seznam()) {
        // naloga 14 N3: nepreverjena (brez podpisa) se nikoli ne nadaljuje, ne ustavi in ne zapise
        if (KONCNE_FAZE.includes(s0.faza) || s0.nepreverjeno) continue;
        if (!vklopljen) {
          // izklopljeno stikalo: nedokoncane naloge se ob zagonu ustavijo, ne nadaljujejo
          await this.ustavi(s0.id, "izklopljeno").catch(() => undefined);
          continue;
        }
        odpriTekVLini(root, s0.id, "", s0.gesloObZacetku);
        await vVrsti(s0.id, async () => {
          const s = await beriZaPisanje(s0.id);
          if (!s) return;
          // naloga 11 N1: izidov orodij z diska ni mogoce preveriti za vbrizg za nazaj - konzervativno okuzeno
          if (imaPodatke(s) && !s.okuzeno) {
            s.okuzeno = true;
            dogodek(s, "napaka", "Po ponovnem zagonu Line prebranih izidov ni mogoce znova preveriti; od zdaj vsa tvegana orodja cakajo potrditev.");
          }
          // zacet klic brez izida: branje se ponovi, vse drugo ne (izid neznan) - razen cakajoce potrditve, ki se zastavi znova
          for (const k of [...s.odprti]) {
            if (!k.zacet || (s.cakanje && s.cakanje.klicId === k.id)) continue;
            const r = register.get(k.ime)?.razred;
            if (r === "branje") k.zacet = false;
            else await dodajIzid(s, k, { ok: false, besedilo: "Lina se je ponovno zagnala med izvajanjem; ali se je dejanje izvedlo, ni znano. Preveri, preden ponovis." });
          }
          if ((s.faza === "caka-potrditev" || s.faza === "caka-lastnika") && s.cakanje) {
            const k = s.odprti.find((x) => x.id === s.cakanje!.klicId);
            if (k) s.cakanje.vprasanjeId = zastavi(s, s.faza === "caka-lastnika" ? "vprasaj_lastnika" : k.ime, s.faza === "caka-lastnika" ? { vprasanje: s.cakanje.vprasanje ?? "" } : vnosZaPotrditev(k.argumenti));
          }
          await zapisi(s);
        });
        nadaljevane.push(s0.id);
        if (s0.faza === "tece") void teci(s0.id).catch(() => undefined);
        if (s0.faza === "caka-pomocnika" && s0.cakanje?.pomocnik) await this.preveriPomocnike(s0.cakanje.pomocnik);
      }
      return nadaljevane;
    },
    preberi,
    seznam: seznamVeljavnih,
    indeksObnovljen: () => brezVnosa.size > 0,
    imenaOrodij: () => [...register.keys()],
  };
}

// --- privzeti primerek za streznik (funkcije za vmesnik) ------------------------------------------------------------

const primerki = new Map<string, Orkestrator>();
export function orkestrator(dir?: string): Orkestrator {
  const root = resolveDataDir(dir);
  let p = primerki.get(root);
  if (!p) {
    // naloga 19: Lina dobi prava orodja (F2); preizkusi z ustvariOrkestrator podajo svoja
    p = ustvariOrkestrator(dir, { orodja: orodjaLine(dir) });
    primerki.set(root, p);
  }
  return p;
}

/** Ob zagonu Line: nadaljevanje nalog in narocnina na konec nalog pomocnikov (dogodek pride enkrat; ob ponovnem zagonu preveri nadaljujPoZagonu). */
const naroceni = new Set<string>();
export async function zazeniOrkestrator(dir?: string): Promise<void> {
  const o = orkestrator(dir);
  const root = resolveDataDir(dir);
  if (!naroceni.has(root)) {
    naroceni.add(root);
    const { obNalogaKoncana } = await import("./claude-naloge.server.ts");
    obNalogaKoncana((d) => void o.izidPomocnika(d.id).catch(() => undefined));
    // zavrnjen, potekel ali izginil predlog pomocniku nima dogodka: preverba vsako minuto (casovnik ne drzi procesa)
    setInterval(() => void o.preveriPomocnike().catch(() => undefined), 60_000).unref();
  }
  await o.nadaljujPoZagonu().catch(() => undefined);
}

// --- seja lastnika (vmesnik) ----------------------------------------------------------------------------------------

export type StanjeOrkestratorja = { vklopljen: boolean; indeksObnovljen: boolean; naloge: Array<JavnaNalogaOrkestratorja & { potrditev: { vprasanjeId: string; zgostitev: string; predogled: string; odrezano: boolean } | null }> };

export async function stanjeOrkestratorja(token: string | null, dir?: string): Promise<StanjeOrkestratorja> {
  const root = resolveDataDir(dir);
  const { requireOwner } = await import("./auth.server.ts");
  await requireOwner(token, root);
  const { stanjeVprasanjZaRoot } = await import("./vprasanja-agentov.server.ts");
  const vprasanja = stanjeVprasanjZaRoot(root).vprasanja;
  // naloga 14 N3: preverjene najprej (stabilno, po zacetku), da podtaknjene nepreverjene z novejsim zacetkom ne skrijejo pravih
  const naloge = (await orkestrator(dir).seznam()).sort((a, b) => Number(!!a.nepreverjeno) - Number(!!b.nepreverjeno)).slice(0, 20).map((s) => {
    const j = javnaNaloga(s);
    const v = j.cakanje?.vprasanjeId && !j.nepreverjeno ? vprasanja.find((x) => x.id === j.cakanje!.vprasanjeId && x.stanje === "caka") : undefined;
    // potrditev veze zgostitev prikazanega vnosa (ista kot pri vprasanjih agentov): lastnik potrdi natanko to, kar vidi
    return { ...j, potrditev: v ? { vprasanjeId: v.id, zgostitev: v.zgostitev, predogled: v.predogled, odrezano: v.odrezano } : null };
  });
  return { vklopljen: await jeOrkestratorVklopljen(dir), indeksObnovljen: orkestrator(dir).indeksObnovljen(), naloge };
}

/**
 * Ukazi iz kartice: nova naloga, ustavi, odgovor na vprasanje (besedilo), potrdi/zavrni (po poti vprasanj agentov: »dovoli« z geslom).
 * izLupine: zahteva nosi veljaven zeton lupine (okno Line). Pregled V6: brez gesla lokalno sejo dobi vsak lokalni proces, zato novo
 * nalogo brez gesla ustvari samo okno lupine; z geslom velja seja z geslom (kot »dovoli«).
 */
export async function ukazOrkestratorja(token: string | null, ukaz: unknown, dir?: string, izLupine = false): Promise<StanjeOrkestratorja> {
  const root = resolveDataDir(dir);
  const { requireOwner } = await import("./auth.server.ts");
  await requireOwner(token, root);
  const u = ukaz && typeof ukaz === "object" && !Array.isArray(ukaz) ? (ukaz as Record<string, unknown>) : {};
  const o = orkestrator(dir);
  const id = typeof u.id === "string" ? u.id : "";
  // nova naloga, odgovor namesto lastnika (gre v nalogo kot besedilo lastnika, brez ovojnice) in izbris: brez gesla samo okno lupine
  if ((u.vrsta === "nova" || u.vrsta === "odgovor" || u.vrsta === "izbrisi") && !izLupine && !(await (await import("./auth.server.ts")).ownerExists(root))) {
    throw new OrkestratorNapaka("geslo");
  }
  if (u.vrsta === "nova") {
    const s = await o.nova({ cilj: u.cilj, tip: u.tip });
    void o.teci(s.id).catch(() => undefined);
  } else if (u.vrsta === "ustavi") {
    await o.ustavi(id);
  } else if (u.vrsta === "izbrisi") {
    await o.izbrisi(id);
  } else if (u.vrsta === "odgovor") {
    await o.odgovorLastnika(id, u.besedilo);
  } else if (u.vrsta === "potrdi" || u.vrsta === "zavrni") {
    const { odgovorVprasanja } = await import("./vprasanja-agentov.server.ts");
    await odgovorVprasanja(token, { id: u.vprasanjeId, odlocitev: u.vrsta === "potrdi" ? "dovoli" : "zavrni", zgostitev: u.zgostitev }, dir);
  } else {
    throw new OrkestratorNapaka("oblika");
  }
  return stanjeOrkestratorja(token, dir);
}

export type JavnaNalogaOrkestratorja = Pick<StanjeNaloge, "id" | "cilj" | "faza" | "razlog" | "odgovor" | "koraki" | "poraba" | "proracun" | "okuzeno" | "zacetek" | "posodobljeno"> & {
  nepreverjeno: boolean;
  dogodki: DogodekOrkestratorja[];
  cakanje: { orodje: string; argumenti: string; vprasanjeId: string | null; vprasanje: string | null; pomocnik: string | null } | null;
  casMs: number;
};

/** Za vmesnik: brez zgodovine sporocil (izidi orodij ostanejo samo v dogodkih kot kratki povzetki). */
export function javnaNaloga(s: StanjeNaloge): JavnaNalogaOrkestratorja {
  const k = s.cakanje ? s.odprti.find((x) => x.id === s.cakanje!.klicId) : undefined;
  return {
    id: s.id, cilj: s.cilj, faza: s.faza, razlog: s.razlog, odgovor: s.odgovor, koraki: s.koraki, poraba: s.poraba, proracun: s.proracun, okuzeno: s.okuzeno,
    nepreverjeno: s.nepreverjeno === true, zacetek: s.zacetek, posodobljeno: s.posodobljeno, dogodki: s.dogodki.slice(-60), casMs: s.casMs,
    cakanje: s.cakanje ? { orodje: k?.ime ?? "", argumenti: JSON.stringify(k?.argumenti ?? {}).slice(0, 2000), vprasanjeId: s.cakanje.vprasanjeId, vprasanje: s.cakanje.vprasanje ?? null, pomocnik: s.cakanje.pomocnik ?? null } : null,
  };
}
