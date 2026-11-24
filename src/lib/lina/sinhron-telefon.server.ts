import { createHash, randomBytes } from "node:crypto";
import { MEJA_SPOROCIL, vVrstiPogovora, type SporociloAsistenta } from "./asistent-pogovor.server.ts";
import { nastaviNavodilaIzTelefona } from "./pravila.server.ts";
import { praviUnicode } from "./kanal-claude.ts";
import { MEJA_DOBESEDNO } from "./dobesedno-meja.ts";
import { SEJA_ASISTENTA } from "./spomin-pogovor.server.ts";
import { zapisiObrat } from "./spomin-baza.server.ts";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";

/**
 * Sinhronizacija telefona z racunalnikom (lastnik 20. 11. 2026): zapisi klicev (ime, stevilka, podjetje, sporocilo), pogovor in
 * navodila lastnika. Racunalnik steje REVIZIJE (po zgledu Codync: vsaka sprememba dobi narascajoco stevilko, naprava se po
 * ponovni povezavi nadaljuje od zadnje, ki jo pozna): ni primerjanja ur in ni izgube ob prekinitvi. Zapisi klicev so nespremenljivi
 * (isti id = isti zapis), zato dvojnikov ni.
 */
export const DATOTEKA_SINHRON = "sinhron-telefon.json";
export const MEJA_KLICEV = 1000;
export const MEJA_ODGOVORA = 300;
/** Odgovor telefona sme imeti najvec 64 KiB (AsistentProtokol.NAJVEC_ODGOVORA): vnosi se dodajajo do te meje, ostalo v naslednjem krogu. */
export const MEJA_ODGOVORA_B = 48 * 1024;
export const MEJA_BESEDILA = 2000;
export { MEJA_DOBESEDNO };
export const MEJA_NAVODIL = 1500;
export const MEJA_VNOSOV_ZAHTEVE = 300;
const ID_KLICA = /^[A-Za-z0-9._-]{1,80}$/;

export type KlicSinhron = {
  id: string;
  casZacetka: number;
  stevilka: string;
  trajanjeS: number;
  nujno: boolean;
  povzetek: string;
  nacin: "osebna" | "podjetje";
  klicatelj: string;
  podjetje: string;
  sporocilo: string;
  sporociloDobesedno: string;
  brezSporocilaRazlog: string;
};
export type PogovorSinhron = { vloga: "lastnik" | "lina"; besedilo: string; cas: string };
export type NavodilaSinhron = { besedilo: string; cas: number };

type Stanje = {
  /** Nakljucni id stanja: ce se stanje na racunalniku ponastavi, telefon opazi novo epoho in zacne pri reviziji 0. */
  epoha: string;
  rev: number;
  klici: Array<{ rev: number; k: KlicSinhron }>;
  pogovor: Array<{ rev: number; id: string; p: PogovorSinhron }>;
  navodila: { rev: number; n: NavodilaSinhron } | null;
};

export type ZahtevaSinhron = { rev: number; epoha?: string; klici: KlicSinhron[]; pogovor: PogovorSinhron[]; navodila: NavodilaSinhron | null };
export type OdgovorSinhron = {
  epoha: string;
  rev: number;
  klici: KlicSinhron[];
  pogovor: PogovorSinhron[];
  navodila: NavodilaSinhron | null;
  /** true = je se novejsih vnosov od meje enega odgovora: naprava naj takoj poizve znova od vrnjene revizije. */
  ostane: boolean;
};

export class NapakaSinhron extends Error {}

const prazno = (): Stanje => ({ epoha: randomBytes(8).toString("hex"), rev: 0, klici: [], pogovor: [], navodila: null });

function besedilo(v: unknown, meja: number, ime: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > meja || !praviUnicode(v)) throw new NapakaSinhron(`Polje ${ime} ni veljavno besedilo do ${meja} znakov.`);
  return v;
}

