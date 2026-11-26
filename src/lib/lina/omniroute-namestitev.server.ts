/**
 * Naloga 31 (lastnik 26. 11. 2026 18:36): Lina sama namesti, zazene in odstrani OmniRoute (lokalni prehod do modelov).
 * - Vir: uradni paket npm »omniroute« (MIT, github.com/cheaper-inference/OmniRoute, prej diegosouzapw), PRIPETA razlicica in zaklepna
 *   datoteka omniroute-zaklep.json z integriteto (sha512) VSEH paketov; npm sam je pripet s sha512 iz registra. Nikoli »latest«:
 *   novejso razlicico prinese nova Lina z novo zaklepno datoteko.
 * - `npm ci --ignore-scripts` (namestitvene skripte ne tecejo; namesto postinstall Lina skopira sql.js in node-machine-id v dist).
 * - Node je Electron Line (ELECTRON_RUN_AS_NODE); uporabnik ne potrebuje ne ukazne vrstice ne sudo.
 * - Mapa <podatki Line>/omniroute (oznaka lina-namestitev.json); poslusanje SAMO 127.0.0.1; okolje samo z dovoljenega seznama
 *   (nikoli kljuci in zetoni Line); geslo nadzorne plosce, skrivnosti in kljuc API ustvari Lina in jih hrani sifrirano.
 * - Ob koncu Line se OmniRoute ustavi (pravilo: strezniki, ki jih ne rabimo, se zaprejo). Odstrani samo mapo z oznako Line.
 * Komentarji so brez sumnikov.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readlink, realpath, rename, rm, statfs, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, odstraniOmnirouteNaslova, saveBrain, sifrirajSkrivnost } from "./keys.server.ts";
import ZAKLEP from "./omniroute-zaklep.json" with { type: "json" };
import { veljavenNaslovOmniroute } from "./omniroute.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const OMNIROUTE_RAZLICICA = "3.8.54";
/** npm 11.21.3: sha512 iz registra (npm view npm@11.21.3 dist.integrity), preverjeno 26. 11. 2026. */
export const NPM_PRIPET = { razlicica: "11.21.3", sha512: "5Cf+jE+XctbhH/zjOOqXC+ity7eec/Tkk4Ql38tf6w+1htp2wYPHmE4c1R1Es3DY227Ac14+SLrlYJwkBicbTg==" };
export const REGISTER = "https://registry.npmjs.org";
export const VRATA_OMNIROUTE = 20128;
const MAPA = "omniroute";
const OZNAKA = "lina-namestitev.json";
/** Slepi pregled #1: namestitev je koncana sele, ko so vsi koraki (tudi brskalnik in kopije) uspeli. */
const KONCANO = "koncano";
const SKRIVNOSTI = "omniroute-lokalno.json";
const AAD = "lina-omniroute-lokalno";
/** Izmerjeno na testnem PC 26. 11. 2026: app ~2,9 GB + predpomnilnik npm + brskalnik; zahtevamo rezervo. */
const NAJMANJ_PROSTORA = 5 * 1024 ** 3;
const KLJUC_STANJA = Symbol.for("lina.omniroute.namestitev");

export type Korak = "prenos" | "namestitev" | "zagon" | "preverba";
export type StanjeKoraka = "caka" | "tece" | "uspeh" | "napaka";
export type StanjeNamestitve = {
  /** Lina je OmniRoute namestila (oznaka v mapi). */
  namescen: boolean;
  /** Proces, ki ga je zagnala Lina, tece. */
  tece: boolean;
  vTeku: boolean;
  pripravljeno: boolean;
  koraki: { korak: Korak; stanje: StanjeKoraka }[];
  napaka: string | null;
  naslov: string | null;
  razlicica: string;
};

export type Odvisnosti = {
  fetch: typeof fetch;
  zazeni: (ukaz: string, args: string[], opcije: SpawnOptions) => ChildProcess;
  /** Node za otroke: v namestitvi izvrsljivi Electron (ELECTRON_RUN_AS_NODE), v preizkusih node. */
  izvrsljivo: string;
  register: string;
  vrata: number;
  rokZagonaMs: number;
  rokOdgovoraMs: number;
  prostor: (dir: string) => Promise<number>;
  npm: { razlicica: string; sha512: string };
};

