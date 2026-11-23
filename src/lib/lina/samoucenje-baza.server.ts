/**
 * Samoucenje Line: znanje, ki se ga je Lina naucila, v eni binarni datoteki SQLite (samoucenje.sqlite, FTS5, node:sqlite).
 * Lastnik 21. in 22. 11. 2026: »Znanje si zapisuje v binarno datoteko«, »moje ideje so da koristijo« (privzeto VKLOPLJENO, z izklopom).
 *
 * Pravila:
 * - Samo izrecni izklop v samoucenje.json (vklopljen: false) ustavi ucenje in uporabo; manjkajoca datoteka = vklopljeno.
 * - Pravice 0600 prek deskriptorja brez sledenja simbolni povezavi; pokvarjena ali neobicajna datoteka se zavrne in se nikoli ne prepise tiho.
 * - Vsebina virov je NEZAUPAN podatek: odstranijo se krmilni znaki, dolzine so omejene, navodila iz vira se ne izvajajo.
 * - Meja velikosti (privzeto 20 MB): nad mejo se najstarejse teme brisejo.
 * - Vsako temo je mogoce pozabiti posamicno ali vse (pozabiTemo, pozabiVse). V klicih se znanje NE uporablja (samo v pogovoru lastnika).
 * - V dnevnik gredo samo stevila, nikoli vsebina.
 */
import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveDataDir, writeJson } from "./store.server.ts";
import {
  SpominBazaNeveljavna as SamoucenjeNeveljavno,
  SpominBazaNiPodprta as SamoucenjeNiPodprto,
  SpominBazaPokvarjena as SamoucenjePokvarjeno,
  ubeziPoizvedboFts,
} from "./spomin-baza.server.ts";

export { SamoucenjeNeveljavno, SamoucenjeNiPodprto, SamoucenjePokvarjeno };

export const SAMOUCENJE_DATOTEKA = "samoucenje.sqlite";
export const SAMOUCENJE_NASTAVITVE = "samoucenje.json";
export const SAMOUCENJE_MEJA_B = 20 * 1024 * 1024;

const NAJVEC_POGLAVIJ_NA_TEMO = 60;
const NAJVEC_ZNAKOV_POGLAVJA = 6000;
const NAJVEC_ZNAKOV_NASLOVA = 200;
const NAJVEC_ZNAKOV_URL = 500;
const NAJVEC_ZADETKOV = 20;
const MEJA_NASTAVITEV_B = 4096;
const SQLITE_GLAVA = Buffer.from("SQLite format 3\0", "ascii");
const O_VARNO_BRANJE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export type PoglavjeVnos = {
  /** Naslov poglavja (npr. razdelek vodnika ali naslov vira). */
  naslov: string;
  /** Besedilo poglavja (povzetek, okvirji, pravila, protivzorci, slovar). */
  besedilo: string;
  /** Vir (URL) ali prazno. */
  url?: string;
};

export type PoglavjeZapis = { id: number; tema: string; naslov: string; besedilo: string; url: string; cas: number };

export type UcenjeRezultat =
  | { zapisano: true; poglavij: number; izbrisanihTem: number; velikostB: number }
  | { zapisano: false; razlog: "izklopljeno" | "neveljavna-tema" | "prazno" };

type SqliteModul = { DatabaseSync: new (location: string) => DatabaseSync };
let sqliteModul: Promise<SqliteModul> | null = null;
async function naloziSqlite(): Promise<SqliteModul> {
  if (!sqliteModul) {
    sqliteModul = import("node:sqlite").then(
      (m) => m as unknown as SqliteModul,
      () => {
        sqliteModul = null;
        throw new SamoucenjeNiPodprto();
      },
    );
  }
  return sqliteModul;
}

let vrsta: Promise<unknown> = Promise.resolve();
/** Narasca ob vsakem pozabljanju: ucenje v ozadju, ki se je zacelo prej, ne sme obnoviti pozabljene teme. */
let rodPozabljanja = 0;
export function trenutniRodPozabljanja(): number {
  return rodPozabljanja;
}
function vVrsti<T>(f: () => Promise<T>): Promise<T> {
  const naslednji = vrsta.then(f, f);
  vrsta = naslednji.catch(() => undefined);
  return naslednji;
}

