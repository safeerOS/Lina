/**
 * Kontrola tiska (vid, lastnik 24. 11. 2026): fotografija + referenca (motiv ali odobren prvi kos) -> OK/NI OK, odmik X/Y v mm,
 * zasuk, merilo, dE00, oznacena slika in zapis v dnevnik kontrole (mapa po izbiri uporabnika).
 *
 * - Meritev: scripts/kontrola_tiska.py (OpenCV), zagnana brez lupine, z rokom in mejo izhoda; ena meritev naenkrat.
 * - Python in knjiznice: lastno okolje venv v podatkovni mapi Line (Linux in Windows), namestitev SAMO po izrecnem soglasju
 *   uporabnika (soglasje === true), samo kolesa iz PyPI v natancnih razlicicah (PAKETI_VIDA).
 * - Slike ostanejo lokalno. Model z vidom dobi oznaceno sliko samo, ko je opis vklopljen v nastavitvah IN uporabnik klikne
 *   »Opisi napake«; stevilke iz njegovega besedila se odstranijo.
 * Windows: poti in zaganjalnik »py -3« so v kodi, NEPREVERJENO na Windows (preizkusi tecejo na Linuxu).
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireOwner } from "./auth.server.ts";
import { jeWindows, platformaZdaj, type Platforma } from "./platforma.server.ts";
import {
  DATOTEKA_DNEVNIKA_CSV,
  DATOTEKA_DNEVNIKA_JSONL,
  GLAVA_CSV,
  MAPA_OKOLJA,
  NAJVEC_BAJTOV_SLIKE,
  PRIVZETE_NASTAVITVE,
  argumentiPip,
  argumentiVenv,
  cistNalog,
  klicOpisa,
  mereSlike,
  NAJVEC_TOCK_SLIKE,
  niMogoce,
  normirajNastavitve,
  odstraniStevilke,
  preveriIzid,
  pythonOkolja,
  sistemskiPython,
  sprejemljiveMere,
  vrsticaCsv,
  vrstaSlike,
  type IzidKontrole,
  type NastavitveKontrole,
  type ZapisDnevnika,
} from "./kontrola-tiska.ts";
import { narociloZaNalog, uvoziNarocilaLina } from "./narocila.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { preveriMapoZapiskov } from "./zapiski-mapa.server.ts";

export const DATOTEKA_NASTAVITEV = "kontrola-tiska.json";
export const PRIVZETA_MAPA_DNEVNIKA = "kontrola-tiska";
export const ROK_MERITVE_MS = 120_000;
export const ROK_NAMESTITVE_MS = 20 * 60_000;
const NAJVEC_IZHODA = 2 * 1024 * 1024;
const ID_KONTROLE = /^[0-9]{8}-[0-9]{6}-[a-f0-9]{6}$/;

// V paketu deb je skripta v resources/lina (kot rsdo-streznik.py); v razvoju v scripts/ projekta.
const SKRIPTA_PAKET = "/opt/Lina/resources/lina/kontrola_tiska.py";
const SKRIPTA_RAZVOJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "kontrola_tiska.py");

export type IzidZagona = { koda: number | null; stdout: string; stderr: string; casovnaMeja: boolean };
export type Zagon = (program: string, args: string[], opcije: { timeoutMs: number }) => Promise<IzidZagona>;

export type OdvisnostiKontrole = {
  zagon?: Zagon;
  /** Pot do Pythona z OpenCV; privzeto okolje v podatkovni mapi (ali LINA_KONTROLA_TISKA_PYTHON za razvoj in preizkuse). */
  python?: (root: string) => string;
  skripta?: string;
  platforma?: Platforma;
  zdaj?: () => Date;
  /** Klic modela z vidom (opis napak); privzeto ponudnik pogovora Line. */
  opis?: (slikaPng: Buffer, root: string) => Promise<{ ok: true; besedilo: string } | { ok: false; sporocilo: string }>;
};

