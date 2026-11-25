/**
 * Orkestrator agentov v Lini (lastnik 25. 11. 2026): zanka s stanjem, ki modelu poda orodja, jih izvaja po registru in porocа vmesne
 * izide, preden vrne koncni odgovor. Stanje naloge je na disku (<podatki>/orkestrator/<id>.json, 0600, atomarno) po VSAKEM koraku, zato
 * naloga prezivi ponovni zagon Line. Meje (koraki, zetoni, cas, ponovitve) vedno ustavijo z razlogom.
 *
 * Varnost: izid orodja je podatek (ovijPodatek); vbrizg v izidu naredi nalogo okuzeno - od tedaj vsa orodja razen branja cakajo lastnika.
 * Potrditev je vezana na en klic (vprasanje z zgostitvijo vnosa, enkratno, rok = zavrnitev) po isti poti kot vprasanja agentov, zato jo
 * vidita tudi znacka/obvestilo namizja in telefon. Pisanja, ukazov in brisanja ta datoteka sama ne zna: taka orodja (F2, peskovnik) se
 * dodajo v register; brez njih Lina dela samo z vgrajenimi orodji. Tajnica (klici) te datoteke ne uvaza.
 * Komentarji brez sumnikov.
 */
import { appendFile, chmod, mkdir, readdir, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { odlociNadaljevanje, zacetnoStanje, zakrijSkrivnosti, type Ocena, type StanjeCilja } from "./cilj-naloge.ts";
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
  zahtevaPotrditev,
  type IzidOrodja,
  type OrodjeOrkestratorja,
  type Poraba,
  type Proracun,
  type RazlogUstavitve,
  type RegisterOrodij,
} from "./orkestrator.ts";
import { izberiUcenje, normirajTip, type UcenjeVmesnik } from "./orkestrator-ucenje.ts";
import { zaznajVbrizg } from "./vbrizg.ts";
import type { DefinicijaOrodja, KlicOrodja, MoznostiOrodij, RezultatOrodij, SporociloOrodja } from "./providers.ts";
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
  ucenje: boolean;
  enoteUcenja: string[];
  cilja: StanjeCilja;
  samopregledov: number;
  gesloObZacetku: boolean;
  delovalo: string[];
  ni: string[];
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
  readonly koda: "izklopljeno" | "ni-naloge" | "oblika" | "polno" | "faza";
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
  /** Izbris koncane naloge (stanje in dnevnik); nekoncana -> napaka »faza«. */
  izbrisi(id: string): Promise<void>;
  izidPomocnika(nalogaId: string): Promise<void>;
  /** Ob zagonu Line: nadaljuje tekoce naloge, znova zastavi cakajoca vprasanja, preveri pomocnike. */
  nadaljujPoZagonu(): Promise<string[]>;
  preberi(id: string): Promise<StanjeNaloge | null>;
  seznam(): Promise<StanjeNaloge[]>;
};

const VELJAVEN_ID = /^o-[a-f0-9]{16}$/;
const FAZE: ReadonlyArray<Faza> = ["tece", "caka-potrditev", "caka-lastnika", "caka-pomocnika", "koncano", "ustavljeno", "napaka"];
/** Orodje, na katerega caka faza (caka-potrditev: katero koli orodje iz registra s potrditvijo). */
const ORODJE_CAKANJA: Partial<Record<Faza, string>> = { "caka-lastnika": "vprasaj_lastnika", "caka-pomocnika": "dodeli_pomocniku" };

