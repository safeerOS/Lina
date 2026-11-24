/**
 * Lina gradi APK in deb na GitHubu (lastnik 24. 11. 2026; AGENTS.md »Lina gradi APK in deb na GitHubu«).
 * Potek: predlog (lastnik v zavihku Racunalnik, Lina z oznako [[gradnja: tok | veja]] ali telefon s podpisom; Lina prebere commit
 * vrha veje) -> lastnik potrdi (zgostitev toka, veje in commita; na telefonu podpis naprave) -> `gh workflow run <tok> -R
 * safeerOS/Lina --ref <veja>` -> spremljanje (`gh run list/view`, 45 s; nas tek je novejsi od zadnjega pred zagonom, ustvarjen po
 * potrditvi in PRAV potrjenega commita) -> anotacije opravil -> velikost artefaktov (meja 600 MB) -> `gh run download` v SKRITO
 * zacasno mapo, z nadzorom velikosti med razpakiranjem -> pregled imen in sha256 vsake datoteke, za APK podpis (apksigner) -> sele
 * nato premik v NOVO vidno mapo <Prejemi>/Lina gradnje/<datum ura>-<tok>-<veja>/ -> Lina sama pove izid, uro, POLNO pot in sha256 ->
 * »Namesti« potrdi lastnik (deb: samo iz veje, dovoljene za namestitev - privzeto privzeta veja repozitorija -, s prikazanim
 * sha256, vejo in commitom; vgrajena posodobitev. APK: telefon prenese po podpisani LAN poti, asistent-streznik.server.ts /gradnja/apk).
 * Prenos in pregled tecata ZUNAJ vrste stanja (pregled 0225 A-7): pogovor, telefon in gumbi med prenosom ne cakajo.
 * Stikalo »gradnje izklopljene« velja za vse: predlog, zagon, spremljanje, prenos, namestitev, odpiranje mape in APK telefonu (A-10).
 * Varovala: stalen repozitorij in zaprt seznam tokov, veja samo s seznama GitHuba, argv brez lupine, cwd = podatkovna mapa, okolje
 * brez TWILIO_/LINA_/NITRO_, zetona gh Lina nikoli ne bere (gh ga bere sam), izpis gh in besedilo anotacij nikoli ne gresta modelu;
 * ime datoteke iz artefakta gre v sporocilo Line samo, ce je iz varnih znakov (A-2).
 * Tajnica (klici) te datoteke ne uvaza (gradnje-github.server.test.ts).
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, accessSync, readdirSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ownerExists, requireOwner } from "./auth.server.ts";
import {
  AKTIVNA,
  CAKA_MS,
  GradnjaNapaka,
  NAJVEC_ANOTACIJ,
  NAJVEC_CAKAJOCIH,
  NAJVEC_CAKAJOCIH_LINE,
  NAJVEC_ZAPISOV,
  REPOZITORIJ,
  ROK_ISKANJA_TEKA_MS,
  ROK_TEKA_MS,
  TOKOVI,
  imeMapeGradnje,
  izluciPredlogeGradnje,
  jeTok,
  oblikaCommita,
  oblikaVeje,
  oceniKonec,
  preveriVejo,
  prostoIme,
  razberiAnotacije,
  razberiPodpis,
  razberiTek,
  razberiTeke,
  razberiVeje,
  sporociloIzida,
  varenDelPoti,
  velikostArtefaktov,
  zgostitevGradnje,
  type Anotacija,
  type PaketGradnje,
  type PodpisGradnje,
  type RazlogGradnje,
  type StanjeGradnje,
  type Tok,
} from "./gradnje-github.ts";
import type { IzidZagona } from "./posodobitev.server.ts";
import { kljucObsega, nizDovoljenja } from "./dovoljenja-podobne.ts";
import { najdiDovoljenje, zapisiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { preveriPodpisNaprave } from "./kanal-claude.ts";
import { resolveDataDir } from "./store.server.ts";

export const DATOTEKA_STANJA = "gradnje-github.json";
/** Podpis naprave za »Velja tudi za vse podobne« ob potrditvi s telefona (isti cas in enkratni niz kot potrditev). */
export type PodobneNaprave = { naprava: string; kljuc: string; cas: number; enkratni: string; podpis: string };
export const DATOTEKA_NASTAVITEV = "gradnje-github-nastavitve.json";
export const MAPA_GRADENJ = "Lina gradnje";
const SPREMLJANJE_MS = 45_000;
const VEJE_SVEZE_MS = 5 * 60_000;
const NAJVEC_DATOTEK = 50;
const NAJVEC_GLOBINA = 4;
const ROK_GH_MS = 60_000;
const ROK_PRENOSA_MS = 15 * 60_000;
/** Meja prenosa in razpakiranja vseh artefaktov enega teka skupaj (pregled 0225 A-4, odlocitev vodje). */
export const NAJVEC_PRENOS = 600 * 1024 * 1024;
/** Kako pogosto se med razpakiranjem preveri velikost skrite mape. */
const NADZOR_PRENOSA_MS = 1000;
/** Prenos, prekinjen s ponovnim zagonom Line, se ponovi najvec toliko krat (sicer bi poln disk ponavljal prenos do roka teka). */
const NAJVEC_POSKUSOV_PRENOSA = 2;
/** Tek mora nastati najvec toliko pred potrditvijo (razlika ur racunalnika in GitHuba); starejsi tek ni nas (A-13). */
const ZAMIK_URE_MS = 2 * 60_000;

export type IzvorGradnje = "lastnik" | "lina" | "telefon";

export type ZapisGradnje = {
  id: string;
  izvor: IzvorGradnje;
  tok: Tok;
  veja: string;
  /** SHA vrha veje ob predlogu (pregled 0225 A-3); zapis brez commita (starejsa Lina) se ne zazene, ne prenese in ne namesti. */
  commit: string | null;
  zgostitev: string;
  stanje: StanjeGradnje;
  ustvarjeno: string;
  potrjeno: string | null;
  /** Najvisji id teka tega toka in veje PRED zagonom; nas tek je prvi visji (brez primerjave ur). */
  prejsnjiTek: number;
  tekId: number | null;
  zacetekTeka: string | null;
  konec: string | null;
  zakljucek: string | null;
  anotacije: Anotacija[];
  mapa: string | null;
  datoteke: PaketGradnje[];
  paket: PaketGradnje | null;
  podpis: PodpisGradnje | null;
  razlog: RazlogGradnje | null;
  obvesceno: boolean;
  /** Stevilo zacetih prenosov (A-4): prenos, ki ga prekine ponovni zagon, se ne ponavlja v nedogled. */
  poskusiPrenosa: number;
};

/** privzeta: privzeta veja repozitorija z GitHuba (privzeto edina veja, dovoljena za namestitev deb; A-3). */
type Stanje = { v: 1; veje: string[]; vejeCas: number; privzeta: string | null; gradnje: ZapisGradnje[] };

export type Izvedi = (program: string, args: readonly string[], m: { cwd: string; env: NodeJS.ProcessEnv; rokMs: number; signal?: AbortSignal }) => Promise<string>;

export type Odvisnosti = {
  dom?: string;
  najdi?: (ime: "gh" | "apksigner" | "xdg-user-dir" | "xdg-open") => string | null;
  izvedi?: Izvedi;
  zdaj?: () => Date;
  /** Lina sama pove izid v pogovoru (privzeto zapis v zgodovino asistentke). */
  obvesti?: (root: string, besedilo: string) => Promise<void>;
  /** Namestitev deb prek vgrajene posodobitve (privzeto posodobitev.server.ts zacniPosodobitevIzGradnje). */
  namestiDeb?: (token: string | null, deb: { pot: string; sha256: string }, root: string) => Promise<IzidZagona>;
  /** false = brez casovnika v ozadju (preizkusi poklicejo spremljajGradnje sami). */
  spremljaj?: boolean;
  /** Meja prenosa in razpakiranja v bajtih (privzeto NAJVEC_PRENOS; preizkusi manjso). */
  najvecPrenos?: number;
};

