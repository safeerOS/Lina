/**
 * Lina kot vodja (lastnik 24. 11. 2026): kopija za agenta, diff za slepi pregled, zdruzitev po vrsti s preizkusi z mejo pomnilnika in
 * uveljavitev v izvirniku. Samo disk in procesi (argv, brez lupine); odlocitve o poteku so v claude-naloge.server.ts (korakVodje).
 *
 * Varnost:
 * - Vse poti so pod <podatki>/delo (izpeljane v kodi, nikoli iz vhoda); izvirnik se spremeni samo v uveljavi() po potrditvi zgostitve.
 * - git z izklopljenimi kljukami (core.hooksPath), brez zunanjega diffa in textconv, z identiteto Line; diff brez sledenja povezavam,
 *   z mejo velikosti in rokom. N1 (pregled agentov 24. 11.): git Line bere samo lokalno nastavitev repozitorija (brez globalne in
 *   sistemske) in pred vsakim ukazom zavrne vsak kljuc zunaj seznama VARNE_NASTAVITVE (filter.*, merge.*, diff.*, include ...), ki bi
 *   izvedel ukaz; worktree pod <podatki>/delo mora imeti .git datoteko, ki kaze v <projekt>/.git/worktrees (zamenjan .git = zavrnitev).
 * - Preizkusi dela agenta z omejenimi mapami (N4) tecejo samo v peskovniku (DepsVodje.peskovnik), sicer se ne pozenejo.
 * - Preizkusi samo z mejo pomnilnika (systemd-run --user --scope, MemoryMax); brez nje se ne pozenejo in se ne zdruzi.
 * - Brez brisanja: neuspel poskus zdruzitve brez gita ostane v svoji mapi; z gitom se razveljavi samo v worktree zdruzitve (reset na
 *   prejsnjo potrditev zdruzitve, ki je tudi varnostna kopija pred zdruzitvijo).
 * Tajnica (klici) te datoteke ne uvaza (kanal-claude.test.ts PREPOVEDANO_ZA_KLIC: claude-naloge*).
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { chmod, copyFile, cp, lstat, mkdir, open, readdir, readFile, readlink, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { MAPA_NALOG } from "./claude-naloge.ts";
import { jeWindows } from "./platforma.server.ts";
import { DATOTEKA_DIFFA, MAPA_DELA, jeArgvPreizkusa, zgostitevUveljavitve, type OpisNapake, type VodjaNaloge } from "./claude-naloge-vodja.ts";

/** izpis = stdout (git ga razbira kot oznako commita), napaka = stderr (opozorila gita ne pokvarijo izpisa). */
export type IzidUkaza = { koda: number | null; izpis: string; potekel: boolean; napaka?: string };
/** Zagon programa brez lupine z rokom (ubije celo skupino procesov); izhod v datoteko z mejo velikosti (diff). */
export type Izvedi = (program: string, args: readonly string[], o: { cwd: string; rokMs: number; okolje: NodeJS.ProcessEnv; izhod?: string }) => Promise<IzidUkaza>;

export type DepsVodje = {
  najdi: (ime: string) => string | null;
  platforma: NodeJS.Platform;
  izvedi: Izvedi;
  /** Zagon ukazov preizkusov (ze z mejo pomnilnika); locen, da preizkusi Line ne pozenejo pravega npm test. */
  izvediPreizkus: Izvedi;
  okolje: NodeJS.ProcessEnv;
  /** N4: predpona bwrap (do "--") za preizkuse v mapi zdruzitve; brez nje se preizkusi dela agenta z omejenimi mapami ne pozenejo. */
  peskovnik?: (mapa: string) => Promise<string[] | null>;
};

/** Zdruzeno delo vec agentov enega projekta (locen worktree ali mapa pod <podatki>/delo/zdruzitev-<id>). */
export type Zdruzitev = {
  id: string;
  projekt: string;
  git: boolean;
  /** Trenutno zdruzeno stanje (git: worktree veje zdruzitve; sicer zadnja uspela mapa poskusa). */
  pot: string;
  /** git: commit izvirnika ob nastanku; sicer posnetek izvirnika ob nastanku. */
  osnova: string;
  /** git: zadnja uspela potrditev zdruzitve (varnostna kopija pred naslednjo); sicer prazno. */
  glava: string;
  veja: string | null;
  naloge: string[];
  n: number;
  /** Zgostitev, ki jo lastnik potrdi z »Uveljavi« (projekt + sha diffa od osnove do zdruzitve). */
  zgostitev: string | null;
  diff: string | null;
  /** Lastnik je kliknil »Uveljavi«, izvirnik pa je sel naprej: Lina zdruzitev posodobi z izvirnikom (korak vodje). */
  osvezi?: boolean;
  /** Zakaj zadnja posodobitev z izvirnikom ni uspela (lastnik odloci). */
  razlog?: "spor" | "padlo" | "brez-meje" | "vrnjen" | "brez-peskovnika" | "uveljavi" | null;
  /** Tocki 7/8: zakaj »Uveljavi« ni uspel (besedilo za lastnika) in pot izvozenega popravka za rocni pregled. */
  opis?: OpisNapake;
  podrobnost?: string;
  izvoz?: string;
  /** N4: v zdruzitvi je delo agenta z omejenimi mapami - preizkusi samo v peskovniku (za vedno, tudi po neuspelem poskusu). */
  omejeno?: boolean;
};

