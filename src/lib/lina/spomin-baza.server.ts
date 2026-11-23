/**
 * Spomin pogovorov Line v eni binarni datoteki SQLite (FTS5, node:sqlite).
 * Loceno od spomin.server.ts (spomin.json z dejstvi lastnika ostane nespremenjen).
 *
 * Pravila:
 * - Privzeto VKLOPLJENO (lastnik 22. 11. 2026: »More biti vklopljeno da si lina zapomni pogovore«, brez potrjevanja); samo izrecni
 *   izklop v spomin-baza.json (vklopljen: false) ustavi zapis. Prej (do 22. 11.) privzeto izklopljeno.
 * - En obrat pogovora gre v ENI transakciji (obrati + obrati_fts + seje).
 * - Iskanje FTS5 (unicode61 remove_diacritics 2, predpona); poizvedba je vedno ubezena.
 * - Pravice 0600 prek deskriptorja brez sledenja simbolni povezavi (tudi -wal in -shm).
 * - Neobicajna ali pokvarjena datoteka se zavrne in se nikoli ne prepise tiho.
 * - Meja velikosti (privzeto 50 MB): nad mejo se najstarejsi obrati brisejo.
 * - Brez skrivnosti (obstojece jeSkrivnost iz spomin.ts).
 * - V dnevnik gredo samo stevila (zapisov, bajtov), nikoli vsebina.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { jeSkrivnost } from "./spomin.ts";
import { resolveDataDir, writeJson } from "./store.server.ts";

export const SPOMIN_BAZA_DATOTEKA = "spomin.sqlite";
export const SPOMIN_BAZA_NASTAVITVE = "spomin-baza.json";
/** Privzeta meja velikosti baze (50 MB): nad mejo se najstarejsi obrati brisejo. */
export const SPOMIN_BAZA_MEJA_B = 50 * 1024 * 1024;

const PRIVZETO_ZADETKOV = 10;
const NAJVEC_ZADETKOV = 200;
const NAJVEC_ZETONOV_POIZVEDBE = 32;
const NAJVEC_ZNAKOV_BESEDILA = 32_000;
const NAJVEC_ZNAKOV_SEJE = 128;
const NAJVEC_ZNAKOV_VLOGE = 64;
const MEJA_NASTAVITEV_B = 4096;
const SQLITE_GLAVA = Buffer.from("SQLite format 3\0", "ascii");

const O_VARNO_BRANJE =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const O_VARNO_USTVARI =
  constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0);

/** Runtime nima vgrajenega modula node:sqlite (npr. prestara razlicica Node ali nepodprta gradnja). */
export class SpominBazaNiPodprta extends Error {
  constructor(sporocilo = "node:sqlite ni na voljo v tej razlicici Node.js.") {
    super(sporocilo);
    this.name = "SpominBazaNiPodprta";
  }
}

/** spomin.sqlite, -wal ali -shm ni obicajna datoteka (simbolna povezava, mapa, cev). */
export class SpominBazaNeveljavna extends Error {
  constructor(sporocilo = "Datoteka spomina ni obicajna datoteka.") {
    super(sporocilo);
    this.name = "SpominBazaNeveljavna";
  }
}

/** spomin.sqlite je pokvarjena ali neveljavna baza SQLite; ne uporabi se in se ne prepise tiho. */
export class SpominBazaPokvarjena extends Error {
  constructor(sporocilo = "Datoteka spomina je pokvarjena.") {
    super(sporocilo);
    this.name = "SpominBazaPokvarjena";
  }
}

export type VlogaObrata = "klicatelj" | "uporabnik" | "lina" | "sistem" | (string & {});

export type ObratVnos = {
  /** Identifikator klica ali seje pogovora. */
  seja: string;
  /** Vloga govorca (npr. "klicatelj", "uporabnik", "lina"). */
  vloga: VlogaObrata;
  /** Besedilo obrata. */
  besedilo: string;
  /** Cas zapisa (ms od epohe, Date ali ISO niz; privzeto Date.now()). */
  cas?: number | Date | string;
};

export type ObratZapis = {
  id: number;
  seja: string;
  vloga: string;
  besedilo: string;
  cas: number;
};

