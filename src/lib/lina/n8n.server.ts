/**
 * Uporaba dodatka n8n v Lini (lastnik 19. 11. in 24. 11. 2026):
 * - priprava racuna/API kljuca ob prvem vklopu ali prvi uporabi (n8n-priprava.server.ts),
 * - seznam tokov (samo branje),
 * - predlog ustvarjanja ali zagona toka (SAMO predlog v stanju »caka«, nic se ne izvede),
 * - potrditev lastnika (vezana na id in zgostitev) -> izvedba v n8n (ustvarjen neaktiven ali zagon prek webhooka / `docker exec n8n execute --id`)
 *   -> rezultat gre v pogovor z Lino (dodajSporociloLine).
 * - podpora za namizje (pogovor + zavihek Racunalnik), telefon (podpis naprave) in kanal Claude Code (orodje dodatki).
 *
 * Vgradnja 0211 (skupni modul dovoljenj 02f): ZAGON istega toka (obseg = ID toka) sme brez novega vprasanja, ce je lastnik ob potrditvi
 * izbral »Velja tudi za vse podobne« (namizje, seja lastnika) ali ce naprava naloge kanala nosi podpisano dovoljenje za ta predogled.
 * USTVARJANJE toka se vedno vprasa. Predlog iz oznake modela (izvor »lina«) in s telefona je vedno samo predlog.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ownerExists, requireOwner } from "./auth.server.ts";
import { najdiDovoljenje, zapisiDovoljenje } from "./dovoljenja-podobne.server.ts";
import type { Jezik } from "./besedila.ts";
import { izvajalecDocker, type Izvajalec as Docker } from "./dodatki.server.ts";
import {
  CAKA_N8N_MS,
  N8N_IME_VSEBNIKA,
  N8N_PRIVZETI_NASLOV,
  NAJVEC_CAKAJOCIH_LINE_N8N,
  NAJVEC_CAKAJOCIH_N8N,
  NAJVEC_PREDLOGOV_N8N,
  NAJVEC_TOKOV_N8N,
  N8nNapaka,
  imaNevidneN8n,
  izluciOznakeN8n,
  jeKratkaPotrditev,
  jeLokalniN8nNaslov,
  jeSporociloPotrditveN8n,
  oblikujIzidN8n,
  oblikujPredlogPotrditveN8n,
  oblikujSeznamTokovN8n,
  ocistiBesediloN8n,
  opisRazlogaN8n,
  razberiNameroN8n,
  sestaviTokIzOpisa,
  varnaPotWebhooka,
  veljavenIdTokaN8n,
  zgostitevPredlogaN8n,
  type IzvorN8n,
  type PredlogN8n,
  type RazlogN8n,
  type TokN8n,
} from "./n8n.ts";
import { imaKljucN8n, preberiKljucN8n, pripraviRacunN8n } from "./n8n-priprava.server.ts";
import { loadPravila } from "./pravila.server.ts";
import { hideSecret } from "./providers.ts";
import { resolveDataDir } from "./store.server.ts";

export const DATOTEKA_PREDLOGOV_N8N = "n8n-predlogi.json";
const ROK_API_MS = 12_000;
const ID_PREDLOGA = /^[a-f0-9]{16}$/;

type StanjeDatoteka = { v: 1; predlogi: PredlogN8n[] };

export type OdvisnostiN8n = {
  naslov?: string;
  fetchFn?: typeof fetch;
  docker?: Docker;
  zdaj?: () => Date;
  obvesti?: (root: string, besedilo: string) => Promise<void>;
  jezik?: Jezik;
};

let privzeteOdvisnosti: OdvisnostiN8n = {};
/** Za preizkuse: nastavi privzete odvisnosti n8n (lazni HTTP streznik na 127.0.0.1 in lazni Docker); vrne prejsnje. */
export function nastaviPrivzeteOdvisnostiN8n(o: OdvisnostiN8n): OdvisnostiN8n {
  const prej = privzeteOdvisnosti;
  privzeteOdvisnosti = o;
  return prej;
}

async function privzetoObvesti(root: string, besedilo: string): Promise<void> {
  const { dodajSporociloLine } = await import("./asistent-pogovor.server.ts");
  await dodajSporociloLine(root, besedilo);
}

function odv(o: OdvisnostiN8n = {}) {
  const zdruzeno = { ...privzeteOdvisnosti, ...o };
  const naslov = jeLokalniN8nNaslov(zdruzeno.naslov ?? N8N_PRIVZETI_NASLOV);
  if (!naslov) throw new N8nNapaka("neveljaven-naslov");
  return {
    naslov,
    fetchFn: zdruzeno.fetchFn ?? fetch,
    docker: zdruzeno.docker ?? izvajalecDocker,
    zdaj: zdruzeno.zdaj ?? (() => new Date()),
    obvesti: zdruzeno.obvesti ?? privzetoObvesti,
    jezik: (zdruzeno.jezik ?? "sl") as Jezik,
  };
}
type Odv = ReturnType<typeof odv>;

