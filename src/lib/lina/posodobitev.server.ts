/**
 * Vgrajena posodobitev Line na racunalniku (lastnik 23. 11. 2026: »Ne prenosnika to more biti del programa«). Samo Linux amd64,
 * paket .deb lina-lupina. Namestitev tece v LOCENEM procesu (skripta posodobi.sh, setsid), ker zapre Lino in s tem ta streznik.
 * Varovala: ime paketa, samo NOVEJSA razlicica (23. 11. 2026 je bil pomotoma namescen 0.2.5 cez 0.2.8), SHA-256 iz SHA256SUMS
 * (vir GitHub), vsoto preverjene datoteke preveri se skripta tik pred pkexec, ena posodobitev naenkrat.
 * Brskalnik ne da nobenega podatka: pot, razlicico in vir izracuna streznik sam.
 * 25. 11. 2026 (lastnik: »z programom lina kar klikneš posodobi«): enako za druge Safeer programe s SEZNAMA DOVOLJENIH (PAKETI),
 * samo ce so namesceni - Lina deluje tudi brez njih (pravilo lastnika 25. 11. 06:45). Safeer OS Lina po namestitvi ne poslje
 * nobenega signala: zamenjavo procesa naredi Safeer OS sam (nova_razlicica, koda 75); Lina jo samo opazuje (ps, samo branje).
 * Pregled 0213 A7 (25. 11. 2026): vsota iz iste izdaje ne scit pred ponarejeno izdajo, zato mora biti SHA256SUMS podpisan s
 * kljucem Safeer (JAVNI_KLJUC_IZDAJ); podpis se preveri PRED prenosom paketa in pred uporabo katerekoli vsote.
 */
import { execFile, spawn } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { jeLinuxAmd64 } from "./platforma.server.ts";
import { readJsonFile, resolveDataDir } from "./store.server.ts";
import { prenesiPreverjeno, vsotaEnaka } from "./tunel.server.ts";
import { zetonKoncaja } from "./zetoni-lupine.server.ts";

export const IME_PAKETA = "lina-lupina";
/** Seznam dovoljenih paketov in vir izdaj (javni repozitorij, sredstvo <paket>_<razlicica>_amd64.deb + SHA256SUMS). */
export const PAKETI = { "lina-lupina": "safeerOS/Lina", "safeer-os": "safeerOS/Safeer-linux" } as const;
export type ImePaketa = keyof typeof PAKETI;
/**
 * Javni kljuc izdaj Safeer (Ed25519, SPKI PEM), skupen za vse pakete s seznama. SHA-256 oblike DER:
 * a3ae3bcb5b6de559199ee5212bf04d9b25c9e45ea499b635f7869821971a0b56 (preizkus to preveri). Zasebni kljuc je samo v okolju GitHub
 * »podpis-izdaj« (skrivnost PODPIS_IZDAJ_KLJUC), podpisuje ga .github/workflows/podpis-izdaje.yml.
 * Oblika sredstva SHA256SUMS.sig: SUROV 64-bajtni podpis Ed25519 cez tocne bajte SHA256SUMS (izhod `openssl pkeyutl -sign
 * -rawin`), brez base64 in brez nove vrstice.
 */
