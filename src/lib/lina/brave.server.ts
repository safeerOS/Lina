import { rm } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { odsifrirajSkrivnost, sifrirajSkrivnost } from "./keys.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Brave Search kot rezerva za iskanje asistentke, ko TinyFish ni na voljo (lastnik 13. 11. 2026: »Ce TinyFish ni na voljo,
 * kot rezervo uporabi Brave«; paket je aktiviral isti dan, z bancno kartico). Vsak uporabnik s SVOJIM kljucem; kljuc je
 * sifriran na disku in gre samo na https api.search.brave.com brez preusmeritev. Uporabimo LLM Context (izvlecki strani za
 * model). Po dokumentaciji (api-dashboard.search.brave.com/documentation/services/llm-context, 13. 11. 2026):
 * GET /res/v1/llm/context, glava X-Subscription-Token, q 1-600 znakov in najvec 75 besed, odgovor grounding.generic[]
 * { url, title, snippets[] }. Rezultatov ne shranjujemo (pogoji: shranjevanje samo z narocilom po meri).
 * Kartica je vpisana: brezplacnih je $5 na mesec (~1.000 zahtev po $5/1.000), zato Lina sama steje zahteve v mesecu in se
 * ustavi pri meji. Privzeto MESECNA_MEJA (ostane v brezplacnem delu); uporabnik jo spremeni sam (lastnik 13. 11. 2026:
 * »naj bo privzeto tako, a uporabnik lahko spremeni glede na svoje potrebe«), 0 = Brave izklopljen. Podpora za country=SI / search_lang=sl ni
 * zapisana: ce jo API zavrne (400/422), ponovimo brez njiju (to je druga zahteva in se steje). NEPREVERJENO s pravim kljucem.
 */
const DATOTEKA = "brave.json";
const PORABA = "brave-poraba.json";
const NASTAVITVE = "brave-nastavitve.json";
const GOSTITELJ = "api.search.brave.com";
const ROK_MS = 20_000;
/** Toliko besedila izvleckov najvec damo modelu (priblizno 8.000 zetonov, privzeta meja Brave). */
export const MEJA_ZNAKOV = 32_000;
export const NAJVEC_ZNAKOV_VPRASANJA = 600;
export const NAJVEC_BESED_VPRASANJA = 75;
/** Zahtev na koledarski mesec: pod ~1.000, ki jih pokrije brezplacnih $5 (rezerva za ponovitve in preverbo kljuca). */
export const MESECNA_MEJA = 900;
/** Najvec, kar sme uporabnik nastaviti (zascita pred tipkarsko napako, npr. dodatne nicle). */
export const NAJVECJA_MEJA = 1_000_000;

type Shranjeno = { iv: string; tag: string; ciphertext: string };
type Poraba = { mesec: string; zahtev: number };
type Nastavitve = { mesecnaMeja: number };
export type StanjeBrave = { povezan: boolean; porabljenoVMesecu: number; meja: number };
export type Vir = { url: string; naslov: string; izvlecki: string[] };
export type ZahtevaBrave = (url: string, glave: Record<string, string>) => Promise<{ status: number; json: unknown }>;

export const zahtevaBrave: ZahtevaBrave = async (url, glave) => {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== GOSTITELJ) throw new Error("Nedovoljen naslov.");
  const odgovor = await fetch(u, { method: "GET", headers: glave, redirect: "error", signal: AbortSignal.timeout(ROK_MS) });
  let json: unknown = null;
  try {
    json = await odgovor.json();
  } catch {
    json = null;
  }
  return { status: odgovor.status, json };
};

export function jeVeljavenKljuc(kljuc: string): boolean {
  return kljuc.length >= 16 && kljuc.length <= 200 && /^[\x21-\x7e]+$/.test(kljuc);
}

function glave(kljuc: string): Record<string, string> {
  return { "X-Subscription-Token": kljuc, Accept: "application/json" };
}

async function preberiKljuc(root: string): Promise<string | null> {
  const f = await readJsonFile<Shranjeno>(root, DATOTEKA);
  if (!f?.ciphertext) return null;
  return odsifrirajSkrivnost(f, root);
}

function tekociMesec(zdaj: Date): string {
  return zdaj.toISOString().slice(0, 7);
}

export function jeVeljavnaMeja(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= NAJVECJA_MEJA;
}

async function meja(root: string): Promise<number> {
  const n = (await readJsonFile<Nastavitve>(root, NASTAVITVE))?.mesecnaMeja;
  return jeVeljavnaMeja(n) ? n : MESECNA_MEJA;
}

async function porabljeno(root: string, zdaj: Date): Promise<number> {
  const p = await readJsonFile<Poraba>(root, PORABA);
  return p && p.mesec === tekociMesec(zdaj) && Number.isInteger(p.zahtev) && p.zahtev >= 0 ? p.zahtev : 0;
}

/** Zabelezi eno zahtevo; vrne false (in ne belezi), ce bi presegla mesecno mejo. */
async function rezervirajZahtevo(root: string, zdaj: Date): Promise<boolean> {
  const n = await porabljeno(root, zdaj);
  if (n >= (await meja(root))) return false;
  await writeJson(root, PORABA, { mesec: tekociMesec(zdaj), zahtev: n + 1 } satisfies Poraba);
  return true;
}