export type JavnaGradnja = ZapisGradnje & { ocenaKonca: string | null; lahkoNamesti: boolean };
export type JavnoStanjeGradenj = {
  vklopljeno: boolean;
  geslo: boolean;
  gh: boolean;
  tokovi: Array<{ tok: Tok; vrsta: "apk" | "deb"; paket: string }>;
  veje: string[];
  /** Veje, iz katerih se sme namestiti deb (lastnik jih oznaci; privzeto privzeta veja repozitorija, ce je znana). */
  namestitevVeje: string[];
  gradnje: JavnaGradnja[];
};

/**
 * Okolje za gh, apksigner in xdg-*: samo seznam DOVOLJENEGA (kot okoljeSkripte v posodobitev.server.ts), zato kljuci ponudnikov
 * (OPENAI_, ANTHROPIC_, XAI_, OPENROUTER_, GEMINI_, GOOGLE_API_KEY ...) in skrivnosti Line ne gredo v otroke. GH_ in GITHUB_ samo za gh
 * (zGh); brez vprasanj v terminalu, brez barv in obvestil o posodobitvi.
 */
export function okoljeZaGh(okolje: NodeJS.ProcessEnv = process.env, zGh = true): NodeJS.ProcessEnv {
  const dovoljeno = (k: string): boolean =>
    /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|TMPDIR|TZ|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|JAVA_HOME|SSL_CERT_FILE|SSL_CERT_DIR)$/.test(k) ||
    /^(XDG|LC)_[A-Z_]+$/.test(k) ||
    /^(HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy)$/.test(k) ||
    // B4 (1750): isto pravilo kot github-dostop - zeton okolja ne prevlada nad prijavo, ki jo je lastnik izbral v Nastavitvah > GitHub
    (zGh && /^(GH|GITHUB)_[A-Z_]+$/.test(k) && !/^(GH|GITHUB)_(ENTERPRISE_)?TOKEN$/.test(k));
  return {
    ...Object.fromEntries(Object.entries(okolje).filter(([k, v]) => typeof v === "string" && dovoljeno(k))),
    GH_PROMPT_DISABLED: "1",
    NO_COLOR: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
  };
}

function izvedljiva(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function razlicicaNavzdol(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
}

/**
 * Absolutna pot programa: PATH, nato znana mesta (namescena Lina ima ozek PATH): gh v ~/.local/bin, /usr/local/bin, /usr/bin,
 * /snap/bin; apksigner v build-tools SDK (ANDROID_HOME, ANDROID_SDK_ROOT, ~/Android/Sdk, ~/.android-sdk), najvisja razlicica.
 */
export function najdiProgram(ime: string, dom = homedir(), okolje: NodeJS.ProcessEnv = process.env): string | null {
  if (!["gh", "apksigner", "xdg-user-dir", "xdg-open"].includes(ime)) return null;
  for (const m of (okolje.PATH ?? "").split(path.delimiter)) if (m && path.isAbsolute(m) && izvedljiva(path.join(m, ime))) return path.join(m, ime);
  const mesta =
    ime === "gh" ? [path.join(dom, ".local", "bin"), "/usr/local/bin", "/usr/bin", "/snap/bin"]
      : ime === "apksigner" ? [] : ["/usr/bin"];
  for (const m of mesta) if (izvedljiva(path.join(m, ime))) return path.join(m, ime);
  if (ime !== "apksigner") return null;
  for (const sdk of [okolje.ANDROID_HOME, okolje.ANDROID_SDK_ROOT, path.join(dom, "Android", "Sdk"), path.join(dom, ".android-sdk")]) {
    if (!sdk || !path.isAbsolute(sdk)) continue;
    let razlicice: string[] = [];
    try {
      razlicice = readdirSync(path.join(sdk, "build-tools")).filter((r) => /^[0-9]+(\.[0-9]+){0,3}$/.test(r)).sort(razlicicaNavzdol);
    } catch {
      continue;
    }
    for (const r of razlicice) if (izvedljiva(path.join(sdk, "build-tools", r, "apksigner"))) return path.join(sdk, "build-tools", r, "apksigner");
  }
  return null;
}

/**
 * Privzeto: execFile brez lupine z rokom in mejo izpisa; stderr se zavrze (lahko vsebuje podrobnosti, ki ne sodijo v vmesnik).
 * signal: prekinitev (prenos cez mejo velikosti) ustavi proces.
 */
const privzetoIzvedi: Izvedi = (program, args, m) =>
  new Promise((razresi, zavrni) => {
    execFile(program, [...args], { cwd: m.cwd, env: m.env, timeout: m.rokMs, maxBuffer: 4_000_000, shell: false, windowsHide: true, ...(m.signal ? { signal: m.signal } : {}) }, (napaka, stdout) =>
      napaka ? zavrni(new Error("izvedba")) : razresi(String(stdout)),
    );
  });

function odv(o: Odvisnosti) {
  const dom = o.dom ?? homedir();
  return {
    dom,
    najdi: o.najdi ?? ((ime: string) => najdiProgram(ime, dom)),
    izvedi: o.izvedi ?? privzetoIzvedi,
    zdaj: o.zdaj ?? (() => new Date()),
    obvesti: o.obvesti ?? privzetoObvesti,
    namestiDeb: o.namestiDeb ?? privzetoNamestiDeb,
    spremljaj: o.spremljaj ?? true,
    najvecPrenos: o.najvecPrenos ?? NAJVEC_PRENOS,
    surovo: o,
  };
}
type Odv = ReturnType<typeof odv>;

async function privzetoObvesti(root: string, besedilo: string): Promise<void> {
  const { dodajSporociloLine } = await import("./asistent-pogovor.server.ts");
  await dodajSporociloLine(root, besedilo);
}

async function privzetoNamestiDeb(token: string | null, deb: { pot: string; sha256: string }, root: string): Promise<IzidZagona> {
  const { zacniPosodobitevIzGradnje } = await import("./posodobitev.server.ts");
  return zacniPosodobitevIzGradnje(token, deb, root);
}

// --- Stanje na disku (podatkovna mapa, 0600, atomarno), zaporedno v tem procesu.
const vrste = new Map<string, Promise<unknown>>();
// shortcut: zaporedje samo v tem procesu (Lina tece kot en proces); ce bi stanje pisalo vec procesov, uporabi kljucavnico.
function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.then(delo, delo);
  vrste.set(root, zdaj.catch(() => undefined));
  return zdaj;
}

const ID = /^[a-f0-9]{16}$/;
async function preberi(root: string): Promise<Stanje> {
  try {
    const s = JSON.parse(await readFile(path.join(root, DATOTEKA_STANJA), "utf8")) as Partial<Stanje>;
    return {
      v: 1,
      veje: Array.isArray(s.veje) ? razberiVeje(s.veje.filter((x) => typeof x === "string").join("\n")) : [],
      vejeCas: typeof s.vejeCas === "number" ? s.vejeCas : 0,
      privzeta: oblikaVeje(s.privzeta) ? s.privzeta : null,
      gradnje: Array.isArray(s.gradnje)
        ? s.gradnje.filter((g) => g && ID.test(g.id) && jeTok(g.tok)).slice(-NAJVEC_ZAPISOV).map((g) => ({
          ...g,
          // zapis starejse Line nima commita: velja kot nepotrjen commit (fail-closed)
          commit: oblikaCommita(g.commit) ? g.commit : null,
          poskusiPrenosa: Number.isSafeInteger(g.poskusiPrenosa) ? g.poskusiPrenosa : 0,
        }))
        : [],
    };
  } catch {
    return { v: 1, veje: [], vejeCas: 0, privzeta: null, gradnje: [] };
  }
}

