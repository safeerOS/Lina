import { execFile, spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imaSlovenskiModul, platformaZdaj, type Platforma } from "./platforma.server.ts";
import { datotekaPaketa } from "./viri-paketa.server.ts";

/**
 * Stalni proces RSDO (lastnik 23. 11. 2026): »se bo naložil v pomnilnik ko ga bo uporabnik vklopil ... izklopil se bo samo ko ga bo
 * uporabnik na stikalu izklopil«. Model se nalozi enkrat (izmerjeno: uvoz + nalaganje ~6 s, nato 5 s posnetka v 0,25 s, ~1,65 GB RAM).
 * Komunikacija samo prek stdin/stdout (vrstice JSON, scripts/rsdo-streznik.py), brez omreznih vrat. Ena zahteva naenkrat.
 * Brez ustavljanja zaradi nedejavnosti; ustavi ga samo izklop stikala ali konec Line (otrok ne sme ostati siroce).
 */
export type StanjeRsdo = "izklopljen" | "nalaga" | "pripravljen" | "napaka";
/** Razlogi so stalne kode (brez poti in besedila procesa), da gredo lahko v vmesnik. */
export type RazlogRsdo = "ni-namescen" | "zagon-ni-uspel" | "nalaganje-predolgo" | "proces-pada" | "prevelik-izhod" | "proces-visi";

export type UkazRsdo = { program: string; args: string[] } | { napaka: RazlogRsdo };

export type OdvisnostiStreznika = {
  /** Kaj zagnati; privzeto python in model iz `cli-anything-linuxmint --json model slovenski-stanje`. */
  ukaz?: () => Promise<UkazRsdo>;
  rokNalaganjaMs?: number;
  rokZahteveMs?: number;
  premorPonovitveMs?: number;
  rokUgasanjaMs?: number;
  zdaj?: () => number;
};

export const ROK_NALAGANJA_MS = 180_000;
export const ROK_ZAHTEVE_MS = 25_000;
export const NAJVEC_PADCEV = 3;
export const OKNO_PADCEV_MS = 5 * 60_000;
/** Toliko zaporednih rokov zahteve brez odgovora vmes = proces visi: stanje »napaka/proces-visi« (pregled 029b, najdba 2). */
export const NAJVEC_ZAPOREDNIH_ROKOV = 3;
/** Najdaljse cakanje na konec izklopljenega procesa; nato SIGKILL in nov vklop gre naprej (pregled 029b, najdba 6). */
export const ROK_UGASANJA_MS = 5000;
const PREMOR_PONOVITVE_MS = 1000;
const PREMOR_PONOVNE_PREVERBE_MS = 60_000;
const NAJVEC_VRSTICE = 1024 * 1024;
// V paketu (deb in NSIS) je skripta v resources/lina (extraResources v gradnji); v razvoju v scripts/ projekta.
// Pot iz import.meta.url v zgrajenem strezniku (.output/server/_ssr) ne kaze na scripts/, zato najprej pot v paketu (pregled 23. 11. 2026;
// naloga 16: koren paketa iz vstopne datoteke streznika, ne trda pot /opt/Lina, ki je na Windows ni).
const SKRIPTA_RAZVOJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "rsdo-streznik.py");
const SKRIPTA = datotekaPaketa("rsdo-streznik.py", SKRIPTA_RAZVOJ);

type Notranje = {
  zelen: boolean;
  rod: number;
  otrok: ChildProcess | null;
  zaganjam: boolean;
  stanje: StanjeRsdo;
  razlog: RazlogRsdo | null;
  padci: number[];
  zadnjiPoskus: number;
  cakajoci: Map<string, (besedilo: string | null) => void>;
  vrsta: Promise<unknown>;
  zaporedna: number;
  izhodPrijavljen: boolean;
  /** Proces, ubit zaradi roka zahteve: njegov konec ni padec (pregled 029, najdba 6). */
  ubitZaradiRoka: ChildProcess | null;
  /** Zaporedni roki zahteve brez odgovora procesa vmes (najdba 2 pregleda 029b). */
  zaporedniRoki: number;
  /** Konec procesa po izklopu: nov vklop pocaka nanj, da nista hkrati v pomnilniku dva modela (najdba 14). */
  ugasa: Promise<void> | null;
};

