import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readJsonFile, resolveDataDir, writeJson } from "./store.server.ts";
import { assertLocalSetup, jeLokalnaZahteva, type LokalnaZahteva, type SetupOrigin } from "./origin.ts";
import { pozabiZeton } from "./adc.server.ts";

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
/** Največ toliko napačnih gesel v oknu, potem tudi pravilno geslo počaka. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Piškotek seje. Stari piškotek pogovora `lina` se ne uporablja več. */
export const SESSION_COOKIE = "lina_session";
export const LEGACY_CONVERSATION_COOKIE = "lina";

export class LinaAuthError extends Error {
  readonly code = "PRIJAVA";
  constructor() {
    super("Prijava je obvezna.");
    this.name = "LinaAuthError";
  }
}

type AuthFile = {
  salt: string;
  hash: string;
  createdAt: string;
};

type SessionRow = {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

type SessionFile = {
  sessions: SessionRow[];
};

type LoginGuard = {
  failures: string[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
}

function checkPasswordShape(password: string): void {
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    throw new Error("Geslo mora imeti med 8 in 200 znakov.");
  }
}

async function readAuth(dir: string): Promise<AuthFile | null> {
  return readJsonFile<AuthFile>(dir, "auth.json");
}

async function readSessions(dir: string): Promise<SessionFile> {
  return (await readJsonFile<SessionFile>(dir, "sessions.json")) ?? { sessions: [] };
}

export async function ownerExists(dir?: string): Promise<boolean> {
  const auth = await readAuth(resolveDataDir(dir));
  return Boolean(auth?.hash && auth.salt);
}

/**
 * Shrani samo sol in scrypt hash. Geslo se na disk ne zapiše.
 * HTTP vhod vedno poda izvor. Brez izvora je klic notranji (preizkus jedra).
 */
export async function setupOwner(password: string, dir?: string, origin?: SetupOrigin | LokalnaZahteva): Promise<string> {
  if (origin) assertLocalSetup(origin);
  const root = resolveDataDir(dir);
  checkPasswordShape(password);
  if (await ownerExists(root)) throw new Error("Geslo je že nastavljeno.");
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  const file: AuthFile = {
    salt: salt.toString("hex"),
    hash: hash.toString("hex"),
    createdAt: new Date().toISOString(),
  };
  await writeJson(root, "auth.json", file);
  return openSession(root);
}

function recentFailures(failures: string[], now: number): string[] {
  return failures.filter((stamp) => {
    const at = Date.parse(stamp);
    return Number.isFinite(at) && now - at < LOGIN_WINDOW_MS && now - at >= 0;
  });
}

/**
 * Po petih napačnih geslih v 15 minutah zavrne tudi pravilno.
 * Števec je v datoteki, zato ostane po ponovnem zagonu.
 */
export async function loginOwner(password: string, dir?: string, now = Date.now()): Promise<string> {
  const root = resolveDataDir(dir);
  checkPasswordShape(password);
  const auth = await readAuth(root);
  if (!auth) throw new Error("Najprej nastavite geslo lastnika.");
  const guard = (await readJsonFile<LoginGuard>(root, "prijave.json")) ?? { failures: [] };
  const failures = recentFailures(guard.failures, now);
  if (failures.length >= LOGIN_MAX_FAILURES) {
    throw new Error("Preveč napačnih gesel. Počakajte 15 minut in poskusite znova.");
  }
  const hash = await hashPassword(password, Buffer.from(auth.salt, "hex"));
  const stored = Buffer.from(auth.hash, "hex");
  if (hash.length !== stored.length || !timingSafeEqual(hash, stored)) {
    failures.push(new Date(now).toISOString());
    await writeJson(root, "prijave.json", { failures });
    throw new Error("Napačno geslo.");
  }
  await writeJson(root, "prijave.json", { failures: [] });
  // Nova prijava lastnika: zeton Google Cloud iz prejsnje seje pridobimo znova (pregled G2, S3).
  pozabiZeton();
  return openSession(root);
}

async function openSession(dir: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const book = await readSessions(dir);
  const now = Date.now();
  book.sessions = book.sessions.filter((row) => Date.parse(row.expiresAt) > now);
  book.sessions.push({
    tokenHash: sha256(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_MS).toISOString(),
  });
  await writeJson(dir, "sessions.json", book);
  return token;
}

/**
 * Lina brez gesla (lastnik 12. 11. 2026: geslo si uporabnik nastavi le ob zelji).
 * Dokler gesla ni, sejo dobi samo zahteva z istega racunalnika; prek javnega naslova nikoli. Z geslom ta pot preneha.
 */
export async function odpriLokalnoSejo(zahteva: LokalnaZahteva, dir?: string): Promise<string | null> {
  const root = resolveDataDir(dir);
  if (await ownerExists(root)) return null;
  if (!jeLokalnaZahteva(zahteva)) return null;
  return openSession(root);
}

export async function logoutOwner(token: string | null, dir?: string): Promise<void> {
  if (!token) return;
  const root = resolveDataDir(dir);
  const book = await readSessions(root);
  const hash = sha256(token);
  book.sessions = book.sessions.filter((row) => !sameHex(row.tokenHash, hash));
  await writeJson(root, "sessions.json", book);
  pozabiZeton();
}

/** Veljavna seja je samo hash v datoteki, ki še ni potekel. */
export async function sessionIsValid(token: string | null, dir?: string): Promise<boolean> {
  if (!token) return false;
  const book = await readSessions(resolveDataDir(dir));
  const hash = sha256(token);
  const now = Date.now();
  let ok = false;
  for (const row of book.sessions) {
    const alive = Date.parse(row.expiresAt) > now;
    if (sameHex(row.tokenHash, hash) && alive) ok = true;
  }
  return ok;
}

export async function requireOwner(token: string | null, dir: string): Promise<void> {
  if (!(await sessionIsValid(token, dir))) throw new LinaAuthError();
}