export function privzeteOdvisnosti(): Odvisnosti {
  return {
    fetch: (...a) => fetch(...a),
    zazeni: (ukaz, args, opcije) => spawn(ukaz, args, opcije),
    izvrsljivo: process.execPath,
    register: REGISTER,
    vrata: VRATA_OMNIROUTE,
    rokZagonaMs: 90_000,
    rokOdgovoraMs: 90_000,
    prostor: async (dir) => {
      const s = await statfs(dir);
      return s.bavail * s.bsize;
    },
    npm: NPM_PRIPET,
  };
}

type Skrivnosti = { geslo: string; jwt: string; apiKeySecret: string; storageKey: string; kljuc?: string };
type Globalno = {
  vTeku: Promise<void> | null;
  koraki: Record<Korak, StanjeKoraka>;
  napaka: string | null;
  pripravljeno: boolean;
  otrok: ChildProcess | null;
  izhodPrijavljen: boolean;
  vrata: number;
  /** Slepi pregled #2: en zagon naenkrat (zagon ob zagonu Line in namestitev). */
  zaganjam: Promise<Skrivnosti> | null;
  /** Slepi pregled #3: tudi namestitveni otroci (tar, npm, playwright) se ob koncu Line ustavijo. */
  otroci: Set<ChildProcess>;
  /** Pregled 2 #7: nas OmniRoute iz prejsnjega zagona Line, ki ga je Lina prevzela; ob koncu Line se ustavi. */
  sirotaPid: number | null;
};

function g(): Globalno {
  const x = globalThis as { [KLJUC_STANJA]?: Globalno };
  x[KLJUC_STANJA] ??= { vTeku: null, koraki: zacetniKoraki(), napaka: null, pripravljeno: false, otrok: null, izhodPrijavljen: false, vrata: VRATA_OMNIROUTE, zaganjam: null, otroci: new Set(), sirotaPid: null };
  return x[KLJUC_STANJA];
}

function zacetniKoraki(): Record<Korak, StanjeKoraka> {
  return { prenos: "caka", namestitev: "caka", zagon: "caka", preverba: "caka" };
}

/** Napaka z besedilom za uporabnika (navaden jezik); surovih napak omrezja ne kazemo. */
class NapakaNamestitve extends Error {}

export function korenOmniroute(dir?: string): string {
  return path.join(resolveDataDir(dir), MAPA);
}

export function naslovLokalnega(vrata = VRATA_OMNIROUTE): string {
  return `http://127.0.0.1:${vrata}/v1`;
}

/** Pregled 2 #4: localhost in 127.0.0.1 sta isti naslov tega racunalnika. */
function istiNaslov(a: unknown, b: unknown): boolean {
  const n = (x: unknown) => veljavenNaslovOmniroute(x)?.replace("://localhost:", "://127.0.0.1:") ?? null;
  const na = n(a);
  return na !== null && na === n(b);
}

/** Okolje otroka: samo dovoljeni seznam (nikoli process.env: kljuci ponudnikov, zetoni lupine, LINA_*). */
export function okoljeOtroka(koren: string, dodatno: Record<string, string> = {}): Record<string, string> {
  const dom = path.join(koren, "dom");
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: dom,
    USERPROFILE: dom,
    LANG: "C.UTF-8",
    NO_UPDATE_NOTIFIER: "1",
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return { ...env, ...dodatno };
}

/** Okolje streznika OmniRoute: samo zanka, kljuc API obvezen, brez obvestil o posodobitvah in telemetrije. */
export function okoljeStreznika(koren: string, vrata: number, s: Skrivnosti): Record<string, string> {
  return okoljeOtroka(koren, {
    HOSTNAME: "127.0.0.1",
    OMNIROUTE_SERVER_HOST: "127.0.0.1",
    PORT: String(vrata),
    NODE_ENV: "production",
    DATA_DIR: path.join(koren, "podatki"),
    INITIAL_PASSWORD: s.geslo,
    JWT_SECRET: s.jwt,
    API_KEY_SECRET: s.apiKeySecret,
    STORAGE_ENCRYPTION_KEY: s.storageKey,
    REQUIRE_API_KEY: "true",
    OMNIROUTE_NO_UPDATE_NOTIFIER: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    PLAYWRIGHT_BROWSERS_PATH: path.join(koren, "brskalniki"),
  });
}