// Na globalThis: drug primerek modula (drug kos gradnje, ponovno nalaganje) ne sme naloziti drugega modela.
const KLJUC = Symbol.for("lina.rsdo.streznik");
function g(): Notranje {
  const glob = globalThis as { [KLJUC]?: Notranje };
  glob[KLJUC] ??= {
    zelen: false,
    rod: 0,
    otrok: null,
    zaganjam: false,
    stanje: "izklopljen",
    razlog: null,
    padci: [],
    zadnjiPoskus: 0,
    cakajoci: new Map(),
    vrsta: Promise.resolve(),
    zaporedna: 0,
    izhodPrijavljen: false,
    ubitZaradiRoka: null,
    zaporedniRoki: 0,
    ugasa: null,
  };
  return glob[KLJUC];
}

function ukazIzCli(): Promise<UkazRsdo> {
  // Preizkusi pravega RSDO ne zazenejo nikoli (tudi ce kdo pozabi vbrizgati ukaz).
  if (process.env.NODE_TEST_CONTEXT) return Promise.resolve({ napaka: "ni-namescen" });
  const cli = path.join(homedir(), ".local", "bin", "cli-anything-linuxmint");
  return new Promise((resolve) => {
    execFile(cli, ["--json", "model", "slovenski-stanje"], { timeout: 20_000, maxBuffer: 64 * 1024 }, (napaka, stdout) => {
      if (napaka) return resolve({ napaka: "ni-namescen" });
      try {
        const s = JSON.parse(String(stdout)) as { namescen?: unknown; python?: unknown; model?: unknown };
        if (s.namescen === true && typeof s.python === "string" && typeof s.model === "string" && path.isAbsolute(s.python) && path.isAbsolute(s.model)) {
          return resolve({ program: s.python, args: [SKRIPTA, s.model] });
        }
      } catch {
        // neveljaven izpis = ni namescen
      }
      resolve({ napaka: "ni-namescen" });
    });
  });
}

let odv: OdvisnostiStreznika = {};
/** Samo za preizkuse: nadomestni ukaz in roki; null = privzeto. */
export function nastaviOdvisnostiRsdoStreznika(nove: OdvisnostiStreznika | null): void {
  odv = nove ?? {};
}
const zdaj = () => (odv.zdaj ?? Date.now)();

export function stanjeRsdo(): { stanje: StanjeRsdo; razlog: RazlogRsdo | null; pid: number | null } {
  const s = g();
  return { stanje: s.stanje, razlog: s.razlog, pid: s.otrok?.pid ?? null };
}

export function rsdoPripravljen(): boolean {
  return g().stanje === "pripravljen";
}

/** Stikalo stalnega procesa je vklopljeno (tudi med nalaganjem in v napaki): prepis takrat ne zazene drugega modela prek CLI (CodeRabbit 029b). */
export function rsdoVklopljen(): boolean {
  return g().zelen;
}

/** Model se nalaga (vklop ali ponoven zagon po padcu): prepis takrat NE sme naloziti drugega modela prek CLI (najdba 6). */
export function rsdoNalaga(): boolean {
  return g().stanje === "nalaga";
}

function zakljuciCakajoce(s: Notranje): void {
  for (const koncaj of s.cakajoci.values()) koncaj(null);
  s.cakajoci.clear();
}

