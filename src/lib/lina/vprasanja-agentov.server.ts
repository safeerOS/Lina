/**
 * Vprasanja in dnevnik dela agenta v Lini (naloga 23, del 1; cisti del v vprasanja-agentov.ts).
 *
 * zazeniVLini: Claude Code brez okna (-p, stream-json) v delovni mapi, okolje agenta (okoljeZaAgenta), stdin zaprt, lastna skupina procesov.
 * Za vsak zagon: mapa <podatki>/vpr (0700), vticnica <id>.s, MCP konfiguracija in pomocnik (0600, »wx«), nakljucen zeton (32 bajtov).
 * Po vticnici pride SAMO vprasanje (z zetonom); odgovor da lastnik: racunalnik (seja + geslo za »dovoli«) ali telefon (podpis naprave preveri
 * asistent-streznik.server.ts). Rok, konec agenta in ponovni zagon Line vprasanje zavrnejo; pozen odgovor ne velja (vprasanje ni vec odprto).
 * Dnevnik odlocitev: <podatki>/vprasanja-agentov-odlocitve.jsonl (0600), predogled omejen + zgostitev vnosa.
 * shortcut: stanje zagonov je v pomnilniku procesa Line (en proces); po ponovnem zagonu Line ostane samo dnevnik odlocitev.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, chmod, lstat, appendFile, writeFile, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { ownerExists, requireOwner } from "./auth.server.ts";
import { resolveDataDir } from "./store.server.ts";
import {
  DNEVNIK_ODLOCITEV,
  IME_STREZNIKA_VPRASANJ,
  MAPA_VPRASANJ,
  NAJVEC_ODPRTIH_VPRASANJ,
  NAJVEC_PREDOGLED_TELEFON,
  NAJVEC_VRSTIC_DNEVNIKA,
  PROGRAM_POMOCNIKA,
  ROK_ORODJA_MCP_MS,
  ROK_VPRASANJA_MS,
  VprasanjeNapaka,
  argvClaudeVLini,
  cisto,
  predogledVnosa,
  predogledZaDnevnik,
  razvrstiDejanje,
  vrsticaDnevnika,
  zgostitevVnosa,
  zgostitevVprasanja,
  type Odlocitev,
  type RazlogNevarnosti,
} from "./vprasanja-agentov.ts";

export type JavnoVprasanje = {
  id: string;
  naloga: string;
  orodje: string;
  predogled: string;
  /** Celoten vnos ni viden v predogledu: »dovoli« ni mogoc (samo zavrni). */
  odrezano: boolean;
  razlogi: RazlogNevarnosti[];
  nevarno: boolean;
  cas: string;
  rok: string;
  zgostitev: string;
  stanje: "caka" | "dovoljeno" | "zavrnjeno";
  kdo: string | null;
};

export type JavniTek = {
  naloga: string;
  mapa: string;
  stanje: "tece" | "koncano" | "napaka";
  zacetek: string;
  konec: string | null;
  vrstice: string[];
  /** Pot vticnice (samo za preizkuse in diagnozo na racunalniku; telefon je ne dobi). */
  vticnica: string | null;
};

export type StanjeVprasanj = { teki: JavniTek[]; vprasanja: JavnoVprasanje[] };

type Vprasanje = JavnoVprasanje & { vnos: Record<string, unknown>; odgovori: (o: { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }) => void; casovnik: ReturnType<typeof setTimeout> };
/** gesloObZagonu: lastnik je imel geslo ze ob zagonu (geslo, ki ga nastavi sele agent sam, ne odobri nicesar - pregled 25. 11., V1). */
type Tek = Omit<JavniTek, "vrstice"> & { vrstice: string[]; proces: ChildProcess | null; streznik: Server | null; datoteke: string[]; gesloObZagonu: boolean };

/** Najvec zapomnjenih zagonov in zaprtih vprasanj na mapo podatkov (koncani se pozabijo najprej). */
const NAJVEC_TEKOV = 20;
const NAJVEC_ZAPRTIH = 50;
const NAJVEC_VRSTICA_VTICNICE = 256 * 1024;
const NAJVEC_VRSTICA_IZPISA = 256 * 1024;
const NAJVEC_POT_VTICNICE = 100;

type Shramba = { teki: Map<string, Tek>; vprasanja: Map<string, Vprasanje> };
const shrambe = new Map<string, Shramba>();
function shramba(root: string): Shramba {
  let s = shrambe.get(root);
  if (!s) shrambe.set(root, (s = { teki: new Map(), vprasanja: new Map() }));
  return s;
}

