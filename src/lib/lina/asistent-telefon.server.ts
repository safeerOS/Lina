/**
 * Asistentka za telefon v programu Line: nastavitve (privzeto IZKLOPLJENO), zagon strezniku asistentke ob zagonu Line in ob
 * spremembi nastavitev, seznanjanje telefona s QR in potrditev lastnika (lastnik 14. 11. 2026).
 *
 * T1-S1: koda OpenLine (pot klicev) NI v QR in je telefon ne dobi ob prijavi: Lina jo izda sele, ko lastnik klikne »Dodaj«, in
 * jo da samo tej napravi (podpisan POST /seznani/klici). Zdruzena potrditev drzi za obe poti.
 *
 * Dostop: QR nosi samo naslov, vrata, odtis potrdila in enkratno kodo (10 min, ena prijava). Telefon s kodo prijavi svoj
 * javni kljuc in ime; v seznam naprav kanala ga doda SAMO lastnik z gumbom »Dodaj« v Lini (prijavljena seja). Nic iz zahteve
 * telefona ne podeli dostopa samo od sebe. Pogodba QR je v AGENTS.md.
 *
 * Namesto QR lahko lastnik klikne »Povezi s kodo« (koda-seznanitev.ts, SPAKE2 kot v Safeer Linku): izid je isti - prijava
 * caka na »Dodaj«, telefon dobi isti razdelek poti klicev kot iz QR.
 */
import { oceniZModelom, ovijCilj } from "./cilj-naloge.server.ts";
import { pogovorBrain } from "./keys.server.ts";
import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { IzvajalecClaudeCode } from "./asistent.server.ts";
import { AsistentStreznik, zasebenNaslov, type Seznanitve, type StanjeSeznanitve } from "./asistent-streznik.server.ts";
import { BREZ_PREHODA, izberiLanNaslov, izvorPrivzetePoti, naslovNaVmesniku, naslovZanke, odtisLan, omrezjeNaslova, prehodiVmesnikov, zasebniNaslovi } from "./zasebno-omrezje.server.ts";
import { createServer } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { requireOwner } from "./auth.server.ts";
import { ID_NAPRAVE, potVticnice } from "./kanal-claude.ts";
import { preberiKanal, pripraviKanal } from "./kanal-claude.server.ts";
import { povabiloOpenLine, stanjeOpenLine, telefoniOpenLine, type PovabiloOpenLine } from "./openline-povabilo.server.ts";
import { SeznanitevSKodo } from "./koda-seznanitev.ts";
import { idVSkupinah } from "./id-naprave.ts";
import { jeClanKroga, PRESKOK_PRIMERJAVE_ZA_CLANE } from "./clan-kroga.server.ts";
import { OglasMdns, type MoznostiOglasa } from "./mdns-oglas.server.ts";
import { kodaQr, svgQr } from "./qr.ts";
import { SKUPNO_KRAT, VarovalkaKode } from "./varovalka-kode.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { nastaviDodatekZaTelefon, opisStanjaDodatkov, stanjeDodatkovZaTelefon } from "./dodatki-telefon.server.ts";
import { kanalSeznamN8n, kanalUstvariN8n, kanalZazeniN8n, telefonPotrdiN8n, telefonPredlogN8n, telefonStanjeN8n } from "./n8n.server.ts";
import { apkZaTelefon, telefonPotrdi, telefonPredlog, telefonStanje } from "./gradnje-github.server.ts";
import { telefonDodeli, telefonPreklici, telefonStanjeNalog } from "./claude-naloge.server.ts";
import { odpriSejoClaude, zadnjiRazlogSeje, zapisiRazlogSeje, type RazlogSeje } from "./seja-claude.server.ts";
import { opozoriloPotrjeno } from "./opozorilo.server.ts";
import { telefonOdgovor, telefonVprasanja } from "./vprasanja-agentov.server.ts";
import { najdiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { AgentReleja, dovoljeniIzKanala, kljucReleja, type MoznostiPovezave, type StanjeAgenta } from "./rele-lina.server.ts";

export const NASTAVITVE_ASISTENTA = "asistent-telefon.json";
export const PRIVZETA_VRATA_ASISTENTA = 8446;
/** Koda QR velja 10 minut in samo za eno prijavo telefona. */
export const ROK_KODE_MS = 10 * 60_000;
/** Shema vsebine QR: ista kot QR konzole OpenLine (httpgateway://pair), v=1 doda razdelek asistentke (pogodba v AGENTS.md). */
export const SHEMA_QR = "httpgateway://pair";
/** Stanje varovalke kode (prezivi ponovni zagon, kot hub-varovalka.json v Linku). */
export const VAROVALKA_KODE = "koda-varovalka.json";

/** ocenaIzida: izid Claude Code gre k ponudniku modela za pogovor v oceno cilja (S1, drugi pregled 0.2.10); privzeto vklopljeno (odlocitev vodje). */
/** globalLink: Lina poslusa na releju link.safeer.si za seznanjene telefone zunaj doma (naloga 22); privzeto VKLOPLJENO (lastnik 25. 11. 2026 »da« po neodvisnem pregledu). */
/**
 * samodejniAgenti (naloga 18, lastnik 25. 11. 2026 23:25 in 23:35 »Da«): Lina sama odpre sejo Claude Code in sama zazene agente za naloge,
 * ki jih je lastnik potrdil (podpisal) na telefonu; privzeto VKLOPLJENO. Izklop: naloga za Claude Code dobi 503 kot prej, naloga agentu caka
 * lastnikovo potrditev na racunalniku.
 */
/**
 * omrezja (naloga 21, N1): odtisi omrezij (podomrezje + MAC privzetega prehoda, omrezjeNaslova), ki jih je lastnik odobril z izbiro naslova
 * (»Shrani« ali »Uporabi ta naslov«). Streznik za telefon in OpenLine poslusata na zasebnem naslovu SAMO v odobrenem omrezju; samodejno
 * sledenje naslovu (naloga 15) tudi. Brez zapisa (tudi po nadgradnji) ni odobreno nobeno omrezje - fail-closed, lastnik odobri z enim klikom.
 */
type Nastavitve = { vklop: boolean; naslov: string; vrata: number; imena: Record<string, string>; ocenaIzida: boolean; globalLink: boolean; samodejniAgenti: boolean; omrezja: string[] };
/** Najvec shranjenih odobrenih omrezij (najstarejse odpade). */
export const NAJVEC_OMREZIJ = 16;

function cisteNastavitve(n: Partial<Nastavitve> | null): Nastavitve {
  const vrata = Number.isInteger(n?.vrata) && (n!.vrata as number) >= 1024 && (n!.vrata as number) <= 65535 ? (n!.vrata as number) : PRIVZETA_VRATA_ASISTENTA;
  const naslov = typeof n?.naslov === "string" && zasebenNaslov(n.naslov) ? n.naslov : "127.0.0.1";
  const imena: Record<string, string> = {};
  for (const [id, ime] of Object.entries(n?.imena ?? {})) if (ID_NAPRAVE.test(id) && typeof ime === "string") imena[id] = ime.slice(0, 60);
  const omrezja = Array.isArray(n?.omrezja) ? [...new Set(n.omrezja.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120))].slice(-NAJVEC_OMREZIJ) : [];
  return { vklop: n?.vklop === true, naslov, vrata, imena, ocenaIzida: n?.ocenaIzida !== false, globalLink: n?.globalLink !== false, samodejniAgenti: n?.samodejniAgenti !== false, omrezja };
}

/**
 * Datoteke ni = privzeto (ocena izida vklopljena). Datoteka je, a je neberljiva, ni JSON objekt ali ima ocenaIzida, ki ni true/false:
 * ocena izida je IZKLOPLJENA (pregled 0225 A-12, odlocitev vodje: fail-closed - izid Claude Code ne gre k ponudniku modela, ce
 * lastnikovega izklopa ni mogoce prebrati). Ostale nastavitve ostanejo varne privzete (telefon izklopljen).
 */
