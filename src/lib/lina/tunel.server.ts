import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { requireOwner } from "./auth.server.ts";
import { ugasniTestnoOknoSprejema, vklopiTestnoOknoSprejema } from "./twilio-sprejem.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { vVrstiPravil } from "./pravila.server.ts";

/**
 * Javni https naslov linije brez terminala (lastnik 12. 11. 2026): hitri tunel Cloudflare (trycloudflare.com, brez racuna).
 * Lina zazene cloudflared, iz izpisa prebere naslov in ga vpise v pravila (javniNaslov); ob izklopu ali koncu procesa
 * tunel ustavi po PID in polje izprazni.
 *
 * VARNOST: tunel NE kaze direktno na vrata Line (tam je tudi prijava lastnika in nastavitve). Kaze na majhen posrednik
 * na 127.0.0.1 (nakljucna vrata), ki naprej prepusti SAMO GET/POST na /api/voice/..., brez piskotkov in avtorizacije;
 * vse drugo je 404 in do Line sploh ne pride.
 */
export const CLOUDFLARED_VERZIJA = "2026.10.7";
const OSNOVA = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERZIJA}/`;
/** Prvi skok samo github.com; preusmeritev GitHub na svoje CDN gostitelje (izmerjeno 12. 11. 2026: release-assets.githubusercontent.com). */
const GOSTITELJI_PRENOSA = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const NAJVEC_BAJTOV = 80_000_000;
const NAJVEC_SKOKOV = 4;
const ROK_NASLOVA_MS = 40_000;
/* 16. 11. 2026: DNS cona trycloudflare.com ima negativni TTL 60 s, sistemski razresevalnik obdrzi prvi neuspeh toliko casa; 30 s je bilo prekratko. */
export const ROK_DOSEGLJIVOSTI_MS = 150_000;
const NASLOV = /^https:\/\/([a-z0-9-]+)\.trycloudflare\.com$/;

export type ArhivTunela = { datoteka: string; sha256: string; url: string };

/** SHA-256 so izmerjene 12. 11. 2026 na dejansko preneseni datoteki in se ujemajo z digestom uradne izdaje (GitHub API). */
const ARHIVI: Record<string, ArhivTunela> = {
  "linux-x64": { datoteka: "cloudflared-linux-amd64", sha256: "1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872", url: "" },
  "linux-arm64": { datoteka: "cloudflared-linux-arm64", sha256: "3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775", url: "" },
  "win32-x64": { datoteka: "cloudflared-windows-amd64.exe", sha256: "2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343", url: "" },
};

export function arhivZaPlatformo(platform: NodeJS.Platform = process.platform, arch: string = process.arch): ArhivTunela | null {
  const a = ARHIVI[`${platform}-${arch}`];
  return a ? { ...a, url: OSNOVA + a.datoteka } : null;
}

export function mapaTunela(root: string): string {
  return join(root, "cloudflared");
}

function imeProgramam(platform: NodeJS.Platform): string {
  return platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

/** Primerjava vsot v konstantnem casu. */
export function vsotaEnaka(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

/** Naslov tunela: SAMO https://<nakljucno>.trycloudflare.com brez poti; »api« je Cloudflarov lastni naslov v izpisu napak. */
export function veljavenNaslovTunela(niz: string): string | null {
  const m = NASLOV.exec(niz);
  if (!m || m[1] === "api") return null;
  return niz;
}

/** Naslov iz vrstice izpisa: preveri vsak zeton posebej, ker je v okvirju (| https://... |). */
export function naslovIzVrstice(vrstica: string): string | null {
  for (const zeton of vrstica.split(/[\s|]+/)) {
    const n = veljavenNaslovTunela(zeton);
    if (n) return n;
  }
  return null;
}

/** Prenos: samo https z dovoljenih gostiteljev, preusmeritve rocno in vsaka preverjena, omejena velikost; vsota med pisanjem. */
export async function prenesiPreverjeno(
  url: string,
  cilj: string,
  fetchFn: typeof fetch = fetch,
  // Paket Line ima ~103 MB (23. 11. 2026), zato meja in rok kot neobvezna parametra; privzeto ostane kot za cloudflared.
  moznosti: { najvecBajtov?: number; rokMs?: number } = {},
): Promise<string> {
  const najvec = moznosti.najvecBajtov ?? NAJVEC_BAJTOV;
  let u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "github.com") throw new Error("Nedovoljen naslov prenosa.");
  for (let skok = 0; skok <= NAJVEC_SKOKOV; skok++) {
    if (u.protocol !== "https:" || !GOSTITELJI_PRENOSA.has(u.hostname) || u.username || u.password || u.port !== "") throw new Error("Nedovoljen naslov prenosa.");
    const odgovor = await fetchFn(u, { redirect: "manual", signal: AbortSignal.timeout(moznosti.rokMs ?? 5 * 60_000) });
    if (odgovor.status >= 300 && odgovor.status < 400) {
      const kam = odgovor.headers.get("location");
      // Telo preusmeritve zapremo, da povezava ne ostane odprta (pregled P10).
      await odgovor.body?.cancel().catch(() => undefined);
      if (!kam) throw new Error("Prenos ni uspel.");
      u = new URL(kam, u);
      continue;
    }
    if (!odgovor.ok || !odgovor.body) throw new Error("Prenos ni uspel.");
    const hash = createHash("sha256");
    let skupaj = 0;
    const vir = Readable.fromWeb(odgovor.body as never);
    vir.on("data", (kos: Buffer) => {
      skupaj += kos.length;
      if (skupaj > najvec) vir.destroy(new Error("Datoteka je prevelika."));
      hash.update(kos);
    });
    await pipeline(vir, createWriteStream(cilj, { mode: 0o600 }));
    return hash.digest("hex");
  }
  throw new Error("Preveč preusmeritev.");
}

export type RezultatNamestitve = { uspeh: true } | { uspeh: false; sporocilo: string };

/**
 * Namesti cloudflared v Linino mapo: prenos v zacasno mapo, preverba SHA-256 PRED chmod in preimenovanjem, brez root.
 * Zacasna mapa se vedno pobrise; pod koncnim imenom nikoli ne obstaja nepreverjena datoteka.
 */
export async function namestiCloudflared(
  mapa: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  odv: { prenesi?: (url: string, cilj: string) => Promise<string> } = {},
): Promise<RezultatNamestitve> {
  const arhiv = arhivZaPlatformo(platform, arch);
  if (!arhiv) return { uspeh: false, sporocilo: "Za ta sistem Lina ne more sama namestiti orodja cloudflared." };
  const prenesi = odv.prenesi ?? ((u, c) => prenesiPreverjeno(u, c));
  mkdirSync(mapa, { recursive: true, mode: 0o700 });
  // mode velja samo ob ustvarjanju mape: obstojeci mapi dovoljenja popravimo (N3).
  if (platform !== "win32") chmodSync(mapa, 0o700);
  const zacasna = mkdtempSync(join(mapa, "namestitev-"));
  try {
    const datoteka = join(zacasna, "program");
    let vsota: string;
    try {
      vsota = await prenesi(arhiv.url, datoteka);
    } catch {
      return { uspeh: false, sporocilo: "Prenos orodja cloudflared ni uspel. Preverite internetno povezavo." };
    }
    if (!vsotaEnaka(vsota, arhiv.sha256)) {
      return { uspeh: false, sporocilo: "Preneseni program ne ustreza pričakovani vsoti, zato ga nisem namestila." };
    }
    if (platform !== "win32") chmodSync(datoteka, 0o700);
    renameSync(datoteka, join(mapa, imeProgramam(platform)));
    return { uspeh: true };
  } catch {
    return { uspeh: false, sporocilo: "Namestitev orodja cloudflared ni uspela." };
  } finally {
    rmSync(zacasna, { recursive: true, force: true });
  }
}

export type NajdenProgram = { pot: string; vir: "path" | "lastna" };

/**
 * Mapa je varna za program iz PATH, ce je absolutna, last tega uporabnika ali roota in nihce drug nima pisanja v njej
 * (pregled 12. 11. 2026, N3: program iz zapisljive mape bi tekel z dostopom do podatkov Line). Windows: brez te preverbe.
 */
export function jeVarnaMapa(mapa: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!isAbsolute(mapa)) return false;
  if (platform === "win32") return true;
  try {
    const st = statSync(mapa);
    const jaz = typeof process.getuid === "function" ? process.getuid() : -1;
    return st.isDirectory() && (st.uid === 0 || st.uid === jaz) && (st.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

/** Datoteka programa: navadna, izvrsljiva, last uporabnika ali roota in brez pisanja za druge (pregled P7: 0666 v varni mapi je spremenljiva). */
export function jeVarnaDatoteka(pot: string): boolean {
  try {
    const st = statSync(pot);
    const jaz = typeof process.getuid === "function" ? process.getuid() : -1;
    if (!st.isFile() || (st.uid !== 0 && st.uid !== jaz) || (st.mode & 0o022) !== 0) return false;
    accessSync(pot, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Isci program: NAJPREJ pripeta kopija v Lini (vsoto preveri ponudnik pred zagonom), nato PATH (samo absolutne varne mape, varna
 * datoteka). Windows: PATH se NE uporablja (zapisljive mape v PATH so pogoste, pregled P7); samo pripeta kopija.
 */
export function poisciProgram(ime: string, mapaLastna: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NajdenProgram | null {
  const lastna = join(mapaLastna, ime);
  if (existsSync(lastna)) return { pot: lastna, vir: "lastna" };
  if (platform === "win32") return null;
  for (const mapa of (env.PATH ?? "").split(delimiter)) {
    if (!mapa || !jeVarnaMapa(mapa, platform)) continue;
    const pot = join(mapa, ime);
    if (jeVarnaDatoteka(pot)) return { pot, vir: "path" };
  }
  return null;
}

export function poisciCloudflared(root: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NajdenProgram | null {
  return poisciProgram(imeProgramam(platform), mapaTunela(root), env, platform);
}

/** Absolutna pot do tar (pregled P7: ne iscemo ga po PATH). */
export function potTar(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === "win32") return join(env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe");
  return existsSync("/usr/bin/tar") ? "/usr/bin/tar" : "/bin/tar";
}

/** Cas zagona procesa (polje 22 v /proc/<pid>/stat) ali null, ce ga ni (ni Linux ali proces ne obstaja). */
export function casZagonaProcesa(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Ime procesa je v oklepajih in lahko vsebuje presledke: polja stejemo za zadnjim »)«.
    const polja = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return polja[19] ?? null;
  } catch {
    return null;
  }
}

/** Je to se isti proces, ki smo ga zagnali: enak cas zagona IN ime programa (exe ali argv). Brez /proc ne ustavljamo nikogar. */
export function jeNasProces(pid: number, program: string, zagon: string | null): boolean {
  if (!zagon || casZagonaProcesa(pid) !== zagon) return false;
  try {
    const exe = basename(readlinkSync(`/proc/${pid}/exe`));
    if (exe === program) return true;
  } catch {
    /* exe ni berljiv: poskusimo argv */
  }
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    return basename(argv[0] ?? "") === program || basename(argv[1] ?? "") === program;
  } catch {
    return false;
  }
}

/* ---------- vmesnik ponudnika tunela (lastnik 12. 11. 2026: neodvisnost od cloudflared) ---------- */

/** Zagnan tunel: javni naslov, PID procesa (ce ga ima) in ustavitev. poKoncu se sprozi, ko tunel pade ali se ustavi. */
export type ZagnanTunel = {
  naslov: string;
  pid: number | null;
  ustavi: () => void;
  poKoncu: (cb: () => void) => void;
};

export type NaVoljo = { najden: boolean; namestljiv: boolean };

/**
 * Ponudnik tunela. Cloudflared je samo PRVI; drug ponudnik (npr. lastna domena ali drug tunel) doda en objekt in ga
 * vpise v PONUDNIKI. Posrednik, stanje in vpis v pravila so skupni in od ponudnika neodvisni.
 */
export interface PonudnikTunela {
  readonly id: string;
  /** Ime programa v ukazni vrstici procesa (za pobiranje sirot po PID). */
  readonly program?: string;
  /** Ce je podan: po zagonu se naslov ne vpise in ne pokaze kot »tece«, dokler ta preizkus ne potrdi dosegljivosti (ponavlja do roka). */
  dosegljiv?(naslov: string): Promise<boolean>;
  readonly rokDosegljivostiMs?: number;
  readonly razmikDosegljivostiMs?: number;
  /** Preverba naslova, ki ga ponudnik vrne; privzeto samo trycloudflare.com. */
  veljavenNaslov?(naslov: string): string | null;
  naVoljo(root: string): NaVoljo;
  namesti?(root: string): Promise<RezultatNamestitve>;
  /** Zazene tunel proti 127.0.0.1:<vrata> in vrne naslov; ob napaki ali preteku roka vrze Error s sporocilom za uporabnika. */
  zazeni(vrata: number, root: string, naZagon?: (pid: number, ustavi: () => void) => void): Promise<ZagnanTunel>;
}

const OKOLJE_TUNELA = ["PATH", "Path", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "LANG", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE"];

/** Okolje procesa tunela: kopija samo potrebnih spremenljivk (kljucev Line ne dobi tuj program); process.env se ne spreminja. */
function okoljeTunela(): NodeJS.ProcessEnv {
  const izhod: NodeJS.ProcessEnv = {};
  for (const k of OKOLJE_TUNELA) if (process.env[k] !== undefined) izhod[k] = process.env[k];
  return izhod;
}

/** PID ustavimo po PID, nikoli po imenu (pkill -f). Windows: taskkill z drevesom. */
function ustaviPoPid(otrok: ChildProcess): void {
  const pid = otrok.pid;
  if (!pid || otrok.exitCode !== null || otrok.signalCode !== null) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const sila = setTimeout(() => {
    if (otrok.exitCode === null && otrok.signalCode === null) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ze koncan */
      }
    }
  }, 3000);
  sila.unref?.();
}

/**
 * Dosegljivost naslova tunela: GET <naslov>/api/voice/incoming; 403 (Lina zavrne nepodpisan klic) pomeni, da zahteva pride do Line.
 * Izmerjeno s pravim cloudflared 12. 11. 2026: takoj po izpisu naslova DNS se ne razresi (»Could not resolve host«), po ~9 s deluje.
 */
export function preveriDosegljivostNaslova(naslov: string, rokMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL("/api/voice/incoming", naslov);
    } catch {
      resolve(false);
      return;
    }
    const r = httpsRequest(u, { method: "GET", timeout: rokMs }, (o) => {
      o.resume();
      resolve(o.statusCode === 403);
    });
    r.on("timeout", () => {
      r.destroy();
      resolve(false);
    });
    r.on("error", () => resolve(false));
    r.end();
  });
}

export type OdvisnostiCloudflared = {
  rokMs?: number;
  poisci?: (root: string) => NajdenProgram | null;
  dosegljivost?: (naslov: string) => Promise<boolean>;
  rokDosegljivostiMs?: number;
  razmikDosegljivostiMs?: number;
};

export function ponudnikCloudflared(odv: OdvisnostiCloudflared = {}): PonudnikTunela {
  const poisci = odv.poisci ?? ((root: string) => poisciCloudflared(root));
  const rok = odv.rokMs ?? ROK_NASLOVA_MS;
  return {
    id: "cloudflared",
    dosegljiv: odv.dosegljivost ?? ((n: string) => preveriDosegljivostNaslova(n)),
    rokDosegljivostiMs: odv.rokDosegljivostiMs ?? ROK_DOSEGLJIVOSTI_MS,
    razmikDosegljivostiMs: odv.razmikDosegljivostiMs ?? 1000,
    naVoljo(root) {
      return { najden: poisci(root) !== null, namestljiv: arhivZaPlatformo() !== null };
    },
    namesti: (root) => namestiCloudflared(mapaTunela(root)),
    async zazeni(vrata, root, naZagon) {
      const program = poisci(root);
      if (!program) throw new Error("Program cloudflared ni nameščen.");
      if (program.vir === "lastna") {
        // Preverba kopije tik pred zagonom: zamenjana datoteka v Lininih podatkih se ne zazene.
        const arhiv = arhivZaPlatformo();
        const vsota = createHash("sha256").update(await readFile(program.pot)).digest("hex");
        if (!arhiv || !vsotaEnaka(vsota, arhiv.sha256)) throw new Error("Nameščen program cloudflared ne ustreza pričakovani vsoti, zato ga ne zaženem.");
      }
      const otrok = spawn(program.pot, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${vrata}`], {
        env: okoljeTunela(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let konec = false;
      const poKoncu: Array<() => void> = [];
      otrok.once("exit", () => {
        konec = true;
        for (const cb of poKoncu.splice(0)) cb();
      });
      // PID takoj (pregled P3): do 40 s cakanja na naslov proces ze obstaja in ga mora Lina znati ustaviti in pobrati.
      if (otrok.pid) naZagon?.(otrok.pid, () => ustaviPoPid(otrok));
      const naslov = await new Promise<string>((resolve, reject) => {
        const casovnik = setTimeout(() => finish(new Error("Javnega naslova ni bilo mogoče dobiti v 40 sekundah.")), rok);
        function finish(r: string | Error): void {
          clearTimeout(casovnik);
          if (r instanceof Error) {
            ustaviPoPid(otrok);
            reject(r);
          } else resolve(r);
        }
        for (const tok of [otrok.stdout, otrok.stderr]) {
          let ostanek = "";
          tok?.setEncoding("utf8");
          tok?.on("data", (kos: string) => {
            ostanek = (ostanek + kos).slice(-8192);
            const vrstice = ostanek.split("\n");
            ostanek = vrstice.pop() ?? "";
            for (const v of [...vrstice, ostanek]) {
              const n = naslovIzVrstice(v);
              if (n) return finish(n);
            }
          });
        }
        otrok.once("error", () => finish(new Error("Programa cloudflared ni bilo mogoče zagnati.")));
        otrok.once("exit", () => finish(new Error("Program cloudflared se je ustavil, preden je dal naslov.")));
      });
      // Izpis se naprej bere in zavrze (cevi se ne smejo zasititi), vsebina se ne shranjuje.
      otrok.stdout?.resume();
      otrok.stderr?.resume();
      return {
        naslov,
        pid: otrok.pid ?? null,
        ustavi: () => ustaviPoPid(otrok),
        poKoncu: (cb) => (konec ? cb() : void poKoncu.push(cb)),
      };
    },
  };
}