const NAJVEC_IZPISA = 64 * 1024;
export const MEJA_DIFFA_B = 20 * 1024 * 1024;
const NAJVEC_DATOTEK = 50_000;
const NAJVEC_BAJTOV_KOPIJE = 1024 * 1024 * 1024;
const ROK_GIT_MS = 120_000;
const ROK_PREIZKUSA_MS = 20 * 60_000;
export const MEJA_POMNILNIKA = "3G";
/** Mape, ki ne gredo v kopijo ali diff: odvisnosti (povezava na izvirnik), naloge Line, git. */
const IZPUSCENO = new Set(["node_modules", MAPA_NALOG, ".git"]);

export const privzetoIzvedi: Izvedi = (program, args, o) =>
  new Promise((razresi) => {
    let izpis = "";
    let napaka = "";
    let potekel = false;
    let koncano = false;
    let bajtov = 0;
    const datoteka = o.izhod ? createWriteStream(o.izhod, { flags: "w", mode: 0o600 }) : null;
    const otrok = spawn(program, [...args], {
      cwd: o.cwd,
      env: o.okolje,
      // kot privzetaPreverba: svoja skupina procesov (po roku se ubije cela skupina)
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const ubij = () => {
      potekel = true;
      try {
        process.kill(-(otrok.pid as number), "SIGKILL");
      } catch {
        otrok.kill("SIGKILL");
      }
    };
    const konec = (koda: number | null) => {
      if (koncano) return;
      koncano = true;
      clearTimeout(rok);
      clearTimeout(varovalo);
      const izid = { koda: potekel ? null : koda, izpis: izpis.slice(0, NAJVEC_IZPISA), potekel, napaka: napaka.slice(0, NAJVEC_IZPISA) };
      if (datoteka) datoteka.end(() => razresi(izid));
      else razresi(izid);
    };
    datoteka?.on("error", ubij);
    otrok.stdout?.on("data", (k: Buffer) => {
      if (datoteka) {
        bajtov += k.length;
        if (bajtov > MEJA_DIFFA_B) ubij();
        else datoteka.write(k);
      } else if (izpis.length < NAJVEC_IZPISA) izpis += k.toString("utf8");
    });
    otrok.stderr?.on("data", (k: Buffer) => {
      if (napaka.length < NAJVEC_IZPISA) napaka += k.toString("utf8");
    });
    const rok = setTimeout(ubij, o.rokMs);
    const varovalo = setTimeout(() => konec(null), o.rokMs + 5000);
    otrok.once("error", () => konec(null));
    otrok.once("close", (koda) => konec(koda));
  });

/** Preizkus z mejo pomnilnika (systemd-run --user --scope; samo Linux s systemd); brez systemd-run ali na Windows null (ni zagona brez meje). */
export function ukazZMejo(najdi: (ime: string) => string | null, platforma: NodeJS.Platform, argv: readonly string[], meja = MEJA_POMNILNIKA): string[] | null {
  if (jeWindows(platforma)) return null;
  const sr = najdi("systemd-run");
  if (!sr) return null;
  return [sr, "--user", "--scope", "--quiet", "-p", `MemoryMax=${meja}`, "-p", "MemorySwapMax=0", ...argv];
}

/** Polna oznaka commita (argument gitu iz zapisa stanja nikoli ne more biti zastavica). */
const jeCommit = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40,64}$/.test(v);

function znotraj(koren: string, pot: string): boolean {
  const rel = path.relative(koren, pot);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Pot mora biti pod <podatki>/delo (zapis stanja je Linin, a poti se ne verjame na slepo). */
export function vDelu(root: string, p: unknown): p is string {
  return typeof p === "string" && path.isAbsolute(p) && znotraj(path.join(root, MAPA_DELA), path.resolve(p));
}

const GIT_NASTAVITVE = [
  "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "user.name=Lina", "-c", "user.email=lina@localhost.invalid",
  "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.quotePath=false", "-c", "core.attributesFile=/dev/null",
];
/** N1: brez globalne in sistemske nastavitve in atributov (tam so lahko gonilniki filtrov, npr. lfs) - velja samo lokalna, ki se preveri. */
const GIT_OKOLJE = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1" };

/**
 * N1: kljuci lokalne nastavitve, ki ne morejo izvesti ukaza ali premakniti repozitorija (seznam dovoljenih, fail-closed). Vse drugo
 * (filter.*, merge.*.driver, diff.*, include*, core.worktree, core.sshCommand, gpg.*, alias.* ...) = zavrnitev.
 */
const VARNE_NASTAVITVE =
  /^(core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|quotepath|hookspath|fsmonitor|attributesfile|longpaths|checkstat|trustctime)|extensions\.(objectformat|worktreeconfig)|remote\..+\.(url|pushurl|fetch|prune|prunetags|tagopt|mirror|skipdefaultupdate|gh-resolved)|branch\..+\.(remote|pushremote|merge|rebase|description|vscode-merge-base)|submodule\..+\.(url|active)|user\.(name|email)|(commit|tag)\.gpgsign|init\.defaultbranch|pull\.(rebase|ff)|push\.default|lfs\.repositoryformatversion)$/i;

/** Klic gita brez preverbe (samo za preverbo nastavitve). */
async function gitSurovo(d: DepsVodje, cwd: string, args: readonly string[], izhod?: string): Promise<IzidUkaza> {
  const g = d.najdi("git");
  if (!g) return { koda: null, izpis: "git ni najden", potekel: false };
  return d.izvedi(g, [...GIT_NASTAVITVE, ...args], { cwd, rokMs: ROK_GIT_MS, okolje: { ...d.okolje, ...GIT_OKOLJE }, izhod });
}

/**
 * N1: nastavitev repozitorija v cwd (lokalna + worktree + vkljucene) ima samo VARNE_NASTAVITVE; sicer napaka »git nastavitve«. Preverba
 * pred VSAKIM ukazom (agent lahko nastavitev spremeni vmes); `git config --list` sam ne izvede nicesar.
 */
async function preveriNastavitve(d: DepsVodje, cwd: string): Promise<void> {
  const r = await gitSurovo(d, cwd, ["config", "--list", "--show-scope", "-z"]);
  // odrezan izpis bi pustil del nastavitve nepreverjen
  if (r.koda !== 0 || r.izpis.length >= NAJVEC_IZPISA) throw new Error("git nastavitve");
  // -z: »obseg\0kljuc\nvrednost\0« ...; obseg »command« so samo zastavice -c Line (GIT_NASTAVITVE)
  const deli = r.izpis.split("\0");
  for (let i = 0; i + 1 < deli.length; i += 2) {
    const ime = deli[i + 1]!.split("\n")[0] ?? "";
    if (deli[i] !== "command" && !VARNE_NASTAVITVE.test(ime)) throw new Error(`git nastavitve: ${ime.slice(0, 80)}`);
  }
}

export async function git(d: DepsVodje, cwd: string, args: readonly string[], izhod?: string): Promise<IzidUkaza> {
  try {
    await preveriNastavitve(d, cwd);
  } catch (e) {
    return { koda: null, izpis: "", potekel: false, napaka: (e as Error).message };
  }
  return gitSurovo(d, cwd, args, izhod);
}

/**
 * N1b: worktree Line (kopija naloge ali zdruzitev pod <podatki>/delo) mora imeti .git kot navadno datoteko »gitdir: X«, kjer je X v
 * <projekt>/.git/worktrees - agent, ki .git zamenja z lastnim repozitorijem (ali povezavo), se zavrne z »git kopije«.
 */
async function preveriWorktree(projekt: string, mapa: string): Promise<void> {
  const v = await preberiMalo(path.join(mapa, ".git"));
  const m = v?.match(/^gitdir: (.+)\n?$/);
  const koren = await realpath(path.join(projekt, ".git", "worktrees")).catch(() => null);
  const cilj = m && path.isAbsolute(m[1]!) ? await realpath(m[1]!).catch(() => null) : null;
  if (!koren || !cilj || !znotraj(koren, cilj) || path.dirname(cilj) !== koren) throw new Error("git kopije");
}

async function gitOk(d: DepsVodje, cwd: string, args: readonly string[]): Promise<string> {
  const r = await git(d, cwd, args);
  if (r.koda !== 0) throw new Error(`git ${args[0]}: ${(r.napaka || r.izpis).slice(0, 300)}`);
  return r.izpis.trim();
}

/** Commit HEAD, ce je mapa koren git repozitorija brez nezapisanih sprememb (razen nalog Line); sicer null (kopija mape). */
async function cistGit(d: DepsVodje, projekt: string): Promise<string | null> {
  try {
    const top = await gitOk(d, projekt, ["rev-parse", "--show-toplevel"]);
    if ((await realpath(top)) !== (await realpath(projekt))) return null;
    const status = await gitOk(d, projekt, ["status", "--porcelain"]);
    if (status.split("\n").some((v) => v.trim() && !v.slice(3).startsWith(`${MAPA_NALOG}/`))) return null;
    return await gitOk(d, projekt, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    return null;
  }
}

/** Kopija mape brez node_modules, .lina-naloge in .git; povezave se kopirajo dobesedno; meja stevila datotek in bajtov. */
async function kopirajMapo(iz: string, v: string): Promise<void> {
  let datotek = 0;
  let bajtov = 0;
  await cp(iz, v, {
    recursive: true,
    verbatimSymlinks: true,
    errorOnExist: true,
    force: false,
    filter: async (src) => {
      if (src !== iz && IZPUSCENO.has(path.basename(src))) return false;
      const st = await lstat(src);
      if (++datotek > NAJVEC_DATOTEK) throw new Error("kopija: prevec datotek");
      if (st.isFile()) bajtov += st.size;
      if (bajtov > NAJVEC_BAJTOV_KOPIJE) throw new Error("kopija: prevelika");
      return st.isFile() || st.isDirectory() || st.isSymbolicLink();
    },
  });
}

/** node_modules izvirnika kot povezava (preizkusi v kopiji); ne kopira se in ni v diffu. */
async function poveziOdvisnosti(projekt: string, kopija: string): Promise<void> {
  const nm = path.join(projekt, "node_modules");
  try {
    if (!(await lstat(nm)).isDirectory()) return;
    // vrsta velja samo na Windows (junction ne potrebuje skrbniskih pravic); drugod je Node ne uporablja
    await symlink(nm, path.join(kopija, "node_modules"), "junction");
  } catch {
    /* brez odvisnosti ali ze obstaja */
  }
}

export type Kopija = { kopija: string; git: boolean; osnova: string };

/**
 * N11: simbolna povezava v kopiji, ki kaze ven iz kopije (dobesedno ali razreseno), bi agentu dala zapis mimo diffa in pregleda - kopija se
 * zavrne (»kopija: povezava ven«). Povezave znotraj kopije so dovoljene; .git, node_modules in naloge Line se ne pregledujejo.
 */
async function preveriPovezave(koren: string): Promise<void> {
  const vrsta = [koren];
  let vnosov = 0;
  while (vrsta.length) {
    const mapa = vrsta.pop()!;
    for (const v of await readdir(mapa, { withFileTypes: true })) {
      if (++vnosov > NAJVEC_DATOTEK) throw new Error("kopija: prevec datotek");
      const pot = path.join(mapa, v.name);
      if (mapa === koren && IZPUSCENO.has(v.name)) continue;
      if (v.isSymbolicLink()) {
        const cilj = path.resolve(mapa, await readlink(pot));
        const resnicni = await realpath(pot).catch(() => cilj);
        const k = await realpath(koren);
        if (!znotraj(koren, cilj) || !znotraj(k, resnicni)) throw new Error(`kopija: povezava ven (${path.relative(koren, pot)})`);
      } else if (v.isDirectory()) vrsta.push(pot);
    }
  }
}

/** Kopija za nalogo: git worktree na veji lina/<id> (cist repozitorij) ali kopija mape (osnova + delo) v <podatki>/delo/<id>/. */
export async function ustvariKopijo(d: DepsVodje, root: string, id: string, projekt: string): Promise<Kopija> {
  const mapa = path.join(root, MAPA_DELA, id);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const kopija = path.join(mapa, "delo");
  const glava = await cistGit(d, projekt);
  if (glava) {
    await gitOk(d, projekt, ["worktree", "add", "-q", "-b", `lina/${id}`, kopija, glava]);
    await preveriPovezave(kopija);
    await poveziOdvisnosti(projekt, kopija);
    return { kopija, git: true, osnova: glava };
  }
  const osnova = path.join(mapa, "osnova");
  await kopirajMapo(projekt, osnova);
  await kopirajMapo(osnova, kopija);
  await preveriPovezave(kopija);
  await poveziOdvisnosti(projekt, kopija);
  return { kopija, git: false, osnova };
}

async function shaDatoteke(p: string): Promise<{ sha: string; velikost: number }> {
  const b = await readFile(p);
  return { sha: createHash("sha256").update(b).digest("hex"), velikost: b.length };
}

/** diff -ruN brez sledenja povezavam; obe mapi morata biti v isti nadmapi (poti a/x in b/x za patch -p1). */
async function diffMap(d: DepsVodje, osnova: string, delo: string, izhod: string): Promise<void> {
  const prog = d.najdi("diff");
  if (!prog || path.dirname(osnova) !== path.dirname(delo)) throw new Error("diff ni na voljo");
  const izp = [...IZPUSCENO].flatMap((x) => ["-x", x]);
  const r = await d.izvedi(prog, ["-ruN", "--no-dereference", ...izp, path.basename(osnova), path.basename(delo)], {
    cwd: path.dirname(osnova),
    rokMs: ROK_GIT_MS,
    okolje: d.okolje,
    izhod,
  });
  // N11: napaka diff (npr. nova povezava) z besedilom iz stderr; binarne datoteke in posebne datoteke patch tiho preskoci -> zavrni
  if (r.koda !== 0 && r.koda !== 1) throw new Error(`diff: ${(r.napaka || r.izpis || `izhod ${r.koda}`).slice(0, 300)}`);
  const izpis = await readFile(izhod, "utf8");
  const posebno = izpis.match(/^(Binary files .* differ|File .* is a .* while file .*)$/m);
  if (posebno) throw new Error(`diff: binarne ali posebne datoteke niso podprte brez gita (${posebno[0].slice(0, 200)})`);
}

/** glava: git commit, ki ga je Lina zapisala in pregledala (zdruzi se natanko ta, ne veja ob casu zdruzitve). */
export type Diff = { pot: string; sha: string; prazen: boolean; glava?: string };

/**
 * Diff dela naloge od osnove (krog = stevilka pregleda). git: Lina sama zapise vse spremembe v kopiji na veji lina/<id> (tudi nesledene;
 * brez .lina-naloge in node_modules) in vzame `git diff osnova..HEAD`; sicer diff -ruN osnova delo.
 */
export async function diffKopije(d: DepsVodje, root: string, id: string, kopija: string, v: Pick<VodjaNaloge, "git" | "osnova" | "projekt">, krog: number): Promise<Diff> {
  if (!vDelu(root, kopija)) throw new Error("kopija zunaj dela");
  if (v.git ? !jeCommit(v.osnova) : !vDelu(root, v.osnova)) throw new Error("osnova");
  const pot = path.join(root, MAPA_DELA, id, `krog-${krog}.diff`);
  if (v.git) {
    await preveriWorktree(v.projekt, kopija);
    if ((await gitOk(d, kopija, ["rev-parse", "--abbrev-ref", "HEAD"])) !== `lina/${id}`) throw new Error("veja kopije ni lina/<id>");
    const brez = [":(exclude)" + MAPA_NALOG, ":(exclude)node_modules"];
    await gitOk(d, kopija, ["add", "-A", "--", ".", ...brez]);
    const r = await git(d, kopija, ["diff", "--cached", "--quiet"]);
    if (r.koda === 1) await gitOk(d, kopija, ["commit", "-q", "--no-verify", "-m", `Lina: delo naloge ${id}`]);
    else if (r.koda !== 0) throw new Error("git diff --cached");
    const glava = await gitOk(d, kopija, ["rev-parse", "--verify", "HEAD"]);
    if (!jeCommit(glava)) throw new Error("git HEAD");
    const izid = await git(d, kopija, ["diff", "--no-ext-diff", "--no-textconv", "--binary", v.osnova, glava, "--", ".", ...brez], pot);
    if (izid.koda !== 0) throw new Error(`git diff: ${(izid.napaka || izid.izpis).slice(0, 300)}`);
    const s = await shaDatoteke(pot);
    return { pot, sha: s.sha, prazen: s.velikost === 0, glava };
  }
  await diffMap(d, v.osnova, kopija, pot);
  const s = await shaDatoteke(pot);
  return { pot, sha: s.sha, prazen: s.velikost === 0 };
}

/** Mapa za slepi pregled: samo diff (pregledovalec ne dobi porocila, besedila naloge ali spomina). */
export async function pripraviPregled(root: string, id: string, krog: number, diff: string): Promise<string> {
  const mapa = path.join(root, MAPA_DELA, id, `pregled-${krog}`);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  await copyFile(diff, path.join(mapa, DATOTEKA_DIFFA));
  return mapa;
}

/** Varno branje majhne datoteke (brez povezav). */
async function preberiMalo(p: string): Promise<string | null> {
  try {
    const h = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const st = await h.stat();
      if (!st.isFile() || st.size > 64 * 1024) return null;
      const buf = Buffer.alloc(st.size);
      const { bytesRead } = await h.read(buf, 0, st.size, 0);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await h.close();
    }
  } catch {
    return null;
  }
}

async function obstaja(p: string): Promise<boolean> {
  return lstat(p).then(
    () => true,
    () => false,
  );
}

/** Ukazi preizkusov: nastavljeni za projekt ali zaznani (npm test, ce ima package.json skript test; tsc --noEmit, ce sta tsconfig in tsc). */
export async function ukaziPreizkusov(d: DepsVodje, mapa: string, nastavljeni?: readonly string[][]): Promise<string[][]> {
  const razresi = (a: readonly string[]) => [path.isAbsolute(a[0]!) ? a[0]! : (d.najdi(a[0]!) ?? a[0]!), ...a.slice(1)];
  if (nastavljeni?.length) return nastavljeni.filter(jeArgvPreizkusa).map(razresi);
  const ukazi: string[][] = [];
  const pkg = await preberiMalo(path.join(mapa, "package.json"));
  try {
    const p = pkg ? (JSON.parse(pkg) as { scripts?: Record<string, unknown> }) : null;
    if (typeof p?.scripts?.test === "string") ukazi.push(razresi(["npm", "test"]));
  } catch {
    /* neveljaven package.json: brez npm test */
  }
  const tsc = path.join(mapa, "node_modules", ".bin", "tsc");
  if ((await obstaja(path.join(mapa, "tsconfig.json"))) && (await obstaja(tsc))) ukazi.push([tsc, "--noEmit"]);
  return ukazi;
}

export type IzidPreizkusov = { izid: "ok" | "padlo" | "brez-meje" | "brez-peskovnika"; izpis: string };

/** systemd-run ni ustvaril obsega (ni vodila seje uporabnika ipd.): ukaz se ni zagnal - to ni padec preizkusov (teki/22-systemd-run-pravi.log). */
const MEJA_NI_ZAGNANA = /^(Failed to (connect to bus|create bus connection|start transient scope unit)|Job for .* failed)/m;

async function preizkusi(d: DepsVodje, mapa: string, ukazi: readonly string[][], omejeno = false): Promise<IzidPreizkusov> {
  // N4: koda agenta z omejenimi mapami samo v peskovniku (brez omrezja, brez vodila seje, prepovedane mape skrite); brez njega ni zagona
  // tocka 5 (vodja 24. 11.): lasten razlog »brez-peskovnika« (besedilo SL/EN), ne »brez-meje« (ta ostane za mejo pomnilnika)
  const ovoj = omejeno ? ((await d.peskovnik?.(mapa)) ?? null) : [];
  if (!ovoj) return { izid: "brez-peskovnika", izpis: "" };
  const zMejo = ukazi.map((a) => ukazZMejo(d.najdi, d.platforma, [...ovoj, ...a]));
  if (zMejo.some((a) => a === null)) return { izid: "brez-meje", izpis: "" };
  for (const a of zMejo as string[][]) {
    const r = await d.izvediPreizkus(a[0]!, a.slice(1), { cwd: mapa, rokMs: ROK_PREIZKUSA_MS, okolje: d.okolje });
    if (r.koda !== 0 && MEJA_NI_ZAGNANA.test(r.napaka ?? "")) return { izid: "brez-meje", izpis: r.napaka ?? "" };
    if (r.koda !== 0) return { izid: "padlo", izpis: `${r.izpis}\n${r.napaka ?? ""}`.slice(0, NAJVEC_IZPISA) };
  }
  return { izid: "ok", izpis: "" };
}

/** Nova zdruzitev iz TRENUTNEGA izvirnika (git: HEAD; sicer posnetek), da uveljavitev preveri, ali se je izvirnik vmes spremenil. */
async function novaZdruzitev(d: DepsVodje, root: string, projekt: string, git_: boolean): Promise<Zdruzitev> {
  const id = randomBytes(6).toString("hex");
  const mapa = path.join(root, MAPA_DELA, `zdruzitev-${id}`);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  if (git_) {
    const glava = await gitOk(d, projekt, ["rev-parse", "--verify", "HEAD"]);
    const veja = `lina/zdruzitev-${id}`;
    const pot = path.join(mapa, "delo");
    await gitOk(d, projekt, ["worktree", "add", "-q", "-b", veja, pot, glava]);
    await poveziOdvisnosti(projekt, pot);
    return { id, projekt, git: true, pot, osnova: glava, glava, veja, naloge: [], n: 0, zgostitev: null, diff: null };
  }
  const osnova = path.join(mapa, "osnova");
  await kopirajMapo(projekt, osnova);
  const pot = path.join(mapa, "0");
  await kopirajMapo(osnova, pot);
  await poveziOdvisnosti(projekt, pot);
  return { id, projekt, git: false, pot, osnova, glava: "", veja: null, naloge: [], n: 0, zgostitev: null, diff: null };
}

/** Diff celotne zdruzitve od osnove in zgostitev za potrditev. */
async function diffZdruzitve(d: DepsVodje, root: string, zd: Zdruzitev): Promise<{ pot: string; zgostitev: string }> {
  const pot = path.join(root, MAPA_DELA, `zdruzitev-${zd.id}`, "zdruzitev.diff");
  if (zd.git) {
    const r = await git(d, zd.pot, ["diff", "--no-ext-diff", "--no-textconv", "--binary", zd.osnova, zd.glava], pot);
    if (r.koda !== 0) throw new Error("git diff zdruzitve");
  } else {
    await diffMap(d, zd.osnova, zd.pot, pot);
  }
  return { pot, zgostitev: zgostitevUveljavitve(zd.projekt, zd.osnova, (await shaDatoteke(pot)).sha) };
}

export type IzidZdruzitve = { izid: "ok" | "spor" | "padlo" | "brez-meje" | "brez-peskovnika"; zd: Zdruzitev; izpis: string };

/**
 * Zdruzi delo naloge v zdruzitev projekta (po vrsti, ena naenkrat). git: merge --no-ff veje lina/<id> v worktree zdruzitve, spor ->
 * merge --abort; sicer patch --forward --batch v NOVO mapo poskusa. Po zdruzitvi preizkusi z mejo pomnilnika; neuspeh = razveljavi
 * v kopiji (git reset na prejsnjo glavo zdruzitve; mapa poskusa se ne uporabi). Izvirnik se tu nikoli ne spremeni.
 */
export async function zdruzi(
  d: DepsVodje,
  root: string,
  prej: Zdruzitev | undefined,
  z: { id: string; vodja: VodjaNaloge; omejeno?: boolean },
  diff: string,
  nastavljeni?: readonly string[][],
): Promise<IzidZdruzitve> {
  const zd: Zdruzitev = prej ? { ...prej, naloge: [...prej.naloge] } : await novaZdruzitev(d, root, z.vodja.projekt, z.vodja.git);
  if (zd.git !== z.vodja.git) throw new Error("zdruzitev: git in kopija mape se ne mesata");
  if (z.omejeno) zd.omejeno = true;
  if (zd.omejeno && !d.peskovnik) return { izid: "brez-peskovnika", zd, izpis: "" };
  // brez meje pomnilnika se ne zdruzi (preizkusov ni mogoce varno pognati)
  const ukazi = await ukaziPreizkusov(d, zd.pot, nastavljeni);
  if (ukazi.some((a) => ukazZMejo(d.najdi, d.platforma, a) === null)) return { izid: "brez-meje", zd, izpis: "" };
  if (zd.git) {
    await preveriWorktree(zd.projekt, zd.pot);
    // prekinjen prejsnji poskus (ponovni zagon Line): nazaj na zadnjo uspelo zdruzitev
    await git(d, zd.pot, ["merge", "--abort"]);
    await gitOk(d, zd.pot, ["reset", "-q", "--hard", zd.glava]);
    // natanko pregledani commit (agent je lahko po pregledu na veji se kaj zapisal)
    if (!jeCommit(z.vodja.glava)) throw new Error("zdruzitev: ni pregledanega commita");
    const m = await git(d, zd.pot, ["merge", "--no-ff", "--no-edit", "-m", `Lina: zdruzi nalogo ${z.id}`, z.vodja.glava]);
    if (m.koda !== 0) {
      await git(d, zd.pot, ["merge", "--abort"]);
      return { izid: "spor", zd, izpis: m.izpis };
    }
    const p = await preizkusi(d, zd.pot, ukazi, zd.omejeno);
    if (p.izid !== "ok") {
      await gitOk(d, zd.pot, ["reset", "-q", "--hard", zd.glava]);
      return { izid: p.izid, zd, izpis: p.izpis };
    }
    zd.glava = await gitOk(d, zd.pot, ["rev-parse", "HEAD"]);
  } else {
    const prog = d.najdi("patch");
    if (!prog) throw new Error("patch ni na voljo");
    // zdruzi se natanko pregledani diff (zgostitev ob pregledu)
    if (!z.vodja.diff || (await shaDatoteke(diff)).sha !== z.vodja.diff) throw new Error("zdruzitev: diff ni pregledani");
    const nova = path.join(path.dirname(zd.pot), String(zd.n + 1) + "-" + randomBytes(3).toString("hex"));
    await kopirajMapo(zd.pot, nova);
    await poveziOdvisnosti(zd.projekt, nova);
    const r = await d.izvedi(prog, ["-p1", "--forward", "--batch", "--no-backup-if-mismatch", "-r", "-", "-d", nova, "-i", diff], {
      cwd: path.dirname(nova),
      rokMs: ROK_GIT_MS,
      okolje: d.okolje,
    });
    if (r.koda !== 0) return { izid: "spor", zd, izpis: r.izpis };
    const p = await preizkusi(d, nova, ukazi, zd.omejeno);
    if (p.izid !== "ok") return { izid: p.izid, zd, izpis: p.izpis };
    zd.pot = nova;
    zd.n += 1;
  }
  zd.naloge.push(z.id);
  const dz = await diffZdruzitve(d, root, zd);
  zd.diff = dz.pot;
  zd.zgostitev = dz.zgostitev;
  return { izid: "ok", zd, izpis: "" };
}

/**
 * Izvirnik je sel NAPREJ (nov commit, stara osnova je njegov prednik): git merge --no-ff izvirnika v worktree zdruzitve, preizkusi z mejo,
 * nova osnova in zgostitev (lastnik potrdi znova). Vrnitev izvirnika na starejsi commit ali razhajanje -> »vrnjen« (lastnik odloci; Lina
 * lastnikove vrnitve ne povozi). Izvirnik se tu ne spremeni.
 */
export async function osveziZIzvirnikom(d: DepsVodje, root: string, prej: Zdruzitev, nastavljeni?: readonly string[][]): Promise<IzidZdruzitve> {
  const zd: Zdruzitev = { ...prej, naloge: [...prej.naloge] };
  if (!zd.git) return { izid: "spor", zd, izpis: "brez gita" };
  const glava = await gitOk(d, zd.projekt, ["rev-parse", "--verify", "HEAD"]);
  if (glava === zd.osnova) return { izid: "ok", zd, izpis: "" };
  const naprej = await git(d, zd.projekt, ["merge-base", "--is-ancestor", zd.osnova, glava]);
  if (naprej.koda !== 0) return { izid: "spor", zd: { ...zd, razlog: "vrnjen" }, izpis: "" };
  const ukazi = await ukaziPreizkusov(d, zd.pot, nastavljeni);
  if (ukazi.some((a) => ukazZMejo(d.najdi, d.platforma, a) === null)) return { izid: "brez-meje", zd, izpis: "" };
  await preveriWorktree(zd.projekt, zd.pot);
  await git(d, zd.pot, ["merge", "--abort"]);
  await gitOk(d, zd.pot, ["reset", "-q", "--hard", zd.glava]);
  const m = await git(d, zd.pot, ["merge", "--no-ff", "--no-edit", "-m", "Lina: posodobitev z izvirnikom", glava]);
  if (m.koda !== 0) {
    await git(d, zd.pot, ["merge", "--abort"]);
    return { izid: "spor", zd, izpis: m.napaka || m.izpis };
  }
  const p = await preizkusi(d, zd.pot, ukazi, zd.omejeno);
  if (p.izid !== "ok") {
    await gitOk(d, zd.pot, ["reset", "-q", "--hard", zd.glava]);
    return { izid: p.izid, zd, izpis: p.izpis };
  }
  zd.glava = await gitOk(d, zd.pot, ["rev-parse", "HEAD"]);
  zd.osnova = glava;
  const dz = await diffZdruzitve(d, root, zd);
  zd.diff = dz.pot;
  zd.zgostitev = dz.zgostitev;
  return { izid: "ok", zd, izpis: "" };
}

/**
 * Spor brez gita: nova osnova in delo iz trenutne zdruzitve, diff naloge zraven (v .lina-naloge, ki ni v diffu). Agent vnese
 * spremembe rocno; naslednji diff je od nove osnove.
 */
export async function pripraviSporMape(root: string, id: string, zd: Zdruzitev, diff: string): Promise<{ kopija: string; osnova: string; vir: string }> {
  const oznaka = randomBytes(3).toString("hex");
  const mapa = path.join(root, MAPA_DELA, id);
  const osnova = path.join(mapa, `osnova-${oznaka}`);
  const kopija = path.join(mapa, `delo-${oznaka}`);
  await kopirajMapo(zd.pot, osnova);
  await kopirajMapo(zd.pot, kopija);
  await poveziOdvisnosti(zd.projekt, kopija);
  await mkdir(path.join(kopija, MAPA_NALOG), { mode: 0o700 });
  const vir = `${MAPA_NALOG}/spor-${id}.diff`;
  await copyFile(diff, path.join(kopija, vir));
  return { kopija, osnova, vir };
}

/**
 * Uveljavitev v izvirniku (lastnikov gumb »Uveljavi«): zgostitev mora ustrezati SVEZE izracunanemu diffu zdruzitve. git: izvirnik mora
 * biti na osnovi zdruzitve brez sprememb sledenih datotek; varnostna veja lina/varnost-<id>, nato merge --ff-only. Sicer: varnostna
 * kopija izvirnika v <podatki>/delo/varnostne/, patch --dry-run in sele nato patch. Napaka: "zgostitev" ali "izvirnik".
 */
export async function uveljavi(d: DepsVodje, root: string, zd: Zdruzitev, zgostitev: string): Promise<void> {
  if (zd.git) {
    // N1: nevarna nastavitev izvirnika ali zamenjan worktree zdruzitve -> nic se ne izvede
    await preveriNastavitve(d, zd.projekt);
    await preveriWorktree(zd.projekt, zd.pot);
  }
  const sveza = await diffZdruzitve(d, root, zd);
  if (sveza.zgostitev !== zgostitev || zd.zgostitev !== zgostitev) throw new Error("zgostitev");
  if (zd.git) {
    // tocka 8: vsak vzrok svoje sporocilo (premaknjen -> osvezitev; veja, umazan -> lastnik dobi besedilo in izhod), nikoli ista zavrnitev v krogu
    if (!jeCommit(zd.glava)) throw new Error("izvirnik: veja");
    const glava = await gitOk(d, zd.projekt, ["rev-parse", "--verify", "HEAD"]).catch(() => "");
    if (glava !== zd.osnova) throw new Error("izvirnik: premaknjen");
    const status = await git(d, zd.projekt, ["status", "--porcelain", "--untracked-files=no"]);
    if (status.koda !== 0 || status.izpis.trim() !== "") throw new Error("izvirnik: umazan");
    // N2: veja zdruzitve mora biti se na pregledanem commitu (agent bi jo lahko premaknil); zdruzi se natanko zd.glava, ne veja
    const veja = await gitOk(d, zd.projekt, ["rev-parse", "--verify", "-q", `refs/heads/${zd.veja}^{commit}`]).catch(() => "");
    if (veja !== zd.glava) throw new Error("izvirnik: veja");
    await gitOk(d, zd.projekt, ["branch", `lina/varnost-${zd.id}`, glava]).catch(() => undefined);
    const m = await git(d, zd.projekt, ["merge", "--ff-only", "-q", zd.glava]);
    if (m.koda !== 0) throw new Error("izvirnik: patch");
    return;
  }
  const prog = d.najdi("patch");
  const dprog = d.najdi("diff");
  if (!prog || !dprog || !zd.diff || !vDelu(root, zd.osnova)) throw new Error("izvirnik: patch");
  // N6: izvirnik mora biti enak posnetku osnove (lastnik ga je vmes spremenil -> »izvirnik«, nikoli patch z zamikom na nepreizkuseno stanje)
  const enak = await d.izvedi(dprog, ["-rq", "--no-dereference", ...[...IZPUSCENO].flatMap((x) => ["-x", x]), zd.osnova, zd.projekt], {
    cwd: root, rokMs: ROK_GIT_MS, okolje: d.okolje,
  });
  if (enak.koda !== 0) throw new Error("izvirnik: spremenjen");
  const varnostna = path.join(root, MAPA_DELA, "varnostne", `${new Date().toISOString().replace(/[:.]/g, "-")}-${zd.id}`);
  await mkdir(path.dirname(varnostna), { recursive: true, mode: 0o700 });
  await kopirajMapo(zd.projekt, varnostna);
  const args = ["-p1", "-F0", "--forward", "--batch", "--no-backup-if-mismatch", "-r", "-", "-d", zd.projekt, "-i", sveza.pot];
  const suho = await d.izvedi(prog, ["--dry-run", ...args], { cwd: root, rokMs: ROK_GIT_MS, okolje: d.okolje });
  if (suho.koda !== 0) throw new Error("izvirnik: patch");
  const r = await d.izvedi(prog, args, { cwd: root, rokMs: ROK_GIT_MS, okolje: d.okolje });
  if (r.koda !== 0) throw new Error("izvirnik: patch");
}

/**
 * Tocka 8, izhod »prenesi kot popravek za rocni pregled«: natanko diff zdruzitve (pregledana vsebina, sveze izracunan in preverjen z
 * zgostitvijo) v <podatki>/delo/izvoz/<id>-<cas>.diff (0600, nikoli prepis). Izvirnik se ne spremeni; lastnik ga uveljavi sam.
 */
export async function izvoziZdruzitev(root: string, zd: Zdruzitev): Promise<string> {
  if (!zd.diff || !vDelu(root, zd.diff) || !zd.zgostitev) throw new Error("izvoz: ni diffa");
  if (zgostitevUveljavitve(zd.projekt, zd.osnova, (await shaDatoteke(zd.diff)).sha) !== zd.zgostitev) throw new Error("zgostitev");
  const mapa = path.join(root, MAPA_DELA, "izvoz");
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const pot = path.join(mapa, `${zd.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.diff`);
  await copyFile(zd.diff, pot, constants.COPYFILE_EXCL);
  await chmod(pot, 0o600);
  return pot;
}

/** Zdruzitev iz zapisa stanja (Linin, a poti se preverijo). */
export function jeZdruzitev(v: unknown, root: string): v is Zdruzitev {
  const z = v as Partial<Zdruzitev> | null;
  return (
    !!z &&
    typeof z === "object" &&
    typeof z.id === "string" &&
    /^[a-f0-9]{12}$/.test(z.id) &&
    typeof z.projekt === "string" &&
    path.isAbsolute(z.projekt) &&
    typeof z.git === "boolean" &&
    vDelu(root, z.pot) &&
    (z.git ? jeCommit(z.osnova) && jeCommit(z.glava) && typeof z.veja === "string" && /^lina\/zdruzitev-[a-f0-9]{12}$/.test(z.veja) : vDelu(root, z.osnova) && z.glava === "") &&
    Array.isArray(z.naloge) &&
    z.naloge.every((x) => typeof x === "string") &&
    typeof z.n === "number" &&
    (z.omejeno === undefined || typeof z.omejeno === "boolean")
  );
}