async function preberiNastavitve(root: string): Promise<Nastavitve> {
  let n: unknown;
  try {
    n = await readJsonFile<unknown>(root, NASTAVITVE_ASISTENTA);
  } catch {
    return { ...cisteNastavitve(null), ocenaIzida: false, samodejniAgenti: false };
  }
  // readJsonFile da null tudi za vsebino »null«: privzeto samo, ce datoteke res ni
  if (n === null) return (await lstat(path.join(root, NASTAVITVE_ASISTENTA)).then(() => true, () => false)) ? { ...cisteNastavitve(null), ocenaIzida: false, samodejniAgenti: false } : cisteNastavitve(null);
  if (typeof n !== "object" || Array.isArray(n)) return { ...cisteNastavitve(null), ocenaIzida: false, samodejniAgenti: false };
  const c = cisteNastavitve(n as Partial<Nastavitve>);
  const ocena = (n as { ocenaIzida?: unknown }).ocenaIzida;
  // samodejniAgenti (naloga 18, slepi pregled N5): neveljavna vrednost ali neberljiva datoteka = izklopljeno (lastnikovega izklopa ne preglasimo)
  const samodejni = (n as { samodejniAgenti?: unknown }).samodejniAgenti;
  return { ...c, ...(ocena === undefined || typeof ocena === "boolean" ? {} : { ocenaIzida: false }), ...(samodejni === undefined || typeof samodejni === "boolean" ? {} : { samodejniAgenti: false }) };
}

/** Global Link (naloga 22): ali Lina poslusa na releju; privzeto DA (lastnik 25. 11. 2026), tudi ob neberljivi datoteki; NE samo ob izrecnem false. */
export async function globalLinkVklopljen(dir?: string): Promise<boolean> {
  return (await preberiNastavitve(resolveDataDir(dir))).globalLink;
}

/** Ali sme izid Claude Code k ponudniku modela (ocena cilja); prebere se ob vsakem izidu, zato izklop velja takoj. */
export async function dovoliOcenoIzida(dir?: string): Promise<boolean> {
  return (await preberiNastavitve(resolveDataDir(dir))).ocenaIzida;
}

// zasebniNaslovi je v zasebno-omrezje.server.ts (uporablja ga tudi glas telefona); izvoz ostaja tu zaradi obstojecih uvozov
export { zasebniNaslovi };

type Klici = { url: string; code: string; fp: string };
type Prijava = { stanje: StanjeSeznanitve; cas: number; naprava?: { id: string; kljuc: string; ime: string }; klici?: Klici | null; klicPrevzet?: number;
  /** N5: id, ki ga je lastnik izrecno potrdil (»ID se ujema«); velja samo za to prijavo in ta id, porabi se ob odlocitvi. */
  idPotrjen?: string };

type Tekoci = {
  streznik: AsistentStreznik;
  izvajalec: IzvajalecClaudeCode;
  osvezi: ReturnType<typeof setInterval>;
  naslov: string;
  vrata: number;
  odtis: string;
  koda: SeznanitevSKodo;
  varovalka: VarovalkaKode;
  /** Global Link (naloga 22): agent releja, ce je nastavitev vklopljena; sicer null. */
  rele: AgentReleja | null;
  globalLink: boolean;
  /** Naslov in vrata iz nastavitev; naslov/vrata zgoraj sta dejansko vezana (v rezervi 127.0.0.1 in prosta vrata). */
  zeleniNaslov: string;
  zelenaVrata: number;
  /**
   * Naloga 15: lokalni naslov ni na voljo (»naslov«) ali vrata zasedena (»vrata«): tece samo Global Link; null = doma dosegljiv.
   * Naloga 21 (N1): »omrezje« = racunalnik je v omrezju, ki ga lastnik ni odobril (doma ne poslusa, OpenLine ne tece).
   */
  rezerva: "naslov" | "vrata" | "omrezje" | null;
  /** Odtis lokalnega omrezja (odtisLan): rezerva »naslov«/»omrezje« se ponovi samo, ko se omrezje spremeni (sicer bi rele utripal vsakih 30 s). */
  omrezje: string;
  /** Naloga 21 (N3): zadnja preverba, ali so zelena vrata spet prosta (rezerva »vrata«). */
  vrataPreverjena: number;
  /** Slepi pregled 21 (9): zaporedne preverbe, v katerih omrezje tekocega streznika ni odobreno (ustavi sele druga - ARP ali VRRP ne utripa). */
  neodobreno: number;
};

/** Koda napake asistenta za vmesnik (besedilo v jeziku vmesnika: telNapaka_<koda>); prazno = brez napake. */
export type KodaNapakeAsistenta = "" | "naslov" | "vrata" | "omrezje" | "drugo";

type Stanje = {
  tekoci: Tekoci | null; napaka: string; prijave: Map<string, Prijava>; veriga: Promise<unknown>; opozoriloKlicev: string;
  oglas: OglasMdns | null;
  /** Vezava zagona poti klicev (OpenLine); vpise jo zagon programa (zagon.server.ts). Brez nje (preizkusi) se nic ne zazene. */
  klici?: VezaKlicev | null;
  /** Global Link: povezava do releja; vpise jo SAMO zagon programa (zagon.server.ts). Brez nje (preizkusi) se agent releja ne zazene. */
  rele?: MoznostiPovezave | null;
  /** Tekoca priprava poti klicev (ena obljuba za vse klice) in njeno opozorilo (prazno, ce je vse v redu). */
  pripravaKlicev?: Promise<void> | null;
  opozoriloPripraveKlicev?: string;
  /** Za preizkuse: lazno omrezje za oglas DNS-SD. */
  omrezje?: Pick<MoznostiOglasa, "vticnica" | "maska" | "platforma">;
  napakaKoda?: KodaNapakeAsistenta;
  /** Naloga 15: za preizkuse lazni vmesniki in izvor privzete poti (sicer networkInterfaces in izvorPrivzetePoti). */
  omrezjeNaslovov?: OmrezjeNaslovov | null;
  /** Naloga 15: obcasno preverjanje naslova (zagon programa). */
  nadzor?: ReturnType<typeof setInterval> | null;
  /** Naloga 21 (N1): naslov v omrezju, ki ga lastnik se ni odobril (gumb »Uporabi ta naslov«); prazno = ni predloga. */
  predlogNaslova?: string;
};
/** prehodi: MAC privzetih prehodov po vmesniku (prehodiVmesnikov); v preizkusih brez njih {} (nikoli pravi /proc). */
type OmrezjeNaslovov = { vmesniki: () => NodeJS.Dict<NetworkInterfaceInfo[]>; izvor: () => Promise<string | null>; prehodi?: () => Promise<Record<string, string>> };
const KLJUC = Symbol.for("lina.asistent.telefon");
function stanje(): Stanje {
  const g = globalThis as { [KLJUC]?: Stanje };
  g[KLJUC] ??= { tekoci: null, napaka: "", prijave: new Map(), veriga: Promise.resolve(), opozoriloKlicev: "", oglas: null };
  return g[KLJUC];
}

/**
 * Pot klicev (OpenLine) se zazene SAMA, ko tece telefon za asistentko, in ustavi z njim: uporabnik iz OpenLine ne vnese nic (lastnik 21. 11. 2026).
 * Zagon in ustavitev opravi vezava, ki jo ob zagonu programa vpise zagon.server.ts (ta modul ne uvozi zagona OpenLine neposredno).
 */
export type VezaKlicev = { zagotovi: (root: string, naslov: string) => Promise<void>; ustavi: () => Promise<void> };
export function registrirajVezoKlicev(veza: VezaKlicev | null): void {
  stanje().klici = veza;
}
/** Global Link: dovoli agenta releja (zagon programa); {} = pravi link.safeer.si, null = nikoli (privzeto v preizkusih). */
export function registrirajRele(povezava: MoznostiPovezave | null): void {
  stanje().rele = povezava;
}
/** Varovalka cakanja na pripravo poti klicev v zacniSeznanitev (priprava ima svoj rok; to je zgornja meja). */
export const ROK_PRIPRAVE_KLICEV_MS = 25_000;