async function zazeni(s: Notranje): Promise<void> {
  const rod = ++s.rod;
  s.stanje = "nalaga";
  s.razlog = null;
  s.zaganjam = true;
  s.zadnjiPoskus = zdaj();
  const u = await (odv.ukaz ?? ukazIzCli)().catch((): UkazRsdo => ({ napaka: "zagon-ni-uspel" }));
  // Zagon je last svojega rodu (CodeRabbit 029): zastarel iskalnik ukaza po izklopu in vklopu ne sme sprostiti ali blokirati zagona novega rodu.
  if (rod !== s.rod) return;
  s.zaganjam = false;
  if (!s.zelen) return;
  if ("napaka" in u) {
    s.stanje = "napaka";
    s.razlog = u.napaka;
    return;
  }
  let otrok: ChildProcess;
  try {
    // brez detached: otrok je v skupini Line; stderr (dnevnik NeMo) zavrzemo, da poln cevovod ne ustavi procesa
    otrok = spawn(u.program, u.args, { stdio: ["pipe", "pipe", "ignore"] });
  } catch {
    s.stanje = "napaka";
    s.razlog = "zagon-ni-uspel";
    return;
  }
  s.otrok = otrok;
  if (!s.izhodPrijavljen) {
    s.izhodPrijavljen = true;
    process.on("exit", () => g().otrok?.kill("SIGKILL"));
  }
  let razlogKonca: RazlogRsdo = "proces-pada";
  const rokNalaganja = setTimeout(() => {
    if (s.otrok === otrok && s.stanje === "nalaga") {
      razlogKonca = "nalaganje-predolgo";
      otrok.kill("SIGKILL");
    }
  }, odv.rokNalaganjaMs ?? ROK_NALAGANJA_MS);
  rokNalaganja.unref();

  let medpomnilnik = "";
  otrok.stdout?.setEncoding("utf8");
  otrok.stdout?.on("data", (kos: string) => {
    medpomnilnik += kos;
    if (medpomnilnik.length > NAJVEC_VRSTICE && !medpomnilnik.includes("\n")) {
      razlogKonca = "prevelik-izhod";
      otrok.kill("SIGKILL");
      return;
    }
    let i: number;
    while ((i = medpomnilnik.indexOf("\n")) >= 0) {
      const vrstica = medpomnilnik.slice(0, i);
      medpomnilnik = medpomnilnik.slice(i + 1);
      if (vrstica.length > NAJVEC_VRSTICE) {
        razlogKonca = "prevelik-izhod";
        otrok.kill("SIGKILL");
        return;
      }
      obdelajVrstico(s, otrok, vrstica);
    }
  });
  otrok.stdin?.on("error", () => undefined);

  let koncan = false;
  const konec = () => {
    if (koncan) return;
    koncan = true;
    clearTimeout(rokNalaganja);
    if (s.otrok !== otrok) return;
    s.otrok = null;
    zakljuciCakajoce(s);
    if (!s.zelen) {
      s.stanje = "izklopljen";
      return;
    }
    const t = zdaj();
    // Rok zahteve (dolg izrek, sum) ni padec: klicatelj z dolgimi izreki ne sme izklopiti RSDO (pregled 029, najdba 6).
    const zaradiRoka = s.ubitZaradiRoka === otrok;
    s.ubitZaradiRoka = null;
    s.padci = s.padci.filter((c) => t - c < OKNO_PADCEV_MS);
    if (!zaradiRoka) s.padci.push(t);
    // ...vec zaporednih rokov brez odgovora vmes pa je proces, ki visi: brez tega bi se ubijal in nalagal v nedogled (pregled 029b, najdba 2)
    else if (s.zaporedniRoki >= NAJVEC_ZAPOREDNIH_ROKOV) {
      s.stanje = "napaka";
      s.razlog = "proces-visi";
      return;
    }
    if (s.padci.length > NAJVEC_PADCEV) {
      s.stanje = "napaka";
      s.razlog = razlogKonca;
      return;
    }
    s.stanje = "nalaga";
    const rodPadca = s.rod;
    setTimeout(() => {
      if (s.zelen && !s.otrok && !s.zaganjam && s.rod === rodPadca) void zazeni(s);
    }, odv.premorPonovitveMs ?? PREMOR_PONOVITVE_MS * Math.max(1, s.padci.length)).unref();
  };
  otrok.on("error", () => {
    razlogKonca = "zagon-ni-uspel";
    konec();
  });
  otrok.on("exit", konec);
}