function javno(v: Vprasanje): JavnoVprasanje {
  const { vnos: _v, odgovori: _o, casovnik: _c, ...j } = v;
  return j;
}

/** Stanje brez preverbe seje (klicejo ga samo preverjene poti: seja lastnika, podpis naprave, preizkusi). */
export function stanjeVprasanjZaRoot(root: string): StanjeVprasanj {
  const s = shramba(path.resolve(root));
  return {
    teki: [...s.teki.values()].map(({ proces: _p, streznik: _s, datoteke: _d, gesloObZagonu: _g, ...t }) => ({ ...t, vrstice: [...t.vrstice] })),
    vprasanja: [...s.vprasanja.values()].map(javno),
  };
}

async function zapisiOdlocitev(root: string, v: Vprasanje): Promise<void> {
  const zapis = {
    cas: new Date().toISOString(), naloga: v.naloga, id: v.id, orodje: v.orodje, razlogi: v.razlogi, nevarno: v.nevarno,
    predogled: predogledZaDnevnik(v.predogled), zgostitevVnosa: zgostitevVnosa(v.vnos),
    odlocitev: v.stanje === "dovoljeno" ? "dovoli" : "zavrni", kdo: v.kdo,
  };
  const p = path.join(root, DNEVNIK_ODLOCITEV);
  await appendFile(p, JSON.stringify(zapis) + "\n", { mode: 0o600 });
  await chmod(p, 0o600);
}

/**
 * Zapre vprasanje (stanje se spremeni takoj, da drugi odgovor ne velja). »Dovoli« gre agentu SELE po zapisu v dnevnik odlocitev; ce zapis ne
 * uspe, je dejanje zavrnjeno (odobritev brez sledi ni mogoca - pregled 25. 11., S3).
 */
async function zapriVprasanje(root: string, v: Vprasanje, odlocitev: Odlocitev, kdo: string, sporocilo: string): Promise<void> {
  if (v.stanje !== "caka") return;
  clearTimeout(v.casovnik);
  v.stanje = odlocitev === "dovoli" ? "dovoljeno" : "zavrnjeno";
  v.kdo = kdo;
  try {
    await zapisiOdlocitev(root, v);
  } catch {
    if (odlocitev === "dovoli") {
      v.stanje = "zavrnjeno";
      v.kdo = "dnevnik";
      odlocitev = "zavrni";
      sporocilo = "Dnevnik odlocitev ni zapisljiv; dejanje je zavrnjeno.";
    }
  }
  v.odgovori(odlocitev === "dovoli" ? { behavior: "allow", updatedInput: v.vnos } : { behavior: "deny", message: sporocilo });
  const s = shramba(root);
  const zaprta = [...s.vprasanja.values()].filter((x) => x.stanje !== "caka");
  for (const x of zaprta.slice(0, Math.max(0, zaprta.length - NAJVEC_ZAPRTIH))) s.vprasanja.delete(x.id);
}

/**
 * Odgovor lastnika ali naprave. Velja enkrat, samo za odprto vprasanje in samo, ce se zgostitev ujema s prikazanim (zgostitevVprasanja).
 * Stanje se preveri tik pred dejanjem (rok ali konec agenta ga je morda ze zaprl).
 */
export async function odgovoriNaVprasanje(root: string, id: unknown, odlocitev: unknown, zgostitev: unknown, kdo: string): Promise<void> {
  if (typeof id !== "string" || (odlocitev !== "dovoli" && odlocitev !== "zavrni") || typeof zgostitev !== "string") throw new VprasanjeNapaka("oblika");
  const r = path.resolve(root);
  const v = shramba(r).vprasanja.get(id);
  if (!v || v.stanje !== "caka") throw new VprasanjeNapaka("ni-vprasanja");
  const a = Buffer.from(v.zgostitev);
  const b = Buffer.from(zgostitev);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new VprasanjeNapaka("zgostitev");
  if (odlocitev === "dovoli" && v.odrezano) throw new VprasanjeNapaka("odrezano");
  await zapriVprasanje(r, v, odlocitev, kdo, odlocitev === "zavrni" ? "Lastnik je zavrnil." : "");
}

function dodajVrstico(t: Tek, v: string | null): void {
  if (!v) return;
  t.vrstice.push(v);
  if (t.vrstice.length > NAJVEC_VRSTIC_DNEVNIKA) t.vrstice.splice(0, t.vrstice.length - NAJVEC_VRSTIC_DNEVNIKA);
}