async function zapisi(root: string, s: Stanje): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const cilj = path.join(root, DATOTEKA_STANJA);
  const zacasna = `${cilj}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(zacasna, JSON.stringify(s, null, 2), { mode: 0o600, flag: "wx" });
  await rename(zacasna, cilj);
}

/**
 * Nastavitve gradenj (svoja datoteka, ne pravila.json - ta je na poti klica): stikalo (lastnik: privzeto VKLOPLJENO) in veje,
 * dovoljene za namestitev deb (pregled 0225 A-3; null = privzeta veja repozitorija). Datoteke ni = privzeto; neberljiva ali
 * pokvarjena datoteka: stikalo ostane privzeto, seznam vej za namestitev pa je PRAZEN (fail-closed).
 */
type NastavitveGradenj = { vklopljeno: boolean; namestitevVeje: string[] | null; pokvarjeno: boolean };
async function preberiNastavitve(root: string): Promise<NastavitveGradenj> {
  let surovo: string;
  try {
    surovo = await readFile(path.join(root, DATOTEKA_NASTAVITEV), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { vklopljeno: true, namestitevVeje: null, pokvarjeno: false };
    return { vklopljeno: true, namestitevVeje: [], pokvarjeno: true };
  }
  try {
    const v = JSON.parse(surovo) as { vklopljeno?: unknown; namestitevVeje?: unknown };
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("oblika");
    const veje = v.namestitevVeje === undefined ? null : Array.isArray(v.namestitevVeje) ? [...new Set(v.namestitevVeje.filter(oblikaVeje))].slice(0, 50) : [];
    return { vklopljeno: v.vklopljeno !== false, namestitevVeje: veje, pokvarjeno: false };
  } catch {
    return { vklopljeno: true, namestitevVeje: [], pokvarjeno: true };
  }
}

export async function jeVklopljeno(root: string): Promise<boolean> {
  return (await preberiNastavitve(root)).vklopljeno;
}

/** Branje-sprememba-zapis (prej je izklop stikala prepisal celo datoteko); zapis lastnika popravi pokvarjeno datoteko na privzeto. */
async function nastavi(root: string, sprememba: { vklopljeno?: boolean; namestitevVeje?: string[] }): Promise<void> {
  const n = await preberiNastavitve(root);
  const veje = sprememba.namestitevVeje ?? (n.pokvarjeno ? null : n.namestitevVeje);
  const cilj = path.join(root, DATOTEKA_NASTAVITEV);
  const zacasna = `${cilj}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(zacasna, JSON.stringify({ vklopljeno: sprememba.vklopljeno ?? n.vklopljeno, ...(veje ? { namestitevVeje: veje } : {}) }), { mode: 0o600, flag: "wx" });
  await rename(zacasna, cilj);
}

// --- gh
function gh(o: Odv, root: string, args: string[], rokMs = ROK_GH_MS, signal?: AbortSignal): Promise<string> {
  const p = o.najdi("gh");
  if (!p) throw new GradnjaNapaka("ni-gh");
  return o.izvedi(p, args, { cwd: root, env: okoljeZaGh(), rokMs, ...(signal ? { signal } : {}) });
}

/** SHA vrha veje na GitHubu (A-3): lastnik ga vidi in potrdi; napaka ali neveljaven izpis = predlog se ne ustvari. */
async function vrhVeje(o: Odv, root: string, veja: string): Promise<string> {
  let izpis: string;
  try {
    izpis = await gh(o, root, ["api", `repos/${REPOZITORIJ}/branches/${veja}`, "--jq", ".commit.sha"]);
  } catch (e) {
    if (e instanceof GradnjaNapaka) throw e;
    throw new GradnjaNapaka("veje");
  }
  const c = izpis.trim();
  if (!oblikaCommita(c)) throw new GradnjaNapaka("veje");
  return c;
}

/** Privzeta veja repozitorija (A-3: privzeto edina veja, iz katere se sme namestiti deb). */
async function privzetaVeja(o: Odv, root: string): Promise<string | null> {
  try {
    const v = (await gh(o, root, ["api", `repos/${REPOZITORIJ}`, "--jq", ".default_branch"])).trim();
    return oblikaVeje(v) ? v : null;
  } catch {
    return null;
  }
}

async function osveziVeje(o: Odv, root: string, s: Stanje, sveze: boolean): Promise<void> {
  if (!sveze && s.veje.length && o.zdaj().getTime() - s.vejeCas < VEJE_SVEZE_MS) return;
  let izpis: string;
  try {
    izpis = await gh(o, root, ["api", "--paginate", `repos/${REPOZITORIJ}/branches?per_page=100`, "--jq", ".[].name"]);
  } catch (e) {
    if (e instanceof GradnjaNapaka) throw e;
    throw new GradnjaNapaka("veje");
  }
  s.veje = razberiVeje(izpis);
  s.vejeCas = o.zdaj().getTime();
}

function jePotekel(g: ZapisGradnje, zdaj: Date): boolean {
  const t = Date.parse(g.ustvarjeno);
  return g.stanje === "caka" && (!Number.isFinite(t) || zdaj.getTime() - t > CAKA_MS);
}

/** Aktiven tek, ki se steje v zaklep toka (s rokom, da zaklep ne obstane za vedno). */
function zasedaTok(g: ZapisGradnje, zdaj: Date): boolean {
  const t = Date.parse(g.potrjeno ?? "");
  return AKTIVNA.includes(g.stanje) && Number.isFinite(t) && zdaj.getTime() - t < ROK_TEKA_MS;
}

/** Veje, dovoljene za namestitev: lastnikov seznam ali privzeta veja repozitorija (null = se ni znana; odloci streznik ob »Namesti«). */
function dovoljeneZaNamestitev(n: NastavitveGradenj, s: Stanje): string[] | null {
  return n.namestitevVeje ?? (s.privzeta ? [s.privzeta] : null);
}

function javna(s: Stanje, g: ZapisGradnje, zdaj: Date, dovoljene: string[] | null): JavnaGradnja {
  const vrsta = TOKOVI[g.tok].vrsta;
  const trajanja = s.gradnje
    .filter((x) => x.tok === g.tok && x.zakljucek === "success" && x.zacetekTeka && x.konec)
    .map((x) => Date.parse(x.konec!) - Date.parse(x.zacetekTeka!));
  const zacetek = Date.parse(g.zacetekTeka ?? g.potrjeno ?? "");
  const ocenaKonca = AKTIVNA.includes(g.stanje) && Number.isFinite(zacetek) ? new Date(oceniKonec(zacetek, trajanja, vrsta)).toISOString() : null;
  const lahkoNamesti = g.stanje === "koncano" && g.paket !== null && g.commit !== null
    && (vrsta === "deb" ? dovoljene === null || dovoljene.includes(g.veja) : g.podpis === "ujema" && dovoljene !== null && dovoljene.includes(g.veja));
  return { ...g, stanje: jePotekel(g, zdaj) ? "poteklo" : g.stanje, ocenaKonca, lahkoNamesti };
}

function javno(root: string, s: Stanje, o: Odv, n: NastavitveGradenj, geslo: boolean): JavnoStanjeGradenj {
  const zdaj = o.zdaj();
  const dovoljene = dovoljeneZaNamestitev(n, s);
  return {
    vklopljeno: n.vklopljeno,
    geslo,
    gh: o.najdi("gh") !== null,
    tokovi: (Object.keys(TOKOVI) as Tok[]).map((tok) => ({ tok, vrsta: TOKOVI[tok].vrsta, paket: TOKOVI[tok].paket })),
    veje: s.veje,
    namestitevVeje: dovoljene ?? [],
    gradnje: [...s.gradnje].reverse().map((g) => javna(s, g, zdaj, dovoljene)),
  };
}

async function predpogoj(root: string): Promise<void> {
  if (!(await jeVklopljeno(root))) throw new GradnjaNapaka("izklopljeno");
  // Brez gesla ima vsak lokalni proces sejo lastnika: priprava in zagon zavrnjena (fail-closed, kot naloge za Claude Code).
  if (!(await ownerExists(root))) throw new GradnjaNapaka("geslo");
}

