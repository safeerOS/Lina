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
import { randomBytes } from "node:crypto";
import { IzvajalecClaudeCode } from "./asistent.server.ts";
import { AsistentStreznik, zasebenNaslov, type Seznanitve, type StanjeSeznanitve } from "./asistent-streznik.server.ts";
import { zasebniNaslovi } from "./zasebno-omrezje.server.ts";
import { requireOwner } from "./auth.server.ts";
import { ID_NAPRAVE, potVticnice } from "./kanal-claude.ts";
import { preberiKanal, pripraviKanal } from "./kanal-claude.server.ts";
import { povabiloOpenLine, stanjeOpenLine, type PovabiloOpenLine } from "./openline-povabilo.server.ts";
import { SeznanitevSKodo } from "./koda-seznanitev.ts";
import { idVSkupinah } from "./id-naprave.ts";
import { jeClanKroga, PRESKOK_PRIMERJAVE_ZA_CLANE } from "./clan-kroga.server.ts";
import { OglasMdns, type MoznostiOglasa } from "./mdns-oglas.server.ts";
import { kodaQr, svgQr } from "./qr.ts";
import { VarovalkaKode } from "./varovalka-kode.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const NASTAVITVE_ASISTENTA = "asistent-telefon.json";
export const PRIVZETA_VRATA_ASISTENTA = 8446;
/** Koda QR velja 10 minut in samo za eno prijavo telefona. */
export const ROK_KODE_MS = 10 * 60_000;
/** Shema vsebine QR: ista kot QR konzole OpenLine (httpgateway://pair), v=1 doda razdelek asistentke (pogodba v AGENTS.md). */
export const SHEMA_QR = "httpgateway://pair";
/** Stanje varovalke kode (prezivi ponovni zagon, kot hub-varovalka.json v Linku). */
export const VAROVALKA_KODE = "koda-varovalka.json";

type Nastavitve = { vklop: boolean; naslov: string; vrata: number; imena: Record<string, string> };

function cisteNastavitve(n: Partial<Nastavitve> | null): Nastavitve {
  const vrata = Number.isInteger(n?.vrata) && (n!.vrata as number) >= 1024 && (n!.vrata as number) <= 65535 ? (n!.vrata as number) : PRIVZETA_VRATA_ASISTENTA;
  const naslov = typeof n?.naslov === "string" && zasebenNaslov(n.naslov) ? n.naslov : "127.0.0.1";
  const imena: Record<string, string> = {};
  for (const [id, ime] of Object.entries(n?.imena ?? {})) if (ID_NAPRAVE.test(id) && typeof ime === "string") imena[id] = ime.slice(0, 60);
  return { vklop: n?.vklop === true, naslov, vrata, imena };
}

async function preberiNastavitve(root: string): Promise<Nastavitve> {
  return cisteNastavitve(await readJsonFile<Partial<Nastavitve>>(root, NASTAVITVE_ASISTENTA).catch(() => null));
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
};

type Stanje = {
  tekoci: Tekoci | null; napaka: string; prijave: Map<string, Prijava>; veriga: Promise<unknown>; opozoriloKlicev: string;
  oglas: OglasMdns | null;
  /** Vezava zagona poti klicev (OpenLine); vpise jo zagon programa (zagon.server.ts). Brez nje (preizkusi) se nic ne zazene. */
  klici?: VezaKlicev | null;
  /** Tekoca priprava poti klicev (ena obljuba za vse klice) in njeno opozorilo (prazno, ce je vse v redu). */
  pripravaKlicev?: Promise<void> | null;
  opozoriloPripraveKlicev?: string;
  /** Za preizkuse: lazno omrezje za oglas DNS-SD. */
  omrezje?: Pick<MoznostiOglasa, "vticnica" | "maska" | "platforma">;
};
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
    await t.streznik.ustavi();
  }
  await ustaviPotKlicev();
}

