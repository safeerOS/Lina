/**
 * Lina odpre Claude Code na racunalniku z nalogo (lastnik 23. 11. 2026; AGENTS.md »Lina sama odpre Claude Code na racunalniku«).
 * Potek: predlog (lastnik v zavihku Racunalnik ali Lina z oznako v pogovoru) -> lastnik vidi mapo in CELO besedilo -> potrdi ->
 * Lina zapise <mapa>/.lina-naloge/<id>/NALOGA.md (nova mapa, nikoli prepis) in odpre terminal z ukazom `claude` in stalnim
 * pozivom (samo id). Od naloge 23 (25. 11. 2026) claude brez peskovnika tece v Lini brez okna (vprasanja-agentov.server.ts). Porocilo POROCILO.md iz iste mape se pokaze v zavihku Racunalnik kot besedilo.
 * Vsak javni ukaz zahteva sejo lastnika (requireOwner); brez gesla (lokalna seja brez prijave) sta priprava in zagon zavrnjena.
 * Brez sudo, brez --dangerously-*, brez lupine (argv, cwd = mapa). Tajnica (klici) te datoteke ne uvaza (claude-naloge.test.ts).
 *
 * Lina vodi vse agente (lastnik 24. 11. 2026): isti mehanizem za agente s seznama AGENTI (zaznani in preverjeni z zagonom brez okna),
 * prepovedane mape za Gemini/Google agente, vrsta vnaprej dodeljenih nalog (dodelitev = potrditev za en zagon, zgostitev se ob zagonu
 * preveri) z razporejevalnikom, ocena trajanja iz zgodovine, lasten opomnik in dogodek »naloga koncana« (agenti-naloge.test.ts).
 */