async function dodajPredlog(root: string, izvor: IzvorGradnje, tok: unknown, veja: unknown, o: Odv): Promise<ZapisGradnje> {
  await predpogoj(root);
  if (!jeTok(tok)) throw new GradnjaNapaka("tok");
  return vVrsti(root, async () => {
    const s = await preberi(root);
    await osveziVeje(o, root, s, false);
    const v = preveriVejo(veja, s.veje);
    if (!v) {
      await zapisi(root, s);
      throw new GradnjaNapaka("veja");
    }
    const zdaj = o.zdaj();
    for (const g of s.gradnje) if (jePotekel(g, zdaj)) g.stanje = "poteklo";
    // Mesta za cakajoce so locena po izvoru (kot claude-naloge): Linini predlogi (vbrizg navodil) ne zasedejo lastnikovih/telefonskih.
    const jeLina = izvor === "lina";
    const cakajo = s.gradnje.filter((g) => g.stanje === "caka" && (g.izvor === "lina") === jeLina).length;
    if (cakajo >= (jeLina ? NAJVEC_CAKAJOCIH_LINE : NAJVEC_CAKAJOCIH)) throw new GradnjaNapaka("polno-cakajoce");
    // lastnik potrdi tocno ta commit (A-3); privzeta veja se prebere enkrat (veja, dovoljena za namestitev, ce je lastnik ne doloci)
    const commit = await vrhVeje(o, root, v);
    s.privzeta ??= await privzetaVeja(o, root);
    const g: ZapisGradnje = {
      id: randomBytes(8).toString("hex"),
      izvor,
      tok,
      veja: v,
      commit,
      zgostitev: zgostitevGradnje(tok, v, commit),
      stanje: "caka",
      ustvarjeno: zdaj.toISOString(),
      potrjeno: null,
      prejsnjiTek: 0,
      tekId: null,
      zacetekTeka: null,
      konec: null,
      zakljucek: null,
      anotacije: [],
      mapa: null,
      datoteke: [],
      paket: null,
      podpis: null,
      razlog: null,
      obvesceno: false,
      poskusiPrenosa: 0,
    };
    s.gradnje = [...s.gradnje, g].slice(-NAJVEC_ZAPISOV);
    await zapisi(root, s);
    return g;
  });
}

/**
 * Zaklep toka v pomnilniku: vzame se v vrsti stanja (vVrsti) po branju stanja in pred prvim klicem gh. Dva hkratna klika ze
 * vrsta izvede zaporedno (drugi vidi zasedaTok); zaklep je drugo varovalo, ce bi zagon kdaj tekel mimo vrste (pregled 0225 A-18:
 * prejsnji komentar »sinhrono pred prvim await« ni bil resnicen).
 */
const zasedeni = new Set<string>();

async function potrdi(root: string, id: unknown, zgostitev: unknown, o: Odv): Promise<{ tok: Tok; veja: string }> {
  if (typeof id !== "string" || !ID.test(id)) throw new GradnjaNapaka("ni-najdeno");
  await predpogoj(root);
  const izid = await vVrsti(root, async () => {
    const s = await preberi(root);
    const g = s.gradnje.find((x) => x.id === id);
    if (!g || g.stanje !== "caka") throw new GradnjaNapaka("ni-najdeno");
    if (typeof zgostitev !== "string" || zgostitev !== g.zgostitev || !g.commit || zgostitevGradnje(g.tok, g.veja, g.commit) !== g.zgostitev) throw new GradnjaNapaka("zgostitev");
    const zdaj = o.zdaj();
    if (jePotekel(g, zdaj)) {
      g.stanje = "poteklo";
      await zapisi(root, s);
      throw new GradnjaNapaka("poteklo");
    }
    const kljuc = `${root}\u0000${g.tok}`;
    if (zasedeni.has(kljuc) || s.gradnje.some((x) => x.tok === g.tok && zasedaTok(x, zdaj))) throw new GradnjaNapaka("tok-zaseden");
    zasedeni.add(kljuc);
    try {
      // seznam vej znova z GitHuba: veja, ki je ni vec, se ne zgradi
      await osveziVeje(o, root, s, true);
      if (!preveriVejo(g.veja, s.veje)) {
        await zapisi(root, s);
        throw new GradnjaNapaka("veja");
      }
      // veja se je od predloga premaknila: lastnik je potrdil drug commit (A-3); premik po tej preverbi ujame korak (headSha teka)
      if ((await vrhVeje(o, root, g.veja)) !== g.commit) {
        g.stanje = "poteklo";
        g.razlog = "commit";
        await zapisi(root, s);
        throw new GradnjaNapaka("commit");
      }
      let prej: number[];
      try {
        const teki = razberiTeke(await gh(o, root, ["run", "list", "-R", REPOZITORIJ, "--workflow", g.tok, "--branch", g.veja, "--limit", "1", "--json", "databaseId"]));
        // neveljaven izpis ni »ni prejsnjih tekov« (A-13): sicer bi bil vsak star tek »nas«
        if (!teki) throw new Error("izpis");
        prej = teki.map((t) => t.id);
        await gh(o, root, ["workflow", "run", g.tok, "-R", REPOZITORIJ, "--ref", g.veja]);
      } catch (e) {
        if (e instanceof GradnjaNapaka) throw e;
        g.stanje = "napaka";
        g.razlog = "zagon";
        g.potrjeno = zdaj.toISOString();
        await zapisi(root, s);
        return { tok: g.tok, veja: g.veja };
      }
      g.prejsnjiTek = Math.max(0, ...prej);
      g.potrjeno = zdaj.toISOString();
      g.stanje = "zaganja";
      await zapisi(root, s);
      return { tok: g.tok, veja: g.veja };
    } finally {
      zasedeni.delete(kljuc);
    }
  });
  if (o.spremljaj) zazeniSpremljanje(root, o.surovo);
  return izid;
}

/** Tokovi in skripte gradnje (B3 1750): workflow se pri `gh workflow run --ref` vzame z veje, skripte iz istega drevesa. */
// R3 (24. 11. 2026): tudi koda, ki jo orodja izvedejo med gradnjo: *.config.* (vite, vitest, eslint, postcss ...), buildSrc, build-logic,
// .npmrc, tsconfig*, scripts/ na vsaki globini. Preizkusi v src/ niso zajeti (repozitorij tokov ni lokalen - ali tok poganja preizkuse, NEPREVERJENO).
const POT_GRADNJE =
  /^\.github\/|(^|\/)(scripts\/|gradle\/|buildSrc\/|build-logic\/|package(-lock)?\.json$|gradlew(\.bat)?$|[^/]*\.gradle(\.kts)?$|gradle\.properties$|electron-builder[^/]*$|[^/]*\.sh$|[^/]*\.config\.[^/]+$|\.npmrc$|tsconfig[^/]*\.json$)/;
const NAJVEC_DATOTEK_PRIMERJAVE = 300; // GitHub compare vrne najvec 300 datotek: poln seznam = morda odrezan

/**
 * B3 (1750): dovoljenje za podobne gradnje velja samo, ce je commit enak zadnjemu potrjenemu za isti tok in vejo ali ce spremembe od
 * njega (samo naprej, brez prepisa zgodovine) ne posegajo v tokove ali skripte gradnje. Brez osnove, ob napaki gh, razhajanju ali
 * odrezanem seznamu predlog caka lastnika (fail-closed).
 */