/** Uskladi tekoci streznik z nastavitvami (zagon Line, sprememba nastavitev). Napaka zagona se zapomni za prikaz. */
export function uskladiAsistenta(dir?: string): Promise<void> {
  return zaporedno(async () => {
    const root = resolveDataDir(dir);
    const n = await preberiNastavitve(root);
    const t = stanje().tekoci;
    if (t && (!n.vklop || t.naslov !== n.naslov || t.vrata !== n.vrata)) await ustavi();
    if (!n.vklop || stanje().tekoci) {
      if (!n.vklop) stanje().napaka = "";
      // tece ze: pot klicev se zagotovi znova (ce je OpenLine med tem padel); ob izklopu jo je ustavil ustavi()
      const tek = stanje().tekoci;
      if (tek) void pripraviPotKlicev(root, tek.naslov);
      return;
    }
    try {
      const k = await preberiKanal(root);
      let krog: ReadonlySet<string> = new Set(k.dovoljene.keys());
      const izvajalec = new IzvajalecClaudeCode({
        pot: potVticnice(root, process.platform, k.imeCevi),
        zeton: async () => (await preberiKanal(root)).zeton,
        ozjiKrog: () => krog,
      });
      const osvezi = setInterval(() => { void preberiKanal(root).then((x) => { krog = new Set(x.dovoljene.keys()); }).catch(() => undefined); }, 3000);
      osvezi.unref?.();
      let pisanje: Promise<unknown> = Promise.resolve();
      const varovalka = new VarovalkaKode({
        stanje: await readJsonFile<unknown>(root, VAROVALKA_KODE).catch(() => null),
        shrani: (st) => { pisanje = pisanje.then(() => writeJson(root, VAROVALKA_KODE, st)).catch(() => undefined); },
      });
      let streznik: AsistentStreznik | null = null;
      const koda = new SeznanitevSKodo({ varovalka, odtis: () => streznik?.odtis ?? "" });
      koda.obOdprtju = () => zacniOglas(n.naslov, n.vrata);
      koda.obZaprtju = ustaviOglas;
      streznik = new AsistentStreznik({ root, naslov: n.naslov, vrata: n.vrata, izvajalec, seznanitve, koda });
      try {
        const { naslov, vrata, odtis } = await streznik.zazeni();
        stanje().tekoci = { streznik, izvajalec, osvezi, naslov, vrata, odtis, koda, varovalka };
        stanje().napaka = "";
        void pripraviPotKlicev(root, naslov); // v ozadju: uporabnik ne caka; napaka postane opozorilo
      } catch (e) {
        clearInterval(osvezi);
        izvajalec.zapri();
        throw e;
      }
    } catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      stanje().napaka = c === "EADDRINUSE" ? "Vrata so zasedena." : c === "EADDRNOTAVAIL" ? "Naslova ta racunalnik nima vec." : (e as Error).message.slice(0, 200);
    }
  });
}

export type StanjeAsistenta = {
  vklop: boolean;
  naslov: string;
  vrata: number;
  naslovi: string[];
  tece: boolean;
  napaka: string;
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
    vklop: n.vklop, naslov: n.naslov, vrata: n.vrata, naslovi: zasebniNaslovi(), tece: !!t, napaka: stanje().napaka, odtis: t?.odtis ?? "",
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

/** Lastnik vklopi ali izklopi telefon in izbere zasebni naslov in vrata. */
export async function shraniAsistenta(token: string | null, vnos: { vklop?: unknown; naslov?: unknown; vrata?: unknown }, dir?: string): Promise<StanjeAsistenta> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = await preberiNastavitve(root);
  if (typeof vnos.naslov === "string" && !zasebniNaslovi().includes(vnos.naslov)) throw new Error("Izberite naslov tega racunalnika v domacem omrezju.");
  const vrata = vnos.vrata === undefined ? n.vrata : Number(vnos.vrata);
  if (!Number.isInteger(vrata) || vrata < 1024 || vrata > 65535) throw new Error("Vrata morajo biti celo stevilo od 1024 do 65535.");
  await writeJson(root, NASTAVITVE_ASISTENTA, {
    ...n, vklop: vnos.vklop === undefined ? n.vklop : vnos.vklop === true, naslov: typeof vnos.naslov === "string" ? vnos.naslov : n.naslov, vrata,
  } satisfies Nastavitve);
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

export type Povabilo = { vsebina: string; svg: string; velja: number; klici: boolean; opozorilo: string };

/**
 * Nova enkratna koda in QR; samo ko streznik asistentke tece. QR nosi SAMO asistentko (T1-S1): koda OpenLine se izda sele ob
 * lastnikovem »Dodaj«, zato kdor QR le vidi ali posname, do poti klicev ne pride. `klici` pove, da bo pot klicev dodana ob »Dodaj«.
 */
export async function zacniSeznanitev(token: string | null, dir?: string): Promise<Povabilo> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const t = stanje().tekoci;
  if (!t) throw new Error("Najprej vklopite telefon za asistentko.");
  await pocakajPotKlicev(root, t.naslov); // pot klicev tece ze od vklopa; to jo zagotovi, ce je med tem padla
  pocistiPrijave();
  const koda = randomBytes(16).toString("base64url");
  const zdaj = Date.now();
  stanje().prijave.set(koda, { stanje: "odprta", cas: zdaj });
  const vsebina = vsebinaQr({ naslov: t.naslov, vrata: t.vrata, odtis: t.odtis, koda }, null, zdaj + ROK_KODE_MS);
  return { vsebina, svg: svgQr(kodaQr(vsebina)), velja: ROK_KODE_MS, klici: (await stanjeOpenLine(root)).povezan, opozorilo: "" };
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
    if (t) {
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
  stanje().opozoriloKlicev = "";
  stanje().opozoriloPripraveKlicev = "";
}
