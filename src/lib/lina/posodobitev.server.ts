/**
 * Vgrajena posodobitev Line na racunalniku (lastnik 23. 11. 2026: »Ne prenosnika to more biti del programa«). Samo Linux amd64,
 * paket .deb lina-lupina. Namestitev tece v LOCENEM procesu (skripta posodobi.sh, setsid), ker zapre Lino in s tem ta streznik.
 * Varovala: ime paketa, samo NOVEJSA razlicica (23. 11. 2026 je bil pomotoma namescen 0.2.5 cez 0.2.8), SHA-256 iz SHA256SUMS
 * (vir GitHub), vsoto preverjene datoteke preveri se skripta tik pred pkexec, ena posodobitev naenkrat.
 * Brskalnik ne da nobenega podatka: pot, razlicico in vir izracuna streznik sam.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { jeLinuxAmd64 } from "./platforma.server.ts";
import { readJsonFile, resolveDataDir } from "./store.server.ts";
import { prenesiPreverjeno, vsotaEnaka } from "./tunel.server.ts";

export const IME_PAKETA = "lina-lupina";
export const SKRIPTA_POSODOBITVE = "/opt/Lina/resources/lina/posodobi.sh";
export const DATOTEKA_VIRA = "posodobitev.json";
export const DATOTEKA_IZIDA = "posodobitev-izid.json";
export const MAPA_PRENOSA = "posodobitev";
const API_IZDAJE = "https://api.github.com/repos/safeerOS/Lina/releases/latest";
const OSNOVA_PRENOSA = "https://github.com/safeerOS/Lina/releases/download/";
const NAJVEC_PAKETA = 400_000_000;
const ROK_PAKETA_MS = 30 * 60_000;
const NAJVEC_API = 1_000_000;
const PREDPOMNILNIK_MS = 10 * 60_000;
/** Stroga oblika razlicice (stevke in pike): poenostavi primerjavo v bashu in JSON izida ostane varen. */
const RAZLICICA = /^[0-9]{1,6}(\.[0-9]{1,6}){0,3}$/;
const IME_DEB = /^lina-lupina_([0-9.]{1,30})_amd64\.deb$/;
const NADZORNI = /[\u0000-\u001f\u007f-\u009f]/;

export type Vir = "github" | "mapa";
export type Kandidat = { razlicica: string; vir: Vir; ime: string; url?: string; urlVsot?: string; pot?: string };
export type KodaIzida = "namesceno" | "preklicano" | "napaka" | "ni_novejsa" | "napacen_paket" | "vsota";
export type IzidPosodobitve = { cas: string; razlicica: string; ok: boolean; koda: KodaIzida };
export type RazlogNiNaVoljo = "platforma" | "ni_skripte" | "ni_namescena";
export type StanjePosodobitve =
  | { naVoljo: false; razlog: RazlogNiNaVoljo; zadnjiIzid: IzidPosodobitve | null }
  | {
      naVoljo: true;
      namescena: string;
      razpolozljiva: string | null;
      vir: Vir | null;
      novejsa: boolean;
      tece: boolean;
      napakaVira: boolean;
      zadnjiIzid: IzidPosodobitve | null;
    };
export type RazlogZavrnitve = "platforma" | "ni_skripte" | "ni_namescena" | "ze_tece" | "ni_vira" | "ni_novejsa" | "napacen_paket" | "vsota" | "prenos" | "pot";
export type IzidZagona = { ok: true; razlicica: string } | { ok: false; razlog: RazlogZavrnitve };

/** Zagnan otrok: samo kar potrebujemo (dogodka konca, odveza). */
export type Otrok = { on(dogodek: "exit" | "error", fn: () => void): unknown; unref(): void };

