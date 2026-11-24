/**
 * Lina odpre Claude Code na racunalniku z nalogo (lastnik 23. 11. 2026; AGENTS.md »Lina sama odpre Claude Code na racunalniku«).
 * Potek: predlog (lastnik v zavihku Racunalnik ali Lina z oznako v pogovoru) -> lastnik vidi mapo in CELO besedilo -> potrdi ->
 * Lina zapise <mapa>/.lina-naloge/<id>/NALOGA.md (nova mapa, nikoli prepis) in odpre terminal z ukazom `claude` in stalnim
 * pozivom (samo id). Porocilo POROCILO.md iz iste mape se pokaze v zavihku Racunalnik kot besedilo.
 * Vsak javni ukaz zahteva sejo lastnika (requireOwner); brez gesla (lokalna seja brez prijave) sta priprava in zagon zavrnjena.
 * Brez sudo, brez --dangerously-*, brez lupine (argv, cwd = mapa). Tajnica (klici) te datoteke ne uvaza (claude-naloge.test.ts).
 *
 * Lina vodi vse agente (lastnik 24. 11. 2026): isti mehanizem za agente s seznama AGENTI (zaznani in preverjeni z zagonom brez okna),
 * prepovedane mape za Gemini/Google agente, vrsta vnaprej dodeljenih nalog (dodelitev = potrditev za en zagon, zgostitev se ob zagonu
 * preveri) z razporejevalnikom, ocena trajanja iz zgodovine, lasten opomnik in dogodek »naloga koncana« (agenti-naloge.test.ts).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants, accessSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ownerExists, requireOwner } from "./auth.server.ts";
import {
  AGENTI,
  ClaudeNalogaNapaka,
  DATOTEKA_NALOGE,
  DATOTEKA_POROCILA,
  MAPA_NALOG,
  NAJVEC_BAJTOV_POROCILA,
  NAJVEC_CAKAJOCIH,
  NAJVEC_CAKAJOCIH_LINE,
  NAJVEC_HKRATNIH,
  NAJVEC_ZNAKOV_NALOGE_LINE,
  NAJVEC_ZNAKOV_POTI,
  NI_PRIJAVLJEN,
  OPIS_AGENTOV,
  argvAgenta,
  dogodekKoncana,
  imaNevidne,
  jeAgent,
  jeIdNaloge,
  jePotekel,
  naslednjiOpomnik,
  ocenaTrajanja,
  ocistiBesediloNaloge,
  obreziZgodovino,
  ocistiPorocilo,
  pogojIzOznake,
  pozivZaClaude,
  preveriMapo,
  razberiPogoj,
  razlogDovoljeneMape,
  razpored,
  stejeMedHkratne,
  terminalZaseda,
  vPrepovedani,
  vsebinaNaloge,
  zgostitevNaloge,
  type AgentId,
  type DogodekNalogaKoncana,
  type IzvorNaloge,
  type Opomnik,
  type Pogoj,
  type RazlogNaloge,
  type StanjeNaloge,
  type ZapisNaloge,
} from "./claude-naloge.ts";
import { opozoriloPotrjeno } from "./opozorilo.server.ts";
import { platformaZdaj, ukazTerminala, type Platforma } from "./platforma.server.ts";
import { jeNovProjekt, sestaviPregledProjekta } from "./pregled-projekta.server.ts";
import { kazaloZaProjekt, zapisiOpazanjeNaloge } from "./spomin-nalog.server.ts";
import { resolveDataDir } from "./store.server.ts";
import { casZagonaProcesa } from "./tunel.server.ts";

export type { DogodekNalogaKoncana } from "./claude-naloge.ts";

export const DATOTEKA_STANJA = "claude-naloge.json";
const NAJVEC_MAP = 10;
const NAJVEC_PREPOVEDANIH = 20;
/** Najvec dodeljenih nalog, ki cakajo pogoj (vrsta ne raste brez meje). */
const NAJVEC_DODELJENIH = 20;

type Stanje = {
  v: 1;
  mape: string[];
  naloge: ZapisNaloge[];
  /** Stikala agentov; manjkajoc = vklopljen (lastnikova ideja: privzeto vklopljeno). */
  agenti?: Partial<Record<AgentId, boolean>>;
  /** Prepovedane mape za agente z omejenimi mapami (opencode, agy); shranjene dobesedno, preverjene po zapisu IN po realpath. */
  prepovedane?: string[];
};

/** Zagon terminala; vrne PID, ce proces terminala po zagonu se zivi (za stetje hkratnih, N5). */
export type Zagon = (program: string, args: readonly string[], cwd: string, okolje: NodeJS.ProcessEnv) => Promise<number | void>;

/** Zagon agenta brez okna (--version, preverba prijave) z rokom; po roku je cela skupina procesov ubita. */
export type IzidPreverbe = { koda: number | null; izpis: string; potekel: boolean };
export type PreverbaZagona = (program: string, args: readonly string[], rokMs: number) => Promise<IzidPreverbe>;

/**
 * Agent ne dobi skrivnosti Line ne drugih kljucev procesa (skil lina-ukazi-agentom; drugi pregled 0.2.10, N6): SEZNAM DOVOLJENIH spremenljivk
 * (pot, dom, jezik, zaslon, seja namizja), vse drugo (ANTHROPIC_*, OPENAI_*, AWS_*, GITHUB_TOKEN, SSH_AUTH_SOCK, TWILIO_*, LINA_* ...) ostane zunaj.
 * Claude Code uporabi svojo prijavo (~/.claude), ne kljuca iz okolja Line.
 */
const DOVOLJENO_OKOLJE = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z]+|TERM|COLORTERM|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_[A-Z_]+|DBUS_SESSION_BUS_ADDRESS|TMPDIR|TZ)$/;
export function okoljeZaAgenta(okolje: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(okolje).filter(([k]) => DOVOLJENO_OKOLJE.test(k)));
}

export type Odvisnosti = {
  dom?: string;
  najdi?: (ime: string) => string | null;
  /** Razresi simbolne povezave programa (x-terminal-emulator, N7); privzeto realpath. */
  razresi?: (pot: string) => string;
  zazeni?: Zagon;
  platforma?: Platforma;
  /** Cas zagona procesa (preizkusi); privzeto /proc/<pid>/stat polje 22, brez /proc (Windows) null. */
  casZagona?: (pid: number) => string | null;
  /** Preverba zagona agenta brez okna; privzeto privzetaPreverba. */
  preveriZagon?: PreverbaZagona;
  /** Cas zagona Line (razporejevalnik: kar je zamujeno pred njim, potrebuje novo potrditev); privzeto zagon tega procesa. */
  zagonLine?: Date;
};

