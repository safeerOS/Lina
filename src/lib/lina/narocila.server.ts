/**
 * Uvoz narocil iz mape, ki jo izbere lastnik (izvoz CSV/XLSX, delovni nalogi PDF/DOCX/TXT, izvozena e-posta .eml), v LOKALNI seznam
 * v mapi podatkov Line (narocila.json). Brez omrezja. Razclemba dokumentov tece v locenem procesu z mejami (dokument-izvlecek.server.ts).
 * Bere samo navadne datoteke neposredno v mapi (brez podmap in simbolnih povezav); motiv je lahko samo slika v isti mapi.
 * Imen strank ne pisemo v dnevnik.
 *
 * Dovoljenje (skupni modul 02f, dovoljenja-podobne): uvoz je dejanje vrste »narocila-uvoz« v obsegu ene KANONICNE mape. Lastnik ga
 * potrdi v Nastavitvah (seja lastnika, potrjeno === true); z izbiro »Velja tudi za vse podobne« (podobne === true) se ista mapa
 * naslednjic uvozi brez vprasanja - tudi ko jo Lina sama znova uvozi (kontrola tiska z neznanim nalogom). Podmapa, druga mapa ali
 * druga vrsta dejanja (npr. naloga agentu v isti mapi) se vprasa znova. Isti nalog iz vec virov se zdruzi: prazna polja dopolni
 * poznejsi vir, ce se z ze znanimi podatki ne bije; nasprotujoci vir se ne uporabi (»podvojeno«).
 */
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { najdiDovoljenje, zapisiDovoljenje } from "./dovoljenja-podobne.server.ts";
import { MEJE_DOKUMENTA, NapakaDokumenta, surovIzvlecek, vrstaDokumenta } from "./dokument-izvlecek.server.ts";
import type { Slika } from "./kakovost.ts";
import { kljucNaloga, kljucTocen, narocilaIzTabele, narocilaZaStevilko, narociloIzBesedila, odtisMotiva, poveziSliko, type Narocilo, type Povezava } from "./narocila.ts";
import { jeSistemskaMapa } from "./zapiski-mapa.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

export const DATOTEKA_NAROCIL = "narocila.json";
export const NAJVEC_DATOTEK = 500;
export const NAJVEC_NAROCIL = 20_000;
const SLIKA = /\.(png|jpe?g|webp)$/i;
/** Vrsta dejanja v skupnem modulu dovoljenj (obseg: { mapa } = kanonicna pot). */
export const VRSTA_UVOZA = "narocila-uvoz" as const;

export type ShranjenoNarocilo = Narocilo & { motivDatoteka?: string };
type Shramba = { posodobljeno: string; mapa: string; narocila: ShranjenoNarocilo[]; odtisi: Record<string, string> };
export type IzidUvoza = { narocila: number; preskoceno: Array<{ datoteka: string; razlog: string }>; neprepoznaneGlave: Array<{ datoteka: string; stolpci: string[] }> };

let vrsta: Promise<unknown> = Promise.resolve();
const zaporedno = <T>(f: () => Promise<T>): Promise<T> => {
  const r = vrsta.then(f, f);
  vrsta = r.catch(() => undefined);
  return r;
};

/** Telo izvozene e-poste (en del, text/plain): glave odstranjene, quoted-printable ali base64 odkodirano kot UTF-8. */
export function besediloEposte(eml: string): string {
  const meja = eml.search(/\r?\n\r?\n/);
  const glave = meja < 0 ? "" : eml.slice(0, meja);
  let telo = meja < 0 ? eml : eml.slice(meja).replace(/^\r?\n\r?\n/, "");
  const kodiranje = glave.match(/^content-transfer-encoding:\s*([\w-]+)/im)?.[1]?.toLowerCase();
  if (kodiranje === "base64") telo = Buffer.from(telo.replace(/\s+/g, ""), "base64").toString("utf8");
  if (kodiranje === "quoted-printable") {
    const s = telo.replace(/=\r?\n/g, "");
    telo = Buffer.from(s.replace(/=([0-9A-Fa-f]{2})|[^=]+|=/g, (m, h: string | undefined) => (h ? String.fromCharCode(parseInt(h, 16)) : m)), "latin1").toString("utf8");
  }
  return telo.replace(/\r\n/g, "\n").trim();
}

