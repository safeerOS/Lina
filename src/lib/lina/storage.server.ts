import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, open, readFile, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { requireOwner } from "./auth.server.ts";
import { kljucBrezPravic } from "./keys.server.ts";
import { defaultDataDir, NASTAVITVE_DATOTEKA, readChosenDir, resolveDataDir, writeJson } from "./store.server.ts";
import type { StorageView } from "./types.ts";

/** Znanje, dnevnik, seje, prijave, prijava lastnika, šifrirani ključi (aktivni možgani za klice in shramba več ponudnikov) in revizijska veriga. */
export const PRENOS_DATOTEK = [
  "line.json",
  "calls.json",
  "sessions.json",
  "prijave.json",
  "auth.json",
  "kljuci.json",
  "ponudniki.json",
  "revizija.jsonl",
  ".kljuc",
] as const;

export const MIN_PROSTO = 50 * 1024 * 1024;

const OBLAK = /dropbox|onedrive|google\s*drive|icloud/i;

function razlog(mapa: string, text: string, opozorila: string[]): StorageView {
  return { ok: false, mapa, razlog: text, opozorila };
}

/** Opozorilo ne prepreči shranjevanja. Na Windows dovoljenj skupine ne gledamo. */
export async function opozorilaMape(target: string, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  const notes: string[] = [];
  if (OBLAK.test(target.replaceAll("\\", "/"))) {
    notes.push("Mapa je v oblaku (Dropbox, OneDrive, Google Drive ali iCloud). Shranjevanje ni prepovedano, je pa manj zasebno.");
  }
  if (platform === "win32") return notes;
  try {
    const info = await stat(target);
    if (info.isDirectory() && (info.mode & 0o077) !== 0) {
      notes.push("Mapa je berljiva drugim uporabnikom (dovoljenja skupine ali ostalih).");
    }
  } catch {
    /* Mapa še ne obstaja, dovoljenj še ni. */
  }
  return notes;
}

async function sha256(file: string): Promise<string> {
  const body = await readFile(file);
  return createHash("sha256").update(body).digest("hex");
}

export async function lahkoPise(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.lina-pisava.${process.pid}.${randomBytes(3).toString("hex")}.tmp`);
    const handle = await open(probe, "w", 0o600);
    try {
      await handle.writeFile("lina");
    } finally {
      await handle.close();
    }
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

async function prosto(dir: string): Promise<bigint | null> {
  try {
    const stats = await statfs(dir);
    return BigInt(stats.bavail) * BigInt(stats.bsize);
  } catch {
    return null;
  }
}

function znotraj(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (!rel) return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Prekopira stanje, preveri SHA-256 in šele nato zapiše izbrano mapo.
 * Stare datoteke ostanejo take, kot so bile.
 */
export async function moveDataDir(
  targetRaw: string,
  opts: { from?: string; configDir?: string; platform?: NodeJS.Platform } = {},
): Promise<StorageView> {
  const from = path.resolve(opts.from ?? resolveDataDir());
  const configDir = opts.configDir ?? defaultDataDir();
  const platform = opts.platform ?? process.platform;
  const target = path.resolve(targetRaw.trim());
  const opozorila = await opozorilaMape(target, platform);
  if (!targetRaw.trim()) return razlog(from, "Vpišite pot do mape.", opozorila);
  if (target === from) return { ok: true, mapa: from, razlog: "", opozorila };

  if (znotraj(from, target) || znotraj(target, from)) {
    return razlog(from, "Nova mapa ne sme biti znotraj trenutne ali obratno.", opozorila);
  }
  if (!(await lahkoPise(target))) {
    return razlog(from, "V izbrano mapo ni mogoče pisati.", opozorila);
  }
  const free = await prosto(target);
  if (free === null) return razlog(from, "Prostorja v mapi ni bilo mogoče preveriti.", opozorila);
  if (free < BigInt(MIN_PROSTO)) {
    return razlog(from, "V mapi je premalo prostora. Potrebnih je vsaj 50 MB.", opozorila);
  }

  const staged: string[] = [];
  const ready: Array<{ name: string; stage: string }> = [];
  try {
    for (const name of PRENOS_DATOTEK) {
      const src = path.join(from, name);
      let before: string;
      try {
        before = await sha256(src);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const stage = path.join(target, `.prenos-${name.replace(/^\./, "")}.${process.pid}.tmp`);
      await copyFile(src, stage);
      staged.push(stage);
      const after = await sha256(stage);
      const again = await sha256(src);
      if (after !== before || again !== before) throw new Error("hash");
      ready.push({ name, stage });
    }
    for (const item of ready) {
      const dest = path.join(target, item.name);
      await copyFile(item.stage, dest);
      await unlink(item.stage).catch(() => undefined);
    }
  } catch {
    for (const file of staged) await unlink(file).catch(() => undefined);
    return razlog(from, "Kopija se ne ujema. Mapa ostane stara.", opozorila);
  }

  if (platform !== "win32") {
    for (const name of [".kljuc", "kljuci.json", "ponudniki.json", "revizija.jsonl", "auth.json", "sessions.json"]) {
      await chmod(path.join(target, name), 0o600).catch(() => undefined);
    }
  }

  await writeJson(configDir, NASTAVITVE_DATOTEKA, { mapa: target });
  const saved = readChosenDir(configDir);
  if (saved !== target) {
    return razlog(from, "Izbrane mape ni bilo mogoče shraniti.", opozorila);
  }
  return { ok: true, mapa: target, razlog: "", opozorila: await opozorilaMape(target, platform) };
}

export async function readStorage(token: string | null, dir?: string): Promise<StorageView> {
  const root = resolveDataDir(dir);
  await requireOwner(token, root);
  // naloga 14 N1: .kljuc ostane berljiv drugim (FS brez pravic) - Lina deluje, vmesnik pokaze navodilo za premik mape (sl/en)
  return { ok: true, mapa: root, razlog: "", opozorila: await opozorilaMape(root), ...(kljucBrezPravic(root) ? { kljucBrezPravic: true } : {}) };
}

export async function chooseStorage(target: unknown, token: string | null): Promise<StorageView> {
  const root = resolveDataDir();
  await requireOwner(token, root);
  if (typeof target !== "string") {
    return { ok: false, mapa: root, razlog: "Vpišite pot do mape.", opozorila: [] };
  }
  return moveDataDir(target, { from: root, configDir: defaultDataDir() });
}
