/**
 * Samodejna priprava n8n lastnika ob prvem vklopu (uradna pot lokalnega n8n: /rest/settings -> /rest/owner/setup ali /rest/login
 * -> /rest/api-keys). Geslo lokalnega racuna in API kljuc sta SIFRIRANA v n8n-racun.json (0600, AES-256-GCM z glavnim kljucem Line)
 * in se NIKOLI ne izpiseta ali vrneta odjemalcu.
 *
 * Locen modul brez uvozov asistentke/kanala, da ga lahko varno poklice pravila.server.ts ob vklopu dodatka (preizkus 4.4).
 */
import { imaPosixDovoljenja } from "./platforma.server.ts";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { N8N_PRIVZETI_NASLOV, jeLokalniN8nNaslov, type RazlogN8n } from "./n8n.ts";
import { resolveDataDir } from "./store.server.ts";

export const DATOTEKA_RACUNA_N8N = "n8n-racun.json";
const AAD_KLJUC = "n8n-api-kljuc";
const AAD_GESLO = "n8n-lastnik-geslo";
const PRIVZETI_EMAIL = "lastnik@lina.local";
const ROK_HTTP_MS = 8_000;

type Sifra = { iv: string; tag: string; ciphertext: string };
type RacunN8nDatoteka = {
  v: 1;
  email: string;
  geslo?: Sifra;
  apiKljuc?: Sifra;
  pripravljenOb?: string;
};

export type OdvisnostiPripraveN8n = {
  naslov?: string;
  fetchFn?: typeof fetch;
  zdaj?: () => Date;
  premorMs?: number;
  najvecPoskusov?: number;
};

export type IzidPripraveN8n = {
  ok: boolean;
  zePripravljen: boolean;
  razlog?: RazlogN8n;
};

const vrste = new Map<string, Promise<unknown>>();
function vVrsti<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const prej = vrste.get(root) ?? Promise.resolve();
  const zdaj = prej.then(delo, delo);
  const rep = zdaj.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return zdaj;
}

async function preberiRacun(root: string): Promise<RacunN8nDatoteka | null> {
  try {
    const v = JSON.parse(await readFile(path.join(root, DATOTEKA_RACUNA_N8N), "utf8")) as Partial<RacunN8nDatoteka>;
    if (!v || typeof v !== "object" || v.v !== 1 || typeof v.email !== "string") return null;
    return { v: 1, email: v.email, geslo: v.geslo, apiKljuc: v.apiKljuc, pripravljenOb: v.pripravljenOb };
  } catch {
    return null;
  }
}

async function zapisiRacun(root: string, r: RacunN8nDatoteka): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const cilj = path.join(root, DATOTEKA_RACUNA_N8N);
  const zacasna = `${cilj}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(zacasna, JSON.stringify(r, null, 2), { mode: 0o600, flag: "wx" });
  await rename(zacasna, cilj);
  if (imaPosixDovoljenja()) await chmod(cilj, 0o600).catch(() => undefined);
}

/** Samo notranje (streznik): odsifrira shranjeni API kljuc n8n. Nikoli ga ne izpisi ali poslji odjemalcu. */
export async function preberiKljucN8n(dir?: string): Promise<string | null> {
  const root = resolveDataDir(dir);
  const r = await preberiRacun(root);
  if (!r?.apiKljuc) return null;
  const k = await odsifrirajSkrivnost(r.apiKljuc, root, AAD_KLJUC);
  return k && k.trim() ? k.trim() : null;
}

/** Ali ima Lina shranjen in veljavno odsifrirabil API kljuc za n8n (kljuca ne vrne). */
export async function imaKljucN8n(dir?: string): Promise<boolean> {
  return (await preberiKljucN8n(dir)) !== null;
}

function izluciPiskotek(res: Response): string | null {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const seznam = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  const viri = seznam.length ? seznam : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
  const deli: string[] = [];
  for (const v of viri) {
    const par = v.split(";")[0]?.trim();
    if (par && par.includes("=")) deli.push(par);
  }
  return deli.length ? deli.join("; ") : null;
}

function mocanoGeslo(): string {
  // n8n zahteva vsaj 8 znakov, veliko crko in stevko; 28+ znakov visoke entropije
  return `Ln9A!${randomBytes(18).toString("base64url")}`;
}

async function httpJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; telo: Record<string, unknown>; res: Response } | null> {
  try {
    const res = await fetchFn(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(ROK_HTTP_MS) });
    let telo: Record<string, unknown> = {};
    try {
      const j = (await res.json()) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) telo = j as Record<string, unknown>;
    } catch {
      // prazen ali ne-JSON odgovor
    }
    return { ok: res.ok, status: res.status, telo, res };
  } catch {
    return null;
  }
}

async function prijavaN8n(fetchFn: typeof fetch, naslov: string, email: string, password: string): Promise<string | null> {
  const r = await httpJson(fetchFn, `${naslov}/rest/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: email, password }),
  });
  if (!r || !r.ok) return null;
  return izluciPiskotek(r.res);
}