/** Bere vrstice toka z mejo dolzine; predolga vrstica se zavrze. */
function poVrsticah(tok: NodeJS.ReadableStream | null | undefined, meja: number, fn: (v: string) => void): void {
  if (!tok) return;
  let b = "";
  let zavrzi = false;
  tok.setEncoding("utf8");
  tok.on("data", (d: string) => {
    b += d;
    let i: number;
    while ((i = b.indexOf("\n")) >= 0) {
      const v = b.slice(0, i);
      b = b.slice(i + 1);
      if (!zavrzi) fn(v);
      zavrzi = false;
    }
    if (b.length > meja) {
      b = "";
      zavrzi = true;
    }
  });
}

function sprejmiVprasanje(root: string, t: Tek, zeton: Buffer, delovna: string, rokMs: number, sock: Socket): void {
  let b = "";
  let prebrano = false;
  sock.setEncoding("utf8");
  const rokPrijave = setTimeout(() => sock.destroy(), 5000);
  sock.on("error", () => undefined);
  sock.on("data", (d: string) => {
    if (prebrano) return;
    b += d;
    if (b.length > NAJVEC_VRSTICA_VTICNICE) return sock.destroy();
    const i = b.indexOf("\n");
    if (i < 0) return;
    prebrano = true;
    clearTimeout(rokPrijave);
    let z: { zeton?: unknown; orodje?: unknown; vnos?: unknown };
    try {
      z = JSON.parse(b.slice(0, i)) as typeof z;
    } catch {
      return sock.destroy();
    }
    const dobljen = Buffer.from(typeof z.zeton === "string" ? z.zeton : "");
    if (dobljen.length !== zeton.length || !timingSafeEqual(dobljen, zeton)) return sock.destroy();
    const poslji = (o: unknown) => {
      if (!sock.destroyed) sock.end(JSON.stringify(o) + "\n");
    };
    const s = shramba(root);
    const orodje = typeof z.orodje === "string" ? cisto(z.orodje, 100) : "";
    const vnos = z.vnos && typeof z.vnos === "object" && !Array.isArray(z.vnos) ? (z.vnos as Record<string, unknown>) : null;
    if (!orodje || !vnos || t.stanje !== "tece") return poslji({ behavior: "deny", message: "Neveljavno vprasanje." });
    // meja na nalogo: zeton je berljiv istemu uporabniku; tuja naloga s ponarejenimi vprasanji ne zasede mest drugih nalog
    if ([...s.vprasanja.values()].filter((x) => x.stanje === "caka" && x.naloga === t.naloga).length >= NAJVEC_ODPRTIH_VPRASANJ) {
      return poslji({ behavior: "deny", message: "Prevec odprtih vprasanj; dejanje je zavrnjeno." });
    }
    const id = randomBytes(8).toString("hex");
    const { predogled, odrezano } = predogledVnosa(vnos);
    const { nevarno, razlogi } = razvrstiDejanje(orodje, vnos, delovna);
    const zdaj = Date.now();
    const v: Vprasanje = {
      id, naloga: t.naloga, orodje, predogled, odrezano, razlogi, nevarno, cas: new Date(zdaj).toISOString(), rok: new Date(zdaj + rokMs).toISOString(),
      zgostitev: zgostitevVprasanja({ id, naloga: t.naloga, orodje, predogled, vnos: zgostitevVnosa(vnos) }), stanje: "caka", kdo: null, vnos,
      odgovori: poslji, casovnik: setTimeout(() => void zapriVprasanje(root, v, "zavrni", "rok", "Rok za odgovor lastnika je potekel; dejanje je zavrnjeno."), rokMs),
    };
    s.vprasanja.set(id, v);
    dodajVrstico(t, `Vprasanje: ${orodje}${nevarno ? ` (${razlogi.join(", ")})` : ""}`);
    // pomocnik je prekinil (agent ustavljen): vprasanje se zapre kot zavrnjeno, ne visi
    sock.on("close", () => void zapriVprasanje(root, v, "zavrni", "prekinjeno", "Povezava je prekinjena."));
  });
}

/** Zivi agenti tega procesa: ob izhodu Line se ustavijo (cela skupina), da ne delajo naprej brez nadzora (pregled 25. 11., S1). */
const zivi = new Set<ChildProcess>();
let izhodPrijavljen = false;
export function ustaviVseVLini(): void {
  for (const p of zivi) {
    try {
      process.kill(-(p.pid as number), "SIGTERM");
    } catch {
      p.kill("SIGTERM");
    }
  }
}