async function preberiSkrivnosti(root: string): Promise<Skrivnosti | null> {
  const f = await readJsonFile<{ iv: string; tag: string; ciphertext: string }>(root, SKRIVNOSTI);
  if (!f?.ciphertext) return null;
  const s = await odsifrirajSkrivnost(f, root, AAD);
  return s ? (JSON.parse(s) as Skrivnosti) : null;
}

async function zapisiSkrivnosti(root: string, s: Skrivnosti): Promise<void> {
  await writeJson(root, SKRIVNOSTI, await sifrirajSkrivnost(JSON.stringify(s), root, AAD));
}

async function skrivnosti(root: string): Promise<Skrivnosti> {
  const s = await preberiSkrivnosti(root);
  if (s) return s;
  const nove = {
    geslo: randomBytes(24).toString("base64url"),
    jwt: randomBytes(48).toString("base64"),
    apiKeySecret: randomBytes(32).toString("hex"),
    storageKey: randomBytes(32).toString("hex"),
  };
  await zapisiSkrivnosti(root, nove);
  return nove;
}

/** Pocaka konec otroka; izhod ne zbira v pomnilnik (stdio ignore). */
function pocakaj(otrok: ChildProcess, rokMs: number): Promise<number> {
  return new Promise((ok) => {
    const rok = setTimeout(() => {
      otrok.kill("SIGKILL");
      ok(-1);
    }, rokMs);
    otrok.once("error", () => {
      clearTimeout(rok);
      ok(-1);
    });
    otrok.once("exit", (koda) => {
      clearTimeout(rok);
      ok(koda ?? -1);
    });
  });
}

async function prenesiPreverjeno(odv: Odvisnosti, url: string, sha512: string): Promise<Buffer> {
  let odgovor: Response;
  try {
    odgovor = await odv.fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new NapakaNamestitve("Prenos ni uspel. Preverite povezavo z internetom in poskusite znova.");
  }
  if (!odgovor.ok) throw new NapakaNamestitve("Prenos ni uspel (strežnik paketov ni vrnil datoteke). Poskusite znova pozneje.");
  const vsebina = Buffer.from(await odgovor.arrayBuffer());
  if (createHash("sha512").update(vsebina).digest("base64") !== sha512) {
    throw new NapakaNamestitve("Prenesena datoteka se ne ujema s pričakovano (preverba integritete). Namestitev je ustavljena zaradi varnosti.");
  }
  return vsebina;
}

function vrataProsta(vrata: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(false));
    s.listen(vrata, "127.0.0.1", () => s.close(() => ok(true)));
  });
}