export type SpominBazaMoznosti = {
  /** Mapa podatkov (privzeto resolveDataDir()). */
  dir?: string;
  /** Izrecni vklop/izklop (ce ni podan, bere shranjeno stikalo, ki je privzeto true od 22. 11. 2026). */
  vklopljen?: boolean;
  /** Najvecja dovoljena velikost baze v bajtih (privzeto 50 MB). */
  mejaVelikostiB?: number;
};

export type IskanjeMoznosti = {
  dir?: string;
  vklopljen?: boolean;
  /** Ce je podana, omeji iskanje na eno sejo/klic. */
  seja?: string;
  /** Priklic za pogovor: zadetek ima KATEROKOLI besedo poizvedbe (OR, besede z vsaj 3 znaki), razvrscen po BM25. Privzeto vse besede (AND). */
  katerakoli?: boolean;
};

export type ZapisRezultat =
  | { zapisano: true; id: number; izbrisanihStarih: number; velikostB: number }
  | { zapisano: false; razlog: "izklopljeno" | "skrivnost" | "prazno" | "neveljavno" };

export type IzbrisRezultat = {
  izbrisanihDatotek: number;
};

type SqliteModul = {
  DatabaseSync: new (location: string) => DatabaseSync;
};

let sqliteModul: Promise<SqliteModul> | null = null;

async function naloziSqlite(): Promise<SqliteModul> {
  if (!sqliteModul) {
    sqliteModul = import("node:sqlite").then(
      (m) => m as unknown as SqliteModul,
      () => {
        sqliteModul = null;
        throw new SpominBazaNiPodprta();
      },
    );
  }
  return sqliteModul;
}

type OdprtaBaza = {
  db: DatabaseSync;
  dev: number;
  ino: number;
  pripravljenoZaPisanje: boolean;
};

type StanjeDatoteke = {
  obstaja: boolean;
  velikost: number;
  dev: number;
  ino: number;
};

type StanjeVsehDatotek = {
  glavna: StanjeDatoteke;
  wal: StanjeDatoteke;
  shm: StanjeDatoteke;
};

const odprte = new Map<string, OdprtaBaza>();
let vrsta: Promise<unknown> = Promise.resolve();

function vVrsti<T>(f: () => Promise<T>): Promise<T> {
  const naslednji = vrsta.then(f, f);
  vrsta = naslednji.catch(() => undefined);
  return naslednji;
}

function potiBaze(root: string): { glavna: string; wal: string; shm: string } {
  const glavna = path.join(root, SPOMIN_BAZA_DATOTEKA);
  return { glavna, wal: `${glavna}-wal`, shm: `${glavna}-shm` };
}

function zapriIzPredpomnilnika(root: string): void {
  const vnos = odprte.get(root);
  if (!vnos) return;
  odprte.delete(root);
  try {
    vnos.db.close();
  } catch {
    // ze zaprto
  }
}

/** Zapre odprto povezavo do baze za izbrano mapo (npr. ob zaustavitvi ali v preizkusih). */
export function zapriSpominBazo(dir?: string): void {
  zapriIzPredpomnilnika(resolveDataDir(dir));
}

/** Zapre vse odprte povezave spominske baze. */
export function zapriVseSpominBaze(): void {
  for (const root of [...odprte.keys()]) {
    zapriIzPredpomnilnika(root);
  }
}

process.once("exit", zapriVseSpominBaze);

/**
 * Ubezi zunanjo poizvedbo za FTS5: izlusci samo besede (Unicode crke in stevke) ter vsako ovije v narekovaje s predpono "*".
 * Operatorji FTS5 (", *, NEAR, OR, AND, NOT, :, ^, (), -) nimajo pomena operatorja in ne morejo povzrociti sintaksne napake.
 */