/**
 * Lina se ustavi s signalom (systemd, Ctrl+C, zaprtje okna): agenti se ustavijo, nato signal velja naprej kot privzeto (izhod), razen ce
 * ga obravnava se kdo drug. shortcut: SIGKILL Line ne doseze nicesar - agent tece naprej, vprasanja pa so zavrnjena (vticnice ni vec).
 */
function obSignalu(sig: NodeJS.Signals): void {
  ustaviVseVLini();
  if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
}

export type MoznostiVLini = { rokMs?: number; node?: string };

/**
 * Zagon Claude Code v Lini (Linux). Vrne PID (proces je vodja svoje skupine: ustavitev ubije tudi otroke). Napaka zagona = izjema.
 * `okolje` je ze okolje agenta (okoljeZaAgenta); doda se samo MCP_TOOL_TIMEOUT, da Claude Code ne prekine cakanja na lastnika pred rokom Line.
 */
export async function zazeniVLini(
  root0: string, naloga: string, program: string, poziv: string, delovna: string, okolje: NodeJS.ProcessEnv, m: MoznostiVLini = {},
): Promise<number> {
  const root = path.resolve(root0);
  const s = shramba(root);
  const prejsnji = s.teki.get(naloga);
  if (prejsnji?.stanje === "tece") throw new Error("naloga ze tece");
  const mapa = path.join(root, MAPA_VPRASANJ);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  const st = await lstat(mapa);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("mapa vprasanj ni mapa");
  await chmod(mapa, 0o700);
  const ime = randomBytes(8).toString("hex");
  const vticnica = path.join(mapa, `${ime}.s`);
  if (Buffer.byteLength(vticnica) > NAJVEC_POT_VTICNICE) throw new Error("pot vticnice je predolga");
  const pomocnik = path.join(mapa, `${ime}.mjs`);
  const konfig = path.join(mapa, `${ime}.json`);
  const zeton = randomBytes(32).toString("hex");
  await writeFile(pomocnik, PROGRAM_POMOCNIKA, { mode: 0o600, flag: "wx" });
  await writeFile(konfig, JSON.stringify({
    mcpServers: {
      [IME_STREZNIKA_VPRASANJ]: {
        command: m.node ?? process.execPath,
        args: ["--no-warnings", pomocnik],
        env: { LINA_VPRASANJA_VTICNICA: vticnica, LINA_VPRASANJA_ZETON: zeton },
      },
    },
  }), { mode: 0o600, flag: "wx" });

  const t: Tek = {
    naloga, mapa: delovna, stanje: "tece", zacetek: new Date().toISOString(), konec: null, vrstice: [], vticnica, proces: null, streznik: null,
    datoteke: [vticnica, pomocnik, konfig], gesloObZagonu: await ownerExists(root),
  };
  const rokMs = m.rokMs ?? ROK_VPRASANJA_MS;
  const streznik = createServer((sock) => sprejmiVprasanje(root, t, Buffer.from(zeton), delovna, rokMs, sock));
  streznik.maxConnections = NAJVEC_ODPRTIH_VPRASANJ + 4;
  // brisanje samo lastnih datotek tega zagona (vticnica, pomocnik, konfiguracija z zetonom), nikoli drugih
  const pocisti = () => {
    streznik.close();
    for (const p of t.datoteke) void unlink(p).catch(() => undefined);
  };
  let otrok: ChildProcess;
  try {
    await new Promise<void>((r, z) => {
      streznik.once("error", z);
      streznik.listen(vticnica, () => r());
    });
    await chmod(vticnica, 0o600);
    t.streznik = streznik;
    otrok = spawn(program, argvClaudeVLini(poziv, konfig), {
      cwd: delovna, env: { ...okolje, MCP_TOOL_TIMEOUT: String(ROK_ORODJA_MCP_MS) }, detached: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false,
    });
    await new Promise<void>((r, z) => {
      otrok.once("spawn", () => r());
      otrok.once("error", z);
    });
  } catch (e) {
    pocisti();
    throw e;
  }
  t.proces = otrok;
  poVrsticah(otrok.stdout, NAJVEC_VRSTICA_IZPISA, (v) => dodajVrstico(t, vrsticaDnevnika(v)));
  poVrsticah(otrok.stderr, NAJVEC_VRSTICA_IZPISA, (v) => dodajVrstico(t, cisto(v).trim() || null));
  otrok.once("close", (koda) => {
    t.stanje = koda === 0 ? "koncano" : "napaka";
    t.konec = new Date().toISOString();
    t.proces = null;
    for (const v of s.vprasanja.values()) if (v.naloga === naloga) void zapriVprasanje(root, v, "zavrni", "konec", "Agent je koncal.");
    pocisti();
  });
  s.teki.set(naloga, t);
  zivi.add(otrok);
  otrok.once("close", () => zivi.delete(otrok));
  if (!izhodPrijavljen) {
    izhodPrijavljen = true;
    process.once("exit", ustaviVseVLini);
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(sig, obSignalu);
  }
  const koncani = [...s.teki.values()].filter((x) => x.stanje !== "tece");
  for (const x of koncani.slice(0, Math.max(0, s.teki.size - NAJVEC_TEKOV))) s.teki.delete(x.naloga);
  return otrok.pid as number;
}