/** Ali OmniRoute na naslovu sprejme NAS kljuc (seznam modelov). */
async function seznamModelov(odv: Odvisnosti, naslov: string, kljuc: string): Promise<string[] | null> {
  try {
    const r = await odv.fetch(`${naslov}/models`, { headers: { authorization: `Bearer ${kljuc}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { id?: unknown }[] };
    return (j.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

/** Kljuc API ustvari Lina: prijava z geslom, ki ga je nastavila, nato POST /api/keys (nadzorna plosca na isti zanki). */
async function ustvariKljuc(odv: Odvisnosti, vrata: number, geslo: string): Promise<string> {
  const osnova = `http://127.0.0.1:${vrata}`;
  const glave = { "content-type": "application/json", origin: osnova };
  const prijava = await odv.fetch(`${osnova}/api/auth/login`, { method: "POST", headers: glave, body: JSON.stringify({ password: geslo }), redirect: "error", signal: AbortSignal.timeout(odv.rokOdgovoraMs) });
  const piskotki = prijava.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await prijava.body?.cancel();
  if (!prijava.ok || !piskotki) throw new NapakaNamestitve("Lina se ni mogla prijaviti v OmniRoute (geslo). Odstranite OmniRoute in ga namestite znova.");
  const r = await odv.fetch(`${osnova}/api/keys`, { method: "POST", headers: { ...glave, cookie: piskotki }, body: JSON.stringify({ name: "Lina" }), redirect: "error", signal: AbortSignal.timeout(odv.rokOdgovoraMs) });
  const j = (await r.json().catch(() => null)) as { key?: unknown } | null;
  if (!r.ok || typeof j?.key !== "string" || j.key.length < 8) throw new NapakaNamestitve("OmniRoute ni ustvaril ključa za Lino.");
  return j.key;
}

function prijaviIzhod(s: Globalno): void {
  if (s.izhodPrijavljen) return;
  s.izhodPrijavljen = true;
  // Ob koncu Line se OmniRoute ustavi (exit je sinhron: samo signal).
  process.on("exit", () => {
    g().otrok?.kill("SIGTERM");
    for (const o of g().otroci) o.kill("SIGKILL");
    const pid = g().sirotaPid;
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ze ustavljen */
      }
    }
  });
}

function sledi(otrok: ChildProcess): ChildProcess {
  const s = g();
  s.otroci.add(otrok);
  prijaviIzhod(s);
  otrok.once("exit", () => s.otroci.delete(otrok));
  otrok.once("error", () => s.otroci.delete(otrok));
  return otrok;
}

/**
 * Slepi pregled #3: OmniRoute iz prejsnjega zagona Line (Lina je bila ubita, exit se ni izvedel) ustavi po streznik.pid, samo ce je
 * to res nas proces (delovna mapa = nas dist). Brez /proc (Windows) ga ne ustavi.
 */
/** PID iz streznik.pid samo, ce je delovna mapa procesa nas dist (realpath: pot podatkov je lahko simbolna povezava). */
async function nasProces(koren: string): Promise<number | null> {
  const pid = Number((await readFile(path.join(koren, "streznik.pid"), "utf8").catch(() => "")).trim());
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => "");
  const dist = await realpath(path.join(koren, "app", "node_modules", "omniroute", "dist")).catch(() => null);
  return dist && cwd === dist ? pid : null;
}

async function ustaviSiroto(koren: string): Promise<void> {
  const pid = await nasProces(koren);
  if (!pid) return;
  if (g().sirotaPid === pid) g().sirotaPid = null;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  for (let i = 0; i < 50; i += 1) {
    await new Promise((ok) => setTimeout(ok, 100));
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* ze ustavljen */
  }
}

/** Zazene OmniRoute, ki ga je namestila Lina (ce se ne tece), in pocaka, da odgovori. Hkratni klici dobijo isti zagon. */
function zazeniNamescenega(root: string, odv: Odvisnosti): Promise<Skrivnosti> {
  const s = g();
  s.zaganjam ??= zazeniEnkrat(root, odv).finally(() => {
    s.zaganjam = null;
  });
  return s.zaganjam;
}

async function zazeniEnkrat(root: string, odv: Odvisnosti): Promise<Skrivnosti> {
  const s = g();
  const koren = path.join(root, MAPA);
  const sk = await skrivnosti(root);
  const naslov = naslovLokalnega(odv.vrata);
  if (s.otrok && s.otrok.exitCode === null && s.otrok.signalCode === null) return sk;
  if (!(await vrataProsta(odv.vrata))) {
    // Na vratih ze nekaj tece: prevzamemo ga samo, ce je nas proces (streznik.pid + delovna mapa) in sprejme nas kljuc; tujega ne ustavimo
    // in mu kljuca ne posljemo (pregled 2, CodeRabbit: odgovor seznama ni dokaz lastnistva).
    const pid = await nasProces(koren);
    const modeli = pid && sk.kljuc ? await seznamModelov(odv, naslov, sk.kljuc) : null;
    if (pid && modeli && modeli.length > 0) {
      s.sirotaPid = pid;
      prijaviIzhod(s);
      return sk;
    }
    throw new NapakaNamestitve(`Vrata ${odv.vrata} že uporablja drug program, zato Lina OmniRoute ne more zagnati. Lina tega programa ne ustavi.`);
  }
  // Ponovna preverba pod zaporo zagona (odstranitev med cakanjem, CodeRabbit).
  if (!existsSync(path.join(koren, OZNAKA)) || !existsSync(path.join(koren, KONCANO))) throw new NapakaNamestitve("OmniRoute ni nameščen.");
  const dist = path.join(koren, "app", "node_modules", "omniroute", "dist");
  const vstop = existsSync(path.join(dist, "server-ws.mjs")) ? "server-ws.mjs" : "server.js";
  let otrok: ChildProcess;
  try {
    otrok = odv.zazeni(odv.izvrsljivo, [vstop], { cwd: dist, env: okoljeStreznika(koren, odv.vrata, sk), stdio: "ignore", shell: false });
  } catch {
    throw new NapakaNamestitve("OmniRoute se ni zagnal.");
  }
  s.otrok = otrok;
  prijaviIzhod(s);
  // Pregled 2 #5: neuspel zagon (npr. manjka mapa) sprozi »error«; brez poslusalca bi podrl Lino.
  otrok.once("error", () => {
    if (s.otrok === otrok) {
      s.otrok = null;
      s.pripravljeno = false;
    }
  });
  otrok.once("exit", () => {
    if (s.otrok === otrok) {
      s.otrok = null;
      s.pripravljeno = false;
    }
  });
  await writeFile(path.join(koren, "streznik.pid"), String(otrok.pid ?? ""), { mode: 0o600 }).catch(() => undefined);
  const zacetek = Date.now();
  while (Date.now() - zacetek < odv.rokZagonaMs) {
    if (s.otrok !== otrok) throw new NapakaNamestitve("OmniRoute se je ob zagonu ustavil.");
    try {
      const r = await odv.fetch(`${naslov}/models`, { redirect: "error", signal: AbortSignal.timeout(2000) });
      await r.body?.cancel();
      // 503 med zagonom ni pripravljen; 401/403 je OmniRoute, ki zahteva kljuc (CodeRabbit).
      if (r.ok || r.status === 401 || r.status === 403) return sk;
      await new Promise((ok) => setTimeout(ok, 500));
    } catch {
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  otrok.kill("SIGTERM");
  throw new NapakaNamestitve(`OmniRoute se ni zagnal v ${Math.round(odv.rokZagonaMs / 1000)} sekundah.`);
}

async function namestiDatoteke(root: string, odv: Odvisnosti, nastavi: (k: Korak, st: StanjeKoraka) => void): Promise<void> {
  const koren = path.join(root, MAPA);
  const app = path.join(koren, "app");
  const npmCli = path.join(koren, "npm", "bin", "npm-cli.js");
  const prenos = path.join(koren, "prenos");
  nastavi("prenos", "tece");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await odv.prostor(root)) < NAJMANJ_PROSTORA) {
    throw new NapakaNamestitve("Na disku je premalo prostora: OmniRoute potrebuje približno 5 GB. Sprostite prostor in poskusite znova.");
  }
  // CodeRabbit: obstojece mape brez oznake Line (rocna namestitev) Lina ne prevzame in je kasneje ne izbrise.
  if (existsSync(koren) && !existsSync(path.join(koren, OZNAKA))) {
    throw new NapakaNamestitve(`Mapa ${koren} že obstaja in je ni ustvarila Lina, zato je Lina ne uporabi.`);
  }
  await mkdir(koren, { recursive: true, mode: 0o700 });
  // Oznaka najprej: tudi napol namescen OmniRoute lahko Lina odstrani (samo mapo z oznako).
  if (!existsSync(path.join(koren, OZNAKA))) await writeFile(path.join(koren, OZNAKA), `${JSON.stringify({ omniroute: OMNIROUTE_RAZLICICA, npm: odv.npm.razlicica, namesceno: new Date().toISOString() })}\n`);
  await mkdir(path.join(koren, "dom"), { recursive: true, mode: 0o700 });
  await mkdir(prenos, { recursive: true });
  if (!existsSync(npmCli)) {
    const tgz = await prenesiPreverjeno(odv, `${odv.register}/npm/-/npm-${odv.npm.razlicica}.tgz`, odv.npm.sha512);
    const datoteka = path.join(prenos, "npm.tgz");
    await writeFile(datoteka, tgz);
    // CodeRabbit: razsiri v zacasno mapo in jo preimenuj sele po uspehu (napol razsirjen npm se ne uporabi).
    const zacasna = path.join(koren, "npm.zacasno");
    await rm(zacasna, { recursive: true, force: true });
    await rm(path.join(koren, "npm"), { recursive: true, force: true });
    await mkdir(zacasna, { recursive: true });
    const tar = sledi(odv.zazeni("tar", ["-xzf", datoteka, "-C", zacasna, "--strip-components=1", "--no-same-owner"], { stdio: "ignore", shell: false }));
    if ((await pocakaj(tar, 120_000)) !== 0) throw new NapakaNamestitve("Razširjanje prenesenega paketa ni uspelo.");
    await rename(zacasna, path.join(koren, "npm"));
  }
  nastavi("prenos", "uspeh");
  nastavi("namestitev", "tece");
  await mkdir(app, { recursive: true });
  const koreniZaklep = (ZAKLEP as { packages: Record<string, { dependencies?: Record<string, string> }> }).packages[""];
  await writeFile(path.join(app, "package.json"), `${JSON.stringify({ name: "lina-omniroute", version: "1.0.0", private: true, dependencies: koreniZaklep?.dependencies ?? {} }, null, 2)}\n`);
  await writeFile(path.join(app, "package-lock.json"), `${JSON.stringify(ZAKLEP, null, 2)}\n`);
  const okolje = okoljeOtroka(koren);
  const ci = sledi(odv.zazeni(
    odv.izvrsljivo,
    [npmCli, "ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--no-update-notifier", `--registry=${odv.register}/`, "--cache", path.join(prenos, "npm-predpomnilnik")],
    { cwd: app, env: okolje, stdio: "ignore", shell: false },
  ));
  if ((await pocakaj(ci, 30 * 60_000)) !== 0) throw new NapakaNamestitve("Namestitev OmniRoute ni uspela (prenos paketov). Preverite povezavo z internetom in prostor na disku ter poskusite znova.");
  // Brezplacni modeli brez kljucev (»auto«) potrebujejo brskalnik za Playwright (izmerjeno 26. 11. 2026: brez njega auto vrne 502).
  const pw = sledi(odv.zazeni(odv.izvrsljivo, [path.join(app, "node_modules", "playwright", "cli.js"), "install", "--only-shell", "chromium"], {
    cwd: app,
    env: { ...okolje, PLAYWRIGHT_BROWSERS_PATH: path.join(koren, "brskalniki") },
    stdio: "ignore",
    shell: false,
  }));
  if ((await pocakaj(pw, 15 * 60_000)) !== 0) throw new NapakaNamestitve("Namestitev brskalnika za brezplačne modele ni uspela. Poskusite znova.");
  const dist = path.join(app, "node_modules", "omniroute", "dist");
  if (!existsSync(dist)) throw new NapakaNamestitve("Namestitev OmniRoute ni popolna.");
  // Namesto postinstall (ne tece): isto kot ensureStandaloneRuntimePackages v omniroute/scripts/build/postinstall.mjs.
  for (const paket of ["sql.js", "node-machine-id"]) {
    await cp(path.join(app, "node_modules", paket), path.join(dist, "node_modules", paket), { recursive: true, force: true });
  }
  // Predpomnilnik npm (~1 GB) po namestitvi ni vec potreben; v mapi je samo, kar je prenesla Lina.
  await rm(prenos, { recursive: true, force: true });
  await writeFile(path.join(koren, KONCANO), `${OMNIROUTE_RAZLICICA}\n`);
  nastavi("namestitev", "uspeh");
}

/**
 * Soglasje za klice ostane, kot je bilo. Ce klici uporabljajo OmniRoute na DRUGEM naslovu, jih namestitev ne sme preusmeriti
 * na lokalnega (svetovalec, naloga 31): vrne null in Mozganov Lina ne spremeni.
 */
async function soglasjeZaKlice(root: string, naslov: string): Promise<boolean | null> {
  const k = await readJsonFile<{ provider?: unknown; naslov?: unknown; klici?: unknown }>(root, "kljuci.json");
  // Pregled 2 #2: tudi lasten OmniRoute na drugem naslovu v ponudniki.json (kljuc, asistentka) Lina ne prepise.
  const p = await readJsonFile<{ ponudniki?: { omniroute?: { naslov?: unknown } } }>(root, "ponudniki.json");
  const drugZapis = p?.ponudniki?.omniroute;
  if (drugZapis && !istiNaslov(drugZapis.naslov, naslov)) return null;
  if (k?.provider !== "omniroute") return false;
  if (!istiNaslov(k.naslov, naslov)) return null;
  return k.klici === true;
}

async function potek(token: string | null, root: string, odv: Odvisnosti): Promise<void> {
  const s = g();
  const nastavi = (k: Korak, st: StanjeKoraka) => {
    s.koraki[k] = st;
  };
  let trenutni: Korak = "prenos";
  try {
    const koren = path.join(root, MAPA);
    if (!existsSync(path.join(koren, KONCANO))) {
      await namestiDatoteke(root, odv, (k, st) => {
        trenutni = k;
        nastavi(k, st);
      });
    } else {
      nastavi("prenos", "uspeh");
      nastavi("namestitev", "uspeh");
    }
    trenutni = "zagon";
    nastavi("zagon", "tece");
    const sk = await zazeniNamescenega(root, odv);
    nastavi("zagon", "uspeh");
    trenutni = "preverba";
    nastavi("preverba", "tece");
    const naslov = naslovLokalnega(odv.vrata);
    if (!sk.kljuc || !(await seznamModelov(odv, naslov, sk.kljuc))) {
      sk.kljuc = await ustvariKljuc(odv, odv.vrata, sk.geslo);
      await zapisiSkrivnosti(root, sk);
    }
    const modeli = await seznamModelov(odv, naslov, sk.kljuc);
    if (!modeli) throw new NapakaNamestitve("OmniRoute teče, a ni vrnil seznama modelov.");
    // Lina sama vpise naslov in izbere delujoc model; soglasje za klice ostane, kot je bilo (nikoli ga ne vklopi sama).
    const zaKlice = await soglasjeZaKlice(root, naslov);
    if (zaKlice === null) {
      throw new NapakaNamestitve("OmniRoute je nameščen in teče, a v Možganih je že OmniRoute na drugem naslovu. Lina ga ne zamenja sama: naslov po želji spremenite v Možganih.");
    }
    await saveBrain({ provider: "omniroute", key: sk.kljuc, naslov, samodejno: true, zaKlice }, token, root);
    nastavi("preverba", "uspeh");
    s.pripravljeno = true;
  } catch (e) {
    nastavi(trenutni, "napaka");
    s.napaka = e instanceof NapakaNamestitve ? e.message : "Namestitev OmniRoute ni uspela. Poskusite znova.";
  }
}

export async function stanjeNamestitve(token: string | null, dir?: string): Promise<StanjeNamestitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const s = g();
  const tece = !!s.otrok && s.otrok.exitCode === null && s.otrok.signalCode === null;
  return {
    namescen: existsSync(path.join(root, MAPA, OZNAKA)),
    tece,
    vTeku: s.vTeku !== null,
    pripravljeno: s.pripravljeno,
    koraki: (["prenos", "namestitev", "zagon", "preverba"] as const).map((korak) => ({ korak, stanje: s.koraki[korak] })),
    napaka: s.napaka,
    naslov: tece || s.pripravljeno ? naslovLokalnega(s.vrata) : null,
    razlicica: OMNIROUTE_RAZLICICA,
  };
}

