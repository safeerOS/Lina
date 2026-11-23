import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { potTar } from "./tunel.server.ts";

/**
 * Namestitev gcloud v Linino lastno mapo, SAMO po uporabnikovem dovoljenju (lastnik 11. 11. 2026: »lina ga vpraša, ce ga
 * lahko namesti, in pojasni, zakaj ga potrebuje«). Brez root, brez PATH, brez skripte za namestitev z omrezja:
 * prenesemo pripet arhiv verzije 593.0.0 z dl.google.com (https, brez preusmeritev), preverimo SHA-256 CELEGA arhiva
 * PRED razpakiranjem in ga razpakiramo v mapo uporabnika. Vsota je izmerjena 11. 11. 2026; arhiv z verzijo in
 * nespremenljivi »rapid« arhiv imata enako vsebino (diff -r), razlikujeta se samo po pakiranju, zato pripnemo verzijskega.
 * Windows: vsota izmerjena, razpakiranje s tar.exe in zagon NISO preverjena (neverificirano do preizkusa na Windows).
 */
export const GCLOUD_VERZIJA = "593.0.0";
const OSNOVA = "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/";
const NAJVEC_BAJTOV = 250_000_000;

export type ArhivGcloud = { datoteka: string; sha256: string; url: string };

const ARHIVI: Record<string, ArhivGcloud> = {
  "linux-x64": {
    datoteka: `google-cloud-cli-${GCLOUD_VERZIJA}-linux-x86_64.tar.gz`,
    sha256: "42c32b7553c712f71fcf6f124546c0519437f53755f47f9bd0c957998cd6b826",
    url: "",
  },
  "win32-x64": {
    datoteka: `google-cloud-cli-${GCLOUD_VERZIJA}-windows-x86_64.zip`,
    sha256: "8fbdc9d644ffdd25a7f515c2643edc87100d3d48be9d3aa635454f6d7fb6a53c",
    url: "",
  },
};

/** Arhiv za platformo ali null (npr. Linux ARM, macOS: tam Lina ne ponuja namestitve, uporabnik namesti sam). */
export function arhivZaPlatformo(platform: NodeJS.Platform = process.platform, arch: string = process.arch): ArhivGcloud | null {
  const a = ARHIVI[`${platform}-${arch}`];
  return a ? { ...a, url: OSNOVA + a.datoteka } : null;
}

/** Ukaz za razpakiranje (samo v mapo uporabnika). Linux: tar brez lastnistva; Windows: tar.exe (bsdtar) zna zip. */
export function ukazRazpakiranja(platform: NodeJS.Platform, arhiv: string, cilj: string): { ukaz: string; args: string[] } {
  // Absolutna pot (12. 11. 2026, pregled nacrta programa): tar se ne isce po PATH uporabnika, kjer je ~/.local/bin pred /usr/bin
  // (enako kot Caddy in cloudflared, pregled P7).
  if (platform === "win32") return { ukaz: potTar(platform), args: ["-xf", arhiv, "-C", cilj] };
  return { ukaz: potTar(platform), args: ["-xzf", arhiv, "--no-same-owner", "-C", cilj] };
}

/** Primerjava vsot v konstantnem casu. */
export function vsotaEnaka(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

export type RezultatNamestitve = { uspeh: true } | { uspeh: false; sporocilo: string };

type Odvisnosti = {
  prenesi: (url: string, cilj: string) => Promise<string>; // vrne SHA-256 prenesene datoteke
  razpakiraj: (ukaz: string, args: string[]) => Promise<boolean>;
};

/** Prenos: samo https dl.google.com, brez preusmeritev, omejena velikost; vsota se racuna med pisanjem. */
export async function prenesiPreverjeno(url: string, cilj: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "dl.google.com") throw new Error("Nedovoljen naslov prenosa.");
  const odgovor = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(10 * 60_000) });
  if (!odgovor.ok || !odgovor.body) throw new Error("Prenos ni uspel.");
  const hash = createHash("sha256");
  let skupaj = 0;
  const vir = Readable.fromWeb(odgovor.body as never);
  vir.on("data", (kos: Buffer) => {
    skupaj += kos.length;
    if (skupaj > NAJVEC_BAJTOV) vir.destroy(new Error("Arhiv je prevelik."));
    hash.update(kos);
  });
  await pipeline(vir, createWriteStream(cilj, { mode: 0o600 }));
  return hash.digest("hex");
}

function zazeniRazpakiranje(ukaz: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(ukaz, args, { windowsHide: true, timeout: 5 * 60_000 }, (napaka) => resolve(!napaka));
  });
}

/**
 * Namesti gcloud v `lastnaMapa/google-cloud-sdk`. Najprej v zacasno mapo znotraj lastne mape, na koncu preimenovanje,
 * da napol razpakirana namestitev nikoli ne obstaja pod koncnim imenom. Zacasna mapa se vedno pobrise.
 */
export async function namestiGcloud(
  lastnaMapa: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  odv: Partial<Odvisnosti> = {},
): Promise<RezultatNamestitve> {
  const arhiv = arhivZaPlatformo(platform, arch);
  if (!arhiv) return { uspeh: false, sporocilo: "Za ta sistem Lina ne more sama namestiti orodja gcloud." };
  const prenesi = odv.prenesi ?? prenesiPreverjeno;
  const razpakiraj = odv.razpakiraj ?? zazeniRazpakiranje;
  mkdirSync(lastnaMapa, { recursive: true, mode: 0o700 });
  const zacasna = mkdtempSync(join(lastnaMapa, "namestitev-"));
  try {
    const datoteka = join(zacasna, "arhiv");
    let vsota: string;
    try {
      vsota = await prenesi(arhiv.url, datoteka);
    } catch {
      return { uspeh: false, sporocilo: "Prenos orodja gcloud ni uspel. Preverite internetno povezavo." };
    }
    if (!vsotaEnaka(vsota, arhiv.sha256)) {
      return { uspeh: false, sporocilo: "Preneseni arhiv ne ustreza pričakovani vsoti, zato ga nisem razpakirala." };
    }
    const izhod = join(zacasna, "izhod");
    mkdirSync(izhod, { recursive: true });
    const { ukaz, args } = ukazRazpakiranja(platform, datoteka, izhod);
    if (!(await razpakiraj(ukaz, args))) return { uspeh: false, sporocilo: "Razpakiranje orodja gcloud ni uspelo." };
    const koncna = join(lastnaMapa, "google-cloud-sdk");
    rmSync(koncna, { recursive: true, force: true });
    renameSync(join(izhod, "google-cloud-sdk"), koncna);
    return { uspeh: true };
  } catch {
    return { uspeh: false, sporocilo: "Namestitev orodja gcloud ni uspela." };
  } finally {
    rmSync(zacasna, { recursive: true, force: true });
  }
}