function poti(root: string) {
  const glavna = path.join(root, SAMOUCENJE_DATOTEKA);
  return [glavna, `${glavna}-wal`, `${glavna}-shm`];
}

/** Odstrani krmilne znake (razen \n in \t), omeji dolzino. Vsebina virov je nezaupana. */
export function ocistiBesedilo(s: unknown, najvec: number): string {
  if (typeof s !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, najvec);
}

function ocistiUrl(s: unknown): string {
  const u = ocistiBesedilo(s, NAJVEC_ZNAKOV_URL);
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : "";
  } catch {
    return "";
  }
}

async function preveriDatoteko(pot: string): Promise<{ obstaja: boolean; velikost: number }> {
  let st;
  try {
    st = await lstat(pot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { obstaja: false, velikost: 0 };
    throw e;
  }
  if (!st.isFile()) throw new SamoucenjeNeveljavno("Datoteka samoucenja ni obicajna datoteka.");
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    if (c === "ELOOP" || c === "EISDIR" || c === "ENXIO") throw new SamoucenjeNeveljavno("Datoteka samoucenja ni obicajna datoteka.");
    if (c === "ENOENT") return { obstaja: false, velikost: 0 };
    throw e;
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile()) throw new SamoucenjeNeveljavno("Datoteka samoucenja ni obicajna datoteka.");
    await h.chmod(0o600).catch(() => undefined);
    if (pot.endsWith(SAMOUCENJE_DATOTEKA) && st2.size > 0) {
      if (st2.size < SQLITE_GLAVA.length) throw new SamoucenjePokvarjeno("Datoteka samoucenja je skrajsana.");
      const g = Buffer.alloc(SQLITE_GLAVA.length);
      const { bytesRead } = await h.read(g, 0, g.length, 0);
      if (bytesRead < g.length || !g.equals(SQLITE_GLAVA)) throw new SamoucenjePokvarjeno("Datoteka samoucenja ni veljavna baza SQLite.");
    }
    return { obstaja: true, velikost: st2.size };
  } finally {
    await h.close().catch(() => undefined);
  }
}

/** Stikalo: privzeto VKLOPLJENO; samo izrecni false izklopi; neobicajna ali prevelika datoteka nastavitev = izklopljeno. */
export async function jeSamoucenjeVklopljeno(dir?: string): Promise<boolean> {
  const pot = path.join(resolveDataDir(dir), SAMOUCENJE_NASTAVITVE);
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
    const b = Buffer.alloc(MEJA_NASTAVITEV_B);
    const { bytesRead } = await h.read(b, 0, b.length, 0);
    const j = JSON.parse(b.subarray(0, bytesRead).toString("utf8")) as { vklopljen?: unknown };
    return j.vklopljen !== false;
  } catch {
    return false;
  } finally {
    await h.close().catch(() => undefined);
  }
}

export async function nastaviSamoucenje(vklopljen: boolean, dir?: string): Promise<boolean> {
  await writeJson(resolveDataDir(dir), SAMOUCENJE_NASTAVITVE, { vklopljen });
  return vklopljen;
}