function obdelajVrstico(s: Notranje, otrok: ChildProcess, vrstica: string): void {
  let m: { pripravljen?: unknown; id?: unknown; besedilo?: unknown; napaka?: unknown };
  try {
    m = JSON.parse(vrstica);
  } catch {
    return;
  }
  if (m === null || typeof m !== "object") return;
  if (m.pripravljen === true && s.otrok === otrok && s.stanje === "nalaga") {
    s.stanje = "pripravljen";
    return;
  }
  if (typeof m.id !== "string") return;
  const koncaj = s.cakajoci.get(m.id);
  if (!koncaj) return; // neznan ali zastarel id
  s.cakajoci.delete(m.id);
  s.zaporedniRoki = 0; // proces je odgovoril: ne visi
  // Besedilo gre Geminiju kot namig: brez krmilnih znakov in najvec NAJVEC_BESEDILA znakov (najdba 15).
  koncaj(typeof m.besedilo === "string" ? ocistiBesedilo(m.besedilo) : null);
}

export const NAJVEC_BESEDILA = 2000;
export function ocistiBesedilo(besedilo: string): string {
  return besedilo.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").slice(0, NAJVEC_BESEDILA);
}

function posljiEno(s: Notranje, wav: string, rokMs: number): Promise<string | null> {
  const otrok = s.otrok;
  if (s.stanje !== "pripravljen" || !otrok?.stdin || rokMs <= 0) return Promise.resolve(null);
  const id = String(++s.zaporedna);
  return new Promise((resolve) => {
    const rok = setTimeout(() => {
      if (!s.cakajoci.delete(id)) return;
      resolve(null);
      // proces je se zaposlen s to zahtevo in bi zadrzal vse naslednje: ponoven zagon (NE steje kot padec)
      if (s.otrok === otrok) {
        s.ubitZaradiRoka = otrok;
        s.zaporedniRoki += 1;
        otrok.kill("SIGKILL");
      }
    }, rokMs);
    s.cakajoci.set(id, (besedilo) => {
      clearTimeout(rok);
      resolve(besedilo);
    });
    otrok.stdin!.write(`${JSON.stringify({ id, wav })}\n`);
  });
}

/**
 * Prepis 16 kHz mono WAV prek stalnega procesa; null, ce ni pripravljen, ob napaki ali roku. Zahteve gredo po vrsti, ena naenkrat.
 * Rok velja od KLICA (pregled 029, najdba 5): cakanje v vrsti se ne sesteva z rokom zahteve; zahteva, ki ji je rok potekel v vrsti, se preskoci.
 * Proces pa se ubije sele, ko ENA zahteva preseze cel rok (zahteva, ki je vecino roka cakala v vrsti, ne ubije zdravega modela).
 */
export function prepisiPrekStreznika(wav: string): Promise<string | null> {
  const s = g();
  const rokMs = odv.rokZahteveMs ?? ROK_ZAHTEVE_MS;
  let potekel = false;
  const izid = s.vrsta.then(() => (potekel ? null : posljiEno(s, wav, rokMs)));
  s.vrsta = izid.catch(() => null);
  return new Promise((resolve) => {
    const rok = setTimeout(() => {
      potekel = true;
      resolve(null);
    }, rokMs);
    izid.then(
      (b) => {
        clearTimeout(rok);
        resolve(b);
      },
      () => {
        clearTimeout(rok);
        resolve(null);
      },
    );
  });
}

