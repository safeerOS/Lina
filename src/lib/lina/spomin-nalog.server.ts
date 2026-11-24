/**
 * Spomin nalog agentov v FTS5 SQLite shrambo po projektu (ideja: claude-mem, thedotmack/claude-mem, Apache-2.0; lastna koda po vzorcu spomin-baza.server.ts).
 *
 * Pravila:
 * - Privzeto VKLOPLJENO (manjkajoca datoteka spomin-nalog.json = vklopljen: true); izklopi samo izrecni false.
 * - Pravice 0600 prek deskriptorja brez sledenja simbolni povezavi; pokvarjena ali neobicajna datoteka se zavrne.
 * - FTS5 (unicode61 remove_diacritics 2) s sinhronizacijo v eni transakciji in ubezeno poizvedbo (ubeziPoizvedboFts).
 * - Postopno razkrivanje: kazaloZaProjekt vrne samo naslove (z mejo znakov), podrobnostiOpazanja vrne cel zapis po ID.
 * - Skrivnosti se ne zapisejo; v dnevnik gredo samo stevila, nikoli vsebina.
 * - Klici tajnice te datoteke ne uvazajo.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  SpominBazaNeveljavna as SpominNalogNeveljaven,
  SpominBazaNiPodprta as SpominNalogNiPodprt,
  SpominBazaPokvarjena as SpominNalogPokvarjen,
  ubeziPoizvedboFts,
} from "./spomin-baza.server.ts";
import {
  MEJA_ZNAKOV_KAZALA,
  izlusciOpazanje,
  oblikujKazalo,
  type KazaloVrstica,
  type OpazanjeVnos,
  type OpazanjeZapis,
} from "./spomin-nalog.ts";
import { resolveDataDir, writeJson } from "./store.server.ts";

export { SpominNalogNeveljaven, SpominNalogNiPodprt, SpominNalogPokvarjen };

export const SPOMIN_NALOG_DATOTEKA = "spomin-nalog.sqlite";
export const SPOMIN_NALOG_NASTAVITVE = "spomin-nalog.json";
export const SPOMIN_NALOG_MEJA_B = 20 * 1024 * 1024;
const MEJA_NASTAVITEV_B = 4096;
const NAJVEC_ZADETKOV = 50;
const SQLITE_GLAVA = Buffer.from("SQLite format 3\0", "ascii");
const O_VARNO_BRANJE = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const O_VARNO_USTVARI = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0);

type SqliteModul = { DatabaseSync: new (location: string) => DatabaseSync };
let sqliteModul: Promise<SqliteModul> | null = null;
async function naloziSqlite(): Promise<SqliteModul> {
  if (!sqliteModul) {
    sqliteModul = import("node:sqlite").then(
      (m) => m as unknown as SqliteModul,
      () => {
        sqliteModul = null;
        throw new SpominNalogNiPodprt();
      },
    );
  }
  return sqliteModul;
}

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

function poti(root: string): [string, string, string] {
  const glavna = path.join(root, SPOMIN_NALOG_DATOTEKA);
  return [glavna, `${glavna}-wal`, `${glavna}-shm`];
}

async function preveriDatoteko(pot: string): Promise<{ obstaja: boolean; velikost: number }> {
  let st;
  try {
    st = await lstat(pot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { obstaja: false, velikost: 0 };
    throw e;
  }
  if (!st.isFile()) throw new SpominNalogNeveljaven("Datoteka spomina nalog ni obicajna datoteka.");
  let h;
  try {
    h = await open(pot, O_VARNO_BRANJE);
  } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    if (c === "ELOOP" || c === "EISDIR" || c === "ENXIO") throw new SpominNalogNeveljaven();
    if (c === "ENOENT") return { obstaja: false, velikost: 0 };
    throw e;
  }
  try {
    const st2 = await h.stat();
    if (!st2.isFile()) throw new SpominNalogNeveljaven();
    await h.chmod(0o600).catch(() => undefined);
    if (pot.endsWith(SPOMIN_NALOG_DATOTEKA) && st2.size > 0) {
      if (st2.size < SQLITE_GLAVA.length) throw new SpominNalogPokvarjen("Datoteka spomina nalog je skrajsana.");
      const g = Buffer.alloc(SQLITE_GLAVA.length);
      const { bytesRead } = await h.read(g, 0, g.length, 0);
      if (bytesRead < g.length || !g.equals(SQLITE_GLAVA)) throw new SpominNalogPokvarjen("Datoteka spomina nalog ni veljavna baza SQLite.");
    }
    return { obstaja: true, velikost: st2.size };
  } finally {
    await h.close().catch(() => undefined);
  }
}

/** Stikalo: privzeto VKLOPLJENO; samo izrecni false izklopi. */
export async function jeSpominNalogVklopljen(dir?: string): Promise<boolean> {
  const pot = path.join(resolveDataDir(dir), SPOMIN_NALOG_NASTAVITVE);
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
    return true;
  } finally {
    await h.close().catch(() => undefined);
  }
}