/** Zagotovi pot klicev; ENA tekoca obljuba za vse klice, nikoli ne zavrne (napaka postane opozorilo brez skrivnosti). */
function pripraviPotKlicev(root: string, naslov: string): Promise<void> {
  const s = stanje();
  const veza = s.klici;
  if (!veza) return Promise.resolve();
  if (s.pripravaKlicev) return s.pripravaKlicev;
  const p: Promise<void> = Promise.resolve()
    .then(() => veza.zagotovi(root, naslov))
    .then(() => { s.opozoriloPripraveKlicev = ""; })
    .catch((e: unknown) => { s.opozoriloPripraveKlicev = `Pot klicev ni pripravljena: ${e instanceof Error ? e.message.slice(0, 120) : "napaka"}`; })
    .finally(() => { if (s.pripravaKlicev === p) s.pripravaKlicev = null; });
  s.pripravaKlicev = p;
  return p;
}

/** Pocaka na pripravo poti klicev, najvec ROK_PRIPRAVE_KLICEV_MS; ne zavrne in ne ustavi priprave. */
async function pocakajPotKlicev(root: string, naslov: string): Promise<void> {
  let cas: NodeJS.Timeout | undefined;
  try {
    await Promise.race([pripraviPotKlicev(root, naslov), new Promise<void>((ok) => { cas = setTimeout(ok, ROK_PRIPRAVE_KLICEV_MS); })]);
  } finally {
    clearTimeout(cas);
  }
}

/** Ustavi pot klicev (po koncu tekoce priprave, da proces ne ostane brez lastnika); nikoli ne zavrne. */
async function ustaviPotKlicev(): Promise<void> {
  const s = stanje();
  await s.pripravaKlicev?.catch(() => undefined);
  s.opozoriloPripraveKlicev = "";
  await s.klici?.ustavi().catch(() => undefined);
}

/** Zaporedno: dva hkratna klica (zagon in shranjevanje) ne smeta zagnati dveh streznikov. */
function zaporedno<T>(delo: () => Promise<T>): Promise<T> {
  const s = stanje();
  const p = s.veriga.then(delo, delo);
  s.veriga = p.catch(() => undefined);
  return p;
}

function pocistiPrijave(zdaj = Date.now()): void {
  for (const [k, p] of stanje().prijave) if (zdaj - p.cas > ROK_KODE_MS) stanje().prijave.delete(k);
}

/** Naloga 21 (N2): neporabljene QR (stanje »odprta«) ne veljajo vec; cakajoce in sprejete prijave ostanejo (telefon po »Dodaj« prevzame pot klicev). */
function prekliciOdprte(): void {
  for (const [k, p] of stanje().prijave) if (p.stanje === "odprta") stanje().prijave.delete(k);
}

const seznanitve: Seznanitve = {
  stanje(koda) {
    pocistiPrijave();
    return stanje().prijave.get(koda)?.stanje ?? null;
  },
  prijavi(koda, naprava) {
    pocistiPrijave();
    const p = stanje().prijave.get(koda);
    if (!p || p.stanje !== "odprta") return false;
    p.stanje = "caka";
    p.naprava = naprava;
    p.idPotrjen = undefined; // potrditev ne preide na drugo napravo
    return true;
  },
  prijaviPoKodi(koda, naprava) {
    pocistiPrijave();
    if (stanje().prijave.has(koda)) return false;
    stanje().prijave.set(koda, { stanje: "caka", cas: Date.now(), naprava });
    return true;
  },
  klici(koda, id) {
    pocistiPrijave();
    const p = stanje().prijave.get(koda);
    // samo sprejeta prijava in samo naprava, ki jo je lastnik dodal
    if (!p || p.stanje !== "sprejeto" || p.naprava?.id !== id) return undefined;
    // N1 (T3B): koda OpenLine se napravi vrne ob prvem prevzemu in samo se v kratkem oknu za ponovitev po izpadu (isti id naprave);
    // pozneje novo podpisan poziv z novim enkratnim nizom ne dobi kode vec (do 10 min je ni treba dajati vsakomur, ki ima kljuc)
    const t = Date.now();
    if (p.klicPrevzet !== undefined && t - p.klicPrevzet > prevzem.oknoMs) { p.klici = null; return undefined; }
    if (p.klici && p.klicPrevzet === undefined) p.klicPrevzet = t;
    return p.klici ?? null;
  },
};

/** Oglas _safeer-lina._tcp samo med odprtim oknom kode in samo na zasebnem naslovu (ne na 127.0.0.1). */
function zacniOglas(naslov: string, vrata: number): void {
  ustaviOglas();
  if (naslov.startsWith("127.") || naslov.includes(":")) return;
  try {
    const o = new OglasMdns({ naslov, vrata, ...stanje().omrezje });
    stanje().oglas = o;
    o.zacni().catch(() => { if (stanje().oglas === o) stanje().oglas = null; });
  } catch {
    stanje().oglas = null; // brez oglasa ostane rocni vnos naslova (pogodba v AGENTS.md)
  }
}

function ustaviOglas(): void {
  const o = stanje().oglas;
  stanje().oglas = null;
  o?.ustavi();
}

/** Za preizkuse: lazno omrezje oglasa. */
export function nastaviOmrezjeOglasa(o: Stanje["omrezje"]): void {
  stanje().omrezje = o;
}

async function ustavi(): Promise<void> {
  ustaviOglas();
  const t = stanje().tekoci;
  stanje().tekoci = null;
  if (t) {
    t.koda.zapri(); // tudi casovnik izteka in oglas
    clearInterval(t.osvezi);
    t.izvajalec.zapri();
    t.rele?.ustavi();
    await t.streznik.ustavi();
  }
  await ustaviPotKlicev();
}

/** Za preizkuse: lazni vmesniki in izvor privzete poti (null = pravo omrezje). */
export function nastaviOmrezjeNaslovov(o: OmrezjeNaslovov | null): void {
  stanje().omrezjeNaslovov = o;
}
const vmesniki = () => stanje().omrezjeNaslovov?.vmesniki() ?? networkInterfaces();
const prehodi = (): Promise<Record<string, string>> => {
  const o = stanje().omrezjeNaslovov;
  return o ? (o.prehodi?.() ?? Promise.resolve({})) : prehodiVmesnikov();
};
// naloga 21 (N10): samo pravi LAN naslovi in prehodi (zacasni IPv6, docker/veth ne sprozijo ponovnega zagona streznika in releja) ter
// ali je shranjeni naslov na kateremkoli vmesniku (tudi izven odtisLan: vEthernet, wg - slepi pregled 21, najdba 6)
const odtisOmrezja = (v: NodeJS.Dict<NetworkInterfaceInfo[]>, p: Readonly<Record<string, string>>, naslov: string) =>
  `${odtisLan(v, p)}#${naslovNaVmesniku(naslov, v) ? 1 : 0}`;
const izvorPoti = () => stanje().omrezjeNaslovov?.izvor() ?? izvorPrivzetePoti();

/**
 * Naloga 21 (N1): ali je [naslov] v omrezju, ki ga je lastnik odobril. »ne-vem« = naslov je na vmesniku, a omrezja ni mogoce prepoznati
 * (MAC prehoda se ni v ARP): nov streznik se takrat NE zazene doma, tekoci pa se zaradi tega ne ustavi.
 */
function odobritev(n: Nastavitve, naslov: string, v: NodeJS.Dict<NetworkInterfaceInfo[]>, p: Readonly<Record<string, string>>): "da" | "ne" | "ne-vem" {
  if (naslovZanke(naslov)) return "da";
  const o = omrezjeNaslova(naslov, v, p);
  if (o === null) return naslovNaVmesniku(naslov, v) ? "ne-vem" : "ne";
  return n.omrezja.includes(o) ? "da" : "ne";
}

/** Naloga 21 (N1): napaka zagona doma, ko omrezje ni odobreno (koda »omrezje«, rezerva samo Global Link). */
const NEODOBRENO = "LINA_NEODOBRENO_OMREZJE";

function vrstaNapake(e: unknown): Exclude<KodaNapakeAsistenta, ""> {
  const c = (e as NodeJS.ErrnoException)?.code;
  return c === "EADDRNOTAVAIL" ? "naslov" : c === "EADDRINUSE" ? "vrata" : c === NEODOBRENO ? "omrezje" : "drugo";
}
function nastaviNapako(e: unknown): void {
  const v = vrstaNapake(e);
  stanje().napakaKoda = v;
  stanje().napaka = v === "vrata" ? "Vrata so zasedena." : v === "naslov" ? "Naslova ta racunalnik nima vec."
    : v === "omrezje" ? "Omrezje ni odobreno." : (e as Error).message.slice(0, 200);
}