// ------------------------------------------------------------------ Stanje predlogov na disku (0600, zaporedno po korenu)

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

async function preberiPredloge(root: string): Promise<StanjeDatoteka> {
  try {
    const s = JSON.parse(await readFile(path.join(root, DATOTEKA_PREDLOGOV_N8N), "utf8")) as Partial<StanjeDatoteka>;
    if (!s || typeof s !== "object" || !Array.isArray(s.predlogi)) return { v: 1, predlogi: [] };
    return {
      v: 1,
      predlogi: s.predlogi.filter((p): p is PredlogN8n => !!p && typeof p === "object" && ID_PREDLOGA.test(String(p.id))).slice(-NAJVEC_PREDLOGOV_N8N),
    };
  } catch {
    return { v: 1, predlogi: [] };
  }
}

async function zapisiPredloge(root: string, s: StanjeDatoteka): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const cilj = path.join(root, DATOTEKA_PREDLOGOV_N8N);
  const zacasna = `${cilj}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(zacasna, JSON.stringify({ v: 1, predlogi: s.predlogi.slice(-NAJVEC_PREDLOGOV_N8N) }, null, 2), { mode: 0o600, flag: "wx" });
  await rename(zacasna, cilj);
  if (process.platform !== "win32") await chmod(cilj, 0o600).catch(() => undefined);
}

function jePotekel(p: PredlogN8n, zdaj: Date): boolean {
  const t = Date.parse(p.ustvarjeno);
  return p.stanje === "caka" && (!Number.isFinite(t) || zdaj.getTime() - t > CAKA_N8N_MS);
}

export async function jeN8nVklopljen(dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  const p = await loadPravila(root).catch(() => null);
  return p?.dodatki?.n8n === true;
}

async function zagotoviKljuc(root: string, o: Odv): Promise<string> {
  if (!(await jeN8nVklopljen(root))) throw new N8nNapaka("izklopljeno");
  let kljuc = await preberiKljucN8n(root);
  if (!kljuc) {
    const pr = await pripraviRacunN8n(root, { naslov: o.naslov, fetchFn: o.fetchFn, zdaj: o.zdaj });
    if (!pr.ok) throw new N8nNapaka(pr.razlog ?? "ni-kljuca");
    kljuc = await preberiKljucN8n(root);
  }
  if (!kljuc) throw new N8nNapaka("ni-kljuca");
  return kljuc;
}

async function klicApiN8n(
  root: string,
  o: Odv,
  metoda: "GET" | "POST",
  pot: string,
  telo?: unknown,
): Promise<{ status: number; data: unknown; kljuc: string }> {
  const izvedi = async (kljuc: string) => {
    let res: Response;
    try {
      res = await o.fetchFn(`${o.naslov}${pot}`, {
        method: metoda,
        headers: {
          accept: "application/json",
          "x-n8n-api-key": kljuc,
          ...(telo !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: telo !== undefined ? JSON.stringify(telo) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(ROK_API_MS),
      });
    } catch {
      throw new N8nNapaka("ni-povezave");
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data, kljuc };
  };

  let kljuc = await zagotoviKljuc(root, o);
  let r = await izvedi(kljuc);
  // Ce kljuc ne velja vec (401/403), enkrat poskusi obnoviti prek pripraviRacunN8n
  if (r.status === 401 || r.status === 403) {
    const pr = await pripraviRacunN8n(root, { naslov: o.naslov, fetchFn: o.fetchFn, zdaj: o.zdaj });
    if (!pr.ok) throw new N8nNapaka(pr.razlog ?? "ni-kljuca");
    kljuc = (await preberiKljucN8n(root)) ?? "";
    if (!kljuc) throw new N8nNapaka("ni-kljuca");
    r = await izvedi(kljuc);
  }
  return r;
}

function razberiTok(surov: unknown): TokN8n | null {
  if (!surov || typeof surov !== "object") return null;
  const x = surov as Record<string, unknown>;
  const id = typeof x.id === "number" ? String(x.id) : typeof x.id === "string" ? x.id.trim() : "";
  if (!veljavenIdTokaN8n(id)) return null;
  const ime = ocistiBesediloN8n(x.name, 120) || `Tok ${id}`;
  const aktiven = x.active === true;
  const posodobljen = typeof x.updatedAt === "string" ? x.updatedAt.slice(0, 40) : null;
  let webhookPot: string | null = null;
  if (aktiven && Array.isArray(x.nodes)) {
    for (const n of x.nodes as Array<Record<string, unknown>>) {
      if (n?.type === "n8n-nodes-base.webhook" && n.parameters && typeof n.parameters === "object") {
        const p = varnaPotWebhooka((n.parameters as Record<string, unknown>).path);
        if (p) {
          webhookPot = p;
          break;
        }
      }
    }
  }
  return { id, ime, aktiven, posodobljen, ...(webhookPot ? { webhookPot } : {}) };
}

/** Prebere seznam tokov iz lokalnega n8n (samo branje; ob prvi rabi pripravi racun in kljuc). */
export async function seznamTokovN8n(dir?: string, odvisnosti: OdvisnostiN8n = {}): Promise<TokN8n[]> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  const r = await klicApiN8n(root, o, "GET", `/api/v1/workflows?limit=${NAJVEC_TOKOV_N8N}`);
  if (r.status < 200 || r.status >= 300) throw new N8nNapaka("ni-povezave");
  const surovi = Array.isArray(r.data) ? r.data : Array.isArray((r.data as { data?: unknown })?.data) ? ((r.data as { data: unknown[] }).data) : [];
  return surovi.map(razberiTok).filter((t): t is TokN8n => t !== null).slice(0, NAJVEC_TOKOV_N8N);
}

async function najdiTok(root: string, o: Odv, cilj: string, samoId = false): Promise<TokN8n> {
  const c = ocistiBesediloN8n(cilj, 120);
  if (!c) throw new N8nNapaka("oblika");
  const tokovi = await seznamTokovN8n(root, o);
  const poId = tokovi.find((t) => t.id === c);
  if (poId) return poId;
  // zagon po dovoljenju za podobne: samo natancen ID (ime bi se lahko ujemalo z drugim tokom)
  if (samoId) throw new N8nNapaka("ni-najdeno");
  const nizko = c.toLowerCase();
  const natancno = tokovi.find((t) => t.ime.toLowerCase() === nizko);
  if (natancno) return natancno;
  const delno = tokovi.filter((t) => t.ime.toLowerCase().includes(nizko));
  if (delno.length === 1) return delno[0]!;
  throw new N8nNapaka("ni-najdeno");
}

function preveriMejoCakajocih(predlogi: PredlogN8n[], izvor: IzvorN8n, zdaj: Date): void {
  for (const p of predlogi) if (jePotekel(p, zdaj)) p.stanje = "poteklo";
  const jeLina = izvor === "lina";
  const st = predlogi.filter((p) => p.stanje === "caka" && (p.izvor === "lina") === jeLina).length;
  if (st >= (jeLina ? NAJVEC_CAKAJOCIH_LINE_N8N : NAJVEC_CAKAJOCIH_N8N)) throw new N8nNapaka("polno-cakajoce");
}

/** Pripravi PREDLOG za ustvarjanje toka iz opisa; v n8n se ne ustvari nic, dokler lastnik ne potrdi. */
export async function predlagajUstvarjanjeTokaN8n(
  dir: string | undefined,
  izvor: IzvorN8n,
  opis: string,
  ime?: string,
  odvisnosti: OdvisnostiN8n = {},
): Promise<PredlogN8n> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  if (!(await jeN8nVklopljen(root))) throw new N8nNapaka("izklopljeno");
  if (typeof opis !== "string" || imaNevidneN8n(opis) || (typeof ime === "string" && imaNevidneN8n(ime))) throw new N8nNapaka("oblika");
  const cistOpis = ocistiBesediloN8n(opis, 400);
  if (cistOpis.length < 3) throw new N8nNapaka("oblika");
  const { definicija, povzetek } = sestaviTokIzOpisa(cistOpis, ime, o.jezik);
  return vVrsti(root, async () => {
    const s = await preberiPredloge(root);
    const zdaj = o.zdaj();
    preveriMejoCakajocih(s.predlogi, izvor, zdaj);
    const p: PredlogN8n = {
      id: randomBytes(8).toString("hex"),
      vrsta: "ustvari",
      izvor,
      stanje: "caka",
      zgostitev: zgostitevPredlogaN8n({ vrsta: "ustvari", imeToka: definicija.name, opis: cistOpis, definicija }),
      ustvarjeno: zdaj.toISOString(),
      potrjeno: null,
      zakljuceno: null,
      tokId: null,
      imeToka: definicija.name,
      opis: cistOpis,
      definicija,
      povzetek,
      rezultat: null,
      izvedbaId: null,
      razlog: null,
    };
    s.predlogi.push(p);
    await zapisiPredloge(root, s);
    return p;
  });
}

/** Pripravi PREDLOG za zagon obstojecega toka; v n8n se ne zazene nic, dokler lastnik ne potrdi. */
export async function predlagajZagonTokaN8n(
  dir: string | undefined,
  izvor: IzvorN8n,
  cilj: string,
  odvisnosti: OdvisnostiN8n = {},
  moznosti: { samoId?: boolean } = {},
): Promise<PredlogN8n> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  if (!(await jeN8nVklopljen(root))) throw new N8nNapaka("izklopljeno");
  if (typeof cilj !== "string" || imaNevidneN8n(cilj)) throw new N8nNapaka("oblika");
  const tok = await najdiTok(root, o, cilj, moznosti.samoId === true);
  const povzetek = o.jezik === "en" ? `Run workflow "${tok.ime}" (ID: ${tok.id}).` : `Zagon toka »${tok.ime}« (ID: ${tok.id}).`;
  return vVrsti(root, async () => {
    const s = await preberiPredloge(root);
    const zdaj = o.zdaj();
    preveriMejoCakajocih(s.predlogi, izvor, zdaj);
    const p: PredlogN8n = {
      id: randomBytes(8).toString("hex"),
      vrsta: "zazeni",
      izvor,
      stanje: "caka",
      zgostitev: zgostitevPredlogaN8n({ vrsta: "zazeni", tokId: tok.id, imeToka: tok.ime, opis: cilj.trim() }),
      ustvarjeno: zdaj.toISOString(),
      potrjeno: null,
      zakljuceno: null,
      tokId: tok.id,
      imeToka: tok.ime,
      opis: ocistiBesediloN8n(cilj, 120),
      definicija: null,
      povzetek,
      rezultat: null,
      izvedbaId: null,
      razlog: null,
    };
    s.predlogi.push(p);
    await zapisiPredloge(root, s);
    return p;
  });
}

/** Odkloni cakajoci predlog; v n8n se ne zgodi nic. */
export async function odkloniPredlogN8n(dir: string | undefined, id: string, odvisnosti: OdvisnostiN8n = {}): Promise<PredlogN8n> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  if (!ID_PREDLOGA.test(id)) throw new N8nNapaka("ni-najdeno");
  return vVrsti(root, async () => {
    const s = await preberiPredloge(root);
    const p = s.predlogi.find((x) => x.id === id);
    if (!p || p.stanje !== "caka") throw new N8nNapaka("ni-najdeno");
    p.stanje = "odklonjeno";
    p.zakljuceno = o.zdaj().toISOString();
    await zapisiPredloge(root, s);
    return p;
  });
}

/**
 * Potrdi cakajoci predlog (enkratno, vezano na id + zgostitev), izvede v lokalnem n8n in rezultat sporoci v pogovor.
 */
export async function potrdiPredlogN8n(
  dir: string | undefined,
  id: string,
  zgostitev: string,
  odvisnosti: OdvisnostiN8n = {},
): Promise<PredlogN8n> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  if (!(await jeN8nVklopljen(root))) throw new N8nNapaka("izklopljeno");
  if (!ID_PREDLOGA.test(id) || typeof zgostitev !== "string" || !/^[a-f0-9]{64}$/.test(zgostitev)) throw new N8nNapaka("zgostitev");

  // Atomarno prevzemi predlog (prepreci dvojno izvedbo ob hkratni potrditvi)
  const prevzet = await vVrsti(root, async () => {
    const s = await preberiPredloge(root);
    const zdaj = o.zdaj();
    const p = s.predlogi.find((x) => x.id === id);
    if (!p || p.stanje !== "caka") throw new N8nNapaka("ni-najdeno");
    if (jePotekel(p, zdaj)) {
      p.stanje = "poteklo";
      await zapisiPredloge(root, s);
      throw new N8nNapaka("poteklo");
    }
    if (p.zgostitev !== zgostitev) throw new N8nNapaka("zgostitev");
    p.potrjeno = zdaj.toISOString();
    // Zacasno oznaci kot zakljucen/v obdelavi, da ponovna potrditev takoj pade
    p.stanje = "napaka";
    p.razlog = p.vrsta === "ustvari" ? "ustvari" : "zagon";
    await zapisiPredloge(root, s);
    return { ...p };
  });

  let koncni: PredlogN8n = prevzet;
  let skrivnost = "";
  try {
    if (prevzet.vrsta === "ustvari") {
      if (!prevzet.definicija) throw new N8nNapaka("oblika");
      const r = await klicApiN8n(root, o, "POST", "/api/v1/workflows", prevzet.definicija);
      skrivnost = r.kljuc;
      if (r.status < 200 || r.status >= 300) throw new N8nNapaka("ustvari");
      const tok = razberiTok((r.data as { data?: unknown })?.data ?? r.data);
      if (!tok) throw new N8nNapaka("ustvari");
      koncni = {
        ...prevzet,
        stanje: "koncano",
        tokId: tok.id,
        imeToka: tok.ime,
        razlog: null,
        zakljuceno: o.zdaj().toISOString(),
      };
      koncni.rezultat = oblikujIzidN8n(koncni, o.jezik);
    } else {
      if (!veljavenIdTokaN8n(prevzet.tokId)) throw new N8nNapaka("ni-najdeno");
      const rTok = await klicApiN8n(root, o, "GET", `/api/v1/workflows/${prevzet.tokId}`);
      skrivnost = rTok.kljuc;
      if (rTok.status < 200 || rTok.status >= 300) throw new N8nNapaka("ni-najdeno");
      const tok = razberiTok((rTok.data as { data?: unknown })?.data ?? rTok.data);
      if (!tok) throw new N8nNapaka("ni-najdeno");

      let ok = false;
      if (tok.webhookPot) {
        try {
          const wh = await o.fetchFn(`${o.naslov}/webhook/${tok.webhookPot}`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ izvor: "lina" }),
            redirect: "manual",
            signal: AbortSignal.timeout(ROK_API_MS),
          });
          ok = wh.ok;
        } catch {
          ok = false;
        }
      } else {
        // Uradni ukaz n8n CLI v vsebniku (brez lupine, ID preverjen z veljavenIdTokaN8n)
        // Glavni n8n v vsebniku ze drzi vrata posrednika nalog 5679: »n8n execute« potrebuje druga (izmerjeno 24. 11. 2026, n8n 2.48.7).
        const iz = await o.docker(["exec", "-e", "N8N_RUNNERS_BROKER_PORT=5690", N8N_IME_VSEBNIKA, "n8n", "execute", "--id", tok.id]);
        ok = iz.koda === 0;
      }

      let izvedbaId: string | null = null;
      const rIzv = await klicApiN8n(root, o, "GET", `/api/v1/executions?workflowId=${encodeURIComponent(tok.id)}&limit=1`).catch(() => null);
      if (rIzv && rIzv.status >= 200 && rIzv.status < 300) {
        const seznam = Array.isArray(rIzv.data) ? rIzv.data : Array.isArray((rIzv.data as { data?: unknown })?.data) ? ((rIzv.data as { data: unknown[] }).data) : [];
        const zadnja = seznam[0] as Record<string, unknown> | undefined;
        if (zadnja && (typeof zadnja.id === "string" || typeof zadnja.id === "number")) {
          const cId = ocistiBesediloN8n(String(zadnja.id), 64);
          if (cId) izvedbaId = cId;
          if (zadnja.status === "error") ok = false;
        }
      }

      koncni = {
        ...prevzet,
        stanje: ok ? "koncano" : "napaka",
        tokId: tok.id,
        imeToka: tok.ime,
        izvedbaId,
        razlog: ok ? null : "zagon",
        zakljuceno: o.zdaj().toISOString(),
      };
      koncni.rezultat = hideSecret(oblikujIzidN8n(koncni, o.jezik), skrivnost);
    }
  } catch (e) {
    const razlog: RazlogN8n = e instanceof N8nNapaka ? e.razlog : prevzet.vrsta === "ustvari" ? "ustvari" : "zagon";
    koncni = {
      ...prevzet,
      stanje: "napaka",
      razlog,
      zakljuceno: o.zdaj().toISOString(),
    };
    koncni.rezultat = hideSecret(oblikujIzidN8n(koncni, o.jezik), skrivnost);
  }

  await vVrsti(root, async () => {
    const s = await preberiPredloge(root);
    const i = s.predlogi.findIndex((x) => x.id === koncni.id);
    if (i >= 0) s.predlogi[i] = koncni;
    await zapisiPredloge(root, s);
  });

  if (koncni.rezultat) {
    await o.obvesti(root, hideSecret(koncni.rezultat, skrivnost)).catch(() => undefined);
  }
  return koncni;
}

// ------------------------------------------------------------------ Dovoljenje za podobne (02f): samo zagon istega toka

/**
 * Predlog zagona na pobudo LASTNIKA (namizje ali njegov ukaz v pogovoru): ce je lastnik za ta tok (ID) ze dal dovoljenje za podobne,
 * se predlog takoj potrdi; sicer caka. Dovoljenje seje lastnika (brez naprave); uporaba gre v dnevnik dovoljenj.
 */
async function predlagajZagonLastnika(root: string, cilj: string, o: Odv): Promise<PredlogN8n> {
  const p = await predlagajZagonTokaN8n(root, "lastnik", cilj, o);
  if (!veljavenIdTokaN8n(p.tokId) || !(await najdiDovoljenje(root, "n8n-zagon", { tok: p.tokId }, {}, o.zdaj()))) return p;
  return potrdiPredlogN8n(root, p.id, p.zgostitev, o);
}

/** Lastnikova izbira »Velja tudi za vse podobne« ob potrditvi ZAGONA (samo strogo true; ustvarjanje toka nikoli). */
async function dovoliPodobneZagone(root: string, p: PredlogN8n, podobne: unknown, o: Odv): Promise<void> {
  if (podobne !== true || p.vrsta !== "zazeni" || !veljavenIdTokaN8n(p.tokId)) return;
  await zapisiDovoljenje(root, "n8n-zagon", { tok: p.tokId }, { kdo: "lastnik" }, o.zdaj()).catch(() => undefined);
}

// ------------------------------------------------------------------ Javno stanje in ukazi (namizje z requireOwner)

export type JavnoStanjeN8n = {
  vklopljeno: boolean;
  geslo: boolean;
  pripravljen: boolean;
  povezan: boolean;
  tokovi: TokN8n[];
  predlogi: PredlogN8n[];
  napaka: RazlogN8n | null;
};

async function javnoStanje(root: string, o: Odv): Promise<JavnoStanjeN8n> {
  const vklopljeno = await jeN8nVklopljen(root);
  const geslo = await ownerExists(root);
  const pripravljen = await imaKljucN8n(root);
  const zdaj = o.zdaj();
  const s = await preberiPredloge(root);
  const predlogi = [...s.predlogi].reverse().map((p) => (jePotekel(p, zdaj) ? { ...p, stanje: "poteklo" as const } : p));
  if (!vklopljeno) return { vklopljeno: false, geslo, pripravljen, povezan: false, tokovi: [], predlogi, napaka: null };
  try {
    const tokovi = await seznamTokovN8n(root, o);
    return { vklopljeno: true, geslo, pripravljen: await imaKljucN8n(root), povezan: true, tokovi, predlogi, napaka: null };
  } catch (e) {
    const napaka: RazlogN8n = e instanceof N8nNapaka ? e.razlog : "ni-povezave";
    return { vklopljeno: true, geslo, pripravljen: await imaKljucN8n(root), povezan: false, tokovi: [], predlogi, napaka };
  }
}

export async function stanjeN8n(token: string | null, dir?: string, odvisnosti: OdvisnostiN8n = {}): Promise<JavnoStanjeN8n> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  return javnoStanje(root, odv(odvisnosti));
}

export async function ukazN8n(token: string | null, ukaz: unknown, dir?: string, odvisnosti: OdvisnostiN8n = {}): Promise<JavnoStanjeN8n> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const o = odv(odvisnosti);
  const u = ukaz && typeof ukaz === "object" && !Array.isArray(ukaz) ? (ukaz as Record<string, unknown>) : {};
  switch (u.ukaz) {
    case "pripravi": {
      if (!(await jeN8nVklopljen(root))) throw new N8nNapaka("izklopljeno");
      const pr = await pripraviRacunN8n(root, { naslov: o.naslov, fetchFn: o.fetchFn, zdaj: o.zdaj });
      if (!pr.ok) throw new N8nNapaka(pr.razlog ?? "ni-kljuca");
      break;
    }
    case "seznam":
      await seznamTokovN8n(root, o);
      break;
    case "predlog_ustvari":
      await predlagajUstvarjanjeTokaN8n(root, "lastnik", String(u.opis ?? ""), typeof u.ime === "string" ? u.ime : undefined, o);
      break;
    case "predlog_zazeni":
      await predlagajZagonLastnika(root, String(u.cilj ?? ""), o);
      break;
    case "potrdi": {
      const p = await potrdiPredlogN8n(root, String(u.id ?? ""), String(u.zgostitev ?? ""), o);
      await dovoliPodobneZagone(root, p, u.podobne, o);
      break;
    }
    case "odkloni":
      await odkloniPredlogN8n(root, String(u.id ?? ""), o);
      break;
    default:
      throw new N8nNapaka("ukaz");
  }
  return javnoStanje(root, o);
}

// ------------------------------------------------------------------ Pogovor z Lino (neposredno + oznake modela)

async function zadnjiCakajoci(root: string, zdaj: Date, id?: string): Promise<PredlogN8n | null> {
  const s = await preberiPredloge(root);
  const cakajoci = s.predlogi.filter((p) => p.stanje === "caka" && !jePotekel(p, zdaj));
  if (id) return cakajoci.find((p) => p.id === id) ?? null;
  return cakajoci.at(-1) ?? null;
}

/**
 * Neposredni ukazi lastnika za n8n v pogovoru (seznam, predlog ustvarjanja/zagona, potrditev/odklonitev).
 * Vrne odgovor kode (ki ga asistentPogovor shrani v pogovor) ali null, ce sporocilo ni n8n ukaz.
 */
export async function obdelajNeposredniN8n(
  root: string,
  novo: string,
  zadnjiLinin: string,
  odvisnosti: OdvisnostiN8n = {},
): Promise<string | null> {
  const o = odv(odvisnosti);
  let namera = razberiNameroN8n(novo);
  if (!namera) {
    const kratka = jeKratkaPotrditev(novo);
    const idIzZadnjega = kratka ? jeSporociloPotrditveN8n(zadnjiLinin) : null;
    if (kratka && idIzZadnjega) namera = { vrsta: kratka, id: idIzZadnjega };
  }
  if (!namera) return null;

  if (!(await jeN8nVklopljen(root))) return opisRazlogaN8n("izklopljeno", o.jezik);

  try {
    if (namera.vrsta === "seznam") {
      return oblikujSeznamTokovN8n(await seznamTokovN8n(root, o), o.jezik);
    }
    if (namera.vrsta === "ustvari") {
      const p = await predlagajUstvarjanjeTokaN8n(root, "lastnik", namera.opis, namera.ime, o);
      return oblikujPredlogPotrditveN8n(p, o.jezik);
    }
    if (namera.vrsta === "zazeni") {
      const p = await predlagajZagonLastnika(root, namera.cilj, { ...o, obvesti: async () => {} });
      return p.stanje === "caka" ? oblikujPredlogPotrditveN8n(p, o.jezik) : (p.rezultat ?? oblikujIzidN8n(p, o.jezik));
    }
    if (namera.vrsta === "potrdi") {
      const c = await zadnjiCakajoci(root, o.zdaj(), namera.id);
      if (!c) return opisRazlogaN8n("ni-najdeno", o.jezik);
      // asistentPogovor ta odgovor sam zapise v asistent.json -> brez dvojnega obvestila
      const izid = await potrdiPredlogN8n(root, c.id, c.zgostitev, { ...o, obvesti: async () => {} });
      return izid.rezultat ?? oblikujIzidN8n(izid, o.jezik);
    }
    const c = await zadnjiCakajoci(root, o.zdaj(), namera.id);
    if (!c) return opisRazlogaN8n("ni-najdeno", o.jezik);
    await odkloniPredlogN8n(root, c.id, o);
    return o.jezik === "en" ? "n8n proposal cancelled; nothing was changed." : "Predlog za n8n je preklican; nič ni spremenjeno.";
  } catch (e) {
    const r: RazlogN8n = e instanceof N8nNapaka ? e.razlog : "ni-povezave";
    return opisRazlogaN8n(r, o.jezik);
  }
}

/**
 * Obdelava oznak modela ([[n8n-seznam]], [[n8n-zazeni: ...]], [[n8n-ustvari: ...]]).
 * Oznake se vedno odstranijo; pri priponkah (dovoliPredlog=false) ne naredijo nicesar.
 * Ustvarjanje/zagon nikoli ne izvedeta takoj - samo pripravita predlog za potrditev lastnika.
 */
export async function obdelajOznakeN8n(
  root: string,
  odgovor: string,
  dovoliPredlog: boolean,
  odvisnosti: OdvisnostiN8n = {},
): Promise<string> {
  const { besedilo, oznake } = izluciOznakeN8n(odgovor);
  if (!oznake.length) return odgovor;
  if (!dovoliPredlog) return besedilo;
  const o = odv(odvisnosti);
  if (!(await jeN8nVklopljen(root))) return `${besedilo}\n\n(${opisRazlogaN8n("izklopljeno", o.jezik)})`.trim();
  const oz = oznake[0]!;
  try {
    if (oz.vrsta === "seznam") {
      const seznam = oblikujSeznamTokovN8n(await seznamTokovN8n(root, o), o.jezik);
      return `${besedilo}\n\n${seznam}`.trim();
    }
    if (oz.vrsta === "ustvari") {
      const p = await predlagajUstvarjanjeTokaN8n(root, "lina", oz.opis, oz.ime, o);
      return `${besedilo}\n\n${oblikujPredlogPotrditveN8n(p, o.jezik)}`.trim();
    }
    const p = await predlagajZagonTokaN8n(root, "lina", oz.cilj, o);
    return `${besedilo}\n\n${oblikujPredlogPotrditveN8n(p, o.jezik)}`.trim();
  } catch (e) {
    const r: RazlogN8n = e instanceof N8nNapaka ? e.razlog : "ni-povezave";
    return `${besedilo}\n\n(${opisRazlogaN8n(r, o.jezik)})`.trim();
  }
}

// ------------------------------------------------------------------ Telefon (podpis naprave preveri AsistentStreznik)

export async function telefonStanjeN8n(dir: string, odvisnosti: OdvisnostiN8n = {}): Promise<JavnoStanjeN8n> {
  return javnoStanje(resolveDataDir(dir), odv(odvisnosti));
}

export async function telefonPredlogN8n(
  dir: string,
  vrsta: unknown,
  cilj: unknown,
  ime?: unknown,
  odvisnosti: OdvisnostiN8n = {},
): Promise<{ id: string; vrsta: "ustvari" | "zazeni"; zgostitev: string; povzetek: string }> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  if (vrsta === "ustvari") {
    const p = await predlagajUstvarjanjeTokaN8n(root, "telefon", String(cilj ?? ""), typeof ime === "string" ? ime : undefined, o);
    return { id: p.id, vrsta: p.vrsta, zgostitev: p.zgostitev, povzetek: p.povzetek };
  }
  if (vrsta === "zazeni") {
    const p = await predlagajZagonTokaN8n(root, "telefon", String(cilj ?? ""), o);
    return { id: p.id, vrsta: p.vrsta, zgostitev: p.zgostitev, povzetek: p.povzetek };
  }
  throw new N8nNapaka("ukaz");
}

export async function telefonPotrdiN8n(
  dir: string,
  id: unknown,
  zgostitev: unknown,
  dovoli: unknown,
  odvisnosti: OdvisnostiN8n = {},
): Promise<{ ok: boolean; id: string; stanje: string; sporocilo: string; tokId: string | null; izvedbaId: string | null }> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  if (typeof id !== "string" || typeof dovoli !== "boolean") throw new N8nNapaka("oblika");
  if (!dovoli) {
    const p = await odkloniPredlogN8n(root, id, o);
    return { ok: true, id: p.id, stanje: p.stanje, sporocilo: o.jezik === "en" ? "Cancelled." : "Preklicano.", tokId: p.tokId, izvedbaId: null };
  }
  const p = await potrdiPredlogN8n(root, id, String(zgostitev ?? ""), o);
  return {
    ok: p.stanje === "koncano",
    id: p.id,
    stanje: p.stanje,
    sporocilo: p.rezultat ?? oblikujIzidN8n(p, o.jezik),
    tokId: p.tokId,
    izvedbaId: p.izvedbaId,
  };
}

// ------------------------------------------------------------------ Kanal Claude Code (orodje dodatki; podpisano odobritev preveri kanal + asistent.server.ts)

export async function kanalSeznamN8n(dir: string, odvisnosti: OdvisnostiN8n = {}): Promise<string> {
  const o = odv(odvisnosti);
  return oblikujSeznamTokovN8n(await seznamTokovN8n(resolveDataDir(dir), o), o.jezik);
}

/**
 * Klicano SAMO po podpisani odobritvi lastnika na napravi za natanko ta predogled ali po podpisanem dovoljenju za podobne te naprave
 * (preveri asistent.server.ts dodatki, ne kanal). Pri dovoljenju za podobne `samoId`: tok samo po natancnem ID (obseg dovoljenja).
 */
export async function kanalZazeniN8n(dir: string, tok: string, odvisnosti: OdvisnostiN8n = {}, moznosti: { samoId?: boolean } = {}): Promise<string> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  const p = await predlagajZagonTokaN8n(root, "kanal", tok, o, { samoId: moznosti.samoId === true });
  const izid = await potrdiPredlogN8n(root, p.id, p.zgostitev, o);
  if (izid.stanje !== "koncano") throw new N8nNapaka(izid.razlog ?? "zagon", izid.rezultat ?? undefined);
  return izid.rezultat ?? oblikujIzidN8n(izid, o.jezik);
}

/** Klicano SAMO po podpisani odobritvi lastnika na napravi (kanal-claude.server.ts + asistent.server.ts). */
export async function kanalUstvariN8n(dir: string, opis: string, ime?: string, odvisnosti: OdvisnostiN8n = {}): Promise<string> {
  const root = resolveDataDir(dir);
  const o = odv(odvisnosti);
  const p = await predlagajUstvarjanjeTokaN8n(root, "kanal", opis, ime, o);
  const izid = await potrdiPredlogN8n(root, p.id, p.zgostitev, o);
  if (izid.stanje !== "koncano") throw new N8nNapaka(izid.razlog ?? "ustvari", izid.rezultat ?? undefined);
  return izid.rezultat ?? oblikujIzidN8n(izid, o.jezik);
}
