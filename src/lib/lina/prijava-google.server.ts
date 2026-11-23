import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { jeVeljavnaKodaPrijave } from "./prijava-koda.ts";

/**
 * Prijava v Google Cloud z uporabnikovim PRIVZETIM brskalnikom (lastnik 11. 11. 2026: »prevzeti brskalnik mu olajsa«).
 * gcloud sam odpre privzeti brskalnik (Linux xdg-open, Windows start); Lina ne odpira svojega okna, ker Google za OAuth
 * vgrajenih oken ne dovoli. Ce brskalnik ne odpre, Lina pokaze povezavo za kopiranje (samo gostitelj accounts.google.com).
 * Zeton ostane v mapi gcloud uporabnika; Lina ga ne bere, ne kopira in ne zapise v dnevnik ali stanje.
 */
export type FazaPrijave = "mirno" | "caka" | "uspeh" | "napaka";
/** Vzrok napake (15. 11. 2026): vmesnik pokaze navodilo, ki ustreza vzroku (gpNapaka*), ne splosnega »ni uspelo«. */
export type VzrokNapake = "koda" | "brskalnik" | "preklicana" | "potekla" | "zagon" | "dovoljenje" | "neznano";
export type StanjePrijave = {
  faza: FazaPrijave;
  povezava: string | null;
  sporocilo: string | null;
  /** gcloud ne more odpreti brskalnika in caka na verifikacijsko kodo, ki jo uporabnik prepise v Lino. */
  potrebnaKoda: boolean;
  /** Koda je poslana gcloudu na stdin; same kode nikjer ne hranimo. */
  kodaPoslana: boolean;
  vzrok: VzrokNapake | null;
  /** Zadnje vrstice izpisa gcloud, ociscene zetonov, kod, povezav in domace mape (najvec 20 vrstic po 240 znakov). */
  podrobnosti: string[];
};

const NAJVEC_PODROBNOSTI = 20;
const NAJVEC_VRSTICE = 240;

function mirno(): StanjePrijave {
  return { faza: "mirno", povezava: null, sporocilo: null, potrebnaKoda: false, kodaPoslana: false, vzrok: null, podrobnosti: [] };
}

const SPOROCILA: Readonly<Record<VzrokNapake, string>> = {
  koda: "Google kode ni sprejel. Prepišite jo znova ali začnite prijavo od začetka.",
  brskalnik: "Prijava brez brskalnika ni uspela, preden ste vnesli kodo.",
  preklicana: "Prijava je bila preklicana.",
  potekla: "Prijava je potekla. Poskusite znova.",
  zagon: "Orodja gcloud ni bilo mogoče zagnati.",
  // Lastnik 22. 11. 2026: na strani soglasja ni obkljukal Google Cloud; gcloud zavrne prijavo, brskalnik pa vseeno pokaze »auth_success«.
  dovoljenje:
    "Google je dal samo dovoljenje za e-pošto. Začnite prijavo znova in na Googlovi strani obkljukajte tudi dostop do Google Cloud (ali »Izberi vse«).",
  neznano: "Prijava ni uspela ali je bila prekinjena.",
};

/**
 * Izpis gcloud za uporabnika: izrezi zetone, kode, povezave, kljuce in domaco mapo; ohrani razlog napake. Zadnjih 20 nepraznih
 * vrstic, vsaka najvec 240 znakov. `znaneKode` so kode, ki jih je uporabnik vpisal (izrezejo se dobesedno, tudi ce niso v obliki 4/...).
 */