export function preveriKlic(v: unknown): KlicSinhron {
  if (!v || typeof v !== "object") throw new NapakaSinhron("Zapis klica ni objekt.");
  const o = v as Record<string, unknown>;
  const id = besedilo(o.id, 80, "id");
  if (!ID_KLICA.test(id)) throw new NapakaSinhron("Neveljaven id klica.");
  const cas = o.casZacetka;
  const trajanje = o.trajanjeS;
  if (!Number.isSafeInteger(cas) || (cas as number) < 0 || !Number.isSafeInteger(trajanje) || (trajanje as number) < 0) throw new NapakaSinhron("Neveljaven cas ali trajanje klica.");
  const stevilka = besedilo(o.stevilka, 60, "stevilka");
  if (!stevilka.trim()) throw new NapakaSinhron("Stevilka klica je prazna.");
  return {
    id,
    casZacetka: cas as number,
    stevilka,
    trajanjeS: trajanje as number,
    nujno: o.nujno === true,
    povzetek: besedilo(o.povzetek, MEJA_BESEDILA, "povzetek"),
    nacin: o.nacin === "podjetje" ? "podjetje" : "osebna",
    klicatelj: besedilo(o.klicatelj, 240, "klicatelj"),
    podjetje: besedilo(o.podjetje, 240, "podjetje"),
    sporocilo: besedilo(o.sporocilo, MEJA_BESEDILA, "sporocilo"),
    sporociloDobesedno: besedilo(o.sporociloDobesedno, MEJA_DOBESEDNO, "sporociloDobesedno"),
    brezSporocilaRazlog: besedilo(o.brezSporocilaRazlog, MEJA_BESEDILA, "brezSporocilaRazlog"),
  };
}

export function preveriPogovor(v: unknown): PogovorSinhron {
  if (!v || typeof v !== "object") throw new NapakaSinhron("Sporocilo pogovora ni objekt.");
  const o = v as Record<string, unknown>;
  if (o.vloga !== "lastnik" && o.vloga !== "lina") throw new NapakaSinhron("Neveljavna vloga sporocila.");
  const b = besedilo(o.besedilo, MEJA_BESEDILA, "besedilo");
  const cas = besedilo(o.cas, 40, "cas");
  if (!b.trim() || Number.isNaN(Date.parse(cas))) throw new NapakaSinhron("Sporocilo pogovora je prazno ali brez veljavnega casa.");
  return { vloga: o.vloga, besedilo: b, cas };
}

export function preveriZahtevo(v: unknown): ZahtevaSinhron {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new NapakaSinhron("Vsebina ni objekt.");
  const o = v as Record<string, unknown>;
  const rev = o.rev === undefined ? 0 : o.rev;
  if (!Number.isSafeInteger(rev) || (rev as number) < 0) throw new NapakaSinhron("Neveljavna revizija.");
  const sez = (x: unknown, ime: string): unknown[] => {
    if (x === undefined) return [];
    if (!Array.isArray(x) || x.length > MEJA_VNOSOV_ZAHTEVE) throw new NapakaSinhron(`Seznam ${ime} je neveljaven ali predolg.`);
    return x;
  };
  let navodila: NavodilaSinhron | null = null;
  if (o.navodila !== undefined && o.navodila !== null) {
    const n = o.navodila as Record<string, unknown>;
    if (typeof n !== "object" || !Number.isSafeInteger(n.cas) || (n.cas as number) < 0) throw new NapakaSinhron("Neveljavna navodila.");
    navodila = { besedilo: besedilo(n.besedilo, MEJA_NAVODIL, "navodila").trim(), cas: n.cas as number };
  }
  return {
    rev: rev as number,
    epoha: typeof o.epoha === "string" && /^[0-9a-f]{16}$/.test(o.epoha) ? o.epoha : undefined,
    // Posamezen neveljaven vnos se PRESKOCI (ne zavrne cele zahteve): zastrupljen zapis ne sme za vedno zatakniti sinhronizacije.
    klici: sez(o.klici, "klici").flatMap((k) => { try { return [preveriKlic(k)]; } catch { return []; } }),
    pogovor: sez(o.pogovor, "pogovor").flatMap((p) => { try { return [preveriPogovor(p)]; } catch { return []; } }),
    navodila,
  };
}