/**
 * Naloga 9 V7: oblika stanja z diska (datoteko lahko podtakne ali pokvari kdor koli z dostopom do mape podatkov). Vrne razlog ali
 * null. Orodja: delovalo/ni, potrjen klic in klic, na katerega naloga caka, samo iz registra; odprt klic z izmisljenim imenom je
 * veljaven (dobi izid »ne obstaja«, pregled V1). Vsebine (npr. podtaknjene zastavice potrjeno pri orodju iz registra) shema ne loci.
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
      : m.vloga === "asistent" ? (m.besedilo === undefined || niz(m.besedilo)) && (m.klici === undefined || (Array.isArray(m.klici) && m.klici.every((k) => obj(k) && niz(k.id) && niz(k.ime) && obj(k.argumenti))))
        : m.vloga === "orodje" && niz(m.id) && niz(m.ime) && (niz(m.rezultat) || obj(m.rezultat)) && (m.napaka === undefined || typeof m.napaka === "boolean")))) return "sporocila";
  if (!Array.isArray(x.odprti) || !x.odprti.every((k) => obj(k) && niz(k.id) && niz(k.ime) && obj(k.argumenti)
    && (k.zacet === undefined || typeof k.zacet === "boolean") && (k.potrjeno === undefined || (k.potrjeno === true && imaOrodje(k.ime as string))))) return "odprti";
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
  if (!nizi(x.enoteUcenja)) return "enoteUcenja";
  const ci = x.cilja;
  if (!obj(ci) || !st(ci.nadaljevanj) || !st(ci.brezNapredka) || !niz(ci.zadnjiIzid)) return "cilja";
  if (!nizi(x.delovalo) || !nizi(x.ni) || ![...(x.delovalo as string[]), ...(x.ni as string[])].every(imaOrodje)) return "delovalo/ni";
  if (!niz(x.zacetek) || !niz(x.posodobljeno)) return "cas";
  return null;
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

  const pot = (id: string) => {
    if (!VELJAVEN_ID.test(id)) throw new OrkestratorNapaka("ni-naloge");
    return `${id}.json`;
  };
  const zeJavljeno = new Set<string>();
  const preberi = async (id: string): Promise<StanjeNaloge | null> => {
    if (!VELJAVEN_ID.test(id)) return null;
    const x = await readJsonFile<unknown>(mapa, pot(id)).catch(() => null);
    if (x === null) return null;
    const razlog = razlogNeveljavnegaStanja(x, id, (ime) => register.has(ime));
    if (razlog === null) return x as StanjeNaloge;
    // pregled V7: neveljavno stanje se ne nadaljuje in ne pokaze; v dnevnik enkrat na nalogo (seznam bere ob vsakem osvezenju)
    if (!zeJavljeno.has(id)) {
      zeJavljeno.add(id);
      await vDnevnik({ id } as StanjeNaloge, { vrsta: "neveljavno-stanje", razlog });
    }
    return null;
  };
  const zapisi = async (s: StanjeNaloge) => {
    s.posodobljeno = iso();
    await writeJson(mapa, pot(s.id), s);
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
    dogodek(s, faza === "koncano" ? "konec" : "napaka", besedilo);
    koncajTekVLini(root, s.id, faza === "koncano");
    await zapisi(s);
    const u = await ucenjeZa(s);
    if (u) {
      const izid = faza === "koncano" && razlog === "dosezeno" ? "uspeh" : faza === "koncano" ? "nepopolno" : "neuspeh";
      await u.poNalogi({ tip: s.tip, izid, delovalo: [...new Set(s.delovalo)], ni: [...new Set(s.ni)], razlog: String(razlog ?? faza), koraki: s.koraki, naloga: s.id, cas: iso() }).catch(() => undefined);
    }
  };

  /** Izid klica gre v zgodovino kot podatek; vbrizg okuzi nalogo. */
  const dodajIzid = async (s: StanjeNaloge, k: KlicOrodja, izid: { ok: boolean; besedilo: string; odLastnika?: boolean }) => {
    // besedilo lastnika (odgovor na vprasanje) ni nezaupan podatek: brez ovojnice in brez zaznave (lastnik ne okuzi svoje naloge)
    const ovito = izid.odLastnika ? { besedilo: izid.besedilo, vbrizg: [] as string[] } : ovijPodatek(k.ime, izid.besedilo);
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
    const s = await preberi(nalogaId);
    if (!s || !s.cakanje || s.cakanje.vprasanjeId !== vprasanjeId) return null;
    const k = s.odprti.find((x) => x.id === s.cakanje!.klicId);
    if (!k) return null;
    if (s.faza === "caka-potrditev") {
      s.cakanje = null;
      s.faza = "tece";
      if (odg.dovoli) {
        dogodek(s, "korak-zacet", `Lastnik je potrdil ${k.ime}.`, { orodje: k.ime, klicId: k.id });
        k.zacet = true;
        (k as OdprtKlic & { potrjeno?: boolean }).potrjeno = true;
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
      const potrjeno = (k as OdprtKlic & { potrjeno?: boolean }).potrjeno === true;
      const imaPodatke = s.sporocila.some((x) => x.vloga === "orodje" && x.ime !== "porocaj_vmesno" && x.ime !== "vprasaj_lastnika");
      if (!potrjeno && zahtevaPotrditev(orodje, s.okuzeno, imaPodatke)) {
        s.faza = "caka-potrditev";
        s.cakanje = { klicId: k.id, vprasanjeId: null };
        k.zacet = true;
        s.cakanje.vprasanjeId = zastavi(s, k.ime, k.argumenti);
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
    if (s.faza !== "tece") return s;
    const ac = new AbortController();
    prekinitve.set(id, ac);
    odpriTekVLini(root, s.id, "", s.gesloObZacetku);
    try {
      for (;;) {
        // drug klic (ustavi, odgovor) je lahko stanje spremenil na disku
        const sveze = await preberi(id);
        if (!sveze || sveze.faza !== "tece" || ac.signal.aborted) return sveze ?? s;
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
        if (r.usage) {
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

  /** Samo lastni datoteki veljavne naloge (id preverjen z VELJAVEN_ID); manjkajoca datoteka ni napaka. */
  const izbrisiDatoteke = async (id: string) => {
    for (const ime of [pot(id), `${id}.dnevnik.jsonl`]) {
      await unlink(path.join(mapa, ime)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
    }
  };
  /** Pregled V5: koncane starejse od HRANI_KONCANE_MS in najstarejse cez NAJVEC_KONCANIH; neveljavne in tuje datoteke ostanejo. */
  const pocisti = async () => {
    const koncane = (await seznamVeljavnih()).filter((s) => KONCNE_FAZE.includes(s.faza))
      .sort((a, b) => b.posodobljeno.localeCompare(a.posodobljeno));
    for (const [i, s] of koncane.entries()) {
      const star = zdaj() - Date.parse(s.posodobljeno) > HRANI_KONCANE_MS;
      if (!star && i < NAJVEC_KONCANIH) continue;
      await vVrsti(s.id, async () => {
        const sveze = await preberi(s.id);
        if (sveze && KONCNE_FAZE.includes(sveze.faza)) await izbrisiDatoteke(s.id);
      });
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
      if ((await this.seznam()).filter((x) => !KONCNE_FAZE.includes(x.faza)).length >= NAJVEC_NALOG) throw new OrkestratorNapaka("polno");
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
        if (s.faza !== "caka-lastnika" || !s.cakanje) throw new OrkestratorNapaka("faza");
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
        if (s0.faza !== "caka-pomocnika" || !pomocnik || (samo !== undefined && pomocnik !== samo)) continue;
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
          const s = await preberi(s0.id);
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
        if (!s) throw new OrkestratorNapaka("ni-naloge");
        if (!KONCNE_FAZE.includes(s.faza)) throw new OrkestratorNapaka("faza");
        await izbrisiDatoteke(id);
      });
    },
    async nadaljujPoZagonu() {
      await pocisti().catch(() => undefined);
      const nadaljevane: string[] = [];
      const vklopljen = await jeOrkestratorVklopljen(dir).catch(() => false);
      for (const s0 of await this.seznam()) {
        if (KONCNE_FAZE.includes(s0.faza)) continue;
        if (!vklopljen) {
          // izklopljeno stikalo: nedokoncane naloge se ob zagonu ustavijo, ne nadaljujejo
          await this.ustavi(s0.id, "izklopljeno").catch(() => undefined);
          continue;
        }
        odpriTekVLini(root, s0.id, "", s0.gesloObZacetku);
        await vVrsti(s0.id, async () => {
          const s = await preberi(s0.id);
          if (!s) return;
          // zacet klic brez izida: branje se ponovi, vse drugo ne (izid neznan) - razen cakajoce potrditve, ki se zastavi znova
          for (const k of [...s.odprti]) {
            if (!k.zacet || (s.cakanje && s.cakanje.klicId === k.id)) continue;
            const r = register.get(k.ime)?.razred;
            if (r === "branje") k.zacet = false;
            else await dodajIzid(s, k, { ok: false, besedilo: "Lina se je ponovno zagnala med izvajanjem; ali se je dejanje izvedlo, ni znano. Preveri, preden ponovis." });
          }
          if ((s.faza === "caka-potrditev" || s.faza === "caka-lastnika") && s.cakanje) {
            const k = s.odprti.find((x) => x.id === s.cakanje!.klicId);
            if (k) s.cakanje.vprasanjeId = zastavi(s, s.faza === "caka-lastnika" ? "vprasaj_lastnika" : k.ime, s.faza === "caka-lastnika" ? { vprasanje: s.cakanje.vprasanje ?? "" } : k.argumenti);
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
  };
}

// --- privzeti primerek za streznik (funkcije za vmesnik) ------------------------------------------------------------

const primerki = new Map<string, Orkestrator>();
export function orkestrator(dir?: string): Orkestrator {
  const root = resolveDataDir(dir);
  let p = primerki.get(root);
  if (!p) {
    p = ustvariOrkestrator(dir);
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

export type StanjeOrkestratorja = { vklopljen: boolean; naloge: Array<JavnaNalogaOrkestratorja & { potrditev: { vprasanjeId: string; zgostitev: string; predogled: string; odrezano: boolean } | null }> };

export async function stanjeOrkestratorja(token: string | null, dir?: string): Promise<StanjeOrkestratorja> {
  const root = resolveDataDir(dir);
  const { requireOwner } = await import("./auth.server.ts");
  await requireOwner(token, root);
  const { stanjeVprasanjZaRoot } = await import("./vprasanja-agentov.server.ts");
  const vprasanja = stanjeVprasanjZaRoot(root).vprasanja;
  const naloge = (await orkestrator(dir).seznam()).slice(0, 20).map((s) => {
    const j = javnaNaloga(s);
    const v = j.cakanje?.vprasanjeId ? vprasanja.find((x) => x.id === j.cakanje!.vprasanjeId && x.stanje === "caka") : undefined;
    // potrditev veze zgostitev prikazanega vnosa (ista kot pri vprasanjih agentov): lastnik potrdi natanko to, kar vidi
    return { ...j, potrditev: v ? { vprasanjeId: v.id, zgostitev: v.zgostitev, predogled: v.predogled, odrezano: v.odrezano } : null };
  });
  return { vklopljen: await jeOrkestratorVklopljen(dir), naloge };
}

/** Ukazi iz kartice: nova naloga, ustavi, odgovor na vprasanje (besedilo), potrdi/zavrni (po poti vprasanj agentov: »dovoli« z geslom). */
export async function ukazOrkestratorja(token: string | null, ukaz: unknown, dir?: string): Promise<StanjeOrkestratorja> {
  const root = resolveDataDir(dir);
  const { requireOwner } = await import("./auth.server.ts");
  await requireOwner(token, root);
  const u = ukaz && typeof ukaz === "object" && !Array.isArray(ukaz) ? (ukaz as Record<string, unknown>) : {};
  const o = orkestrator(dir);
  const id = typeof u.id === "string" ? u.id : "";
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
  dogodki: DogodekOrkestratorja[];
  cakanje: { orodje: string; argumenti: string; vprasanjeId: string | null; vprasanje: string | null; pomocnik: string | null } | null;
  casMs: number;
};

/** Za vmesnik: brez zgodovine sporocil (izidi orodij ostanejo samo v dogodkih kot kratki povzetki). */
export function javnaNaloga(s: StanjeNaloge): JavnaNalogaOrkestratorja {
  const k = s.cakanje ? s.odprti.find((x) => x.id === s.cakanje!.klicId) : undefined;
  return {
    id: s.id, cilj: s.cilj, faza: s.faza, razlog: s.razlog, odgovor: s.odgovor, koraki: s.koraki, poraba: s.poraba, proracun: s.proracun, okuzeno: s.okuzeno,
    zacetek: s.zacetek, posodobljeno: s.posodobljeno, dogodki: s.dogodki.slice(-60), casMs: s.casMs,
    cakanje: s.cakanje ? { orodje: k?.ime ?? "", argumenti: JSON.stringify(k?.argumenti ?? {}).slice(0, 2000), vprasanjeId: s.cakanje.vprasanjeId, vprasanje: s.cakanje.vprasanje ?? null, pomocnik: s.cakanje.pomocnik ?? null } : null,
  };
}