export type Odvisnosti = {
  platforma?: NodeJS.Platform;
  arh?: string;
  skripta?: string;
  obstaja?: (pot: string) => boolean;
  /** execFile z absolutno potjo programa; vrne stdout ali vrze napako. */
  izvedi?: (program: string, argumenti: string[]) => Promise<string>;
  fetchFn?: typeof fetch;
  prenesi?: (url: string, cilj: string) => Promise<string>;
  vsotaDatoteke?: (pot: string) => Promise<string>;
  beriMapo?: (mapa: string) => Promise<string[]>;
  zazeni?: (program: string, argumenti: string[], env: Record<string, string>) => Otrok;
  env?: NodeJS.ProcessEnv;
  zdaj?: () => number;
};

// --- Primerjava razlicic kot dpkg (lib/dpkg/version.c: verrevcmp), da odlocitev v TS in v skripti ne more biti razlicna.
function red(c: string): number {
  if (c === "") return 0;
  if (c >= "0" && c <= "9") return 0;
  if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) return c.charCodeAt(0);
  if (c === "~") return -1;
  return c.charCodeAt(0) + 256;
}
const jeStevka = (c: string) => c >= "0" && c <= "9" && c !== "";

function primerjajDel(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    let prvaRazlika = 0;
    while ((i < a.length && !jeStevka(a.charAt(i))) || (j < b.length && !jeStevka(b.charAt(j)))) {
      const ac = red(a.charAt(i));
      const bc = red(b.charAt(j));
      if (ac !== bc) return ac - bc;
      i++;
      j++;
    }
    while (a.charAt(i) === "0") i++;
    while (b.charAt(j) === "0") j++;
    while (jeStevka(a.charAt(i)) && jeStevka(b.charAt(j))) {
      if (!prvaRazlika) prvaRazlika = a.charCodeAt(i) - b.charCodeAt(j);
      i++;
      j++;
    }
    if (jeStevka(a.charAt(i))) return 1;
    if (jeStevka(b.charAt(j))) return -1;
    if (prvaRazlika) return prvaRazlika;
  }
  return 0;
}

function razcleni(v: string): [number, string, string] {
  const d = v.indexOf(":");
  const epoha = d > 0 ? Number(v.slice(0, d)) || 0 : 0;
  const ostalo = d > 0 ? v.slice(d + 1) : v;
  const r = ostalo.lastIndexOf("-");
  return r > 0 ? [epoha, ostalo.slice(0, r), ostalo.slice(r + 1)] : [epoha, ostalo, ""];
}

/** <0 a je starejsa, 0 enaka, >0 a je novejsa (kot dpkg --compare-versions). */
export function primerjajRazlicici(a: string, b: string): number {
  const [ea, ua, ra] = razcleni(a);
  const [eb, ub, rb] = razcleni(b);
  if (ea !== eb) return ea - eb;
  return primerjajDel(ua, ub) || primerjajDel(ra, rb);
}

export function veljavnaRazlicica(v: unknown): v is string {
  return typeof v === "string" && RAZLICICA.test(v);
}

/** Pot do paketa: absolutna, brez nadzornih znakov (gre kot argument v skripto in v pkexec). */
export function varnaPot(p: unknown): p is string {
  return typeof p === "string" && p.length > 0 && p.length < 4096 && path.isAbsolute(p) && !NADZORNI.test(p);
}

/** Najnovejsi lina-lupina_*_amd64.deb v mapi; primerjava kot dpkg (0.2.10 > 0.2.9), ne abecedno. */
export function najnovejsiPaket(imena: readonly string[]): { ime: string; razlicica: string } | null {
  let naj: { ime: string; razlicica: string } | null = null;
  for (const ime of imena) {
    const m = IME_DEB.exec(ime);
    if (!m || !veljavnaRazlicica(m[1])) continue;
    if (!naj || primerjajRazlicici(m[1], naj.razlicica) > 0) naj = { ime, razlicica: m[1] };
  }
  return naj;
}

/** Vrstica iz SHA256SUMS (»<64 hex>  ime« ali »<64 hex> *ime«) za tocno to ime. */
export function vsotaIzSeznama(besedilo: string, ime: string): string | null {
  for (const vrstica of besedilo.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+?)\s*$/.exec(vrstica);
    if (m && m[2] === ime) return m[1].toLowerCase();
  }
  return null;
}