export const JAVNI_KLJUC_IZDAJ = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAFcFUbdyiO8cO0+32opSFwKaIslAPdVK5rt5tYNiH328=\n-----END PUBLIC KEY-----\n";
export const IME_PODPISA = "SHA256SUMS.sig";
/** Own-key preverba: `in` bi sprejel tudi constructor, __proto__ ... */
export const jeDovoljenPaket = (p: unknown): p is ImePaketa => typeof p === "string" && Object.hasOwn(PAKETI, p);
/** Toliko casa ima Safeer OS, da sam zamenja proces z novo razlicico; nato Lina ponudi gumb (potrdi uporabnik). */
export const ROK_ZAMENJAVE_MS = 120_000;
export const SKRIPTA_POSODOBITVE = "/opt/Lina/resources/lina/posodobi.sh";
export const DATOTEKA_VIRA = "posodobitev.json";
export const DATOTEKA_IZIDA = "posodobitev-izid.json";
export const MAPA_PRENOSA = "posodobitev";
const NAJVEC_PAKETA = 400_000_000;
const ROK_PAKETA_MS = 30 * 60_000;
const NAJVEC_API = 1_000_000;
const PREDPOMNILNIK_MS = 10 * 60_000;
/** Stroga oblika razlicice (stevke in pike): poenostavi primerjavo v bashu in JSON izida ostane varen. */
const RAZLICICA = /^[0-9]{1,6}(\.[0-9]{1,6}){0,3}$/;
const imeDeb = (paket: ImePaketa) => new RegExp(`^${paket}_([0-9.]{1,30})_amd64\\.deb$`);
const datotekaIzida = (paket: ImePaketa) => (paket === IME_PAKETA ? DATOTEKA_IZIDA : `posodobitev-izid-${paket}.json`);
const NADZORNI = /[\u0000-\u001f\u007f-\u009f]/;

export type Vir = "github" | "mapa";
/** urlPodpisa samo, ce izdaja ima SHA256SUMS.sig (brez njega zagon vrne razlog »podpis«). */
/** opombe: besedilo izdaje (body) z GitHuba, NEZAUPANO in neobdelano; prikaze se samo po ocistiOpombe (posodobitev-samodejno). */
export type Kandidat = { razlicica: string; vir: Vir; ime: string; url?: string; urlVsot?: string; urlPodpisa?: string; pot?: string; opombe?: string };
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
export type RazlogZavrnitve = "neznan_paket" | "platforma" | "ni_skripte" | "ni_namescena" | "ze_tece" | "ni_vira" | "ni_novejsa" | "napacen_paket" | "vsota" | "podpis" | "prenos" | "pot";
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
  /** Samo za preizkuse (preizkusni kljuc); privzeto JAVNI_KLJUC_IZDAJ. */
  javniKljuc?: string;
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

/** Najnovejsi <paket>_*_amd64.deb v mapi; primerjava kot dpkg (0.2.10 > 0.2.9), ne abecedno. */
export function najnovejsiPaket(imena: readonly string[], paket: ImePaketa = IME_PAKETA): { ime: string; razlicica: string } | null {
  let naj: { ime: string; razlicica: string } | null = null;
  const vzorec = imeDeb(paket);
  for (const ime of imena) {
    const m = vzorec.exec(ime);
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

/** Ali je podpis surov 64-bajtni podpis Ed25519 kljuca `kljucPem` cez tocno te bajte. Nikoli ne vrze. */
export function podpisVeljaven(vsebina: Buffer, podpis: Buffer, kljucPem: string): boolean {
  if (podpis.length !== 64) return false;
  try {
    const kljuc = createPublicKey(kljucPem);
    return kljuc.asymmetricKeyType === "ed25519" && verify(null, vsebina, kljuc, podpis);
  } catch {
    return false;
  }
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
 * Zeton konca (naloga 9 V10) samo izrecno iz pomnilnika streznika (naloga 11 N2), nikoli iz podedovanega okolja.
 */
export function okoljeSkripte(env: NodeJS.ProcessEnv, koncaj?: string): Record<string, string> {
  const izid: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    if (/^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE)$/.test(k) || /^(XDG|LC)_[A-Z_]+$/.test(k)) izid[k] = v;
  }
  // LINA_KONCAJ_ZETON (naloga 9, V10): samo s tem zetonom skripta zapre Lino z »lina-lupina --koncaj«
  if (koncaj) izid.LINA_KONCAJ_ZETON = koncaj;
  izid.PATH = "/usr/bin:/bin";
  return izid;
}

function privzetoZazeni(program: string, argumenti: string[], env: Record<string, string>): Otrok {
  // detached = setsid: skripta prezivi zaprtje Line (in tega streznika).
  return spawn(program, argumenti, { detached: true, stdio: "ignore", env });
}

export function odv(o: Odvisnosti) {
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
    javniKljuc: o.javniKljuc ?? JAVNI_KLJUC_IZDAJ,
  };
}
export type Odv = ReturnType<typeof odv>;