/* ---------- posrednik: kaj sploh pride z interneta do Line ---------- */

const NAJVEC_TELESA = 1 << 20;
const NAJVEC_POVEZAV = 32;
const ZAVRNJENE_GLAVE = new Set(["cookie", "authorization", "proxy-authorization", "connection", "keep-alive", "upgrade", "transfer-encoding", "te", "trailer"]);

/** Dovoljeno je samo /api/voice/...: brez .. in kodiranih locil poti, da pot ne ubeži v drug del Line. */
export function jeDovoljenaPot(url: string, method: string): boolean {
  if (method !== "GET" && method !== "POST") return false;
  if (!url.startsWith("/api/voice/")) return false;
  if (url.includes("..") || url.includes("\\") || /%(2e|2f|5c|00)/i.test(url)) return false;
  return true;
}

/** Vrata Line: kot jih nastavi zagon (scripts/start.mjs: PORT/NITRO_PORT, sicer 8080). Samo branje, okolja ne spreminjamo. */
export function vrataLine(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PORT ?? env.NITRO_PORT ?? 8080);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8080;
}

export function zazeniPosrednik(vrataLinije: number): Promise<Server> {
  const streznik = createServer((zahteva: IncomingMessage, odgovor: ServerResponse) => {
    const url = zahteva.url ?? "";
    if (!jeDovoljenaPot(url, zahteva.method ?? "")) {
      odgovor.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      odgovor.end("Ni najdeno");
      return;
    }
    const glave: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(zahteva.headers)) if (v !== undefined && !ZAVRNJENE_GLAVE.has(k)) glave[k] = v;
    const naprej = httpRequest({ host: "127.0.0.1", port: vrataLinije, method: zahteva.method, path: url, headers: glave, timeout: 30_000 }, (o) => {
      const izhodne = { ...o.headers };
      delete izhodne["set-cookie"];
      odgovor.writeHead(o.statusCode ?? 502, izhodne);
      o.pipe(odgovor);
    });
    let bajti = 0;
    zahteva.on("data", (kos: Buffer) => {
      bajti += kos.length;
      if (bajti > NAJVEC_TELESA) {
        naprej.destroy();
        if (!odgovor.headersSent) odgovor.writeHead(413);
        odgovor.end();
        zahteva.destroy();
      }
    });
    naprej.on("error", () => {
      if (!odgovor.headersSent) odgovor.writeHead(502);
      odgovor.end();
    });
    naprej.on("timeout", () => naprej.destroy());
    zahteva.pipe(naprej);
  });
  streznik.maxConnections = NAJVEC_POVEZAV;
  streznik.requestTimeout = 30_000;
  streznik.headersTimeout = 15_000;
  return new Promise((resolve, reject) => {
    streznik.once("error", reject);
    streznik.listen(0, "127.0.0.1", () => resolve(streznik));
  });
}