export type JavnaNaloga = {
  id: string;
  izvor: IzvorNaloge;
  agent: AgentId;
  mapa: string;
  besedilo: string;
  zgostitev: string;
  stanje: StanjeNaloge;
  ustvarjeno: string;
  potrjeno: string | null;
  razlog: RazlogNaloge | null;
  porocilo: string | null;
  pogoj: Pogoj | null;
  ocena: { konec: string; groba: boolean } | null;
  opomnik: Opomnik | null;
  koncano: string | null;
};

export type StanjeAgenta = {
  id: AgentId;
  ime: string;
  pot: string | null;
  /** pripravljen = zaznan in zagon brez okna je uspel; samo tak agent je v izbiri. */
  stanje: "pripravljen" | "ni-najden" | "ne-deluje" | "prijava" | "izklopljen";
  razlicica: string;
  vklopljen: boolean;
  kanal: boolean;
  zacetniPoziv: boolean;
  omejeneMape: boolean;
};

export type JavnoStanjeNalog = {
  naVoljo: boolean;
  razlogNiNaVoljo: RazlogNaloge | null;
  geslo: boolean;
  mape: string[];
  naloge: JavnaNaloga[];
  agenti: StanjeAgenta[];
  prepovedane: string[];
};

/** Program na PATH (izvedljiva datoteka) ali null. */
export function najdiNaPoti(ime: string, okolje: NodeJS.ProcessEnv = process.env): string | null {
  for (const mapa of (okolje.PATH ?? "").split(path.delimiter)) {
    if (!mapa || !path.isAbsolute(mapa)) continue;
    const pot = path.join(mapa, ime);
    try {
      accessSync(pot, constants.X_OK);
      return pot;
    } catch {
      /* ni tu */
    }
  }
  return null;
}

/** Cas po zagonu, v katerem terminal, ki se konca z napako (npr. brez zaslona), pomeni neuspel zagon (CodeRabbit). */
const ROK_ZAGONA_MS = 1500;

/**
 * Privzeti zagon: brez lupine, odklopljen, brez stdio. Napaka je ENOENT ipd. ALI izhod terminala z napako (koda razlicna od 0 ali signal) v
 * ROK_ZAGONA_MS (CodeRabbit: terminal brez zaslona se zazene in takoj konca). Izhod s kodo 0 v tem casu je veljaven (gnome-terminal preda
 * okno strezniku in se konca); takrat PID ni znan. Sicer vrne PID.
 * shortcut: terminal, ki se konca s kodo 0, ceprav Claude Code ni zagnan, ostane »tece« do porocila ali roka 2 h; potrditev zagona bi potrebovala ovoj okoli claude.
 */
const privzetiZagon: Zagon = (program, args, cwd, okolje) =>
  new Promise((razresi, zavrni) => {
    const otrok = spawn(program, [...args], { cwd, env: okolje, detached: true, stdio: "ignore", windowsHide: true, shell: false });
    let rok: ReturnType<typeof setTimeout> | undefined;
    otrok.once("error", (e) => {
      clearTimeout(rok);
      zavrni(e);
    });
    otrok.once("spawn", () => {
      rok = setTimeout(() => {
        otrok.removeAllListeners("exit");
        otrok.unref();
        razresi(otrok.pid);
      }, ROK_ZAGONA_MS);
      otrok.once("exit", (koda, signal) => {
        clearTimeout(rok);
        if (koda === 0) razresi();
        else zavrni(new Error(`terminal se je koncal (${koda ?? signal})`));
      });
    });
  });

const NAJVEC_IZPISA_PREVERBE = 4096;
const ROK_PREVERBE_MS = 8000;

/**
 * Preverba zagona brez okna (vodja 24. 11. 03:15: »agent se pokaze samo po uspesni preverbi zagona brez okna«): program dobi okolje agenta
 * BREZ DISPLAY in WAYLAND_DISPLAY (namizni program ne odpre okna), odklopljen v svoji skupini procesov, izpis omejen. Po roku je ubita
 * CELA skupina s SIGKILL (24. 11.: `timeout` freebuffa ni ustavil, ker je program ignoriral SIGTERM in imel otroke).
 */