// --- Privzete odvisnosti (v preizkusih se vse vbrizgajo; pravi spawn se v preizkusu ne sme sproziti).
function privzetoIzvedi(program: string, argumenti: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(program, argumenti, { timeout: 30_000, maxBuffer: 1_000_000, env: { ...process.env, LC_ALL: "C" } }, (napaka, stdout) =>
      napaka ? reject(napaka) : resolve(String(stdout)),
    );
  });
}

function privzetaVsota(pot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(pot).on("data", (k) => h.update(k)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

/**
 * Okolje skripte s seznama DOVOLJENEGA: namizje za pkexec in notify-send. Streznik tece z ELECTRON_RUN_AS_NODE (izmerjeno 23. 11. 2026):
 * podedovan bi `lina-lupina --koncaj` in ponoven zagon zagnal Node namesto programa; zeton lupine in kljuci ne gredo naprej.
 */
export function okoljeSkripte(env: NodeJS.ProcessEnv): Record<string, string> {
  const izid: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    if (/^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE)$/.test(k) || /^(XDG|LC)_[A-Z_]+$/.test(k)) izid[k] = v;
  }
  izid.PATH = "/usr/bin:/bin";
  return izid;
}

function privzetoZazeni(program: string, argumenti: string[], env: Record<string, string>): Otrok {
  // detached = setsid: skripta prezivi zaprtje Line (in tega streznika).
  return spawn(program, argumenti, { detached: true, stdio: "ignore", env });
}

function odv(o: Odvisnosti) {
  const fetchFn = o.fetchFn ?? fetch;
  return {
    platforma: o.platforma,
    arh: o.arh,
    skripta: o.skripta ?? SKRIPTA_POSODOBITVE,
    obstaja: o.obstaja ?? existsSync,
    izvedi: o.izvedi ?? privzetoIzvedi,
    fetchFn,
    prenesi: o.prenesi ?? ((u: string, c: string) => prenesiPreverjeno(u, c, fetchFn, { najvecBajtov: NAJVEC_PAKETA, rokMs: ROK_PAKETA_MS })),
    vsotaDatoteke: o.vsotaDatoteke ?? privzetaVsota,
    beriMapo: o.beriMapo ?? ((m: string) => readdir(m)),
    zazeni: o.zazeni ?? privzetoZazeni,
    env: o.env ?? process.env,
    zdaj: o.zdaj ?? Date.now,
  };
}
type Odv = ReturnType<typeof odv>;

export async function namescenaRazlicica(o: Odv): Promise<string | null> {
  try {
    const v = (await o.izvedi("/usr/bin/dpkg-query", ["-W", "-f=${Version}", IME_PAKETA])).trim();
    return veljavnaRazlicica(v) ? v : null;
  } catch {
    return null;
  }
}

/** Ime in razlicica iz kontrolne datoteke paketa (dpkg-deb -f); ime datoteke samo izbere kandidata. */
export async function podatkiPaketa(o: Odv, deb: string): Promise<{ paket: string; razlicica: string } | null> {
  try {
    const izpis = await o.izvedi("/usr/bin/dpkg-deb", ["-f", deb, "Package", "Version"]);
    const paket = /^Package: (.*)$/m.exec(izpis)?.[1]?.trim() ?? "";
    const razlicica = /^Version: (.*)$/m.exec(izpis)?.[1]?.trim() ?? "";
    return { paket, razlicica };
  } catch {
    return null;
  }
}

/** Vir B: mapa iz posodobitev.json v podatkovni mapi (razvojni racunalnik); brez datoteke vir B ne velja. */
async function mapaVira(root: string): Promise<string | null | "neveljavno"> {
  const vsebina = await readJsonFile<{ mapa?: unknown }>(root, DATOTEKA_VIRA).catch(() => null);
  if (!vsebina) return null;
  return varnaPot(vsebina.mapa) ? path.resolve(vsebina.mapa) : "neveljavno";
}

