import { randomBytes } from "node:crypto";
import { odsifrirajSkrivnost, sifrirajSkrivnost, slotiKljucev, uporabiSlote } from "./keys.server.ts";
import {
  NAJVEC_ZIVIH,
  jePonudnikKljuca,
  javniKljucPara,
  korakRacunalnika,
  kljucPara,
  namigKljuca,
  noviParKljucev,
  novCas,
  novId,
  razlicica,
  veljavnaOznaka,
  veljavnaVrednost,
  zZice,
  zaZico,
  type Aktivni,
  type PonudnikKljuca,
  type StanjeNabora,
  type ZapisKljuca,
  type ZapisNaZici,
} from "./kljuci-mozganov.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * NALOGA-35 na racunalniku: nabor kljucev za mozgane (vec kljucev, z oznako) in izmenjava s seznanjenimi telefoni (POST /kljuci).
 * Racunalnik je zvezdisce: telefon poslje svoje neposlane spremembe, dobi celoten nabor. Vrednosti na disku sifrirane z glavnim
 * kljucem Line (kot ponudniki.json, datoteka 0600), na zici v ovojnici para (ECDH). Kljuc nikoli v dnevnik ali odgovor vmesniku.
 */
export const DATOTEKA_KLJUCEV = "kljuci-mozganov.json";

type Sifra = { iv: string; tag: string; ciphertext: string };
type ZapisNaDisku = Omit<ZapisKljuca, "vrednost"> & { sifra?: Sifra };
type Datoteka = {
  v: 1;
  jaz: string;
  zasebni: Sifra;
  javni: string;
  uvozeno: boolean;
  aktivni: Aktivni;
  zapisi: ZapisNaDisku[];
  /** id seznanjenega telefona -> javni kljuc para (SPKI), samo telefoni s seznama dovoljenih */
  telefoni: Record<string, string>;
  /** ponudniki, katerih kljuc v uporabi je bil odstranjen na drugi napravi (obvestilo do potrditve) */
  odstranjeni: PonudnikKljuca[];
};

type Stanje = { d: Datoteka; st: StanjeNabora; zasebni: string };

const aadDiska = (id: string) => `lina-kljuci-mozganov-disk-v1|${id}`;
const privzetaOznaka = (p: PonudnikKljuca) => ({ gemini: "Gemini", openai: "OpenAI", claude: "Claude", grok: "Grok", openrouter: "OpenRouter" })[p];

const vrste = new Map<string, Promise<unknown>>();
function zaporedno<T>(root: string, delo: () => Promise<T>): Promise<T> {
  const izid = (vrste.get(root) ?? Promise.resolve()).then(delo, delo);
  const rep = izid.catch(() => undefined);
  vrste.set(root, rep);
  void rep.then(() => {
    if (vrste.get(root) === rep) vrste.delete(root);
  });
  return izid;
}

async function preberi(root: string): Promise<Stanje> {
  const d = await readJsonFile<Datoteka>(root, DATOTEKA_KLJUCEV).catch(() => null);
  if (!d || d.v !== 1 || typeof d.jaz !== "string" || !d.zasebni || typeof d.javni !== "string") {
    const par = noviParKljucev();
    const nova: Datoteka = {
      v: 1,
      jaz: `r-${randomBytes(8).toString("hex")}`,
      zasebni: await sifrirajSkrivnost(par.zasebni, root, aadDiska("zasebni")),
      javni: par.javni,
      uvozeno: false,
      aktivni: {},
      zapisi: [],
      telefoni: {},
      odstranjeni: [],
    };
    return { d: nova, st: { zapisi: [], aktivni: {}, uvozeno: false }, zasebni: par.zasebni };
  }
  const zasebni = await odsifrirajSkrivnost(d.zasebni, root, aadDiska("zasebni"));
  if (!zasebni) throw new Error("Kljuca naprave za uskladitev ni mogoce prebrati.");
  const zapisi: ZapisKljuca[] = [];
  for (const z of Array.isArray(d.zapisi) ? d.zapisi : []) {
    const { sifra, ...meta } = z;
    if (meta.izbrisan) {
      zapisi.push({ ...meta, vrednost: "" });
      continue;
    }
    const vrednost = sifra ? await odsifrirajSkrivnost(sifra, root, aadDiska(meta.id)) : null;
    // neberljiv zapis (zamenjan glavni kljuc) izpade iz nabora; naslednja izmenjava ga vrne z druge naprave
    if (vrednost) zapisi.push({ ...meta, vrednost });
  }
  const aktivni: Aktivni = {};
  for (const [p, id] of Object.entries(d.aktivni ?? {})) if (jePonudnikKljuca(p) && typeof id === "string") aktivni[p] = id;
  return {
    d: { ...d, telefoni: d.telefoni ?? {}, odstranjeni: Array.isArray(d.odstranjeni) ? d.odstranjeni.filter(jePonudnikKljuca) : [] },
    st: { zapisi, aktivni, uvozeno: d.uvozeno === true },
    zasebni,
  };
}