export function ocistiIzpis(izpis: string, domaMapa: string, znaneKode: readonly string[] = []): string[] {
  let t = izpis.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  for (const koda of znaneKode) if (koda.length >= 6) t = t.split(koda).join("<koda>");
  if (domaMapa) t = t.split(domaMapa).join("<domača mapa>");
  t = t
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<povezava>")
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/g, "<žeton>")
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, "<žeton>")
    .replace(/\b1\/\/[A-Za-z0-9._-]{8,}/g, "<žeton>")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "<ključ>")
    .replace(/\b4\/[A-Za-z0-9._~-]{10,}/g, "<koda>")
    .replace(/\b(access_token|refresh_token|id_token|client_secret|token|password|secret)\b\s*[=:]\s*\S+/gi, "$1=<skrito>")
    .replace(/\b[0-9a-f]{20,}\b/gi, "<skrito>")
    .replace(/[A-Za-z0-9_-]{40,}/g, "<skrito>");
  return t
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v !== "")
    .slice(-NAJVEC_PODROBNOSTI)
    .map((v) => v.slice(0, NAJVEC_VRSTICE));
}

/** Vzrok napake iz tega, kar vemo o poteku: koda poslana, kodo zahteval, zavrnitev v brskalniku, signal, drugo. */
export function razvrstiNapako(v: { izpis: string; zahtevalaKodo: boolean; kodaPoslana: boolean; signal?: NodeJS.Signals | null }): VzrokNapake {
  if (v.kodaPoslana) return "koda";
  if (/access_denied/i.test(v.izpis)) return "preklicana";
  if (/scope is required but not consented/i.test(v.izpis)) return "dovoljenje";
  if (v.zahtevalaKodo) return "brskalnik";
  if (v.signal) return "preklicana";
  return "neznano";
}

/** Rok prijave: uporabnik se mora prijaviti v petih minutah, sicer postopek ustavimo po PID. */
export const ROK_PRIJAVE_MS = 5 * 60_000;

const DOVOLJEN_GOSTITELJ = "accounts.google.com";

/** Povezava za prijavo iz izpisa gcloud. Sprejme samo https://accounts.google.com/..., karkoli drugega je null. */
export function razberiPovezavoPrijave(izpis: string): string | null {
  const zadetek = izpis.match(/https:\/\/[^\s"'<>]+/g);
  if (!zadetek) return null;
  for (const kandidat of zadetek) {
    try {
      const url = new URL(kandidat);
      if (url.protocol === "https:" && url.hostname === DOVOLJEN_GOSTITELJ && !url.username && !url.password) return url.toString();
    } catch {
      /* naslednji */
    }
  }
  return null;
}

/** Ime ukaza za dano platformo. */
export function imeGcloud(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "gcloud.cmd" : "gcloud";
}

/** Poti, kjer iscemo gcloud: najprej Linina lastna mapa, nato PATH. Samo absolutne poti (brez iskanja po trenutni mapi). */
export function kandidatiGcloud(
  lastnaMapa: string,
  pathSpremenljivka: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const ime = imeGcloud(platform);
  const izLastne = join(lastnaMapa, "google-cloud-sdk", "bin", ime);
  const izPath = pathSpremenljivka
    .split(platform === "win32" ? ";" : delimiter)
    .filter((mapa) => mapa && (platform === "win32" ? /^[a-z]:[\\/]/i.test(mapa) : mapa.startsWith("/")))
    .map((mapa) => join(mapa, ime));
  return [izLastne, ...izPath];
}

export function poisciGcloud(lastnaMapa: string, obstaja: (pot: string) => boolean = existsSync): string | null {
  for (const pot of kandidatiGcloud(lastnaMapa, process.env.PATH ?? "")) if (obstaja(pot)) return pot;
  return null;
}

/** Okolje za gcloud: LASTNA konfiguracijska mapa Line, da »pozabi« ne zadene uporabnikovih drugih orodij (CLOUDSDK_CONFIG, preverjeno v gcloud 593.0.0). */
export function okoljeGcloud(mapaKonfig: string, osnova: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...osnova, CLOUDSDK_CONFIG: mapaKonfig, HOME: osnova.HOME ?? homedir() };
}

/** Pot do ADC datoteke v Lini lastni mapi (za google-auth keyFilename). */
export function potAdc(mapaKonfig: string): string {
  return join(mapaKonfig, "application_default_credentials.json");
}

/** Ukazna vrstica prijave: privzeti brskalnik (brez --no-launch-browser), ADC za knjiznico google-auth. */
export function ukazPrijave(gcloud: string): { ukaz: string; args: string[] } {
  return { ukaz: gcloud, args: ["auth", "application-default", "login", "--quiet"] };
}

/** Projekti iz izpisa `gcloud projects list --format=json`; samo veljavni ID-ji (male crke, stevilke, vezaj). */
export function razberiProjekte(json: string): { id: string; ime: string }[] {
  let razclenjeno: unknown;
  try {
    razclenjeno = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(razclenjeno)) return [];
  const izid: { id: string; ime: string }[] = [];
  for (const el of razclenjeno) {
    if (!el || typeof el !== "object") continue;
    const { projectId, name } = el as { projectId?: unknown; name?: unknown };
    if (typeof projectId === "string" && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
      izid.push({ id: projectId, ime: typeof name === "string" ? name.slice(0, 80) : projectId });
    }
  }
  return izid;
}

/** Konec celotnega drevesa procesov (gcloud je skripta, ki zazene Python): SIGTERM na skupino, na Windows taskkill /T. */
function ustaviDrevo(proces: ChildProcess): void {
  const pid = proces.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      proces.kill("SIGTERM");
    } catch {
      /* ze koncan */
    }
  }
}