export function ubeziPoizvedboFts(poizvedba: string, katerakoli = false): string {
  if (typeof poizvedba !== "string") return "";
  const najdeni = poizvedba.match(/[\p{L}\p{N}]+/gu);
  if (!najdeni || najdeni.length === 0) return "";
  const edinstveni: string[] = [];
  const videni = new Set<string>();
  for (const kos of najdeni) {
    const cist = kos.replace(/"/g, "");
    if (!cist) continue;
    const kljuc = cist.toLowerCase();
    if (videni.has(kljuc)) continue;
    videni.add(kljuc);
    edinstveni.push(`"${cist}"*`);
    if (edinstveni.length >= NAJVEC_ZETONOV_POIZVEDBE) break;
  }
  if (katerakoli) {
    const dolge = edinstveni.filter((e) => e.length - 3 >= 3);
    return (dolge.length ? dolge : edinstveni).join(" OR ");
  }
  return edinstveni.join(" ");
}

/**
 * Preveri, da je pot obicajna datoteka (ne simbolna povezava, mapa ali cev) in nastavi pravice 0600 prek deskriptorja (fchmod).
 * Ce datoteka ne obstaja, vrne obstaja=false brez ustvarjanja.
 */
async function preveriInZavarujDatoteko(pot: string): Promise<StanjeDatoteke> {
  let st;
  try {
    st = await lstat(pot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { obstaja: false, velikost: 0, dev: 0, ino: 0 };
    }
    throw error;
  }
  if (!st.isFile()) {
    throw new SpominBazaNeveljavna();
  }
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { obstaja: false, velikost: 0, dev: 0, ino: 0 };
    }
    if (code === "ELOOP" || code === "EISDIR" || code === "ENXIO") {
      throw new SpominBazaNeveljavna();
    }
    throw error;
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile()) {
      throw new SpominBazaNeveljavna();
    }
    try {
      await h.chmod(0o600);
    } catch {
      // Na sistemih brez POSIX pravic (Windows) chmod ne prekine delovanja.
    }
    return { obstaja: true, velikost: st2.size, dev: st2.dev, ino: st2.ino };
  } finally {
    await h.close().catch(() => undefined);
  }
}

async function preveriInZavarujVseDatoteke(root: string): Promise<StanjeVsehDatotek> {
  const poti = potiBaze(root);
  const glavna = await preveriInZavarujDatoteko(poti.glavna);
  const wal = await preveriInZavarujDatoteko(poti.wal);
  const shm = await preveriInZavarujDatoteko(poti.shm);
  return { glavna, wal, shm };
}

/**
 * Preveri 16-bajtni podpis glave SQLite 3 prek deskriptorja brez sledenja simbolni povezavi.
 * Prazna 0-bajtna datoteka je veljavna nova baza SQLite ("prazna"); 1-15 bajtov ali napacna glava vrze SpominBazaPokvarjena.
 */
async function preveriGlavoSqlite(pot: string): Promise<"veljavna" | "prazna"> {
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EISDIR" || code === "ENXIO") {
      throw new SpominBazaNeveljavna();
    }
    throw error;
  }
  try {
    const st = await h.stat();
    if (!st.isFile()) {
      throw new SpominBazaNeveljavna();
    }
    if (st.size === 0) {
      return "prazna";
    }
    if (st.size < SQLITE_GLAVA.length) {
      throw new SpominBazaPokvarjena("Datoteka spomina je skrajsana.");
    }
    const glava = Buffer.alloc(SQLITE_GLAVA.length);
    const { bytesRead } = await h.read(glava, 0, SQLITE_GLAVA.length, 0);
    if (bytesRead < SQLITE_GLAVA.length || !glava.equals(SQLITE_GLAVA)) {
      throw new SpominBazaPokvarjena("Datoteka spomina ni veljavna baza SQLite.");
    }
    return "veljavna";
  } finally {
    await h.close().catch(() => undefined);
  }
}

function jeNapakaPokvarjenosti(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const err = error as Error & { errcode?: number; errstr?: string };
  if (err.errcode === 11 || err.errcode === 26 || err.errcode === 267) return true;
  const msg = `${err.message} ${err.errstr ?? ""}`.toLowerCase();
  return msg.includes("malformed") || msg.includes("not a database") || msg.includes("corrupt");
}

/** Prebere stikalo vklopa iz spomin-baza.json brez ustvarjanja datotek. Privzeto true (manjkajoca datoteka); samo izrecni false izklopi; neobicajna datoteka (povezava, mapa, prevelika) = izklopljeno. */
export async function jeSpominBazeVklopljen(dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  const pot = path.join(root, SPOMIN_BAZA_NASTAVITVE);
  let st;
  try {
    st = await lstat(pot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  if (!st.isFile() || st.size > MEJA_NASTAVITEV_B) return false;
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ELOOP" || code === "EISDIR" || code === "ENXIO") {
      return false;
    }
    throw error;
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile() || st2.size > MEJA_NASTAVITEV_B) return false;
    const buf = Buffer.allocUnsafe(st2.size);
    const { bytesRead } = await h.read(buf, 0, st2.size, 0);
    const parsed = JSON.parse(buf.subarray(0, bytesRead).toString("utf8")) as {
      vklopljen?: unknown;
    };
    return parsed?.vklopljen !== false;
  } catch {
    // Pokvarjena vsebina: spomin ostane vklopljen (privzeto), izklop velja samo izrecni.
    return true;
  } finally {
    await h.close().catch(() => undefined);
  }
}