// ------------------------------------------------------------------ orkestrator v istem procesu (Lina sama)

/**
 * Tek brez podprocesa: orkestrator (orkestrator.server.ts) pokaze vrstice dela in vprasanja po ISTI poti kot Claude Code v Lini, zato jih
 * vidita znacka na Racunalniku, obvestilo namizja (B7) in telefon (/agent-vprasanja, /agent-vprasanje/odgovor) brez nove poti omrezja.
 * gesloObZagonu je zapisan ob nastanku naloge (preziviti mora ponovni zagon Line), »Dovoli« pa velja samo, ce geslo obstaja tudi zdaj.
 */
export function odpriTekVLini(root0: string, naloga: string, mapa: string, gesloObZagonu: boolean): void {
  const root = path.resolve(root0);
  const s = shramba(root);
  const t = s.teki.get(naloga);
  if (t) {
    t.stanje = "tece";
    t.konec = null;
    return;
  }
  s.teki.set(naloga, { naloga, mapa, stanje: "tece", zacetek: new Date().toISOString(), konec: null, vrstice: [], vticnica: null, proces: null, streznik: null, datoteke: [], gesloObZagonu });
  const koncani = [...s.teki.values()].filter((x) => x.stanje !== "tece");
  for (const x of koncani.slice(0, Math.max(0, s.teki.size - NAJVEC_TEKOV))) s.teki.delete(x.naloga);
}

export function vrsticaTekaVLini(root0: string, naloga: string, besedilo: string): void {
  const t = shramba(path.resolve(root0)).teki.get(naloga);
  if (t) dodajVrstico(t, cisto(besedilo, 500).trim() || null);
}

/** Konec teka zapre tudi njegova odprta vprasanja (kot ob koncu agenta). */
export function koncajTekVLini(root0: string, naloga: string, ok: boolean): void {
  const root = path.resolve(root0);
  const s = shramba(root);
  const t = s.teki.get(naloga);
  if (!t || t.stanje !== "tece") return;
  t.stanje = ok ? "koncano" : "napaka";
  t.konec = new Date().toISOString();
  for (const v of s.vprasanja.values()) if (v.naloga === naloga) void zapriVprasanje(root, v, "zavrni", "konec", "Naloga je koncana.");
}

export type OdgovorVLini = { dovoli: boolean; kdo: string; sporocilo: string };

/**
 * Vprasanje orkestratorja: enaka razvrstitev, predogled, zgostitev, rok (= zavrnitev) in dnevnik odlocitev kot pri Claude Code v Lini.
 * Vrne id (za vezavo v vmesniku) in obljubo odgovora. Brez odprtega teka ali nad mejo odprtih vprasanj = takojsnja zavrnitev.
 */
