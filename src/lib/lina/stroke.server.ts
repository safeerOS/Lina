/**
 * Prilagodljivi kontekst - strezniska shramba (stroke.json v podatkovni mapi uporabnika, samo lokalno).
 *
 * Pravila:
 * - Privzeto VKLOPLJENO (manjkajoca datoteka = vklopljen: true; ideja lastnika 23. 11. 2026); izklopi samo izrecen false.
 * - Branje brez sledenja simbolnim povezavam (lstat + O_NOFOLLOW) in z mejo velikosti; pokvarjena datoteka = privzeto stanje;
 *   simbolna povezava ali prevelika datoteka = izklopljeno (nic se ne prepise). Atomaren zapis s pravicami 0600 (writeJson).
 * - Uci SAMO lastnikov pogovor (zabeleziPogovorLastnika) in lastnikovi dokumenti (naucIzDokumenta). Koda klicev (voice, Live,
 *   razumevanje) samo bere: odsekStrokKlic, namigiStrok. Izrazi tujih klicateljev se nikoli ne ucijo samodejno.
 * - Shranijo se izrazi, stevci in ime dokumenta; nikoli besedilo sporocila ali dokumenta.
 * - Napaka nikoli ne podre pogovora ali klica: bralne funkcije ob napaki vrnejo prazno.
 */
import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir, writeJson } from "./store.server.ts";
import {
  NAJVEC_IZRAZOV,
  NAJVEC_ZNAKOV_IZRAZA,
  NAJVEC_ZNAKOV_RAZLAGE,
  STROKE,
  NAJVEC_PREDLOGOV_NAENKRAT,
  aktivneStroke,
  dodajTockeStrok,
  izrazJeZnan,
  jeZnanaStroka,
  namigiPrepoznave,
  ocistiIzraz,
  odsekZaKlic,
  odsekZaPogovor,
  prazenStanjeStrok,
  predlogiIzBesedila,
  predlagajStroko,
  ucinkovitiSlovar,
  zabeleziUporabo,
  type StanjeStrok,
  type UporabnikovIzraz,
  type VirIzraza,
} from "./stroke.ts";

export const STROKE_DATOTEKA = "stroke.json";
const MEJA_DATOTEKE_B = 512 * 1024;
const O_VARNO_BRANJE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

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

const nizi = (v: unknown, najvec: number, dolzina: number): string[] =>
  Array.isArray(v) ? v.map((x) => ocistiIzraz(x, dolzina)).filter(Boolean).slice(0, najvec) : [];

function veljavenIzraz(x: unknown): UporabnikovIzraz | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const izraz = ocistiIzraz(o.izraz, NAJVEC_ZNAKOV_IZRAZA);
  if (!izraz || typeof o.id !== "string") return null;
  const vir = o.vir === "dokument" || o.vir === "pogovor" || o.vir === "rocno" ? o.vir : null;
  if (!vir) return null;
  return {
    id: o.id.slice(0, 120),
    izraz,
    razlaga: ocistiIzraz(o.razlaga, NAJVEC_ZNAKOV_RAZLAGE),
    sopomenke: nizi(o.sopomenke, 10, NAJVEC_ZNAKOV_IZRAZA),
    napake: nizi(o.napake, 10, NAJVEC_ZNAKOV_IZRAZA),
    stroka: typeof o.stroka === "string" ? o.stroka.slice(0, 40) : "splosno",
    vir,
    stanje: o.stanje === "potrjen" ? "potrjen" : "predlog",
    ...(typeof o.izvor === "string" && o.izvor ? { izvor: ocistiIzraz(o.izvor, 80) } : {}),
    cas: typeof o.cas === "string" ? o.cas.slice(0, 40) : "",
  };
}