let stanje: StanjePrijave = mirno();
let otrok: ChildProcess | null = null;
let casovnik: NodeJS.Timeout | null = null;
let zahtevalaKodo = false;
let poslanaKoda: string | null = null;

export function stanjePrijave(): StanjePrijave {
  return { ...stanje, podrobnosti: [...stanje.podrobnosti] };
}

function koncaj(novo: StanjePrijave): void {
  if (casovnik) clearTimeout(casovnik);
  casovnik = null;
  otrok = null;
  zahtevalaKodo = false;
  poslanaKoda = null;
  stanje = novo;
}

export type MoznostiPrijave = {
  /** Ena vrstica brez skrivnosti ob napaki (vzrok); privzeto nic. */
  dnevnik?: (vrstica: string) => void;
  /** Rok prijave; privzeto ROK_PRIJAVE_MS. */
  rokMs?: number;
};

/** Zazene prijavo. Ena prijava naenkrat; ponoven klic med prijavo vrne trenutno stanje. */
export function zacniPrijavo(gcloud: string, mapaKonfig: string, moznosti: MoznostiPrijave = {}): StanjePrijave {
  if (otrok) return stanjePrijave();
  const dnevnik = moznosti.dnevnik ?? (() => {});
  const rokMs = moznosti.rokMs ?? ROK_PRIJAVE_MS;
  const { ukaz, args } = ukazPrijave(gcloud);
  zahtevalaKodo = false;
  poslanaKoda = null;
  stanje = { ...mirno(), faza: "caka" };
  let izpis = "";
  const pridobi = (kos: Buffer) => {
    izpis = (izpis + kos.toString("utf8")).slice(-8_000);
    if (stanje.faza !== "caka") return;
    const povezava = razberiPovezavoPrijave(izpis);
    if (povezava) stanje = { ...stanje, povezava };
    // Brez brskalnika gcloud izpise povezavo in »enter the verification code«, nato caka vrstico na stdin (izmerjeno 15. 11. 2026).
    if (!zahtevalaKodo && /enter the verification code/i.test(izpis)) {
      zahtevalaKodo = true;
      if (poslanaKoda === null) stanje = { ...stanje, potrebnaKoda: true };
    }
  };
  // Napaka: izpis se ocisti PRED koncem, ker koncaj pozabi poslano kodo.
  const napaka = (vzrok: VzrokNapake): void => {
    const podrobnosti = ocistiIzpis(izpis, homedir(), poslanaKoda ? [poslanaKoda] : []);
    koncaj({ ...mirno(), faza: "napaka", vzrok, sporocilo: SPOROCILA[vzrok], podrobnosti });
    dnevnik(`prijava Google: napaka, vzrok ${vzrok}`);
  };
  const proces = spawn(ukaz, args, { windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"], env: okoljeGcloud(mapaKonfig) });
  otrok = proces;
  proces.stdin?.on("error", () => {});
  proces.stdout?.on("data", pridobi);
  proces.stderr?.on("data", pridobi);
  proces.once("error", () => {
    if (otrok === proces) napaka("zagon");
  });
  // »close«, ne »exit«: izpis ob izhodu se ne sme izgubiti (vzrok napake je v zadnjih vrsticah).
  proces.once("close", (koda, signal) => {
    if (otrok !== proces) return;
    if (koda === 0) koncaj({ ...mirno(), faza: "uspeh" });
    else napaka(razvrstiNapako({ izpis, zahtevalaKodo, kodaPoslana: poslanaKoda !== null, signal }));
  });
  casovnik = setTimeout(() => {
    if (otrok === proces) {
      ustaviDrevo(proces);
      napaka("potekla");
    }
  }, rokMs);
  casovnik.unref();
  return stanjePrijave();
}

/**
 * Koda iz brskalnika drugje (ko gcloud ne more odpreti brskalnika) gre kot ena vrstica na stdin gcloud. Samo, ce jo gcloud zahteva
 * in ima pricakovano obliko; kode ne hranimo in je ne vrnemo v stanju.
 */
export function vnesiKodoPrijave(koda: unknown): StanjePrijave {
  if (!otrok || stanje.faza !== "caka" || !stanje.potrebnaKoda) throw new Error("Koda ni potrebna.");
  if (!jeVeljavnaKodaPrijave(koda)) throw new Error("Koda nima pričakovane oblike.");
  const stdin = otrok.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) throw new Error("Koda ni potrebna.");
  const cista = koda.trim();
  poslanaKoda = cista;
  stdin.write(`${cista}\n`);
  stanje = { ...stanje, potrebnaKoda: false, kodaPoslana: true };
  return stanjePrijave();
}

/** Preklic prijave po PID procesa, ki ga je zagnala Lina. */
export function preklicPrijave(): StanjePrijave {
  if (otrok) {
    ustaviDrevo(otrok);
    koncaj(mirno());
  }
  return stanjePrijave();
}

/** Seznam projektov uporabnika po prijavi (gcloud projects list). Prazen seznam ob napaki. */
export function preberiProjekte(gcloud: string, mapaKonfig: string, rokMs = 15_000): Promise<{ id: string; ime: string }[]> {
  return new Promise((resolve) => {
    execFile(
      gcloud,
      ["projects", "list", "--format=json", "--quiet"],
      { windowsHide: true, timeout: rokMs, maxBuffer: 2_000_000, env: okoljeGcloud(mapaKonfig) },
      (napaka, stdout) => resolve(napaka ? [] : razberiProjekte(stdout)),
    );
  });
}

/**
 * Pozabi Googlov racun: preklic (revoke) zetona pri Googlu, brisanje Line lastne mape in pozabi predpomnjen zeton v procesu.
 * Mapa se pobrise tudi, ce preklic ne uspe (brez omrezja); uporabnikova druga orodja ostanejo nedotaknjena.
 */
export async function pozabiGoogle(
  gcloud: string | null,
  mapaKonfig: string,
  pozabiZeton: () => void,
  preklici: (gcloud: string, env: NodeJS.ProcessEnv) => Promise<void> = (g, env) =>
    new Promise((resolve) => {
      execFile(g, ["auth", "application-default", "revoke", "--quiet"], { windowsHide: true, timeout: 20_000, env }, () => resolve());
    }),
): Promise<void> {
  preklicPrijave();
  if (gcloud && existsSync(potAdc(mapaKonfig))) await preklici(gcloud, okoljeGcloud(mapaKonfig));
  rmSync(mapaKonfig, { recursive: true, force: true });
  pozabiZeton();
}