async function ustvariApiKljucN8n(fetchFn: typeof fetch, naslov: string, cookie: string): Promise<string | null> {
  const osnovno = {
    label: "Lina",
    scopes: ["workflow:list", "workflow:read", "workflow:create", "workflow:update", "execution:list", "execution:read"],
    expiresAt: null,
  };
  let r = await httpJson(fetchFn, `${naslov}/rest/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", cookie },
    body: JSON.stringify(osnovno),
  });
  // Starejse razlicice n8n brez podpore scopes: poskusi samo z label
  if (r && r.status === 400) {
    r = await httpJson(fetchFn, `${naslov}/rest/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", cookie },
      body: JSON.stringify({ label: "Lina", expiresAt: null }),
    });
  }
  if (!r || !r.ok) return null;
  const data = (r.telo.data && typeof r.telo.data === "object" ? r.telo.data : r.telo) as Record<string, unknown>;
  const raw = typeof data.rawApiKey === "string" ? data.rawApiKey.trim() : typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  return raw.length >= 8 ? raw : null;
}

/**
 * Pripravi lokalni racun lastnika in API kljuc v n8n (idempotentno).
 * Ce veljaven kljuc ze obstaja, ne ustvari novega racuna niti novega kljuca.
 */
export function pripraviRacunN8n(dir?: string, odv: OdvisnostiPripraveN8n = {}): Promise<IzidPripraveN8n> {
  const root = resolveDataDir(dir);
  return vVrsti(root, async () => {
    const naslov = jeLokalniN8nNaslov(odv.naslov ?? N8N_PRIVZETI_NASLOV);
    if (!naslov) return { ok: false, zePripravljen: false, razlog: "neveljaven-naslov" };
    const fetchFn = odv.fetchFn ?? fetch;
    const zdaj = odv.zdaj ?? (() => new Date());

    // 1. Ce imamo shranjen kljuc, preveri, ali deluje
    const obstojecKljuc = await preberiKljucN8n(root);
    if (obstojecKljuc) {
      const preizkus = await httpJson(fetchFn, `${naslov}/api/v1/workflows?limit=1`, {
        method: "GET",
        headers: { accept: "application/json", "x-n8n-api-key": obstojecKljuc },
      });
      if (!preizkus) return { ok: false, zePripravljen: false, razlog: "ni-povezave" };
      if (preizkus.ok) return { ok: true, zePripravljen: true };
      // 401/403 -> kljuc ne velja vec, poskusi ponovno prijavo s shranjenim geslom spodaj
    }

    // 2. Preveri stanje n8n (/rest/settings)
    const nast = await httpJson(fetchFn, `${naslov}/rest/settings`, { method: "GET", headers: { accept: "application/json" } });
    if (!nast) return { ok: false, zePripravljen: false, razlog: "ni-povezave" };
    const data = (nast.telo.data && typeof nast.telo.data === "object" ? nast.telo.data : nast.telo) as Record<string, unknown>;
    const um = (data.userManagement && typeof data.userManagement === "object" ? data.userManagement : {}) as Record<string, unknown>;
    const potrebujeSetup = um.showSetupOnFirstLoad === true;

    let shranjen = await preberiRacun(root);
    let cookie: string | null = null;

    if (potrebujeSetup) {
      const email = shranjen?.email || PRIVZETI_EMAIL;
      const password = mocanoGeslo();
      const setup = await httpJson(fetchFn, `${naslov}/rest/owner/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email, firstName: "Lina", lastName: "Lastnik", password }),
      });
      if (!setup) return { ok: false, zePripravljen: false, razlog: "ni-povezave" };
      if (!setup.ok) return { ok: false, zePripravljen: false, razlog: "ni-kljuca" };
      const sifGeslo = await sifrirajSkrivnost(password, root, AAD_GESLO);
      shranjen = { v: 1, email, geslo: sifGeslo };
      await zapisiRacun(root, shranjen);
      cookie = izluciPiskotek(setup.res) ?? (await prijavaN8n(fetchFn, naslov, email, password));
    } else {
      const geslo = shranjen?.geslo ? await odsifrirajSkrivnost(shranjen.geslo, root, AAD_GESLO) : null;
      if (!shranjen || !geslo) return { ok: false, zePripravljen: false, razlog: "ze-nastavljen" };
      cookie = await prijavaN8n(fetchFn, naslov, shranjen.email, geslo);
    }

    if (!cookie) return { ok: false, zePripravljen: false, razlog: "ni-kljuca" };
    const rawKey = await ustvariApiKljucN8n(fetchFn, naslov, cookie);
    if (!rawKey) return { ok: false, zePripravljen: false, razlog: "ni-kljuca" };

    const sifKljuc = await sifrirajSkrivnost(rawKey, root, AAD_KLJUC);
    await zapisiRacun(root, {
      v: 1,
      email: shranjen?.email || PRIVZETI_EMAIL,
      ...(shranjen?.geslo ? { geslo: shranjen.geslo } : {}),
      apiKljuc: sifKljuc,
      pripravljenOb: zdaj().toISOString(),
    });
    return { ok: true, zePripravljen: false };
  });
}

const vPripraviOzadja = new Map<string, Promise<IzidPripraveN8n>>();

/**
 * Ob prvem vklopu dodatka n8n: v ozadju pocaka, da se vsebnik odzove na 127.0.0.1:5678, nato ustvari racun in API kljuc.
 * Ponovni klici med tekom delijo isto obljubo.
 */
export function pripraviN8nVOzadju(dir?: string, odv: OdvisnostiPripraveN8n = {}): Promise<IzidPripraveN8n> {
  const root = resolveDataDir(dir);
  const tekoca = vPripraviOzadja.get(root);
  if (tekoca) return tekoca;
  const premorMs = odv.premorMs ?? 1500;
  const najvecPoskusov = odv.najvecPoskusov ?? 20;
  const p = (async (): Promise<IzidPripraveN8n> => {
    let zadnji: IzidPripraveN8n = { ok: false, zePripravljen: false, razlog: "ni-povezave" };
    for (let i = 0; i < najvecPoskusov; i++) {
      zadnji = await pripraviRacunN8n(root, odv);
      if (zadnji.ok || zadnji.razlog !== "ni-povezave") return zadnji;
      if (i + 1 < najvecPoskusov) await new Promise((r) => setTimeout(r, premorMs));
    }
    return zadnji;
  })().finally(() => {
    if (vPripraviOzadja.get(root) === p) vPripraviOzadja.delete(root);
  });
  vPripraviOzadja.set(root, p);
  return p;
}