/** Zadeva e-poste z odkodiranimi besedami RFC 2047 (=?UTF-8?Q?...?= ali ?B?). */
function zadevaEposte(eml: string): string {
  const meja = eml.search(/\r?\n\r?\n/);
  const glave = (meja < 0 ? eml : eml.slice(0, meja)).replace(/\r?\n[ \t]+/g, " ");
  const z = glave.match(/^subject:[ \t]*(.*)$/im)?.[1] ?? "";
  return z
    .replace(/=\?([^?\s]+)\?([QqBb])\?([^?\s]*)\?=\s*(?==\?)/g, "=?$1?$2?$3?=")
    .replace(/=\?([^?\s]+)\?([QqBb])\?([^?\s]*)\?=/g, (_m, nabor: string, k: string, v: string) => {
      const b = k.toUpperCase() === "B"
        ? Buffer.from(v, "base64")
        : Buffer.from(v.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})|[^=]+|=/g, (m, h: string | undefined) => (h ? String.fromCharCode(parseInt(h, 16)) : m)), "latin1");
      try {
        return new TextDecoder(nabor.toLowerCase()).decode(b);
      } catch {
        return b.toString("utf8");
      }
    })
    .slice(0, 300);
}

/** Stevilka naloga iz zadeve (»Naročilo DN-0170«, »Re: Nalog št. 2026/44«); brez oznake in brez stevke ni stevilke. */
export function stevilkaIzZadeve(eml: string): string | null {
  const m = zadevaEposte(eml).match(/(?:^|[^\p{L}])(?:delovni\s+nalog|nalog|naro[cč]ilo|order)(?:\s*(?:št|st|no|nr)\.?)?\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{1,38})/iu);
  return m && /\d/.test(m[1]) ? m[1] : null;
}

/** Zdruzi poznejsi vir istega naloga: true = brez nasprotij (prazna polja dopolnjena), false = nasprotje (vir se ne uporabi). */
function dopolni(obst: ShranjenoNarocilo, n: Narocilo): boolean {
  const polja = ["stranka", "motiv", "kolicina", "rok"] as const;
  const prazno = (v: unknown) => v === null || v === "";
  if (polja.some((p) => !prazno(n[p]) && !prazno(obst[p]) && n[p] !== obst[p])) return false;
  for (const p of polja) if (prazno(obst[p]) && !prazno(n[p])) (obst as Record<(typeof polja)[number], unknown>)[p] = n[p];
  return true;
}

async function preberi(dir?: string): Promise<Shramba | null> {
  const s = await readJsonFile<Shramba>(resolveDataDir(dir), DATOTEKA_NAROCIL, { premakniPokvarjen: true });
  return s && Array.isArray(s.narocila) ? { ...s, odtisi: s.odtisi && typeof s.odtisi === "object" ? s.odtisi : {} } : null;
}

/**
 * N7 (1750): mapa narocil ni sistemska ali skrita (npr. ~/.ssh, ~/.config) - ne neposredno ne prek simbolne povezave. Preverba je v
 * sami funkciji uvoza, ne samo v klicatelju.
 */
async function preveriMapoNarocil(mapa: string): Promise<void> {
  const prava = await realpath(mapa).catch(() => null);
  if (!prava) throw new Error("mapa: ne obstaja ali ni mapa");
  if ([mapa, prava].some((p) => jeSistemskaMapa(p) || p.split(/[\\/]/).some((d) => d.startsWith(".")))) throw new Error("mapa: sistemska ali skrita mapa ni dovoljena");
}

