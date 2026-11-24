/**
 * Nastavitve > GitHub (lastnik 24. 11. 2026; AGENTS.md »Lina gradi APK in deb na GitHubu«). Splosno za vsakega uporabnika, tri poti:
 * (1) Prijava z GitHubom (OAuth device flow, client id GITHUB_CLIENT_ID; prazen = pot ni na voljo), (2) obstojeca prijava `gh` na tem
 * racunalniku (zetona Lina NE bere, zahteve gredo prek `gh api`), (3) kljuc, ki ga vpise uporabnik (github_pat_/ghp_, preverba GET /user).
 * Zeton OAuth in kljuc sta sifrirana (keys.server.ts, AAD »github«) v github-dostop.json (0600); nikoli v odgovor API, dnevnik, model,
 * na telefon ali v izvoz. Izbira repozitorijev in tokov: github-izbira.json (0600), `dovoljeniTokovi()` za gradnjo.
 * Za druge module je edini vhod `githubZahteva()`: samo api.github.com in samo zahteve s seznama (github-dostop.ts jeDovoljenaZahteva).
 * Tajnica (klici) te datoteke ne uvaza (github-dostop.server.test.ts).
 */
import { execFile } from "node:child_process";
import { constants, accessSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { koncnicaIzvedljive } from "./platforma.server.ts";
import { t } from "./besedila.ts";
import {
  API,
  GITHUB_CLIENT_ID,
  NA_STRAN,
  NAJVEC_REPOZITORIJEV,
  NAJVEC_TOKOV,
  NASLOV_KODE,
  NASLOV_ZETONA,
  OBSEG_OAUTH,
  datotekaIzPoti,
  imaRocniZagon,
  jeDovoljenaZahteva,
  jeDovoljenoTelo,
  jeImeRacuna,
  jeNacin,
  jeOblikaKljuca,
  jeOblikaZetonaOauth,
  jeRepozitorij,
  normalizirajIzbiro,
  razberiKodoNaprave,
  razberiZeton,
  sploscenaIzbira,
  vsebinaDatoteke,
  type DovoljenTok,
  type IzbiraRepozitorija,
  type JavnoStanjeGithub,
  type Nacin,
  type TokRepozitorija,
} from "./github-dostop.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_DOSTOPA = "github-dostop.json";
export const DATOTEKA_IZBIRE = "github-izbira.json";
const AAD = "github";
const ROK_MS = 30_000;
const ROK_GH_MS = 60_000;

type Sifra = { iv: string; tag: string; ciphertext: string };
type Shranjeno = { nacin: Nacin; racun: string; zeton?: Sifra };

export type OdgovorHttp = { status: number; json: unknown };
/** Zahteva HTTP (vbrizg v preizkusih). Privzeto: fetch brez preusmeritev, z rokom. */
export type ZahtevaHttp = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<OdgovorHttp>;
/** Zagon programa brez lupine; vrne izhodno kodo in stdout (stderr se zavrze). */
export type IzvediGh = (program: string, args: readonly string[], m: { cwd: string; env: NodeJS.ProcessEnv; rokMs: number }) => Promise<{ koda: number; izpis: string }>;

export type OdvisnostiGithub = {
  http?: ZahtevaHttp;
  najdiGh?: () => string | null;
  izvedi?: IzvediGh;
  zdaj?: () => number;
  /** Client id (preizkusi); privzeto GITHUB_CLIENT_ID. */
  clientId?: string;
};

const GOSTITELJI = new Set(["api.github.com", "github.com"]);

const privzetoHttp: ZahtevaHttp = async (url, init) => {
  const u = new URL(url);
  if (u.protocol !== "https:" || !GOSTITELJI.has(u.hostname)) throw new Error("Nedovoljen naslov.");
  const odgovor = await fetch(u, { ...init, redirect: "error", signal: AbortSignal.timeout(ROK_MS) });
  let json: unknown = null;
  try {
    json = await odgovor.json();
  } catch {
    json = null;
  }
  return { status: odgovor.status, json };
};

function izvedljiva(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Absolutna pot gh: PATH (samo absolutne mape), nato znana mesta (namescena Lina ima ozek PATH). */
export function najdiGh(dom = homedir(), okolje: NodeJS.ProcessEnv = process.env): string | null {
  const ime = `gh${koncnicaIzvedljive()}`;
  for (const m of (okolje.PATH ?? "").split(path.delimiter)) if (m && path.isAbsolute(m) && izvedljiva(path.join(m, ime))) return path.join(m, ime);
  for (const m of [path.join(dom, ".local", "bin"), "/usr/local/bin", "/usr/bin", "/snap/bin"]) if (izvedljiva(path.join(m, ime))) return path.join(m, ime);
  return null;
}

/** gh ne dobi skrivnosti Line; brez vprasanj, barv in obvestil o posodobitvi; GH_TOKEN/GITHUB_TOKEN okolja ne prevladata nad prijavo. */
export function okoljeZaGh(okolje: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    // Seznam DOVOLJENEGA (pregled 24. 11. 2026 B-4): kljuci ponudnikov (OPENAI_, ANTHROPIC_, XAI_ ...) in skrivnosti Line ne gredo v gh.
    // Zeton iz okolja ne: gh uporabi lastno prijavo ali kljuc, ki ga Lina poda sama.
    ...Object.fromEntries(
      Object.entries(okolje).filter(
        ([k, v]) =>
          typeof v === "string" &&
          !/^(GH|GITHUB)_(ENTERPRISE_)?TOKEN$/i.test(k) &&
          (/^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|TMPDIR|TZ|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|SSL_CERT_FILE|SSL_CERT_DIR)$/.test(k) ||
            /^(XDG|LC)_[A-Z_]+$/.test(k) ||
            /^(HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy)$/.test(k) ||
            /^(GH|GITHUB)_[A-Z_]+$/.test(k)),
      ),
    ),
    GH_PROMPT_DISABLED: "1",
    NO_COLOR: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
  };
}