async function zapisi(root: string, s: Stanje): Promise<void> {
  const zapisi: ZapisNaDisku[] = [];
  for (const z of s.st.zapisi) {
    const { vrednost, ...meta } = z;
    zapisi.push(z.izbrisan ? meta : { ...meta, sifra: await sifrirajSkrivnost(vrednost, root, aadDiska(z.id)) });
  }
  await writeJson(root, DATOTEKA_KLJUCEV, { ...s.d, uvozeno: s.st.uvozeno, aktivni: s.st.aktivni, zapisi } satisfies Datoteka);
}

/**
 * En korak: lastne spremembe (sloti), prejeti zapisi, uporaba v slotih. [oddaljeno] = prejeti so z druge naprave (odstranitev
 * kljuca v uporabi gre v obvestilo); lokalna dejanja vmesnika obvestila ne naredijo.
 */
async function korak(root: string, s: Stanje, prejeti: readonly ZapisKljuca[], zdaj: number, oddaljeno: boolean): Promise<Stanje> {
  const sloti = await slotiKljucev(root);
  const k = korakRacunalnika(s.st, sloti, prejeti, s.d.jaz, zdaj, privzetaOznaka);
  const spremembe: Partial<Record<PonudnikKljuca, { prej: string; novo: string | null }>> = {};
  for (const [p, novo] of Object.entries(k.uporaba.sloti) as Array<[PonudnikKljuca, string | null]>) spremembe[p] = { prej: sloti[p] ?? "", novo };
  const preskoceni = Object.keys(spremembe).length ? await uporabiSlote(spremembe, root) : [];
  // slot, ki ga je lastnik spremenil med korakom, ostane njegov: naslednji korak ga zajame kot lastno spremembo
  const aktivni = { ...k.stanje.aktivni };
  for (const p of preskoceni) {
    if (s.st.aktivni[p] !== undefined) aktivni[p] = s.st.aktivni[p];
    else delete aktivni[p];
  }
  const odstranjeni = oddaljeno ? [...new Set([...s.d.odstranjeni, ...k.uporaba.odstranjeni.filter((p) => !preskoceni.includes(p))])] : s.d.odstranjeni;
  return { ...s, d: { ...s.d, odstranjeni }, st: { ...k.stanje, aktivni } };
}

export type OdgovorKljuci = { v: 1; naprava: string; javni: string; zapisi: ZapisNaZici[] };

/**
 * POST /kljuci: [idTelefona] je ze preverjen s podpisom naprave in je na seznamu dovoljenih ([dovoljene]); javni kljuc para je del
 * podpisane vsebine. Zapisi, ki se ne odprejo z ovojnico tega para, se prezrejo. Telefoni, ki niso vec dovoljeni, izpadejo.
 */
export function izmenjajKljuce(
  idTelefona: string,
  javniTelefona: unknown,
  zapisiNaZici: readonly unknown[],
  dovoljene: ReadonlySet<string>,
  dir?: string,
  odv: { zdaj?: () => number } = {},
): Promise<OdgovorKljuci> {
  const root = resolveDataDir(dir);
  return zaporedno(root, async () => {
    if (!dovoljene.has(idTelefona)) throw new Error("ni-dovoljen");
    const javni = javniKljucPara(javniTelefona);
    if (!javni) throw new Error("oblika");
    const zdaj = (odv.zdaj ?? Date.now)();
    let s = await preberi(root);
    const kljuc = kljucPara(s.zasebni, javni, idTelefona);
    const prejeti = zapisiNaZici.slice(0, 2 * NAJVEC_ZIVIH).map((z) => zZice(z, kljuc, "telefon-racunalnik")).filter((z): z is ZapisKljuca => z !== null);
    s = await korak(root, s, prejeti, zdaj, true);
    const telefoni = Object.fromEntries(Object.entries({ ...s.d.telefoni, [idTelefona]: javniTelefona as string }).filter(([id]) => dovoljene.has(id)));
    s = { ...s, d: { ...s.d, telefoni } };
    await zapisi(root, s);
    return { v: 1, naprava: s.d.jaz, javni: s.d.javni, zapisi: s.st.zapisi.map((z) => zaZico(z, kljuc, "racunalnik-telefon")) };
  });
}