import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, accessSync, existsSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ownerExists, requireOwner } from "./auth.server.ts";
import {
  AGENTI,
  ClaudeNalogaNapaka,
  DATOTEKA_NACRTA,
  DATOTEKA_NALOGE,
  DATOTEKA_POROCILA,
  MAPA_NALOG,
  NAJVEC_BAJTOV_NACRTA,
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
  jeNacrtovanje,
  jePotekel,
  naslednjiOpomnik,
  ocenaTrajanja,
  ocistiBesediloNaloge,
  obreziZgodovino,
  ocistiPorocilo,
  ovijNacrt,
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
import {
  MAPA_DELA as MAPA_DELA_VODJE,
  NAJVEC_KROGOV,
  besediloPopravka,
  besediloSpora,
  jeArgvPreizkusa,
  jeKoncnaFaza,
  navodiloPregleda,
  opisNapake,
  razberiNajdbe,
  type RazlogVodje,
  type VlogaNaloge,
  type VodjaNaloge,
} from "./claude-naloge-vodja.ts";
import {
  diffKopije,
  git as gitVodje,
  izvoziZdruzitev,
  jeZdruzitev,
  osveziZIzvirnikom,
  pripraviPregled,
  pripraviSporMape,
  privzetoIzvedi,
  ustvariKopijo,
  uveljavi,
  vDelu,
  zdruzi,
  type DepsVodje,
  type Izvedi,
  type Zdruzitev,
} from "./claude-naloge-vodja.server.ts";
import { opozoriloPotrjeno } from "./opozorilo.server.ts";
import {
  besediloPredlogaTock,
  navodiloTock,
  oceniTocke,
  potVProjektu,
  povzetekTock,
  tockeNaloge,
  type IzidTocke,
  type PovzetekTock,
} from "./tocke-naloge.ts";
import { jeWindows, platformaZdaj, programPeskovnika, ukazTerminala, type Platforma } from "./platforma.server.ts";
import { jeNovProjekt, sestaviPregledProjekta } from "./pregled-projekta.server.ts";
import { kazaloZaProjekt, zapisiOpazanjeNaloge } from "./spomin-nalog.server.ts";
import { resolveDataDir, writeJson } from "./store.server.ts";
import { casZagonaProcesa } from "./tunel.server.ts";

export type { DogodekNalogaKoncana } from "./claude-naloge.ts";
import { najdiDovoljenje, zapisiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { jeTveganoDejanje } from "./dovoljenja-podobne.ts";
import { zazeniVLini } from "./vprasanja-agentov.server.ts";

export const DATOTEKA_STANJA = "claude-naloge.json";
const NAJVEC_MAP = 10;
const NAJVEC_PREPOVEDANIH = 20;
/** Najvec dodeljenih nalog, ki cakajo pogoj (vrsta ne raste brez meje). */
const NAJVEC_DODELJENIH = 20;
const NAJVEC_UKAZOV_PREIZKUSOV = 5;

type Stanje = {
  v: 1;
  mape: string[];
  naloge: ZapisNaloge[];
  /** Stikala agentov; manjkajoc = vklopljen (lastnikova ideja: privzeto vklopljeno). */
  agenti?: Partial<Record<AgentId, boolean>>;
  /** Prepovedane mape za agente z omejenimi mapami (opencode, agy); shranjene dobesedno, preverjene po zapisu IN po realpath. */
  prepovedane?: string[];
  /** Lina kot vodja: pregledovalec (privzeto claude), ukazi preizkusov po projektu (privzeto zaznani), zdruzitve po projektu. */
  pregledovalec?: AgentId;
  preizkusi?: Record<string, string[][]>;
  zdruzitve?: Record<string, Zdruzitev>;
  /**
   * Naloga 19b N2: HMAC dovoljenih in prepovedanih map (kljucCelovitosti), vsak seznam svoj podpis. Podpise samo ukaz lastnika z geslom
   * (mape, prepovedane); ostali zapisi stanja podpis prenesejo nespremenjen, zato podtaknjen seznam ostane nepodpisan.
   */
  podpisMap?: string;
  podpisPrepovedanih?: string;
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
  /** Lina kot vodja: git, diff in patch (privzeto pravi programi brez lupine) in ukazi preizkusov (ze z mejo pomnilnika). */
  izvedi?: Izvedi;
  izvediPreizkus?: Izvedi;
  /**
   * Naloga 23: Claude Code v Lini (brez okna, stream-json, vprasanja za dovoljenje v Lini). Privzeto zazeniVLini na Linuxu; kdor poda svoj
   * zagon terminala (o.zazeni, preizkusi) in tega ne, ostane pri terminalu.
   */
  zazeniVLini?: (root: string, naloga: string, program: string, poziv: string, cwd: string, okolje: NodeJS.ProcessEnv) => Promise<number>;
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
  /** V mapi naloge je nacrt.html, ki prestane varno branje (vsebino da samo nacrtClaudeNaloge). */
  nacrt: boolean;
  /** Lina kot vodja: polna pot kopije, vloga (pregled/popravek/spor) in za katero nalogo, faza pregleda in zdruzitve. */
  kopija: string | null;
  vloga: VlogaNaloge | null;
  za: string | null;
  vodja: VodjaNaloge | null;
  /** Tocke naloge s preverjenimi dokazi (»3/5 narejeno« in manjkajoce), ko je agent koncal; null brez tock ali pred koncem. */
  tocke: PovzetekTock | null;
  /** Predlog nove naloge za manjkajoce tocke (id) ali »napaka«; null, ce ga ni bilo treba. */
  predlogTock: string | null;
};

export type JavnaZdruzitev = {
  projekt: string;
  pot: string;
  git: boolean;
  veja: string | null;
  naloge: string[];
  zgostitev: string | null;
  diff: string | null;
  /** Lina posodablja zdruzeno delo z izvirnikom; razlog, ce zadnja posodobitev ni uspela. */
  osvezi: boolean;
  razlog: Zdruzitev["razlog"] | null;
  /** Tocki 7/8: besedilo razloga (koda opisa, podrobnost) in pot izvozenega popravka. */
  opis: Zdruzitev["opis"] | null;
  podrobnost: string | null;
  izvoz: string | null;
};

export type StanjeAgenta = {
  id: AgentId;
  ime: string;
  pot: string | null;
  /** pripravljen = zaznan in zagon brez okna je uspel; samo tak agent je v izbiri. */
  /** brez-peskovnika: agent z omejenimi mapami, bwrap manjka ali ne deluje (ali Windows) - ni na voljo (A4). */
  stanje: "pripravljen" | "ni-najden" | "ne-deluje" | "prijava" | "izklopljen" | "brez-peskovnika";
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
  pregledovalec: AgentId;
  preizkusi: Record<string, string[][]>;
  zdruzitve: JavnaZdruzitev[];
  /** N7: omrezje agentov z omejenimi mapami - »loceno« (pasta) ali »gostitelj« (namig: namesti passt); null, ce takega agenta ni. */
  omrezjeAgentov: "loceno" | "gostitelj" | null;
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
export const privzetiZagonTerminala: Zagon = (program, args, cwd, okolje) =>
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
      ...(jeAgent(s.pregledovalec) ? { pregledovalec: s.pregledovalec } : {}),
      preizkusi: Object.fromEntries(
        Object.entries(s.preizkusi && typeof s.preizkusi === "object" ? s.preizkusi : {}).filter(
          ([k, v]) => path.isAbsolute(k) && Array.isArray(v) && v.length <= NAJVEC_UKAZOV_PREIZKUSOV && v.every(jeArgvPreizkusa),
        ),
      ),
      zdruzitve: Object.fromEntries(Object.entries(s.zdruzitve && typeof s.zdruzitve === "object" ? s.zdruzitve : {}).filter(([k, v]) => jeZdruzitev(v, root) && v.projekt === k)),
      ...(typeof s.podpisMap === "string" ? { podpisMap: s.podpisMap } : {}),
      ...(typeof s.podpisPrepovedanih === "string" ? { podpisPrepovedanih: s.podpisPrepovedanih } : {}),
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

/** Naloga 19b N2: podpis enega seznama map (namen loci dovoljene od prepovedanih: podpisa ni mogoce prenesti med seznamoma). */
export async function podpisSeznama(root: string, namen: "mape" | "prepovedane", seznam: readonly string[]): Promise<string> {
  const { kljucCelovitosti } = await import("./keys.server.ts");
  return createHmac("sha256", await kljucCelovitosti(`claude-naloge-${namen}`, root)).update(JSON.stringify(seznam)).digest("hex");
}

async function seznamVelja(root: string, namen: "mape" | "prepovedane", seznam: readonly string[], podpis: string | undefined): Promise<boolean> {
  const pricakovan = Buffer.from(await podpisSeznama(root, namen, seznam));
  const dobljen = Buffer.from(podpis ?? "");
  return dobljen.length === pricakovan.length && timingSafeEqual(dobljen, pricakovan);
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
 * Naloga 19: meje orodij orkestratorja (branje in pisanje datotek). SAMO mape, ki jih je lastnik izrecno dovolil v zavihku Racunalnik
 * (ne ves dom kot pri predlogih nalog: model, ki bere splet, ne dobi domace mape), kanonicne in veljavne po razlogDovoljeneMape; podatki
 * Line po realpath; prepovedane mape dobesedno in po realpath za vse (mozgani Line so lahko Gemini - pravilo lastnika o Googlu).
 */
export async function mejeOrodijOrkestratorja(dir?: string, o: Odvisnosti = {}): Promise<{ dovoljene: string[]; podatki: string; prepovedane: string[]; razlog?: string }> {
  const root = resolveDataDir(dir);
  const s = await preberi(root);
  const dom = (await kanonicna(o.dom ?? homedir())) ?? (o.dom ?? homedir());
  const podatki = (await kanonicna(root)) ?? root;
  // naloga 19b N2: datoteka je nepodpisana in jo lahko zapise vsak lokalni proces brez gesla - seznama veljata samo s podpisom ukaza
  // lastnika; nepodpisan, spremenjen ali pokvarjen seznam (tudi prepovedanih) = nobena mapa (fail-closed)
  const nepotrjen = !(await seznamVelja(root, "mape", s.mape, s.podpisMap)) ? "Dovoljene mape niso potrjene" : !(await seznamVelja(root, "prepovedane", s.prepovedane ?? [], s.podpisPrepovedanih)) ? "Prepovedane mape niso potrjene" : null;
  if (nepotrjen) {
    return { dovoljene: [], podatki, prepovedane: [], razlog: `${nepotrjen} z geslom lastnika (spremenjena datoteka ali starejsa razlicica): lastnik ta seznam znova shrani v zavihku Racunalnik.` };
  }
  const dovoljene: string[] = [];
  for (const d of s.mape) {
    const k = await kanonicna(d);
    // koren s skritim delom poti (npr. ~/.ssh) nikoli ni dovoljen (preverja se sicer le pot od korena naprej)
    if (k && !razlogDovoljeneMape(k, dom, podatki) && !k.split(/[\\/]+/).some((x) => x.startsWith("."))) dovoljene.push(k);
  }
  const prepovedane = [...(s.prepovedane ?? [])];
  for (const p of s.prepovedane ?? []) {
    const k = await kanonicna(p);
    if (k) prepovedane.push(k);
  }
  return { dovoljene, podatki, prepovedane };
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
 * Zdaj dodatna plast poleg peskovnika (ovojPeskovnika: prepovedane mape so v bwrap prekrite, tudi prek povezave).
 * shortcut: globina 8 in 20 000 vnosov; vecji projekt se zavrne (fail-closed); ko je peskovnik dokazan z resnicnimi agenti, se lahko meja sprosti.
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

// ------------------------------------------------------------------ A4: peskovnik (bubblewrap) za agente z omejenimi mapami

/**
 * Osnova peskovnika: ves datotecni sistem samo za branje, svoj /dev, /proc samo procesov peskovnika (--unshare-pid), prazen /tmp, BREZ
 * omrezja (N7, pregled agentov 24. 11.: loopback gostitelja - lokalni strezniki, spomin sej - in abstraktne vticnice X11 bi obsli prekrivko
 * prepovedanih map; fail-closed, dokler ni posrednika samo do ponudnika agenta). Prekrit /run (vticnice: docker.sock = root, vodilo seje: `systemd-run --user` ali gdbus bi zagnal ukaz zunaj
 * peskovnika, Wayland) razen mape razresevalnika DNS, kamor kaze /etc/resolv.conf; brez DISPLAY/XAUTHORITY. Brez --new-session: interaktivni
 * agent potrebuje svoj terminal (TIOCSTI je v jedru >= 6.2 privzeto izklopljen).
 */
function osnovaPeskovnika(okolje: NodeJS.ProcessEnv = process.env, brezOmrezja = true): string[] {
  const xdg = okolje.XDG_RUNTIME_DIR;
  const izvajalne = ["/run", ...(xdg && path.isAbsolute(xdg) && !vPrepovedani(xdg, ["/run"]) ? [xdg] : [])].filter((p) => existsSync(p));
  let dns: string | null = null;
  try {
    dns = path.dirname(realpathSync("/etc/resolv.conf"));
  } catch {
    /* brez resolv.conf */
  }
  return [
    "--die-with-parent", "--unshare-pid", "--unshare-ipc", ...(brezOmrezja ? ["--unshare-net"] : []),
    "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
    ...izvajalne.flatMap((p) => ["--tmpfs", p]),
    ...(dns && dns !== "/run" && vPrepovedani(dns, ["/run"]) ? ["--ro-bind-try", dns, dns] : []),
    ...["DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY"].flatMap((k) => ["--unsetenv", k]),
  ];
}

/**
 * N3: kar je v peskovniku vedno skrito poleg prepovedanih map: mapa podatkov Line (seje, sifrirani kljuci, stanje nalog), kljuci in seje v
 * domu (drugi agenti, ssh, gpg, brskalniki, piskotek X11) in mape nastavitev DRUGIH agentov. Obstojece po realpath; mapa = tmpfs, datoteka =
 * /dev/null. Kopija naloge je pod mapo podatkov: veze se ZA tem skrivanjem.
 */
const SKRITO_V_DOMU = [
  ".claude", ".claude.json", ".claude-mem", ".codex", ".ssh", ".gnupg", ".aws", ".kube", ".docker", ".netrc", ".git-credentials",
  ".password-store", ".mozilla", ".Xauthority", ".ICEauthority", ".local/share/keyrings", ".config/gh", ".config/google-chrome",
  ".config/chromium", ".config/BraveSoftware", ".config/git", ".gitconfig",
];

async function prekrij(poti: Iterable<string>): Promise<string[]> {
  const izid: string[] = [];
  for (const p of new Set(poti)) {
    const k = await kanonicna(p);
    const st = k ? await lstat(k).catch(() => null) : null;
    if (!k || !st) continue; // ne obstaja: ni kaj brati
    izid.push(...(st.isDirectory() ? ["--tmpfs", k] : ["--ro-bind", "/dev/null", k]));
  }
  return izid;
}

async function skritoVPeskovniku(root: string | undefined, o: Odvisnosti, agent: AgentId | null): Promise<string[]> {
  const dom = o.dom ?? homedir();
  const tuje = AGENTI.filter((a) => a !== agent).flatMap((a) => OPIS_AGENTOV[a].nastavitve ?? []);
  return prekrij([...(root ? [root] : []), ...[...SKRITO_V_DOMU, ...tuje].map((r) => path.join(dom, r))]);
}

/**
 * N4: predpona bwrap za preizkuse v mapi zdruzitve (dela agenta z omejenimi mapami): brez omrezja in vodila seje, podatki Line, kljuci doma
 * in prepovedane mape skriti, zapisljiva samo mapa zdruzitve. Brez bwrap null (preizkusi se ne pozenejo).
 */
export async function ovojPreizkusa(root: string, o: Odvisnosti, mapa: string): Promise<string[] | null> {
  const bwrap = programPeskovnika(o.najdi ?? ((ime: string) => najdiNaPoti(ime)), o.platforma ?? platformaZdaj());
  if (!bwrap || !vDelu(root, mapa)) return null;
  const s = await preberi(root);
  return [
    bwrap, ...osnovaPeskovnika(), ...(await skritoVPeskovniku(root, o, null)), "--bind", mapa, mapa, ...(await prekrij(s.prepovedane ?? [])),
    "--chdir", mapa, "--",
  ];
}

/** Preverba ob zaznavi: bwrap z isto osnovo zares zazene ukaz (uporabniski imenski prostori dovoljeni, AppArmor ga ne ustavi). */
async function peskovnikDeluje(o: Odvisnosti, preveri: PreverbaZagona): Promise<boolean> {
  const bwrap = programPeskovnika(o.najdi ?? ((ime: string) => najdiNaPoti(ime)), o.platforma ?? platformaZdaj());
  if (!bwrap) return false;
  const v = await preveri(bwrap, [...osnovaPeskovnika(), "--", "/bin/sh", "-c", ":"], ROK_PREVERBE_MS);
  return !v.potekel && v.koda === 0;
}

/**
 * Ukaz bwrap pred programom agenta. Zapisljiva je samo delovna mapa: izvirni projekt, ce naloga nima kopije; sicer SAMO kopija (N3: izvirnik
 * in njegov .git ostaneta samo za branje - git agenta v worktree kopije ne more pisati, commit naredi Lina v diffKopije). Mape nastavitev
 * agenta samo za branje (N10: zapis vticnika ali streznika MCP bi se izvedel zunaj peskovnika ob naslednjem zagonu).
 * shortcut: agent, ki mora pisati v svoje nastavitve (prijava, zgodovina), v peskovniku tega ne more; bwrap 0.9 nima --tmp-overlay.
 * Skrito: podatki Line, kljuci doma, nastavitve drugih agentov (skritoVPeskovniku). Prepovedane mape (po realpath; obstojece) prekrite s praznim tmpfs ZADNJE, da zmagajo tudi znotraj zapisljive mape; datoteka z /dev/null.
 * Brez bwrap: napaka »peskovnik« (fail-closed, nikoli zagon brez peskovnika).
 */
async function nastavitveAgenta(agent: AgentId, dom: string): Promise<string[]> {
  const izid: string[] = [];
  for (const r of OPIS_AGENTOV[agent].nastavitve ?? []) {
    const p = path.join(dom, r);
    // prvi zagon ali prijava: mapa mora obstajati, sicer je bwrap ne more vezati in agent ne more zapisati prijave
    await mkdir(p, { recursive: true, mode: 0o700 }).catch(() => undefined);
    const k = await kanonicna(p);
    if (k && (await lstat(k).catch(() => null))?.isDirectory()) izid.push("--bind", k, k);
  }
  return izid;
}

/**
 * N7 (vodja 24. 11.): agent z omejenimi mapami ima omrezje (sicer ne doseze ponudnika). Ce pasta deluje: lasten imenski prostor omrezja
 * BREZ dostopa do gostitelja (--no-map-gw: naslov prehoda ni gostitelj; -T/-U none: brez posredovanja na vrata loopbacka gostitelja;
 * -t/-u none: brez vhodnih vrat) in DNS prek --dns-forward (resolv.conf gostitelja kaze na 127.0.0.53, ki ga v novem imenskem prostoru ni).
 * Sicer omrezje gostitelja (loopback gostitelja in Linin streznik sta dosegljiva; Nastavitve pokazejo namig za passt).
 * shortcut: slirp4netns ni podprt (potrebuje PID ze tekocega procesa); zastavice pasta so preverjene samo z laznim pasta (na tem racunalniku ga ni).
 */
const DNS_PASTA = "169.254.1.53";
const ZASTAVICE_PASTA = ["--config-net", "--quiet", "--no-map-gw", "-t", "none", "-u", "none", "-T", "none", "-U", "none", "--dns-forward", DNS_PASTA, "--"];
const pastaPreverjen = new WeakMap<PreverbaZagona, boolean>();

async function pastaDeluje(o: Odvisnosti, osvezi = false): Promise<string | null> {
  const pasta = (o.najdi ?? ((ime: string) => najdiNaPoti(ime)))("pasta");
  // samo za agente, ki so ze prestali preverbo bwrap (programPeskovnika: samo Linux)
  if (!pasta) return null;
  const preveri = o.preveriZagon ?? privzetaPreverba;
  if (osvezi || !pastaPreverjen.has(preveri)) {
    // prava veriga kot ob zagonu (pasta -> bwrap brez --unshare-net): ce bwrap v imenskem prostoru pasta ne dela, ostane omrezje gostitelja
    const bwrap = programPeskovnika(o.najdi ?? ((ime: string) => najdiNaPoti(ime)), o.platforma ?? platformaZdaj());
    const v = !bwrap
      ? { koda: 1, potekel: false }
      : await preveri(pasta, [...ZASTAVICE_PASTA, bwrap, ...osnovaPeskovnika(process.env, false), "--", "/bin/sh", "-c", ":"], ROK_PREVERBE_MS)
          .catch(() => ({ koda: 1, potekel: false }));
    pastaPreverjen.set(preveri, !v.potekel && v.koda === 0);
  }
  return pastaPreverjen.get(preveri) ? pasta : null;
}

/** Predpona pasta in vezava resolv.conf v bwrap (prazno = omrezje gostitelja). */
async function omrezjeAgenta(root: string | undefined, o: Odvisnosti): Promise<{ pred: string[]; dns: string[] }> {
  const pasta = root ? await pastaDeluje(o) : null;
  if (!pasta || !root) return { pred: [], dns: [] };
  const datoteka = path.join(root, "peskovnik-resolv.conf");
  writeFileSync(datoteka, `nameserver ${DNS_PASTA}\n`, { mode: 0o644 });
  let cilj = "/etc/resolv.conf";
  try {
    cilj = realpathSync(cilj);
  } catch {
    /* brez resolv.conf: veze se na /etc/resolv.conf */
  }
  return { pred: [pasta, ...ZASTAVICE_PASTA], dns: ["--ro-bind", datoteka, cilj] };
}

async function ovojPeskovnika(root: string, agent: AgentId, z: ZapisNaloge, delovna: string, s: Stanje, o: Odvisnosti): Promise<string[]> {
  const bwrap = programPeskovnika(o.najdi ?? ((ime: string) => najdiNaPoti(ime)), o.platforma ?? platformaZdaj());
  if (!bwrap) throw new ClaudeNalogaNapaka("peskovnik");
  const dom = o.dom ?? homedir();
  const pisanje = [...new Set([...(z.kopija ? [z.kopija] : [z.mapa]), delovna])].flatMap((p) => ["--bind", p, p]);
  // N10 (vodja 24. 11.): lastne mape nastavitev zapisljive (prijava, zgodovina) PRED skrivanjem: skrito in prepovedano zmaga tudi prek povezave
  const nastavitve = await nastavitveAgenta(agent, dom);
  const skrij = await prekrij(s.prepovedane ?? []);
  const net = await omrezjeAgenta(root, o);
  return [
    ...net.pred, bwrap, ...osnovaPeskovnika(process.env, false), ...net.dns, ...nastavitve, ...(await skritoVPeskovniku(root, o, agent)), ...pisanje,
    ...skrij, "--chdir", delovna, "--",
  ];
}

/**
 * Mapa naloge in porocilo: brez sledenja simbolnim povezavam (agent bi lahko povezavo podtaknil namesto porocila). Drugi pregled 0.2.10:
 * odpiranje brez blokiranja (O_NONBLOCK: cev brez pisca ne ustavi stanja in vrste, CodeRabbit), samo navadna datoteka z ENO povezavo
 * (trda povezava na tujo datoteko, N4) in istim lastnikom kot Lina; mapa naloge mora biti ista kot ob zagonu (dev:ino).
 * shortcut: med preverbo mape in odprtjem ostane kratko okno (Node nima openat); agent ima tako ali tako dostop do istih datotek.
 */
async function preberiPorocilo(root: string, z: ZapisNaloge): Promise<{ besedilo: string; cas: string } | null> {
  const p = await preberiDatotekoNaloge(root, z, DATOTEKA_POROCILA, NAJVEC_BAJTOV_POROCILA, "rezi");
  return p && { besedilo: ocistiPorocilo(p.besedilo), cas: p.cas };
}

/**
 * Datoteka iz mape naloge (POROCILO.md, nacrt.html) z enakimi ovirami za vse: brez simbolnih povezav, ena povezava, isti uid, mapa naloge
 * ista kot ob zagonu. »rezi«: preberi do meje (porocilo); »cela«: vecja od meje = null (nacrt); »preveri«: samo ovire, brez branja.
 */
async function preberiDatotekoNaloge(
  root: string, z: ZapisNaloge, ime: string, meja: number, nacin: "rezi" | "cela" | "preveri",
): Promise<{ besedilo: string; cas: string } | null> {
  // Lina kot vodja: naloga s kopijo bere iz kopije, ki mora biti pod <podatki>/delo (ponarejen zapis stanja se ne bere)
  if (z.kopija !== undefined && !vDelu(root, z.kopija)) return null;
  const mapaNalog = path.join(z.kopija ?? z.mapa, MAPA_NALOG);
  const mapaNaloge = path.join(mapaNalog, z.id);
  try {
    for (const p of [mapaNalog, mapaNaloge]) if (!(await lstat(p)).isDirectory()) return null;
    if (z.mapaId && z.mapaId !== (await idMape(mapaNaloge))) return null;
    const ds = await open(path.join(mapaNaloge, ime), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const st = await ds.stat();
      if (!st.isFile() || st.nlink !== 1) return null;
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) return null;
      if (nacin !== "rezi" && st.size > meja) return null;
      if (nacin === "preveri") return { besedilo: "", cas: st.mtime.toISOString() };
      const buf = Buffer.alloc(Math.min(st.size, meja));
      const { bytesRead } = await ds.read(buf, 0, buf.length, 0);
      return { besedilo: buf.subarray(0, bytesRead).toString("utf8"), cas: st.mtime.toISOString() };
    } finally {
      await ds.close();
    }
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ tocke naloge s preverbo dokazov (lastnik 24. 11. 2026)

/**
 * Dokazi iz porocila (nezaupljivo, oceniTocke): pot je navadna datoteka ali mapa v projektu (kopiji), brez simbolne povezave na nobenem
 * delu poti (povezava bi kazala ven); commit obstaja v gitu projekta. Kopija izven <podatki>/delo nima nobenega dokaza.
 */
async function preveriTocke(root: string, z: ZapisNaloge, porocilo: string, o: Odvisnosti): Promise<IzidTocke[]> {
  const delovna = z.kopija ?? z.mapa;
  const veljavna = z.kopija === undefined || vDelu(root, z.kopija);
  return oceniTocke(porocilo, z.tocke?.length ?? 0, delovna, {
    pot: async (rel, mapa) => veljavna && (await potVProjektu(delovna, rel, mapa)),
    commit: async (h) => veljavna && (await gitVodje(depsVodje(o), delovna, ["cat-file", "-e", `${h}^{commit}`])).koda === 0,
  });
}

/** Stanje, ko je agent koncal (porocilo IN terminal ne dela): naloga s tockami je »koncano« samo, ce ima vsaka tocka preverjen dokaz. */
function stanjeKonca(z: ZapisNaloge, izid: IzidTocke[] | undefined): StanjeNaloge {
  return z.tocke?.length && izid && !povzetekTock(z.tocke, izid).popolno ? "nepopolno" : "koncano";
}

/**
 * Predlog nove naloge za manjkajoce tocke (besedilo samo iz tock naloge, nikoli iz porocila). Samo predlog: zagon po lastnikovi potrditvi.
 * Ne uspe (polno cakajocih, mapa ...): predlogTock = »napaka«, manjkajoce ostanejo vidne na nalogi in lastnik lahko predlog ponovi.
 */
async function predlagajManjkajoce(root: string, id: string, izvor: IzvorNaloge, o: Odvisnosti, zdaj: Date): Promise<string | null> {
  const z = (await preberi(root)).naloge.find((n) => n.id === id);
  if (!z?.tocke || !z.izidTock || z.stanje !== "nepopolno") return null;
  const besedilo = besediloPredlogaTock(z.id, povzetekTock(z.tocke, z.izidTock), NAJVEC_ZNAKOV_NALOGE_LINE);
  const predlog = await dodajPredlog(root, izvor, z.mapa, besedilo, o, zdaj, z.agent ?? "claude").catch(() => null);
  await vVrsti(root, async () => {
    const s = await preberi(root);
    const m = s.naloge.find((n) => n.id === id);
    if (!m) return;
    m.predlogTock = predlog?.id ?? "napaka";
    await zapisi(root, s);
  });
  return predlog?.id ?? null;
}

// ------------------------------------------------------------------ nacrt z diagramom (lastnik 24. 11. 2026)

export const NACRT_NASTAVITVE = "nacrt-diagram.json";

/** Stikalo »najprej nacrt z diagramom«: privzeto VKLOPLJENO; izklopi samo izrecni false (pokvarjena datoteka = vklopljeno). */
export async function jeNacrtVklopljen(dir?: string): Promise<boolean> {
  try {
    const j = JSON.parse(await readFile(path.join(resolveDataDir(dir), NACRT_NASTAVITVE), "utf8")) as { vklopljen?: unknown } | null;
    return j?.vklopljen !== false;
  } catch {
    return true;
  }
}

export async function nastaviNacrt(vklopljen: boolean, dir?: string): Promise<boolean> {
  const v = vklopljen === true;
  await writeJson(resolveDataDir(dir), NACRT_NASTAVITVE, { vklopljen: v });
  return v;
}

/**
 * nacrt.html zagnane naloge za prikaz v izoliranem okvirju: varno branje (kot porocilo, vecji od meje = null) in ovoj s CSP.
 * Samo seja lastnika; naloga, ki je Lina ni zagnala (brez dev:ino mape), nima nacrta.
 */
export async function nacrtClaudeNaloge(token: string | null, id: unknown, dir?: string): Promise<string | null> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!jeIdNaloge(id)) throw new ClaudeNalogaNapaka("ni-najdeno");
  const z = (await preberi(root)).naloge.find((n) => n.id === id);
  if (!z?.mapaId) return null;
  const p = await preberiDatotekoNaloge(root, z, DATOTEKA_NACRTA, NAJVEC_BAJTOV_NACRTA, "cela");
  return p ? ovijNacrt(p.besedilo) : null;
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

async function stanjeAgentov(s: Stanje, o: Odvisnosti, osvezi = false, root?: string): Promise<StanjeAgenta[]> {
  const najdi = o.najdi ?? ((ime: string) => najdiNaPoti(ime));
  const preveri = o.preveriZagon ?? privzetaPreverba;
  let pomnilnik = predpomnilnik.get(preveri);
  if (!pomnilnik || osvezi) predpomnilnik.set(preveri, (pomnilnik = new Map()));
  if (osvezi) await pastaDeluje(o, true);
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
        // A4: agent z omejenimi mapami brez delujocega peskovnika se ne zaganja niti za --version
        p = opis.omejeneMape && !(await peskovnikDeluje(o, preveri))
          ? { pot, stanje: "brez-peskovnika", razlicica: "" }
          : await preveriAgenta(id, pot, opis.omejeneMape ? await preverbaVPeskovniku(id, s, o, preveri, root) : preveri);
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

/**
 * N10: --version in prijava agenta z omejenimi mapami tudi v peskovniku (agent ob zagonu nalozi svoje nastavitve in vticnike, ki jih je
 * morda zapisal v prejsnji nalogi). Vrne preverbo, ki ukaz ovije z bwrap.
 */
async function preverbaVPeskovniku(agent: AgentId, s: Stanje, o: Odvisnosti, preveri: PreverbaZagona, root?: string): Promise<PreverbaZagona> {
  const bwrap = programPeskovnika(o.najdi ?? ((ime: string) => najdiNaPoti(ime)), o.platforma ?? platformaZdaj())!;
  const dom = o.dom ?? homedir();
  const net = await omrezjeAgenta(root, o);
  const predpona = [
    ...osnovaPeskovnika(process.env, false), ...net.dns, ...(await nastavitveAgenta(agent, dom)), ...(await skritoVPeskovniku(root, o, agent)),
    ...(await prekrij(s.prepovedane ?? [])), "--chdir", "/tmp", "--",
  ];
  const [prvi, ...pred] = [...net.pred, bwrap];
  return (program, args, rokMs) => preveri(prvi!, [...pred, ...predpona, program, ...args], rokMs);
}

/** Agent, ki ga Lina sme zagnati z nalogo: vklopljen, preverjen in z zacetnim pozivom. Vrne pot programa. */
async function agentZaNalogo(agent: AgentId, s: Stanje, o: Odvisnosti, root: string): Promise<string> {
  const a = (await stanjeAgentov(s, o, false, root)).find((x) => x.id === agent)!;
  if (!a.vklopljen) throw new ClaudeNalogaNapaka("agent-izklopljen");
  if (a.stanje === "brez-peskovnika") throw new ClaudeNalogaNapaka("peskovnik");
  // claude: stara koda razloga (vmesnik in preizkusi pred 24. 11. 2026)
  if (a.stanje !== "pripravljen" || !a.pot) throw new ClaudeNalogaNapaka(agent === "claude" ? "ni-claude" : "agent-ni-pripravljen");
  if (!a.zacetniPoziv) throw new ClaudeNalogaNapaka("agent-brez-poziva");
  return a.pot;
}

// ------------------------------------------------------------------ zagon (potrditev in razporejevalnik)

/** Porocilo naloge; ko obstaja, gre (enkrat na nalogo, spomin-nalog) se v spomin nalog projekta. */
async function porociloVSpomin(root: string, z: ZapisNaloge): Promise<{ besedilo: string; cas: string } | null> {
  const p = await preberiPorocilo(root, z);
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
  const program = await agentZaNalogo(agent, s, o, root);
  // Opozorilo ob prvem zagonu (lastnik 24. 11. 2026): brez potrditve »Razumem« Lina ne zazene nobenega agenta (tudi iz razporejevalnika).
  if (!(await opozoriloPotrjeno(root))) throw new ClaudeNalogaNapaka("opozorilo");
  if ((await steviloHkratnih(root, s, o, zdaj)) >= NAJVEC_HKRATNIH) throw new ClaudeNalogaNapaka("polno-hkratne");
  if ((await resnicnaMapa(z.mapa, root, s, o)) !== z.mapa) throw new ClaudeNalogaNapaka("mapa");
  await preveriPrepoved(agent, z.mapa, s);
  // Lina kot vodja: v istem projektu ze dela drug agent -> ta naloga dobi svojo kopijo (nikoli ista mapa, nikoli prepis)
  const vKopiji = z.kopija !== undefined || (!z.vloga && potrebujeKopijo(s, z));
  // A1: v isti mapi, nad- ali podmapi ze dela drug agent (ziv terminal ali neznan PID do roka) - ne hkrati na istih datotekah.
  // Velja za nalogo brez kopije (tudi ce sosednja dela v kopiji: previdno); naloga v svoji kopiji ne dela na izvirniku.
  const casZagona = o.casZagona ?? casZagonaProcesa;
  // N5: korak v ISTI kopiji (popravek, spor) ne tece hkrati z agentom, ki v njej se dela
  const ista = (n: ZapisNaloge) => (vKopiji ? z.kopija !== undefined && n.kopija === z.kopija : vPrepovedani(z.mapa, [n.mapa]));
  if (s.naloge.some((n) => n !== z && ista(n) && terminalZaseda(n, zivi(n, casZagona), zdaj))) {
    throw new ClaudeNalogaNapaka("mapa-zasedena");
  }
  if (z.kopija === undefined && vKopiji) {
    try {
      const k = await ustvariKopijo(depsVodje(o), root, z.id, z.mapa);
      z.kopija = k.kopija;
      z.vodja = { projekt: z.mapa, git: k.git, osnova: k.osnova, faza: "dela", krog: 0, najdbe: null, pregledovalec: s.pregledovalec ?? "claude" };
    } catch {
      throw new ClaudeNalogaNapaka("kopija");
    }
  }
  if (z.kopija !== undefined && !vDelu(root, z.kopija)) throw new ClaudeNalogaNapaka("kopija");
  const delovna = z.kopija ?? z.mapa;
  // A4: agent z omejenimi mapami samo v peskovniku (tudi s praznim seznamom prepovedanih); pred NALOGA.md, da zavrnitev ne pusti sledi
  const peskovnik = OPIS_AGENTOV[agent].omejeneMape ? await ovojPeskovnika(root, agent, z, delovna, s, o) : [];

  // slepi pregled: pregledovalec dobi samo diff (brez pregleda projekta in spomina prejsnjih nalog)
  const slepo = z.vloga === "pregled";
  const pregledProjekta = !slepo && jeNovProjekt(s.naloge, z.mapa, z.id)
    ? await sestaviPregledProjekta(z.mapa, { dir: root }).catch(() => "")
    : "";
  const spominKazalo = slepo ? "" : await kazaloZaProjekt(root, z.mapa, { poizvedba: z.besedilo }).catch(() => "");
  // prvi korak NACRT: samo Claude Code ima skil diagram-design, drugi agenti dobijo navodilo za preprost SVG
  // koraki vodje (pregled, popravek, spor) nimajo koraka NACRT: besedilo popravka vsebuje najdbe pregledovalca
  const nacrt = !z.vloga && jeNacrtovanje(z.besedilo) && (await jeNacrtVklopljen(root)) ? (agent === "claude" ? "diagram-design" : "svg") : undefined;
  // tocke naloge (24. 11. 2026): vsaka potrebuje dokaz v porocilu; koraki vodje imajo svojo obliko porocila (razberiNajdbe)
  if (!z.vloga) z.tocke ??= tockeNaloge(z.besedilo);

  // Nova mapa naloge; obstojeca (ali simbolna povezava) se ne uporabi. NALOGA.md samo z »wx« (nikoli prepis).
  const mapaNalog = path.join(delovna, MAPA_NALOG);
  await mkdir(mapaNalog, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e;
  });
  if (!(await lstat(mapaNalog)).isDirectory()) throw new ClaudeNalogaNapaka("naloga-obstaja");
  const mapaNaloge = path.join(mapaNalog, z.id);
  try {
    await mkdir(mapaNaloge, { mode: 0o700 });
    await writeFile(path.join(mapaNaloge, DATOTEKA_NALOGE), vsebinaNaloge(z, zdaj, { pregledProjekta, spominKazalo, nacrt, tocke: z.tocke && navodiloTock(z.tocke) }), { mode: 0o600, flag: "wx" });
  } catch {
    throw new ClaudeNalogaNapaka("naloga-obstaja");
  }

  const najdi = o.najdi ?? ((ime: string) => najdiNaPoti(ime));
  const terminal = ukazTerminala(najdi, o.platforma ?? platformaZdaj(), o.razresi);
  const argv = argvAgenta(agent, pozivZaClaude(z.id));
  // Naloga 23: Claude Code brez peskovnika (Linux, macOS; Windows nima Unix vticnice) tece v Lini (vprasanja za dovoljenje in dnevnik dela v Lini), ne v terminalu
  const vLini = agent === "claude" && !peskovnik.length && !jeWindows(o.platforma ?? platformaZdaj())
    ? (o.zazeniVLini ?? (o.zazeni ? null : zazeniVLini))
    : null;
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
    const pid = vLini
      ? await vLini(root, z.id, program, pozivZaClaude(z.id), delovna, okoljeZaAgenta())
      : await (o.zazeni ?? privzetiZagonTerminala)(terminal.program, [...terminal.predpona, ...peskovnik, program, ...argv], delovna, okoljeZaAgenta());
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

/**
 * Za orkestrator (dodeli pomocniku): stanje naloge in, ko je koncana, njeno porocilo po isti varni poti kot zavihek Racunalnik.
 * null = naloge ni. Koncna stanja so vsa, ki ne cakajo vec (koncano, nepopolno, odklonjeno, poteklo, napaka, preklicano).
 */
export async function izidNalogePomocnika(dir: string | undefined, id: string): Promise<{ koncano: boolean; stanje: string; porocilo: string | null } | null> {
  const root = resolveDataDir(dir);
  const z = (await preberi(root)).naloge.find((n) => n.id === id);
  if (!z) return null;
  const koncano = ["koncano", "nepopolno", "odklonjeno", "poteklo", "napaka", "preklicano"].includes(z.stanje);
  const p = koncano ? await preberiPorocilo(root, z).catch(() => null) : null;
  return { koncano, stanje: z.stanje, porocilo: p?.besedilo ?? null };
}

// ------------------------------------------------------------------ Lina kot vodja: pregled in zdruzitev dela vec agentov

/**
 * Kopija je potrebna, ko v istem projektu ze dela drug agent (tece v izvirniku ali je v poteku pregleda/zdruzitve) ali ko zdruzeno delo
 * caka na »Uveljavi«. Naloga, ki je v projektu sama, dela v izvirniku kot prej (brez pregleda in zdruzitve, zgostitev enaka).
 */
function potrebujeKopijo(s: Stanje, z: ZapisNaloge): boolean {
  return s.naloge.some(
    (n) =>
      n.id !== z.id &&
      n.mapa === z.mapa &&
      ((n.kopija === undefined && (n.stanje === "tece" || n.stanje === "zaganja")) || (n.vodja !== undefined && !jeKoncnaFaza(n.vodja.faza))),
  ) || (s.zdruzitve?.[z.mapa]?.naloge.length ?? 0) > 0; // zdruzeno delo caka na »Uveljavi«: izvirnik se ne sme premakniti mimo njega
}

function depsVodje(o: Odvisnosti, root?: string): DepsVodje {
  return {
    ...(root ? { peskovnik: (mapa: string) => ovojPreizkusa(root, o, mapa) } : {}),
    najdi: o.najdi ?? ((ime: string) => najdiNaPoti(ime)),
    platforma: o.platforma ?? platformaZdaj(),
    izvedi: o.izvedi ?? privzetoIzvedi,
    izvediPreizkus: o.izvediPreizkus ?? privzetoIzvedi,
    okolje: { ...vodiloSeje(okoljeZaAgenta()), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  };
}

/** systemd-run --user potrebuje vodilo seje; ce ga Lina nima v okolju (zagon kot storitev), privzeto /run/user/<uid> kot z-mejo-pomnilnika. */
function vodiloSeje(okolje: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (typeof process.getuid !== "function") return okolje;
  const xdg = okolje.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  return { ...okolje, XDG_RUNTIME_DIR: xdg, DBUS_SESSION_BUS_ADDRESS: okolje.DBUS_SESSION_BUS_ADDRESS || `unix:path=${xdg}/bus` };
}

/** »zamujeno« (Lina se je vmes znova zagnala) ni neuspeh: korak caka lastnikovo potrditev (Zazeni zdaj) kot vsaka zamujena naloga. */
const NEUSPELI_KORAK: readonly StanjeNaloge[] = ["napaka", "poteklo", "odklonjeno", "preklicano"];

/**
 * Naloga, ki jo Lina doda sama za glavno nalogo (pregled, popravek, spor): »dodeljeno« s pogojem zdaj, zagon prek razporejevalnika z
 * ISTIMI vrati kot vsak zagon (agent vklopljen in preverjen, opozorilo, meja hkratnih, mapa izvirnega projekta, prepovedane mape).
 * Pooblastilo: lastnikova potrditev glavne naloge velja za njen pregled in popravke (najvec NAJVEC_KROGOV krogov), nato odloci lastnik.
 */
function dodajKorak(s: Stanje, m: ZapisNaloge, vloga: VlogaNaloge, agent: AgentId, besedilo: string, kopija: string, zdaj: Date): ZapisNaloge | null {
  // N8: besedilo, ki ni sprejeto, nikoli ne postane prazna naloga (samo »popravek«): korak gre k lastniku z razlogom
  const cisto = ocistiBesediloNaloge(besedilo) ?? ocistiBesediloNaloge(besedilo.slice(0, 7000));
  if (!cisto) {
    vLastnika(m, "korak");
    return null;
  }
  const z: ZapisNaloge = {
    id: randomBytes(8).toString("hex"), izvor: "lina", agent, mapa: m.mapa, besedilo: cisto, zgostitev: zgostitevNaloge(m.mapa, cisto, agent),
    stanje: "dodeljeno", ustvarjeno: zdaj.toISOString(), potrjeno: null, razlog: null, pogoj: { vrsta: "zdaj" }, sprozeno: zdaj.toISOString(),
    vloga, za: m.id, kopija,
  };
  s.naloge = obreziZgodovino([...s.naloge, z], zdaj);
  m.vodja!.korak = z.id;
  return z;
}

function vLastnika(m: ZapisNaloge, razlog: RazlogVodje, napaka?: string): void {
  m.vodja!.faza = "lastnik";
  m.vodja!.razlog = razlog;
  delete m.vodja!.opis;
  delete m.vodja!.podrobnost;
  if (napaka === undefined) return;
  const o = opisNapake(napaka);
  m.vodja!.opis = o.opis;
  if (o.podrobnost) m.vodja!.podrobnost = o.podrobnost;
}

/**
 * Tocka 8: zdruzitev po neuspelem »Uveljavi«. Izvirnik je sel NAPREJ (git) -> osvezitev kot prej (korak vodje zdruzi izvirnik in preizkusi).
 * Vse drugo (premaknjena veja, umazan ali spremenjen izvirnik, nevarna nastavitev, patch) -> razlog »uveljavi« z besedilom; vmesnik ponudi
 * »Osvezi na novo osnovo« (ponovna zdruzitev pregledanega dela na trenutni izvirnik, preizkusi, ob sporu nov pregled) in »Prenesi kot popravek«.
 */
export function zdruzitevPoNeuspehu(zd: Zdruzitev, napaka: string): Zdruzitev {
  const { opis: _o, podrobnost: _p, ...brez } = zd;
  if (napaka === "izvirnik: premaknjen" && zd.git && zd.razlog !== "vrnjen") return { ...brez, osvezi: true, razlog: null };
  const o = opisNapake(napaka);
  return { ...brez, osvezi: false, razlog: "uveljavi", opis: o.opis, ...(o.podrobnost ? { podrobnost: o.podrobnost } : {}) };
}

function potDiffa(root: string, m: ZapisNaloge): string {
  return path.join(root, MAPA_DELA_VODJE, m.id, `krog-${m.vodja!.krog}.diff`);
}

type IzidDela = { ok: true; v: unknown } | { ok: false; napaka: string };
type DeloVodje = { id: string; izvedi: () => Promise<unknown>; zapisi: (s: Stanje, m: ZapisNaloge, izid: IzidDela) => void };

/** Naslednje delo vodje iz stanja (klice se v vVrsti); pocasni del (git, diff, preizkusi) je v izvedi, zunaj vrste. */
async function izberiDeloVodje(root: string, s: Stanje, o: Odvisnosti, zdaj: Date): Promise<DeloVodje | null> {
  const d = depsVodje(o, root);
  for (const m of s.naloge) {
    const v = m.vodja;
    if (!v || jeKoncnaFaza(v.faza) || m.kopija === undefined) continue;
    const kopija = m.kopija;
    // diff za pregled: glavni agent, popravek ali razresitev spora je koncal
    const diffInPregled = (): DeloVodje => ({
      id: m.id,
      izvedi: async () => {
        const krog = v.krog + 1;
        const df = await diffKopije(d, root, m.id, kopija, v, krog);
        return { df, krog, mapa: df.prazen ? null : await pripraviPregled(root, m.id, krog, df.pot) };
      },
      zapisi: (s2, m2, izid) => {
        if (!izid.ok) return vLastnika(m2, "diff", izid.napaka);
        const r = izid.v as { df: { sha: string; prazen: boolean; glava?: string }; krog: number; mapa: string | null };
        if (r.df.prazen || !r.mapa) {
          m2.vodja!.faza = "prazno";
          return;
        }
        const agent = s2.pregledovalec ?? "claude";
        m2.vodja!.krog = r.krog;
        m2.vodja!.diff = r.df.sha;
        if (r.df.glava) m2.vodja!.glava = r.df.glava;
        m2.vodja!.pregledovalec = agent;
        m2.vodja!.faza = "pregled";
        dodajKorak(s2, m2, "pregled", agent, navodiloPregleda(), r.mapa, zdaj);
      },
    });
    if (v.faza === "dela") {
      // nepopolna naloga je tudi koncala delo: pregled in zdruzitev tega, kar je narejeno (manjkajoce gredo v predlog)
      if (m.stanje === "koncano" || m.stanje === "nepopolno") return diffInPregled();
      if (NEUSPELI_KORAK.includes(m.stanje)) return { id: m.id, izvedi: async () => null, zapisi: (_s, m2) => vLastnika(m2, "korak") };
      continue;
    }
    if (v.faza === "pregled" || v.faza === "popravek" || v.faza === "spor") {
      const k = s.naloge.find((n) => n.id === v.korak);
      if (!k || NEUSPELI_KORAK.includes(k.stanje)) return { id: m.id, izvedi: async () => null, zapisi: (_s, m2) => vLastnika(m2, "korak") };
      if (k.stanje !== "koncano") continue;
      if (v.faza !== "pregled") return diffInPregled();
      const porocilo = (await preberiPorocilo(root, k))?.besedilo ?? "";
      return {
        id: m.id,
        izvedi: async () => null,
        zapisi: (s2, m2) => {
          const najdbe = razberiNajdbe(porocilo);
          m2.vodja!.najdbe = najdbe;
          if (najdbe === 0) m2.vodja!.faza = "zdruzi";
          else if (m2.vodja!.krog >= NAJVEC_KROGOV) vLastnika(m2, "krogi");
          else {
            m2.vodja!.faza = "popravek";
            dodajKorak(s2, m2, "popravek", m2.agent ?? "claude", besediloPopravka(porocilo), kopija, zdaj);
          }
        },
      };
    }
  }
  // zdruzitev po vrsti: najprej naloga, ki je prej koncala; ena zdruzitev naenkrat (to je edino delo, dokler tece)
  const cakajo = s.naloge
    .filter((m) => m.vodja?.faza === "zdruzi" && m.kopija !== undefined)
    .sort((a, b) => Date.parse(a.koncano ?? "") - Date.parse(b.koncano ?? ""));
  const m = cakajo[0];
  if (!m) return osvezitev(root, s, d);
  const v = m.vodja!;
  const prej = s.zdruzitve?.[v.projekt];
  const diff = potDiffa(root, m);
  const nastavljeni = s.preizkusi?.[v.projekt];
  return {
    id: m.id,
    izvedi: async () => {
      const omejeno = OPIS_AGENTOV[jeAgent(m.agent) ? m.agent : "claude"].omejeneMape;
      const r = await zdruzi(d, root, prej, { id: m.id, vodja: v, omejeno }, diff, nastavljeni);
      const spor = r.izid === "spor" && !r.zd.git ? await pripraviSporMape(root, m.id, r.zd, diff) : null;
      return { r, spor };
    },
    zapisi: (s2, m2, izid) => {
      if (!izid.ok) return vLastnika(m2, "zdruzitev", izid.napaka);
      const { r, spor } = izid.v as { r: Awaited<ReturnType<typeof zdruzi>>; spor: Awaited<ReturnType<typeof pripraviSporMape>> | null };
      s2.zdruzitve = { ...s2.zdruzitve, [r.zd.projekt]: r.zd };
      if (r.izid === "ok") m2.vodja!.faza = "zdruzeno";
      else if (r.izid === "padlo") vLastnika(m2, "preizkusi");
      else if (r.izid === "brez-meje") vLastnika(m2, "brez-meje");
      else if (r.izid === "brez-peskovnika") vLastnika(m2, "brez-peskovnika");
      else {
        if (spor) {
          m2.kopija = spor.kopija;
          m2.vodja!.osnova = spor.osnova;
        }
        m2.vodja!.faza = "spor";
        dodajKorak(s2, m2, "spor", m2.agent ?? "claude", besediloSpora(r.zd.git, spor ? spor.vir : r.zd.veja!), m2.kopija!, zdaj);
      }
    },
  };
}

/** Posodobitev zdruzitve z izvirnikom, ki je sel naprej (po lastnikovem »Uveljavi«, ki je bil zato zavrnjen). */
function osvezitev(root: string, s: Stanje, d: DepsVodje): DeloVodje | null {
  const zd = Object.values(s.zdruzitve ?? {}).find((z) => z.osvezi);
  if (!zd) return null;
  const nastavljeni = s.preizkusi?.[zd.projekt];
  return {
    id: "",
    izvedi: () => osveziZIzvirnikom(d, root, zd, nastavljeni),
    zapisi: (s2, _m, izid) => {
      const nova: Zdruzitev = izid.ok
        ? (() => {
            const r = izid.v as Awaited<ReturnType<typeof osveziZIzvirnikom>>;
            return { ...r.zd, razlog: r.izid === "ok" ? null : r.izid === "padlo" ? "padlo" : r.izid === "brez-meje" || r.izid === "brez-peskovnika" ? r.izid : (r.zd.razlog ?? "spor") };
          })()
        : { ...zd, razlog: "spor" };
      s2.zdruzitve = { ...s2.zdruzitve, [zd.projekt]: { ...nova, osvezi: false } };
    },
  };
}

/** Delo vodje tece za ta koren (pocasni del zunaj vVrsti); »Uveljavi« ga ne sme prehiteti. */
const vodjaDela = new Set<string>();

/**
 * Korak vodje (casovnik po vsakem koraku razporejevalnika; stanje je v zapisu, zato prezivi ponovni zagon Line). Izbira in zapis v vVrsti,
 * pocasno delo (diff, zdruzitev, preizkusi do 20 min) zunaj, da vmesnik in vrsta ne cakata. Dodelitev ga NE caka (samo casovnik).
 */
export async function korakVodje(dir: string | undefined, o: Odvisnosti = {}, zdaj = new Date()): Promise<void> {
  const root = resolveDataDir(dir);
  for (let i = 0; i < 20; i++) {
    const delo = await vVrsti(root, async () => {
      if (vodjaDela.has(root)) return null;
      const d = await izberiDeloVodje(root, await preberi(root), o, zdaj);
      if (d) vodjaDela.add(root);
      return d;
    });
    if (!delo) return;
    try {
      let izid: IzidDela;
      try {
        izid = { ok: true, v: await delo.izvedi() };
      } catch (e) {
        // tocka 7: sporocilo napake ostane (vLastnika ga prevede v kodo opisa za besedilo SL/EN)
        izid = { ok: false, napaka: e instanceof Error ? e.message : "" };
      }
      await vVrsti(root, async () => {
        const s = await preberi(root);
        const m = s.naloge.find((n) => n.id === delo.id);
        if (delo.id && !m?.vodja) return;
        delo.zapisi(s, m as ZapisNaloge, izid);
        await zapisi(root, s);
      });
    } finally {
      vodjaDela.delete(root);
    }
  }
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
  const nepopolne: string[] = [];
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
        if (z.tocke?.length) z.izidTock = await preveriTocke(root, z, p.besedilo, o);
        z.stanje = stanjeKonca(z, z.izidTock);
        z.koncano = zdaj.toISOString();
        if (!zeKoncana) koncane.push(dogodekKoncana(z));
        if (z.stanje === "nepopolno" && z.predlogTock === undefined) nepopolne.push(z.id);
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
  // zunaj vVrsti (dodajPredlog ima svojo); enkrat na nalogo (predlogTock)
  for (const id of nepopolne) await predlagajManjkajoce(root, id, "lina", o, zdaj).catch(() => null);
}

const KLJUC_RAZPOREDA = Symbol.for("lina.agenti.razporejevalnik");
const KORAK_MS = 30_000;
/** Casovnik razporejevalnika (enkrat na proces; ob zagonu Line se zamujene naloge NE zazenejo - postanejo »zamujeno«). */
export function zazeniRazporejevalnik(dir?: string): void {
  const g = globalThis as { [KLJUC_RAZPOREDA]?: ReturnType<typeof setInterval> };
  if (g[KLJUC_RAZPOREDA]) return;
  const c = setInterval(
    () =>
      void korakRazporejevalnika(dir)
        .catch(() => undefined)
        .then(() => korakVodje(dir))
        .catch(() => undefined),
    KORAK_MS,
  );
  c.unref?.();
  g[KLJUC_RAZPOREDA] = c;
}

// ------------------------------------------------------------------ javno stanje in ukazi

/** Predlog za manjkajoce tocke, ki ga lastnik se lahko potrdi ali je ze sprejet; odklonjen, potekel ali izgubljen = »napaka« (gumb za nov predlog). */
function veljavenPredlog(s: Stanje, z: ZapisNaloge, zdaj: Date): string | null {
  if (!z.predlogTock) return null;
  const p = s.naloge.find((n) => n.id === z.predlogTock);
  return !p || jePotekel(p, zdaj) || ["poteklo", "odklonjeno", "napaka"].includes(p.stanje) ? "napaka" : p.id;
}

async function javno(root: string, s: Stanje, o: Odvisnosti, zdaj: Date): Promise<JavnoStanjeNalog> {
  const agenti = await stanjeAgentov(s, o, false, root);
  const terminal = razlogTerminala(o);
  // izklopljen Claude Code ne pomeni, da Lina nima agentov (A3)
  const claude = agenti.find((a) => a.id === "claude")!.stanje;
  const razlog = terminal ?? (claude === "pripravljen" || claude === "izklopljen" ? null : "ni-claude");
  const casZagona = o.casZagona ?? casZagonaProcesa;
  const naloge: JavnaNaloga[] = [];
  for (const z of [...s.naloge].reverse()) {
    const zagnana = z.stanje === "tece" || z.stanje === "zaganja" || z.stanje === "koncano" || z.stanje === "nepopolno";
    const p = zagnana ? await porociloVSpomin(root, z) : null;
    const nacrt = zagnana && !!z.mapaId && (await preberiDatotekoNaloge(root, z, DATOTEKA_NACRTA, NAJVEC_BAJTOV_NACRTA, "preveri")) !== null;
    // A2: »koncano« samo, ko porocilo obstaja IN terminal ne dela (enako kot razporejevalnik)
    const dela = terminalZaseda(z, zivi(z, casZagona), zdaj);
    const konec = (z.stanje === "tece" || z.stanje === "zaganja") && p !== null && !dela;
    // vmesnik lahko bere pred korakom razporejevalnika: ista preverba tock (zapise jo sele razporejevalnik)
    const izidTock = z.izidTock ?? (konec && z.tocke?.length ? await preveriTocke(root, z, p!.besedilo, o) : undefined);
    const stanje: StanjeNaloge = konec ? stanjeKonca(z, izidTock) : jePotekel(z, zdaj) ? "poteklo" : z.stanje;
    const koncal = stanje === "koncano" || stanje === "nepopolno";
    naloge.push({
      id: z.id, izvor: z.izvor, agent: z.agent ?? "claude", mapa: z.mapa, besedilo: z.besedilo, zgostitev: z.zgostitev, stanje,
      ustvarjeno: z.ustvarjeno, potrjeno: z.potrjeno, razlog: z.razlog, porocilo: p?.besedilo ?? null, pogoj: z.pogoj ?? null,
      ocena: z.ocena ?? null, opomnik: z.opomnik ?? null, koncano: z.koncano ?? (konec ? zdaj.toISOString() : null), nacrt,
      kopija: z.kopija ?? null, vloga: z.vloga ?? null, za: z.za ?? null, vodja: z.vodja ?? null,
      tocke: koncal && z.tocke?.length && izidTock ? povzetekTock(z.tocke, izidTock) : null, predlogTock: veljavenPredlog(s, z, zdaj),
    });
  }
  const zdruzitve = Object.values(s.zdruzitve ?? {}).map(({ projekt, pot, git, veja, naloge, zgostitev, diff, osvezi, razlog, opis, podrobnost, izvoz }) => ({
    projekt, pot, git, veja, naloge, zgostitev, diff, osvezi: osvezi === true, razlog: razlog ?? null, opis: opis ?? null, podrobnost: podrobnost ?? null,
    izvoz: izvoz ?? null,
  }));
  const omejeni = agenti.some((a) => a.omejeneMape && a.pot && a.stanje !== "brez-peskovnika");
  const omrezjeAgentov = !omejeni ? null : (await pastaDeluje(o)) ? "loceno" : "gostitelj";
  return {
    naVoljo: razlog === null, razlogNiNaVoljo: razlog, geslo: await ownerExists(root), mape: s.mape, naloge, agenti, prepovedane: s.prepovedane ?? [],
    pregledovalec: s.pregledovalec ?? "claude", preizkusi: s.preizkusi ?? {}, zdruzitve, omrezjeAgentov,
  };
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
    await agentZaNalogo(agent, s, o, root);
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
  agent: { agent?: string; pogoj?: string; brezDovoljenjaPodobnih?: boolean } = {},
): Promise<ZapisNaloge | null> {
  try {
    const pogoj = agent.pogoj === undefined ? undefined : pogojIzOznake(agent.pogoj, zdaj);
    if (pogoj === null) return null;
    const root = resolveDataDir(dir);
    const z = await dodajPredlog(root, "lina", mapa, besedilo, o, zdaj, agent.agent ?? "claude", pogoj);
    // Lastnik je ze dovolil podobne naloge (isti agent, ista kanonicna mapa; Nastavitve > Dovoljenja): ista pot kot njegova potrditev,
    // zato veljajo opozorilo, agent, prepovedane mape in meje. Ce potrditev ne uspe, predlog ostane in caka lastnika.
    // B1 (1750): obseg ne vsebuje besedila naloge, zato tvegano besedilo (brisanje, push, posiljanje, placilo, kljuci, sudo,
    // namestitev; lahko vbrizgano iz vsebine, ki jo bere model) vedno caka lastnika.
    // Naloga 8 (pregled V2): predlog orkestratorja (besedilo izbere model, ki bere izide orodij) dovoljenja podobnih ne uporabi.
    if (!agent.brezDovoljenjaPodobnih && !jeTveganoDejanje(z.besedilo) && await najdiDovoljenje(root, "naloga-agentu", { agent: z.agent ?? "claude", mapa: z.mapa }, {}, zdaj)) {
      try {
        await potrdi(root, z.id, z.zgostitev, o, zdaj);
      } catch {
        return z;
      }
      return (await preberi(root)).naloge.find((n) => n.id === z.id) ?? z;
    }
    return z;
  } catch {
    return null;
  }
}

/** Potrditev predloga (»caka«) ali zamujene dodeljene naloge (»zamujeno«): zgostitev mora biti ista, kot jo je lastnik videl. */
async function potrdi(root: string, id: string, zgostitev: unknown, o: Odvisnosti, zdaj: Date): Promise<ZapisNaloge> {
  return vVrsti(root, async () => {
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
      await agentZaNalogo(z.agent ?? "claude", s, o, root);
      if (!(await opozoriloPotrjeno(root))) throw new ClaudeNalogaNapaka("opozorilo");
      z.stanje = "dodeljeno";
      await zapisi(root, s);
      return z;
    }
    if (z.stanje === "zamujeno") z.sprozeno = zdaj.toISOString();
    await zazeniZapis(root, s, z, o, zdaj);
    return z;
  });
}

/**
 * Izbira »Velja tudi za vse podobne« ob potrditvi ali dodelitvi v seji lastnika (samo strogo `true`): podobno = isti agent in ista
 * kanonicna mapa. Nikoli iz predloga Line ali besedila naloge (te poti ta funkcija ne doseze).
 */
async function dovoliPodobne(root: string, podobne: unknown, z: ZapisNaloge, zdaj: Date): Promise<void> {
  if (podobne !== true) return;
  await zapisiDovoljenje(root, "naloga-agentu", { agent: z.agent ?? "claude", mapa: z.mapa }, { kdo: "lastnik" }, zdaj);
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

const Z_GESLOM = ["pripravi", "potrdi", "mape", "dodeli", "agenti", "prepovedane", "uveljavi", "pregledovalec", "preizkusi", "vodja-zdruzi", "opusti-zdruzitev", "zdruzitev-znova", "izvozi-zdruzitev", "predlagaj-tocke"];

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
      await dovoliPodobne(root, u.podobne, await potrdi(root, u.id, u.zgostitev, o, zdaj), zdaj);
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
      await dovoliPodobne(root, u.podobne, await dodeli(root, "lastnik", u, o, zdaj), zdaj);
      break;
    case "predlagaj-tocke": {
      // lastnik ponovi predlog za manjkajoce tocke (prejsnji ni uspel ali je potekel); spet samo predlog, ki caka potrditev
      if (!jeIdNaloge(u.id)) throw new ClaudeNalogaNapaka("ni-najdeno");
      if (!(await predlagajManjkajoce(root, u.id, "lastnik", o, zdaj))) throw new ClaudeNalogaNapaka("polno-cakajoce");
      break;
    }
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
        s.podpisPrepovedanih = await podpisSeznama(root, "prepovedane", mape);
        await zapisi(root, s);
      });
      break;
    }
    case "pregledovalec": {
      if (!jeAgent(u.agent)) throw new ClaudeNalogaNapaka("agent");
      const agent = u.agent;
      if (!OPIS_AGENTOV[agent].zacetniPoziv) throw new ClaudeNalogaNapaka("agent-brez-poziva");
      await vVrsti(root, async () => {
        const s = await preberi(root);
        s.pregledovalec = agent;
        await zapisi(root, s);
      });
      break;
    }
    case "preizkusi": {
      const projekt = absolutnaPot(u.projekt);
      if (!Array.isArray(u.ukazi) || u.ukazi.length > NAJVEC_UKAZOV_PREIZKUSOV || !u.ukazi.every(jeArgvPreizkusa)) throw new ClaudeNalogaNapaka("ukaz");
      const ukazi = u.ukazi as string[][];
      await vVrsti(root, async () => {
        const s = await preberi(root);
        const p = { ...s.preizkusi };
        // prazen seznam = zaznani ukazi (npm test, tsc)
        if (ukazi.length) p[projekt] = ukazi;
        else delete p[projekt];
        s.preizkusi = p;
        await zapisi(root, s);
      });
      break;
    }
    case "vodja-zdruzi": {
      // lastnik po zadnjem krogu z najdbami odloci, da se delo vseeno zdruzi (zdruzitev s preizkusi; izvirnik sele z »Uveljavi«)
      const id = u.id;
      if (!jeIdNaloge(id)) throw new ClaudeNalogaNapaka("ni-najdeno");
      await vVrsti(root, async () => {
        const s = await preberi(root);
        const m = s.naloge.find((n) => n.id === id && n.vodja?.faza === "lastnik" && n.vodja.razlog === "krogi");
        if (!m) throw new ClaudeNalogaNapaka("ni-najdeno");
        m.vodja!.faza = "zdruzi";
        delete m.vodja!.razlog;
        await zapisi(root, s);
      });
      break;
    }
    case "uveljavi": {
      const projekt = absolutnaPot(u.projekt);
      if (typeof u.zgostitev !== "string" || !/^[a-f0-9]{64}$/.test(u.zgostitev)) throw new ClaudeNalogaNapaka("zgostitev");
      const zgostitev = u.zgostitev;
      await vVrsti(root, async () => {
        if (vodjaDela.has(root)) throw new ClaudeNalogaNapaka("zaposleno");
        const s = await preberi(root);
        const zd = s.zdruzitve?.[projekt];
        if (!zd || !zd.naloge.length) throw new ClaudeNalogaNapaka("ni-zdruzitve");
        try {
          await uveljavi(depsVodje(o), root, zd, zgostitev);
        } catch (e) {
          const sporocilo = e instanceof Error ? e.message : "";
          if (sporocilo === "zgostitev") throw new ClaudeNalogaNapaka("zgostitev");
          // izvirnik je sel naprej: osvezitev; sicer razlog z besedilom in izhodom (tocka 8: nikoli ista zavrnitev brez poti naprej)
          s.zdruzitve = { ...s.zdruzitve, [projekt]: zdruzitevPoNeuspehu(zd, sporocilo) };
          await zapisi(root, s);
          throw new ClaudeNalogaNapaka("izvirnik");
        }
        for (const m of s.naloge) if (m.vodja?.faza === "zdruzeno" && zd.naloge.includes(m.id)) m.vodja.faza = "uveljavljeno";
        const ostale = { ...s.zdruzitve };
        delete ostale[projekt];
        s.zdruzitve = ostale;
        await zapisi(root, s);
      });
      break;
    }
    case "zdruzitev-znova": {
      // tocka 8, izhod 1: pregledano delo se znova zdruzi na TRENUTNI izvirnik (nova zdruzitev s preizkusi; spor -> agent -> nov pregled).
      // Stara zdruzitev ostane na disku (brez brisanja); izvirnik se ne spremeni; lastnik potrdi novo zgostitev.
      const projekt = absolutnaPot(u.projekt);
      await vVrsti(root, async () => {
        if (vodjaDela.has(root)) throw new ClaudeNalogaNapaka("zaposleno");
        const s = await preberi(root);
        const zd = s.zdruzitve?.[projekt];
        if (!zd) throw new ClaudeNalogaNapaka("ni-zdruzitve");
        for (const m of s.naloge) {
          if (m.vodja?.faza === "zdruzeno" && zd.naloge.includes(m.id)) {
            m.vodja.faza = "zdruzi";
            delete m.vodja.razlog;
          }
        }
        const ostale = { ...s.zdruzitve };
        delete ostale[projekt];
        s.zdruzitve = ostale;
        await zapisi(root, s);
      });
      break;
    }
    case "izvozi-zdruzitev": {
      // tocka 8, izhod 2: pregledani diff kot datoteka za rocni pregled in uveljavitev (izvirnik se ne spremeni)
      const projekt = absolutnaPot(u.projekt);
      await vVrsti(root, async () => {
        if (vodjaDela.has(root)) throw new ClaudeNalogaNapaka("zaposleno");
        const s = await preberi(root);
        const zd = s.zdruzitve?.[projekt];
        if (!zd) throw new ClaudeNalogaNapaka("ni-zdruzitve");
        const pot = await izvoziZdruzitev(root, zd).catch(() => {
          throw new ClaudeNalogaNapaka("izvirnik");
        });
        s.zdruzitve = { ...s.zdruzitve, [projekt]: { ...zd, izvoz: pot } };
        await zapisi(root, s);
      });
      break;
    }
    case "opusti-zdruzitev": {
      // izhod iz zataknjene zdruzitve (izvirnik vrnjen, spor ali padli preizkusi pri posodobitvi): samo zapis stanja; mape, worktree in
      // veje ostanejo (brez brisanja), izvirnik se ne spremeni; zdruzene naloge gredo k lastniku
      const projekt = absolutnaPot(u.projekt);
      await vVrsti(root, async () => {
        if (vodjaDela.has(root)) throw new ClaudeNalogaNapaka("zaposleno");
        const s = await preberi(root);
        const zd = s.zdruzitve?.[projekt];
        if (!zd) throw new ClaudeNalogaNapaka("ni-zdruzitve");
        for (const m of s.naloge) if (m.vodja?.faza === "zdruzeno" && zd.naloge.includes(m.id)) vLastnika(m, "zdruzitev");
        const ostale = { ...s.zdruzitve };
        delete ostale[projekt];
        s.zdruzitve = ostale;
        await zapisi(root, s);
      });
      break;
    }
    case "preveri-agente":
      await stanjeAgentov(await preberi(root), o, true, root);
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
        s.podpisMap = await podpisSeznama(root, "mape", s.mape);
        // prazen, se nikoli podpisan seznam prepovedanih (privzeto) podpise lastnik z istim ukazom; obstojecega ne (podtaknjen bi postal veljaven)
        if (!s.podpisPrepovedanih && !s.prepovedane?.length) s.podpisPrepovedanih = await podpisSeznama(root, "prepovedane", []);
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

export async function telefonDodeli(
  dir: string | undefined, agent: unknown, mapa: unknown, besedilo: unknown, pogoj: unknown, o: Odvisnosti = {}, zdaj = new Date(),
  m: { samodejno?: boolean } = {},
): Promise<{ id: string }> {
  const root = resolveDataDir(dir);
  if (!(await ownerExists(root))) throw new ClaudeNalogaNapaka("geslo");
  // Naloga 18: stikalo »Lina sama zazene agente« izklopljeno - naloga s telefona je samo predlog, ki caka lastnikovo potrditev na racunalniku
  const z = m.samodejno === false
    ? await dodajPredlog(root, "telefon", mapa, besedilo, o, zdaj, agent, pogoj)
    : await dodeli(root, "telefon", { agent, mapa, besedilo, pogoj }, o, zdaj);
  return { id: z.id };
}

export async function telefonPreklici(dir: string | undefined, id: unknown, _o: Odvisnosti = {}): Promise<void> {
  await preklici(resolveDataDir(dir), id);
}