/**
 * Namesti (ce se ni) in zazene OmniRoute ter ga nastavi v Mozganih. Tece v ozadju; vmesnik bere stanjeNamestitve.
 * `odv` samo v preizkusih (nadomestni register, lazni npm).
 */
export async function namestiOmniroute(token: string | null, dir?: string, odv: Odvisnosti = privzeteOdvisnosti()): Promise<StanjeNamestitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const s = g();
  if (!s.vTeku) {
    s.koraki = zacetniKoraki();
    s.napaka = null;
    s.pripravljeno = false;
    s.vrata = odv.vrata;
    s.vTeku = potek(token, root, odv).finally(() => {
      s.vTeku = null;
    });
  }
  return stanjeNamestitve(token, dir);
}

/** Za preizkuse in vmesnik: pocaka tekoco namestitev. */
export async function pocakajNamestitev(): Promise<void> {
  await g().vTeku;
}

/** Ustavi OmniRoute, ki ga je zagnala Lina (SIGTERM, po 5 s SIGKILL). */
export async function ustaviOmniroute(): Promise<void> {
  const otrok = g().otrok;
  if (!otrok || otrok.exitCode !== null || otrok.signalCode !== null) return;
  const konec = new Promise<void>((ok) => otrok.once("exit", () => ok()));
  otrok.kill("SIGTERM");
  const rok = setTimeout(() => otrok.kill("SIGKILL"), 5000);
  await konec;
  clearTimeout(rok);
}