/** Id sporocila pogovora: ista vloga, cas in besedilo = isto sporocilo (brez dvojnikov med napravama). */
export function idPogovora(p: PogovorSinhron): string {
  return createHash("sha256").update(`${p.vloga}\n${p.cas}\n${p.besedilo}`).digest("hex").slice(0, 24);
}

let vrsta: Promise<unknown> = Promise.resolve();
/** Zapisi stanja se izvajajo drug za drugim (dva telefona ob istem casu ne smeta izgubiti revizij). */
function zaporedno<T>(f: () => Promise<T>): Promise<T> {
  const r = vrsta.then(f, f);
  vrsta = r.catch(() => undefined);
  return r;
}

async function preberiStanje(root: string): Promise<Stanje> {
  let s: Stanje | null;
  try {
    s = await readJsonFile<Stanje>(root, DATOTEKA_SINHRON);
  } catch {
    // vsebine datoteke (stevilke, imena) ne smemo izpisati v dnevnik napake
    throw new Error(`${DATOTEKA_SINHRON} ni berljiva.`);
  }
  if (!s || typeof s !== "object" || !Number.isSafeInteger(s.rev) || !Array.isArray(s.klici) || !Array.isArray(s.pogovor)) return prazno();
  return { epoha: typeof s.epoha === "string" && /^[0-9a-f]{16}$/.test(s.epoha) ? s.epoha : randomBytes(8).toString("hex"), rev: s.rev, klici: s.klici, pogovor: s.pogovor, navodila: s.navodila ?? null };
}