/** Naloga 21 (N3): rezerva »vrata« preveri prosta vrata najvec tako pogosto (spremenljivo samo za preizkuse). */
export const nadzorVrat = { ms: 5 * 60_000 };

/** Ali lahko na [naslov]:[vrata] zdaj poslusamo (poskusna vticnica, takoj zaprta); vsaka napaka = ne. */
function prostaVrata(naslov: string, vrata: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = createServer();
    s.once("error", () => ok(false));
    s.listen(vrata, naslov, () => s.close(() => ok(true)));
  });
}

/**
 * Naloga 15: shranjenega naslova ni vec na nobenem vmesniku (npr. Wi-Fi -> kabel) -> trenutni naslov lokalnega omrezja (izberiLanNaslov)
 * se uporabi in shrani, brez uporabnikovega klika. Ce novega ni, ostane shranjeni (ko se omrezje vrne, velja spet).
 * Naloga 21 (N1): samo, ce je nov naslov v omrezju, ki ga je lastnik ze odobril; sicer ostane shranjeni (rezerva) in lastnik dobi predlog.
 */
async function slediNaslovu(root: string, n: Nastavitve): Promise<Nastavitve> {
  if (!n.vklop || naslovNaVmesniku(n.naslov, vmesniki())) return n;
  const nov = izberiLanNaslov(vmesniki(), await izvorPoti());
  const p = await prehodi();
  // odtis brez prehoda (Windows) samodejnemu sledenju ne zadosca: isto podomrezje je lahko tuje omrezje (izrecno »Uporabi ta naslov« gre)
  if (!nov || nov === n.naslov || odobritev(n, nov, vmesniki(), p) !== "da" || omrezjeNaslova(nov, vmesniki(), p)?.endsWith(`|${BREZ_PREHODA}`)) return n;
  // isti zaklep kot seznam naprav (A-12), z novim branjem: ne prepise imen ali lastnikove sprotne izbire
  return naSeznamu(async () => {
    const m = await preberiNastavitve(root);
    if (m.naslov !== n.naslov || !m.vklop) return m;
    const z = { ...m, naslov: nov };
    await writeJson(root, NASTAVITVE_ASISTENTA, z satisfies Nastavitve);
    return z;
  });
}

/**
 * Naloga 15: ali je treba uskladiti zaradi omrezja (obcasno iz zagona programa). Zdrav streznik na naslovu, ki se obstaja, pusti
 * pri miru (ponovni zagon bi zaprl okno kode in naloge). true = uskladitev je tekla.
 */
export async function preveriNaslovAsistenta(dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  const n = await preberiNastavitve(root);
  if (!n.vklop) return false;
  const t = stanje().tekoci;
  const v = vmesniki();
  const p = await prehodi();
  const zdaj = Date.now();
  // naloga 21 (N3): rezerva »vrata« ni trajna - najvec vsakih nadzorVrat.ms poskus na zelenih vratih; ponovni zagon SAMO, ce so res prosta
  // (abs: ura, ki gre nazaj, preverbe ne odlozi za dni - slepi pregled 21, najdba 11)
  const vrata = !!t && t.rezerva === "vrata" && Math.abs(zdaj - t.vrataPreverjena) >= nadzorVrat.ms
    && (t.vrataPreverjena = zdaj, await prostaVrata(t.zeleniNaslov, t.zelenaVrata));
  // naloga 21 (N1): tekoci streznik doma se ustavi, ce omrezje NI odobreno (npr. isti naslov za drugim prehodom) v dveh zaporednih
  // preverbah; »ne-vem« ga ne ustavi
  // stevec ponastavi samo »da«: izmenicna »ne« in »ne-vem« v tujem omrezju streznika ne pustita teci (slepi pregled 21b, 2)
  if (t && t.rezerva === null) { const o = odobritev(n, t.naslov, v, p); t.neodobreno = o === "da" ? 0 : o === "ne" ? t.neodobreno + 1 : t.neodobreno; }
  const treba = !t || vrata
    // CRR1: tudi rezerva »vrata« - izginotje shranjenega naslova spremeni odtis (#0), preverba vrat na odsotnem naslovu tega ne vidi
    || (t.rezerva !== null && odtisOmrezja(v, p, t.zeleniNaslov) !== t.omrezje)
    || (t.rezerva === null && (!naslovNaVmesniku(t.naslov, v) || t.neodobreno >= 2));
  if (treba) await uskladiAsistenta(root, { zamenjajRezervoVrat: vrata });
  return treba;
}

/** Naloga 15: preverjanje naslova vsakih [ms] (zagon programa); ponovni klic zamenja prejsnji casovnik. */
export function zacniNadzorNaslova(dir?: string, ms = 30_000): void {
  const root = resolveDataDir(dir);
  if (stanje().nadzor) clearInterval(stanje().nadzor!);
  const i = setInterval(() => { void preveriNaslovAsistenta(root).catch(() => undefined); }, ms);
  i.unref?.();
  stanje().nadzor = i;
}