export async function vklopiRsdo(): Promise<void> {
  const s = g();
  s.zelen = true;
  if (s.otrok || s.zaganjam) return;
  s.padci = [];
  s.zaporedniRoki = 0;
  if (s.ugasa) {
    // Prejsnji proces se ugasa (izklop in takojsen vklop): najprej naj sprosti pomnilnik (~1,65 GB), sele nato nov model (najdba 14).
    s.zaganjam = true;
    // med cakanjem velja »nalaga«: prepis ne naloži drugega modela prek CLI (rsdoNalaga)
    s.stanje = "nalaga";
    const rod = s.rod;
    await s.ugasa;
    // vmes izklop (rod++): to cakanje ni vec lastnik zagona; novejsi vklop ima svojega
    if (rod !== s.rod) return;
    s.zaganjam = false;
    if (!s.zelen || s.otrok) return;
  }
  await zazeni(s);
}

export function izklopiRsdo(): void {
  const s = g();
  s.zelen = false;
  s.rod++;
  // zagon starega rodu (iskanje ukaza, cakanje na ugasanje) ni vec lastnik: nov vklop zacne svojega
  s.zaganjam = false;
  s.padci = [];
  s.zaporedniRoki = 0;
  const otrok = s.otrok;
  s.otrok = null;
  zakljuciCakajoce(s);
  s.stanje = "izklopljen";
  s.razlog = null;
  if (otrok) {
    // Konec pride z `exit`, pri neuspelem zagonu (ENOENT) pa samo z `error`; rok poskrbi, da nov vklop nikoli ne visi trajno (pregled 029b, najdba 6).
    const ugasa: Promise<void> =
      otrok.exitCode !== null || otrok.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            const rok = setTimeout(() => {
              otrok.kill("SIGKILL");
              r();
            }, odv.rokUgasanjaMs ?? ROK_UGASANJA_MS);
            rok.unref();
            const koncan = () => {
              clearTimeout(rok);
              r();
            };
            otrok.once("exit", koncan);
            otrok.once("error", koncan);
          });
    s.ugasa = ugasa;
    void ugasa.then(() => {
      if (s.ugasa === ugasa) s.ugasa = null;
    });
    otrok.stdin?.end(); // konec vhoda: skripta se konca sama
    otrok.kill("SIGTERM");
    setTimeout(() => {
      if (otrok.exitCode === null && otrok.signalCode === null) otrok.kill("SIGKILL");
    }, 3000).unref();
  }
}

/**
 * Uskladi proces s stikalom (zagon Line, shranjevanje pravil, poizvedba stanja Dodatkov). Ce modul se ni namescen (namestitev
 * po vklopu tece v ozadju), poskusi znova najvec enkrat na minuto (takoj po koncani namestitvi); po ponavljajocih padcih caka na
 * uporabnikov izklop in vklop.
 */
export async function uskladiRsdo(vklop: boolean, poNamestitvi = false, platforma: Platforma = platformaZdaj()): Promise<void> {
  const s = g();
  if (!vklop) {
    if (s.zelen || s.otrok) izklopiRsdo();
    return;
  }
  // Naloga 15: zunaj Linuxa modula ni (Dodatki povedo »ni na voljo«) - brez zagona in brez ponovnih poskusov vsako minuto.
  if (!imaSlovenskiModul(platforma)) return;
  if (s.zelen && (s.otrok || s.zaganjam || s.stanje === "nalaga")) return;
  if (s.zelen && s.stanje === "napaka") {
    const ponovljivo = s.razlog === "ni-namescen" || s.razlog === "zagon-ni-uspel";
    // poNamestitvi: namestitev se je pravkar koncala, minutni premor ne velja (pregled 029, najdba 13)
    if (!ponovljivo || (!poNamestitvi && zdaj() - s.zadnjiPoskus < PREMOR_PONOVNE_PREVERBE_MS)) return;
  }
  await vklopiRsdo();
}
