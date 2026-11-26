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
import { cp, mkdir, readFile, rm, statfs, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, saveBrain, sifrirajSkrivnost } from "./keys.server.ts";
import ZAKLEP from "./omniroute-zaklep.json" with { type: "json" };
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const OMNIROUTE_RAZLICICA = "3.8.54";
/** npm 11.21.3: sha512 iz registra (npm view npm@11.21.3 dist.integrity), preverjeno 26. 11. 2026. */
export const NPM_PRIPET = { razlicica: "11.21.3", sha512: "5Cf+jE+XctbhH/zjOOqXC+ity7eec/Tkk4Ql38tf6w+1htp2wYPHmE4c1R1Es3DY227Ac14+SLrlYJwkBicbTg==" };
export const REGISTER = "https://registry.npmjs.org";
export const VRATA_OMNIROUTE = 20128;
const MAPA = "omniroute";
const OZNAKA = "lina-namestitev.json";
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
};

function g(): Globalno {
  const x = globalThis as { [KLJUC_STANJA]?: Globalno };
  x[KLJUC_STANJA] ??= { vTeku: null, koraki: zacetniKoraki(), napaka: null, pripravljeno: false, otrok: null, izhodPrijavljen: false, vrata: VRATA_OMNIROUTE };
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
  const prijava = await odv.fetch(`${osnova}/api/auth/login`, { method: "POST", headers: glave, body: JSON.stringify({ password: geslo }), redirect: "error" });
  const piskotki = prijava.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await prijava.body?.cancel();
  if (!prijava.ok || !piskotki) throw new NapakaNamestitve("Lina se ni mogla prijaviti v OmniRoute (geslo). Odstranite OmniRoute in ga namestite znova.");
  const r = await odv.fetch(`${osnova}/api/keys`, { method: "POST", headers: { ...glave, cookie: piskotki }, body: JSON.stringify({ name: "Lina" }), redirect: "error" });
  const j = (await r.json().catch(() => null)) as { key?: unknown } | null;
  if (!r.ok || typeof j?.key !== "string" || j.key.length < 8) throw new NapakaNamestitve("OmniRoute ni ustvaril ključa za Lino.");
  return j.key;
}

function prijaviIzhod(s: Globalno): void {
  if (s.izhodPrijavljen) return;
  s.izhodPrijavljen = true;
  // Ob koncu Line se OmniRoute ustavi (exit je sinhron: samo signal).
  process.on("exit", () => g().otrok?.kill("SIGTERM"));
}