export function zastaviVprasanjeVLini(root0: string, naloga: string, orodje0: string, vnos: Record<string, unknown>, rokMs = ROK_VPRASANJA_MS): { id: string; odgovor: Promise<OdgovorVLini> } {
  const root = path.resolve(root0);
  const s = shramba(root);
  const t = s.teki.get(naloga);
  const orodje = cisto(orodje0, 100);
  const id = randomBytes(8).toString("hex");
  if (!t || t.stanje !== "tece" || !orodje || [...s.vprasanja.values()].filter((x) => x.stanje === "caka" && x.naloga === naloga).length >= NAJVEC_ODPRTIH_VPRASANJ) {
    return { id, odgovor: Promise.resolve({ dovoli: false, kdo: "lina", sporocilo: "Vprasanja ni mogoce zastaviti." }) };
  }
  let razresi!: (o: OdgovorVLini) => void;
  const odgovor = new Promise<OdgovorVLini>((r) => (razresi = r));
  const { predogled, odrezano } = predogledVnosa(vnos);
  const { nevarno, razlogi } = razvrstiDejanje(orodje, vnos, t.mapa);
  const zdaj = Date.now();
  const v: Vprasanje = {
    id, naloga, orodje, predogled, odrezano, razlogi, nevarno, cas: new Date(zdaj).toISOString(), rok: new Date(zdaj + rokMs).toISOString(),
    zgostitev: zgostitevVprasanja({ id, naloga, orodje, predogled, vnos: zgostitevVnosa(vnos) }), stanje: "caka", kdo: null, vnos,
    odgovori: (o) => razresi(o.behavior === "allow" ? { dovoli: true, kdo: v.kdo ?? "", sporocilo: "" } : { dovoli: false, kdo: v.kdo ?? "", sporocilo: o.message }),
    casovnik: setTimeout(() => void zapriVprasanje(root, v, "zavrni", "rok", "Rok za odgovor lastnika je potekel; dejanje je zavrnjeno."), rokMs),
  };
  v.casovnik.unref?.();
  s.vprasanja.set(id, v);
  dodajVrstico(t, `Vprasanje: ${orodje}${nevarno ? ` (${razlogi.join(", ")})` : ""}`);
  return { id, odgovor };
}

/** Preklic (ustavitev naloge): odprto vprasanje se zapre kot zavrnjeno. */
export function prekliciVprasanjeVLini(root0: string, id: string): void {
  const root = path.resolve(root0);
  const v = shramba(root).vprasanja.get(id);
  if (v) void zapriVprasanje(root, v, "zavrni", "preklic", "Naloga je ustavljena.");
}

// ------------------------------------------------------------------ racunalnik (seja lastnika)

export async function stanjeVprasanj(token: string | null, dir?: string): Promise<StanjeVprasanj> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return stanjeVprasanjZaRoot(root);
}

/**
 * Odgovor z racunalnika. »Dovoli« samo z geslom lastnika: brez gesla ima vsak lokalni proces (tudi agent sam) sejo lastnika in bi si dejanje
 * odobril sam. »Zavrni« je vedno dovoljen.
 */
export async function odgovorVprasanja(token: string | null, vnos: { id?: unknown; odlocitev?: unknown; zgostitev?: unknown }, dir?: string): Promise<StanjeVprasanj> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (vnos?.odlocitev === "dovoli") {
    const v = typeof vnos.id === "string" ? shramba(root).vprasanja.get(vnos.id) : undefined;
    const t = v ? shramba(root).teki.get(v.naloga) : undefined;
    if (!(await ownerExists(root)) || (t && !t.gesloObZagonu)) throw new VprasanjeNapaka("geslo");
  }
  await odgovoriNaVprasanje(root, vnos?.id, vnos?.odlocitev, vnos?.zgostitev, "lastnik");
  return stanjeVprasanjZaRoot(root);
}

// ------------------------------------------------------------------ telefon (podpis naprave preveri asistent-streznik.server.ts)

/** Za telefon: odprta vprasanja (predogled do NAJVEC_PREDOGLED_TELEFON; daljsi = odrezano) in zadnje vrstice dela, brez poti vticnice. */
export function telefonVprasanja(dir?: string): StanjeVprasanj {
  const st = stanjeVprasanjZaRoot(resolveDataDir(dir));
  return {
    teki: st.teki.map((t) => ({ ...t, vrstice: t.vrstice.slice(-30), vticnica: null })),
    vprasanja: st.vprasanja.map((v) => (v.predogled.length > NAJVEC_PREDOGLED_TELEFON ? { ...v, predogled: v.predogled.slice(0, NAJVEC_PREDOGLED_TELEFON), odrezano: true } : v)),
  };
}

export async function telefonOdgovor(dir: string | undefined, id: unknown, odlocitev: unknown, zgostitev: unknown, naprava: string): Promise<void> {
  const root = resolveDataDir(dir);
  // telefon ni videl celega vnosa: samo zavrnitev
  const v = typeof id === "string" ? shramba(root).vprasanja.get(id) : undefined;
  if (odlocitev === "dovoli" && v && v.predogled.length > NAJVEC_PREDOGLED_TELEFON) throw new VprasanjeNapaka("odrezano");
  await odgovoriNaVprasanje(root, id, odlocitev, zgostitev, `naprava:${naprava}`);
}