/** Vprasanje za Brave: brez kontrolnih znakov, najvec 600 znakov in 75 besed; prazno = null. */
export function pripraviVprasanje(vprasanje: string): string | null {
  const besede = vprasanje.replace(/[\u0000-\u001f\u007f]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!besede.length) return null;
  let q = besede.slice(0, NAJVEC_BESED_VPRASANJA).join(" ");
  if (q.length > NAJVEC_ZNAKOV_VPRASANJA) q = q.slice(0, NAJVEC_ZNAKOV_VPRASANJA).replace(/\s+\S*$/, "");
  return q || null;
}

function naslovLlmContext(q: string, slovensko: boolean): string {
  const p = new URLSearchParams({ q, maximum_number_of_tokens: "8192" });
  if (slovensko) {
    p.set("country", "SI");
    p.set("search_lang", "sl");
  }
  return `https://${GOSTITELJ}/res/v1/llm/context?${p.toString()}`;
}

/** Viri iz odgovora LLM Context; neveljavne vnose izpusti, skupno besedilo omeji na MEJA_ZNAKOV. */
export function razcleniViri(json: unknown): Vir[] {
  const generic = (json as { grounding?: { generic?: unknown } } | null)?.grounding?.generic;
  if (!Array.isArray(generic)) return [];
  const viri: Vir[] = [];
  let skupaj = 0;
  for (const g of generic) {
    if (skupaj >= MEJA_ZNAKOV) break;
    if (!g || typeof g !== "object") continue;
    const { url, title, snippets } = g as { url?: unknown; title?: unknown; snippets?: unknown };
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
    const izvlecki: string[] = [];
    for (const s of Array.isArray(snippets) ? snippets : []) {
      if (typeof s !== "string" || !s.trim()) continue;
      if (skupaj >= MEJA_ZNAKOV) break;
      const del = s.slice(0, MEJA_ZNAKOV - skupaj);
      izvlecki.push(del);
      skupaj += del.length;
    }
    if (izvlecki.length) viri.push({ url, naslov: typeof title === "string" ? title.slice(0, 300) : url, izvlecki });
  }
  return viri;
}

export async function stanjeBrave(token: string | null, dir?: string, zdaj = new Date()): Promise<StanjeBrave> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return { povezan: (await preberiKljuc(root)) !== null, porabljenoVMesecu: await porabljeno(root, zdaj), meja: await meja(root) };
}

/** Uporabnik nastavi mesecno mejo iskanj (0 = Brave izklopljen). */
export async function nastaviMejoBrave(token: string | null, mesecnaMeja: unknown, dir?: string): Promise<StanjeBrave> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  if (!jeVeljavnaMeja(mesecnaMeja)) throw new Error(`Meja mora biti celo stevilo od 0 do ${NAJVECJA_MEJA}.`);
  await writeJson(root, NASTAVITVE, { mesecnaMeja } satisfies Nastavitve);
  return stanjeBrave(token, dir);
}

/** Kljuc se preveri z enim iskanjem (ena zahteva, steje v mesecno mejo); napacen kljuc se ne shrani. */
export async function poveziBrave(
  token: string | null,
  kljuc: string,
  dir?: string,
  zahteva: ZahtevaBrave = zahtevaBrave,
  zdaj = new Date(),
): Promise<StanjeBrave> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const k = kljuc.trim();
  if (!jeVeljavenKljuc(k)) throw new Error("Kljuc Brave ni veljaven.");
  if (!(await rezervirajZahtevo(root, zdaj))) throw new Error("Mesecna meja iskanj Brave je dosezena.");
  const odg = await zahteva(`https://${GOSTITELJ}/res/v1/web/search?q=Ljubljana&count=1`, glave(k));
  if (odg.status === 401 || odg.status === 403) throw new Error("Brave kljuca ni sprejel.");
  if (odg.status !== 200) throw new Error("Povezava z Brave ni uspela.");
  await writeJson(root, DATOTEKA, await sifrirajSkrivnost(k, root));
  return stanjeBrave(token, dir, zdaj);
}

export async function pozabiBrave(token: string | null, dir?: string): Promise<StanjeBrave> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  await rm(path.join(root, DATOTEKA), { force: true });
  return stanjeBrave(token, dir);
}

/**
 * Viri za vprasanje asistentke ali null (brez kljuca, dosezena meja, napaka, nic najdenega). Besedilo virov je PODATEK za
 * model, nikoli ukaz: klicatelj ga da modelu kot citat, dejanja na napravah pa vedno potrdi lastnik.
 */
export async function iskanjeBrave(
  vprasanje: string,
  dir?: string,
  zahteva: ZahtevaBrave = zahtevaBrave,
  zdaj = new Date(),
): Promise<Vir[] | null> {
  const root = resolveDataDir(dir);
  const kljuc = await preberiKljuc(root);
  const q = pripraviVprasanje(vprasanje);
  if (!kljuc || !q) return null;
  try {
    if (!(await rezervirajZahtevo(root, zdaj))) return null;
    let odg = await zahteva(naslovLlmContext(q, true), glave(kljuc));
    if (odg.status === 400 || odg.status === 422) {
      if (!(await rezervirajZahtevo(root, zdaj))) return null;
      odg = await zahteva(naslovLlmContext(q, false), glave(kljuc));
    }
    if (odg.status !== 200) return null;
    const viri = razcleniViri(odg.json);
    return viri.length ? viri : null;
  } catch {
    return null;
  }
}