// ---- Vmesnik na racunalniku (lastnik, requireOwner v functions.ts) ------------------------------------------------------

export type KljucZaPrikaz = { id: string; ponudnik: PonudnikKljuca; oznaka: string; namig: string; naprava: string; cas: number; vUporabi: boolean };
export type PregledKljucev = { kljuci: KljucZaPrikaz[]; odstranjeni: PonudnikKljuca[] };

async function imenaNaprav(root: string): Promise<Record<string, string>> {
  const n = await readJsonFile<{ imena?: Record<string, unknown> }>(root, "asistent-telefon.json").catch(() => null);
  return Object.fromEntries(Object.entries(n?.imena ?? {}).filter((x): x is [string, string] => typeof x[1] === "string"));
}

async function pregled(root: string, s: Stanje): Promise<PregledKljucev> {
  const imena = await imenaNaprav(root);
  const kljuci = s.st.zapisi
    .filter((z) => !z.izbrisan)
    .map((z) => ({
      id: z.id,
      ponudnik: z.ponudnik,
      oznaka: z.oznaka,
      namig: namigKljuca(z.vrednost),
      // »ta racunalnik« / ime telefona / druga naprava (vmesnik prevede prazno)
      naprava: z.naprava === s.d.jaz ? "jaz" : (imena[z.naprava] ?? ""),
      cas: z.cas,
      vUporabi: s.st.aktivni[z.ponudnik] === z.id,
    }))
    .sort((a, b) => (a.ponudnik === b.ponudnik ? b.cas - a.cas : a.ponudnik < b.ponudnik ? -1 : 1));
  return { kljuci, odstranjeni: s.d.odstranjeni };
}

type Pisanje = Partial<Record<PonudnikKljuca, string | null>>;

/**
 * Dejanje vmesnika: najprej lastne spremembe (korak), nato [f] vrne novo stanje in kaj zapisati v slote TE naprave. Slot se zapise
 * neposredno (primerjaj in zamenjaj), ne prek drugega koraka - ta bi star slot razumel kot lastnikovo spremembo in obudil grob.
 */
function dejanje(dir: string | undefined, f: (s: Stanje, zdaj: number) => { s: Stanje; pisi?: Pisanje }, odv: { zdaj?: () => number } = {}): Promise<PregledKljucev> {
  const root = resolveDataDir(dir);
  return zaporedno(root, async () => {
    const zdaj = (odv.zdaj ?? Date.now)();
    const s0 = await korak(root, await preberi(root), [], zdaj, false);
    const { s, pisi } = f(s0, zdaj);
    if (pisi && Object.keys(pisi).length) {
      const sloti = await slotiKljucev(root);
      const spremembe: Partial<Record<PonudnikKljuca, { prej: string; novo: string | null }>> = {};
      for (const [p, novo] of Object.entries(pisi) as Array<[PonudnikKljuca, string | null]>) spremembe[p] = { prej: sloti[p] ?? "", novo };
      if ((await uporabiSlote(spremembe, root)).length) throw new Error("Ključ se je medtem spremenil; poskusite znova.");
    }
    await zapisi(root, s);
    return pregled(root, s);
  });
}

export function pregledKljucev(dir?: string, odv: { zdaj?: () => number } = {}): Promise<PregledKljucev> {
  return dejanje(dir, (s) => ({ s }), odv);
}

