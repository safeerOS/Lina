import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const NASTAVITVE_DATOTEKA = "nastavitve.json";

type Nastavitve = {
  mapa?: unknown;
};

/**
 * Privzeta mapa po sistemu. Platforma je parameter, da preizkus teče tudi na drugem sistemu.
 * Linux: ~/.local/share/lina, ali XDG_DATA_HOME/lina, če je nastavljen.
 * Windows: %LOCALAPPDATA%\Lina.
 */
export function defaultDataDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim();
    const base = local || paths.join(env.USERPROFILE?.trim() || "C:\\Users\\Default", "AppData", "Local");
    return paths.join(base, "Lina");
  }
  const xdg = env.XDG_DATA_HOME?.trim();
  const base = xdg || paths.join(env.HOME?.trim() || "", ".local", "share");
  return paths.join(base, "lina");
}

/** Izbrana mapa je zapisana v privzeti mapi, ne v mapi s podatki. */
export function readChosenDir(configDir = defaultDataDir()): string | null {
  try {
    const raw = readFileSync(path.join(configDir, NASTAVITVE_DATOTEKA), "utf8");
    const parsed = JSON.parse(raw) as Nastavitve;
    if (typeof parsed.mapa !== "string") return null;
    const mapa = parsed.mapa.trim();
    return mapa || null;
  } catch {
    return null;
  }
}

/**
 * Izrecna pot, sicer LINA_DATA (preizkusi), sicer izbrana mapa, sicer privzeta.
 * Ključ je na disku samo šifriran.
 */
export function resolveDataDir(dir?: string): string {
  if (dir && dir.trim()) return path.resolve(dir);
  const fromEnv = process.env.LINA_DATA?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const chosen = readChosenDir();
  if (chosen) return path.resolve(chosen);
  return path.resolve(defaultDataDir());
}

async function readJson<T>(dir: string, name: string, moznosti?: { premakniPokvarjen?: boolean }): Promise<T | null> {
  const file = path.join(dir, name);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as T;
    if (moznosti?.premakniPokvarjen && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
      throw new SyntaxError("Pričakovan JSON objekt.");
    }
    return parsed;
  } catch (error) {
    if (moznosti?.premakniPokvarjen && error instanceof SyntaxError) {
      await rename(file, `${file}.pokvarjen`).catch(() => undefined);
      return null;
    }
    throw error;
  }
}

/**
 * Atomarni zapis: vsebina gre najprej v začasno datoteko v isti mapi,
 * šele rename jo naredi vidno. Bralec vidi staro ali novo celoto.
 */
export async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const handle = await open(tmp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function readJsonFile<T>(dir: string, name: string, moznosti?: { premakniPokvarjen?: boolean }): Promise<T | null> {
  return readJson<T>(dir, name, moznosti);
}

export async function listDataFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
