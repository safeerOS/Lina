/**
 * Reverzibilno stiskanje velikih izhodov orodij pred modelom (JSON, dnevniki, porocila agentov).
 * Ideja: Headroom CCR - Cache-Content-Retrieve (headroomlabs-ai/headroom, Apache-2.0); lastna koda po ideji.
 *
 * Pravila (lastnik 24. 11. 2026 + sprememba vodje):
 * - Privzeto VKLOPLJENO s stikalom (stiskanje-izhodov.json; manjkajoca datoteka = true; izklopi samo izrecni false).
 * - Stiska se SAMO vsebina za ponudnika, ki ga je uporabnik ze izbral - nic se nikoli ne poslje drugam.
 * - Izvirnik ostane shranjen LOKALNO (pravice 0600, brez sledenja simbolnim povezavam) in ga model lahko priklice po kljucu
 *   [[priklic-izvirnika: <kljuc>]] (reverzibilno).
 * - Skrivnosti (jeSkrivnost) se NE zapisujejo na disk v cistem besedilu (shranijo se samo v pomnilnisko shrambo seje ali brez zapisa).
 * - Tajnica (klici) te datoteke ne uvaza.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir, writeJson } from "./store.server.ts";

/** Prepozna prave skrivnosti (zasebni kljuci, API kljuci, zetoni, dodelitve gesel) brez laznih zadetkov na besedi »kljuc: Tip«. */
export function imaSkrivnostIzhoda(s: string): boolean {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) return true;
  if (/\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}/.test(s) || /github_pat_[A-Za-z0-9_]{20,}/.test(s)) return true;
  if (/\bAIza[0-9A-Za-z_-]{20,}/.test(s) || /\bAKIA[0-9A-Z]{12,}/.test(s)) return true;
  if (/\bsk-[A-Za-z0-9_-]{16,}/.test(s) || /\bxox[abprs]-[A-Za-z0-9-]{8,}/.test(s)) return true;
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i.test(s) || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(s)) return true;
  if (/\b(?:api[ _-]?key|apikey|password|passwd|secret|access[ _-]?token|auth[ _-]?token)\b\s*(?:=|:)\s*["']?\S{6,}/i.test(s)) return true;
  if (/\bgeslo\b\s*(?:je|=|:)\s*(?=\S*\d)\S{4,}/i.test(s)) return true;
  return false;
}

export const STISKANJE_NASTAVITVE = "stiskanje-izhodov.json";
export const CCR_MAPA = "stiskanje-ccr";
export const PRIVZETI_PRAG_ZNAKOV = 1200;
export const PRIVZETA_MEJA_POVZETKA = 900;
const NAJVEC_ZAPISOV_NA_DISKU = 64;
const NAJVEC_BAJTOV_IZVIRNIKA = 2 * 1024 * 1024;
const MEJA_NASTAVITEV_B = 4096;
const O_VARNO_BRANJE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const VELJAVEN_KLJUC = /^[a-f0-9]{12,32}$/;

export type VrstaIzhoda = "json" | "dnevnik" | "porocilo";

export interface ShrambaIzvirnikov {
  shrani(kljuc: string, izvirnik: string): Promise<boolean>;
  preberi(kljuc: string): Promise<string | null>;
}

export type StisniMoznosti = {
  /** Mapa podatkov za lokalno CCR shrambo in stikalo. */
  dir?: string;
  /** Lastna shramba (npr. pomnilniska v preizkusih ali eni seji). */
  shramba?: ShrambaIzvirnikov;
  /** Izrecni vklop/izklop; ce ni podan, bere stiskanje-izhodov.json (privzeto true). */
  vklopljen?: boolean;
  /** Najmanjsa dolzina izhoda za stiskanje (privzeto 1200 znakov). */
  pragZnakov?: number;
  /** Ciljna zgornja meja povzetka brez oznake kljuca (privzeto 900 znakov). */
  mejaPovzetka?: number;
  /** Izrecna vrsta izhoda; sicer se zazna samodejno. */
  vrsta?: VrstaIzhoda;
};

export type RezultatStiskanja = {
  stisnjeno: boolean;
  vrsta: VrstaIzhoda;
  besedilo: string;
  kljuc: string | null;
  izvirnikZnakov: number;
  stisnjenoZnakov: number;
  prihranekZnakov: number;
  prihranekOdstotek: number;
  shranjenIzvirnik: boolean;
};

/** Cista pomnilniska CCR shramba (omejena z LRU po stevilu zapisov). */
export function pomnilniskaShramba(najvecZapisov = 64): ShrambaIzvirnikov {
  const m = new Map<string, string>();
  return {
    async shrani(kljuc, izvirnik) {
      if (!VELJAVEN_KLJUC.test(kljuc) || izvirnik.length > NAJVEC_BAJTOV_IZVIRNIKA) return false;
      m.delete(kljuc);
      m.set(kljuc, izvirnik);
      while (m.size > najvecZapisov) {
        const prvi = m.keys().next().value as string | undefined;
        if (prvi === undefined) break;
        m.delete(prvi);
      }
      return true;
    },
    async preberi(kljuc) {
      if (!VELJAVEN_KLJUC.test(kljuc)) return null;
      return m.get(kljuc) ?? null;
    },
  };
}

/** Lokalna CCR shramba na disku (podmapa stiskanje-ccr z 0700/0600, brez sledenja simbolnim povezavam). */
export function lokalnaShramba(dir?: string): ShrambaIzvirnikov {
  const mapa = path.join(resolveDataDir(dir), CCR_MAPA);
  return {
    async shrani(kljuc, izvirnik) {
      if (!VELJAVEN_KLJUC.test(kljuc)) return false;
      if (Buffer.byteLength(izvirnik, "utf8") > NAJVEC_BAJTOV_IZVIRNIKA) return false;
      // Skrivnosti se na disk v cistem besedilu ne zapisujejo.
      if (imaSkrivnostIzhoda(izvirnik)) return false;
      await mkdir(mapa, { recursive: true, mode: 0o700 });
      const cilj = path.join(mapa, `${kljuc}.txt`);
      try {
        const st = await lstat(cilj);
        if (!st.isFile()) return false;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") return false;
      }
      await writeFile(cilj, izvirnik, { mode: 0o600 });
      await obreziLokalnoShrambo(mapa);
      return true;
    },
    async preberi(kljuc) {
      if (!VELJAVEN_KLJUC.test(kljuc)) return null;
      const cilj = path.join(mapa, `${kljuc}.txt`);
      let h;
      try {
        const st0 = await lstat(cilj);
        if (!st0.isFile() || st0.size > NAJVEC_BAJTOV_IZVIRNIKA) return null;
        h = await open(cilj, O_VARNO_BRANJE);
      } catch {
        return null;
      }
      try {
        const st = await h.stat();
        if (!st.isFile() || st.size > NAJVEC_BAJTOV_IZVIRNIKA) return null;
        const buf = Buffer.allocUnsafe(st.size);
        const { bytesRead } = await h.read(buf, 0, st.size, 0);
        return buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await h.close().catch(() => undefined);
      }
    },
  };
}

async function obreziLokalnoShrambo(mapa: string): Promise<void> {
  try {
    const imena = (await readdir(mapa)).filter((i) => /^[a-f0-9]{12,32}\.txt$/.test(i));
    if (imena.length <= NAJVEC_ZAPISOV_NA_DISKU) return;
    const zCasi = await Promise.all(
      imena.map(async (ime) => {
        const p = path.join(mapa, ime);
        const st = await lstat(p).catch(() => null);
        return { p, mtime: st?.mtimeMs ?? 0, datoteka: st?.isFile() ?? false };
      }),
    );
    const stare = zCasi
      .filter((x) => x.datoteka)
      .sort((a, b) => a.mtime - b.mtime)
      .slice(0, Math.max(0, imena.length - NAJVEC_ZAPISOV_NA_DISKU));
    for (const s of stare) await unlink(s.p).catch(() => undefined);
  } catch {
    /* neobvezno ciscenje */
  }
}

/** Stikalo: privzeto VKLOPLJENO; samo izrecni false izklopi. */
export async function jeStiskanjeVklopljeno(dir?: string): Promise<boolean> {
  const pot = path.join(resolveDataDir(dir), STISKANJE_NASTAVITVE);
  let st;
  try {
    st = await lstat(pot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw e;
  }
  if (!st.isFile() || st.size > MEJA_NASTAVITEV_B) return false;
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(MEJA_NASTAVITEV_B);
    const { bytesRead } = await h.read(buf, 0, buf.length, 0);
    const j = JSON.parse(buf.subarray(0, bytesRead).toString("utf8")) as { vklopljen?: unknown };
    return j.vklopljen !== false;
  } catch {
    return true;
  } finally {
    await h.close().catch(() => undefined);
  }
}

export async function nastaviStiskanje(vklopljen: boolean, dir?: string): Promise<boolean> {
  const v = vklopljen === true;
  await writeJson(resolveDataDir(dir), STISKANJE_NASTAVITVE, { vklopljen: v });
  return v;
}

/** Zazna vrsto velikega izhoda (JSON, dnevnik ali porocilo agenta). */
export function zaznajVrstoIzhoda(besedilo: string): VrstaIzhoda {
  const t = besedilo.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* ni veljaven JSON */
    }
  }
  const vrstice = t.split(/\r?\n/);
  const steviloDnevnik = vrstice.filter((v) =>
    /^(?:\d{4}-\d{2}-\d{2}|\[?\d{2}:\d{2}:\d{2}|(?:INFO|WARN|ERROR|DEBUG|TRACE|ok|not ok|#\s+(?:tests|pass|fail)|TAP version)\b)/i.test(v.trim()),
  ).length;
  if (vrstice.length >= 6 && steviloDnevnik / vrstice.length >= 0.25) return "dnevnik";
  return "porocilo";
}

function skrajsajVrednostJson(v: unknown, globina = 0): unknown {
  if (typeof v === "string") return v.length > 100 ? `${v.slice(0, 97)}...` : v;
  if (v === null || typeof v !== "object") return v;
  if (globina >= 2) return Array.isArray(v) ? `[seznam: ${v.length}]` : `{objekt: ${Object.keys(v as object).length} kljucev}`;
  if (Array.isArray(v)) {
    if (v.length <= 3) return v.map((x) => skrajsajVrednostJson(x, globina + 1));
    return [skrajsajVrednostJson(v[0], globina + 1), `... (${v.length - 2} izpuscenih) ...`, skrajsajVrednostJson(v[v.length - 1], globina + 1)];
  }
  const vnosi = Object.entries(v as Record<string, unknown>);
  const izhod: Record<string, unknown> = {};
  for (const [k, val] of vnosi.slice(0, 8)) izhod[k] = skrajsajVrednostJson(val, globina + 1);
  if (vnosi.length > 8) izhod._ostaliKljuci = vnosi.length - 8;
  return izhod;
}

function jeAnomalenElement(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const s = JSON.stringify(v).toLowerCase();
  return /"error"|"napaka"|"fail"|"failed"|"status":\s*(?:4\d\d|5\d\d)|"ok":\s*false/.test(s);
}

/** Stiskanje JSON (Headroom Smart Crusher ideja): shema, prvi/zadnji elementi in anomalije/napake. */
export function stisniJson(besedilo: string, meja = PRIVZETA_MEJA_POVZETKA): string {
  try {
    const parsed: unknown = JSON.parse(besedilo);
    if (Array.isArray(parsed)) {
      const n = parsed.length;
      const kljuci = new Set<string>();
      for (const el of parsed.slice(0, 10)) {
        if (el && typeof el === "object" && !Array.isArray(el)) Object.keys(el as object).forEach((k) => kljuci.add(k));
      }
      const anomalije: Array<{ indeks: number; zapis: unknown }> = [];
      for (let i = 1; i < n - 1 && anomalije.length < 3; i++) {
        if (jeAnomalenElement(parsed[i])) anomalije.push({ indeks: i, zapis: skrajsajVrednostJson(parsed[i], 1) });
      }
      const povzetek = {
        vrsta: "json-seznam",
        elementov: n,
        kljuci: [...kljuci].slice(0, 16),
        prvi: n > 0 ? skrajsajVrednostJson(parsed[0], 0) : undefined,
        anomalije: anomalije.length ? anomalije : undefined,
        zadnji: n > 1 ? skrajsajVrednostJson(parsed[n - 1], 0) : undefined,
      };
      const out = JSON.stringify(povzetek, null, 2);
      return out.length <= meja ? out : out.slice(0, meja - 3) + "...";
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const vrstice = [`JSON objekt (${Object.keys(obj).length} kljucev):`];
      for (const [k, v] of Object.entries(obj)) {
        let opis: string;
        if (Array.isArray(v)) {
          const anomalij = v.filter(jeAnomalenElement).length;
          opis = `[seznam ${v.length}${anomalij ? `, napak=${anomalij}` : ""}] prvi=${JSON.stringify(skrajsajVrednostJson(v[0], 1))}`;
        } else if (v && typeof v === "object") {
          opis = `{objekt ${Object.keys(v as object).length} kljucev: ${Object.keys(v as object).slice(0, 6).join(", ")}}`;
        } else {
          opis = JSON.stringify(skrajsajVrednostJson(v, 1));
        }
        const vrstica = `- ${k}: ${opis.slice(0, 180)}`;
        if (vrstice.join("\n").length + vrstica.length + 1 > meja) {
          vrstice.push(`... (+ ostali kljuci)`);
          break;
        }
        vrstice.push(vrstica);
      }
      return vrstice.join("\n").slice(0, meja);
    }
  } catch {
    /* padec na splosno stiskanje */
  }
  return stisniPorocilo(besedilo, meja);
}

const POMEMBNA_DNEVNIK = /\b(?:error|err|fail|failed|failure|exception|warn|warning|fatal|panic|napaka|padlo|not ok|pass|tests|duration_ms|konec)\b/i;

/** Stiskanje dnevnikov: zdruzi ponovljene vrstice, ohrani napake/opozorila/povzetke + zacetek in konec. */
export function stisniDnevnik(besedilo: string, meja = PRIVZETA_MEJA_POVZETKA): string {
  const surove = besedilo.replace(/\r\n?/g, "\n").split("\n").map((v) => v.trimEnd()).filter((v) => v.trim() !== "");
  const zdruzene: string[] = [];
  for (let i = 0; i < surove.length; i++) {
    const v = surove[i]!;
    let pon = 1;
    while (i + 1 < surove.length && surove[i + 1] === v) {
      pon++;
      i++;
    }
    zdruzene.push(pon > 1 ? `${v} [×${pon}]` : v);
  }
  const izbrane: string[] = [];
  const dodane = new Set<number>();
  const dodaj = (idx: number) => {
    if (idx < 0 || idx >= zdruzene.length || dodane.has(idx)) return;
    dodane.add(idx);
    izbrane.push(zdruzene[idx]!.slice(0, 220));
  };

  // Najprej napake, opozorila in zakljucne vrstice, nato zacetek in konec.
  const prioritetni: number[] = [];
  for (let i = 0; i < Math.min(3, zdruzene.length); i++) prioritetni.push(i);
  for (let i = 0; i < zdruzene.length; i++) if (POMEMBNA_DNEVNIK.test(zdruzene[i]!)) prioritetni.push(i);
  for (let i = Math.max(0, zdruzene.length - 5); i < zdruzene.length; i++) prioritetni.push(i);

  const glava = `Dnevnik (${surove.length} vrstic):`;
  let dolzina = glava.length;
  for (const idx of prioritetni) {
    if (dodane.has(idx)) continue;
    const kos = zdruzene[idx]!.slice(0, 220);
    if (dolzina + 1 + kos.length > meja) break;
    dodaj(idx);
    dolzina += 1 + kos.length;
  }
  return [glava, ...izbrane].join("\n").slice(0, meja);
}

const POMEMBNA_POROCILO = /^(?:#{1,4}\s+|[-*]\s+)|\b(?:napaka|error|fail|pass|ok|odlo[cč]|povzetek|konec|preizkus|mutacij|rezultat)\b/i;

/** Stiskanje porocil agentov in daljsih besedil: ohrani naslove, kljucne tocke, zacetek in zakljucek. */
export function stisniPorocilo(besedilo: string, meja = PRIVZETA_MEJA_POVZETKA): string {
  const vrstice = besedilo.replace(/\r\n?/g, "\n").split("\n").map((v) => v.trim()).filter(Boolean);
  const izbrane: string[] = [];
  const dodane = new Set<number>();
  let dolzina = 0;
  const poskusi = (idx: number) => {
    if (idx < 0 || idx >= vrstice.length || dodane.has(idx)) return false;
    const kos = vrstice[idx]!.slice(0, 200);
    if (dolzina + (izbrane.length ? 1 : 0) + kos.length > meja) return false;
    dodane.add(idx);
    izbrane.push(kos);
    dolzina += (izbrane.length > 1 ? 1 : 0) + kos.length;
    return true;
  };

  for (let i = 0; i < Math.min(2, vrstice.length); i++) poskusi(i);
  for (let i = 0; i < vrstice.length; i++) {
    if (POMEMBNA_POROCILO.test(vrstice[i]!)) poskusi(i);
  }
  for (let i = Math.max(0, vrstice.length - 3); i < vrstice.length; i++) poskusi(i);

  if (izbrane.length === 0) return besedilo.trim().slice(0, meja);
  return izbrane.join("\n").slice(0, meja);
}

/** Izracuna deterministican 16-znakovni SHA-256 kljuc za izvirnik. */
export function kljucIzvirnika(izvirnik: string): string {
  return createHash("sha256").update(izvirnik, "utf8").digest("hex").slice(0, 16);
}

/**
 * Stisne velik izhod orodja (JSON, dnevnik ali porocilo) pred posiljanjem izbranemu modelu.
 * Izvirnik shrani lokalno po kljucu (reverzibilno, CCR). Ob izklopu stikala ali kratkem izhodu vrne izvirnik nespremenjen.
 */
export async function stisniIzhod(izvirnik: string, moznosti: StisniMoznosti = {}): Promise<RezultatStiskanja> {
  const izvirnikZnakov = izvirnik.length;
  const vrsta = moznosti.vrsta ?? zaznajVrstoIzhoda(izvirnik);
  const vklopljen = moznosti.vklopljen ?? (moznosti.dir ? await jeStiskanjeVklopljeno(moznosti.dir) : true);
  const prag = moznosti.pragZnakov ?? PRIVZETI_PRAG_ZNAKOV;

  if (!vklopljen || izvirnikZnakov < prag) {
    return {
      stisnjeno: false,
      vrsta,
      besedilo: izvirnik,
      kljuc: null,
      izvirnikZnakov,
      stisnjenoZnakov: izvirnikZnakov,
      prihranekZnakov: 0,
      prihranekOdstotek: 0,
      shranjenIzvirnik: false,
    };
  }

  const meja = Math.max(200, Math.min(moznosti.mejaPovzetka ?? PRIVZETA_MEJA_POVZETKA, Math.floor(izvirnikZnakov * 0.7)));
  const povzetek =
    vrsta === "json"
      ? stisniJson(izvirnik, meja)
      : vrsta === "dnevnik"
        ? stisniDnevnik(izvirnik, meja)
        : stisniPorocilo(izvirnik, meja);

  const kljuc = kljucIzvirnika(izvirnik);
  const shramba = moznosti.shramba ?? (moznosti.dir ? lokalnaShramba(moznosti.dir) : undefined);
  const shranjenIzvirnik = shramba ? await shramba.shrani(kljuc, izvirnik) : false;

  const rep = shranjenIzvirnik
    ? `\n[Stisnjeno (${vrsta}): ${izvirnikZnakov} -> ${povzetek.length} znakov; izvirnik je lokalno pod kljucem [[priklic-izvirnika: ${kljuc}]]]`
    : `\n[Stisnjeno (${vrsta}): ${izvirnikZnakov} -> ${povzetek.length} znakov; izvirnik ni zapisan na disk]`;
  const besedilo = `${povzetek}${rep}`;

  // Ce stiskanje ne prinese prihranka, vrnemo izvirnik nespremenjen.
  if (besedilo.length >= izvirnikZnakov) {
    return {
      stisnjeno: false,
      vrsta,
      besedilo: izvirnik,
      kljuc: null,
      izvirnikZnakov,
      stisnjenoZnakov: izvirnikZnakov,
      prihranekZnakov: 0,
      prihranekOdstotek: 0,
      shranjenIzvirnik: false,
    };
  }

  const prihranekZnakov = izvirnikZnakov - besedilo.length;
  const prihranekOdstotek = Math.round((prihranekZnakov / izvirnikZnakov) * 1000) / 10;
  return {
    stisnjeno: true,
    vrsta,
    besedilo,
    kljuc,
    izvirnikZnakov,
    stisnjenoZnakov: besedilo.length,
    prihranekZnakov,
    prihranekOdstotek,
    shranjenIzvirnik,
  };
}

/** Priklic izvirnika po kljucu CCR (celota, izsek ali iskanje vrstic znotraj izvirnika). */
export async function prikliciIzvirnik(
  kljuc: string,
  moznosti: { dir?: string; shramba?: ShrambaIzvirnikov; od?: number; do?: number; isci?: string } = {},
): Promise<string | null> {
  if (!VELJAVEN_KLJUC.test(kljuc)) return null;
  const shramba = moznosti.shramba ?? lokalnaShramba(moznosti.dir);
  const izvirnik = await shramba.preberi(kljuc);
  if (izvirnik === null) return null;
  if (moznosti.isci && moznosti.isci.trim()) {
    const igla = moznosti.isci.trim().toLowerCase();
    return izvirnik
      .split(/\r?\n/)
      .filter((v) => v.toLowerCase().includes(igla))
      .join("\n");
  }
  if (moznosti.od !== undefined || moznosti.do !== undefined) {
    return izvirnik.slice(Math.max(0, moznosti.od ?? 0), moznosti.do);
  }
  return izvirnik;
}

const OZNAKA_PRIKLICA = /\[\[\s*priklic-izvirnika\s*:\s*([a-f0-9]{12,32})\s*\]\]/gi;

/** Izlusci zahteve modela [[priklic-izvirnika: <kljuc>]] in jih odstrani iz besedila. */
export function izluciPriklicIzvirnika(besedilo: string): { besedilo: string; kljuci: string[] } {
  const kljuci: string[] = [];
  const cisto = besedilo
    .replace(OZNAKA_PRIKLICA, (_m, k: string) => {
      const kljuc = k.toLowerCase();
      if (!kljuci.includes(kljuc) && kljuci.length < 4) kljuci.push(kljuc);
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { besedilo: cisto, kljuci };
}