let odv: OdvisnostiKontrole = {};
/** Samo za preizkuse. */
export function nastaviOdvisnostiKontrole(nove: OdvisnostiKontrole | null): void {
  odv = nove ?? {};
}

const platforma = () => odv.platforma ?? platformaZdaj();
const windows = () => jeWindows(platforma());

const zagonPrivzeto: Zagon = (program, args, { timeoutMs }) => {
  // Preizkusi nikoli ne namescajo in ne zaganjajo pravega pip-a (tudi ce kdo pozabi vbrizgati zagon).
  if (process.env.NODE_TEST_CONTEXT && args.includes("pip")) return Promise.resolve({ koda: 1, stdout: "", stderr: "preizkus", casovnaMeja: false });
  return new Promise((resolve) => {
    execFile(program, args, { timeout: timeoutMs, maxBuffer: NAJVEC_IZHODA, windowsHide: true, killSignal: "SIGKILL" }, (napaka, stdout, stderr) => {
      const n = napaka as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
      resolve({
        koda: n ? (typeof n.code === "number" ? n.code : null) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        casovnaMeja: Boolean(n?.killed),
      });
    });
  });
};

function pythonPrivzeto(root: string): string {
  const iz = process.env.LINA_KONTROLA_TISKA_PYTHON?.trim();
  if (iz && path.isAbsolute(iz)) return iz;
  return pythonOkolja(path.join(root, MAPA_OKOLJA), windows());
}

const skripta = () => odv.skripta ?? (existsSync(SKRIPTA_PAKET) ? SKRIPTA_PAKET : SKRIPTA_RAZVOJ);
const zagon: Zagon = (p, a, o) => (odv.zagon ?? zagonPrivzeto)(p, a, o);
const python = (root: string) => (odv.python ?? pythonPrivzeto)(root);