export async function uvoziNarocila(mapa: string, dir?: string): Promise<IzidUvoza> {
  if (typeof mapa !== "string" || !path.isAbsolute(mapa)) throw new Error("mapa: potrebna je absolutna pot");
  const info = await lstat(mapa).catch(() => null);
  if (!info?.isDirectory()) throw new Error("mapa: ne obstaja ali ni mapa");
  await preveriMapoNarocil(mapa);
  const vnosi = (await readdir(mapa, { withFileTypes: true })).filter((v) => !v.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).slice(0, NAJVEC_DATOTEK);
  const slike = new Set(vnosi.filter((v) => v.isFile() && SLIKA.test(v.name)).map((v) => v.name));
  const izid: IzidUvoza = { narocila: 0, preskoceno: [], neprepoznaneGlave: [] };
  const po = new Map<string, ShranjenoNarocilo>();
  // N6: natancen kljuc - razlicni stevilki z istim kljucem OCR (DN-1O5, DN-105) sta dve narocili, ne »podvojeno«
  const dodaj = (n: Narocilo, datoteka: string) => {
    const k = kljucTocen(n.stevilka);
    const obst = po.get(k);
    if (obst) {
      if (!dopolni(obst, n)) izid.preskoceno.push({ datoteka, razlog: "podvojeno" });
      return;
    }
    if (po.size < NAJVEC_NAROCIL) po.set(k, { ...n });
  };
  for (const v of vnosi) {
    if (!v.isFile()) { izid.preskoceno.push({ datoteka: v.name, razlog: "ni-datoteka" }); continue; }
    if (slike.has(v.name)) continue;
    try {
      const pot = path.join(mapa, v.name);
      if ((await lstat(pot)).size > MEJE_DOKUMENTA.bajtov) throw new NapakaDokumenta("velik");
      const bajti = new Uint8Array(await readFile(pot));
      if (/\.eml$/i.test(v.name)) {
        const eml = Buffer.from(bajti).toString("utf8");
        const telo = besediloEposte(eml);
        const izZadeve = stevilkaIzZadeve(eml);
        const n = narociloIzBesedila(telo, v.name) ?? (izZadeve ? narociloIzBesedila(`Nalog: ${izZadeve}\n${telo}`, v.name) : null);
        if (n) dodaj(n, v.name); else izid.preskoceno.push({ datoteka: v.name, razlog: "brez-narocila" });
        continue;
      }
      if (!vrstaDokumenta(v.name, bajti)) throw new NapakaDokumenta("vrsta");
      const r = await surovIzvlecek(v.name, bajti);
      if (r.vrstice) {
        const t = narocilaIzTabele(r.vrstice, v.name);
        if (!t.glava) izid.neprepoznaneGlave.push({ datoteka: v.name, stolpci: t.neprepoznano });
        for (const n of t.narocila) dodaj(n, v.name);
        continue;
      }
      const n = narociloIzBesedila(r.besedilo ?? "", v.name);
      if (n) dodaj(n, v.name); else izid.preskoceno.push({ datoteka: v.name, razlog: "brez-narocila" });
    } catch (e) {
      // pdfSken = skeniran nalog brez besedila (potreben OCR)
      izid.preskoceno.push({ datoteka: v.name, razlog: e instanceof NapakaDokumenta ? e.razlog : "poskodovan" });
    }
  }
  const narocila = [...po.values()].map((n) => {
    const k = kljucTocen(n.stevilka);
    const motivDatoteka = slike.has(n.motiv) ? n.motiv : [...slike].find((s) => kljucTocen(s.replace(SLIKA, "")) === k);
    return motivDatoteka ? { ...n, motivDatoteka } : n;
  });
  izid.narocila = narocila.length;
  await zaporedno(async () => {
    const odtisi = (await preberi(dir))?.odtisi ?? {};
    await writeJson(resolveDataDir(dir), DATOTEKA_NAROCIL, { posodobljeno: new Date().toISOString(), mapa, narocila, odtisi } satisfies Shramba);
  });
  return izid;
}

/** Odtis motiva narocila (sivinska slika motiva; dekodiranje slike je pri klicatelju). Neznan nalog ali neveljavna slika = false. */
export function zapisiOdtisMotiva(stevilka: string, slika: Slika, dir?: string): Promise<boolean> {
  return zaporedno(async () => {
    const s = await preberi(dir);
    const k = kljucTocen(stevilka);
    const odtis = odtisMotiva(slika);
    if (!s || !odtis || !s.narocila.some((n) => kljucTocen(n.stevilka) === k)) return false;
    await writeJson(resolveDataDir(dir), DATOTEKA_NAROCIL, { ...s, odtisi: { ...s.odtisi, [k]: odtis } });
    return true;
  });
}

/** Povezava slike majice z narocilom: prebrana koda (QR/crtna/OCR) in/ali sivinska slika motiva. mapa = mapa vira za motivDatoteka. */
export async function poveziSlikoZNarocili(vhod: { prebrano?: string; slika?: Slika }, dir?: string): Promise<Povezava & { mapa?: string }> {
  const s = await preberi(dir);
  if (!s) return { izid: "ni" };
  const p = poveziSliko({ prebrano: vhod.prebrano, odtis: vhod.slika ? odtisMotiva(vhod.slika) : null }, s.narocila, s.odtisi);
  return { ...p, mapa: s.mapa };
}