/** Shrani stikalo vklopa v spomin-baza.json (atomarno, 0600). Ne ustvari spomin.sqlite. */
export async function nastaviSpominBaze(vklopljen: boolean, dir?: string): Promise<boolean> {
  const root = resolveDataDir(dir);
  const vrednost = vklopljen === true;
  return vVrsti(async () => {
    if (!vrednost) zapriIzPredpomnilnika(root);
    await writeJson(root, SPOMIN_BAZA_NASTAVITVE, { vklopljen: vrednost });
    return vrednost;
  });
}

async function aliJeVklopljeno(root: string, eksplicitno?: boolean): Promise<boolean> {
  if (typeof eksplicitno === "boolean") return eksplicitno;
  return jeSpominBazeVklopljen(root);
}

function pretvoriCas(cas: ObratVnos["cas"]): number | null {
  if (cas === undefined) return Date.now();
  if (typeof cas === "number") return Number.isFinite(cas) ? Math.trunc(cas) : null;
  if (cas instanceof Date) return Number.isFinite(cas.getTime()) ? cas.getTime() : null;
  if (typeof cas === "string") {
    const ms = Date.parse(cas);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function ustvariShemo(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS obrati (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seja TEXT NOT NULL,
        vloga TEXT NOT NULL,
        besedilo TEXT NOT NULL,
        cas INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obrati_cas_id ON obrati (cas ASC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_obrati_seja_cas ON obrati (seja, cas DESC, id DESC);
      CREATE TABLE IF NOT EXISTS seje (
        seja TEXT PRIMARY KEY,
        zadnji_cas INTEGER NOT NULL,
        stevilo_obratov INTEGER NOT NULL CHECK (stevilo_obratov >= 0)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS obrati_fts USING fts5(
        besedilo,
        content='obrati',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ze razveljavljeno
    }
    throw error;
  }
}

function velikostIzStanja(stanje: StanjeVsehDatotek): number {
  return (stanje.glavna.obstaja ? stanje.glavna.velikost : 0) + (stanje.wal.obstaja ? stanje.wal.velikost : 0);
}

async function odpriBazo(root: string, ustvari: boolean): Promise<DatabaseSync | null> {
  let stanje: StanjeVsehDatotek;
  try {
    stanje = await preveriInZavarujVseDatoteke(root);
  } catch (error) {
    zapriIzPredpomnilnika(root);
    if (error instanceof SpominBazaNeveljavna) {
      console.warn("lina spomin-baza: datoteka ni obicajna");
    }
    throw error;
  }

  const obstojeca = odprte.get(root);
  if (obstojeca) {
    if (
      stanje.glavna.obstaja &&
      stanje.glavna.dev === obstojeca.dev &&
      stanje.glavna.ino === obstojeca.ino
    ) {
      if (ustvari && !obstojeca.pripravljenoZaPisanje) {
        obstojeca.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
        ustvariShemo(obstojeca.db);
        await preveriInZavarujVseDatoteke(root);
        obstojeca.pripravljenoZaPisanje = true;
      }
      return obstojeca.db;
    }
    zapriIzPredpomnilnika(root);
  }

  if (!stanje.glavna.obstaja && !ustvari) return null;

  const { DatabaseSync: DbCtor } = await naloziSqlite();
  const dbPath = potiBaze(root).glavna;
  let ustvarjenoZdaj = false;
  let praznaDatoteka = false;

  if (!stanje.glavna.obstaja) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    let h;
    try {
      h = await open(dbPath, O_VARNO_USTVARI, 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ELOOP" || code === "EISDIR") {
        throw new SpominBazaNeveljavna();
      }
      throw error;
    }
    try {
      try {
        await h.chmod(0o600);
      } catch {
        // Windows brez POSIX chmod
      }
    } finally {
      await h.close().catch(() => undefined);
    }
    ustvarjenoZdaj = true;
  } else {
    try {
      praznaDatoteka = (await preveriGlavoSqlite(dbPath)) === "prazna";
    } catch (error) {
      if (error instanceof SpominBazaPokvarjena) {
        console.warn("lina spomin-baza: datoteka je pokvarjena");
      }
      throw error;
    }
  }

  const db = new DbCtor(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    if (ustvarjenoZdaj) {
      db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
      ustvariShemo(db);
    } else {
      // Pred kakrsnim koli pisanjem ali WAL preklopom preverimo celovitost obstojece baze.
      let qcRow: Record<string, unknown> | undefined;
      try {
        qcRow = db.prepare("PRAGMA quick_check(1)").get() as Record<string, unknown> | undefined;
      } catch (error) {
        if (jeNapakaPokvarjenosti(error)) {
          console.warn("lina spomin-baza: datoteka je pokvarjena");
          throw new SpominBazaPokvarjena();
        }
        throw error;
      }
      if (!qcRow || qcRow.quick_check !== "ok") {
        console.warn("lina spomin-baza: datoteka je pokvarjena");
        throw new SpominBazaPokvarjena();
      }

      if (ustvari) {
        // 0-bajtna obstojeca datoteka je nova baza: auto_vacuum velja samo, ce je nastavljen pred prvo tabelo (prej je manjkal, preizkus 0-bajtna).
        if (praznaDatoteka) db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
        db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
        ustvariShemo(db);
      } else {
        const tRow = db
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('obrati', 'obrati_fts')",
          )
          .get();
        if (Number(tRow?.n ?? 0) < 2) {
          db.close();
          return null;
        }
      }
    }

    const novStanje = await preveriInZavarujVseDatoteke(root);
    odprte.set(root, {
      db,
      dev: novStanje.glavna.dev,
      ino: novStanje.glavna.ino,
      pripravljenoZaPisanje: ustvari,
    });
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // ignore
    }
    if (ustvarjenoZdaj) {
      await unlink(dbPath).catch(() => undefined);
      await unlink(`${dbPath}-wal`).catch(() => undefined);
      await unlink(`${dbPath}-shm`).catch(() => undefined);
    }
    if (jeNapakaPokvarjenosti(error) && !(error instanceof SpominBazaPokvarjena)) {
      console.warn("lina spomin-baza: datoteka je pokvarjena");
      throw new SpominBazaPokvarjena();
    }
    throw error;
  }
}

async function omejiVelikost(
  db: DatabaseSync,
  root: string,
  meja: number,
  zacetnoStanje: StanjeVsehDatotek,
): Promise<{ izbrisanih: number; stanje: StanjeVsehDatotek }> {
  let stanje = zacetnoStanje;
  let velikostB = velikostIzStanja(stanje);
  if (velikostB <= meja) return { izbrisanih: 0, stanje };

  // Najprej poskusimo skrajsati WAL brez brisanja zapisov.
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  stanje = await preveriInZavarujVseDatoteke(root);
  velikostB = velikostIzStanja(stanje);
  if (velikostB <= meja) return { izbrisanih: 0, stanje };

  let skupajIzbrisanih = 0;
  for (let krog = 0; krog < 32 && velikostB > meja; krog++) {
    const stRow = db.prepare("SELECT COUNT(*) AS n FROM obrati").get();
    const skupaj = Number(stRow?.n ?? 0);
    if (skupaj <= 1) break;

    const zaIzbris = Math.min(skupaj - 1, Math.max(1, Math.ceil(skupaj * 0.25)));
    const stari = db
      .prepare("SELECT id, seja, besedilo FROM obrati ORDER BY cas ASC, id ASC LIMIT ?")
      .all(zaIzbris);
    if (stari.length === 0) break;

    db.exec("BEGIN IMMEDIATE");
    try {
      const brisiFts = db.prepare(
        "INSERT INTO obrati_fts(obrati_fts, rowid, besedilo) VALUES('delete', ?, ?)",
      );
      const brisiObrat = db.prepare("DELETE FROM obrati WHERE id = ?");
      const posodobiSejo = db.prepare(
        "UPDATE seje SET stevilo_obratov = MAX(0, stevilo_obratov - 1) WHERE seja = ?",
      );
      for (const r of stari) {
        const rid = Number(r.id);
        const rBesedilo = String(r.besedilo ?? "");
        const rSeja = String(r.seja ?? "");
        brisiFts.run(rid, rBesedilo);
        brisiObrat.run(rid);
        posodobiSejo.run(rSeja);
      }
      db.exec("DELETE FROM seje WHERE stevilo_obratov <= 0");
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ze razveljavljeno
      }
      throw error;
    }

    skupajIzbrisanih += stari.length;

    db.exec("PRAGMA incremental_vacuum");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    stanje = await preveriInZavarujVseDatoteke(root);
    velikostB = velikostIzStanja(stanje);

    if (velikostB > meja) {
      db.exec("VACUUM");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      stanje = await preveriInZavarujVseDatoteke(root);
      velikostB = velikostIzStanja(stanje);
    }
  }

  const odprta = odprte.get(root);
  if (odprta && stanje.glavna.obstaja) {
    odprta.dev = stanje.glavna.dev;
    odprta.ino = stanje.glavna.ino;
  }

  if (skupajIzbrisanih > 0) {
    console.info(`lina spomin-baza: izbrisano_starih=${skupajIzbrisanih}, velikost_b=${velikostB}`);
  }
  return { izbrisanih: skupajIzbrisanih, stanje };
}