/**
 * Odstrani OmniRoute, ki ga je namestila Lina: samo mapo <podatki Line>/omniroute z oznako Line in sifrirane skrivnosti.
 * Ce je OmniRoute izbran za klice, ne odstrani (klici bi ostali brez ponudnika).
 */
export async function odstraniOmniroute(token: string | null, dir?: string): Promise<StanjeNamestitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const koren = path.join(root, MAPA);
  if (!existsSync(path.join(koren, OZNAKA))) throw new Error("Lina tega OmniRoute ni namestila, zato ga ne odstrani.");
  const s = g();
  if (s.vTeku) throw new Error("Namestitev še teče. Počakajte, da se konča.");
  // Slepi pregled #2: odstranitev zasede isto zaporo kot namestitev (med odstranjevanjem se namestitev ne zacne).
  let napaka: unknown = null;
  s.vTeku = (async () => {
    const k = await readJsonFile<{ provider?: unknown }>(root, "kljuci.json");
    if (k?.provider === "omniroute") throw new Error("OmniRoute je izbran za klice. Najprej v Možganih izberite drugega ponudnika za klice.");
    // CodeRabbit: vklopljen Prehod OmniRoute na Lininem naslovu bi po odstranitvi kazal v prazno.
    const prehod = await readJsonFile<{ vklop?: unknown; naslov?: unknown }>(root, "omniroute-nastavitve.json");
    if (prehod?.vklop === true && istiNaslov(prehod.naslov, naslovLokalnega(s.vrata))) {
      throw new Error("Prehod OmniRoute je vklopljen. Najprej ga izklopite v nastavitvah prehoda.");
    }
    await s.zaganjam?.catch(() => undefined);
    await ustaviOmniroute();
    await ustaviSiroto(koren);
    // Najprej Mozgani in skrivnosti, mapa z oznako zadnja: ob napaki gre odstranitev ponoviti (CodeRabbit).
    // Slepi pregled #4: asistentka ne sme ostati na odstranjenem OmniRoute (samo zapis z naslovom Lininega OmniRoute).
    await odstraniOmnirouteNaslova(token, naslovLokalnega(s.vrata), root);
    await rm(path.join(root, SKRIVNOSTI), { force: true });
    await rm(koren, { recursive: true, force: true });
    s.koraki = zacetniKoraki();
    s.napaka = null;
    s.pripravljeno = false;
  })()
    .catch((e: unknown) => {
      napaka = e;
    })
    .finally(() => {
      s.vTeku = null;
    });
  await s.vTeku;
  if (napaka) throw napaka;
  return stanjeNamestitve(token, dir);
}

/** Ob zagonu Line: ce je OmniRoute namestila Lina in je v Mozganih, ga zazene (napaka ni usodna). */
export async function zazeniObZagonu(dir?: string, odv: Odvisnosti = privzeteOdvisnosti()): Promise<void> {
  const root = resolveDataDir(dir);
  if (g().vTeku) return;
  if (!existsSync(path.join(root, MAPA, OZNAKA)) || !existsSync(path.join(root, MAPA, KONCANO))) return;
  const p = await readJsonFile<{ ponudniki?: Record<string, unknown> }>(root, "ponudniki.json");
  const k = await readJsonFile<{ provider?: unknown }>(root, "kljuci.json");
  if (!p?.ponudniki?.omniroute && k?.provider !== "omniroute") return;
  await zazeniNamescenega(root, odv).catch(() => undefined);
}

/** Za preizkus: prebere oznako (ali je mapa Linina). */
export async function oznakaNamestitve(dir?: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(korenOmniroute(dir), OZNAKA), "utf8"));
}