export async function namescenaRazlicica(o: Odv, paket: ImePaketa = IME_PAKETA): Promise<string | null> {
  try {
    const v = (await o.izvedi("/usr/bin/dpkg-query", ["-W", "-f=${Version}", paket])).trim();
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

/** etag: zadnji ETag odgovora 200 (naloga 28): naslednja zahteva poslje If-None-Match, 304 obdrzi ta kandidat. */
const predpomnilnik = new Map<ImePaketa, { cas: number; kandidat: Kandidat | null; etag?: string }>();
export function ponastaviPredpomnilnik(): void {
  predpomnilnik.clear();
}

/** Vir A: zadnja izdaja javnega repozitorija. Naslove sredstev sestavimo sami (ne browser_download_url). */
export async function kandidatGithub(o: Odv, sveze = false, paket: ImePaketa = IME_PAKETA): Promise<Kandidat | null> {
  const shranjen = predpomnilnik.get(paket);
  if (!sveze && shranjen && o.zdaj() - shranjen.cas < PREDPOMNILNIK_MS) return shranjen.kandidat;
  const glave: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "Lina" };
  if (shranjen?.etag) glave["if-none-match"] = shranjen.etag;
  const odgovor = await o.fetchFn(`https://api.github.com/repos/${PAKETI[paket]}/releases/latest`, {
    redirect: "error",
    headers: glave,
    signal: AbortSignal.timeout(15_000),
  });
  if (odgovor.status === 304 && shranjen) {
    await odgovor.body?.cancel().catch(() => undefined);
    predpomnilnik.set(paket, { ...shranjen, cas: o.zdaj() });
    return shranjen.kandidat;
  }
  let kandidat: Kandidat | null = null;
  let etag: string | undefined;
  if (odgovor.status === 404) {
    await odgovor.body?.cancel().catch(() => undefined);
  } else {
    // 304 brez znane izdaje, 403/429 (omejitev GitHuba) in 5xx so napake: klicatelj (samodejna preverba) jih steje v odmik
    if (odgovor.status !== 200) {
      await odgovor.body?.cancel().catch(() => undefined);
      throw new Error("GitHub ni odgovoril.");
    }
    const besedilo = await odgovor.text();
    if (besedilo.length > NAJVEC_API) throw new Error("Odgovor je prevelik.");
    const e = odgovor.headers.get("etag");
    if (e && e.length <= 200 && !NADZORNI.test(e)) etag = e;
    const izdaja = JSON.parse(besedilo) as { tag_name?: unknown; body?: unknown; assets?: Array<{ name?: unknown }> };
    const oznaka = izdaja.tag_name;
    const imena = Array.isArray(izdaja.assets) ? izdaja.assets.map((a) => (typeof a?.name === "string" ? a.name : "")) : [];
    const deb = najnovejsiPaket(imena, paket);
    if (typeof oznaka === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(oznaka) && deb && imena.includes("SHA256SUMS")) {
      const osnova = `https://github.com/${PAKETI[paket]}/releases/download/${oznaka}/`;
      kandidat = { razlicica: deb.razlicica, vir: "github", ime: deb.ime, url: osnova + deb.ime, urlVsot: osnova + "SHA256SUMS" };
      if (imena.includes(IME_PODPISA)) kandidat.urlPodpisa = osnova + IME_PODPISA;
      if (typeof izdaja.body === "string") kandidat.opombe = izdaja.body.slice(0, NAJVEC_API);
    }
  }
  predpomnilnik.set(paket, { cas: o.zdaj(), kandidat, etag });
  return kandidat;
}

async function kandidatMapa(o: Odv, mapa: string, paket: ImePaketa = IME_PAKETA): Promise<Kandidat | null> {
  const deb = najnovejsiPaket(await o.beriMapo(mapa).catch(() => []), paket);
  return deb ? { razlicica: deb.razlicica, vir: "mapa", ime: deb.ime, pot: path.join(mapa, deb.ime) } : null;
}

/** Mapa iz posodobitev.json (razvojni racunalnik) velja za vse pakete s seznama: v njej se isce <paket>_*_amd64.deb. */
export async function kandidat(o: Odv, root: string, sveze: boolean, paket: ImePaketa = IME_PAKETA): Promise<Kandidat | null> {
  const mapa = await mapaVira(root);
  if (mapa === "neveljavno") return null;
  return mapa ? kandidatMapa(o, mapa, paket) : kandidatGithub(o, sveze, paket);
}

export async function zadnjiIzid(root: string, paket: ImePaketa = IME_PAKETA): Promise<IzidPosodobitve | null> {
  const i = await readJsonFile<Partial<IzidPosodobitve>>(root, datotekaIzida(paket)).catch(() => null);
  const kode: KodaIzida[] = ["namesceno", "preklicano", "napaka", "ni_novejsa", "napacen_paket", "vsota"];
  if (!i || typeof i.cas !== "string" || !veljavnaRazlicica(i.razlicica) || typeof i.ok !== "boolean" || !kode.includes(i.koda as KodaIzida)) return null;
  return { cas: i.cas.slice(0, 40), razlicica: i.razlicica, ok: i.ok, koda: i.koda as KodaIzida };
}

let tece = false;
/** Samo za preizkuse: zaklep je v pomnilniku procesa. */
export function posodobitevTece(): boolean {
  return tece;
}

export async function predpogoj(o: Odv, paket: ImePaketa = IME_PAKETA): Promise<RazlogNiNaVoljo | { namescena: string }> {
  if (!jeLinuxAmd64(o.platforma, o.arh)) return "platforma";
  if (!o.obstaja(o.skripta)) return "ni_skripte";
  const namescena = await namescenaRazlicica(o, paket);
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

/**
 * Prenese in preveri paket z GitHuba v <podatki>/posodobitev (0700); vrne pot in vsoto preverjene datoteke.
 * Vrstni red (A7): SHA256SUMS in SHA256SUMS.sig -> preverba podpisa -> sele nato prenos paketa in primerjava vsote.
 */
async function pripraviGithub(o: Odv, root: string, k: Kandidat): Promise<{ pot: string; vsota: string } | RazlogZavrnitve> {
  const mapa = path.join(root, MAPA_PRENOSA);
  await mkdir(mapa, { recursive: true, mode: 0o700 });
  await chmod(mapa, 0o700);
  const zacasnaDeb = path.join(mapa, `.prenos-${process.pid}.deb`);
  const zacasneVsote = path.join(mapa, `.vsote-${process.pid}.txt`);
  const zacasniPodpis = path.join(mapa, `.vsote-${process.pid}.sig`);
  if (!k.urlPodpisa) return "podpis";
  try {
    let vsote: Buffer;
    let podpis: Buffer;
    try {
      await o.prenesi(k.urlVsot!, zacasneVsote);
      await o.prenesi(k.urlPodpisa, zacasniPodpis);
      vsote = await readFile(zacasneVsote);
      podpis = await readFile(zacasniPodpis);
    } catch {
      return "prenos";
    }
    if (!podpisVeljaven(vsote, podpis, o.javniKljuc)) return "podpis";
    let vsota: string;
    try {
      vsota = await o.prenesi(k.url!, zacasnaDeb);
    } catch {
      return "prenos";
    }
    const pricakovana = vsotaIzSeznama(vsote.toString("utf8"), k.ime);
    if (!pricakovana || !vsotaEnaka(vsota, pricakovana)) return "vsota";
    const koncna = path.join(mapa, k.ime);
    await rename(zacasnaDeb, koncna);
    return { pot: koncna, vsota: pricakovana };
  } finally {
    await rm(zacasnaDeb, { force: true });
    await rm(zacasneVsote, { force: true });
    await rm(zacasniPodpis, { force: true });
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
export async function zacniPosodobitev(token: string | null, dir?: string, odvisnosti: Odvisnosti = {}, paket: string = IME_PAKETA): Promise<IzidZagona> {
  return zacni(token, dir, odvisnosti, null, paket);
}

/**
 * Gradnja na GitHubu (24. 11. 2026, gradnje-github.server.ts): isti potek in ista varovala (ime paketa, samo novejsa, vsota,
 * zaklep, skripta). Paket je TOCNO datoteka zadnje gradnje iz stanja streznika (brskalnik ne da poti) in njena vsota mora biti
 * enaka sha256, zapisani ob prenosu: datoteka, zamenjana ali dodana v vidni mapi po gradnji, se ne namesti.
 */
export async function zacniPosodobitevIzGradnje(token: string | null, deb: { pot: string; sha256: string }, dir?: string, odvisnosti: Odvisnosti = {}): Promise<IzidZagona> {
  return zacni(token, dir, odvisnosti, deb);
}

async function zacni(token: string | null, dir: string | undefined, odvisnosti: Odvisnosti, gradnja: { pot: string; sha256: string } | null, paket: string = IME_PAKETA): Promise<IzidZagona> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!jeDovoljenPaket(paket) || (gradnja !== null && paket !== IME_PAKETA)) return { ok: false, razlog: "neznan_paket" };
  if (gradnja !== null && (!varnaPot(gradnja.pot) || !/^[0-9a-f]{64}$/.test(gradnja.sha256))) return { ok: false, razlog: "pot" };
  // Zaklep sinhrono, pred prvim await po preverbi lastnika: dva hkratna klika ne zazeneta dveh namestitev.
  if (tece) return { ok: false, razlog: "ze_tece" };
  tece = true;
  let predano = false;
  try {
    const o = odv(odvisnosti);
    const p = await predpogoj(o, paket);
    if (typeof p === "string") return { ok: false, razlog: p };
    let k: Kandidat | null;
    try {
      k = gradnja !== null ? await kandidatMapa(o, path.dirname(path.resolve(gradnja.pot))) : await kandidat(o, root, true, paket);
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
      // gradnja: najnovejsi paket v mapi mora biti prav datoteka gradnje
      if (gradnja !== null && deb !== path.resolve(gradnja.pot)) return { ok: false, razlog: "vsota" };
      // A-15 in pregled 0213 A6 (vir »mapa«, tudi safeer-os): preveri in namesti se zasebna kopija, nikoli datoteka v vidni mapi
      const kopija = await kopirajGradnjo(root, deb);
      if (!kopija) return { ok: false, razlog: "prenos" };
      deb = kopija;
      vsota = await o.vsotaDatoteke(deb).catch(() => "");
      if (!/^[0-9a-f]{64}$/.test(vsota)) return { ok: false, razlog: "prenos" };
      if (gradnja !== null && !vsotaEnaka(vsota, gradnja.sha256)) return { ok: false, razlog: "vsota" };
    }
    if (!varnaPot(deb) || !varnaPot(root)) return { ok: false, razlog: "pot" };
    const podatki = await podatkiPaketa(o, deb);
    if (!podatki || podatki.paket !== paket || podatki.razlicica !== k.razlicica) return { ok: false, razlog: "napacen_paket" };
    if (primerjajRazlicici(podatki.razlicica, p.namescena) <= 0) return { ok: false, razlog: "ni_novejsa" };
    // 4. argument samo za druge pakete: skripta brez njega pomeni lina-lupina (enak klic kot pred 25. 11.)
    const argumenti = [o.skripta, deb, root, vsota, ...(paket === IME_PAKETA ? [] : [paket])];
    const otrok = o.zazeni("/bin/bash", argumenti, okoljeSkripte(o.env, zetonKoncaja()));
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

// --- Drugi Safeer programi (25. 11. 2026): samo namesceni, samo s seznama; Lina brez njih nima ne napake ne vrstic.
export type Zamenjava = "caka" | "zaznana" | "ni_zaznana" | "ne_tece";
export type StanjePaketa = {
  paket: ImePaketa;
  namescena: string;
  razpolozljiva: string | null;
  vir: Vir | null;
  novejsa: boolean;
  tece: boolean;
  napakaVira: boolean;
  zadnjiIzid: IzidPosodobitve | null;
  /** Samo safeer-os po uspesni namestitvi iz Line: ali je Safeer OS sam zamenjal proces z novo razlicico. */
  zamenjava: Zamenjava | null;
};

/**
 * Zacetki procesov safeer_os.py (ms od epohe) iz `ps -eo etimes=,args=`; zaganjalnik in varuh ne stejeta (zaganjalnik ohrani PID).
 * null = ps ni uspel (ne vemo, ali tece).
 */
async function zacetkiSafeerOs(o: Odv): Promise<number[] | null> {
  let izpis: string;
  try {
    izpis = await o.izvedi("/usr/bin/ps", ["-eo", "etimes=,args="]);
  } catch {
    return null;
  }
  const zacetki: number[] = [];
  for (const vrstica of izpis.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(vrstica);
    if (m && /(^|\s|\/)safeer_os\.py(\s|$)/.test(m[2]!)) zacetki.push(o.zdaj() - Number(m[1]) * 1000);
  }
  return zacetki;
}

async function zamenjavaSafeerOs(o: Odv, izid: IzidPosodobitve | null): Promise<Zamenjava | null> {
  const t = izid?.ok && izid.koda === "namesceno" ? Date.parse(izid.cas) : NaN;
  if (Number.isNaN(t)) return null;
  const zacetki = await zacetkiSafeerOs(o);
  // etimes je v sekundah: proces, zagnan v isti sekundi kot zapis izida, velja za novega
  if (zacetki?.some((z) => z >= t - 1000)) return "zaznana";
  if (zacetki?.length === 0) return "ne_tece";
  return o.zdaj() - t < ROK_ZAMENJAVE_MS ? "caka" : "ni_zaznana";
}

export async function stanjeDrugihPaketov(token: string | null, dir?: string, odvisnosti: Odvisnosti = {}): Promise<StanjePaketa[]> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const o = odv(odvisnosti);
  const izid: StanjePaketa[] = [];
  for (const paket of Object.keys(PAKETI) as ImePaketa[]) {
    if (paket === IME_PAKETA) continue;
    const p = await predpogoj(o, paket);
    if (typeof p === "string") continue;
    let k: Kandidat | null = null;
    let napakaVira = false;
    try {
      k = await kandidat(o, root, false, paket);
    } catch {
      napakaVira = true;
    }
    const zadnji = await zadnjiIzid(root, paket);
    izid.push({
      paket,
      namescena: p.namescena,
      razpolozljiva: k?.razlicica ?? null,
      vir: k?.vir ?? null,
      novejsa: Boolean(k && primerjajRazlicici(k.razlicica, p.namescena) > 0),
      tece,
      napakaVira,
      zadnjiIzid: zadnji,
      zamenjava: paket === "safeer-os" ? await zamenjavaSafeerOs(o, zadnji) : null,
    });
  }
  return izid;
}

/*
 * »Znova zazeni Safeer OS« je v vmesniku samo NAVODILO (25. 11. 2026): tekocega Safeer OS Lina nikoli ne ustavi (skil
 * safeer-os-ponovni-zagon-link: varuh bi ob signalu ugasnil namizje in Scit), safeerctl nima zahteve za ponovni zagon, nacin
 * zagona ob prijavi pa ni povsod enak (--delovna ni v samodejnem zagonu paketa) - zato varne poti za zagon iz Line ni.
 */