/**
 * Zapise en obrat pogovora (seja, vloga, besedilo, cas) v ENI transakciji.
 * Ko je spomin izklopljen, ne zapise nicesar in ne ustvari datoteke.
 * Skrivnosti (jeSkrivnost) zavrne brez zapisa in brez vsebine v dnevniku.
 */
export async function zapisiObrat(
  vnos: ObratVnos,
  moznosti?: SpominBazaMoznosti,
): Promise<ZapisRezultat> {
  const root = resolveDataDir(moznosti?.dir);
  if (!(await aliJeVklopljeno(root, moznosti?.vklopljen))) {
    return { zapisano: false, razlog: "izklopljeno" };
  }

  const meja = moznosti?.mejaVelikostiB ?? SPOMIN_BAZA_MEJA_B;
  if (!Number.isFinite(meja) || meja <= 0) {
    throw new RangeError("mejaVelikostiB mora biti pozitivno stevilo.");
  }

  const seja = typeof vnos.seja === "string" ? vnos.seja.trim() : "";
  const vloga = typeof vnos.vloga === "string" ? vnos.vloga.trim() : "";
  const besedilo = typeof vnos.besedilo === "string" ? vnos.besedilo.trim() : "";
  const cas = pretvoriCas(vnos.cas);

  if (!besedilo) return { zapisano: false, razlog: "prazno" };
  if (
    !seja ||
    seja.length > NAJVEC_ZNAKOV_SEJE ||
    !vloga ||
    vloga.length > NAJVEC_ZNAKOV_VLOGE ||
    besedilo.length > NAJVEC_ZNAKOV_BESEDILA ||
    cas === null
  ) {
    return { zapisano: false, razlog: "neveljavno" };
  }

  if (jeSkrivnost(besedilo) || jeSkrivnost(seja)) {
    console.warn("lina spomin-baza: zapis zavrnjen (skrivnost)");
    return { zapisano: false, razlog: "skrivnost" };
  }

  return vVrsti(async () => {
    const db = await odpriBazo(root, true);
    if (!db) return { zapisano: false, razlog: "izklopljeno" };

    let id: number;
    db.exec("BEGIN IMMEDIATE");
    try {
      const res = db
        .prepare("INSERT INTO obrati (seja, vloga, besedilo, cas) VALUES (?, ?, ?, ?)")
        .run(seja, vloga, besedilo, cas);
      id = Number(res.lastInsertRowid);
      db.prepare("INSERT INTO obrati_fts (rowid, besedilo) VALUES (?, ?)").run(id, besedilo);
      db.prepare(
        "INSERT INTO seje (seja, zadnji_cas, stevilo_obratov) VALUES (?, ?, 1) " +
          "ON CONFLICT(seja) DO UPDATE SET zadnji_cas = MAX(zadnji_cas, excluded.zadnji_cas), stevilo_obratov = stevilo_obratov + 1",
      ).run(seja, cas);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // transakcija je ze razveljavljena
      }
      if (jeNapakaPokvarjenosti(error)) {
        zapriIzPredpomnilnika(root);
        console.warn("lina spomin-baza: datoteka je pokvarjena");
        throw new SpominBazaPokvarjena();
      }
      throw error;
    }

    let stanje = await preveriInZavarujVseDatoteke(root);
    let izbrisanihStarih = 0;
    if (velikostIzStanja(stanje) > meja) {
      const omejeno = await omejiVelikost(db, root, meja, stanje);
      izbrisanihStarih = omejeno.izbrisanih;
      stanje = omejeno.stanje;
    }

    const velikostB = velikostIzStanja(stanje);
    console.info(`lina spomin-baza: zapisano=1, velikost_b=${velikostB}`);
    return { zapisano: true, id, izbrisanihStarih, velikostB };
  });
}