/** Zadnja vrstica stdout, ki je JSON objekt (knjiznice lahko pred njo kaj izpisejo). */
export function zadnjiJson(stdout: string): unknown {
  const vrstice = stdout.split("\n").map((v) => v.trim()).filter(Boolean);
  for (let i = vrstice.length - 1; i >= 0; i--) {
    if (!vrstice[i].startsWith("{")) continue;
    try {
      return JSON.parse(vrstice[i]);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- nastavitve

export async function preberiNastavitveKontrole(root: string): Promise<NastavitveKontrole> {
  const shranjeno = await readJsonFile<unknown>(root, DATOTEKA_NASTAVITEV).catch(() => null);
  const n = normirajNastavitve(shranjeno ?? {});
  return n.ok ? n.nastavitve : PRIVZETE_NASTAVITVE;
}

/** Mapa dnevnika: izbrana (preverjena kot mapa zapiskov: polna pot, ne sistemska, zapisljiva) ali privzeta v podatkih Line. */
async function mapaDnevnika(root: string, n: NastavitveKontrole): Promise<{ ok: true; mapa: string; opozorila: string[] } | { ok: false; razlog: string }> {
  const zelena = n.mapaDnevnika || path.join(root, PRIVZETA_MAPA_DNEVNIKA);
  const p = await preveriMapoZapiskov(zelena, root, { ustvari: true, platform: platforma() });
  return p.ok ? { ok: true, mapa: p.mapa, opozorila: p.opozorila } : { ok: false, razlog: p.razlog };
}

export async function shraniNastavitveKontrole(
  token: string | null,
  vnos: unknown,
  dir?: string,
): Promise<{ ok: true; nastavitve: NastavitveKontrole; opozorila: string[] } | { ok: false; napake: string[] }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const n = normirajNastavitve(vnos);
  if (!n.ok) return n;
  const m = await mapaDnevnika(root, n.nastavitve);
  if (!m.ok) return { ok: false, napake: ["mapaDnevnika", m.razlog] };
  const shrani = { ...n.nastavitve, mapaDnevnika: n.nastavitve.mapaDnevnika ? m.mapa : "" };
  await writeJson(root, DATOTEKA_NASTAVITEV, shrani);
  return { ok: true, nastavitve: shrani, opozorila: m.opozorila };
}

// ---------------------------------------------------------------- namestitev knjiznic (samo s soglasjem)

type StanjeNamestitve = { tece: boolean; napaka: string | null };
const namestitev: StanjeNamestitve = { tece: false, napaka: null };

/** Ali Python z OpenCV deluje (ukaz »preveri«). */
export async function knjizniceDelujejo(root: string): Promise<{ ok: boolean; razlicice?: Record<string, string> }> {
  // manjkajoc Python = napaka zagona (ENOENT) = koda null; ni posebne preverbe poti
  const z = await zagon(python(root), ["-B", "-I", skripta(), "preveri"], { timeoutMs: 60_000 });
  const j = zadnjiJson(z.stdout) as Record<string, unknown> | null;
  if (z.koda !== 0 || !j || j.ok !== true) return { ok: false };
  const razlicice: Record<string, string> = {};
  for (const k of ["opencv", "numpy", "skimage"]) if (typeof j[k] === "string") razlicice[k] = (j[k] as string).slice(0, 40);
  return { ok: true, razlicice };
}

/**
 * Namesti Python knjiznice za vid v okolje v podatkovni mapi Line. Brez soglasja === true ne naredi nicesar (tudi ne preveri
 * omrezja). Sistemski Python mora obstajati (Linux python3 z modulom venv, Windows zaganjalnik py); ce ga ni, vrne razlog.
 */
export async function namestiKnjizniceVida(token: string | null, soglasje: unknown, dir?: string): Promise<{ ok: boolean; razlog: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (soglasje !== true) return { ok: false, razlog: "brez-soglasja" };
  if (namestitev.tece) return { ok: false, razlog: "namestitev-ze-tece" };
  namestitev.tece = true;
  namestitev.napaka = null;
  try {
    const mapa = path.join(root, MAPA_OKOLJA);
    const py = pythonOkolja(mapa, windows());
    if (!existsSync(py)) {
      const sis = sistemskiPython(windows());
      const v = await zagon(sis.program, [...sis.args, ...argumentiVenv(mapa)], { timeoutMs: 120_000 });
      if (v.koda !== 0) return koncaj("python-ni-na-voljo");
    }
    const p = await zagon(py, argumentiPip(), { timeoutMs: ROK_NAMESTITVE_MS });
    if (p.koda !== 0) return koncaj(p.casovnaMeja ? "namestitev-predolga" : "pip-ni-uspel");
    if (!(await knjizniceDelujejo(root)).ok) return koncaj("knjiznice-ne-delujejo");
    return koncaj("");
  } finally {
    namestitev.tece = false;
  }
}
function koncaj(razlog: string): { ok: boolean; razlog: string } {
  namestitev.napaka = razlog || null;
  return { ok: !razlog, razlog };
}

// ---------------------------------------------------------------- meritev

let zasedeno = false;

export type VhodMeritve = {
  /** Fotografija tiska (base64, JPEG ali PNG). */
  fotografija: unknown;
  /** Referenca: PNG motiva s prosojnostjo ali fotografija odobrenega prvega kosa (base64). */
  referenca: unknown;
  vrstaReference: unknown;
  nalog?: unknown;
  imeReference?: unknown;
};

function izBase64(v: unknown): Buffer | null {
  if (typeof v !== "string" || v.length > Math.ceil((NAJVEC_BAJTOV_SLIKE * 4) / 3) + 8) return null;
  const b = Buffer.from(v.replace(/^data:[^,]{1,80},/, ""), "base64");
  // N1: mere iz glave pred zapisom in zagonom Pythona (slika-bomba: nekaj MB datoteke, vec GB ob dekodiranju)
  return b.length && b.length <= NAJVEC_BAJTOV_SLIKE && vrstaSlike(b) && sprejemljiveMere(b) ? b : null;
}

function novId(zdaj: Date): string {
  const d = (n: number, s = 2) => String(n).padStart(s, "0");
  // UTC kot polje cas (ISO); prikaz v lokalnem casu naredi vmesnik
  return `${zdaj.getUTCFullYear()}${d(zdaj.getUTCMonth() + 1)}${d(zdaj.getUTCDate())}-${d(zdaj.getUTCHours())}${d(zdaj.getUTCMinutes())}${d(zdaj.getUTCSeconds())}-${randomBytes(3).toString("hex")}`;
}

/**
 * Narocilo za nalog meritve: samo natancen zadetek stevilke naloga v lokalnem seznamu narocil. Ce naloga ni na seznamu in je lastnik
 * za shranjeno mapo izbral »Velja tudi za vse podobne« (narocila-uvoz), Lina mapo enkrat znova uvozi in poisce se enkrat. Napaka ali
 * brez zadetka = brez narocila (meritev in dnevnik tecejo naprej).
 */
async function narociloZaKontrolo(root: string, nalog: string): Promise<ZapisDnevnika["narocilo"]> {
  if (!nalog) return undefined;
  try {
    let n = await narociloZaNalog(nalog, root);
    if (!n && (await uvoziNarocilaLina(root)).stanje === "uvozeno") n = await narociloZaNalog(nalog, root);
    return n ? { stevilka: n.stevilka, stranka: n.stranka } : undefined;
  } catch {
    return undefined;
  }
}

export type RezultatMeritve = { id: string; izid: IzidKontrole; slika: string | null; mapaDnevnika: string | null; zapisano: boolean };

/**
 * Izmeri en kos in zapise v dnevnik. Vsak neuspeh (vhod, Python, rok, neveljaven JSON) je izid »NI MOGOCE IZMERITI«;
 * tudi ta gre v dnevnik, da kontrolor vidi, da kos ni bil ocenjen.
 */
export async function izmeriTisk(token: string | null, vhod: VhodMeritve, dir?: string): Promise<RezultatMeritve> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const zdaj = (odv.zdaj ?? (() => new Date()))();
  const id = novId(zdaj);
  const prazno = (izid: IzidKontrole): RezultatMeritve => ({ id, izid, slika: null, mapaDnevnika: null, zapisano: false });
  const foto = izBase64(vhod.fotografija);
  if (!foto) return prazno(niMogoce("fotografija-neveljavna", "Fotografija mora biti JPEG ali PNG do 30 MB in 60 milijonov točk."));
  const ref = izBase64(vhod.referenca);
  if (!ref) return prazno(niMogoce("referenca-neveljavna", "Referenca mora biti PNG motiva ali fotografija prvega kosa (JPEG/PNG) do 30 MB in 60 milijonov točk."));
  const vrsta = vhod.vrstaReference === "prvi-kos" ? "prvi-kos" : "motiv";
  if (zasedeno) return prazno(niMogoce("zasedeno", "Meritev že teče; poskusite čez nekaj sekund."));
  zasedeno = true;
  let zacasna: string | null = null;
  try {
    const nast = await preberiNastavitveKontrole(root);
    const m = await mapaDnevnika(root, nast);
    if (!m.ok) return prazno(niMogoce("mapa-dnevnika", m.razlog));
    // Zacasne datoteke v podatkovni mapi Line (ne v skupnem /tmp), mapa 0700; po meritvi jih pobrisemo (samo te, lastne).
    const tmpKoren = path.join(root, "kontrola-tiska-zacasno");
    await mkdir(tmpKoren, { recursive: true, mode: 0o700 });
    zacasna = await mkdtemp(path.join(tmpKoren, "m-"));
    const fp = path.join(zacasna, `foto.${vrstaSlike(foto)}`);
    const rp = path.join(zacasna, `ref.${vrstaSlike(ref)}`);
    const op = path.join(zacasna, "oznaceno.png");
    await writeFile(fp, foto, { mode: 0o600 });
    await writeFile(rp, ref, { mode: 0o600 });
    const z = await zagon(
      python(root),
      ["-B", "-I", skripta(), "izmeri", "--fotografija", fp, "--referenca", rp, "--vrsta", vrsta, "--nastavitve-json", JSON.stringify(nast.meritev), "--slika", op],
      { timeoutMs: ROK_MERITVE_MS },
    );
    let izid: IzidKontrole;
    if (z.casovnaMeja) izid = niMogoce("rok-meritve", "Meritev je trajala predolgo.");
    else if (z.koda !== 0) izid = niMogoce(/No module named|ModuleNotFoundError/.test(z.stderr) ? "knjiznice-manjkajo" : "python-napaka", "Meritev se ni izvedla.");
    else izid = preveriIzid(zadnjiJson(z.stdout));

    let slika: string | null = null;
    if (izid.ocena !== "NI MOGOCE IZMERITI" && (await stat(op).catch(() => null))?.isFile()) {
      slika = `${id}.png`;
      await copyFile(op, path.join(m.mapa, slika));
    }
    const nalog = cistNalog(vhod.nalog);
    const narocilo = await narociloZaKontrolo(root, nalog);
    const zapis: ZapisDnevnika = {
      id,
      cas: zdaj.toISOString(),
      nalog,
      referenca: cistNalog(vhod.imeReference),
      vrstaReference: vrsta,
      izid,
      slika: slika ?? "",
      ...(narocilo ? { narocilo } : {}),
    };
    const csv = path.join(m.mapa, DATOTEKA_DNEVNIKA_CSV);
    if (!existsSync(csv)) await writeFile(csv, `\ufeff${GLAVA_CSV}\n`, { flag: "wx", mode: 0o600 }).catch(() => undefined);
    await appendFile(csv, `${vrsticaCsv(zapis)}\n`, { mode: 0o600 });
    await appendFile(path.join(m.mapa, DATOTEKA_DNEVNIKA_JSONL), `${JSON.stringify(zapis)}\n`, { mode: 0o600 });
    return { id, izid, slika, mapaDnevnika: m.mapa, zapisano: true };
  } finally {
    zasedeno = false;
    if (zacasna) await rm(zacasna, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- dnevnik, oznacena slika, PDF oznak

function narociloIzZapisa(v: unknown): { narocilo: NonNullable<ZapisDnevnika["narocilo"]> } | null {
  if (!v || typeof v !== "object") return null;
  const n = v as Record<string, unknown>;
  if (typeof n.stevilka !== "string" || typeof n.stranka !== "string" || !n.stevilka) return null;
  return { narocilo: { stevilka: cistNalog(n.stevilka), stranka: n.stranka.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) } };
}

export async function zadnjeKontrole(token: string | null, najvec = 50, dir?: string): Promise<{ mapa: string | null; zapisi: ZapisDnevnika[] }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const m = await mapaDnevnika(root, await preberiNastavitveKontrole(root));
  if (!m.ok) return { mapa: null, zapisi: [] };
  const besedilo = await readFile(path.join(m.mapa, DATOTEKA_DNEVNIKA_JSONL), "utf8").catch(() => "");
  const zapisi: ZapisDnevnika[] = [];
  for (const v of besedilo.split("\n").filter(Boolean).slice(-Math.max(1, Math.min(500, najvec))).reverse()) {
    try {
      const z = JSON.parse(v) as Record<string, unknown>;
      if (typeof z.id !== "string" || !ID_KONTROLE.test(z.id)) continue;
      zapisi.push({
        id: z.id,
        cas: typeof z.cas === "string" ? z.cas.slice(0, 40) : "",
        nalog: cistNalog(z.nalog),
        referenca: cistNalog(z.referenca),
        vrstaReference: z.vrstaReference === "prvi-kos" ? "prvi-kos" : "motiv",
        izid: preveriIzid(z.izid),
        slika: typeof z.slika === "string" && z.slika === `${z.id}.png` ? z.slika : "",
        ...(narociloIzZapisa(z.narocilo) ?? {}),
      });
    } catch {
      // pokvarjena vrstica (npr. rocno urejanje) se preskoci, ostale ostanejo
    }
  }
  return { mapa: m.mapa, zapisi };
}

/** Oznacena slika kontrole (PNG, base64) - samo iz mape dnevnika in samo po veljavnem id (brez poti iz zahteve). */
export async function oznacenaSlika(token: string | null, id: unknown, dir?: string): Promise<string | null> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof id !== "string" || !ID_KONTROLE.test(id)) return null;
  const m = await mapaDnevnika(root, await preberiNastavitveKontrole(root));
  if (!m.ok) return null;
  const b = await readFile(path.join(m.mapa, `${id}.png`)).catch(() => null);
  return b && vrstaSlike(b) === "png" ? b.toString("base64") : null;
}