async function brezSpremembGradnje(root: string, g: ZapisGradnje, o: Odv): Promise<boolean> {
  const osnova = (await preberi(root)).gradnje
    .filter((x) => x.id !== g.id && x.tok === g.tok && x.veja === g.veja && x.potrjeno && oblikaCommita(x.commit))
    .sort((a, b) => Date.parse(a.potrjeno!) - Date.parse(b.potrjeno!))
    .at(-1)?.commit;
  if (!osnova || !g.commit) return false;
  if (osnova === g.commit) return true;
  try {
    const r = JSON.parse(await gh(o, root, ["api", `repos/${REPOZITORIJ}/compare/${osnova}...${g.commit}`, "--jq", "{status: .status, files: [.files[].filename]}"])) as { status?: unknown; files?: unknown };
    if (r?.status !== "ahead" || !Array.isArray(r.files) || r.files.length >= NAJVEC_DATOTEK_PRIMERJAVE) return false;
    return r.files.every((f) => typeof f === "string" && !POT_GRADNJE.test(f));
  } catch {
    return false;
  }
}

/**
 * Dovoljenje za podobne gradnje (isti tok in ista veja) je uporabljeno: predlog gre po ISTI poti kot lastnikova potrditev (stikalo,
 * geslo, veja, commit, zaseden tok). Samo ZAGON gradnje; namestitev deb/APK se vedno vprasa posebej. Neuspeh pusti predlog cakati.
 */
async function potrdiPoDovoljenju(root: string, g: ZapisGradnje, o: Odv, naprava?: { naprava: string; kljuci: ReadonlyMap<string, string> }): Promise<ZapisGradnje> {
  if (!(await najdiDovoljenje(root, "gradnja", { tok: g.tok, veja: g.veja }, naprava ?? {}, o.zdaj()))) return g;
  if (!(await brezSpremembGradnje(root, g, o))) return g;
  try {
    await potrdi(root, g.id, g.zgostitev, o);
  } catch {
    return g;
  }
  return (await preberi(root)).gradnje.find((x) => x.id === g.id) ?? g;
}

// --- Spremljanje
const casovniki = new Map<string, ReturnType<typeof setInterval>>();
export function zazeniSpremljanje(root: string, o: Odvisnosti = {}): void {
  if (casovniki.has(root)) return;
  // prenos lahko traja do 15 min: nov krog se ne zacne, dokler prejsnji tece (sicer bi se krogi kopicili v vrsti)
  let tece = false;
  const t = setInterval(() => {
    if (tece) return;
    tece = true;
    void spremljajGradnje(root, o).then((aktivnih) => {
      if (aktivnih === 0) {
        clearInterval(t);
        casovniki.delete(root);
      }
    }).catch(() => undefined).finally(() => {
      tece = false;
    });
  }, SPREMLJANJE_MS);
  t.unref?.();
  casovniki.set(root, t);
}

async function prejemi(o: Odv, root: string): Promise<string> {
  const xdg = o.najdi("xdg-user-dir");
  if (xdg) {
    try {
      const p = (await o.izvedi(xdg, ["DOWNLOAD"], { cwd: root, env: okoljeZaGh(process.env, false), rokMs: 5000 })).trim();
      // xdg-user-dir vrne dom, ce mapa ni nastavljena; podatkovna mapa Line ni dovoljena
      if (path.isAbsolute(p) && path.resolve(p) !== path.resolve(o.dom) && !/[\u0000-\u001f]/.test(p) && path.relative(root, p).startsWith("..")) return path.resolve(p);
    } catch {
      /* nadomestilo spodaj */
    }
  }
  for (const ime of ["Prejemi", "Downloads"]) {
    const p = path.join(o.dom, ime);
    if ((await lstat(p).catch(() => null))?.isDirectory()) return p;
  }
  return path.join(o.dom, "Prejemi");
}

/** <Prejemi>/Lina gradnje (navadna mapa, ne povezava). */
async function osnovaGradenj(o: Odv, root: string): Promise<string> {
  const osnova = path.join(await prejemi(o, root), MAPA_GRADENJ);
  await mkdir(osnova, { recursive: true, mode: 0o755 });
  if (!(await lstat(osnova)).isDirectory()) throw new GradnjaNapaka("artefakt");
  return osnova;
}

/**
 * Pregledano skrito mapo prenosa premakne v NOVO vidno mapo gradnje (nikoli obstojeca: ob zasedenem imenu naslednja pripona).
 * Premik je v isti mapi (rename), zato pregledane datoteke ostanejo iste.
 */
async function vVidnoMapo(o: Odv, osnova: string, zacasna: string, g: ZapisGradnje): Promise<string> {
  const zasedena = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const ime = prostoIme(imeMapeGradnje(o.zdaj(), g.tok, g.veja), (x) => zasedena.has(x));
    const cilj = path.join(osnova, ime);
    if (await lstat(cilj).catch(() => null)) {
      zasedena.add(ime);
      continue;
    }
    try {
      await rename(zacasna, cilj);
    } catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      if (c !== "EEXIST" && c !== "ENOTEMPTY") throw e;
      zasedena.add(ime);
      continue;
    }
    await chmod(cilj, 0o755);
    return cilj;
  }
  throw new GradnjaNapaka("artefakt");
}

/** Velikost mape med prenosom (A-4): vsota velikosti datotek; prevec vnosov steje kot cez mejo. */
async function velikostMape(mapa: string): Promise<number> {
  let vsota = 0;
  let vnosov = 0;
  const hodi = async (m: string, globina: number): Promise<void> => {
    if (globina > NAJVEC_GLOBINA + 1) {
      vsota = Infinity;
      return;
    }
    for (const ime of await readdir(m)) {
      if (++vnosov > NAJVEC_DATOTEK * 20) {
        vsota = Infinity;
        return;
      }
      const st = await lstat(path.join(m, ime)).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) await hodi(path.join(m, ime), globina + 1);
      else vsota += st.size;
    }
  };
  await hodi(mapa, 0);
  return vsota;
}