/** Zazene OmniRoute, ki ga je namestila Lina (ce se ne tece), in pocaka, da odgovori. */
async function zazeniNamescenega(root: string, odv: Odvisnosti): Promise<Skrivnosti> {
  const s = g();
  const koren = path.join(root, MAPA);
  const sk = await skrivnosti(root);
  const naslov = naslovLokalnega(odv.vrata);
  if (s.otrok && s.otrok.exitCode === null && s.otrok.signalCode === null) return sk;
  if (!(await vrataProsta(odv.vrata))) {
    // Na vratih ze nekaj tece: uporabimo ga samo, ce sprejme nas kljuc (nas proces iz prejsnjega zagona); tujega ne ustavimo.
    if (sk.kljuc && (await seznamModelov(odv, naslov, sk.kljuc))) return sk;
    throw new NapakaNamestitve(`Vrata ${odv.vrata} že uporablja drug program, zato Lina OmniRoute ne more zagnati. Lina tega programa ne ustavi.`);
  }
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
  otrok.once("exit", () => {
    if (s.otrok === otrok) s.otrok = null;
  });
  await writeFile(path.join(koren, "streznik.pid"), String(otrok.pid ?? ""), { mode: 0o600 }).catch(() => undefined);
  const zacetek = Date.now();
  while (Date.now() - zacetek < odv.rokZagonaMs) {
    if (s.otrok !== otrok) throw new NapakaNamestitve("OmniRoute se je ob zagonu ustavil.");
    try {
      const r = await odv.fetch(`${naslov}/models`, { redirect: "error", signal: AbortSignal.timeout(2000) });
      await r.body?.cancel();
      return sk;
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
  await mkdir(koren, { recursive: true, mode: 0o700 });
  // Oznaka najprej: tudi napol namescen OmniRoute lahko Lina odstrani (samo mapo z oznako).
  await writeFile(path.join(koren, OZNAKA), `${JSON.stringify({ omniroute: OMNIROUTE_RAZLICICA, npm: odv.npm.razlicica, namesceno: new Date().toISOString() })}\n`);
  await mkdir(path.join(koren, "dom"), { recursive: true, mode: 0o700 });
  await mkdir(prenos, { recursive: true });
  if (!existsSync(npmCli)) {
    const tgz = await prenesiPreverjeno(odv, `${odv.register}/npm/-/npm-${odv.npm.razlicica}.tgz`, odv.npm.sha512);
    const datoteka = path.join(prenos, "npm.tgz");
    await writeFile(datoteka, tgz);
    await mkdir(path.join(koren, "npm"), { recursive: true });
    const tar = odv.zazeni("tar", ["-xzf", datoteka, "-C", path.join(koren, "npm"), "--strip-components=1", "--no-same-owner"], { stdio: "ignore", shell: false });
    if ((await pocakaj(tar, 120_000)) !== 0) throw new NapakaNamestitve("Razširjanje prenesenega paketa ni uspelo.");
  }
  nastavi("prenos", "uspeh");
  nastavi("namestitev", "tece");
  await mkdir(app, { recursive: true });
  const koreniZaklep = (ZAKLEP as { packages: Record<string, { dependencies?: Record<string, string> }> }).packages[""];
  await writeFile(path.join(app, "package.json"), `${JSON.stringify({ name: "lina-omniroute", version: "1.0.0", private: true, dependencies: koreniZaklep?.dependencies ?? {} }, null, 2)}\n`);
  await writeFile(path.join(app, "package-lock.json"), `${JSON.stringify(ZAKLEP, null, 2)}\n`);
  const okolje = okoljeOtroka(koren);
  const ci = odv.zazeni(
    odv.izvrsljivo,
    [npmCli, "ci", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--no-update-notifier", `--registry=${odv.register}/`, "--cache", path.join(prenos, "npm-predpomnilnik")],
    { cwd: app, env: okolje, stdio: "ignore", shell: false },
  );
  if ((await pocakaj(ci, 30 * 60_000)) !== 0) throw new NapakaNamestitve("Namestitev OmniRoute ni uspela (prenos paketov). Preverite povezavo z internetom in prostor na disku ter poskusite znova.");
  // Brezplacni modeli brez kljucev (»auto«) potrebujejo brskalnik za Playwright (izmerjeno 26. 11. 2026: brez njega auto vrne 502).
  const pw = odv.zazeni(odv.izvrsljivo, [path.join(app, "node_modules", "playwright", "cli.js"), "install", "--only-shell", "chromium"], {
    cwd: app,
    env: { ...okolje, PLAYWRIGHT_BROWSERS_PATH: path.join(koren, "brskalniki") },
    stdio: "ignore",
    shell: false,
  });
  if ((await pocakaj(pw, 15 * 60_000)) !== 0) throw new NapakaNamestitve("Namestitev brskalnika za brezplačne modele ni uspela. Poskusite znova.");
  const dist = path.join(app, "node_modules", "omniroute", "dist");
  if (!existsSync(dist)) throw new NapakaNamestitve("Namestitev OmniRoute ni popolna.");
  // Namesto postinstall (ne tece): isto kot ensureStandaloneRuntimePackages v omniroute/scripts/build/postinstall.mjs.
  for (const paket of ["sql.js", "node-machine-id"]) {
    await cp(path.join(app, "node_modules", paket), path.join(dist, "node_modules", paket), { recursive: true, force: true });
  }
  // Predpomnilnik npm (~1 GB) po namestitvi ni vec potreben; v mapi je samo, kar je prenesla Lina.
  await rm(prenos, { recursive: true, force: true });
  nastavi("namestitev", "uspeh");
}

async function soglasjeZaKlice(root: string): Promise<boolean> {
  const k = await readJsonFile<{ provider?: unknown; klici?: unknown }>(root, "kljuci.json");
  return k?.provider === "omniroute" && k.klici === true;
}

async function potek(token: string | null, root: string, odv: Odvisnosti): Promise<void> {
  const s = g();
  const nastavi = (k: Korak, st: StanjeKoraka) => {
    s.koraki[k] = st;
  };
  let trenutni: Korak = "prenos";
  try {
    const koren = path.join(root, MAPA);
    if (!existsSync(path.join(koren, "app", "node_modules", "omniroute", "dist"))) {
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
    await saveBrain({ provider: "omniroute", key: sk.kljuc, naslov, samodejno: true, zaKlice: await soglasjeZaKlice(root) }, token, root);
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
  if (g().vTeku) throw new Error("Namestitev še teče. Počakajte, da se konča.");
  const k = await readJsonFile<{ provider?: unknown }>(root, "kljuci.json");
  if (k?.provider === "omniroute") throw new Error("OmniRoute je izbran za klice. Najprej v Možganih izberite drugega ponudnika za klice.");
  await ustaviOmniroute();
  await rm(koren, { recursive: true, force: true });
  await rm(path.join(root, SKRIVNOSTI), { force: true });
  const s = g();
  s.koraki = zacetniKoraki();
  s.napaka = null;
  s.pripravljeno = false;
  return stanjeNamestitve(token, dir);
}

/** Ob zagonu Line: ce je OmniRoute namestila Lina in je v Mozganih, ga zazene (napaka ni usodna). */
export async function zazeniObZagonu(dir?: string, odv: Odvisnosti = privzeteOdvisnosti()): Promise<void> {
  const root = resolveDataDir(dir);
  if (!existsSync(path.join(root, MAPA, OZNAKA)) || !existsSync(path.join(root, MAPA, "app", "node_modules", "omniroute", "dist"))) return;
  const p = await readJsonFile<{ ponudniki?: Record<string, unknown> }>(root, "ponudniki.json");
  const k = await readJsonFile<{ provider?: unknown }>(root, "kljuci.json");
  if (!p?.ponudniki?.omniroute && k?.provider !== "omniroute") return;
  await zazeniNamescenega(root, odv).catch(() => undefined);
}

/** Za preizkus: prebere oznako (ali je mapa Linina). */
export async function oznakaNamestitve(dir?: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(korenOmniroute(dir), OZNAKA), "utf8"));
}