type Predpomnilnik = { cas: number; kandidat: Kandidat | null } | null;
let predpomnilnik: Predpomnilnik = null;
export function ponastaviPredpomnilnik(): void {
  predpomnilnik = null;
}

/** Vir A: zadnja izdaja javnega repozitorija. Naslove sredstev sestavimo sami (ne browser_download_url). */
export async function kandidatGithub(o: Odv, sveze = false): Promise<Kandidat | null> {
  if (!sveze && predpomnilnik && o.zdaj() - predpomnilnik.cas < PREDPOMNILNIK_MS) return predpomnilnik.kandidat;
  const odgovor = await o.fetchFn(API_IZDAJE, {
    redirect: "error",
    headers: { accept: "application/vnd.github+json", "user-agent": "Lina" },
    signal: AbortSignal.timeout(15_000),
  });
  let kandidat: Kandidat | null = null;
  if (odgovor.status === 404) {
    await odgovor.body?.cancel().catch(() => undefined);
  } else {
    if (!odgovor.ok) throw new Error("GitHub ni odgovoril.");
    const besedilo = await odgovor.text();
    if (besedilo.length > NAJVEC_API) throw new Error("Odgovor je prevelik.");
    const izdaja = JSON.parse(besedilo) as { tag_name?: unknown; assets?: Array<{ name?: unknown }> };
    const oznaka = izdaja.tag_name;
    const imena = Array.isArray(izdaja.assets) ? izdaja.assets.map((a) => (typeof a?.name === "string" ? a.name : "")) : [];
    const paket = najnovejsiPaket(imena);
    if (typeof oznaka === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(oznaka) && paket && imena.includes("SHA256SUMS")) {
      const osnova = `${OSNOVA_PRENOSA}${oznaka}/`;
      kandidat = { razlicica: paket.razlicica, vir: "github", ime: paket.ime, url: osnova + paket.ime, urlVsot: osnova + "SHA256SUMS" };
    }
  }
  predpomnilnik = { cas: o.zdaj(), kandidat };
  return kandidat;
}

async function kandidatMapa(o: Odv, mapa: string): Promise<Kandidat | null> {
  const paket = najnovejsiPaket(await o.beriMapo(mapa).catch(() => []));
  return paket ? { razlicica: paket.razlicica, vir: "mapa", ime: paket.ime, pot: path.join(mapa, paket.ime) } : null;
}

async function kandidat(o: Odv, root: string, sveze: boolean): Promise<Kandidat | null> {
  const mapa = await mapaVira(root);
  if (mapa === "neveljavno") return null;
  return mapa ? kandidatMapa(o, mapa) : kandidatGithub(o, sveze);
}

export async function zadnjiIzid(root: string): Promise<IzidPosodobitve | null> {
  const i = await readJsonFile<Partial<IzidPosodobitve>>(root, DATOTEKA_IZIDA).catch(() => null);
  const kode: KodaIzida[] = ["namesceno", "preklicano", "napaka", "ni_novejsa", "napacen_paket", "vsota"];
  if (!i || typeof i.cas !== "string" || !veljavnaRazlicica(i.razlicica) || typeof i.ok !== "boolean" || !kode.includes(i.koda as KodaIzida)) return null;
  return { cas: i.cas.slice(0, 40), razlicica: i.razlicica, ok: i.ok, koda: i.koda as KodaIzida };
}

let tece = false;
/** Samo za preizkuse: zaklep je v pomnilniku procesa. */
export function posodobitevTece(): boolean {
  return tece;
}

async function predpogoj(o: Odv): Promise<RazlogNiNaVoljo | { namescena: string }> {
  if (!jeLinuxAmd64(o.platforma, o.arh)) return "platforma";
  if (!o.obstaja(o.skripta)) return "ni_skripte";
  const namescena = await namescenaRazlicica(o);
  return namescena ? { namescena } : "ni_namescena";
}