/** Uskladi tekoci streznik z nastavitvami (zagon Line, sprememba nastavitev). Napaka zagona se zapomni za prikaz. */
export function uskladiAsistenta(dir?: string, o: { zamenjajRezervoVrat?: boolean } = {}): Promise<void> {
  return zaporedno(async () => {
    const root = resolveDataDir(dir);
    const n = await slediNaslovu(root, await preberiNastavitve(root));
    const v = vmesniki();
    const p = await prehodi();
    const dovoljeno = odobritev(n, n.naslov, v, p);
    // naloga 21 (N1): predlog za »Uporabi ta naslov« - shranjeni naslov na neodobrenem omrezju ali trenutni naslov lokalnega omrezja;
    // izracunan pred vejo »tece ze«, da ob menjavi neodobrenega omrezja ni zastarel (slepi pregled 21, najdba 5)
    const predlog = dovoljeno === "da" ? null : naslovNaVmesniku(n.naslov, v) ? n.naslov : izberiLanNaslov(v, await izvorPoti());
    stanje().predlogNaslova = predlog ?? "";
    const t = stanje().tekoci;
    if (t && (!n.vklop || t.zeleniNaslov !== n.naslov || t.zelenaVrata !== n.vrata || t.globalLink !== n.globalLink
      // rezerva zaradi naslova: naslov je spet tu; doma dosegljiv: vezani naslov je izginil ali omrezje ni (vec) odobreno (N1);
      // rezerva »vrata« samo po poskusu na prostih vratih (N3), sicer rele ne utripa
      || (t.rezerva === "naslov" ? naslovNaVmesniku(n.naslov, v)
        : t.rezerva === "omrezje" ? dovoljeno === "da"
          : t.rezerva === "vrata" ? o.zamenjajRezervoVrat === true
            : !naslovNaVmesniku(t.naslov, v) || (dovoljeno === "ne" && t.neodobreno >= 2)))) await ustavi();
    if (!n.vklop || stanje().tekoci) {
      if (!n.vklop) { stanje().napaka = ""; stanje().napakaKoda = ""; stanje().predlogNaslova = ""; }
      // tece ze: pot klicev se zagotovi znova (ce je OpenLine med tem padel); ob izklopu jo je ustavil ustavi(); v rezervi ne (127.0.0.1)
      const tek = stanje().tekoci;
      if (tek) tek.omrezje = odtisOmrezja(v, p, n.naslov); // ista sprememba omrezja ne sprozi uskladitve vsakih 30 s
      if (tek && !tek.rezerva) void pripraviPotKlicev(root, tek.naslov);
      return;
    }
    try {
      const k = await preberiKanal(root);
      // pregled 6: kljuc releja PRED izvajalcem in casovnikom (napaka tu ne pusti odprtih virov)
      const kljucR = n.globalLink ? await kljucReleja(root) : null;
      let krog: ReadonlySet<string> = new Set(k.dovoljene.keys());
      const izvajalec = new IzvajalecClaudeCode({
        pot: potVticnice(root, process.platform, k.imeCevi),
        zeton: async () => (await preberiKanal(root)).zeton,
        ozjiKrog: () => krog,
        // orodje dodatki v Claude Code: stanje/n8n_seznam takoj, preklop in n8n ustvarjanje/zagon samo po podpisani odobritvi naprave
        dodatki: {
          stanje: async () => opisStanjaDodatkov(await stanjeDodatkovZaTelefon(root)),
          nastavi: async (d, v) => opisStanjaDodatkov(await nastaviDodatekZaTelefon(d, v, root)),
          n8nSeznam: () => kanalSeznamN8n(root),
          n8nZazeni: (tok, moznosti) => kanalZazeniN8n(root, tok, {}, moznosti),
          n8nUstvari: (opis, ime) => kanalUstvariN8n(root, opis, ime),
        },
        // dovoljenje za podobne: samo naprava, ki ga je dala, s podpisom, ki znova velja s kljucem iz trenutnega ozjega kroga
        dovoljenoPodobno: async (dodatek, smer, naprava) =>
          !!(await najdiDovoljenje(root, "dodatek", { dodatek, smer }, { naprava, kljuci: (await preberiKanal(root)).dovoljene })),
        // zagon istega n8n toka (po ID) s podpisanim dovoljenjem za podobne te naprave; ustvarjanje toka tega nima
        dovoljenZagonN8n: async (tok, naprava) =>
          !!(await najdiDovoljenje(root, "n8n-zagon", { tok }, { naprava, kljuci: (await preberiKanal(root)).dovoljene })),
      });
      const osvezi = setInterval(() => { void preberiKanal(root).then((x) => { krog = new Set(x.dovoljene.keys()); }).catch(() => undefined); }, 3000);
      osvezi.unref?.();
      let pisanje: Promise<unknown> = Promise.resolve();
      const varovalka = new VarovalkaKode({
        krat: SKUPNO_KRAT, // naloga 21 (N2): skupna meja cez vse vire; vsak vir ima svojo varovalko z mejami Linka (koda-seznanitev.ts)
        stanje: await readJsonFile<unknown>(root, VAROVALKA_KODE).catch(() => null),
        shrani: (st) => { pisanje = pisanje.then(() => writeJson(root, VAROVALKA_KODE, st)).catch(() => undefined); },
      });
      let streznik: AsistentStreznik | null = null;
      const koda = new SeznanitevSKodo({ varovalka, odtis: () => streznik?.odtis ?? "" });
      // oglas na dejansko vezanem naslovu (ne na naslovu iz nastavitev ob zagonu); v rezervi ni oglasa
      koda.obOdprtju = () => { const tt = stanje().tekoci; if (tt && tt.koda === koda && !tt.rezerva) zacniOglas(tt.naslov, tt.vrata); };
      koda.obZaprtju = ustaviOglas;
      // ocena cilja ob izidu agenta: samo predlog na telefon, nadaljevanje podpise naprava (cilj-naloge.server.ts)
      const sCiljem = ovijCilj(izvajalec, oceniZModelom(() => pogovorBrain(root), undefined, () => dovoliOcenoIzida(root)));
      // Dodatki na racunalniku za napravo ozjega kroga (23. 11. 2026) + n8n tokovi (24. 11. 2026): stanje, preklop in n8n s podpisom naprave
      const dodatki = {
        stanje: () => stanjeDodatkovZaTelefon(root),
        nastavi: (d: Parameters<typeof nastaviDodatekZaTelefon>[0], v: boolean) => nastaviDodatekZaTelefon(d, v, root),
        n8n: {
          stanje: () => telefonStanjeN8n(root),
          predlog: (vrsta: unknown, cilj: unknown, ime?: unknown) => telefonPredlogN8n(root, vrsta, cilj, ime),
          potrdi: (id: unknown, zg: unknown, dovoli: unknown) => telefonPotrdiN8n(root, id, zg, dovoli),
        },
      };
      // Gradnje na GitHubu (24. 11. 2026): stanje, predlog, potrditev in APK zadnje potrjene gradnje s podpisom naprave
      const gradnje = {
        stanje: () => telefonStanje(root),
        predlog: async (tok: unknown, veja: unknown, naprava?: { naprava: string; kljuci: ReadonlyMap<string, string> }) => telefonPredlog(root, tok, veja, {}, naprava),
        potrdi: (id: unknown, z: unknown, podobne?: Parameters<typeof telefonPotrdi>[4]) => telefonPotrdi(root, id, z, {}, podobne),
        apk: () => apkZaTelefon(root),
      };
      // Naloge agentov na racunalniku (24. 11. 2026): vrsta, dodelitev (= potrditev za en zagon) in preklic s podpisom naprave
      const agentiNaloge = {
        stanje: () => telefonStanjeNalog(root),
        // naloga 18: stikalo se prebere ob vsaki dodelitvi (izklop: naloga caka potrditev na racunalniku)
        dodeli: async (agent: string, mapa: string, besedilo: string, pogoj: string) =>
          telefonDodeli(root, agent, mapa, besedilo, pogoj, {}, new Date(), { samodejno: (await preberiNastavitve(root)).samodejniAgenti }),
        preklici: (id: string) => telefonPreklici(root, id),
      };
      // Vprasanja agentov (naloga 23): odprta vprasanja in dnevnik dela; odgovor s podpisom naprave (streznik ga preveri)
      const vprasanjaAgentov = {
        stanje: async () => telefonVprasanja(root),
        odgovori: (id: string, odlocitev: string, zgostitev: string, naprava: string) => telefonOdgovor(root, id, odlocitev, zgostitev, naprava),
      };
      const omrezje = odtisOmrezja(v, p, n.naslov);
      const novStreznik = (naslov: string, vrata: number) => new AsistentStreznik({ root, naslov, vrata, izvajalec: sCiljem, seznanitve, koda, dodatki, gradnje,
        agentiNaloge, vprasanjaAgentov, omogociOddaljeno: n.globalLink, rele: () => kljucR?.id ?? null,
        // naloga 18: stikalo se prebere ob vsaki nalogi (izklop velja takoj); streznik klice samo po preverbi podpisa naprave
        // brez potrjenega opozorila ob prvem zagonu agentov (lastnik 24. 11.) Lina ne zazene nobenega agenta - tudi seje ne (slepi pregled 18 N6)
        odpriSejoClaude: async () => !(await preberiNastavitve(root)).samodejniAgenti ? { ok: false, razlog: "izklopljeno" }
          : !(await opozoriloPotrjeno(root)) ? (zapisiRazlogSeje(root, "opozorilo"), { ok: false, razlog: "opozorilo" }) : odpriSejoClaude(root) });
      try {
        let rezerva: Tekoci["rezerva"] = null;
        let napakaLan: unknown = null;
        let zagnan: { naslov: string; vrata: number; odtis: string };
        try {
          // naloga 21 (N1): doma (zasebni naslov) samo v odobrenem omrezju; sicer nic ne poslusa na tem omrezju (in OpenLine se ne zazene)
          if (dovoljeno !== "da" && predlog !== null) throw Object.assign(new Error("Omrezje ni odobreno."), { code: NEODOBRENO });
          streznik = novStreznik(n.naslov, n.vrata);
          zagnan = await streznik.zazeni();
        } catch (e) {
          // Naloga 15: Global Link ni odvisen od lokalnega naslova - streznik brez LAN vticnice (127.0.0.1, prosta vrata) za kanale releja
          const v = vrstaNapake(e);
          if (v === "drugo" || !kljucR || !stanje().rele) throw e;
          await streznik?.ustavi();
          streznik = novStreznik("127.0.0.1", 0);
          zagnan = await streznik.zazeni();
          rezerva = v;
          napakaLan = e;
        }
        const { naslov, vrata, odtis } = zagnan;
        const s = streznik;
        // Global Link: na releju so dovoljene samo naprave, ki jih je lastnik dodal (id iz kljuca, kot v Safeer Linku)
        const povezavaReleja = stanje().rele;
        const rele = kljucR && povezavaReleja ? new AgentReleja({
          kljuc: kljucR,
          povezava: povezavaReleja,
          dovoljeni: async () => dovoljeniIzKanala((await preberiKanal(root)).dovoljene),
          sprejmi: (d) => s.sprejmiOddaljeno(d, "rele"),
        }) : null;
        rele?.zazeni();
        stanje().tekoci = { streznik, izvajalec, osvezi, naslov, vrata, odtis, koda, varovalka, rele, globalLink: n.globalLink,
          zeleniNaslov: n.naslov, zelenaVrata: n.vrata, rezerva, omrezje, vrataPreverjena: Date.now(), neodobreno: 0 };
        if (rezerva) nastaviNapako(napakaLan); // vidno v Poveži telefon: doma telefon Line ne doseze, Global Link tece
        else {
          stanje().napaka = "";
          stanje().napakaKoda = "";
          void pripraviPotKlicev(root, naslov); // v ozadju: uporabnik ne caka; napaka postane opozorilo
        }
      } catch (e) {
        clearInterval(osvezi);
        izvajalec.zapri();
        throw e;
      }
    } catch (e) {
      nastaviNapako(e);
    }
  });
}