async function vsota(pot: string): Promise<{ sha256: string; velikost: number } | null> {
  let ds;
  try {
    ds = await open(pot, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null;
  }
  try {
    const st = await ds.stat();
    if (!st.isFile()) return null;
    const h = createHash("sha256");
    for await (const k of ds.createReadStream({ autoClose: false })) h.update(k as Buffer);
    return { sha256: h.digest("hex"), velikost: st.size };
  } finally {
    await ds.close();
  }
}

/** Po razpakiranju: samo navadne datoteke in mape, brez simbolnih povezav, vse znotraj mape gradnje. */
async function preglejArtefakt(mapa: string): Promise<PaketGradnje[]> {
  const prava = await realpath(mapa);
  const izid: PaketGradnje[] = [];
  async function hodi(m: string, globina: number): Promise<void> {
    if (globina > NAJVEC_GLOBINA) throw new GradnjaNapaka("artefakt");
    for (const ime of await readdir(m)) {
      // ime je izpis GitHuba in gre v sporocilo Line in vmesnik: samo varni znaki (A-2)
      if (!varenDelPoti(ime)) throw new GradnjaNapaka("artefakt");
      const p = path.join(m, ime);
      const st = await lstat(p);
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw new GradnjaNapaka("artefakt");
      const r = path.relative(prava, await realpath(p));
      if (!r || r.startsWith("..") || path.isAbsolute(r)) throw new GradnjaNapaka("artefakt");
      if (st.isDirectory()) {
        await hodi(p, globina + 1);
        continue;
      }
      if (izid.length >= NAJVEC_DATOTEK) throw new GradnjaNapaka("artefakt");
      const v = await vsota(p);
      if (!v) throw new GradnjaNapaka("artefakt");
      izid.push({ pot: r.split(path.sep).join("/"), ...v });
    }
  }
  await hodi(prava, 0);
  return izid.sort((a, b) => a.pot.localeCompare(b.pot));
}

function izberiPaket(g: ZapisGradnje, datoteke: PaketGradnje[]): PaketGradnje | null {
  const vzorec = TOKOVI[g.tok].vrsta === "apk" ? /\.apk$/ : /(^|\/)lina-lupina_[0-9.]+_amd64\.deb$/;
  const kandidati = datoteke.filter((d) => vzorec.test(d.pot));
  return kandidati.length === 1 ? kandidati[0]! : null;
}

async function preveriPodpis(o: Odv, root: string, g: ZapisGradnje, pot: string): Promise<PodpisGradnje> {
  const apksigner = o.najdi("apksigner");
  if (!apksigner) return "ni-preverjen";
  try {
    const odtis = razberiPodpis(await o.izvedi(apksigner, ["verify", "--print-certs", pot], { cwd: root, env: okoljeZaGh(process.env, false), rokMs: ROK_GH_MS }));
    if (!odtis) return "ne-ujema";
    return odtis === TOKOVI[g.tok].podpis ? "ujema" : "ne-ujema";
  } catch {
    // apksigner zavrne neveljaven podpis z neniclo izhodno kodo
    return "ne-ujema";
  }
}

async function anotacije(o: Odv, root: string, opravila: number[]): Promise<Anotacija[]> {
  const vse: Anotacija[] = [];
  for (const id of opravila.slice(0, 20)) {
    try {
      vse.push(...razberiAnotacije(await gh(o, root, ["api", `repos/${REPOZITORIJ}/check-runs/${id}/annotations`])));
    } catch {
      /* brez anotacij tega opravila; stevilo je potem spodnja meja */
    }
    if (vse.length >= NAJVEC_ANOTACIJ) break;
  }
  return vse.slice(0, NAJVEC_ANOTACIJ);
}

/** En korak spremljanja enega aktivnega teka (v vrsti stanja); spremeni zapis g. Prenos NI tu (A-7): uspel tek dobi stanje prenasa. */
async function korak(o: Odv, root: string, g: ZapisGradnje): Promise<void> {
  const zdaj = o.zdaj();
  const potrjeno = Date.parse(g.potrjeno ?? "");
  if (!Number.isFinite(potrjeno) || zdaj.getTime() - potrjeno > ROK_TEKA_MS) {
    g.stanje = "napaka";
    g.razlog = "rok";
    return;
  }
  if (!g.commit) {
    g.stanje = "napaka";
    g.razlog = "commit";
    return;
  }
  if (g.tekId === null) {
    const teki = razberiTeke(await gh(o, root, ["run", "list", "-R", REPOZITORIJ, "--workflow", g.tok, "--branch", g.veja, "--event", "workflow_dispatch", "--limit", "10", "--json", "databaseId,headSha,createdAt"]));
    // nas tek: novejsi od zadnjega pred zagonom in ustvarjen po potrditvi (A-13), PRAV potrjenega commita (A-3)
    const novi = (teki ?? [])
      .filter((t) => t.id > g.prejsnjiTek && t.createdAt !== null && Date.parse(t.createdAt) >= potrjeno - ZAMIK_URE_MS)
      .sort((a, b) => a.id - b.id);
    const nas = novi.find((t) => t.headSha === g.commit);
    if (!nas) {
      // nov tek drugega commita: veja se je premaknila med potrditvijo in zagonom; gradnja potrjenega commita ne obstaja
      if (novi.some((t) => t.headSha !== null)) {
        g.stanje = "napaka";
        g.razlog = "commit";
      } else if (zdaj.getTime() - potrjeno > ROK_ISKANJA_TEKA_MS) {
        g.stanje = "napaka";
        g.razlog = "ni-teka";
      }
      return;
    }
    g.tekId = nas.id;
    g.stanje = "tece";
  }
  const tek = razberiTek(await gh(o, root, ["run", "view", String(g.tekId), "-R", REPOZITORIJ, "--json", "status,conclusion,createdAt,updatedAt,jobs"]));
  if (!tek) return;
  g.zacetekTeka = tek.createdAt ?? g.zacetekTeka;
  if (tek.status !== "completed") return;
  g.konec = tek.updatedAt ?? zdaj.toISOString();
  g.zakljucek = tek.conclusion;
  // zelen tek ni dovolj: opozorila (anotacije) se preberejo vedno (skil safeer-ci-opozorila)
  g.anotacije = await anotacije(o, root, tek.opravila);
  if (tek.conclusion !== "success") {
    g.stanje = "neuspesno";
    return;
  }
  g.stanje = "prenasa";
}

type IzidPrenosa = Pick<ZapisGradnje, "stanje" | "razlog" | "mapa" | "datoteke" | "paket" | "podpis">;

/**
 * Prenos in pregled artefakta (ZUNAJ vrste stanja, A-7). Meja velikosti velja pred prenosom (velikost artefaktov na GitHubu) in med
 * razpakiranjem (nadzor skrite mape; cez mejo se gh prekine), A-4. Delni ali zavrnjen prenos se pobrise (samo skrita mapa, ki jo je
 * ustvarila ta koda); v vidno mapo gre sele pregledan artefakt.
 */
async function prenesiArtefakt(o: Odv, root: string, g: ZapisGradnje): Promise<IzidPrenosa> {
  const napaka = (razlog: RazlogGradnje): IzidPrenosa => ({ stanje: "napaka", razlog, mapa: null, datoteke: [], paket: null, podpis: null });
  if (g.tekId === null) return napaka("prenos");
  let bajtov: number | null;
  try {
    bajtov = velikostArtefaktov(await gh(o, root, ["api", `repos/${REPOZITORIJ}/actions/runs/${g.tekId}/artifacts?per_page=100`]), TOKOVI[g.tok].artefakt);
  } catch (e) {
    if (e instanceof GradnjaNapaka) throw e;
    return napaka("prenos");
  }
  if (bajtov === null) return napaka("prenos");
  if (bajtov > o.najvecPrenos) return napaka("prevelik");
  const osnova = await osnovaGradenj(o, root);
  // skrita zacasna mapa (0700) v isti mapi kot vidne: premik je rename
  const zacasna = await mkdtemp(path.join(osnova, ".prenos-"));
  let premaknjena = false;
  try {
    const prekini = new AbortController();
    let prevec = false;
    const nadzor = setInterval(() => {
      void velikostMape(zacasna).then((v) => {
        if (v > o.najvecPrenos) {
          prevec = true;
          prekini.abort();
        }
      }, () => undefined);
    }, NADZOR_PRENOSA_MS);
    nadzor.unref?.();
    try {
      await gh(o, root, ["run", "download", String(g.tekId), "-R", REPOZITORIJ, "-n", TOKOVI[g.tok].artefakt, "-D", zacasna], ROK_PRENOSA_MS, prekini.signal);
    } catch (e) {
      if (e instanceof GradnjaNapaka) throw e;
      return napaka(prevec ? "prevelik" : "prenos");
    } finally {
      clearInterval(nadzor);
    }
    if (prevec || (await velikostMape(zacasna)) > o.najvecPrenos) return napaka("prevelik");
    let datoteke: PaketGradnje[];
    try {
      datoteke = await preglejArtefakt(zacasna);
    } catch {
      return napaka("artefakt");
    }
    const paket = izberiPaket(g, datoteke);
    if (!paket) return napaka("ni-paketa");
    const podpis = TOKOVI[g.tok].vrsta === "apk" ? await preveriPodpis(o, root, g, path.join(zacasna, ...paket.pot.split("/"))) : null;
    const mapa = await vVidnoMapo(o, osnova, zacasna, g);
    premaknjena = true;
    return { stanje: "koncano", razlog: null, mapa, datoteke, paket, podpis };
  } finally {
    if (!premaknjena) await rm(zacasna, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Sporocila Line za koncane, se neobvescene gradnje (vsaka enkrat). */
function novaObvestila(s: Stanje): string[] {
  const nova: string[] = [];
  for (const g of s.gradnje) {
    if (g.obvesceno || !g.potrjeno || !["koncano", "neuspesno", "napaka"].includes(g.stanje)) continue;
    g.obvesceno = true;
    nova.push(
      g.stanje === "napaka"
        ? `Gradnja ${g.tok} (veja ${g.veja}) se ni izvedla do konca (${g.razlog ?? "napaka"}).${g.mapa ? ` Mapa: ${g.mapa}.` : ""} Namestitve ne ponudim. Podrobnosti so v zavihku Računalnik.`
        : sporociloIzida(g),
    );
  }
  return nova;
}

/** Prenosi, ki tecejo v tem procesu (koren + id): drug krog (casovnik, gumb Osvezi) istega prenosa ne zacne znova. */
const prenosi = new Set<string>();

/** En krog spremljanja vseh aktivnih tekov; Lina pove izid vsakega koncanega enkrat. Vrne stevilo se aktivnih. */
export async function spremljajGradnje(dir: string | undefined, odvisnosti: Odvisnosti = {}): Promise<number> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  const vklopljeno = await jeVklopljeno(root);
  const krog = await vVrsti(root, async () => {
    const s = await preberi(root);
    for (const g of s.gradnje) {
      if (!AKTIVNA.includes(g.stanje)) continue;
      // izklop stikala velja tudi za tek v spremljanju (A-10): nic vec se ne prenese
      if (!vklopljeno) {
        if (!prenosi.has(`${root}\u0000${g.id}`)) {
          g.stanje = "napaka";
          g.razlog = "izklopljeno";
        }
        continue;
      }
      if (g.stanje === "prenasa") continue;
      try {
        await korak(o, root, g);
      } catch (e) {
        if (e instanceof GradnjaNapaka && e.razlog === "ni-gh") {
          g.stanje = "napaka";
          g.razlog = "ni-gh";
        }
        // druge napake gh (omrezje): poskusi znova v naslednjem krogu, do roka teka
      }
    }
    const zaPrenos: ZapisGradnje[] = [];
    for (const g of s.gradnje) {
      if (g.stanje !== "prenasa" || prenosi.has(`${root}\u0000${g.id}`)) continue;
      if (g.poskusiPrenosa >= NAJVEC_POSKUSOV_PRENOSA) {
        g.stanje = "napaka";
        g.razlog = "prenos";
        continue;
      }
      g.poskusiPrenosa++;
      prenosi.add(`${root}\u0000${g.id}`);
      zaPrenos.push({ ...g });
    }
    const nova = novaObvestila(s);
    try {
      await zapisi(root, s);
    } catch (e) {
      for (const g of zaPrenos) prenosi.delete(`${root}\u0000${g.id}`);
      throw e;
    }
    return { nova, zaPrenos };
  });
  for (const b of krog.nova) await o.obvesti(root, b).catch(() => undefined);
  for (const g of krog.zaPrenos) {
    const kljuc = `${root}\u0000${g.id}`;
    try {
      let izid: IzidPrenosa;
      try {
        izid = await prenesiArtefakt(o, root, g);
      } catch (e) {
        izid = { stanje: "napaka", razlog: e instanceof GradnjaNapaka ? e.razlog : "prenos", mapa: null, datoteke: [], paket: null, podpis: null };
      }
      // izid se zapise v SVEZE stanje (vmes so se lahko spremenili drugi zapisi), samo ce gradnja se caka na ta prenos
      const nova = await vVrsti(root, async () => {
        const s = await preberi(root);
        const x = s.gradnje.find((y) => y.id === g.id);
        if (!x || x.stanje !== "prenasa") return [];
        Object.assign(x, izid);
        const n = novaObvestila(s);
        await zapisi(root, s);
        return n;
      });
      for (const b of nova) await o.obvesti(root, b).catch(() => undefined);
    } finally {
      prenosi.delete(kljuc);
    }
  }
  return (await preberi(root)).gradnje.filter((g) => AKTIVNA.includes(g.stanje)).length;
}

// --- Javni ukazi (seja lastnika)
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function stanjeGradenj(token: string | null, dir?: string, odvisnosti: Odvisnosti = {}): Promise<JavnoStanjeGradenj> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const o = odv(odvisnosti);
  const s = await preberi(root);
  // po ponovnem zagonu Line se spremljanje nadaljuje iz stanja
  if (o.spremljaj && s.gradnje.some((g) => AKTIVNA.includes(g.stanje))) zazeniSpremljanje(root, odvisnosti);
  return javno(root, s, o, await preberiNastavitve(root), await ownerExists(root));
}

function koncanaGradnja(s: Stanje, id: unknown): ZapisGradnje {
  const g = s.gradnje.find((x) => x.id === id);
  if (!g || g.stanje !== "koncano" || !g.mapa || !g.paket) throw new GradnjaNapaka("ni-najdeno");
  return g;
}

export async function ukazGradenj(token: string | null, ukaz: unknown, dir?: string, odvisnosti: Odvisnosti = {}): Promise<JavnoStanjeGradenj & { namestitev?: IzidZagona }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const o = odv(odvisnosti);
  const u = obj(ukaz);
  let namestitev: IzidZagona | undefined;
  switch (u.ukaz) {
    case "veje":
      await predpogoj(root);
      await vVrsti(root, async () => {
        const s = await preberi(root);
        await osveziVeje(o, root, s, true);
        await zapisi(root, s);
      });
      break;
    case "pripravi":
      await dodajPredlog(root, "lastnik", u.tok, u.veja, o);
      break;
    case "potrdi": {
      const g = await potrdi(root, u.id, u.zgostitev, o);
      // »Velja tudi za vse podobne« (samo strogo true iz seje lastnika): isti tok in ista veja; namestitev ostane vsakic
      if (u.podobne === true) await zapisiDovoljenje(root, "gradnja", { tok: g.tok, veja: g.veja }, { kdo: "lastnik" });
      break;
    }
    case "odkloni":
      await vVrsti(root, async () => {
        const s = await preberi(root);
        const g = s.gradnje.find((x) => x.id === u.id && x.stanje === "caka");
        if (!g) throw new GradnjaNapaka("ni-najdeno");
        g.stanje = "odklonjeno";
        await zapisi(root, s);
      });
      break;
    case "osvezi":
      await spremljajGradnje(root, odvisnosti);
      break;
    case "namesti": {
      // stikalo in geslo veljata tudi za namestitev (A-10)
      await predpogoj(root);
      // pot izbere streznik iz stanja; u.mapa ali druga polja iz brskalnika se ne uporabijo
      const s = await preberi(root);
      const g = koncanaGradnja(s, u.id);
      if (TOKOVI[g.tok].vrsta !== "deb") throw new GradnjaNapaka("ni-namestitve");
      // A-3: lastnik je pred »Namesti« videl sha256, vejo in commit; vmesnik ju vrne in streznik ju primerja (zapis brez commita ne gre)
      if (!g.commit || u.sha256 !== g.paket!.sha256 || u.commit !== g.commit) throw new GradnjaNapaka("zgostitev");
      // A-3: deb (namestitev kot root) samo iz veje, ki jo je lastnik dovolil (privzeto privzeta veja repozitorija)
      const dovoljene = dovoljeneZaNamestitev(await preberiNastavitve(root), s) ?? [await privzetaVeja(o, root)];
      if (!dovoljene.includes(g.veja)) throw new GradnjaNapaka("veja-namestitev");
      // tocno datoteka in sha256 iz stanja; posodobitev zavrne datoteko, spremenjeno ali dodano po gradnji
      namestitev = await o.namestiDeb(token, { pot: path.join(g.mapa!, ...g.paket!.pot.split("/")), sha256: g.paket!.sha256 }, root);
      break;
    }
    case "namestitevVeja": {
      // lastnik oznaci vejo, iz katere se sme namestiti deb (A-3); veja mora biti prave oblike
      await predpogoj(root);
      if (!oblikaVeje(u.veja) || typeof u.dovoli !== "boolean") throw new GradnjaNapaka("ukaz");
      const veja = u.veja;
      const dovoli = u.dovoli;
      await vVrsti(root, async () => {
        const s = await preberi(root);
        const n = await preberiNastavitve(root);
        if (n.namestitevVeje === null && !n.pokvarjeno) {
          s.privzeta ??= await privzetaVeja(o, root);
          await zapisi(root, s);
        }
        const zdaj = (n.pokvarjeno ? null : n.namestitevVeje) ?? (s.privzeta ? [s.privzeta] : []);
        await nastavi(root, { namestitevVeje: dovoli ? [...new Set([...zdaj, veja])] : zdaj.filter((v) => v !== veja) });
      });
      break;
    }
    case "odpri": {
      await predpogoj(root);
      const g = (await preberi(root)).gradnje.find((x) => x.id === u.id && x.mapa);
      if (!g) throw new GradnjaNapaka("ni-najdeno");
      const p = o.najdi("xdg-open");
      if (!p) throw new GradnjaNapaka("odpri");
      // xdg-open lahko ostane zivo, dokler upravitelj ne konca: napaka zagona je dovolj za razlog
      void o.izvedi(p, [g.mapa!], { cwd: root, env: okoljeZaGh(process.env, false), rokMs: 10_000 }).catch(() => undefined);
      break;
    }
    case "vklop":
      if (typeof u.vklop !== "boolean") throw new GradnjaNapaka("ukaz");
      // isto zaporedje kot namestitevVeja: dve hkratni spremembi nastavitev se ne prepiseta
      await vVrsti(root, () => nastavi(root, { vklopljeno: u.vklop as boolean }));
      break;
    default:
      throw new GradnjaNapaka("ukaz");
  }
  const s = await preberi(root);
  return { ...javno(root, s, o, await preberiNastavitve(root), await ownerExists(root)), ...(namestitev ? { namestitev } : {}) };
}

/** Lina (asistentka) predlaga gradnjo iz oznake v odgovoru; izid je samo predlog. Napaka nikoli ne podre pogovora (null). */
export async function predlagajGradnjo(dir: string | undefined, tok: unknown, veja: unknown, odvisnosti: Odvisnosti = {}, izvor: IzvorGradnje = "lina"): Promise<ZapisGradnje | null> {
  try {
    const root = resolveDataDir(dir);
    const o = odv(odvisnosti);
    return await potrdiPoDovoljenju(root, await dodajPredlog(root, izvor, tok, veja, o), o);
  } catch {
    return null;
  }
}

/**
 * Oznaka [[gradnja: tok | veja]] v odgovoru Line: vedno se odstrani; nastane SAMO predlog (pri priponkah nic, ker je vsebina
 * datoteke podatek). Besedilo, ki ga Lina doda, sestavi koda.
 */
export async function obdelajGradnjo(root: string, odgovor: string, dovoliPredlog: boolean, odvisnosti: Odvisnosti = {}): Promise<string> {
  const { besedilo, predlogi } = izluciPredlogeGradnje(odgovor);
  if (!predlogi.length) return odgovor;
  if (!dovoliPredlog) return besedilo;
  if (!(await jeVklopljeno(root).catch(() => false))) return `${besedilo}\n\n(Gradnje na GitHubu so izklopljene v Nastavitvah.)`.trim();
  const p = predlogi[0]!;
  const z = await predlagajGradnjo(root, p.tok, p.veja, odvisnosti);
  const izid = !z ? "(Gradnje nisem pripravila: tok ali veja ni dovoljen.)"
    : z.stanje === "caka" ? `(Predlog gradnje ${z.tok}, veja ${z.veja}, čaka vašo potrditev v zavihku Računalnik ali na telefonu.)`
    : `(Gradnja ${z.tok}, veja ${z.veja}, je zagnana po vašem dovoljenju za podobne gradnje; namestitev boste potrdili posebej. Preklic v Nastavitvah > Dovoljenja.)`;
  return `${besedilo}\n\n${izid}`.trim();
}

// --- Telefon (asistent-streznik.server.ts preveri podpis naprave ozjega kroga PRED klicem teh funkcij)
export async function telefonStanje(dir: string, odvisnosti: Odvisnosti = {}): Promise<JavnoStanjeGradenj> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  const n = await preberiNastavitve(root);
  const vklopljeno = n.vklopljeno;
  const geslo = await ownerExists(root);
  // telefon nima gumba »Osvezi veje«: zastarel seznam (5 min) se osvezi tu; napaka gh ne podre branja stanja
  if (vklopljeno && geslo) {
    await vVrsti(root, async () => {
      const s = await preberi(root);
      const prej = s.vejeCas;
      await osveziVeje(o, root, s, false).catch(() => undefined);
      if (s.vejeCas !== prej) await zapisi(root, s);
    });
  }
  const s = await preberi(root);
  // po ponovnem zagonu Line se spremljanje nadaljuje tudi, ce stanje bere samo telefon
  if (o.spremljaj && s.gradnje.some((g) => AKTIVNA.includes(g.stanje))) zazeniSpremljanje(root, odvisnosti);
  return javno(root, s, o, n, geslo);
}