function izSurovega(raw: Record<string, unknown>): StanjeStrok {
  const s = prazenStanjeStrok();
  s.vklopljen = raw.vklopljen !== false;
  s.izbrane = Array.isArray(raw.izbrane) ? [...new Set(raw.izbrane.filter(jeZnanaStroka))] : [];
  s.predlaganaStroka = jeZnanaStroka(raw.predlaganaStroka) ? raw.predlaganaStroka : null;
  if (raw.tocke && typeof raw.tocke === "object") {
    for (const [k, v] of Object.entries(raw.tocke as Record<string, unknown>)) if (jeZnanaStroka(k) && typeof v === "number" && v > 0) s.tocke[k] = Math.floor(v);
  }
  if (raw.uporaba && typeof raw.uporaba === "object") {
    for (const [k, v] of Object.entries(raw.uporaba as Record<string, unknown>)) {
      const u = v as { n?: unknown; zadnjic?: unknown } | null;
      const kl = ocistiIzraz(k, NAJVEC_ZNAKOV_IZRAZA).toLowerCase();
      if (kl && u && typeof u.n === "number" && u.n > 0) s.uporaba[kl] = { n: Math.floor(u.n), zadnjic: typeof u.zadnjic === "string" ? u.zadnjic.slice(0, 40) : "" };
    }
  }
  s.izrazi = Array.isArray(raw.izrazi) ? raw.izrazi.map(veljavenIzraz).filter((x): x is UporabnikovIzraz => x !== null).slice(-NAJVEC_IZRAZOV) : [];
  s.skriti = nizi(raw.skriti, 500, NAJVEC_ZNAKOV_IZRAZA).map((x) => x.toLowerCase());
  s.zavrnjeni = nizi(raw.zavrnjeni, 1000, NAJVEC_ZNAKOV_IZRAZA).map((x) => x.toLowerCase());
  return s;
}

function izklopljeno(): StanjeStrok {
  return { ...prazenStanjeStrok(), vklopljen: false };
}