export type StanjeAsistenta = {
  vklop: boolean;
  /** Global Link (naloga 22): nastavitev in dejansko stanje povezave z relejem (izklopljen, povezujem, povezan, napaka). */
  globalLink: boolean;
  globalLinkStanje: StanjeAgenta;
  /** Naloga 18: Lina sama odpre Claude Code in zazene agente za naloge, potrjene na telefonu. */
  samodejniAgenti: boolean;
  /** Naloga 18: zadnji neuspel samodejni zagon seje Claude Code (ni-terminala, ni-claude, omejitev, napaka); prazno = brez napake. */
  zagonClaude: RazlogSeje | "";
  /** Izid Claude Code gre k ponudniku modela v oceno (S1). */
  ocenaIzida: boolean;
  naslov: string;
  vrata: number;
  naslovi: string[];
  /** Streznik sprejema telefon doma (v rezervi samo Global Link: false). */
  tece: boolean;
  napaka: string;
  /** Naloga 15: koda napake za besedilo v jeziku vmesnika (telNapaka_<koda>). */
  napakaKoda: KodaNapakeAsistenta;
  /** Naloga 15: lokalnega naslova ni (ali vrata zasedena), tece samo Global Link. */
  samoGlobalLink: boolean;
  /** Naloga 21 (N1): naslov v omrezju, ki ga lastnik se ni odobril (gumb »Uporabi ta naslov«); prazno = ni predloga. */
  predlogNaslova: string;
  odtis: string;
  claudeCode: boolean;
  cakajo: Array<{ koda: string; id: string; ime: string }>;
  /** N5b: koda cakajocih prijav, ki so PREVERJENO v ozjem krogu Safeer Linka (brez primerjave id-ja); samo za prikaz, streznik odloca sam. */
  ozjiKrog: string[];
  /** Seznanjanje s kodo: odprto okno, koda za telefon (nacin A), telefoni, ki cakajo na lastnikovo kodo (nacin B). */
  sKodo: { odprto: boolean; koda: string; do: number; cakajoKodo: Array<{ pairId: string; id: string; ime: string; napacna: boolean }>; zaprtoSe: number; oglas: string };
  naprave: Array<{ id: string; ime: string }>;
  openLine: { povezan: boolean; vrata: number; odtis: string };
  /** Zadnja pot klicev ob »Dodaj« ni bila dodana (OpenLine ni odgovoril ...) ali priprava poti klicev ni uspela; prazno, ce je vse v redu. */
  opozoriloKlicev: string;
  /** Pot klicev (OpenLine) se prav zdaj pripravlja; zaslon pokaze »priprava«, uporabnik ne vnese nic. */
  klicevSePripravlja: boolean;
};

export async function stanjeAsistenta(token: string | null, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = await preberiNastavitve(root);
  const t = stanje().tekoci;
  pocistiPrijave();
  const cakajo = [...stanje().prijave].filter(([, p]) => p.stanje === "caka" && p.naprava).map(([koda, p]) => ({ koda, id: p.naprava!.id, ime: p.naprava!.ime }));
  const k = await preberiKanal(root);
  const ozjiKrog: string[] = [];
  for (const [koda, p] of stanje().prijave) if (p.stanje === "caka" && p.naprava && await jeClanKroga(p.naprava.kljuc, p.naprava.id)) ozjiKrog.push(koda);
  return {
    vklop: n.vklop, ocenaIzida: n.ocenaIzida, globalLink: n.globalLink, globalLinkStanje: t?.rele?.stanje ?? "izklopljen", samodejniAgenti: n.samodejniAgenti, zagonClaude: zadnjiRazlogSeje(root), naslov: n.naslov, vrata: n.vrata, naslovi: zasebniNaslovi(vmesniki()), tece: !!t && !t.rezerva, napaka: stanje().napaka,
    napakaKoda: stanje().napakaKoda ?? "", samoGlobalLink: !!t?.rezerva, predlogNaslova: n.vklop ? stanje().predlogNaslova ?? "" : "", odtis: t?.odtis ?? "",
    claudeCode: t ? await t.izvajalec.razpolozljiv().catch(() => false) : false,
    cakajo,
    ozjiKrog,
    sKodo: stanjeKode(t),
    naprave: [...k.dovoljene.keys()].map((id) => ({ id, ime: n.imena[id] ?? "" })),
    openLine: await stanjeOpenLine(root),
    opozoriloKlicev: stanje().opozoriloKlicev || stanje().opozoriloPripraveKlicev || "",
    klicevSePripravlja: !!stanje().pripravaKlicev,
  };
}

/** Naloga 16: telefon za oznako linije. povezan = ziva povezava s potjo klicev; seznanjen = telefon je dodan, zive povezave ni ali je ne vemo. */
export type TelefonLinije = "povezan" | "seznanjen" | "ne";

/**
 * Naloga 16 (lastnik 25. 11. 2026: »Čeprav je telefon povezan je Linija zaprta«): stanje telefona za oznako linije. Racunalnik ne ve,
 * ali Lina na telefonu klice sprejema (telefon tega ne javi), zato nikoli ne trdimo »zaprta«, ce je telefon dodan.
 */
export async function telefonZaLinijo(token: string | null, dir?: string, telefoni: typeof telefoniOpenLine = telefoniOpenLine): Promise<TelefonLinije> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const ol = await telefoni(root);
  if (ol && ol.povezanih > 0) return "povezan";
  if (ol && ol.naprav > 0) return "seznanjen";
  // pregled 16 (6): napaka branja kanala ni »ni telefona« (to bi pokazalo »zaprta«): ne vemo -> seznanjen (nevtralno, ne »zaprta«)
  const naprav = await preberiKanal(root).then((k) => k.dovoljene.size, () => -1);
  return naprav !== 0 ? "seznanjen" : "ne";
}

/**
 * Lastnik vklopi ali izklopi telefon in izbere zasebni naslov in vrata. Naloga 21 (N1): odobriOmrezje: true (gumb »Shrani« ali
 * »Uporabi ta naslov«) shrani omrezje izbranega naslova kot lastnikovo; stikala tega ne storijo (en klik na stikalo ne odobri tujega omrezja).
 */