/** Predlog s telefona; ce je TA naprava (s podpisom) ze dovolila podobne gradnje, se zazene brez druge potrditve. */
export async function telefonPredlog(
  dir: string, tok: unknown, veja: unknown, odvisnosti: Odvisnosti = {}, naprava?: { naprava: string; kljuci: ReadonlyMap<string, string> },
): Promise<ZapisGradnje> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  const g = await dodajPredlog(root, "telefon", tok, veja, o);
  return naprava ? potrdiPoDovoljenju(root, g, o, naprava) : g;
}

/**
 * Potrditev s telefona. `podobne`: podpis naprave nad nizDovoljenja za tok in vejo TE gradnje (asistent-streznik je glavni podpis ze
 * preveril); dovoljenje se zapise samo, ce ta podpis velja, in velja samo za to napravo.
 */
export async function telefonPotrdi(dir: string, id: unknown, zgostitev: unknown, odvisnosti: Odvisnosti = {}, podobne?: PodobneNaprave): Promise<void> {
  const root = resolveDataDir(dir);
  const g = await potrdi(root, id, zgostitev, odv(odvisnosti));
  if (!podobne) return;
  const kljuc = kljucObsega("gradnja", { tok: g.tok, veja: g.veja });
  if (!kljuc || !preveriPodpisNaprave(podobne.kljuc, nizDovoljenja(podobne.naprava, kljuc, podobne.cas, podobne.enkratni), podobne.podpis)) return;
  await zapisiDovoljenje(root, "gradnja", { tok: g.tok, veja: g.veja }, {
    kdo: "naprava", naprava: podobne.naprava, dokaz: { cas: podobne.cas, enkratni: podobne.enkratni, podpis: podobne.podpis },
  });
}