/* ---------- stanje in upravljanje (en tunel naenkrat na upravljalca) ---------- */

/** »caka«: proces tece in ima naslov, a naslov se ni potrjeno dosegljiv (DNS se se ni razsiril). */
export type FazaTunela = "nedejaven" | "zaganja" | "caka" | "tece" | "napaka";
export type StanjeTunela = {
  faza: FazaTunela;
  razlog: string | null;
  naslov: string | null;
  ponudnik: string;
  orodje: NaVoljo;
  namestitev: { faza: "mirno" | "tece" | "uspeh" | "napaka"; sporocilo: string | null };
};

export const PONUDNIKI: Record<string, () => PonudnikTunela> = { cloudflared: () => ponudnikCloudflared() };
const PRIVZETI_PONUDNIK = "cloudflared";

/** Vpis ali brisanje javniNaslov brez seje (ob padcu procesa seje ni); izprazni SAMO, ce polje se vedno nosi nas naslov. */
export async function zapisiNaslov(root: string, naslov: string, samoCe?: string): Promise<void> {
  // Ista vrsta kot ostali pisci pravila.json (drugi pregled 0.2.10, CR12/N1); izprazniSinhrono ob izhodu procesa ne more cakati.
  await vVrstiPravil(root, async () => {
    const raw = (await readJsonFile<Record<string, unknown>>(root, "pravila.json")) ?? {};
    if (samoCe !== undefined && raw.javniNaslov !== samoCe) return;
    await writeJson(root, "pravila.json", { ...raw, javniNaslov: naslov });
  });
}