export async function stanjePosodobitve(token: string | null, dir?: string, odvisnosti: Odvisnosti = {}): Promise<StanjePosodobitve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const o = odv(odvisnosti);
  const izid = await zadnjiIzid(root);
  const p = await predpogoj(o);
  if (typeof p === "string") return { naVoljo: false, razlog: p, zadnjiIzid: izid };
  let k: Kandidat | null = null;
  let napakaVira = false;
  try {
    k = await kandidat(o, root, false);
  } catch {
    napakaVira = true;
  }
  return {
    naVoljo: true,
    namescena: p.namescena,
    razpolozljiva: k?.razlicica ?? null,
    vir: k?.vir ?? null,
    novejsa: Boolean(k && primerjajRazlicici(k.razlicica, p.namescena) > 0),
    tece,
    napakaVira,
    zadnjiIzid: izid,
  };
}

/** Prenese in preveri paket z GitHuba v <podatki>/posodobitev (0700); vrne pot in vsoto preverjene datoteke. */
async function pripraviGithub(o: Odv, root: string, k: Kandidat): Promise<{ pot: string; vsota: string } | RazlogZavrnitve> {
  const mapa = path.join(root, MAPA_PRENOSA);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  await chmod(mapa, 0o700);
  const zacasnaDeb = path.join(mapa, `.prenos-${process.pid}.deb`);
  const zacasneVsote = path.join(mapa, `.vsote-${process.pid}.txt`);
  try {
    let vsota: string;
    let seznam: string;
    try {
      await o.prenesi(k.urlVsot!, zacasneVsote);
      seznam = await readFile(zacasneVsote, "utf8");
      vsota = await o.prenesi(k.url!, zacasnaDeb);
    } catch {
      return "prenos";
    }
    const pricakovana = vsotaIzSeznama(seznam, k.ime);
    if (!pricakovana || !vsotaEnaka(vsota, pricakovana)) return "vsota";
    const koncna = path.join(mapa, k.ime);
    await rename(zacasnaDeb, koncna);
    return { pot: koncna, vsota: pricakovana };
  } finally {
    await rm(zacasnaDeb, { force: true });
    await rm(zacasneVsote, { force: true });
  }
}

/**
 * Deb iz mape gradnje (vidna mapa v Prejemih, 0755, morda na deljeni particiji) se kopira v <podatki>/posodobitev (0700) brez
 * sledenja povezavi; vsota se preveri na KOPIJI in skripta dobi kopijo (pregled 0225 A-15: med preverbo in pkexec dpkg -i datoteke
 * v vidni mapi ni vec mogoce zamenjati). Vrne pot kopije ali null.
 */