export async function shraniAsistenta(token: string | null, vnos: { vklop?: unknown; naslov?: unknown; vrata?: unknown; ocenaIzida?: unknown; globalLink?: unknown; samodejniAgenti?: unknown; odobriOmrezje?: unknown }, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof vnos.naslov === "string" && !zasebniNaslovi(vmesniki()).includes(vnos.naslov)) throw new Error("Izberite naslov tega racunalnika v domacem omrezju.");
  let odobri: string | null = null;
  if (vnos.odobriOmrezje === true && typeof vnos.naslov === "string" && !naslovZanke(vnos.naslov)) {
    odobri = omrezjeNaslova(vnos.naslov, vmesniki(), await prehodi());
    if (odobri === null) throw new Error("Omrezja se ni mogoce prepoznati (prehod se ni znan). Poskusite znova cez nekaj sekund.");
  }
  // isti zaklep kot seznam naprav (A-12): branje-sprememba-zapis se ne prepleta z odlociSeznanitev ali odstraniNapravo
  await naSeznamu(async () => {
    const n = await preberiNastavitve(root);
    const vrata = vnos.vrata === undefined ? n.vrata : Number(vnos.vrata);
    if (!Number.isInteger(vrata) || vrata < 1024 || vrata > 65535) throw new Error("Vrata morajo biti celo stevilo od 1024 do 65535.");
    await writeJson(root, NASTAVITVE_ASISTENTA, {
      ...n, vklop: vnos.vklop === undefined ? n.vklop : vnos.vklop === true, naslov: typeof vnos.naslov === "string" ? vnos.naslov : n.naslov, vrata,
      ocenaIzida: typeof vnos.ocenaIzida === "boolean" ? vnos.ocenaIzida : n.ocenaIzida,
      globalLink: typeof vnos.globalLink === "boolean" ? vnos.globalLink : n.globalLink,
      samodejniAgenti: typeof vnos.samodejniAgenti === "boolean" ? vnos.samodejniAgenti : n.samodejniAgenti,
      omrezja: odobri === null ? n.omrezja : [...n.omrezja.filter((x) => x !== odobri), odobri].slice(-NAJVEC_OMREZIJ),
    } satisfies Nastavitve);
  });
  await uskladiAsistenta(root);
  return stanjeAsistenta(token, root);
}

function stanjeKode(t: Tekoci | null): StanjeAsistenta["sKodo"] {
  if (!t) return { odprto: false, koda: "", do: 0, cakajoKodo: [], zaprtoSe: 0, oglas: "" };
  const k = t.koda.stanje();
  const v = t.varovalka.stanje();
  return { odprto: k.odprto, koda: k.koda, do: k.do, cakajoKodo: k.cakajoKodo.map(({ pairId, id, ime, napacna }) => ({ pairId, id, ime, napacna })), zaprtoSe: v.zaprto ? v.se_s : 0, oglas: k.odprto ? stanje().oglas?.primerek ?? "" : "" };
}

/** Osnova koncne tocke asistentke za telefon (IPv6 v oglatih oklepajih). */
export function osnovaAsistenta(naslov: string, vrata: number): string {
  return `https://${naslov.includes(":") ? `[${naslov}]` : naslov}:${vrata}/api/asistent/v1`;
}

/**
 * Vsebina zdruzenega QR v1 (pogodba v AGENTS.md): razdelek poti klicev (url, code, fp - kot QR konzole OpenLine, zato ga
 * stara aplikacija prebere enako) in razdelek asistentke (lina, linafp, linakoda); do = rok v ms od 1970.
 */
export function vsebinaQr(asistent: { naslov: string; vrata: number; odtis: string; koda: string }, klici: PovabiloOpenLine | null, doMs: number): string {
  const d: string[] = ["v=1"];
  if (klici) d.push(`url=${encodeURIComponent(klici.url)}`, `code=${klici.koda}`, `fp=${klici.odtis}`);
  d.push(`lina=${encodeURIComponent(osnovaAsistenta(asistent.naslov, asistent.vrata))}`, `linafp=${asistent.odtis}`, `linakoda=${asistent.koda}`, `do=${doMs}`);
  return `${SHEMA_QR}?${d.join("&")}`;
}

/** Koda OpenLine za pot klicev (isti razdelek v QR in v odgovoru seznanitve s kodo); napaka je opozorilo, ne ustavitev. */
/** T6-08: omrezni klic OpenLine tece znotraj zaklepa naSeznamu; brez roka bi pocasen OpenLine ustavil Dodaj in Odstrani. */
export const ROK_POTI_KLICEV_MS = 10_000;
/** N1: okno, v katerem naprava lahko ponovno prevzame kodo OpenLine (ponovitev po izpadu); spremenljivo samo za preizkuse. */
export const prevzem = { oknoMs: 60_000 };

async function potKlicev(root: string, t: Tekoci, openline: typeof povabiloOpenLine, rokMs = ROK_POTI_KLICEV_MS): Promise<{ klici: PovabiloOpenLine | null; opozorilo: string }> {
  const ol = await stanjeOpenLine(root);
  if (!ol.povezan) return { klici: null, opozorilo: "" };
  let cas: NodeJS.Timeout | undefined;
  try {
    const rok = new Promise<never>((_, ne) => { cas = setTimeout(() => ne(new Error("OpenLine ni odgovoril v roku")), rokMs); });
    const klic = openline(root, `https://${t.naslov.includes(":") ? `[${t.naslov}]` : t.naslov}:${ol.vrata}`);
    klic.catch(() => undefined); // zamujen odgovor po roku ni neobravnavana zavrnitev
    return { klici: await Promise.race([klic, rok]), opozorilo: "" };
  } catch (e) {
    return { klici: null, opozorilo: `Pot klicev ni dodana: ${(e as Error).message}` };
  } finally {
    clearTimeout(cas);
  }
}

/** Naloga 15: v rezervi (samo Global Link) QR in koda ne izdata naslova 127.0.0.1, ki ga telefon ne doseze. */
const NI_LAN_SEZNANITEV = "Racunalnik nima naslova v domacem omrezju; seznanjanje doma ni mogoce (Global Link tece).";

/** koda = enkratna koda tega QR (linakoda); zaslon z njo ob odhodu preklice samo svoj QR (CRR2). */
export type Povabilo = { vsebina: string; koda: string; svg: string; velja: number; klici: boolean; opozorilo: string };

/**
 * Nova enkratna koda in QR; samo ko streznik asistentke tece. QR nosi SAMO asistentko (T1-S1): koda OpenLine se izda sele ob
 * lastnikovem »Dodaj«, zato kdor QR le vidi ali posname, do poti klicev ne pride. `klici` pove, da bo pot klicev dodana ob »Dodaj«.
 */
export async function zacniSeznanitev(token: string | null, dir?: string): Promise<Povabilo> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const t = stanje().tekoci;
  if (!t) throw new Error("Najprej vklopite telefon za asistentko.");
  if (t.rezerva) throw new Error(NI_LAN_SEZNANITEV);
  await pocakajPotKlicev(root, t.naslov); // pot klicev tece ze od vklopa; to jo zagotovi, ce je med tem padla
  pocistiPrijave();
  // naloga 21 (N2): nov QR preklice prejsnjega neporabljenega (samodejna osvezitev ne pusti vec veljavnih QR hkrati)
  prekliciOdprte();
  const koda = randomBytes(16).toString("base64url");
  const zdaj = Date.now();
  stanje().prijave.set(koda, { stanje: "odprta", cas: zdaj });
  const vsebina = vsebinaQr({ naslov: t.naslov, vrata: t.vrata, odtis: t.odtis, koda }, null, zdaj + ROK_KODE_MS);
  return { vsebina, koda, svg: svgQr(kodaQr(vsebina)), velja: ROK_KODE_MS, klici: (await stanjeOpenLine(root)).povezan, opozorilo: "" };
}

/**
 * Lastnik klikne »Povezi s kodo«: nova 6-mestna koda (5 min, en telefon) za nacin A in odprto okno za telefone, ki kodo
 * pokazejo sami (nacin B). Poti klicev OpenLine tu ne izdamo (T1-S1): izda se ob »Dodaj«.
 */
export async function zacniSeznanitevSKodo(token: string | null, dir?: string): Promise<{ koda: string; do: number; klici: boolean; opozorilo: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const t = stanje().tekoci;
  if (!t) throw new Error("Najprej vklopite telefon za asistentko.");
  if (t.rezerva) throw new Error(NI_LAN_SEZNANITEV);
  await pocakajPotKlicev(root, t.naslov);
  const { koda, do: doMs } = t.koda.odpri();
  return { koda, do: doMs, klici: (await stanjeOpenLine(root)).povezan, opozorilo: "" };
}

/** Lastnik vtipka kodo, ki jo kaze telefon (nacin B). */
export async function vnesiKodoTelefona(token: string | null, pairId: unknown, koda: unknown, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const t = stanje().tekoci;
  if (!t || typeof pairId !== "string" || typeof koda !== "string") throw new Error("Ta telefon ne caka vec na kodo.");
  t.koda.vnesiKodo(pairId, koda);
  return stanjeAsistenta(token, root);
}