/** Izmenja zapise: sprejme, kar je novega od naprave, vrne vse z revizijo nad `zahteva.rev`. */
export function izmenjajSinhron(zahteva: ZahtevaSinhron, dir?: string): Promise<OdgovorSinhron> {
  const root = resolveDataDir(dir);
  return zaporedno(async () => {
    const st = await preberiStanje(root);
    let sprememba = false;
    // Telefon pozna drugo epoho (stanje na racunalniku je bilo ponastavljeno): vse novejse od 0, telefon si zapomni novo epoho.
    const revTelefona = zahteva.epoha !== undefined && zahteva.epoha !== st.epoha ? 0 : zahteva.rev;
    const znaniKlici = new Set(st.klici.map((x) => x.k.id));
    for (const k of zahteva.klici) {
      if (znaniKlici.has(k.id)) continue;
      st.rev += 1;
      st.klici.push({ rev: st.rev, k });
      znaniKlici.add(k.id);
      sprememba = true;
    }
    if (st.klici.length > MEJA_KLICEV) st.klici = st.klici.slice(-MEJA_KLICEV);

    const znaniPogovor = new Set(st.pogovor.map((x) => x.id));
    const dodajPogovor = (p: PogovorSinhron): boolean => {
      const id = idPogovora(p);
      if (znaniPogovor.has(id)) return false;
      st.rev += 1;
      st.pogovor.push({ rev: st.rev, id, p });
      znaniPogovor.add(id);
      sprememba = true;
      return true;
    };
    // Pogovor na racunalniku (asistent.json) gre k telefonu, pogovor s telefona na racunalnik: skupen pogovor.
    // Branje in zapis asistent.json v skupni vrsti pogovora (pregled 0225 B5): vmesni zapis pogovora ali sporocila o gradnji se ne izgubi.
    const noviIzTelefona: PogovorSinhron[] = [];
    await vVrstiPogovora(root, async () => {
      const lokalni = await readJsonFile<SporociloAsistenta[]>(root, "asistent.json");
      for (const s of Array.isArray(lokalni) ? lokalni : []) {
        try {
          dodajPogovor(preveriPogovor({ vloga: s.vloga, besedilo: String(s.besedilo).slice(0, MEJA_BESEDILA), cas: s.cas }));
        } catch {
          // pokvarjen vnos na racunalniku se preskoci, sinhronizacija ne odpove
        }
      }
      const najstarejsi = st.pogovor.length >= MEJA_SPOROCIL ? Math.min(...st.pogovor.map((x) => Date.parse(x.p.cas))) : -Infinity;
      // Spomin pogovorov (22. 11. 2026: Lina dela tudi brez racunalnika): sporocila, ki so s telefona prisla NA NOVO, gredo tudi v spomin
      // racunalnika (spomin.sqlite); racunalniska sporocila je zapisal ze asistentPogovor, zato jih tu ne podvajamo.
      for (const p of zahteva.pogovor) if (Date.parse(p.cas) >= najstarejsi && dodajPogovor(p)) noviIzTelefona.push(p);
      st.pogovor.sort((a, b) => Date.parse(a.p.cas) - Date.parse(b.p.cas) || a.rev - b.rev);
      if (st.pogovor.length > MEJA_SPOROCIL) st.pogovor = st.pogovor.slice(-MEJA_SPOROCIL);

      const n = zahteva.navodila;
      if (n && (!st.navodila || n.cas > st.navodila.n.cas)) {
        if (await nastaviNavodilaIzTelefona(n.besedilo, root)) {
          st.rev += 1;
          st.navodila = { rev: st.rev, n };
          sprememba = true;
        }
      }

      if (sprememba) await writeJson(root, DATOTEKA_SINHRON, st);
      // Racunalniski pogovor dobi sporocila s telefona (zadnjih MEJA_SPOROCIL, po casu). Preverimo tudi brez spremembe,
      // da neuspel prejsnji zapis asistent.json ob ponovnem poskusu popravimo (brez nove revizije).
      const zeljen = st.pogovor.map((x) => x.p);
      if (sprememba || JSON.stringify(Array.isArray(lokalni) ? lokalni : []) !== JSON.stringify(zeljen)) await writeJson(root, "asistent.json", zeljen);
    });
    for (const p of noviIzTelefona) {
      try {
        await zapisiObrat({ seja: SEJA_ASISTENTA, vloga: p.vloga === "lina" ? "lina" : "uporabnik", besedilo: p.besedilo, cas: p.cas }, { dir: root });
      } catch {
        // napaka spomina ne podre sinhronizacije
      }
    }

    type Vnos = { rev: number; k?: KlicSinhron; p?: PogovorSinhron; n?: NavodilaSinhron };
    const vnosi: Vnos[] = [
      ...st.klici.filter((x) => x.rev > revTelefona).map((x) => ({ rev: x.rev, k: x.k })),
      ...st.pogovor.filter((x) => x.rev > revTelefona).map((x) => ({ rev: x.rev, p: x.p })),
      ...(st.navodila && st.navodila.rev > revTelefona ? [{ rev: st.navodila.rev, n: st.navodila.n }] : []),
    ].sort((a, b) => a.rev - b.rev);
    const vzeti: Vnos[] = [];
    let bajti = 512;
    for (const v of vnosi) {
      const velikost = Buffer.byteLength(JSON.stringify(v.k ?? v.p ?? v.n), "utf8") + 2;
      if (vzeti.length >= MEJA_ODGOVORA || (vzeti.length > 0 && bajti + velikost > MEJA_ODGOVORA_B)) break;
      vzeti.push(v);
      bajti += velikost;
    }
    const ostane = vnosi.length > vzeti.length;
    return {
      epoha: st.epoha,
      rev: ostane ? vzeti[vzeti.length - 1].rev : st.rev,
      klici: vzeti.flatMap((x) => (x.k ? [x.k] : [])),
      pogovor: vzeti.flatMap((x) => (x.p ? [x.p] : [])),
      navodila: vzeti.find((x) => x.n)?.n ?? null,
      ostane,
    };
  });
}