/**
 * Poisce obrate pogovorov prek FTS5 (unicode61 remove_diacritics 2, iskanje po predponi).
 * Poizvedba je vedno ubezena; ob izklopljenem spominu ali neobstoju baze vrne prazen seznam.
 */
export async function isci(
  poizvedba: string,
  n: number = PRIVZETO_ZADETKOV,
  moznosti?: IskanjeMoznosti,
): Promise<ObratZapis[]> {
  const root = resolveDataDir(moznosti?.dir);
  if (!(await aliJeVklopljeno(root, moznosti?.vklopljen))) return [];

  const meja = Number.isFinite(n) ? Math.min(NAJVEC_ZADETKOV, Math.floor(n)) : PRIVZETO_ZADETKOV;
  if (meja <= 0) return [];

  const q = ubeziPoizvedboFts(poizvedba, moznosti?.katerakoli === true);
  if (!q) return [];

  const seja = typeof moznosti?.seja === "string" && moznosti.seja.trim() ? moznosti.seja.trim() : null;

  return vVrsti(async () => {
    const db = await odpriBazo(root, false);
    if (!db) return [];

    let vrstice: Record<string, unknown>[];
    try {
      vrstice = (
        seja
          ? db
              .prepare(
                "SELECT o.id, o.seja, o.vloga, o.besedilo, o.cas " +
                  "FROM obrati_fts JOIN obrati o ON o.id = obrati_fts.rowid " +
                  "WHERE obrati_fts MATCH ? AND o.seja = ? " +
                  "ORDER BY bm25(obrati_fts) ASC, o.cas DESC, o.id DESC LIMIT ?",
              )
              .all(q, seja, meja)
          : db
              .prepare(
                "SELECT o.id, o.seja, o.vloga, o.besedilo, o.cas " +
                  "FROM obrati_fts JOIN obrati o ON o.id = obrati_fts.rowid " +
                  "WHERE obrati_fts MATCH ? " +
                  "ORDER BY bm25(obrati_fts) ASC, o.cas DESC, o.id DESC LIMIT ?",
              )
              .all(q, meja)
      ) as Record<string, unknown>[];
    } catch (error) {
      if (jeNapakaPokvarjenosti(error)) {
        zapriIzPredpomnilnika(root);
        console.warn("lina spomin-baza: datoteka je pokvarjena");
        throw new SpominBazaPokvarjena();
      }
      throw error;
    }

    const zadetki: ObratZapis[] = vrstice.map((r) => ({
      id: Number(r.id),
      seja: String(r.seja ?? ""),
      vloga: String(r.vloga ?? ""),
      besedilo: String(r.besedilo ?? ""),
      cas: Number(r.cas),
    }));
    console.info(`lina spomin-baza: zadetkov=${zadetki.length}`);
    return zadetki;
  });
}

/**
 * »Izbrisi vse«: zapre povezavo in izbrise spomin.sqlite, spomin.sqlite-wal in spomin.sqlite-shm.
 * Deluje tudi, ko je spomin izklopljen. Nikoli ne sledi simbolni povezavi (unlink odstrani samo vnos).
 */
export async function izbrisiVse(moznosti?: { dir?: string }): Promise<IzbrisRezultat> {
  const root = resolveDataDir(moznosti?.dir);
  return vVrsti(async () => {
    zapriIzPredpomnilnika(root);
    const poti = potiBaze(root);
    let izbrisanihDatotek = 0;
    for (const pot of [poti.glavna, poti.wal, poti.shm]) {
      let st;
      try {
        st = await lstat(pot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (st.isDirectory()) {
        throw new SpominBazaNeveljavna("Na mestu baze je mapa, ne datoteka.");
      }
      try {
        await unlink(pot);
        izbrisanihDatotek += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    console.info(`lina spomin-baza: izbrisano_datotek=${izbrisanihDatotek}`);
    return { izbrisanihDatotek };
  });
}