// ---------------------------------------------------------------- uvoz z dovoljenjem (skupni modul 02f) in iskanje naloga

async function kanonicnaMapa(mapa: unknown): Promise<string> {
  if (typeof mapa !== "string" || !path.isAbsolute(mapa)) throw new Error("mapa: potrebna je absolutna pot");
  const r = await realpath(mapa).catch(() => null);
  if (!r || !(await lstat(r)).isDirectory()) throw new Error("mapa: ne obstaja ali ni mapa");
  await preveriMapoNarocil(mapa);
  return r;
}

export type UvozZDovoljenjem =
  | { stanje: "uvozeno"; mapa: string; izid: IzidUvoza; podobne: boolean }
  | { stanje: "potrebna-potrditev"; mapa: string };

/**
 * Uvoz iz Nastavitev (samo seja lastnika). Brez potrditve (potrjeno === true) samo, ce je ista kanonicna mapa ze dovoljena za podobne;
 * sicer vrne »potrebna-potrditev« in nic ne prebere. podobne === true ob potrditvi shrani dovoljenje (Nastavitve > Dovoljenja, preklic).
 */
export async function uvoziNarocilaLastnik(
  token: string | null, vhod: { mapa?: unknown; potrjeno?: unknown; podobne?: unknown }, dir?: string,
): Promise<UvozZDovoljenjem> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const mapa = await kanonicnaMapa(vhod.mapa);
  const potrjeno = vhod.potrjeno === true;
  if (!potrjeno && !(await najdiDovoljenje(root, VRSTA_UVOZA, { mapa }))) return { stanje: "potrebna-potrditev", mapa };
  const izid = await uvoziNarocila(mapa, root);
  if (potrjeno && vhod.podobne === true) await zapisiDovoljenje(root, VRSTA_UVOZA, { mapa }, { kdo: "lastnik" }).catch(() => undefined);
  return { stanje: "uvozeno", mapa, izid, podobne: !!(await najdiDovoljenje(root, VRSTA_UVOZA, { mapa }, { zabelezi: false })) };
}

/**
 * Ponovni uvoz shranjene mape na pobudo Line (brez seje lastnika): SAMO z dovoljenjem za podobne za isto kanonicno mapo.
 * Uporaba dovoljenja gre v dnevnik dovoljenj.
 */
export async function uvoziNarocilaLina(
  dir?: string,
): Promise<{ stanje: "ni-mape" } | { stanje: "potrebna-potrditev"; mapa: string } | { stanje: "uvozeno"; mapa: string; izid: IzidUvoza }> {
  const root = resolveDataDir(dir);
  const s = await preberi(root).catch(() => null);
  if (!s?.mapa) return { stanje: "ni-mape" };
  const mapa = await kanonicnaMapa(s.mapa).catch(() => null);
  if (!mapa) return { stanje: "ni-mape" };
  if (!(await najdiDovoljenje(root, VRSTA_UVOZA, { mapa }))) return { stanje: "potrebna-potrditev", mapa };
  return { stanje: "uvozeno", mapa, izid: await uvoziNarocila(mapa, root) };
}

/** Stanje za Nastavitve > Narocila podjetja (samo lastnik). */
export async function stanjeNarocil(
  token: string | null, dir?: string,
): Promise<{ mapa: string | null; posodobljeno: string | null; narocila: number; podobne: boolean }> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  const s = await preberi(root).catch(() => null);
  const podobne = s?.mapa ? !!(await najdiDovoljenje(root, VRSTA_UVOZA, { mapa: s.mapa }, { zabelezi: false })) : false;
  return { mapa: s?.mapa ?? null, posodobljeno: s?.posodobljeno ?? null, narocila: s?.narocila.length ?? 0, podobne };
}

/**
 * Narocilo za stevilko naloga, ki jo je vnesel ali prebral kontrolor: samo ENAK kljuc naloga in samo en zadetek (nikoli del stevilke,
 * vec stevilk hkrati ali podobnost motiva). Sicer null.
 */
export async function narociloZaNalog(nalog: unknown, dir?: string): Promise<ShranjenoNarocilo | null> {
  if (typeof nalog !== "string") return null;
  const k = kljucNaloga(nalog);
  if (k.length < 3) return null;
  const s = await preberi(dir).catch(() => null);
  const z = s ? narocilaZaStevilko(nalog, s.narocila) : [];
  return z.length === 1 ? z[0] : null;
}