const privzetoIzvedi: IzvediGh = (program, args, m) =>
  new Promise((razresi) => {
    execFile(program, [...args], { cwd: m.cwd, env: m.env, timeout: m.rokMs, maxBuffer: 4_000_000, shell: false, windowsHide: true }, (napaka, stdout) => {
      const koda = napaka ? (typeof (napaka as { code?: unknown }).code === "number" ? ((napaka as { code: number }).code) : 1) : 0;
      razresi({ koda, izpis: String(stdout ?? "") });
    });
  });

function odv(o: OdvisnostiGithub) {
  return {
    http: o.http ?? privzetoHttp,
    najdiGh: o.najdiGh ?? (() => najdiGh()),
    izvedi: o.izvedi ?? privzetoIzvedi,
    zdaj: o.zdaj ?? (() => Date.now()),
    clientId: o.clientId ?? GITHUB_CLIENT_ID,
  };
}

// --- shramba

async function preberiShranjeno(root: string): Promise<Shranjeno | null> {
  try {
    const f = await readJsonFile<Partial<Shranjeno>>(root, DATOTEKA_DOSTOPA);
    if (!f || !jeNacin(f.nacin) || !jeImeRacuna(f.racun)) return null;
    if (f.nacin !== "gh" && (!f.zeton || typeof f.zeton.ciphertext !== "string")) return null;
    return f as Shranjeno;
  } catch {
    return null;
  }
}

async function shrani(root: string, nacin: Nacin, racun: string, zeton?: string): Promise<void> {
  const zapis: Shranjeno = { nacin, racun };
  if (zeton !== undefined) zapis.zeton = await sifrirajSkrivnost(zeton, root, AAD);
  await writeJson(root, DATOTEKA_DOSTOPA, zapis);
}