export async function nastaviSpominNalog(vklopljen: boolean, dir?: string): Promise<boolean> {
  const v = vklopljen === true;
  await writeJson(resolveDataDir(dir), SPOMIN_NALOG_NASTAVITVE, { vklopljen: v });
  return v;
}

function ustvariShemo(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS opazanja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naloga_id TEXT NOT NULL UNIQUE,
      projekt TEXT NOT NULL,
      naslov TEXT NOT NULL,
      kaj_narejeno TEXT NOT NULL,
      odlocitve TEXT NOT NULL DEFAULT '',
      datoteke TEXT NOT NULL DEFAULT '[]',
      odprto TEXT NOT NULL DEFAULT '',
      cas INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opazanja_projekt_cas ON opazanja (projekt, cas DESC, id DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS opazanja_fts USING fts5(
      naslov, kaj_narejeno, odlocitve, datoteke, odprto,
      content='opazanja', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS opazanja_ai AFTER INSERT ON opazanja BEGIN
      INSERT INTO opazanja_fts(rowid, naslov, kaj_narejeno, odlocitve, datoteke, odprto)
      VALUES (new.id, new.naslov, new.kaj_narejeno, new.odlocitve, new.datoteke, new.odprto);
    END;
    CREATE TRIGGER IF NOT EXISTS opazanja_ad AFTER DELETE ON opazanja BEGIN
      INSERT INTO opazanja_fts(opazanja_fts, rowid, naslov, kaj_narejeno, odlocitve, datoteke, odprto)
      VALUES ('delete', old.id, old.naslov, old.kaj_narejeno, old.odlocitve, old.datoteke, old.odprto);
    END;
  `);
}

async function odpri(root: string, ustvari: boolean): Promise<DatabaseSync | null> {
  const [glavna, wal, shm] = poti(root);
  const s = await preveriDatoteko(glavna);
  await preveriDatoteko(wal);
  await preveriDatoteko(shm);
  if (!s.obstaja && !ustvari) return null;
  const { DatabaseSync: DbCtor } = await naloziSqlite();
  if (!s.obstaja) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const fh = await open(glavna, O_VARNO_USTVARI, 0o600);
    await fh.close();
  }
  const db = new DbCtor(glavna);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    if (s.obstaja && s.velikost > 0) {
      const r = db.prepare("PRAGMA quick_check(1)").get() as Record<string, unknown> | undefined;
      if (!r || r.quick_check !== "ok") throw new SpominNalogPokvarjen();
    }
    ustvariShemo(db);
    return db;
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ze zaprto */
    }
    if (e instanceof SpominNalogPokvarjen) throw e;
    const m = `${(e as Error)?.message ?? ""}`.toLowerCase();
    if (m.includes("malformed") || m.includes("not a database") || m.includes("corrupt")) throw new SpominNalogPokvarjen();
    throw e;
  }
}

function vrsticaVOpazanje(r: Record<string, unknown>): OpazanjeZapis {
  let datoteke: string[] = [];
  try {
    const p = JSON.parse(String(r.datoteke ?? "[]"));
    if (Array.isArray(p)) datoteke = p.filter((x): x is string => typeof x === "string");
  } catch {
    datoteke = [];
  }
  return {
    id: Number(r.id),
    nalogaId: String(r.naloga_id ?? ""),
    projekt: String(r.projekt ?? ""),
    naslov: String(r.naslov ?? ""),
    kajNarejeno: String(r.kaj_narejeno ?? ""),
    odlocitve: String(r.odlocitve ?? ""),
    datoteke,
    odprto: String(r.odprto ?? ""),
    cas: Number(r.cas),
  };
}

export type ZapisOpazanjaRezultat =
  | { zapisano: true; id: number; novo: boolean }
  | { zapisano: false; razlog: "izklopljeno" | "prazno-ali-skrivnost" };

/**
 * Zapise povzetek opazanj po koncani nalogi agenta v FTS5 shrambo po projektu.
 * Enaka nalogaId se ne podvoji (vrne obstojeci id, novo: false).
 */
export async function zapisiOpazanjeNaloge(
  dir: string | undefined,
  vnos: { nalogaId: string; projekt: string; naloga: string; porocilo: string; cas?: number } | OpazanjeVnos,
  moznosti: { vklopljen?: boolean; mejaB?: number } = {},
): Promise<ZapisOpazanjaRezultat> {
  const root = resolveDataDir(dir);
  if (!(moznosti.vklopljen ?? (await jeSpominNalogVklopljen(root)))) {
    return { zapisano: false, razlog: "izklopljeno" };
  }
  const opazanje: OpazanjeVnos | null =
    "porocilo" in vnos
      ? izlusciOpazanje(vnos.nalogaId, vnos.projekt, vnos.naloga, vnos.porocilo, vnos.cas)
      : vnos;
  if (!opazanje || !opazanje.nalogaId || !opazanje.projekt || !opazanje.naslov) {
    return { zapisano: false, razlog: "prazno-ali-skrivnost" };
  }
  const projektNorm = path.resolve(opazanje.projekt);
  return vVrsti(root, async () => {
    const db = await odpri(root, true);
    if (!db) return { zapisano: false, razlog: "izklopljeno" };
    try {
      const ze = db.prepare("SELECT id FROM opazanja WHERE naloga_id = ?").get(opazanje.nalogaId) as { id?: number } | undefined;
      if (ze?.id !== undefined) return { zapisano: true, id: Number(ze.id), novo: false };
      let id: number;
      db.exec("BEGIN IMMEDIATE");
      try {
        const res = db
          .prepare(
            "INSERT INTO opazanja (naloga_id, projekt, naslov, kaj_narejeno, odlocitve, datoteke, odprto, cas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            opazanje.nalogaId,
            projektNorm,
            opazanje.naslov,
            opazanje.kajNarejeno,
            opazanje.odlocitve,
            JSON.stringify(opazanje.datoteke),
            opazanje.odprto,
            opazanje.cas ?? Date.now(),
          );
        id = Number(res.lastInsertRowid);
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ze razveljavljeno */
        }
        throw e;
      }
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const mejaB = moznosti.mejaB ?? SPOMIN_NALOG_MEJA_B;
      const [glavna] = poti(root);
      while ((await preveriDatoteko(glavna)).velikost > mejaB) {
        const najstarejse = db.prepare("SELECT id FROM opazanja WHERE id <> ? ORDER BY cas ASC, id ASC LIMIT 1").get(id) as { id?: number } | undefined;
        if (!najstarejse?.id) break;
        db.prepare("DELETE FROM opazanja WHERE id = ?").run(najstarejse.id);
        db.exec("VACUUM");
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      }
      console.info(`lina spomin-nalog: zapisano=1`);
      return { zapisano: true, id, novo: true };
    } finally {
      db.close();
    }
  });
}

/** Iskanje opazanj po projektu prek FTS5 (BM25) ali zadnja opazanja projekta. */
export async function isciOpazanja(
  dir: string | undefined,
  projekt: string,
  poizvedba = "",
  moznosti: { vklopljen?: boolean; najvec?: number } = {},
): Promise<OpazanjeZapis[]> {
  const root = resolveDataDir(dir);
  if (!(moznosti.vklopljen ?? (await jeSpominNalogVklopljen(root)))) return [];
  const projektNorm = path.resolve(projekt);
  const najvec = Math.min(Math.max(1, moznosti.najvec ?? 10), NAJVEC_ZADETKOV);
  return vVrsti(root, async () => {
    const db = await odpri(root, false);
    if (!db) return [];
    try {
      const q = ubeziPoizvedboFts(poizvedba.slice(0, 400), true);
      if (q) {
        const rows = db
          .prepare(
            "SELECT o.id, o.naloga_id, o.projekt, o.naslov, o.kaj_narejeno, o.odlocitve, o.datoteke, o.odprto, o.cas " +
              "FROM opazanja_fts f JOIN opazanja o ON o.id = f.rowid " +
              "WHERE opazanja_fts MATCH ? AND o.projekt = ? " +
              "ORDER BY bm25(opazanja_fts) ASC, o.cas DESC LIMIT ?",
          )
          .all(q, projektNorm, najvec) as Record<string, unknown>[];
        if (rows.length > 0) return rows.map(vrsticaVOpazanje);
      }
      const zadnje = db
        .prepare(
          "SELECT id, naloga_id, projekt, naslov, kaj_narejeno, odlocitve, datoteke, odprto, cas " +
            "FROM opazanja WHERE projekt = ? ORDER BY cas DESC, id DESC LIMIT ?",
        )
        .all(projektNorm, najvec) as Record<string, unknown>[];
      return zadnje.map(vrsticaVOpazanje);
    } finally {
      db.close();
    }
  });
}

/**
 * Postopno razkrivanje - 1. korak: ob novi nalogi v isti projekt vrne samo KAZALO (naslovi + ID) z mejo znakov.
 */
export async function kazaloZaProjekt(
  dir: string | undefined,
  projekt: string,
  moznosti: { poizvedba?: string; mejaZnakov?: number; najvec?: number; vklopljen?: boolean } = {},
): Promise<string> {
  const zapisi = await isciOpazanja(dir, projekt, moznosti.poizvedba ?? "", {
    vklopljen: moznosti.vklopljen,
    najvec: moznosti.najvec ?? 12,
  });
  const vrstice: KazaloVrstica[] = zapisi.map((z) => ({
    id: z.id,
    nalogaId: z.nalogaId,
    naslov: z.naslov,
    cas: z.cas,
    steviloDatotek: z.datoteke.length,
  }));
  return oblikujKazalo(vrstice, moznosti.mejaZnakov ?? MEJA_ZNAKOV_KAZALA);
}

/**
 * Postopno razkrivanje - 2. korak: podrobnosti enega opazanja na zahtevo po ID (ali nalogaId).
 */
export async function podrobnostiOpazanja(
  dir: string | undefined,
  idAliNaloga: number | string,
  moznosti: { vklopljen?: boolean } = {},
): Promise<OpazanjeZapis | null> {
  const root = resolveDataDir(dir);
  if (!(moznosti.vklopljen ?? (await jeSpominNalogVklopljen(root)))) return null;
  return vVrsti(root, async () => {
    const db = await odpri(root, false);
    if (!db) return null;
    try {
      const row = (
        typeof idAliNaloga === "number"
          ? db.prepare("SELECT * FROM opazanja WHERE id = ?").get(idAliNaloga)
          : db.prepare("SELECT * FROM opazanja WHERE naloga_id = ?").get(idAliNaloga)
      ) as Record<string, unknown> | undefined;
      return row ? vrsticaVOpazanje(row) : null;
    } finally {
      db.close();
    }
  });
}