/** Natisljiva stran z oznakami ArUco iz nastavitev (PDF, base64). */
export async function oznakePdf(token: string | null, dir?: string): Promise<{ ok: true; pdf: string } | { ok: false; razlog: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const nast = await preberiNastavitveKontrole(root);
  const tmpKoren = path.join(root, "kontrola-tiska-zacasno");
  await mkdir(tmpKoren, { recursive: true, mode: 0o700 });
  const zacasna = await mkdtemp(path.join(tmpKoren, "p-"));
  try {
    const izhod = path.join(zacasna, "oznake.pdf");
    const z = await zagon(python(root), ["-B", "-I", skripta(), "oznake-pdf", "--izhod", izhod, "--nastavitve-json", JSON.stringify(nast.meritev)], { timeoutMs: 60_000 });
    const j = zadnjiJson(z.stdout) as { ok?: unknown; napaka?: unknown } | null;
    if (z.koda !== 0 || !j || j.ok !== true) return { ok: false, razlog: typeof j?.napaka === "string" ? j.napaka.slice(0, 60) : "knjiznice-manjkajo" };
    const b = await readFile(izhod);
    if (b.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, razlog: "pdf-neveljaven" };
    return { ok: true, pdf: b.toString("base64") };
  } finally {
    await rm(zacasna, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Opis napak z modelom z vidom: SAMO ce je vklopljen v nastavitvah in uporabnik klikne (ta klic). Gre samo oznacena slika te
 * kontrole; stevilke iz odgovora se odstranijo. Brezplacni modeli (lahko ucijo na vsebini) slike ne dobijo.
 */
export async function opisiNapake(token: string | null, id: unknown, dir?: string): Promise<{ ok: true; besedilo: string } | { ok: false; razlog: string }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const nast = await preberiNastavitveKontrole(root);
  if (!nast.opisZModelom) return { ok: false, razlog: "opis-izklopljen" };
  const b64 = await oznacenaSlika(token, id, root);
  if (!b64) return { ok: false, razlog: "slike-ni" };
  const izid = await (odv.opis ?? opisPrivzeto)(Buffer.from(b64, "base64"), root);
  return izid.ok ? { ok: true, besedilo: odstraniStevilke(izid.besedilo) } : { ok: false, razlog: izid.sporocilo.slice(0, 300) };
}

async function opisPrivzeto(slika: Buffer, root: string): Promise<{ ok: true; besedilo: string } | { ok: false; sporocilo: string }> {
  const { pogovorBrain } = await import("./keys.server.ts");
  const { callProvider } = await import("./providers.ts");
  const brain = await pogovorBrain(root);
  if (!brain) return { ok: false, sporocilo: "Ponudnik modela ni nastavljen." };
  // N5 (B9): brez OmniRoute, brez samodejne zamenjave modela, brez brezplacnih modelov (klicOpisa)
  const klic = klicOpisa(brain, slika);
  if (!klic) return { ok: false, sporocilo: "Opis tiska prek OmniRoute ni dovoljen (slika bi lahko šla neznanemu ponudniku). Izberite ponudnika neposredno." };
  const r = await callProvider(klic as Parameters<typeof callProvider>[0]);
  return r.ok ? { ok: true, besedilo: r.text } : { ok: false, sporocilo: r.sporocilo };
}

export async function stanjeKontrole(token: string | null, dir?: string) {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const nastavitve = await preberiNastavitveKontrole(root);
  const knj = await knjizniceDelujejo(root);
  const m = await mapaDnevnika(root, nastavitve);
  return {
    knjiznice: knj.ok,
    razlicice: knj.razlicice ?? {},
    namestitev: { ...namestitev },
    nastavitve,
    mapaDnevnika: m.ok ? m.mapa : null,
    opozorilaMape: m.ok ? m.opozorila : [m.razlog],
    platforma: platforma(),
  };
}

// ---------------------------------------------------------------- fotografije s telefona (podpisan vhod asistent-streznik)

export const MAPA_PREJETIH = path.join("kontrola-tiska", "prejeto");
export const NAJVEC_PREJETIH = 100;
const ID_PREJETE = /^[0-9]{8}-[0-9]{6}-[a-f0-9]{6}\.(jpg|png)$/;

/** Shrani fotografijo s telefona v mapo prejetih (0600); nic ne izmeri. Najvec NAJVEC_PREJETIH datotek (nato »polno«). */
export async function shraniPrejetoSliko(root: string, b: Buffer): Promise<{ ok: true; id: string } | { ok: false; razlog: "vrsta" | "polno" | "prevelika" }> {
  const vrsta = vrstaSlike(b);
  if (!vrsta || b.length > NAJVEC_BAJTOV_SLIKE) return { ok: false, razlog: "vrsta" };
  // N1: shranjevanje ne dekodira; zavrne se znana mera nad mejo (meritev nato zahteva berljive mere, izBase64)
  const mere = mereSlike(b);
  if (mere && mere.sirina * mere.visina > NAJVEC_TOCK_SLIKE) return { ok: false, razlog: "prevelika" };
  const mapa = path.join(root, MAPA_PREJETIH);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  if ((await readdir(mapa)).filter((i) => ID_PREJETE.test(i)).length >= NAJVEC_PREJETIH) return { ok: false, razlog: "polno" };
  const id = `${novId((odv.zdaj ?? (() => new Date()))())}.${vrsta}`;
  await writeFile(path.join(mapa, id), b, { flag: "wx", mode: 0o600 });
  return { ok: true, id };
}

export async function prejeteSlike(token: string | null, dir?: string): Promise<string[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const vse = await readdir(path.join(root, MAPA_PREJETIH)).catch(() => [] as string[]);
  return vse.filter((i) => ID_PREJETE.test(i)).sort().reverse().slice(0, NAJVEC_PREJETIH);
}

/** Prejeta fotografija (base64) samo po veljavnem imenu iz mape prejetih (brez poti iz zahteve). */
export async function prejetaSlika(token: string | null, id: unknown, dir?: string): Promise<string | null> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (typeof id !== "string" || !ID_PREJETE.test(id)) return null;
  const b = await readFile(path.join(root, MAPA_PREJETIH, id)).catch(() => null);
  return b && vrstaSlike(b) ? b.toString("base64") : null;
}

/**
 * N8: lastnik izprazni mapo prejetih s telefona (po polni mapi pot vraca 507). Brisanje se vedno vprasa: samo z izrecno
 * potrditvijo (potrditev === true, drugi korak v vmesniku) in samo lastna imena prejetih slik (ID_PREJETE), nic drugega v mapi.
 */
export async function pocistiPrejete(
  token: string | null,
  potrditev: unknown,
  dir?: string,
): Promise<{ ok: true; izbrisano: number } | { ok: false; razlog: "brez-potrditve" }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (potrditev !== true) return { ok: false, razlog: "brez-potrditve" };
  const mapa = path.join(root, MAPA_PREJETIH);
  let izbrisano = 0;
  for (const ime of await readdir(mapa).catch(() => [] as string[])) {
    if (!ID_PREJETE.test(ime)) continue;
    if (await unlink(path.join(mapa, ime)).then(() => true, () => false)) izbrisano++;
  }
  return { ok: true, izbrisano };
}