async function preberi(root: string): Promise<StanjeStrok> {
  const pot = path.join(root, STROKE_DATOTEKA);
  let st;
  try {
    st = await lstat(pot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return prazenStanjeStrok();
    throw e;
  }
  if (!st.isFile() || st.size > MEJA_DATOTEKE_B) return izklopljeno();
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch {
    return izklopljeno();
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile() || st2.size > MEJA_DATOTEKE_B) return izklopljeno();
    const buf = Buffer.allocUnsafe(st2.size);
    const { bytesRead } = await h.read(buf, 0, st2.size, 0);
    const raw = JSON.parse(buf.subarray(0, bytesRead).toString("utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return prazenStanjeStrok();
    return izSurovega(raw as Record<string, unknown>);
  } catch {
    return prazenStanjeStrok();
  } finally {
    await h.close().catch(() => undefined);
  }
}

/** Zapis, ki ne povozi simbolne povezave ali neveljavne datoteke (te ostanejo, kot so, in stanje je izklopljeno). */
async function spremeni(root: string, f: (s: StanjeStrok) => StanjeStrok | null): Promise<StanjeStrok> {
  return vVrsti(root, async () => {
    const st = await lstat(path.join(root, STROKE_DATOTEKA)).catch(() => null);
    if (st && (!st.isFile() || st.size > MEJA_DATOTEKE_B)) return izklopljeno();
    const prej = await preberi(root);
    const nov = f(prej);
    if (!nov || nov === prej) return prej;
    await writeJson(root, STROKE_DATOTEKA, nov);
    return nov;
  });
}

export async function preberiStanjeStrok(dir?: string): Promise<StanjeStrok> {
  return preberi(resolveDataDir(dir));
}

export async function nastaviPrilagodljiviKontekst(vklopljen: boolean, dir?: string): Promise<StanjeStrok> {
  return spremeni(resolveDataDir(dir), (s) => ({ ...s, vklopljen: vklopljen === true }));
}

/** Uporabnik izbere ali odstrani stroko (samo kljuci iz vgrajenih strok). */
export async function izberiStroko(kljuc: string, izbrana: boolean, dir?: string): Promise<StanjeStrok> {
  if (!jeZnanaStroka(kljuc)) return preberiStanjeStrok(dir);
  return spremeni(resolveDataDir(dir), (s) => ({ ...s, izbrane: izbrana ? [...new Set([...s.izbrane, kljuc])] : s.izbrane.filter((k) => k !== kljuc) }));
}

function dodajPredloge(s: StanjeStrok, novi: UporabnikovIzraz[]): StanjeStrok {
  if (!novi.length) return s;
  return { ...s, izrazi: [...s.izrazi, ...novi].slice(-NAJVEC_IZRAZOV) };
}

/** Lastnikov pogovor: raba izrazov, tocke strok in predlogi »X pomeni Y«. Samo za lastnika, nikoli za klic. */
export async function zabeleziPogovorLastnika(dir: string | undefined, besedilo: string, zdaj: Date = new Date()): Promise<void> {
  try {
    await spremeni(resolveDataDir(dir), (s) => {
      if (!s.vklopljen) return null;
      const z = zabeleziUporabo(s, besedilo, zdaj);
      const novi = predlogiIzBesedila(besedilo, z, { vir: "pogovor" }, zdaj);
      if (z === s && !novi.length) return null;
      return dodajPredloge(z, novi);
    });
  } catch {
    // ucenje nikoli ne podre pogovora
  }
}

/** Dokument: stroka iz vzorca, predlogi iz najvec toliko znakov, v kosih (zanka dogodkov ne sme stati; znanje-datoteke.test.ts, meja 250 ms). */
export const DOKUMENT_VZOREC_STROKE = 20_000;
export const DOKUMENT_NAJVEC_ZNAKOV = 200_000;
const DOKUMENT_KOS = 8_000;

/**
 * Dokument, ki ga lastnik da Lini (priponka ali vir Znanja): predlaga stroko in nove izraze z imenom vira. Rabe izrazov NE steje
 * (raba = kar lastnik sam govori). Iskanje tece v kosih z odmori, sele nato kratek zapis v vrsti.
 */
export async function naucIzDokumenta(dir: string | undefined, ime: string, besedilo: string, zdaj: Date = new Date()): Promise<{ novih: number; stroka: string | null }> {
  try {
    const root = resolveDataDir(dir);
    const zacetno = await preberi(root);
    if (!zacetno.vklopljen) return { novih: 0, stroka: null };
    const vzorec = besedilo.slice(0, DOKUMENT_VZOREC_STROKE);
    const stroka = aktivneStroke(dodajTockeStrok(zacetno, vzorec))[0] ?? predlagajStroko(vzorec)?.kljuc ?? null;
    const kandidati: UporabnikovIzraz[] = [];
    let zacasno: StanjeStrok = zacetno;
    const vse = besedilo.slice(0, DOKUMENT_NAJVEC_ZNAKOV);
    for (let od = 0; od < vse.length && kandidati.length < NAJVEC_PREDLOGOV_NAENKRAT; ) {
      let do_ = Math.min(vse.length, od + DOKUMENT_KOS);
      const nl = vse.lastIndexOf("\n", do_);
      if (do_ < vse.length && nl > od) do_ = nl + 1;
      const novi = predlogiIzBesedila(vse.slice(od, do_), zacasno, { vir: "dokument", izvor: ime, ...(stroka ? { stroka } : {}) }, zdaj).slice(0, NAJVEC_PREDLOGOV_NAENKRAT - kandidati.length);
      kandidati.push(...novi);
      zacasno = { ...zacasno, izrazi: [...zacasno.izrazi, ...novi] };
      od = do_;
      await new Promise<void>((r) => setImmediate(r));
    }
    let novih = 0;
    await spremeni(root, (s) => {
      if (!s.vklopljen) return null;
      const ze = new Set([...s.izrazi.map((i) => i.izraz.toLowerCase()), ...s.zavrnjeni]);
      const novi = kandidati.filter((k) => !ze.has(k.izraz.toLowerCase()));
      novih = novi.length;
      const z = dodajTockeStrok(s, vzorec);
      return z === s && !novi.length ? null : dodajPredloge(z, novi);
    });
    if (novih) console.info(`lina stroke: novih_predlogov=${novih}`);
    return { novih, stroka };
  } catch {
    return { novih: 0, stroka: null };
  }
}

export async function potrdiIzraz(id: string, dir?: string): Promise<StanjeStrok> {
  return spremeni(resolveDataDir(dir), (s) => {
    if (!s.izrazi.some((i) => i.id === id && i.stanje === "predlog")) return null;
    return { ...s, izrazi: s.izrazi.map((i) => (i.id === id ? { ...i, stanje: "potrjen" as const } : i)) };
  });
}

/** Izbris: lastnikov izraz se odstrani (in se ne predlaga znova), vgrajeni se skrije. Raba izraza se pozabi. */
export async function izbrisiIzraz(izraz: string, dir?: string): Promise<StanjeStrok> {
  const kl = izraz.trim().toLowerCase();
  if (!kl) return preberiStanjeStrok(dir);
  return spremeni(resolveDataDir(dir), (s) => {
    const uporaba = { ...s.uporaba };
    delete uporaba[kl];
    const lastni = s.izrazi.some((i) => i.izraz.toLowerCase() === kl);
    const vgrajen = STROKE.some((x) => x.izrazi.some((i) => i.izraz.toLowerCase() === kl));
    if (!lastni && !vgrajen) return null;
    return {
      ...s,
      uporaba,
      izrazi: s.izrazi.filter((i) => i.izraz.toLowerCase() !== kl),
      zavrnjeni: lastni ? [...new Set([...s.zavrnjeni, kl])] : s.zavrnjeni,
      skriti: vgrajen ? [...new Set([...s.skriti, kl])] : s.skriti,
    };
  });
}

/** Rocno dodan izraz (Nastavitve): takoj potrjen; lastnik ga pozna. */
export async function dodajIzraz(
  izraz: string,
  razlaga: string,
  dir?: string,
  zdaj: Date = new Date(),
): Promise<{ ok: true; stanje: StanjeStrok } | { ok: false; razlog: "prazno" | "zasebno" | "polno" }> {
  const c = ocistiIzraz(izraz, NAJVEC_ZNAKOV_IZRAZA);
  if (!c) return { ok: false, razlog: typeof izraz === "string" && izraz.trim() ? "zasebno" : "prazno" };
  if (typeof razlaga === "string" && razlaga.trim() && !ocistiIzraz(razlaga, NAJVEC_ZNAKOV_RAZLAGE)) return { ok: false, razlog: "zasebno" };
  let polno = false;
  const stanje = await spremeni(resolveDataDir(dir), (s) => {
    const kl = c.toLowerCase();
    if (s.izrazi.length >= NAJVEC_IZRAZOV && !s.izrazi.some((i) => i.izraz.toLowerCase() === kl)) {
      polno = true;
      return null;
    }
    const nov: UporabnikovIzraz = {
      id: `r-${kl.replace(/[^\p{L}\p{N}]+/gu, "-")}`,
      izraz: c,
      razlaga: ocistiIzraz(razlaga, NAJVEC_ZNAKOV_RAZLAGE),
      sopomenke: [],
      napake: [],
      stroka: aktivneStroke(s)[0] ?? "splosno",
      vir: "rocno",
      stanje: "potrjen",
      cas: zdaj.toISOString(),
    };
    return {
      ...s,
      izrazi: [...s.izrazi.filter((i) => i.izraz.toLowerCase() !== kl), nov],
      zavrnjeni: s.zavrnjeni.filter((z) => z !== kl),
      skriti: s.skriti.filter((z) => z !== kl),
    };
  });
  return polno ? { ok: false, razlog: "polno" } : { ok: true, stanje };
}

/** Pozabi vse: izbrise stroke.json (izbire, rabo, izraze). Stikalo se vrne na privzeto (vklopljeno). */
export async function pozabiVseStroke(dir?: string): Promise<void> {
  const root = resolveDataDir(dir);
  await vVrsti(root, async () => {
    await unlink(path.join(root, STROKE_DATOTEKA)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  });
}

export async function odsekStrokPogovor(dir: string | undefined, besedilo: string): Promise<string> {
  try {
    return odsekZaPogovor(await preberiStanjeStrok(dir), besedilo);
  } catch {
    return "";
  }
}

export async function odsekStrokKlic(dir: string | undefined, izrek = ""): Promise<string> {
  try {
    return odsekZaKlic(await preberiStanjeStrok(dir), izrek);
  } catch {
    return "";
  }
}

export async function namigiStrok(dir?: string, najvec = 100): Promise<string[]> {
  try {
    return namigiPrepoznave(await preberiStanjeStrok(dir), najvec);
  } catch {
    return [];
  }
}

export type PogledStrok = {
  vklopljen: boolean;
  predlaganaStroka: string | null;
  stroke: Array<{ kljuc: string; ime: { sl: string; en: string }; izbrana: boolean; predlagana: boolean; izrazov: number }>;
  izrazi: Array<{ id?: string; izraz: string; razlaga: string; stroka: string; vir: VirIzraza; predlog: boolean; n: number; znano: boolean; izvor?: string }>;
  skritih: number;
};

/** Vse, kar je Lina naucila ali uporablja, za Nastavitve (vidno tudi ob izklopljenem stikalu). */
export async function pogledStrok(dir?: string): Promise<PogledStrok> {
  const s = await preberiStanjeStrok(dir);
  return {
    vklopljen: s.vklopljen,
    predlaganaStroka: s.predlaganaStroka,
    stroke: STROKE.map((x) => ({ kljuc: x.kljuc, ime: x.ime, izbrana: s.izbrane.includes(x.kljuc), predlagana: s.predlaganaStroka === x.kljuc, izrazov: x.izrazi.length })),
    izrazi: ucinkovitiSlovar(s, { tudiIzklopljen: true }).map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      izraz: v.izraz,
      razlaga: v.razlaga,
      stroka: v.stroka,
      vir: v.vir,
      predlog: v.predlog,
      n: s.uporaba[v.izraz.toLowerCase()]?.n ?? 0,
      znano: izrazJeZnan(s, v.izraz),
      ...(v.izvor ? { izvor: v.izvor } : {}),
    })),
    skritih: s.skriti.length,
  };
}