/** Nov kljuc z oznako (tudi drugi kljuc istega ponudnika). V uporabo gre samo, ce ponudnik se nima kljuca na tej napravi. */
export function dodajKljucMozganov(vhod: { ponudnik?: unknown; oznaka?: unknown; kljuc?: unknown }, dir?: string, odv: { zdaj?: () => number } = {}): Promise<PregledKljucev> {
  const p = vhod.ponudnik;
  const oznaka = typeof vhod.oznaka === "string" ? vhod.oznaka.trim() : "";
  const kljuc = typeof vhod.kljuc === "string" ? vhod.kljuc.trim() : "";
  if (!jePonudnikKljuca(p)) return Promise.reject(new Error("Ta ponudnik nima ključa za uskladitev."));
  if (!veljavnaVrednost(kljuc)) return Promise.reject(new Error("Ključ mora imeti med 8 in 400 znakov brez presledkov."));
  if (!veljavnaOznaka(oznaka)) return Promise.reject(new Error("Oznaka ima 1-40 znakov brez nadzornih znakov."));
  return dejanje(dir, (s, zdaj) => {
    if (s.st.zapisi.some((z) => z.ponudnik === p && !z.izbrisan && z.vrednost === kljuc)) throw new Error("Ta ključ je že shranjen.");
    if (s.st.zapisi.filter((z) => !z.izbrisan).length >= NAJVEC_ZIVIH) throw new Error(`Shranjenih je že ${NAJVEC_ZIVIH} ključev.`);
    const z: ZapisKljuca = { id: novId(), ponudnik: p, oznaka, cas: zdaj, naprava: s.d.jaz, izbrisan: false, prej: "", vrednost: kljuc };
    const prazen = s.st.aktivni[p] === undefined;
    return {
      s: { ...s, st: { ...s.st, zapisi: [...s.st.zapisi, z], aktivni: prazen ? { ...s.st.aktivni, [p]: z.id } : s.st.aktivni } },
      pisi: prazen ? { [p]: kljuc } : undefined,
    };
  }, odv);
}

function poisci(s: Stanje, id: unknown): ZapisKljuca {
  const z = s.st.zapisi.find((x) => x.id === id && !x.izbrisan);
  if (!z) throw new Error("Ključa ni (morda je bil odstranjen na drugi napravi).");
  return z;
}

function zamenjaj(s: Stanje, z: ZapisKljuca, n: Omit<ZapisKljuca, "cas" | "naprava" | "prej">, zdaj: number): Stanje {
  const nov: ZapisKljuca = { ...n, cas: novCas(zdaj, z.cas), naprava: s.d.jaz, prej: razlicica(z) };
  return { ...s, st: { ...s.st, zapisi: s.st.zapisi.map((x) => (x.id === z.id ? nov : x)) } };
}

/** Odstrani na vseh napravah (grob). Ce je bil v uporabi, ponudnik na tej napravi ostane brez kljuca (brez samodejnega preklopa). */
export function odstraniKljucMozganov(id: unknown, dir?: string, odv: { zdaj?: () => number } = {}): Promise<PregledKljucev> {
  return dejanje(dir, (s, zdaj) => {
    const z = poisci(s, id);
    const s1 = zamenjaj(s, z, { ...z, izbrisan: true, vrednost: "" }, zdaj);
    if (s.st.aktivni[z.ponudnik] !== z.id) return { s: s1 };
    const { [z.ponudnik]: _a, ...aktivni } = s1.st.aktivni;
    return { s: { ...s1, st: { ...s1.st, aktivni } }, pisi: { [z.ponudnik]: null } };
  }, odv);
}

export function preimenujKljucMozganov(id: unknown, oznaka: unknown, dir?: string, odv: { zdaj?: () => number } = {}): Promise<PregledKljucev> {
  const o = typeof oznaka === "string" ? oznaka.trim() : "";
  if (!veljavnaOznaka(o)) return Promise.reject(new Error("Oznaka ima 1-40 znakov brez nadzornih znakov."));
  return dejanje(dir, (s, zdaj) => {
    const z = poisci(s, id);
    return { s: zamenjaj(s, z, { ...z, oznaka: o }, zdaj) };
  }, odv);
}

/** Ta kljuc uporabi za svojega ponudnika na TEJ napravi (izbira je lokalna; drugih naprav ne spremeni). */
export function uporabiKljucMozganov(id: unknown, dir?: string, odv: { zdaj?: () => number } = {}): Promise<PregledKljucev> {
  return dejanje(dir, (s) => {
    const z = poisci(s, id);
    return { s: { ...s, st: { ...s.st, aktivni: { ...s.st.aktivni, [z.ponudnik]: z.id } } }, pisi: { [z.ponudnik]: z.vrednost } };
  }, odv);
}

export function potrdiObvestiloKljucev(dir?: string, odv: { zdaj?: () => number } = {}): Promise<PregledKljucev> {
  return dejanje(dir, (s) => ({ s: { ...s, d: { ...s.d, odstranjeni: [] } } }), odv);
}