/** Dostop za zahteve: zeton (oauth/kljuc) ali gh. Zeton ne zapusti tega modula. */
type Dostop = { nacin: "gh" } | { nacin: "oauth" | "kljuc"; zeton: string };
async function dostop(root: string): Promise<Dostop | null> {
  const s = await preberiShranjeno(root);
  if (!s) return null;
  if (s.nacin === "gh") return { nacin: "gh" };
  try {
    const zeton = await odsifrirajSkrivnost(s.zeton!, root, AAD);
    if (!zeton || !(s.nacin === "kljuc" ? jeOblikaKljuca(zeton) : jeOblikaZetonaOauth(zeton))) return null;
    return { nacin: s.nacin, zeton };
  } catch {
    return null;
  }
}

function glave(zeton: string): Record<string, string> {
  return {
    Authorization: `Bearer ${zeton}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Lina",
  };
}

// --- javni vhodi (lastnik)

export async function stanjeGithub(token: string | null, dir?: string, o: OdvisnostiGithub = {}): Promise<JavnoStanjeGithub> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const d = odv(o);
  const s = await preberiShranjeno(root);
  return { nacin: s?.nacin ?? null, racun: s?.racun ?? null, oauthNaVoljo: d.clientId !== "", ghNaVoljo: d.najdiGh() !== null };
}

/** Uporabnisko ime iz GET /user z danim zetonom; 401/403 = zavrnjen. */
async function racunZetona(d: ReturnType<typeof odv>, zeton: string): Promise<string> {
  let odg: OdgovorHttp;
  try {
    odg = await d.http(`${API}/user`, { method: "GET", headers: glave(zeton) });
  } catch {
    throw new Error(t("ghdNapPovezava"));
  }
  if (odg.status === 401 || odg.status === 403) throw new Error(t("ghdNapZavrnjen"));
  const racun = (odg.json as { login?: unknown } | null)?.login;
  if (odg.status !== 200 || !jeImeRacuna(racun)) throw new Error(t("ghdNapPovezava"));
  return racun;
}

/** Pot 3: kljuc, ki ga vpise uporabnik. Napacen ali zavrnjen kljuc se ne shrani; sporocilo napake nikoli ne vsebuje kljuca. */
export async function shraniKljucGithub(token: string | null, kljuc: unknown, dir?: string, o: OdvisnostiGithub = {}): Promise<JavnoStanjeGithub> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const k = typeof kljuc === "string" ? kljuc.trim() : "";
  if (!jeOblikaKljuca(k)) throw new Error(t("ghdNapOblika"));
  const racun = await racunZetona(odv(o), k);
  ustaviPrijavo(root);
  await shrani(root, "kljuc", racun, k);
  return stanjeGithub(token, root, o);
}

/** Pot 2: obstojeca prijava gh (izhodna koda `gh auth status`, nato `gh api user`). Zetona gh Lina ne bere. */
export async function uporabiGh(token: string | null, dir?: string, o: OdvisnostiGithub = {}): Promise<JavnoStanjeGithub> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const d = odv(o);
  const gh = d.najdiGh();
  if (!gh) throw new Error(t("ghdGhNi"));
  const m = { cwd: root, env: okoljeZaGh(), rokMs: ROK_GH_MS };
  const status = await d.izvedi(gh, ["auth", "status", "--hostname", "github.com"], m);
  if (status.koda !== 0) throw new Error(t("ghdGhNi"));
  const user = await d.izvedi(gh, ["api", "user", "--jq", ".login"], m);
  const racun = user.izpis.trim();
  if (user.koda !== 0 || !jeImeRacuna(racun)) throw new Error(t("ghdNapPovezava"));
  ustaviPrijavo(root);
  await shrani(root, "gh", racun);
  return stanjeGithub(token, root, o);
}

// Pot 1: OAuth device flow. device_code ostane na strezniku (v pomnilniku procesa, en tek na mapo podatkov).
type Prijava = { deviceCode: string; intervalSek: number; naslednja: number; potece: number };
const prijave = new Map<string, Prijava>();
function ustaviPrijavo(root: string): void {
  prijave.delete(root);
}

export type ZacetekPrijave = { koda: string; naslov: string; poteceSek: number; intervalSek: number };

export async function zacniPrijavoGithub(token: string | null, dir?: string, o: OdvisnostiGithub = {}): Promise<ZacetekPrijave> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const d = odv(o);
  if (!d.clientId) throw new Error(t("ghdNapOauthNi"));
  let odg: OdgovorHttp;
  try {
    odg = await d.http(NASLOV_KODE, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Lina" },
      body: new URLSearchParams({ client_id: d.clientId, scope: OBSEG_OAUTH }).toString(),
    });
  } catch {
    throw new Error(t("ghdNapPovezava"));
  }
  const k = odg.status === 200 ? razberiKodoNaprave(odg.json) : null;
  if (!k) throw new Error(t("ghdNapPovezava"));
  const zdaj = d.zdaj();
  prijave.set(root, { deviceCode: k.deviceCode, intervalSek: k.intervalSek, naslednja: zdaj + k.intervalSek * 1000, potece: zdaj + k.poteceSek * 1000 });
  return { koda: k.userCode, naslov: k.naslov, poteceSek: k.poteceSek, intervalSek: k.intervalSek };
}

export type IzidPrijave = { izid: "cakaj" | "povezano" | "poteklo" | "zavrnjeno" | "ni-prijave"; intervalSek?: number; stanje?: JavnoStanjeGithub };

/** Ena poizvedba (vmesnik klice na interval). Prezgodnja poizvedba ne gre na GitHub (slow_down). */
export async function preveriPrijavoGithub(token: string | null, dir?: string, o: OdvisnostiGithub = {}): Promise<IzidPrijave> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const d = odv(o);
  const p = prijave.get(root);
  if (!p) return { izid: "ni-prijave" };
  const zdaj = d.zdaj();
  if (zdaj >= p.potece) {
    ustaviPrijavo(root);
    return { izid: "poteklo" };
  }
  if (zdaj < p.naslednja) return { izid: "cakaj", intervalSek: p.intervalSek };
  p.naslednja = zdaj + p.intervalSek * 1000;
  let odg: OdgovorHttp;
  try {
    odg = await d.http(NASLOV_ZETONA, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Lina" },
      body: new URLSearchParams({ client_id: d.clientId, device_code: p.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }).toString(),
    });
  } catch {
    return { izid: "cakaj", intervalSek: p.intervalSek };
  }
  const izid = razberiZeton(odg.json, p.intervalSek);
  switch (izid.vrsta) {
    case "cakaj":
    case "napaka":
      return { izid: "cakaj", intervalSek: p.intervalSek };
    case "pocasneje":
      p.intervalSek = izid.intervalSek;
      p.naslednja = zdaj + p.intervalSek * 1000;
      return { izid: "cakaj", intervalSek: p.intervalSek };
    case "poteklo":
    case "zavrnjeno":
      ustaviPrijavo(root);
      return { izid: izid.vrsta };
    case "zeton": {
      ustaviPrijavo(root);
      const racun = await racunZetona(d, izid.zeton);
      await shrani(root, "oauth", racun, izid.zeton);
      return { izid: "povezano", stanje: await stanjeGithub(token, root, o) };
    }
  }
}

/** Odjava / pozabi kljuc: odstrani SAMO github-dostop.json (izbira tokov ostane; brez dostopa ni uporabna). gh se ne odjavi. */
export async function odjavaGithub(token: string | null, dir?: string, o: OdvisnostiGithub = {}): Promise<JavnoStanjeGithub> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  ustaviPrijavo(root);
  try {
    await unlink(path.join(root, DATOTEKA_DOSTOPA));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return stanjeGithub(token, root, o);
}

// --- enotna zahteva za druge module (gradnja)

export type InitGithub = { metoda?: "GET" | "POST"; telo?: { ref: string; inputs?: Record<string, string> } };

/**
 * Zahteva na api.github.com z dostopom, ki ga je izbral uporabnik (zeton ali `gh api`). Samo zahteve s seznama (metoda + pot) in samo
 * telo zagona toka. Pot je relativna (npr. `repos/o/r/actions/workflows/gradnja.yml/runs?branch=main`). Odgovor: stanje in JSON;
 * pri poti gh je stanje 200 ob izhodni kodi 0, sicer 0 (podrobnosti gh se ne posredujejo). Brez dostopa vrze. Zahteve lastnika ne
 * preverja (to naredi klicoci modul ob potrditvi), zetona nikoli ne vrne.
 */
export async function githubZahteva(pot: string, init: InitGithub = {}, dir?: string, o: OdvisnostiGithub = {}): Promise<OdgovorHttp> {
  const root = resolveDataDir(dir);
  const metoda = init.metoda ?? "GET";
  if (!jeDovoljenaZahteva(metoda, pot)) throw new Error(t("ghdNapPot"));
  if (metoda === "POST" ? !jeDovoljenoTelo(init.telo) : init.telo !== undefined) throw new Error(t("ghdNapPot"));
  const d = odv(o);
  const dos = await dostop(root);
  if (!dos) throw new Error(t("ghdNapNiPrijave"));
  if (dos.nacin === "gh") {
    const gh = d.najdiGh();
    if (!gh) throw new Error(t("ghdGhNi"));
    const args = ["api", "--method", metoda, "-H", "Accept: application/vnd.github+json", pot];
    // Samo -f (niz), nikoli -F (ta bere datoteke z @pot); kljuci in vrednosti so preverjeni (jeDovoljenoTelo).
    if (init.telo) {
      args.push("-f", `ref=${init.telo.ref}`);
      for (const [k, v] of Object.entries(init.telo.inputs ?? {})) args.push("-f", `inputs[${k}]=${v}`);
    }
    const r = await d.izvedi(gh, args, { cwd: root, env: okoljeZaGh(), rokMs: ROK_GH_MS });
    let json: unknown = null;
    try {
      json = r.izpis.trim() ? JSON.parse(r.izpis) : null;
    } catch {
      json = null;
    }
    return { status: r.koda === 0 ? 200 : 0, json };
  }
  try {
    return await d.http(`${API}/${pot}`, {
      method: metoda,
      headers: init.telo ? { ...glave(dos.zeton), "Content-Type": "application/json" } : glave(dos.zeton),
      ...(init.telo ? { body: JSON.stringify(init.telo) } : {}),
    });
  } catch {
    throw new Error(t("ghdNapPovezava"));
  }
}

// --- repozitoriji in tokovi

export type JavniRepozitorij = { repozitorij: string; zaseben: boolean };

/** Repozitoriji uporabnika (stran po stran po 100, najvec 300), samo veljavna imena. */
export async function seznamRepozitorijev(token: string | null, dir?: string, o: OdvisnostiGithub = {}): Promise<JavniRepozitorij[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const izid: JavniRepozitorij[] = [];
  for (let stran = 1; stran <= NAJVEC_REPOZITORIJEV / NA_STRAN; stran++) {
    const odg = await githubZahteva(`user/repos?per_page=${NA_STRAN}&page=${stran}&sort=updated`, {}, root, o);
    if (odg.status !== 200 || !Array.isArray(odg.json)) throw new Error(t("ghdNapPovezava"));
    for (const r of odg.json as Array<{ full_name?: unknown; private?: unknown }>) {
      if (izid.length >= NAJVEC_REPOZITORIJEV) break;
      if (jeRepozitorij(r?.full_name)) izid.push({ repozitorij: r.full_name, zaseben: r.private === true });
    }
    if (odg.json.length < NA_STRAN) break;
  }
  return izid;
}

/** Tokovi repozitorija z oznako, ali dovolijo rocni zagon (vsebina .yml, kljuc `on:` vsebuje workflow_dispatch). */
export async function tokoviRepozitorija(token: string | null, repozitorij: unknown, dir?: string, o: OdvisnostiGithub = {}): Promise<TokRepozitorija[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return tokovi(root, repozitorij, o);
}

async function tokovi(root: string, repozitorij: unknown, o: OdvisnostiGithub): Promise<TokRepozitorija[]> {
  if (!jeRepozitorij(repozitorij)) throw new Error(t("ghdNapRepo"));
  const odg = await githubZahteva(`repos/${repozitorij}/actions/workflows?per_page=100`, {}, root, o);
  const seznam = (odg.json as { workflows?: unknown } | null)?.workflows;
  if (odg.status !== 200 || !Array.isArray(seznam)) throw new Error(t("ghdNapPovezava"));
  const izid: TokRepozitorija[] = [];
  for (const w of seznam as Array<{ path?: unknown; name?: unknown; state?: unknown }>) {
    if (izid.length >= NAJVEC_TOKOV) break;
    const tok = datotekaIzPoti(w?.path);
    if (!tok || w.state !== "active") continue;
    const ime = typeof w.name === "string" ? w.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100) : tok;
    let rocniZagon = false;
    try {
      const v = await githubZahteva(`repos/${repozitorij}/contents/.github/workflows/${tok}`, {}, root, o);
      rocniZagon = v.status === 200 && imaRocniZagon(vsebinaDatoteke(v.json));
    } catch {
      rocniZagon = false;
    }
    izid.push({ tok, ime, rocniZagon });
  }
  return izid;
}

export async function preberiIzbiroGithub(token: string | null, dir?: string): Promise<IzbiraRepozitorija[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return preberiIzbiro(root);
}

async function preberiIzbiro(root: string): Promise<IzbiraRepozitorija[]> {
  try {
    return normalizirajIzbiro((await readJsonFile<{ repozitoriji?: unknown }>(root, DATOTEKA_IZBIRE))?.repozitoriji);
  } catch {
    return [];
  }
}

/**
 * Shrani izbiro. Vsak tok se preveri na GitHubu (obstaja, je aktiven in dovoli rocni zagon); kar ne ustreza, se izpusti. Prazna
 * izbira = Lina ne gradi nicesar.
 */
export async function shraniIzbiroGithub(token: string | null, izbira: unknown, dir?: string, o: OdvisnostiGithub = {}): Promise<IzbiraRepozitorija[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const preverjeno: IzbiraRepozitorija[] = [];
  for (const r of normalizirajIzbiro(izbira)) {
    const naGithubu = new Set((await tokovi(root, r.repozitorij, o)).filter((x) => x.rocniZagon).map((x) => x.tok));
    const ostanejo = r.tokovi.filter((x) => naGithubu.has(x.tok));
    if (ostanejo.length) preverjeno.push({ repozitorij: r.repozitorij, tokovi: ostanejo });
  }
  await writeJson(root, DATOTEKA_IZBIRE, { v: 1, repozitoriji: preverjeno });
  return preverjeno;
}

/** Za gradnjo: tokovi, ki jih je uporabnik dovolil (repozitorij, datoteka toka, vrsta izdelka). Brez izbire prazno. */
export async function dovoljeniTokovi(dir?: string): Promise<DovoljenTok[]> {
  return sploscenaIzbira(await preberiIzbiro(resolveDataDir(dir)));
}

/** Za gradnjo: ali je dostop nastavljen in na kateri nacin (brez zetona). */
export async function nacinDostopaGithub(dir?: string): Promise<{ nacin: Nacin; racun: string } | null> {
  const s = await preberiShranjeno(resolveDataDir(dir));
  return s ? { nacin: s.nacin, racun: s.racun } : null;
}