export type ApkZaTelefon = { id: string; pot: string; sha256: string; velikost: number; paket: string };
/**
 * APK za telefon: SAMO zadnja koncana gradnja APK s podpisom, enakim namesceni Lini; vsota se ob branju izracuna znova
 * (O_NOFOLLOW), zamenjana datoteka = null. Nikoli poljubna pot. Izklopljene gradnje: nic (A-10).
 */
export async function apkZaTelefon(dir: string): Promise<ApkZaTelefon | null> {
  const root = resolveDataDir(dir);
  if (!(await jeVklopljeno(root))) return null;
  const s = await preberi(root);
  // A-3 kot deb: samo iz dovoljene veje (neznana privzeta veja = nic) in samo zapis s commitom, ki ga je lastnik potrdil.
  const dovoljene = dovoljeneZaNamestitev(await preberiNastavitve(root), s);
  if (!dovoljene) return null;
  const g = [...s.gradnje].reverse().find((x) => TOKOVI[x.tok].vrsta === "apk" && x.stanje === "koncano" && dovoljene.includes(x.veja));
  if (!g || !g.mapa || !g.paket || !g.commit || g.podpis !== "ujema") return null;
  const pot = path.join(g.mapa, ...g.paket.pot.split("/"));
  const v = await vsota(pot).catch(() => null);
  if (!v || v.sha256 !== g.paket.sha256) return null;
  return { id: g.id, pot, sha256: v.sha256, velikost: v.velikost, paket: TOKOVI[g.tok].paket };
}