function ustvariShemo(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS poglavja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tema TEXT NOT NULL,
      naslov TEXT NOT NULL,
      besedilo TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      cas INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS poglavja_tema ON poglavja (tema);
    CREATE VIRTUAL TABLE IF NOT EXISTS poglavja_fts USING fts5(
      naslov, besedilo, content='poglavja', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS poglavja_ai AFTER INSERT ON poglavja BEGIN
      INSERT INTO poglavja_fts(rowid, naslov, besedilo) VALUES (new.id, new.naslov, new.besedilo);
    END;
    CREATE TRIGGER IF NOT EXISTS poglavja_ad AFTER DELETE ON poglavja BEGIN
      INSERT INTO poglavja_fts(poglavja_fts, rowid, naslov, besedilo) VALUES ('delete', old.id, old.naslov, old.besedilo);
    END;
  `);
}

/** Poti baz, ki so v tem procesu ze presle quick_check (B9: ~94 ms na 19 MB, blokira zanko dogodkov; zadosca enkrat na proces). */
const preverjene = new Set<string>();

async function odpri(root: string, ustvari: boolean): Promise<{ db: DatabaseSync } | null> {
  const [glavna, wal, shm] = poti(root);
  const s = await preveriDatoteko(glavna);
  await preveriDatoteko(wal);
  await preveriDatoteko(shm);
  if (!s.obstaja && !ustvari) return null;
  const { DatabaseSync } = await naloziSqlite();
  if (!s.obstaja) {
    // Datoteka nastane z dovoljenji 0600 se pred SQLite (umask ne sme odpreti branja drugim).
    const fh = await open(glavna, constants.O_CREAT | constants.O_WRONLY, 0o600);
    await fh.close();
  }
  const db = new DatabaseSync(glavna);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    if (s.obstaja && s.velikost > 0 && !preverjene.has(glavna)) {
      const r = db.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
      if (!(r.length === 1 && Object.values(r[0])[0] === "ok")) throw new SamoucenjePokvarjeno();
      preverjene.add(glavna);
    }
    ustvariShemo(db);
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ze zaprto */
    }
    if (e instanceof SamoucenjePokvarjeno) throw e;
    const m = `${(e as Error)?.message ?? ""}`.toLowerCase();
    if (m.includes("malformed") || m.includes("not a database") || m.includes("corrupt")) throw new SamoucenjePokvarjeno();
    throw e;
  }
  try {
    await preveriDatoteko(glavna);
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ze zaprto */
    }
    throw e;
  }
  return { db };
}

async function velikost(root: string): Promise<number> {
  let skupaj = 0;
  for (const p of poti(root)) skupaj += (await preveriDatoteko(p)).velikost;
  return skupaj;
}

/**
 * Zapise poglavja ene teme (vse stare vrstice te teme se zamenjajo v eni transakciji). Samo ob vklopljenem samoucenju.
 * `tema` mora biti kljuc iz indeksa Learn Anything (preveri klicatelj); tu se samo oblika preveri se enkrat.
 */
export function naucilSeJe(tema: string, poglavja: PoglavjeVnos[], moznosti: { dir?: string; vklopljen?: boolean; mejaB?: number; rod?: number } = {}): Promise<UcenjeRezultat> {
  return vVrsti(async () => {
    if (moznosti.rod !== undefined && moznosti.rod !== rodPozabljanja) return { zapisano: false, razlog: "izklopljeno" };
    const root = resolveDataDir(moznosti.dir);
    if (!(moznosti.vklopljen ?? (await jeSamoucenjeVklopljeno(moznosti.dir)))) return { zapisano: false, razlog: "izklopljeno" };
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/.test(tema)) return { zapisano: false, razlog: "neveljavna-tema" };
    const cista = poglavja
      .slice(0, NAJVEC_POGLAVIJ_NA_TEMO)
      .map((p) => ({ naslov: ocistiBesedilo(p.naslov, NAJVEC_ZNAKOV_NASLOVA), besedilo: ocistiBesedilo(p.besedilo, NAJVEC_ZNAKOV_POGLAVJA), url: ocistiUrl(p.url) }))
      .filter((p) => p.naslov && p.besedilo);
    if (cista.length === 0) return { zapisano: false, razlog: "prazno" };
    const o = await odpri(root, true);
    if (!o) return { zapisano: false, razlog: "prazno" };
    const { db } = o;
    try {
      const mejaB = moznosti.mejaB ?? SAMOUCENJE_MEJA_B;
      let izbrisanihTem = 0;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM poglavja WHERE tema = ?").run(tema);
        const ins = db.prepare("INSERT INTO poglavja (tema, naslov, besedilo, url, cas) VALUES (?, ?, ?, ?, ?)");
        const cas = Date.now();
        for (const p of cista) ins.run(tema, p.naslov, p.besedilo, p.url, cas);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      // Nad mejo velikosti se najstarejse teme brisejo (nikoli ravnokar zapisana).
      while ((await velikost(root)) > mejaB) {
        const stara = db.prepare("SELECT tema FROM poglavja WHERE tema <> ? GROUP BY tema ORDER BY MIN(cas) ASC LIMIT 1").get(tema) as { tema?: string } | undefined;
        if (!stara?.tema) break;
        db.prepare("DELETE FROM poglavja WHERE tema = ?").run(stara.tema);
        izbrisanihTem++;
        db.exec("VACUUM");
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      }
      return { zapisano: true, poglavij: cista.length, izbrisanihTem, velikostB: await velikost(root) };
    } finally {
      db.close();
    }
  });
}

/** Iskanje po naucenem znanju (FTS5, predpona, BM25). Brez baze ali ob izklopu: prazen seznam. Po izbiri samo ena tema. */
export function isciZnanje(poizvedba: string, moznosti: { dir?: string; vklopljen?: boolean; tema?: string; najvec?: number } = {}): Promise<PoglavjeZapis[]> {
  return vVrsti(async () => {
    const root = resolveDataDir(moznosti.dir);
    if (!(moznosti.vklopljen ?? (await jeSamoucenjeVklopljeno(moznosti.dir)))) return [];
    // V2: dolzina poizvedbe je omejena (500 znakov, 16 besed); iskanje je sinhrono v zanki dogodkov.
    const q = ubeziPoizvedboFts(poizvedba.slice(0, 500).split(/\s+/).slice(0, 16).join(" "), true);
    if (!q) return [];
    const o = await odpri(root, false);
    if (!o) return [];
    try {
      const najvec = Math.min(Math.max(1, moznosti.najvec ?? 5), NAJVEC_ZADETKOV);
      const sql =
        "SELECT p.id, p.tema, p.naslov, p.besedilo, p.url, p.cas FROM poglavja_fts f JOIN poglavja p ON p.id = f.rowid WHERE poglavja_fts MATCH ?" +
        (moznosti.tema ? " AND p.tema = ?" : "") +
        " ORDER BY bm25(poglavja_fts) LIMIT ?";
      const args: Array<string | number> = moznosti.tema ? [q, moznosti.tema, najvec] : [q, najvec];
      return o.db.prepare(sql).all(...args) as PoglavjeZapis[];
    } finally {
      o.db.close();
    }
  });
}

/** Seznam naucenih tem (za prikaz uporabniku: vidno in izbrisljivo). */
export function seznamTem(moznosti: { dir?: string } = {}): Promise<Array<{ tema: string; poglavij: number; cas: number }>> {
  return vVrsti(async () => {
    const o = await odpri(resolveDataDir(moznosti.dir), false);
    if (!o) return [];
    try {
      return o.db.prepare("SELECT tema, COUNT(*) AS poglavij, MAX(cas) AS cas FROM poglavja GROUP BY tema ORDER BY cas DESC").all() as Array<{ tema: string; poglavij: number; cas: number }>;
    } finally {
      o.db.close();
    }
  });
}

/** Pozabi eno temo. Vrne stevilo izbrisanih poglavij. */
export function pozabiTemo(tema: string, moznosti: { dir?: string } = {}): Promise<number> {
  rodPozabljanja++;
  return vVrsti(async () => {
    const o = await odpri(resolveDataDir(moznosti.dir), false);
    if (!o) return 0;
    try {
      o.db.exec("PRAGMA secure_delete = ON");
      const r = o.db.prepare("DELETE FROM poglavja WHERE tema = ?").run(tema) as { changes?: number | bigint };
      try {
        o.db.exec("INSERT INTO poglavja_fts(poglavja_fts) VALUES ('optimize')");
      } catch {
        /* optimize ni nujen */
      }
      o.db.exec("VACUUM");
      o.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      return Number(r.changes ?? 0);
    } finally {
      o.db.close();
    }
  });
}

/** Pozabi vse: izbrise datoteko baze (in -wal, -shm). Samo na izrecno zahtevo uporabnika v nastavitvah. */
export function pozabiVse(moznosti: { dir?: string } = {}): Promise<{ izbrisanihDatotek: number }> {
  rodPozabljanja++;
  return vVrsti(async () => {
    let n = 0;
    for (const p of poti(resolveDataDir(moznosti.dir))) {
      try {
        const st = await lstat(p);
        if (!st.isFile()) continue;
        await unlink(p);
        n++;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return { izbrisanihDatotek: n };
  });
}