async function kopirajGradnjo(root: string, deb: string): Promise<string | null> {
  const mapa = path.join(root, MAPA_PRENOSA);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  await chmod(mapa, 0o700);
  const zacasna = path.join(mapa, `.gradnja-${process.pid}.deb`);
  let vir;
  try {
    vir = await open(deb, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    if (!(await vir.stat()).isFile()) return null;
    await rm(zacasna, { force: true });
    const cilj = await open(zacasna, "wx", 0o600);
    try {
      const kos = Buffer.alloc(1 << 20);
      for (let mesto = 0; ;) {
        const { bytesRead } = await vir.read(kos, 0, kos.length, mesto);
        if (bytesRead === 0) break;
        await cilj.write(kos, 0, bytesRead);
        mesto += bytesRead;
      }
    } finally {
      await cilj.close();
    }
    const koncna = path.join(mapa, path.basename(deb));
    await rename(zacasna, koncna);
    return koncna;
  } catch {
    return null;
  } finally {
    await vir.close();
    await rm(zacasna, { force: true }).catch(() => undefined);
  }
}

/** Zagon posodobitve: kandidata izracuna streznik znova (brskalnik ne da nicesar); skripta tece locena od streznika. */
export async function zacniPosodobitev(token: string | null, dir?: string, odvisnosti: Odvisnosti = {}): Promise<IzidZagona> {
  return zacni(token, dir, odvisnosti, null);
}

/**
 * Gradnja na GitHubu (24. 11. 2026, gradnje-github.server.ts): isti potek in ista varovala (ime paketa, samo novejsa, vsota,
 * zaklep, skripta). Paket je TOCNO datoteka zadnje gradnje iz stanja streznika (brskalnik ne da poti) in njena vsota mora biti
 * enaka sha256, zapisani ob prenosu: datoteka, zamenjana ali dodana v vidni mapi po gradnji, se ne namesti.
 */
export async function zacniPosodobitevIzGradnje(token: string | null, deb: { pot: string; sha256: string }, dir?: string, odvisnosti: Odvisnosti = {}): Promise<IzidZagona> {
  return zacni(token, dir, odvisnosti, deb);
}

async function zacni(token: string | null, dir: string | undefined, odvisnosti: Odvisnosti, gradnja: { pot: string; sha256: string } | null): Promise<IzidZagona> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (gradnja !== null && (!varnaPot(gradnja.pot) || !/^[0-9a-f]{64}$/.test(gradnja.sha256))) return { ok: false, razlog: "pot" };
  // Zaklep sinhrono, pred prvim await po preverbi lastnika: dva hkratna klika ne zazeneta dveh namestitev.
  if (tece) return { ok: false, razlog: "ze_tece" };
  tece = true;
  let predano = false;
  try {
    const o = odv(odvisnosti);
    const p = await predpogoj(o);
    if (typeof p === "string") return { ok: false, razlog: p };
    let k: Kandidat | null;
    try {
      k = gradnja !== null ? await kandidatMapa(o, path.dirname(path.resolve(gradnja.pot))) : await kandidat(o, root, true);
    } catch {
      return { ok: false, razlog: "ni_vira" };
    }
    if (!k) return { ok: false, razlog: "ni_vira" };
    if (primerjajRazlicici(k.razlicica, p.namescena) <= 0) return { ok: false, razlog: "ni_novejsa" };
    let deb: string;
    let vsota: string;
    if (k.vir === "github") {
      const pripravljeno = await pripraviGithub(o, root, k);
      if (typeof pripravljeno === "string") return { ok: false, razlog: pripravljeno };
      ({ pot: deb, vsota } = pripravljeno);
    } else {
      deb = k.pot!;
      if (gradnja !== null) {
        // gradnja: najnovejsi paket v mapi mora biti prav datoteka gradnje; preveri in namesti se njena zasebna kopija (A-15)
        if (deb !== path.resolve(gradnja.pot)) return { ok: false, razlog: "vsota" };
        const kopija = await kopirajGradnjo(root, deb);
        if (!kopija) return { ok: false, razlog: "prenos" };
        deb = kopija;
      }
      vsota = await o.vsotaDatoteke(deb).catch(() => "");
      if (!/^[0-9a-f]{64}$/.test(vsota)) return { ok: false, razlog: "prenos" };
      if (gradnja !== null && !vsotaEnaka(vsota, gradnja.sha256)) return { ok: false, razlog: "vsota" };
    }
    if (!varnaPot(deb) || !varnaPot(root)) return { ok: false, razlog: "pot" };
    const podatki = await podatkiPaketa(o, deb);
    if (!podatki || podatki.paket !== IME_PAKETA || podatki.razlicica !== k.razlicica) return { ok: false, razlog: "napacen_paket" };
    if (primerjajRazlicici(podatki.razlicica, p.namescena) <= 0) return { ok: false, razlog: "ni_novejsa" };
    const otrok = o.zazeni("/bin/bash", [o.skripta, deb, root, vsota], okoljeSkripte(o.env));
    predano = true;
    const sprosti = () => {
      tece = false;
    };
    otrok.on("exit", sprosti);
    otrok.on("error", sprosti);
    otrok.unref();
    return { ok: true, razlicica: k.razlicica };
  } finally {
    if (!predano) tece = false;
  }
}