export function izprazniSinhrono(root: string, samoCe: string): void {
  try {
    const pot = join(root, "pravila.json");
    const raw = JSON.parse(readFileSync(pot, "utf8")) as Record<string, unknown>;
    if (raw.javniNaslov !== samoCe) return;
    const tmp = `${pot}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...raw, javniNaslov: "" }, null, 2), { mode: 0o600 });
    renameSync(tmp, pot);
  } catch {
    /* ni datoteke ali ni veljavna: ni kaj brisati */
  }
}

/** Kdo vpise naslov v pravila: privzeto upravljalec sam; pri dveh poteh (neposredna + tunel) to dela izbira poti. */
export type KljukeNaslova = {
  zapisi(root: string, naslov: string): Promise<void>;
  izprazni(root: string, naslov: string): Promise<void>;
  izprazniSinhrono(root: string, naslov: string): void;
};
const KLJUKE_PRIVZETE: KljukeNaslova = { zapisi: (r, n) => zapisiNaslov(r, n), izprazni: (r, n) => zapisiNaslov(r, "", n), izprazniSinhrono };

/* PID v datoteki 0600 (pregled N2): ob SIGKILL/OOM Lina ne more pospraviti, zato ob naslednjem stiku sirote pobere. */
type ZapisPid = { pid: number; naslov: string; zagon: string | null };
const upravljalci = new Set<Upravljalec>();
let izhodPrijavljen = false;

/** Node ob SIGTERM/SIGINT/SIGHUP brez rokovalca ne sprozi »exit«: rokovalec pospravi in signal ponovno sprozi, ce ga nihce drug ne obravnava. */
function prijaviIzhod(): void {
  if (izhodPrijavljen) return;
  izhodPrijavljen = true;
  const pospravi = (): void => {
    for (const u of upravljalci) u.pospraviZaIzhod();
  };
  process.once("exit", pospravi);
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.once(signal, () => {
      pospravi();
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    });
  }
}

type Aktiven = {
  zagnan: ZagnanTunel | null;
  posrednik: Server | null;
  root: string;
  naslov: string | null;
  /** PID in ustavitev, ki ju ponudnik javi TAKOJ po spawn (pregled P3), se pred koncanim zagonom. */
  pid: number | null;
  ustaviRano: (() => void) | null;
};

export class Upravljalec {
  faza: FazaTunela = "nedejaven";
  razlog: string | null = null;
  private aktiven: Aktiven | null = null;
  private namestitev: StanjeTunela["namestitev"] = { faza: "mirno", sporocilo: null };
  private readonly datotekaPid: string;
  readonly id: string;
  private readonly kljuke: KljukeNaslova;

  // Brez »parameter properties«: Node jih v nacinu strip-types ne podpira.
  constructor(id: string = "privzeto", kljuke: KljukeNaslova = KLJUKE_PRIVZETE) {
    this.id = id;
    this.kljuke = kljuke;
    this.datotekaPid = id === "privzeto" ? "tunel.pid" : `tunel-${id}.pid`;
  }

  private potPid(root: string): string {
    return join(root, this.datotekaPid);
  }
  private zapisiPid(root: string, pid: number, naslov: string): void {
    // Cas zagona procesa vezemo na PID, da ponovno uporabljen PID ni »nas« proces (pregled P6).
    writeFileSync(this.potPid(root), JSON.stringify({ pid, naslov, zagon: casZagonaProcesa(pid) } satisfies ZapisPid), { mode: 0o600 });
  }
  private pobrisiPid(root: string): void {
    rmSync(this.potPid(root), { force: true });
  }
  /** Pobrise pid datoteko samo, ce se vedno kaze na dani PID (nov zagon je medtem lahko zapisal svojo). */
  private pobrisiPidCe(root: string, pid: number | null): void {
    if (pid !== null && this.preberiPid(root)?.pid === pid) this.pobrisiPid(root);
  }
  private preberiPid(root: string): ZapisPid | null {
    try {
      const z = JSON.parse(readFileSync(this.potPid(root), "utf8")) as Partial<ZapisPid>;
      return Number.isInteger(z.pid) && (z.pid as number) > 1 && typeof z.naslov === "string" ? { pid: z.pid as number, naslov: z.naslov, zagon: typeof z.zagon === "string" ? z.zagon : null } : null;
    } catch {
      return null;
    }
  }

  /** Siroti: tunel iz prejsnjega teka Line (pid datoteka), ki ga nihce ne drzi. Ustavi po PID in izprazni star naslov. */
  async pospraviSirote(root: string, program = "cloudflared"): Promise<void> {
    const z = this.preberiPid(root);
    if (!z) {
      this.pobrisiPid(root);
      return;
    }
    if (this.aktiven?.pid === z.pid || this.aktiven?.zagnan?.pid === z.pid) return;
    if (jeNasProces(z.pid, program, z.zagon)) {
      try {
        process.kill(z.pid, "SIGTERM");
      } catch {
        /* ze koncan */
      }
    }
    if (z.naslov) await this.kljuke.izprazni(root, z.naslov);
    this.pobrisiPid(root);
  }

  private pospravi(a: Aktiven): void {
    ugasniTestnoOknoSprejema();
    a.posrednik?.close();
    a.posrednik?.closeAllConnections?.();
    a.posrednik = null;
  }

  pospraviZaIzhod(): void {
    ugasniTestnoOknoSprejema();
    const a = this.aktiven;
    if (!a) return;
    if (a.zagnan) a.zagnan.ustavi();
    else a.ustaviRano?.();
    if (a.naslov) this.kljuke.izprazniSinhrono(a.root, a.naslov);
    try {
      this.pobrisiPid(a.root);
    } catch {
      /* mapa je ze izginila */
    }
  }

  /** Naslov, ce tunel tece (sicer null). */
  naslovTece(): string | null {
    return this.faza === "tece" ? (this.aktiven?.naslov ?? null) : null;
  }

  stanje(root: string, ponudnik: PonudnikTunela): StanjeTunela {
    return {
      faza: this.faza,
      razlog: this.razlog,
      naslov: this.faza === "tece" ? (this.aktiven?.naslov ?? null) : null,
      ponudnik: ponudnik.id,
      orodje: ponudnik.naVoljo(root),
      namestitev: { ...this.namestitev },
    };
  }

  async stanjeSOwnerjem(token: string | null, dir: string | undefined, ponudnik: PonudnikTunela): Promise<StanjeTunela> {
    const root = resolveDataDir(dir);
    await requireOwner(token, root);
    if (!this.aktiven) await this.pospraviSirote(root, ponudnik.program).catch(() => undefined);
    return this.stanje(root, ponudnik);
  }

  async namesti(soglasje: unknown, token: string | null, dir: string | undefined, p: PonudnikTunela): Promise<StanjeTunela> {
    const root = resolveDataDir(dir);
    await requireOwner(token, root);
    if (soglasje !== true) throw new Error("Namestitev zahteva dovoljenje uporabnika.");
    if (this.namestitev.faza !== "tece" && !p.naVoljo(root).najden && p.namesti) {
      this.namestitev = { faza: "tece", sporocilo: null };
      const izid = await p.namesti(root);
      this.namestitev = izid.uspeh ? { faza: "uspeh", sporocilo: null } : { faza: "napaka", sporocilo: izid.sporocilo };
    }
    return this.stanje(root, p);
  }

  async vklopi(token: string | null, dir: string | undefined, p: PonudnikTunela, vrataLinije?: number): Promise<StanjeTunela> {
    const root = resolveDataDir(dir);
    await requireOwner(token, root);
    return this.vklopiInterno(root, p, vrataLinije);
  }

  /** Brez seje: samo za notranje klice izbire poti (nadzor, samodejni preklop), ki jih je lastnik ze odobril z vklopom. */
  async vklopiInterno(root: string, p: PonudnikTunela, vrataLinije?: number): Promise<StanjeTunela> {
    // En tunel naenkrat: ob zagonu ali teku vrnemo obstojece stanje.
    if (this.faza === "zaganja" || this.faza === "caka" || this.faza === "tece") return this.stanje(root, p);
    this.faza = "zaganja";
    this.razlog = null;
    const a: Aktiven = { zagnan: null, posrednik: null, root, naslov: null, pid: null, ustaviRano: null };
    this.aktiven = a;
    upravljalci.add(this);
    prijaviIzhod();
    const proveri = p.veljavenNaslov ?? veljavenNaslovTunela;
    // Izklop (ali nov vklop) med zagonom: po vsakem await preverimo, da je ta zagon se veljaven (pregled N1).
    const preklican = (): boolean => this.aktiven !== a || (this.faza !== "zaganja" && this.faza !== "caka");
    try {
      await this.pospraviSirote(root, p.program);
      if (preklican()) return this.stanje(root, p);
      a.posrednik = await zazeniPosrednik(vrataLinije ?? vrataLine());
      if (preklican()) {
        this.pospravi(a);
        return this.stanje(root, p);
      }
      const vrata = (a.posrednik.address() as AddressInfo).port;
      const zagnan = await p.zazeni(vrata, root, (pid, ustavi) => {
        a.pid = pid;
        a.ustaviRano = ustavi;
        this.zapisiPid(root, pid, "");
      });
      a.zagnan = zagnan;
      if (preklican()) {
        zagnan.ustavi();
        this.pospravi(a);
        this.pobrisiPidCe(root, a.pid);
        return this.stanje(root, p);
      }
      const naslov = proveri(zagnan.naslov);
      if (!naslov) {
        zagnan.ustavi();
        throw new Error("Ponudnik je vrnil neveljaven naslov.");
      }
      a.naslov = naslov;
      if (zagnan.pid) this.zapisiPid(root, zagnan.pid, naslov);
      if (p.dosegljiv) {
        // Naslov se ne vpise v pravila in stanje ni »tece«, dokler dosegljivost ni potrjena (ponavljamo ~1 s do roka).
        this.faza = "caka";
        const rok = Date.now() + (p.rokDosegljivostiMs ?? ROK_DOSEGLJIVOSTI_MS);
        const razmik = p.razmikDosegljivostiMs ?? 1000;
        let dosegljiv = false;
        while (!dosegljiv) {
          if (preklican()) break;
          dosegljiv = await p.dosegljiv(naslov).catch(() => false);
          if (dosegljiv || Date.now() >= rok) break;
          await new Promise((r) => setTimeout(r, razmik));
        }
        if (!preklican() && !dosegljiv) {
          zagnan.ustavi();
          throw new Error("Naslov se ni postal dosegljiv v določenem času (DNS se je morda počasi razširil). Poskusite znova čez minuto.");
        }
        if (preklican()) {
          zagnan.ustavi();
          this.pospravi(a);
          this.pobrisiPidCe(root, a.pid);
          return this.stanje(root, p);
        }
      }
      await this.kljuke.zapisi(root, naslov);
      if (preklican()) {
        zagnan.ustavi();
        this.pospravi(a);
        await this.kljuke.izprazni(root, naslov);
        this.pobrisiPidCe(root, a.pid);
        return this.stanje(root, p);
      }
      this.faza = "tece";
      vklopiTestnoOknoSprejema();
      zagnan.poKoncu(() => {
        // Padec ali ustavitev: polje izpraznimo, posrednik se zapre.
        if (this.aktiven !== a) return;
        const bilTece = this.faza === "tece";
        this.pospravi(a);
        this.aktiven = null;
        this.pobrisiPid(root);
        void this.kljuke.izprazni(root, naslov).catch(() => undefined);
        if (bilTece && this.faza !== "nedejaven") {
          this.faza = "napaka";
          this.razlog = "Tunel se je nepričakovano ustavil. Vklopite ga znova.";
        }
      });
    } catch (napaka) {
      a.zagnan?.ustavi();
      a.ustaviRano?.();
      this.pospravi(a);
      this.pobrisiPidCe(root, a.pid);
      // Ce je zagon medtem preklican, ostane stanje, ki ga je nastavil izklop.
      if (this.aktiven === a) {
        this.aktiven = null;
        this.faza = "napaka";
        this.razlog = napaka instanceof Error && napaka.message ? napaka.message : "Javnega naslova ni bilo mogoče vklopiti.";
      }
    }
    return this.stanje(root, p);
  }

  async izklopi(token: string | null, dir: string | undefined, p: PonudnikTunela): Promise<StanjeTunela> {
    const root = resolveDataDir(dir);
    await requireOwner(token, root);
    return this.izklopiInterno(root, p);
  }

  async izklopiInterno(root: string, p: PonudnikTunela): Promise<StanjeTunela> {
    const a = this.aktiven;
    this.faza = "nedejaven";
    this.razlog = null;
    if (a) {
      this.aktiven = null;
      a.zagnan?.ustavi();
      // Izklop med zagonom: proces, ki se se zaganja, ustavimo takoj (ne cakamo na konec zagona).
      a.ustaviRano?.();
      this.pospravi(a);
      if (a.naslov) await this.kljuke.izprazni(root, a.naslov);
      this.pobrisiPid(root);
    }
    return this.stanje(root, p);
  }
}

const privzeti = new Upravljalec();
function izberi(odv: { ponudnik?: PonudnikTunela }): PonudnikTunela {
  return odv.ponudnik ?? PONUDNIKI[PRIVZETI_PONUDNIK]();
}

export const pospraviSirote = (root: string): Promise<void> => privzeti.pospraviSirote(root);
export const stanjeTunela = (token: string | null, dir?: string, odv: { ponudnik?: PonudnikTunela } = {}): Promise<StanjeTunela> =>
  privzeti.stanjeSOwnerjem(token, dir, izberi(odv));
export const namestiTunelPoDovoljenju = (soglasje: unknown, token: string | null, dir?: string, odv: { ponudnik?: PonudnikTunela } = {}): Promise<StanjeTunela> =>
  privzeti.namesti(soglasje, token, dir, izberi(odv));
export const vklopiTunel = (token: string | null, dir?: string, odv: { ponudnik?: PonudnikTunela; vrataLine?: number } = {}): Promise<StanjeTunela> =>
  privzeti.vklopi(token, dir, izberi(odv), odv.vrataLine);
export const izklopiTunel = (token: string | null, dir?: string, odv: { ponudnik?: PonudnikTunela } = {}): Promise<StanjeTunela> =>
  privzeti.izklopi(token, dir, izberi(odv));