/**
 * Naloga 21 (N2): lastnik zapusti zaslon »Poveži telefon« - neporabljeni QR ne velja vec (cakajoce prijave ostanejo).
 * CRR2: samo QR tega zaslona (koda iz Povabilo): zaslon, ki odide za drugim, ne preklice QR, ki ga drugi zaslon se kaze.
 */
export async function prekliciSeznanitev(token: string | null, koda: unknown, dir?: string): Promise<void> {
  await requireOwner(token, resolveDataDir(dir));
  if (typeof koda === "string" && stanje().prijave.get(koda)?.stanje === "odprta") stanje().prijave.delete(koda);
}

/** Lastnik zapre okno s kodo (koda ne velja vec). */
export async function zapriSeznanitevSKodo(token: string | null, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  stanje().tekoci?.koda.zapri();
  return stanjeAsistenta(token, root);
}

/**
 * T1-N1: lastnik sam koncna zaporo povezovanja s kodo (varovalka-kode.ts). Zaporo lahko sprozi neznanec iz domacega omrezja
 * (20 neuspelih krogov na uro), zato jo mora lastnik z enim klikom preklicati; stetje ponovitev se pri tem pocisti, da
 * napadalec z novimi krogi ne podaljsuje zapore lastnika.
 */
export async function odkleniPovezovanje(token: string | null, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  stanje().tekoci?.varovalka.ponastavi();
  stanje().tekoci?.koda.ponastaviVire();
  return stanjeAsistenta(token, root);
}

/**
 * T1-N5: branje-spreminjanje-pisanje seznama naprav in imen je zaporedno. Dva hkratna »Dodaj« (ali »Dodaj« in »Odstrani«) sta
 * prej oba prebrala isti seznam in zadnji zapis je izgubil napravo drugega ali vrnil umaknjeno napravo.
 */
let veriga: Promise<unknown> = Promise.resolve();
function naSeznamu<T>(delo: () => Promise<T>): Promise<T> {
  const p = veriga.then(delo, delo);
  veriga = p.catch(() => undefined);
  return p;
}

/**
 * N5 (odlocitev vodje, 15. 11. 2026): lastnik izrecno potrdi, da se id telefona ujema z id-jem na telefonu. Preverja STREZNIK:
 * »Dodaj« (odlociSeznanitev sprejmi=true) brez te potrditve zavrne tudi ob neposrednem klicu koncne tocke. Potrditev velja samo
 * za ta id in to prijavo (id mora biti natancno id cakajoce naprave) in se porabi ob prvi odlocitvi; ni trajna.
 */
export async function potrdiIdSeznanitve(token: string | null, koda: unknown, id: unknown, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const p = typeof koda === "string" ? stanje().prijave.get(koda) : undefined;
  if (!p || p.stanje !== "caka" || !p.naprava) throw new Error("Ta prijava ne caka vec.");
  if (typeof id !== "string" || idVSkupinah(p.naprava.id) === null || id !== p.naprava.id) throw new Error("ID se ne ujema s cakajoco napravo.");
  p.idPotrjen = id;
  return stanjeAsistenta(token, root);
}

/** Lastnik potrdi ali zavrne prijavljen telefon. Samo »sprejmi« doda napravo v seznam kanala in to samo po potrdi_id (N5). */
export async function odlociSeznanitev(token: string | null, koda: unknown, sprejmi: unknown, dir?: string, openline = povabiloOpenLine, rokKlicevMs = ROK_POTI_KLICEV_MS, preskokClana: boolean = PRESKOK_PRIMERJAVE_ZA_CLANE): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const p = typeof koda === "string" ? stanje().prijave.get(koda) : undefined;
  if (!p || p.stanje !== "caka" || !p.naprava) throw new Error("Ta prijava ne caka vec.");
  if (sprejmi === true) await naSeznamu(async () => {
    // ponovno znotraj zaklepa: drug »Dodaj« za isto prijavo je medtem lahko ze koncal
    if (p.stanje !== "caka" || !p.naprava) throw new Error("Ta prijava ne caka vec.");
    // N5: brez izrecne potrditve id-ja se seznanitev ne konca; potrditev se porabi (nova odlocitev zahteva novo)
    const potrjen = p.idPotrjen === p.naprava.id && idVSkupinah(p.naprava.id) !== null;
    p.idPotrjen = undefined;
    // N5d: preskok primerjave za clane kroga je IZKLOPLJEN (PRESKOK_PRIMERJAVE_ZA_CLANE), ker telefon clanstva Line ne zna preveriti in
    // sam vedno zahteva dotik: uporabnik mora id videti in potrditi tudi na racunalniku (brez slepega potrjevanja). Parameter
    // [preskokClana] je samo za preizkus poti, ki jo bo vklopila preverba na telefonu. Ce je vklopljen: krog se prebere SVEZE tik
    // pred vpisom (umik takoj velja); vsak dvom = fail-closed (ostane potrditev id-ja)
    if (!potrjen && !(preskokClana && await jeClanKroga(p.naprava.kljuc, p.naprava.id))) throw new Error("Najprej potrdite, da se ID ujema (ID se ujema).");
    const k = await preberiKanal(root);
    // T1-N10: id je skrajsan na 64 bitov; naprava z id-jem, ki ze pripada DRUGEMU kljucu, ne prepise obstojecega kljuca
    const obstojec = k.dovoljene.get(p.naprava.id);
    if (obstojec !== undefined && obstojec !== p.naprava.kljuc) {
      p.stanje = "zavrnjeno";
      throw new Error("Ta id ze pripada drugi napravi; prijava je zavrnjena.");
    }
    await pripraviKanal([...[...k.dovoljene].map(([id, kljuc]) => ({ id, kljuc })).filter((x) => x.id !== p.naprava!.id), { id: p.naprava.id, kljuc: p.naprava.kljuc }], root);
    const n = await preberiNastavitve(root);
    await writeJson(root, NASTAVITVE_ASISTENTA, { ...n, imena: { ...n.imena, [p.naprava.id]: p.naprava.ime } } satisfies Nastavitve);
    // T1-S1: pot klicev (koda OpenLine) se izda SELE zdaj in jo dobi samo ta naprava (POST /seznani/klici s podpisom); napaka
    // OpenLine Dodaj ne ovira, lastnik dobi opozorilo
    const t = stanje().tekoci;
    stanje().opozoriloKlicev = "";
    p.klici = null;
    if (t && !t.rezerva) {
      const { klici, opozorilo } = await potKlicev(root, t, openline, rokKlicevMs);
      p.klici = klici ? { url: klici.url, code: klici.koda, fp: klici.odtis } : null;
      stanje().opozoriloKlicev = opozorilo;
    }
    p.cas = Date.now(); // 10 min od »Dodaj« za prevzem poti klicev
    p.stanje = "sprejeto";
  });
  else { p.idPotrjen = undefined; p.stanje = "zavrnjeno"; }
  return stanjeAsistenta(token, root);
}

/** Lastnik odstrani napravo iz seznama; kanal njene naloge takoj ustavi (umik). */
export async function odstraniNapravo(token: string | null, id: unknown, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await naSeznamu(async () => {
    const k = await preberiKanal(root);
    if (typeof id !== "string" || !k.dovoljene.has(id)) throw new Error("Te naprave ni na seznamu.");
    await pripraviKanal([...k.dovoljene].filter(([i]) => i !== id).map(([i, kljuc]) => ({ id: i, kljuc })), root);
    const n = await preberiNastavitve(root);
    const imena = { ...n.imena };
    delete imena[id];
    await writeJson(root, NASTAVITVE_ASISTENTA, { ...n, imena } satisfies Nastavitve);
  });
  return stanjeAsistenta(token, root);
}

/** Za preizkuse: ustavi tekoci streznik in pozabi prijave. */
export async function ponastaviAsistenta(): Promise<void> {
  await ustavi();
  stanje().prijave.clear();
  stanje().napaka = "";
  stanje().napakaKoda = "";
  stanje().opozoriloKlicev = "";
  stanje().opozoriloPripraveKlicev = "";
  if (stanje().nadzor) clearInterval(stanje().nadzor!);
  stanje().nadzor = null;
}