export const privzetaPreverba: PreverbaZagona = (program, args, rokMs) =>
  new Promise((razresi) => {
    const okolje = okoljeZaAgenta();
    delete okolje.DISPLAY;
    delete okolje.WAYLAND_DISPLAY;
    let izpis = "";
    let potekel = false;
    let koncano = false;
    const konec = (koda: number | null) => {
      if (koncano) return;
      koncano = true;
      clearTimeout(rok);
      clearTimeout(varovalo);
      razresi({ koda, izpis: izpis.slice(0, NAJVEC_IZPISA_PREVERBE), potekel });
    };
    const otrok = spawn(program, [...args], { env: okolje, detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    const beri = (k: Buffer) => {
      if (izpis.length < NAJVEC_IZPISA_PREVERBE) izpis += k.toString("utf8");
    };
    otrok.stdout?.on("data", beri);
    otrok.stderr?.on("data", beri);
    const rok = setTimeout(() => {
      potekel = true;
      try {
        process.kill(-(otrok.pid as number), "SIGKILL");
      } catch {
        otrok.kill("SIGKILL");
      }
    }, rokMs);
    // ce bi kak potomec obdrzal cevi odprte, preverba vseeno konca
    const varovalo = setTimeout(() => konec(null), rokMs + 2000);
    otrok.once("error", () => konec(null));
    otrok.once("close", (koda) => konec(potekel ? null : koda));
  });

/**
 * Ali proces terminala naloge se zivi (EPERM = zivi, a tuj). Pregled 0225 B8: ce je ob zagonu zapisan cas zagona procesa, mora biti
 * enak, sicer je PID ponovno uporabljen (drug proces) in naloga mesta ne zaseda vec. Brez zapisanega casa (Windows nima /proc, star
 * zapis) ostane prejsnje vedenje: ziv PID zaseda mesto do roka.
 */
function zivi(z: ZapisNaloge, casZagona: (pid: number) => string | null): boolean {
  const pid = z.pid;
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  return !z.pidZagon || casZagona(pid as number) === z.pidZagon;
}

/** Kanonicna pot ali null, ce je ni. */
async function kanonicna(p: string): Promise<string | null> {
  return realpath(p).catch(() => null);
}

const vrste = new Map<string, Promise<unknown>>();
// shortcut: zaporedje samo v tem procesu (Lina tece kot en proces); ce bi stanje pisalo vec procesov, uporabi kljucavnico kot avtonomija-stanje.
function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.then(delo, delo);
  vrste.set(root, zdaj.catch(() => undefined));
  return zdaj;
}

async function preberi(root: string): Promise<Stanje> {
  try {
    const s = JSON.parse(await readFile(path.join(root, DATOTEKA_STANJA), "utf8")) as Partial<Stanje>;
    const agenti: Partial<Record<AgentId, boolean>> = {};
    if (s.agenti && typeof s.agenti === "object") for (const a of AGENTI) if (typeof s.agenti[a] === "boolean") agenti[a] = s.agenti[a];
    return {
      v: 1,
      mape: Array.isArray(s.mape) ? s.mape.filter((m): m is string => typeof m === "string" && path.isAbsolute(m)).slice(0, NAJVEC_MAP) : [],
      naloge: Array.isArray(s.naloge) ? obreziZgodovino(s.naloge.filter((n) => n && jeIdNaloge(n.id)), new Date()) : [],
      agenti,
      prepovedane: Array.isArray(s.prepovedane) ? s.prepovedane.filter((m): m is string => typeof m === "string" && path.isAbsolute(m)).slice(0, NAJVEC_PREPOVEDANIH) : [],
    };
  } catch {
    return { v: 1, mape: [], naloge: [], agenti: {}, prepovedane: [] };
  }
}

async function zapisi(root: string, s: Stanje): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const cilj = path.join(root, DATOTEKA_STANJA);
  const zacasna = `${cilj}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(zacasna, JSON.stringify(s, null, 2), { mode: 0o600, flag: "wx" });
  await rename(zacasna, cilj);
}

function meje(root: string, s: Stanje, o: Odvisnosti) {
  return { dom: o.dom ?? homedir(), dovoljene: s.mape, podatki: root };
}

function pricakuj(izid: { mapa: string } | { razlog: RazlogNaloge }): string {
  if ("razlog" in izid) throw new ClaudeNalogaNapaka(izid.razlog);
  return izid.mapa;
}

/** Resnicna pot (razresene simbolne povezave) mora prestati isto preverbo; dom in mape tudi po realpath. */
async function resnicnaMapa(mapa: string, root: string, s: Stanje, o: Odvisnosti): Promise<string> {
  let prava: string;
  try {
    prava = await realpath(mapa);
    if (!(await lstat(prava)).isDirectory()) throw new Error();
  } catch {
    throw new ClaudeNalogaNapaka("mapa-ni");
  }
  const m = meje(root, s, o);
  const realno = async (p: string) => realpath(p).catch(() => p);
  const dom = await realno(m.dom);
  const podatki = await realno(root);
  // Omejitve dovoljenih map veljajo za KANONICNO pot (CodeRabbit): povezava, ki se razresi v koren diska ali sistemsko mapo, ni koren.
  const dovoljene: string[] = [];
  for (const d of m.dovoljene) {
    const k = await kanonicna(d);
    if (k && !razlogDovoljeneMape(k, dom, podatki)) dovoljene.push(k);
  }
  return pricakuj(preveriMapo(prava, { dom, dovoljene, podatki }));
}

/**
 * Prepovedane mape (pravilo lastnika: Gemini in Google agenti nikoli ne dobijo kode Scita, YouTuba ali Google prijave). Primerja se pot
 * naloge (kanonicna) s prepovedanimi po zapisu IN po realpath; neobstojeca prepovedana mapa ostane dobesedno (fail-closed: njena nadmapa je prepovedana).
 */
async function preveriPrepoved(agent: AgentId, mapa: string, s: Stanje): Promise<void> {
  if (!OPIS_AGENTOV[agent].omejeneMape || !s.prepovedane?.length) return;
  const seznam = [...s.prepovedane];
  for (const p of s.prepovedane) {
    const k = await kanonicna(p);
    if (k) seznam.push(k);
  }
  // mapa je ze kanonicna (resnicnaMapa); prepovedane se primerjajo dobesedno IN po realpath
  if (vPrepovedani(mapa, seznam)) throw new ClaudeNalogaNapaka("mapa-prepovedana");
  if (await povezavaVPrepovedano(mapa, seznam)) throw new ClaudeNalogaNapaka("mapa-povezava");
}

const GLOBINA_POVEZAV = 8;
const NAJVEC_VNOSOV_POVEZAV = 20_000;
/**
 * A4 (delno, brez peskovnika): simbolna povezava v projektni mapi, ki se razresi v prepovedano mapo (ali nad/pod njo). Povezavam se ne
 * sledi, node_modules se preskoci, visece povezave ne motijo.
 * shortcut: globina 8 in 20 000 vnosov; vecji projekt se zavrne (fail-closed), dokler ni peskovnika (bubblewrap/landlock).
 */
async function povezavaVPrepovedano(koren: string, prepovedane: readonly string[]): Promise<boolean> {
  let vnosov = 0;
  const vrsta: { mapa: string; globina: number }[] = [{ mapa: koren, globina: 0 }];
  while (vrsta.length) {
    const { mapa, globina } = vrsta.pop()!;
    const vnosi = await readdir(mapa, { withFileTypes: true }).catch(() => []);
    for (const v of vnosi) {
      if (++vnosov > NAJVEC_VNOSOV_POVEZAV) return true;
      const pot = path.join(mapa, v.name);
      if (v.isSymbolicLink()) {
        const cilj = await kanonicna(pot);
        const dobesedno = await readlink(pot).then((l) => path.resolve(mapa, l)).catch(() => null);
        if ((cilj && vPrepovedani(cilj, prepovedane)) || (dobesedno && vPrepovedani(dobesedno, prepovedane))) return true;
      } else if (v.isDirectory() && v.name !== "node_modules" && globina < GLOBINA_POVEZAV) {
        vrsta.push({ mapa: pot, globina: globina + 1 });
      }
    }
  }
  return false;
}

/**
 * Mapa naloge in porocilo: brez sledenja simbolnim povezavam (agent bi lahko povezavo podtaknil namesto porocila). Drugi pregled 0.2.10:
 * odpiranje brez blokiranja (O_NONBLOCK: cev brez pisca ne ustavi stanja in vrste, CodeRabbit), samo navadna datoteka z ENO povezavo
 * (trda povezava na tujo datoteko, N4) in istim lastnikom kot Lina; mapa naloge mora biti ista kot ob zagonu (dev:ino).
 * shortcut: med preverbo mape in odprtjem ostane kratko okno (Node nima openat); agent ima tako ali tako dostop do istih datotek.
 */
async function preberiPorocilo(z: ZapisNaloge): Promise<{ besedilo: string; cas: string } | null> {
  const mapaNalog = path.join(z.mapa, MAPA_NALOG);
  const mapaNaloge = path.join(mapaNalog, z.id);
  try {
    for (const p of [mapaNalog, mapaNaloge]) if (!(await lstat(p)).isDirectory()) return null;
    if (z.mapaId && z.mapaId !== (await idMape(mapaNaloge))) return null;
    const ds = await open(path.join(mapaNaloge, DATOTEKA_POROCILA), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const st = await ds.stat();
      if (!st.isFile() || st.nlink !== 1) return null;
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) return null;
      const buf = Buffer.alloc(Math.min(st.size, NAJVEC_BAJTOV_POROCILA));
      const { bytesRead } = await ds.read(buf, 0, buf.length, 0);
      return { besedilo: ocistiPorocilo(buf.subarray(0, bytesRead).toString("utf8")), cas: st.mtime.toISOString() };
    } finally {
      await ds.close();
    }
  } catch {
    return null;
  }
}

/** dev:ino mape (N4). */
async function idMape(p: string): Promise<string> {
  const st = await lstat(p, { bigint: true });
  return `${st.dev}:${st.ino}`;
}

function razlogTerminala(o: Odvisnosti): RazlogNaloge | null {
  const t = ukazTerminala(o.najdi ?? ((ime: string) => najdiNaPoti(ime)), o.platforma ?? platformaZdaj(), o.razresi);
  return "razlog" in t ? t.razlog : null;
}

// ------------------------------------------------------------------ zaznava in preverba agentov

const ROK_PREDPOMNILNIKA_MS = 10 * 60_000;
type Preverjen = { pot: string; stanje: StanjeAgenta["stanje"]; razlicica: string; do: number };
/** Predpomnilnik preverb na preverbo (preizkusi vbrizgajo svojo); osvezi ga ukaz »preveri-agente«. */
const predpomnilnik = new WeakMap<PreverbaZagona, Map<AgentId, Preverjen>>();

async function preveriAgenta(id: AgentId, pot: string, preveri: PreverbaZagona): Promise<Omit<Preverjen, "do">> {
  const v = await preveri(pot, ["--version"], ROK_PREVERBE_MS);
  if (v.potekel || v.koda !== 0) return { pot, stanje: "ne-deluje", razlicica: "" };
  const razlicica = (v.izpis.split("\n")[0] ?? "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 60);
  const prijava = OPIS_AGENTOV[id].prijava;
  if (prijava) {
    const p = await preveri(pot, prijava, ROK_PREVERBE_MS);
    if (p.potekel || p.koda !== 0) return { pot, stanje: "ne-deluje", razlicica };
    if (NI_PRIJAVLJEN.test(p.izpis)) return { pot, stanje: "prijava", razlicica };
  }
  return { pot, stanje: "pripravljen", razlicica };
}

async function stanjeAgentov(s: Stanje, o: Odvisnosti, osvezi = false): Promise<StanjeAgenta[]> {
  const najdi = o.najdi ?? ((ime: string) => najdiNaPoti(ime));
  const preveri = o.preveriZagon ?? privzetaPreverba;
  let pomnilnik = predpomnilnik.get(preveri);
  if (!pomnilnik || osvezi) predpomnilnik.set(preveri, (pomnilnik = new Map()));
  const izid: StanjeAgenta[] = [];
  for (const id of AGENTI) {
    const opis = OPIS_AGENTOV[id];
    const pot = najdi(opis.program);
    const vklopljen = s.agenti?.[id] !== false;
    let p: Omit<Preverjen, "do"> | null = null;
    // A3: izklopljen agent se ne zaganja niti za preverbo (--version, prijava); preveri se ob vklopu
    if (pot && !vklopljen) p = { pot, stanje: "izklopljen", razlicica: "" };
    else if (pot) {
      const prej = pomnilnik.get(id);
      if (prej && prej.pot === pot && prej.do > Date.now()) p = prej;
      else {
        p = await preveriAgenta(id, pot, preveri);
        pomnilnik.set(id, { ...p, do: Date.now() + ROK_PREDPOMNILNIKA_MS });
      }
    }
    izid.push({
      id, ime: opis.ime, pot, stanje: p?.stanje ?? "ni-najden", razlicica: p?.razlicica ?? "", vklopljen,
      kanal: opis.kanal, zacetniPoziv: opis.zacetniPoziv, omejeneMape: opis.omejeneMape,
    });
  }
  return izid;
}

/** Agent, ki ga Lina sme zagnati z nalogo: vklopljen, preverjen in z zacetnim pozivom. Vrne pot programa. */
async function agentZaNalogo(agent: AgentId, s: Stanje, o: Odvisnosti): Promise<string> {
  const a = (await stanjeAgentov(s, o)).find((x) => x.id === agent)!;
  if (!a.vklopljen) throw new ClaudeNalogaNapaka("agent-izklopljen");
  // claude: stara koda razloga (vmesnik in preizkusi pred 24. 11. 2026)
  if (a.stanje !== "pripravljen" || !a.pot) throw new ClaudeNalogaNapaka(agent === "claude" ? "ni-claude" : "agent-ni-pripravljen");
  if (!a.zacetniPoziv) throw new ClaudeNalogaNapaka("agent-brez-poziva");
  return a.pot;
}

// ------------------------------------------------------------------ zagon (potrditev in razporejevalnik)

/** Porocilo naloge; ko obstaja, gre (enkrat na nalogo, spomin-nalog) se v spomin nalog projekta. */
async function porociloVSpomin(root: string, z: ZapisNaloge): Promise<{ besedilo: string; cas: string } | null> {
  const p = await preberiPorocilo(z);
  if (p) await zapisiOpazanjeNaloge(root, { nalogaId: z.id, projekt: z.mapa, naloga: z.besedilo, porocilo: p.besedilo }).catch(() => undefined);
  return p;
}

async function steviloHkratnih(root: string, s: Stanje, o: Odvisnosti, zdaj: Date): Promise<number> {
  let n = 0;
  for (const z of s.naloge) if (stejeMedHkratne(z, (await porociloVSpomin(root, z)) !== null, zdaj, zivi(z, o.casZagona ?? casZagonaProcesa))) n++;
  return n;
}

/**
 * EN zagon potrjene ali dodeljene naloge (klice se samo znotraj vVrsti): ista meja hkratnih za potrditev in razporejevalnik. Pred zagonom
 * znova: zgostitev (besedilo, mapa, agent), agent vklopljen in preverjen, terminal, meja hkratnih, mapa po realpath, prepovedane mape.
 */
async function zazeniZapis(root: string, s: Stanje, z: ZapisNaloge, o: Odvisnosti, zdaj: Date): Promise<void> {
  const agent = z.agent ?? "claude";
  if (!jeAgent(agent) || zgostitevNaloge(z.mapa, z.besedilo, agent) !== z.zgostitev) throw new ClaudeNalogaNapaka("zgostitev");
  const razlog = razlogTerminala(o);
  if (razlog) throw new ClaudeNalogaNapaka(razlog);
  const program = await agentZaNalogo(agent, s, o);
  // Opozorilo ob prvem zagonu (lastnik 24. 11. 2026): brez potrditve »Razumem« Lina ne zazene nobenega agenta (tudi iz razporejevalnika).
  if (!(await opozoriloPotrjeno(root))) throw new ClaudeNalogaNapaka("opozorilo");
  if ((await steviloHkratnih(root, s, o, zdaj)) >= NAJVEC_HKRATNIH) throw new ClaudeNalogaNapaka("polno-hkratne");
  if ((await resnicnaMapa(z.mapa, root, s, o)) !== z.mapa) throw new ClaudeNalogaNapaka("mapa");
  await preveriPrepoved(agent, z.mapa, s);
  // A1: v isti mapi, nad- ali podmapi ze dela drug agent (ziv terminal ali neznan PID do roka) - ne hkrati na istih datotekah
  const casZagona = o.casZagona ?? casZagonaProcesa;
  if (s.naloge.some((n) => n !== z && vPrepovedani(z.mapa, [n.mapa]) && terminalZaseda(n, zivi(n, casZagona), zdaj))) {
    throw new ClaudeNalogaNapaka("mapa-zasedena");
  }

  const pregledProjekta = jeNovProjekt(s.naloge, z.mapa, z.id)
    ? await sestaviPregledProjekta(z.mapa, { dir: root }).catch(() => "")
    : "";
  const spominKazalo = await kazaloZaProjekt(root, z.mapa, { poizvedba: z.besedilo }).catch(() => "");

  // Nova mapa naloge; obstojeca (ali simbolna povezava) se ne uporabi. NALOGA.md samo z »wx« (nikoli prepis).
  const mapaNalog = path.join(z.mapa, MAPA_NALOG);
  await mkdir(mapaNalog, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e;
  });
  if (!(await lstat(mapaNalog)).isDirectory()) throw new ClaudeNalogaNapaka("naloga-obstaja");
  const mapaNaloge = path.join(mapaNalog, z.id);
  try {
    await mkdir(mapaNaloge, { mode: 0o700 });
    await writeFile(path.join(mapaNaloge, DATOTEKA_NALOGE), vsebinaNaloge(z, zdaj, { pregledProjekta, spominKazalo }), { mode: 0o600, flag: "wx" });
  } catch {
    throw new ClaudeNalogaNapaka("naloga-obstaja");
  }

  const najdi = o.najdi ?? ((ime: string) => najdiNaPoti(ime));
  const terminal = ukazTerminala(najdi, o.platforma ?? platformaZdaj(), o.razresi);
  const argv = argvAgenta(agent, pozivZaClaude(z.id));
  if ("razlog" in terminal || !argv) throw new ClaudeNalogaNapaka("ni-terminala");
  z.potrjeno = zdaj.toISOString();
  z.mapaId = await idMape(mapaNaloge);
  const ocena = ocenaTrajanja(s.naloge, agent, z.besedilo.length);
  const konec = new Date(zdaj.getTime() + ocena.ms).toISOString();
  z.ocena = { konec, groba: ocena.groba };
  // lasten opomnik ob oceni konca (AGENTS.md »Lina kot vodja«); razporejevalnik ga ob preteku preveri in po potrebi nastavi novega
  z.opomnik = { cas: konec, razlog: null, krog: 0 };
  // Rezervacija PRED zagonom (CodeRabbit): ce zapis po zagonu ne uspe, ostane »zaganja« - ni drugega zagona, mesto je zasedeno, porocilo se bere.
  z.stanje = "zaganja";
  z.razlog = null;
  await zapisi(root, s);
  try {
    const pid = await (o.zazeni ?? privzetiZagon)(terminal.program, [...terminal.predpona, program, ...argv], z.mapa, okoljeZaAgenta());
    z.stanje = "tece";
    if (typeof pid === "number") {
      z.pid = pid;
      z.pidZagon = (o.casZagona ?? casZagonaProcesa)(pid) ?? undefined;
    }
  } catch {
    z.stanje = "napaka";
    z.razlog = "zagon";
  }
  await zapisi(root, s);
}

// ------------------------------------------------------------------ dogodek »naloga koncana«

const poslusalci = new Set<(d: DogodekNalogaKoncana) => void>();
/** Narocnina na »naloga koncana« (pregled in zdruzitev dela vec agentov ga bosta uporabila); vrne odjavo. Dogodek pride natanko enkrat. */
export function obNalogaKoncana(fn: (d: DogodekNalogaKoncana) => void): () => void {
  poslusalci.add(fn);
  return () => {
    poslusalci.delete(fn);
  };
}

// ------------------------------------------------------------------ razporejevalnik

const ZAGON_PROCESA = new Date();

/**
 * En korak razporejevalnika (casovnik v strezniku, zazeniRazporejevalnik): (1) tekoce naloge s porocilom, katerih terminal ne dela vec ->
 * koncano (cas opazanja, dogodek enkrat; A2); sicer ob opomniku nov opomnik z novo uro in razlogom; (2) dodeljene po razpored(): zagon,
 * zamujeno ali neuspelo. Polna meja hkratnih ali zasedena mapa (A1) pusti nalogo dodeljeno (sprozeno) za naslednji korak.
 */
export async function korakRazporejevalnika(dir: string | undefined, o: Odvisnosti = {}, zdaj = new Date()): Promise<void> {
  const root = resolveDataDir(dir);
  const koncane: DogodekNalogaKoncana[] = [];
  await vVrsti(root, async () => {
    const s = await preberi(root);
    const prej = JSON.stringify(s);
    for (const z of s.naloge) {
      if (z.stanje !== "tece" && z.stanje !== "zaganja") continue;
      const p = await porociloVSpomin(root, z);
      const ziv = zivi(z, o.casZagona ?? casZagonaProcesa);
      if (p && !terminalZaseda(z, ziv, zdaj)) {
        // A2: konec sele, ko je porocilo IN terminal ne dela (ziv PID ali neznan PID pred rokom). Cas = ko ga je razporejevalnik opazil,
        // nikoli mtime porocila (v rokah agenta: z njim bi premaknil zamujeno/zazeni ali skrcil oceno trajanja in s tem rok). Dogodek enkrat.
        const zeKoncana = z.koncano;
        z.stanje = "koncano";
        z.koncano = zdaj.toISOString();
        if (!zeKoncana) koncane.push(dogodekKoncana(z));
      } else if (z.opomnik && Date.parse(z.opomnik.cas) <= zdaj.getTime()) {
        z.opomnik = naslednjiOpomnik(z, zdaj, ziv);
      }
    }
    const r = razpored(s.naloge, zdaj, o.zagonLine ?? ZAGON_PROCESA);
    for (const z of s.naloge) {
      if (r.zamujeno.includes(z.id)) z.stanje = "zamujeno";
      if (r.neuspelo.includes(z.id)) {
        z.stanje = "napaka";
        z.razlog = "pogoj";
      }
    }
    if (JSON.stringify(s) !== prej) await zapisi(root, s);
    for (const id of r.zazeni) {
      const z = s.naloge.find((n) => n.id === id)!;
      z.sprozeno ??= zdaj.toISOString();
      try {
        await zazeniZapis(root, s, z, o, zdaj);
      } catch (e) {
        const razlog = e instanceof ClaudeNalogaNapaka ? e.razlog : "zagon";
        // polna meja ali zasedena mapa (A1): ostane »dodeljeno« in poskusi znova v naslednjem koraku
        if (razlog === "mapa-zasedena") z.razlog = razlog;
        else if (razlog !== "polno-hkratne") {
          z.stanje = "napaka";
          z.razlog = razlog;
        }
        await zapisi(root, s);
      }
    }
  });
  for (const d of koncane) for (const fn of poslusalci) {
    try {
      fn(d);
    } catch {
      /* poslusalec ne podre razporejevalnika */
    }
  }
}

const KLJUC_RAZPOREDA = Symbol.for("lina.agenti.razporejevalnik");
const KORAK_MS = 30_000;
/** Casovnik razporejevalnika (enkrat na proces; ob zagonu Line se zamujene naloge NE zazenejo - postanejo »zamujeno«). */
export function zazeniRazporejevalnik(dir?: string): void {
  const g = globalThis as { [KLJUC_RAZPOREDA]?: ReturnType<typeof setInterval> };
  if (g[KLJUC_RAZPOREDA]) return;
  const c = setInterval(() => void korakRazporejevalnika(dir).catch(() => undefined), KORAK_MS);
  c.unref?.();
  g[KLJUC_RAZPOREDA] = c;
}

// ------------------------------------------------------------------ javno stanje in ukazi

async function javno(root: string, s: Stanje, o: Odvisnosti, zdaj: Date): Promise<JavnoStanjeNalog> {
  const agenti = await stanjeAgentov(s, o);
  const terminal = razlogTerminala(o);
  // izklopljen Claude Code ne pomeni, da Lina nima agentov (A3)
  const claude = agenti.find((a) => a.id === "claude")!.stanje;
  const razlog = terminal ?? (claude === "pripravljen" || claude === "izklopljen" ? null : "ni-claude");
  const casZagona = o.casZagona ?? casZagonaProcesa;
  const naloge: JavnaNaloga[] = [];
  for (const z of [...s.naloge].reverse()) {
    const p = z.stanje === "tece" || z.stanje === "zaganja" || z.stanje === "koncano" ? await porociloVSpomin(root, z) : null;
    // A2: »koncano« samo, ko porocilo obstaja IN terminal ne dela (enako kot razporejevalnik)
    const dela = terminalZaseda(z, zivi(z, casZagona), zdaj);
    const stanje: StanjeNaloge = (z.stanje === "tece" || z.stanje === "zaganja") && p !== null && !dela ? "koncano" : jePotekel(z, zdaj) ? "poteklo" : z.stanje;
    naloge.push({
      id: z.id, izvor: z.izvor, agent: z.agent ?? "claude", mapa: z.mapa, besedilo: z.besedilo, zgostitev: z.zgostitev, stanje,
      ustvarjeno: z.ustvarjeno, potrjeno: z.potrjeno, razlog: z.razlog, porocilo: p?.besedilo ?? null, pogoj: z.pogoj ?? null,
      ocena: z.ocena ?? null, opomnik: z.opomnik ?? null, koncano: z.koncano ?? (stanje === "koncano" && z.stanje !== "koncano" ? zdaj.toISOString() : null),
    });
  }
  return { naVoljo: razlog === null, razlogNiNaVoljo: razlog, geslo: await ownerExists(root), mape: s.mape, naloge, agenti, prepovedane: s.prepovedane ?? [] };
}

/** Zavrnjeno besedilo: nevidni znaki dobijo svoj razlog (A7), da lastnik ve, zakaj (prijazno sporocilo v vmesniku in na telefonu). */
function razlogBesedila(v: unknown): RazlogNaloge {
  return typeof v === "string" && imaNevidne(v.normalize("NFC").replace(/\r\n?/g, "\n")) ? "besedilo-nevidni" : "besedilo";
}

/** Predlog naloge (lastnik ali Lina). Nikoli ne zazene nicesar: samo zapis s stanjem »caka«. */
async function dodajPredlog(root: string, izvor: IzvorNaloge, mapaVhod: unknown, besediloVhod: unknown, o: Odvisnosti, zdaj: Date, agentVhod: unknown = "claude", pogojVhod?: unknown): Promise<ZapisNaloge> {
  // Lina brez gesla lastnika ne predlaga (potrditev bi bila tako ali tako zavrnjena) in ima krajse besedilo (S2).
  if (izvor === "lina" && !(await ownerExists(root))) throw new ClaudeNalogaNapaka("geslo");
  if (!jeAgent(agentVhod)) throw new ClaudeNalogaNapaka("agent");
  const agent = agentVhod;
  const pogoj = pogojVhod === undefined ? undefined : razberiPogoj(pogojVhod, zdaj);
  if (pogoj === null) throw new ClaudeNalogaNapaka("pogoj");
  const besedilo = ocistiBesediloNaloge(besediloVhod, izvor === "lina" ? NAJVEC_ZNAKOV_NALOGE_LINE : undefined);
  if (!besedilo) throw new ClaudeNalogaNapaka(razlogBesedila(besediloVhod));
  return vVrsti(root, async () => {
    const s = await preberi(root);
    pricakuj(preveriMapo(mapaVhod, meje(root, s, o)));
    const mapa = await resnicnaMapa(String(mapaVhod).trim(), root, s, o);
    await preveriPrepoved(agent, mapa, s);
    for (const z of s.naloge) if (jePotekel(z, zdaj)) z.stanje = "poteklo";
    // Mesta za cakajoce so locena po izvoru (S2): Linini predlogi ne zasedejo lastnikovih.
    const cakajo = s.naloge.filter((z) => z.stanje === "caka" && z.izvor === izvor).length;
    if (cakajo >= (izvor === "lina" ? NAJVEC_CAKAJOCIH_LINE : NAJVEC_CAKAJOCIH)) throw new ClaudeNalogaNapaka("polno-cakajoce");
    const z: ZapisNaloge = {
      id: randomBytes(8).toString("hex"),
      izvor,
      mapa,
      besedilo,
      zgostitev: zgostitevNaloge(mapa, besedilo, agent),
      stanje: "caka",
      ustvarjeno: zdaj.toISOString(),
      potrjeno: null,
      razlog: null,
      ...(agent !== "claude" ? { agent } : {}),
      ...(pogoj ? { pogoj } : {}),
    };
    s.naloge = obreziZgodovino([...s.naloge, z], zdaj);
    await zapisi(root, s);
    return z;
  });
}

/**
 * Vnaprej dodeljena naloga (lastnik na racunalniku ali s telefona): dodelitev JE potrditev za en zagon. Agent mora biti vklopljen, preverjen
 * in z zacetnim pozivom; mapa kot pri predlogu + prepovedane mape. Zapis »dodeljeno«; pogoj »zdaj« se zazene takoj (razporejevalnik).
 */
async function dodeli(root: string, izvor: IzvorNaloge, u: Record<string, unknown>, o: Odvisnosti, zdaj: Date): Promise<ZapisNaloge> {
  if (!jeAgent(u.agent)) throw new ClaudeNalogaNapaka("agent");
  const agent = u.agent;
  const pogoj = razberiPogoj(u.pogoj, zdaj);
  if (!pogoj) throw new ClaudeNalogaNapaka("pogoj");
  const besedilo = ocistiBesediloNaloge(u.besedilo);
  if (!besedilo) throw new ClaudeNalogaNapaka(razlogBesedila(u.besedilo));
  // dodelitev je potrditev za zagon: brez potrjenega opozorila takoj zavrnjena (zazeniZapis ga ob zagonu preveri znova)
  if (!(await opozoriloPotrjeno(root))) throw new ClaudeNalogaNapaka("opozorilo");
  const z = await vVrsti(root, async () => {
    const s = await preberi(root);
    await agentZaNalogo(agent, s, o);
    pricakuj(preveriMapo(u.mapa, meje(root, s, o)));
    const mapa = await resnicnaMapa(String(u.mapa).trim(), root, s, o);
    await preveriPrepoved(agent, mapa, s);
    if (s.naloge.filter((n) => n.stanje === "dodeljeno" || n.stanje === "zamujeno").length >= NAJVEC_DODELJENIH) throw new ClaudeNalogaNapaka("polno-cakajoce");
    const z: ZapisNaloge = {
      id: randomBytes(8).toString("hex"), izvor, agent, mapa, besedilo, zgostitev: zgostitevNaloge(mapa, besedilo, agent), stanje: "dodeljeno",
      ustvarjeno: zdaj.toISOString(), potrjeno: null, razlog: null, pogoj,
    };
    s.naloge = obreziZgodovino([...s.naloge, z], zdaj);
    await zapisi(root, s);
    return z;
  });
  await korakRazporejevalnika(root, o, zdaj);
  return z;
}

/**
 * Lina (asistentka) predlaga nalogo iz oznake v odgovoru. Klice jo samo asistent-pogovor.server.ts v seji lastnika;
 * izid je vedno samo predlog, ki caka potrditev. Napaka nikoli ne podre pogovora (vrne null).
 */
export async function predlagajClaudeNalogo(
  dir: string | undefined,
  mapa: unknown,
  besedilo: unknown,
  o: Odvisnosti = {},
  zdaj = new Date(),
  agent: { agent?: string; pogoj?: string } = {},
): Promise<ZapisNaloge | null> {
  try {
    const pogoj = agent.pogoj === undefined ? undefined : pogojIzOznake(agent.pogoj, zdaj);
    if (pogoj === null) return null;
    return await dodajPredlog(resolveDataDir(dir), "lina", mapa, besedilo, o, zdaj, agent.agent ?? "claude", pogoj);
  } catch {
    return null;
  }
}

/** Potrditev predloga (»caka«) ali zamujene dodeljene naloge (»zamujeno«): zgostitev mora biti ista, kot jo je lastnik videl. */
async function potrdi(root: string, id: string, zgostitev: unknown, o: Odvisnosti, zdaj: Date): Promise<void> {
  await vVrsti(root, async () => {
    const s = await preberi(root);
    const z = s.naloge.find((n) => n.id === id);
    if (!z || (z.stanje !== "caka" && z.stanje !== "zamujeno")) throw new ClaudeNalogaNapaka("ni-najdeno");
    if (typeof zgostitev !== "string" || zgostitev !== z.zgostitev || zgostitevNaloge(z.mapa, z.besedilo, z.agent ?? "claude") !== z.zgostitev) throw new ClaudeNalogaNapaka("zgostitev");
    if (jePotekel(z, zdaj)) {
      z.stanje = "poteklo";
      await zapisi(root, s);
      throw new ClaudeNalogaNapaka("poteklo");
    }
    // Linin predlog z uro ali »ko konca«: potrditev ga uvrsti v vrsto (dodeljeno), zagon ob pogoju
    if (z.stanje === "caka" && z.pogoj && z.pogoj.vrsta !== "zdaj") {
      await agentZaNalogo(z.agent ?? "claude", s, o);
      if (!(await opozoriloPotrjeno(root))) throw new ClaudeNalogaNapaka("opozorilo");
      z.stanje = "dodeljeno";
      await zapisi(root, s);
      return;
    }
    if (z.stanje === "zamujeno") z.sprozeno = zdaj.toISOString();
    await zazeniZapis(root, s, z, o, zdaj);
  });
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function stanjeClaudeNalog(token: string | null, dir?: string, o: Odvisnosti = {}, zdaj = new Date()): Promise<JavnoStanjeNalog> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return javno(root, await preberi(root), o, zdaj);
}

/** Absolutna pot brez »..« in kontrolnih znakov (dovoljene in prepovedane mape). */
function absolutnaPot(m: unknown): string {
  if (typeof m !== "string" || !m.trim() || m.length > NAJVEC_ZNAKOV_POTI || /[\u0000-\u001f\u007f]/.test(m) || imaNevidne(m) || !path.isAbsolute(m.trim()) || m.split(/[\\/]+/).includes("..")) {
    throw new ClaudeNalogaNapaka("mapa");
  }
  return path.resolve(m.trim());
}

const Z_GESLOM = ["pripravi", "potrdi", "mape", "dodeli", "agenti", "prepovedane"];

export async function ukazClaudeNalog(token: string | null, ukaz: unknown, dir?: string, o: Odvisnosti = {}, zdaj = new Date()): Promise<JavnoStanjeNalog> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const u = obj(ukaz);
  // Brez gesla ima vsak lokalni proces sejo lastnika: priprava, zagon, dodelitev, mape in stikala so takrat zavrnjeni (fail-closed, kot avtonomija).
  if (Z_GESLOM.includes(String(u.ukaz)) && !(await ownerExists(root))) throw new ClaudeNalogaNapaka("geslo");
  switch (u.ukaz) {
    case "pripravi":
      await dodajPredlog(root, "lastnik", u.mapa, u.besedilo, o, zdaj);
      break;
    case "potrdi":
      if (!jeIdNaloge(u.id)) throw new ClaudeNalogaNapaka("ni-najdeno");
      await potrdi(root, u.id, u.zgostitev, o, zdaj);
      break;
    case "odkloni": {
      const id = u.id;
      if (!jeIdNaloge(id)) throw new ClaudeNalogaNapaka("ni-najdeno");
      await vVrsti(root, async () => {
        const s = await preberi(root);
        const z = s.naloge.find((n) => n.id === id && n.stanje === "caka");
        if (!z) throw new ClaudeNalogaNapaka("ni-najdeno");
        z.stanje = "odklonjeno";
        await zapisi(root, s);
      });
      break;
    }
    case "dodeli":
      await dodeli(root, "lastnik", u, o, zdaj);
      break;
    case "preklici":
      await preklici(root, u.id);
      break;
    case "agenti": {
      const vhod = obj(u.agenti);
      await vVrsti(root, async () => {
        const s = await preberi(root);
        for (const [k, v] of Object.entries(vhod)) {
          if (!jeAgent(k) || typeof v !== "boolean") throw new ClaudeNalogaNapaka("agent");
          s.agenti = { ...s.agenti, [k]: v };
        }
        await zapisi(root, s);
      });
      break;
    }
    case "prepovedane": {
      if (!Array.isArray(u.mape) || u.mape.length > NAJVEC_PREPOVEDANIH) throw new ClaudeNalogaNapaka("mapa");
      // dobesedno (tudi neobstojeca mapa ostane prepovedana); kanonicna pot se doda ob vsaki preverbi
      const mape = [...new Set(u.mape.map(absolutnaPot))];
      await vVrsti(root, async () => {
        const s = await preberi(root);
        s.prepovedane = mape;
        await zapisi(root, s);
      });
      break;
    }
    case "preveri-agente":
      await stanjeAgentov(await preberi(root), o, true);
      break;
    case "mape": {
      if (!Array.isArray(u.mape) || u.mape.length > NAJVEC_MAP) throw new ClaudeNalogaNapaka("mapa");
      const dom = o.dom ?? homedir();
      const kDom = (await kanonicna(dom)) ?? dom;
      const kRoot = (await kanonicna(root)) ?? root;
      const mape: string[] = [];
      for (const m of u.mape) {
        if (typeof m !== "string" || !path.isAbsolute(m.trim()) || m.split(/[\\/]+/).includes("..") || imaNevidne(m)) throw new ClaudeNalogaNapaka("mapa");
        const p = path.resolve(m.trim());
        // Koren diska, dom ali nad njim, sistemske mape in podatki Line niso dovoljeni - po zapisu IN po kanonicni poti (alias se shrani kot
        // prava pot; povezava na koren ali /etc je zavrnjena; CodeRabbit in N3).
        const k = await kanonicna(p);
        if (!k) throw new ClaudeNalogaNapaka("mapa-ni");
        const razlog = razlogDovoljeneMape(p, dom, root) ?? razlogDovoljeneMape(k, kDom, kRoot);
        if (razlog) throw new ClaudeNalogaNapaka(razlog);
        mape.push(k);
      }
      await vVrsti(root, async () => {
        const s = await preberi(root);
        s.mape = [...new Set(mape)];
        await zapisi(root, s);
      });
      break;
    }
    default:
      throw new ClaudeNalogaNapaka("ukaz");
  }
  return javno(root, await preberi(root), o, zdaj);
}

/** Preklic dodeljene ali zamujene naloge (tekoce naloge Lina ne ustavi: terminal zapre lastnik). */
async function preklici(root: string, id: unknown): Promise<void> {
  if (!jeIdNaloge(id)) throw new ClaudeNalogaNapaka("ni-najdeno");
  await vVrsti(root, async () => {
    const s = await preberi(root);
    const z = s.naloge.find((n) => n.id === id && (n.stanje === "dodeljeno" || n.stanje === "zamujeno"));
    if (!z) throw new ClaudeNalogaNapaka("ni-najdeno");
    z.stanje = "preklicano";
    await zapisi(root, s);
  });
}

// ------------------------------------------------------------------ telefon (podpis naprave preveri asistent-streznik.server.ts)

/** Stanje za telefon: vrsta z agentom, stanjem, uro, oceno in opomnikom ter agenti za izbiro; porocila agentov NE gredo na telefon. */
export async function telefonStanjeNalog(dir?: string, o: Odvisnosti = {}, zdaj = new Date()): Promise<unknown> {
  const root = resolveDataDir(dir);
  const j = await javno(root, await preberi(root), o, zdaj);
  return {
    agenti: j.agenti.map(({ id, ime, stanje, vklopljen, zacetniPoziv, kanal }) => ({ id, ime, stanje, vklopljen, zacetniPoziv, kanal })),
    naloge: j.naloge.slice(0, 30).map(({ porocilo: _p, zgostitev: _z, ...n }) => n),
  };
}

export async function telefonDodeli(dir: string | undefined, agent: unknown, mapa: unknown, besedilo: unknown, pogoj: unknown, o: Odvisnosti = {}, zdaj = new Date()): Promise<{ id: string }> {
  const root = resolveDataDir(dir);
  if (!(await ownerExists(root))) throw new ClaudeNalogaNapaka("geslo");
  const z = await dodeli(root, "telefon", { agent, mapa, besedilo, pogoj }, o, zdaj);
  return { id: z.id };
}

export async function telefonPreklici(dir: string | undefined, id: unknown, _o: Odvisnosti = {}): Promise<void> {
  await preklici(resolveDataDir(dir), id);
}
